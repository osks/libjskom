import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, createLoggedInClient, TEST_USER, ANOTHER_USER } from './helpers.js';

const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

describe('memberships', () => {
  let client;

  afterEach(async () => {
    if (client?.isConnected()) {
      try { await client.disconnect(); } catch {}
    }
  });

  it('should get memberships for logged-in user', async () => {
    client = await createLoggedInClient();

    const memberships = await client.getMemberships();

    assert.ok(Array.isArray(memberships.memberships));
    assert.ok(memberships.memberships.length > 0, 'Test User should have memberships');
  });

  it('should get a single membership', async () => {
    client = await createLoggedInClient();

    const all = await client.getMemberships();
    const confNo = all.memberships[0].conference.conf_no;

    const membership = await client.getMembership(confNo);

    assert.equal(membership.conference.conf_no, confNo);
    assert.ok(membership.priority !== undefined);
  });

  it('should get membership unread for a conference', async () => {
    client = await createLoggedInClient();

    const memberships = await client.getMemberships();
    const confNo = memberships.memberships[0].conference.conf_no;

    const unread = await client.getMembershipUnread(confNo);

    assert.ok(unread !== undefined);
    assert.ok('no_of_unread' in unread);
    assert.equal(unread.conf_no, confNo);
  });

  it('should get all membership unread counts', async () => {
    client = await createLoggedInClient();

    const unreads = await client.getMembershipUnreads();

    assert.ok(Array.isArray(unreads));
  });

  it('should set number of unread texts', async () => {
    client = await createLoggedInClient();

    const memberships = await client.getMemberships();
    const confNo = memberships.memberships[0].conference.conf_no;

    await client.setNumberOfUnreadTexts(confNo, 0);

    const unread = await client.getMembershipUnread(confNo);
    assert.equal(unread.no_of_unread, 0);
  });

  it('should add and delete a membership', async () => {
    client = await createLoggedInClient();

    // Create a fresh person who only has their letterbox membership
    const name = `MbrUser ${uniqueSuffix()}`;
    const person = await client.createPerson(name, 'test');
    await client.logout();
    await client.login({ name, passwd: 'test' });

    // Find a conference to join (Test Conference from fixture)
    const allBefore = await client.getMemberships();
    const beforeCount = allBefore.memberships.length;

    // Get a conference conf_no that the new user isn't a member of
    // We know conf_no 8 = "Test Conference" from the fixture
    const targetConfNo = 8;

    // Add membership
    await client.addMembership(targetConfNo);

    const allAfter = await client.getMemberships();
    assert.equal(allAfter.memberships.length, beforeCount + 1);
    const added = allAfter.memberships.find(m => m.conference.conf_no === targetConfNo);
    assert.ok(added, 'Should find the newly added membership');

    // Delete membership
    await client.deleteMembership(targetConfNo);

    const allFinal = await client.getMemberships();
    assert.equal(allFinal.memberships.length, beforeCount);
    const deleted = allFinal.memberships.find(m => m.conference.conf_no === targetConfNo);
    assert.equal(deleted, undefined, 'Membership should be removed');
  });

  it('should get memberships for another person', async () => {
    client = await createLoggedInClient();
    const anotherClient = await createLoggedInClient(ANOTHER_USER);
    const anotherPersNo = anotherClient.getPersNo();
    await anotherClient.disconnect();

    const memberships = await client.getMembershipsForPerson(anotherPersNo);

    assert.ok(Array.isArray(memberships.memberships));
    assert.ok(memberships.memberships.length > 0);
  });

  it('should get a single membership for another person', async () => {
    client = await createLoggedInClient();
    const anotherClient = await createLoggedInClient(ANOTHER_USER);
    const anotherPersNo = anotherClient.getPersNo();
    await anotherClient.disconnect();

    const all = await client.getMembershipsForPerson(anotherPersNo);
    const confNo = all.memberships[0].conference.conf_no;

    const membership = await client.getMembershipForPerson(anotherPersNo, confNo);

    assert.equal(membership.conference.conf_no, confNo);
  });

  it('should get membership unread for another person', async () => {
    client = await createLoggedInClient();
    const anotherClient = await createLoggedInClient(ANOTHER_USER);
    const anotherPersNo = anotherClient.getPersNo();
    await anotherClient.disconnect();

    const all = await client.getMembershipsForPerson(anotherPersNo);
    const confNo = all.memberships[0].conference.conf_no;

    const unread = await client.getMembershipUnreadForPerson(anotherPersNo, confNo);

    assert.ok('no_of_unread' in unread);
    assert.equal(unread.conf_no, confNo);
  });

  it('should get all unread counts for another person', async () => {
    client = await createLoggedInClient();
    const anotherClient = await createLoggedInClient(ANOTHER_USER);
    const anotherPersNo = anotherClient.getPersNo();
    await anotherClient.disconnect();

    const unreads = await client.getMembershipUnreadsForPerson(anotherPersNo);

    assert.ok(Array.isArray(unreads));
  });

  it('should limit memberships with noOfMemberships option', async () => {
    client = await createLoggedInClient();

    const all = await client.getMemberships();
    assert.ok(all.memberships.length > 1, 'Need more than 1 membership for this test');

    const limited = await client.getMemberships({ noOfMemberships: 1 });

    assert.equal(limited.memberships.length, 1);
  });

  it('should filter only unread memberships with unread option', async () => {
    client = await createLoggedInClient();

    // First set all memberships to 0 unread
    const all = await client.getMemberships();
    for (const m of all.memberships) {
      await client.setNumberOfUnreadTexts(m.conference.conf_no, 0);
    }

    const unreadOnly = await client.getMemberships({ unread: true });

    assert.ok(Array.isArray(unreadOnly.memberships));
    assert.equal(unreadOnly.memberships.length, 0, 'Should have no unread memberships');
  });

  it('should paginate memberships with first option', async () => {
    client = await createLoggedInClient();

    const all = await client.getMemberships();
    assert.ok(all.memberships.length > 1, 'Need more than 1 membership for this test');

    const page = await client.getMemberships({ first: 1, noOfMemberships: 1 });

    assert.equal(page.memberships.length, 1);
    // The membership at first=1 should be different from the one at first=0
    const firstPage = await client.getMemberships({ first: 0, noOfMemberships: 1 });
    assert.notEqual(page.memberships[0].conference.conf_no, firstPage.memberships[0].conference.conf_no);
  });

  it('should add and delete membership for another person', async () => {
    client = await createLoggedInClient();

    // Create a fresh person
    const name = `MbrForUser ${uniqueSuffix()}`;
    const person = await client.createPerson(name, 'test');
    const persNo = person.pers_no;

    const targetConfNo = 8; // Test Conference

    // Add membership for the other person
    await client.addMembershipForPerson(persNo, targetConfNo);

    const after = await client.getMembershipsForPerson(persNo);
    const added = after.memberships.find(m => m.conference.conf_no === targetConfNo);
    assert.ok(added, 'Should find the newly added membership');

    // Delete membership for the other person
    await client.deleteMembershipForPerson(persNo, targetConfNo);

    const final = await client.getMembershipsForPerson(persNo);
    const deleted = final.memberships.find(m => m.conference.conf_no === targetConfNo);
    assert.equal(deleted, undefined, 'Membership should be removed');
  });
});
