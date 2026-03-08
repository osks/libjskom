import { describe, it, expect, afterEach } from "vitest";
import { createClient, createLoggedInClient, safeDisconnect } from "./helpers";
import { LyskomClient } from "../dist/index.js";

const uniqueSuffix = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

describe("persons", () => {
  let client: LyskomClient;

  afterEach(async () => {
    await safeDisconnect(client);
  });

  it("should create a new person", async () => {
    client = await createLoggedInClient();
    const name = `E2E User ${uniqueSuffix()}`;

    const person = await client.createPerson(name, "newpass123");

    expect(person.pers_no).toBeTruthy();
    expect(person.pers_name).toBe(name);
  });

  it("should login as a newly created person", async () => {
    client = await createLoggedInClient();
    const name = `Login User ${uniqueSuffix()}`;
    await client.createPerson(name, "loginpass");
    await client.logout();

    const person = await client.login({ name, passwd: "loginpass" });

    expect(person.pers_no).toBeTruthy();
    expect(person.pers_name).toBe(name);
    expect(client.isLoggedIn()).toBe(true);
  });

  it("should change password", async () => {
    client = await createLoggedInClient();
    const name = `PwdUser ${uniqueSuffix()}`;
    const person = await client.createPerson(name, "oldpass");
    await client.logout();

    // Login as new user and change password
    await client.login({ name, passwd: "oldpass" });
    await client.setPassword(person.pers_no, "oldpass", "newpass");
    await client.logout();

    // Old password should fail
    await expect(
      client.login({ name, passwd: "oldpass" })
    ).rejects.toThrow();

    // Reconnect — failed login leaves background requests in a bad state
    await client.disconnect();
    client = createClient();
    await client.connect();

    // New password should work
    const loggedIn = await client.login({ name, passwd: "newpass" });
    expect(loggedIn.pers_no).toBe(person.pers_no);
  });
});
