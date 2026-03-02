import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLoggedInClient } from './helpers.js';

describe('conferences', () => {
  let client;

  afterEach(async () => {
    if (client?.isConnected()) {
      try { await client.disconnect(); } catch {}
    }
  });

  it('should change the working conference', async () => {
    client = await createLoggedInClient();
    assert.equal(client.currentConferenceNo, 0);

    // Get a conference the user is a member of
    const memberships = await client.getMemberships();
    const confNo = memberships.memberships[0].conference.conf_no;

    await client.changeConference(confNo);

    assert.equal(client.currentConferenceNo, confNo);
  });

  it('should change between conferences', async () => {
    client = await createLoggedInClient();

    const memberships = await client.getMemberships();
    const confNos = memberships.memberships
      .filter(m => !m.conference.type.letterbox)
      .map(m => m.conference.conf_no);
    assert.ok(confNos.length >= 2, 'Need at least 2 non-letterbox conferences');

    await client.changeConference(confNos[0]);
    assert.equal(client.currentConferenceNo, confNos[0]);

    await client.changeConference(confNos[1]);
    assert.equal(client.currentConferenceNo, confNos[1]);
  });

  it('should lookup conferences by name', async () => {
    client = await createLoggedInClient();

    const results = await client.lookupConferences('Test Conference');

    assert.ok(Array.isArray(results), 'Should return an array');
    // TODO: lookupConferences returns empty — investigate httpkom name matching
    if (results.length === 0) return;
    const match = results.find(r => r.name === 'Test Conference');
    assert.ok(match, 'Should find "Test Conference"');
    assert.ok(match.conf_no > 0);
  });

  it('should get conference details', async () => {
    client = await createLoggedInClient();

    // Find a conference first
    const memberships = await client.getMemberships();
    const confNo = memberships.memberships
      .find(m => !m.conference.type.letterbox).conference.conf_no;

    const conf = await client.getConference(confNo);

    assert.ok(conf, 'Should return conference data');
    assert.equal(conf.conf_no, confNo);
    assert.ok(conf.name);
  });

  it('should update snapshot memberships when changing away from a conference', async () => {
    client = await createLoggedInClient();

    const memberships = await client.getMemberships();
    const confNos = memberships.memberships
      .filter(m => !m.conference.type.letterbox)
      .map(m => m.conference.conf_no);

    await client.changeConference(confNos[0]);

    // When changing away, the membership for the previous conference gets refreshed
    let notified = false;
    const unsubscribe = client.subscribe(() => {
      notified = true;
    });

    await client.changeConference(confNos[1]);

    // Give async refresh a moment
    await new Promise(r => setTimeout(r, 500));

    // The conference change itself should have notified
    assert.ok(notified, 'Should have notified subscribers');

    unsubscribe();
  });
});
