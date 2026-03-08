import { describe, it, expect, afterEach } from "vitest";
import {
  createClient,
  createLoggedInClient,
  safeDisconnect,
  TEST_USER,
  HTTPKOM_BASE_URL,
  LYSKOM_SERVER_ID,
} from "./helpers";
import { LyskomClient } from "../dist/index.js";

describe("sessions", () => {
  let client: LyskomClient;

  afterEach(async () => {
    await safeDisconnect(client);
  });

  it("should connect and create a session", async () => {
    client = createClient();
    expect(client.isConnected()).toBe(false);

    const session = await client.connect();

    expect(client.isConnected()).toBe(true);
    expect(session.session_no).toBeTruthy();
  });

  it("should login with valid credentials", async () => {
    client = createClient();
    await client.connect();
    expect(client.isLoggedIn()).toBe(false);

    const person = await client.login({
      name: TEST_USER.name,
      passwd: TEST_USER.passwd,
    });

    expect(client.isLoggedIn()).toBe(true);
    expect(person.pers_no).toBeTruthy();
    expect(person.pers_name).toBe(TEST_USER.name);
  });

  it("should login by persNo", async () => {
    // First login by name to discover the persNo
    client = await createLoggedInClient();
    const persNo = client.getPersNo();
    await client.logout();

    const person = await client.login({ persNo, passwd: TEST_USER.passwd });

    expect(client.isLoggedIn()).toBe(true);
    expect(person.pers_no).toBe(persNo);
  });

  it("should logout", async () => {
    client = createClient();
    await client.connect();
    await client.login({ name: TEST_USER.name, passwd: TEST_USER.passwd });
    expect(client.isLoggedIn()).toBe(true);

    await client.logout();

    expect(client.isLoggedIn()).toBe(false);
    expect(client.isConnected()).toBe(true);
  });

  it("should disconnect and destroy the session", async () => {
    client = createClient();
    await client.connect();

    await client.disconnect();

    expect(client.isConnected()).toBe(false);
    expect(client.isLoggedIn()).toBe(false);
    client = null!;
  });

  it("should reject login with wrong password", async () => {
    client = createClient();
    await client.connect();

    await expect(
      client.login({ name: TEST_USER.name, passwd: "wrongpassword" })
    ).rejects.toThrow();
  });

  it("should return persNo when logged in and null when not", async () => {
    client = createClient();
    await client.connect();
    expect(client.getPersNo()).toBeNull();

    await client.login({ name: TEST_USER.name, passwd: TEST_USER.passwd });

    expect(typeof client.getPersNo()).toBe("number");
    expect(client.getPersNo()).toBeGreaterThan(0);
  });

  it("should serialize and restore connection with toObject/fromObject", async () => {
    client = await createLoggedInClient();
    const persNo = client.getPersNo();

    const obj = client.toObject();
    expect(obj.id).toBeTruthy();
    expect(obj.httpkomId).toBeTruthy();
    expect(obj.session).toBeTruthy();

    // Restore into a new client
    const restored = LyskomClient.fromObject({
      ...obj,
      httpkomServer: HTTPKOM_BASE_URL,
    });

    expect(restored.isConnected()).toBe(true);
    expect(restored.isLoggedIn()).toBe(true);
    expect(restored.getPersNo()).toBe(persNo);

    // Disconnect the restored client, original is now invalid
    await safeDisconnect(restored);
    client = null!;
  });

  it("should get available LysKOM servers", async () => {
    client = createClient();

    const servers = await client.getLyskomServers();

    expect(typeof servers).toBe("object");
    expect(servers[LYSKOM_SERVER_ID]).toBeTruthy();
    expect(servers[LYSKOM_SERVER_ID].id).toBe(LYSKOM_SERVER_ID);
  });

  it("should notify subscribers on login and logout", async () => {
    client = createClient();
    await client.connect();

    let notifyCount = 0;
    const unsubscribe = client.subscribe(() => {
      notifyCount++;
    });

    const prevCount = notifyCount;
    await client.login({ name: TEST_USER.name, passwd: TEST_USER.passwd });
    expect(notifyCount).toBeGreaterThan(prevCount);

    const snap = client.getSnapshot();
    expect(snap.isLoggedIn).toBe(true);
    expect(snap.persNo).toBeGreaterThan(0);

    const preLogout = notifyCount;
    await client.logout();
    expect(notifyCount).toBeGreaterThan(preLogout);

    const snapAfter = client.getSnapshot();
    expect(snapAfter.isLoggedIn).toBe(false);
    expect(snapAfter.persNo).toBeNull();

    unsubscribe();
  });

  it("should unsubscribe listeners", async () => {
    client = createClient();
    await client.connect();

    let called = 0;
    const unsubscribe = client.subscribe(() => {
      called++;
    });

    await client.login({ name: TEST_USER.name, passwd: TEST_USER.passwd });
    const afterLogin = called;
    expect(afterLogin).toBeGreaterThan(0);

    unsubscribe();

    await client.logout();
    expect(called).toBe(afterLogin);
  });
});
