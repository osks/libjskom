import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createLoggedInClient, safeDisconnect, ANOTHER_USER } from "./helpers";
import { LyskomClient } from "../dist/index.js";

const uniqueSuffix = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

describe("memberships", () => {
  let client: LyskomClient;
  let testConferenceConfNo: number;

  // Discover "Test Conference" conf_no dynamically
  beforeAll(async () => {
    const c = await createLoggedInClient();
    const memberships = await c.getMemberships();
    const m = memberships.memberships.find(
      (m: any) => m.conference.name === "Test Conference"
    );
    testConferenceConfNo = m.conference.conf_no;
    await c.disconnect();
  });

  afterEach(async () => {
    await safeDisconnect(client);
  });

  it("should get memberships for logged-in user", async () => {
    client = await createLoggedInClient();

    const memberships = await client.getMemberships();

    expect(Array.isArray(memberships.memberships)).toBe(true);
    expect(memberships.memberships.length).toBeGreaterThan(0);
  });

  it("should get a single membership", async () => {
    client = await createLoggedInClient();

    const all = await client.getMemberships();
    const confNo = all.memberships[0].conference.conf_no;

    const membership = await client.getMembership(confNo);

    expect(membership.conference.conf_no).toBe(confNo);
    expect(membership.priority).toBeDefined();
  });

  it("should get membership unread for a conference", async () => {
    client = await createLoggedInClient();

    const memberships = await client.getMemberships();
    const confNo = memberships.memberships[0].conference.conf_no;

    const unread = await client.getMembershipUnread(confNo);

    expect(unread).toBeDefined();
    expect(unread).toHaveProperty("no_of_unread");
    expect(unread.conf_no).toBe(confNo);
  });

  it("should get all membership unread counts", async () => {
    client = await createLoggedInClient();

    const unreads = await client.getMembershipUnreads();

    expect(Array.isArray(unreads)).toBe(true);
  });

  it("should set number of unread texts", async () => {
    client = await createLoggedInClient();

    const memberships = await client.getMemberships();
    const confNo = memberships.memberships[0].conference.conf_no;

    await client.setNumberOfUnreadTexts(confNo, 0);

    const unread = await client.getMembershipUnread(confNo);
    expect(unread.no_of_unread).toBe(0);
  });

  it("should add and delete a membership", async () => {
    client = await createLoggedInClient();

    // Create a fresh person who only has their letterbox membership
    const name = `MbrUser ${uniqueSuffix()}`;
    const person = await client.createPerson(name, "test");
    await client.logout();
    await client.login({ name, passwd: "test" });

    // Find a conference to join (Test Conference from fixture)
    const allBefore = await client.getMemberships();
    const beforeCount = allBefore.memberships.length;

    const targetConfNo = testConferenceConfNo;

    // Add membership
    await client.addMembership(targetConfNo);

    const allAfter = await client.getMemberships();
    expect(allAfter.memberships.length).toBe(beforeCount + 1);
    const added = allAfter.memberships.find(
      (m: any) => m.conference.conf_no === targetConfNo
    );
    expect(added).toBeTruthy();

    // Delete membership
    await client.deleteMembership(targetConfNo);

    const allFinal = await client.getMemberships();
    expect(allFinal.memberships.length).toBe(beforeCount);
    const deleted = allFinal.memberships.find(
      (m: any) => m.conference.conf_no === targetConfNo
    );
    expect(deleted).toBeUndefined();
  });

  it("should get memberships for another person", async () => {
    client = await createLoggedInClient();
    const anotherClient = await createLoggedInClient(ANOTHER_USER);
    const anotherPersNo = anotherClient.getPersNo();
    await safeDisconnect(anotherClient);

    const memberships = await client.getMembershipsForPerson(anotherPersNo);

    expect(Array.isArray(memberships.memberships)).toBe(true);
    expect(memberships.memberships.length).toBeGreaterThan(0);
  });

  it("should get a single membership for another person", async () => {
    client = await createLoggedInClient();
    const anotherClient = await createLoggedInClient(ANOTHER_USER);
    const anotherPersNo = anotherClient.getPersNo();
    await safeDisconnect(anotherClient);

    const all = await client.getMembershipsForPerson(anotherPersNo);
    const confNo = all.memberships[0].conference.conf_no;

    const membership = await client.getMembershipForPerson(
      anotherPersNo,
      confNo
    );

    expect(membership.conference.conf_no).toBe(confNo);
  });

  it("should get membership unread for another person", async () => {
    client = await createLoggedInClient();
    const anotherClient = await createLoggedInClient(ANOTHER_USER);
    const anotherPersNo = anotherClient.getPersNo();
    await safeDisconnect(anotherClient);

    const all = await client.getMembershipsForPerson(anotherPersNo);
    const confNo = all.memberships[0].conference.conf_no;

    const unread = await client.getMembershipUnreadForPerson(
      anotherPersNo,
      confNo
    );

    expect(unread).toHaveProperty("no_of_unread");
    expect(unread.conf_no).toBe(confNo);
  });

  it("should get all unread counts for another person", async () => {
    client = await createLoggedInClient();
    const anotherClient = await createLoggedInClient(ANOTHER_USER);
    const anotherPersNo = anotherClient.getPersNo();
    await safeDisconnect(anotherClient);

    const unreads =
      await client.getMembershipUnreadsForPerson(anotherPersNo);

    expect(Array.isArray(unreads)).toBe(true);
  });

  it("should limit memberships with noOfMemberships option", async () => {
    client = await createLoggedInClient();

    const all = await client.getMemberships();
    expect(all.memberships.length).toBeGreaterThan(1);

    const limited = await client.getMemberships({ noOfMemberships: 1 });

    expect(limited.memberships.length).toBe(1);
  });

  it("should filter only unread memberships with unread option", async () => {
    client = await createLoggedInClient();

    // First set all memberships to 0 unread
    const all = await client.getMemberships();
    for (const m of all.memberships) {
      await client.setNumberOfUnreadTexts(m.conference.conf_no, 0);
    }

    const unreadOnly = await client.getMemberships({ unread: true });

    expect(Array.isArray(unreadOnly.memberships)).toBe(true);
    expect(unreadOnly.memberships.length).toBe(0);
  });

  it("should paginate memberships with first option", async () => {
    client = await createLoggedInClient();

    const all = await client.getMemberships();
    expect(all.memberships.length).toBeGreaterThan(1);

    const page = await client.getMemberships({ first: 1, noOfMemberships: 1 });

    expect(page.memberships.length).toBe(1);
    // The membership at first=1 should be different from the one at first=0
    const firstPage = await client.getMemberships({
      first: 0,
      noOfMemberships: 1,
    });
    expect(page.memberships[0].conference.conf_no).not.toBe(
      firstPage.memberships[0].conference.conf_no
    );
  });

  it("should add and delete membership for another person", async () => {
    client = await createLoggedInClient();

    // Create a fresh person
    const name = `MbrForUser ${uniqueSuffix()}`;
    const person = await client.createPerson(name, "test");
    const persNo = person.pers_no;

    const targetConfNo = testConferenceConfNo;

    // Add membership for the other person
    await client.addMembershipForPerson(persNo, targetConfNo);

    const after = await client.getMembershipsForPerson(persNo);
    const added = after.memberships.find(
      (m: any) => m.conference.conf_no === targetConfNo
    );
    expect(added).toBeTruthy();

    // Delete membership for the other person
    await client.deleteMembershipForPerson(persNo, targetConfNo);

    const final = await client.getMembershipsForPerson(persNo);
    const deleted = final.memberships.find(
      (m: any) => m.conference.conf_no === targetConfNo
    );
    expect(deleted).toBeUndefined();
  });
});
