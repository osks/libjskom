import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, createLoggedInClient, TEST_USER, HTTPKOM_BASE_URL, LYSKOM_SERVER_ID } from './helpers.js';
import { HttpkomClient } from '../../src/HttpkomClient.js';

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
    const restored = new HttpkomClient({
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

  it('should emit events on login and logout', async () => {
    client = createClient();
    await client.connect();

    const events = [];
    client.on('jskom:session:changed', (event) => {
      events.push('session:changed');
    });
    client.on('jskom:connection:changed', (event) => {
      events.push('connection:changed');
    });

    await client.login({ name: TEST_USER.name, passwd: TEST_USER.passwd });
    assert.ok(events.includes('session:changed'), 'login should emit session:changed');
    assert.ok(events.includes('connection:changed'), 'login should emit connection:changed');

    events.length = 0;
    await client.logout();
    assert.ok(events.includes('session:changed'), 'logout should emit session:changed');
  });

  it('should unsubscribe event listeners', async () => {
    client = createClient();
    await client.connect();

    let called = 0;
    const unsubscribe = client.on('jskom:session:changed', () => { called++; });

    await client.login({ name: TEST_USER.name, passwd: TEST_USER.passwd });
    assert.equal(called, 1);

    unsubscribe();

    await client.logout();
    assert.equal(called, 1, 'Should not be called after unsubscribe');
  });
});
