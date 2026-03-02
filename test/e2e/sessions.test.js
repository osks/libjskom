import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, createLoggedInClient, TEST_USER, HTTPKOM_BASE_URL, LYSKOM_SERVER_ID } from './helpers.js';
import { LyskomClient } from '../../dist/index.js';

describe('sessions', () => {
  let client;

  afterEach(async () => {
    if (client?.isConnected()) {
      try { await client.disconnect(); } catch {}
    }
  });

  it('should connect and create a session', async () => {
    client = createClient();
    assert.equal(client.isConnected(), false);

    const session = await client.connect();

    assert.equal(client.isConnected(), true);
    assert.ok(session.session_no);
  });

  it('should login with valid credentials', async () => {
    client = createClient();
    await client.connect();
    assert.equal(client.isLoggedIn(), false);

    const person = await client.login({ name: TEST_USER.name, passwd: TEST_USER.passwd });

    assert.equal(client.isLoggedIn(), true);
    assert.ok(person.pers_no);
    assert.equal(person.pers_name, TEST_USER.name);
  });

  it('should login by persNo', async () => {
    // First login by name to discover the persNo
    client = await createLoggedInClient();
    const persNo = client.getPersNo();
    await client.logout();

    const person = await client.login({ persNo, passwd: TEST_USER.passwd });

    assert.equal(client.isLoggedIn(), true);
    assert.equal(person.pers_no, persNo);
  });

  it('should logout', async () => {
    client = createClient();
    await client.connect();
    await client.login({ name: TEST_USER.name, passwd: TEST_USER.passwd });
    assert.equal(client.isLoggedIn(), true);

    await client.logout();

    assert.equal(client.isLoggedIn(), false);
    assert.equal(client.isConnected(), true);
  });

  it('should disconnect and destroy the session', async () => {
    client = createClient();
    await client.connect();

    await client.disconnect();

    assert.equal(client.isConnected(), false);
    assert.equal(client.isLoggedIn(), false);
    client = null;
  });

  it('should reject login with wrong password', async () => {
    client = createClient();
    await client.connect();

    await assert.rejects(
      client.login({ name: TEST_USER.name, passwd: 'wrongpassword' }),
    );
  });

  it('should return persNo when logged in and null when not', async () => {
    client = createClient();
    await client.connect();
    assert.equal(client.getPersNo(), null);

    await client.login({ name: TEST_USER.name, passwd: TEST_USER.passwd });

    assert.equal(typeof client.getPersNo(), 'number');
    assert.ok(client.getPersNo() > 0);
  });

  it('should serialize and restore connection with toObject/fromObject', async () => {
    client = await createLoggedInClient();
    const persNo = client.getPersNo();

    const obj = client.toObject();
    assert.ok(obj.id);
    assert.ok(obj.httpkomId);
    assert.ok(obj.session);

    // Restore into a new client
    const restored = LyskomClient.fromObject({
      ...obj,
      httpkomServer: HTTPKOM_BASE_URL,
    });

    assert.equal(restored.isConnected(), true);
    assert.equal(restored.isLoggedIn(), true);
    assert.equal(restored.getPersNo(), persNo);

    // Disconnect the restored client, original is now invalid
    await restored.disconnect();
    client = null;
  });

  it('should get available LysKOM servers', async () => {
    client = createClient();

    const servers = await client.getLyskomServers();

    assert.equal(typeof servers, 'object');
    assert.ok(servers[LYSKOM_SERVER_ID], 'Should find the default server');
    assert.equal(servers[LYSKOM_SERVER_ID].id, LYSKOM_SERVER_ID);
  });

  it('should notify subscribers on login and logout', async () => {
    client = createClient();
    await client.connect();

    let notifyCount = 0;
    const unsubscribe = client.subscribe(() => {
      notifyCount++;
    });

    const prevCount = notifyCount;
    await client.login({ name: TEST_USER.name, passwd: TEST_USER.passwd });
    assert.ok(notifyCount > prevCount, 'login should notify subscribers');

    const snap = client.getSnapshot();
    assert.equal(snap.isLoggedIn, true);
    assert.ok(snap.persNo > 0);

    const preLogout = notifyCount;
    await client.logout();
    assert.ok(notifyCount > preLogout, 'logout should notify subscribers');

    const snapAfter = client.getSnapshot();
    assert.equal(snapAfter.isLoggedIn, false);
    assert.equal(snapAfter.persNo, null);

    unsubscribe();
  });

  it('should unsubscribe listeners', async () => {
    client = createClient();
    await client.connect();

    let called = 0;
    const unsubscribe = client.subscribe(() => { called++; });

    await client.login({ name: TEST_USER.name, passwd: TEST_USER.passwd });
    const afterLogin = called;
    assert.ok(afterLogin > 0);

    unsubscribe();

    await client.logout();
    assert.equal(called, afterLogin, 'Should not be called after unsubscribe');
  });
});
