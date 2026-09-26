import { LyskomClient } from "../dist/index.js";

export const HTTPKOM_BASE_URL =
  process.env.HTTPKOM_BASE_URL || "http://localhost:5101";
export const LYSKOM_SERVER_ID = "default";

export const TEST_USER = { name: "Test User", passwd: "test123" };
export const ANOTHER_USER = { name: "Another User", passwd: "test456" };

export function createClient() {
  return new LyskomClient({
    lyskomServerId: LYSKOM_SERVER_ID,
    httpkomServer: HTTPKOM_BASE_URL,
  });
}

export async function createLoggedInClient(user = TEST_USER) {
  const client = createClient();
  await client.connect();
  await client.login({ name: user.name, passwd: user.passwd });
  return client;
}

export async function waitForCondition(
  fn: () => unknown,
  timeoutMs = 5000,
  intervalMs = 100
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitForCondition timed out after ${timeoutMs}ms`);
}

export async function safeDisconnect(client: LyskomClient | null, timeoutMs = 3000) {
  if (!client?.isConnected()) return;
  try {
    await Promise.race([
      client.disconnect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("disconnect timeout")), timeoutMs)
      ),
    ]);
  } catch {}
}

export async function waitForMemberships(client: LyskomClient, timeoutMs = 5000) {
  return waitForCondition(
    () => client.getSnapshot().memberships.length > 0,
    timeoutMs
  );
}

export async function waitForReader(client: LyskomClient, timeoutMs = 5000) {
  return waitForCondition(() => {
    const reader = client.getSnapshot().reader;
    return reader && !reader.advancing;
  }, timeoutMs);
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, what = "operation"): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

// --- Fault injection (httpkom <-> lyskomd goes through toxiproxy) ---

export const TOXIPROXY_URL = process.env.TOXIPROXY_URL || "http://localhost:8474";

async function updateLyskomProxy(body: Record<string, unknown>) {
  const res = await fetch(`${TOXIPROXY_URL}/proxies/lyskomd`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`toxiproxy update failed: ${res.status} ${await res.text()}`);
}

/**
 * Close all open connections between httpkom and lyskomd, as when
 * lyskomd kicks a client or restarts. New connections work right away.
 */
export async function dropLyskomConnections() {
  await updateLyskomProxy({ enabled: false });
  await updateLyskomProxy({ enabled: true });
}
