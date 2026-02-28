import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, createLoggedInClient } from './helpers.js';

const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

describe('persons', () => {
  let client;

  afterEach(async () => {
    if (client?.isConnected()) {
      try { await client.disconnect(); } catch {}
    }
  });

  it('should create a new person', async () => {
    client = await createLoggedInClient();
    const name = `E2E User ${uniqueSuffix()}`;

    const person = await client.createPerson(name, 'newpass123');

    assert.ok(person.pers_no);
    assert.equal(person.pers_name, name);
  });

  it('should login as a newly created person', async () => {
    client = await createLoggedInClient();
    const name = `Login User ${uniqueSuffix()}`;
    await client.createPerson(name, 'loginpass');
    await client.logout();

    const person = await client.login({ name, passwd: 'loginpass' });

    assert.ok(person.pers_no);
    assert.equal(person.pers_name, name);
    assert.equal(client.isLoggedIn(), true);
  });

  it('should change password', async () => {
    client = await createLoggedInClient();
    const name = `PwdUser ${uniqueSuffix()}`;
    const person = await client.createPerson(name, 'oldpass');
    await client.logout();

    // Login as new user and change password
    await client.login({ name, passwd: 'oldpass' });
    await client.setPassword(person.pers_no, 'oldpass', 'newpass');
    await client.logout();

    // Old password should fail
    await assert.rejects(
      client.login({ name, passwd: 'oldpass' }),
    );

    // New password should work
    const loggedIn = await client.login({ name, passwd: 'newpass' });
    assert.equal(loggedIn.pers_no, person.pers_no);
  });
});
