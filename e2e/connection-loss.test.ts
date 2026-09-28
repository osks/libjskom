import { describe, it, expect, afterEach } from "vitest";
import {
  blackholeLyskom,
  clearLyskomToxics,
  createClient,
  createLoggedInClient,
  dropLyskomConnections,
  safeDisconnect,
  waitForMemberships,
  withTimeout,
  TEST_USER,
} from "./helpers";
import { LyskomClient } from "../dist/index.js";

// No retries: these tests are about timing, and a retry would hide
// a request that only sometimes hangs.
describe("connection loss", { retry: 0 }, () => {
  let client: LyskomClient;

  afterEach(async () => {
    await clearLyskomToxics();
    await safeDisconnect(client);
  });

  // Log in and wait until the requests started by login are done, so the
  // connection is idle when it is dropped (like a phone that was asleep).
  async function createIdleLoggedInClient() {
    const c = await createLoggedInClient();
    await waitForMemberships(c);
    await new Promise((r) => setTimeout(r, 500));
    return c;
  }

  it("should log out when lyskomd drops the connection", async () => {
    client = await createIdleLoggedInClient();

    await dropLyskomConnections();

    await expect(
      withTimeout(client.getMembershipUnreads(), 5000, "request after connection loss")
    ).rejects.toMatchObject({ status: 403 });
    expect(client.isLoggedIn()).toBe(false);
  });

  it("should be able to log in again after lyskomd dropped the connection", async () => {
    client = await createIdleLoggedInClient();

    await dropLyskomConnections();
    await withTimeout(client.getMembershipUnreads(), 5000, "request after connection loss").catch(() => {});

    await withTimeout(client.login({ name: TEST_USER.name, passwd: TEST_USER.passwd }), 5000, "login");
    expect(client.isLoggedIn()).toBe(true);
  });

  it("should time out and report reconnecting when requests get no response", async () => {
    client = createClient({ requestTimeoutMs: 1000 });
    await client.connect();
    await client.login({ name: TEST_USER.name, passwd: TEST_USER.passwd });
    await waitForMemberships(client);

    await blackholeLyskom();

    await expect(
      withTimeout(client.getMembershipUnreads(), 3000, "request to black hole")
    ).rejects.toMatchObject({ timedOut: true });
    expect(client.getSnapshot().connectionStatus).toBe("reconnecting");
    expect(client.isLoggedIn()).toBe(true);
  });

  it("should log out quickly when httpkom's keepalive finds the LysKOM connection dead", async () => {
    client = createClient({ requestTimeoutMs: 10000 });
    await client.connect();
    await client.login({ name: TEST_USER.name, passwd: TEST_USER.passwd });
    await waitForMemberships(client);
    await new Promise((r) => setTimeout(r, 500));

    await blackholeLyskom();
    // httpkom pings every 2s and gives up after 2s without a reply
    await new Promise((r) => setTimeout(r, 7000));

    // The session is gone, so httpkom answers at once instead of the
    // request hanging on the dead connection
    const start = Date.now();
    await expect(
      withTimeout(client.getMembershipUnreads(), 3000, "request after keepalive")
    ).rejects.toMatchObject({ status: 403 });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(client.isLoggedIn()).toBe(false);
  }, 20000);
});
