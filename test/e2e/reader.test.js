import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLoggedInClient,

  waitForMemberships,
  waitForReader,
  waitForCondition,
} from './helpers.js';

describe('reader', () => {
  let client;
  let readerConfNo;

  /**
   * Find the "Reader Test" conference conf_no from memberships.
   */
  async function getReaderTestConfNo(c) {
    const snap = c.getSnapshot();
    const m = snap.memberships.find(m => m.conference.name === 'Reader Test');
    assert.ok(m, 'Should find "Reader Test" membership');
    return m.conference.conf_no;
  }

  beforeEach(async () => {
    client = await createLoggedInClient();
    await waitForMemberships(client);
    readerConfNo = await getReaderTestConfNo(client);

    // Reset unreads so each test starts with fresh unread texts
    await client.setNumberOfUnreadTexts(readerConfNo, 100);

    // Wait for the membership state to reflect the unreads
    await waitForCondition(() => {
      const m = client.getSnapshot().memberships.find(
        m => m.conference.conf_no === readerConfNo
      );
      return m && m.no_of_unread > 0 && m.unread_texts.length > 0;
    });
  });

  afterEach(async () => {
    if (client?.isConnected()) {
      try { await client.disconnect(); } catch {}
    }
  });

  it('should set reader state after enterConference', async () => {
    await client.enterConference(readerConfNo);

    const reader = client.getSnapshot().reader;
    assert.ok(reader, 'Reader should be initialized');
    assert.equal(reader.confNo, readerConfNo);
    assert.ok(Array.isArray(reader.queue));
    assert.ok(reader.queue.length > 0, 'Queue should have unread texts');
  });

  it('should set currentConferenceNo after enterConference', async () => {
    await client.enterConference(readerConfNo);

    assert.equal(client.currentConferenceNo, readerConfNo);
  });

  it('should advance through texts sequentially', async () => {
    await client.enterConference(readerConfNo);
    await waitForReader(client);

    const textNos = [];
    let textNo;
    while ((textNo = client.advance()) !== null) {
      textNos.push(textNo);
    }

    assert.ok(textNos.length > 0, 'Should have advanced through at least one text');
    // All text numbers should be unique
    assert.equal(new Set(textNos).size, textNos.length, 'No duplicate texts');
  });

  it('should return null when queue is exhausted', async () => {
    await client.enterConference(readerConfNo);
    await waitForReader(client);

    // Drain the queue
    while (client.advance() !== null) {}

    assert.equal(client.advance(), null);
    assert.equal(client.advance(), null);
  });

  it('should mark texts as read when advancing', async () => {
    await client.enterConference(readerConfNo);
    await waitForReader(client);

    const membershipBefore = client.getSnapshot().memberships.find(
      m => m.conference.conf_no === readerConfNo
    );
    const unreadBefore = membershipBefore.no_of_unread;
    assert.ok(unreadBefore > 0, 'Should have unreads to test with');

    // Advance once
    const textNo = client.advance();
    assert.ok(textNo !== null, 'Should get a text to advance to');

    // Give the optimistic update a tick
    await new Promise(r => setTimeout(r, 50));

    const membershipAfter = client.getSnapshot().memberships.find(
      m => m.conference.conf_no === readerConfNo
    );
    assert.ok(
      membershipAfter.no_of_unread < unreadBefore,
      'Unread count should decrease after advance'
    );
  });

  it('should order texts in DFS with footnotes before comments', async () => {
    await client.enterConference(readerConfNo);
    await waitForReader(client);

    // Collect all text subjects in reader order
    const subjects = [];
    let textNo;
    while ((textNo = client.advance()) !== null) {
      const text = await client.getText(textNo);
      subjects.push(text.subject);
    }

    // Expected DFS order:
    // Root A -> Footnote A -> Reply A1 -> Reply A1 Deep -> Reply A2 -> Root B
    const expected = [
      'Root A',
      'Footnote A',
      'Reply A1',
      'Reply A1 Deep',
      'Reply A2',
      'Root B',
    ];

    assert.deepEqual(subjects, expected, 'Texts should be in DFS order');
  });

  it('should return pending texts first from advance()', async () => {
    await client.enterConference(readerConfNo);
    await waitForReader(client);

    // Grab text 1 ("Welcome" from Test Conference) as a "show" target
    await client.getText(1);
    client.showText(1);

    // advance() should return the pending text first
    const next = client.advance();
    assert.equal(next, 1, 'Should return the shown text first');
  });

  it('should move to next unread conference with nextUnreadConference', async () => {
    // Also reset unreads on other conferences
    const memberships = client.getSnapshot().memberships;
    for (const m of memberships) {
      if (!m.conference.type.letterbox && m.conference.conf_no !== readerConfNo) {
        await client.setNumberOfUnreadTexts(m.conference.conf_no, 100);
      }
    }

    // Wait for at least 2 conferences with unreads
    await waitForCondition(() => {
      const snap = client.getSnapshot();
      return snap.memberships.filter(
        m => m.no_of_unread > 0 && !m.conference.type.letterbox
      ).length >= 2;
    });

    // Enter the first conference
    await client.enterConference(readerConfNo);
    await waitForReader(client);

    // Move to next unread (enterConference is fire-and-forget inside)
    const nextConfNo = client.nextUnreadConference();
    assert.ok(nextConfNo !== null, 'Should find another unread conference');
    assert.notEqual(nextConfNo, readerConfNo);

    // Wait for the background enterConference to complete before cleanup
    await waitForCondition(() => {
      const reader = client.getSnapshot().reader;
      return reader && reader.confNo === nextConfNo;
    });
  });

  it('should return null from nextUnreadConference when no unreads', async () => {
    // Set all conferences to 0 unread
    const memberships = client.getSnapshot().memberships;
    for (const m of memberships) {
      await client.setNumberOfUnreadTexts(m.conference.conf_no, 0);
    }

    // Wait for memberships to reflect the changes
    await waitForCondition(() => {
      const snap = client.getSnapshot();
      return snap.memberships.every(m => m.no_of_unread === 0);
    });

    // Enter any conference
    const confNo = memberships.find(m => !m.conference.type.letterbox)?.conference.conf_no;
    if (!confNo) return;
    await client.enterConference(confNo);

    const result = client.nextUnreadConference();
    assert.equal(result, null, 'Should return null when no conferences have unreads');
  });

  it('should clear reader and set unread to 0 on skipConference', async () => {
    await client.enterConference(readerConfNo);
    await waitForReader(client);

    await client.skipConference();

    const snap = client.getSnapshot();
    assert.equal(snap.reader, null, 'Reader should be cleared');

    const membership = snap.memberships.find(
      m => m.conference.conf_no === readerConfNo
    );
    assert.equal(membership.no_of_unread, 0, 'Unread count should be 0');
  });

  it('should cancel previous build when entering conference again', async () => {
    // Enter once
    await client.enterConference(readerConfNo);

    // Enter again immediately (should cancel the first build)
    await client.enterConference(readerConfNo);
    await waitForReader(client);

    const reader = client.getSnapshot().reader;
    assert.ok(reader, 'Reader should exist');
    assert.equal(reader.confNo, readerConfNo);
    assert.equal(reader.building, false, 'Should finish building');
  });
});
