import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLoggedInClient, waitForMemberships } from './helpers.js';

describe('texts', () => {
  let client;

  afterEach(async () => {
    if (client?.isConnected()) {
      try { await client.disconnect(); } catch {}
    }
  });

  it('should fetch a known text with expected fields', async () => {
    client = await createLoggedInClient();

    // Text 1 is "Welcome" from fixture
    const text = await client.getText(1);

    assert.equal(text.text_no, 1);
    assert.equal(text.subject, 'Welcome');
    assert.equal(text.body, 'Welcome to the test conference!');
    assert.ok(text.author);
    assert.ok(text.author.pers_no > 0);
    assert.ok(Array.isArray(text.recipient_list));
    assert.ok(text.recipient_list.length > 0);
    assert.ok(Array.isArray(text.comment_to_list));
    assert.ok(Array.isArray(text.comment_in_list));
  });

  it('should return the same cached object on second getText call', async () => {
    client = await createLoggedInClient();

    const text1 = await client.getText(1);
    const text2 = await client.getText(1);

    assert.equal(text1, text2, 'Should be the exact same object reference');
  });

  it('should create a new text and fetch it back', async () => {
    client = await createLoggedInClient();

    // Get a conference to post in
    const memberships = await client.getMemberships();
    const confNo = memberships.memberships
      .find(m => !m.conference.type.letterbox).conference.conf_no;

    const result = await client.createText({
      subject: 'Created by test',
      body: 'This text was created in an e2e test.',
      recipientList: [{ type: 'to', recpt: { conf_no: confNo } }],
    });

    assert.ok(result.text_no > 0, 'Should return a text_no');

    const text = await client.getText(result.text_no);
    assert.equal(text.subject, 'Created by test');
    assert.equal(text.body, 'This text was created in an e2e test.');
  });

  it('should create a comment on an existing text', async () => {
    client = await createLoggedInClient();

    // Text 1 is "Welcome" — comment on it
    const parent = await client.getText(1);
    const confNo = parent.recipient_list[0].recpt.conf_no;

    const result = await client.createText({
      subject: 'Test comment',
      body: 'This is a comment.',
      recipientList: [{ type: 'to', recpt: { conf_no: confNo } }],
      commentToList: [{ type: 'comment', text_no: parent.text_no }],
    });

    const comment = await client.getText(result.text_no);
    assert.ok(
      comment.comment_to_list.some(c => c.text_no === parent.text_no),
      'Comment should reference parent text'
    );

    // Invalidate parent to get fresh data with the new comment_in_list
    client.invalidateText(parent.text_no);
    const refreshedParent = await client.getText(parent.text_no);
    assert.ok(
      refreshedParent.comment_in_list.some(c => c.text_no === result.text_no),
      'Parent should list the new comment in comment_in_list'
    );
  });

  it('should mark a text as read and decrease unread count', async () => {
    client = await createLoggedInClient();
    await waitForMemberships(client);

    // Find a conference with unreads
    const snap = client.getSnapshot();
    const membership = snap.memberships.find(m => m.no_of_unread > 0);
    if (!membership) {
      // No unreads available — skip gracefully
      return;
    }

    const confNo = membership.conference.conf_no;
    const unreadBefore = membership.no_of_unread;
    const textNo = membership.unread_texts[0];

    // Fetch text into cache first (markAsRead uses cached text for local update)
    await client.getText(textNo);
    await client.markAsRead(textNo);

    const unreadAfter = client.getSnapshot().memberships
      .find(m => m.conference.conf_no === confNo);
    assert.ok(unreadAfter.no_of_unread < unreadBefore, 'Unread count should decrease');
  });

  it('should work with createReadMarking backward-compatible alias', async () => {
    client = await createLoggedInClient();

    const text = await client.getText(1);
    // Should not throw
    await client.createReadMarking(text.text_no, text);
  });

  it('should work with deleteReadMarking', async () => {
    client = await createLoggedInClient();

    const text = await client.getText(1);
    // Should not throw
    await client.deleteReadMarking(text.text_no, text);
  });

  it('should invalidate a cached text', async () => {
    client = await createLoggedInClient();

    const text1 = await client.getText(1);
    client.invalidateText(1);

    // After invalidation, snapshot should not contain the text
    const snap = client.getSnapshot();
    assert.equal(snap.texts.has(1), false, 'Text should be removed from snapshot after invalidation');

    // Fetching again should return fresh data (different object)
    const text2 = await client.getText(1);
    assert.notEqual(text1, text2, 'Should be a different object after invalidation');
    assert.equal(text2.text_no, 1);
  });

  it('should populate snapshot.texts Map', async () => {
    client = await createLoggedInClient();

    const snapBefore = client.getSnapshot();
    assert.equal(snapBefore.texts.size, 0, 'Texts map starts empty');

    await client.getText(1);

    const snapAfter = client.getSnapshot();
    assert.ok(snapAfter.texts.has(1), 'Texts map should contain fetched text');
    assert.equal(snapAfter.texts.get(1).text_no, 1);
  });
});
