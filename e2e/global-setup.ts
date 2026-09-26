import { GenericContainer, Network, Wait } from "testcontainers";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOXIPROXY_IMAGE = "ghcr.io/shopify/toxiproxy:2.12.0";

let cleanupFn: (() => Promise<void>) | undefined;

// Build context for the httpkom image: the Dockerfile plus src/ with
// local checkouts of pylyskom/httpkom, if PYLYSKOM_SRC/HTTPKOM_SRC are set.
function httpkomBuildContext(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "libjskom-e2e-httpkom-"));
  fs.copyFileSync(path.join(__dirname, "httpkom", "Dockerfile"), path.join(dir, "Dockerfile"));
  fs.mkdirSync(path.join(dir, "src"));

  const skip = new Set([".git", ".tox", ".venv", "__pycache__", "node_modules", "dist", "build", "site"]);
  for (const [name, src] of [["pylyskom", process.env.PYLYSKOM_SRC], ["httpkom", process.env.HTTPKOM_SRC]]) {
    if (!src) continue;
    const from = path.resolve(src);
    console.log(`httpkom image: using local ${name} from ${from}`);
    fs.cpSync(from, path.join(dir, "src", name), {
      recursive: true,
      filter: (p) => !skip.has(path.basename(p)),
    });
  }
  return dir;
}

export async function setup() {
  const network = await new Network().start();

  const lyskom = await GenericContainer.fromDockerfile(
    path.join(__dirname, "lyskom-server")
  ).build();

  const lyskomContainer = await lyskom
    .withNetwork(network)
    .withNetworkAliases("lyskomd")
    .withExposedPorts(4894)
    .withWaitStrategy(Wait.forHealthCheck())
    .withStartupTimeout(30_000)
    .start();

  // httpkom talks to lyskomd through toxiproxy, so tests can break the
  // connection between them (see helpers.ts).
  const toxiproxyContainer = await new GenericContainer(TOXIPROXY_IMAGE)
    .withNetwork(network)
    .withNetworkAliases("toxiproxy")
    .withExposedPorts(8474)
    .withWaitStrategy(Wait.forHttp("/version", 8474))
    .start();

  const toxiproxyUrl = `http://${toxiproxyContainer.getHost()}:${toxiproxyContainer.getMappedPort(8474)}`;
  const res = await fetch(`${toxiproxyUrl}/proxies`, {
    method: "POST",
    body: JSON.stringify({ name: "lyskomd", listen: "0.0.0.0:4894", upstream: "lyskomd:4894", enabled: true }),
  });
  if (!res.ok) throw new Error(`Failed to create toxiproxy proxy: ${res.status} ${await res.text()}`);

  const httpkomCfg = [
    "DEBUG = True",
    "HTTPKOM_CROSSDOMAIN_ALLOWED_ORIGINS = ['*']",
    "HTTPKOM_CROSSDOMAIN_MAX_AGE = 3600",
    "HTTPKOM_LYSKOM_SERVERS = [",
    "    ('default', 'Default', 'toxiproxy', 4894),",
    "]",
  ].join("\n");

  const buildContext = httpkomBuildContext();
  const httpkom = await GenericContainer.fromDockerfile(buildContext).build();
  fs.rmSync(buildContext, { recursive: true, force: true });

  const httpkomContainer = await httpkom
    .withNetwork(network)
    .withExposedPorts(5001)
    .withCopyContentToContainer([
      { content: httpkomCfg, target: "/etc/httpkom.cfg" },
    ])
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(30_000)
    .start();

  const httpkomPort = httpkomContainer.getMappedPort(5001);
  const httpkomHost = httpkomContainer.getHost();

  process.env.HTTPKOM_BASE_URL = `http://${httpkomHost}:${httpkomPort}`;
  process.env.TOXIPROXY_URL = toxiproxyUrl;

  console.log(`lyskomd: port ${lyskomContainer.getMappedPort(4894)}`);
  console.log(`httpkom: ${process.env.HTTPKOM_BASE_URL}`);
  console.log(`toxiproxy: ${toxiproxyUrl}`);

  cleanupFn = async () => {
    await httpkomContainer.stop();
    await toxiproxyContainer.stop();
    await lyskomContainer.stop();
    await network.stop();
  };
}

export async function teardown() {
  await cleanupFn?.();
}
