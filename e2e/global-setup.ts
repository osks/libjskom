import { GenericContainer, Network, Wait } from "testcontainers";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cleanupFn: (() => Promise<void>) | undefined;

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

  const httpkomCfg = [
    "DEBUG = True",
    "HTTPKOM_CROSSDOMAIN_ALLOWED_ORIGINS = ['*']",
    "HTTPKOM_CROSSDOMAIN_MAX_AGE = 3600",
    "HTTPKOM_LYSKOM_SERVERS = [",
    "    ('default', 'Default', 'lyskomd', 4894),",
    "]",
  ].join("\n");

  const httpkom = await GenericContainer.fromDockerfile(
    path.join(__dirname, "httpkom")
  ).build();

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

  console.log(`lyskomd: port ${lyskomContainer.getMappedPort(4894)}`);
  console.log(`httpkom: ${process.env.HTTPKOM_BASE_URL}`);

  cleanupFn = async () => {
    await httpkomContainer.stop();
    await lyskomContainer.stop();
    await network.stop();
  };
}

export async function teardown() {
  await cleanupFn?.();
}
