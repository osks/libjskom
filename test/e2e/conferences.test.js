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

  it('should emit membership:changed when changing away from a conference', async () => {
    client = await createLoggedInClient();

    const memberships = await client.getMemberships();
    const confNos = memberships.memberships
      .filter(m => !m.conference.type.letterbox)
      .map(m => m.conference.conf_no);

    await client.changeConference(confNos[0]);

    const changedConfNos = [];
    client.on('jskom:membership:changed', (event, confNo) => {
      changedConfNos.push(confNo);
    });

    await client.changeConference(confNos[1]);

    assert.ok(changedConfNos.includes(confNos[0]),
      'Should emit membership:changed for the previous conference');
  });
});
