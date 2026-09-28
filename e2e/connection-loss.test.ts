import { describe, it, expect, afterEach, vi } from "vitest";
import {
  blackholeLyskom,
  slowLyskom,
  waitForCondition,
  someUnreadTextNo,
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

  it("should fetch again what failed when the connection comes back", async () => {
    // A session to restore, as after a page reload
    const first = await createLoggedInClient();
    await waitForMemberships(first);
    const textNo = await someUnreadTextNo(first);
    const saved = first.toObject();

    // Slow enough that the restored client's requests time out (1s), but not
    // so slow that httpkom's keepalive (2s timeout) drops the session
    await slowLyskom(1500);
    client = createClient({ ...saved, requestTimeoutMs: 1000 });
    client.resume();
    await client.getText(textNo).catch(() => {});
    await waitForCondition(() => client.getSnapshot().connectionStatus === "reconnecting");
    expect(client.getSnapshot().memberships).toEqual([]);
    expect(client.getSnapshot().texts.has(textNo)).toBe(false);

    // The next answer from httpkom brings the connection back, and what
    // failed is fetched again without the app asking
    await clearLyskomToxics();
    await client.getMembershipUnreads().catch(() => {});
    await waitForCondition(() => {
      const snap = client.getSnapshot();
      return snap.connectionStatus === "connected" && snap.memberships.length > 0 && snap.texts.has(textNo);
    }, 8000);
  }, 20000);

  it("should fetch again what failed, including marks, when refresh() is called", async () => {
    const first = await createLoggedInClient();
    await waitForMemberships(first);
    const textNo = await someUnreadTextNo(first);
    await first.createMark(textNo, 100);
    const saved = first.toObject();

    await slowLyskom(1500);
    client = createClient({ ...saved, requestTimeoutMs: 1000 });
    client.resume();
    await waitForCondition(() => client.getSnapshot().connectionStatus === "reconnecting");
    expect(client.getSnapshot().memberships).toEqual([]);
    expect(client.getSnapshot().marks).toEqual([]);

    // No other request is made: refresh() alone (as when the app returns to
    // the foreground) must fetch it all
    await clearLyskomToxics();
    client.refresh();
    await waitForCondition(() => {
      const snap = client.getSnapshot();
      return snap.connectionStatus === "connected" && snap.memberships.length > 0 &&
        snap.marks.some((m: any) => m.text_no === textNo);
    }, 8000);

    await first.deleteMark(textNo);
  }, 20000);

  it("should not retry texts that don't exist", async () => {
    client = await createLoggedInClient();
    await waitForMemberships(client);
    const missing = 999999999;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      await expect(client.getText(missing)).rejects.toMatchObject({ status: 404 });
      client.refresh();
      await new Promise((r) => setTimeout(r, 1000));
      const calls = fetchSpy.mock.calls.filter(([url]) => String(url).includes(`/texts/${missing}`));
      expect(calls).toHaveLength(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
