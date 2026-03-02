import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLoggedInClient } from './helpers.js';

describe('marks', () => {
  let client;
  let marksAvailable = true;

  before(async () => {
    const c = await createLoggedInClient();
    try {
      await c.getMarks();
    } catch {
      marksAvailable = false;
    }
    try { await c.disconnect(); } catch {}

  });

  afterEach(async () => {
    if (client?.isConnected()) {
      try {
        if (marksAvailable) {
          const marks = await client.getMarks();
          for (const m of marks) {
            await client.deleteMark(m.text_no);
          }
        }
      } catch {}
      try { await client.disconnect(); } catch {}
    }
  });

  it('should get marks (initially empty or known state)', async (t) => {
    if (!marksAvailable) return t.skip('marks API not available');
    client = await createLoggedInClient();

    const marks = await client.getMarks();

    assert.ok(Array.isArray(marks));
  });

  it('should create a mark and find it in getMarks', async (t) => {
    if (!marksAvailable) return t.skip('marks API not available');
    client = await createLoggedInClient();

    await client.createMark(1, 100);

    const marks = await client.getMarks();
    const found = marks.find(m => m.text_no === 1);
    assert.ok(found, 'Mark should exist');
    assert.equal(found.type, 100);
  });

  it('should optimistically update snapshot on createMark', async (t) => {
    if (!marksAvailable) return t.skip('marks API not available');
    client = await createLoggedInClient();

    // Clear marks state first
    await client.getMarks();

    await client.createMark(1, 50);

    const snap = client.getSnapshot();
    const found = snap.marks.find(m => m.text_no === 1);
    assert.ok(found, 'Mark should be in snapshot');
    assert.equal(found.type, 50);
  });

  it('should delete a mark and verify it is gone', async (t) => {
    if (!marksAvailable) return t.skip('marks API not available');
    client = await createLoggedInClient();

    await client.createMark(1, 100);

    let marks = await client.getMarks();
    assert.ok(marks.find(m => m.text_no === 1));

    await client.deleteMark(1);

    marks = await client.getMarks();
    assert.equal(marks.find(m => m.text_no === 1), undefined, 'Mark should be deleted');
  });

  it('should optimistically remove from snapshot on deleteMark', async (t) => {
    if (!marksAvailable) return t.skip('marks API not available');
    client = await createLoggedInClient();

    // Wait for background getMarks() from login() to settle
    await new Promise(r => setTimeout(r, 200));

    await client.createMark(1, 100);

    let snap = client.getSnapshot();
    assert.ok(snap.marks.find(m => m.text_no === 1), 'Mark should be in snapshot after create');

    await client.deleteMark(1);

    snap = client.getSnapshot();
    assert.equal(snap.marks.find(m => m.text_no === 1), undefined, 'Mark should be removed from snapshot');
  });

  it('should update an existing mark (change type)', async (t) => {
    if (!marksAvailable) return t.skip('marks API not available');
    client = await createLoggedInClient();

    await client.createMark(1, 100);

    // Update the same text with a different type
    await client.createMark(1, 200);

    const marks = await client.getMarks();
    const found = marks.find(m => m.text_no === 1);
    assert.ok(found, 'Mark should still exist');
    assert.equal(found.type, 200, 'Type should be updated');

    const all = marks.filter(m => m.text_no === 1);
    assert.equal(all.length, 1, 'Should have exactly one mark for the text');
  });
});
