import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../../dist/Reader.js';

// --- Test helpers ---

function makeText(textNo, commentIn = []) {
  return {
    text_no: textNo,
    subject: '',
    body: '',
    content_type: 'text/plain',
    author: { pers_no: 1, pers_name: 'Test' },
    creation_time: '2024-01-01T00:00:00Z',
    no_of_marks: 0,
    recipient_list: [
      { type: 'to', recpt: { conf_no: 1, name: 'Conf 1' }, loc_no: 1 },
    ],
    comment_to_list: [],
    comment_in_list: commentIn.map(({ textNo: tno, type = 'comment' }) => ({
      text_no: tno,
      type,
      author: { pers_no: 1, pers_name: 'Test' },
    })),
    aux_items: [],
  };
}

function makeMembership(confNo, unreadTexts, priority = 100) {
  return {
    conference: {
      conf_no: confNo,
      name: `Conf ${confNo}`,
      highest_local_no: 0,
      nice: 77,
      type: {
        rd_prot: 0,
        original: 0,
        secret: 0,
        letterbox: 0,
        allow_anonymous: 0,
        forbid_secret: 0,
        reserved2: 0,
        reserved3: 0,
      },
    },
    pers_no: 1,
    priority,
    position: 0,
    added_at: '2024-01-01T00:00:00Z',
    last_time_read: '2024-01-01T00:00:00Z',
    added_by: { pers_no: 1, pers_name: 'Test' },
    type: {
      invitation: 0,
      passive: 0,
      secret: 0,
      passive_message_invert: 0,
    },
    no_of_unread: unreadTexts.length,
    unread_texts: [...unreadTexts],
  };
}

function createReader(texts, memberships) {
  const textMap = new Map(texts.map((t) => [t.text_no, t]));
  return new Reader(
    (no) => Promise.resolve(textMap.get(no)),
    () => memberships
  );
}

function markAsRead(memberships, textNo) {
  for (let i = 0; i < memberships.length; i++) {
    const m = memberships[i];
    const idx = m.unread_texts.indexOf(textNo);
    if (idx !== -1) {
      memberships[i] = {
        ...m,
        no_of_unread: m.no_of_unread - 1,
        unread_texts: m.unread_texts.filter((t) => t !== textNo),
      };
    }
  }
}

// --- Tests ---

describe('Reader', () => {
  // === Basic reading ===

  describe('basic reading', () => {
    it('advance() auto-enters first conference when none entered', async () => {
      const memberships = [makeMembership(1, [100, 101])];
      const texts = [makeText(100), makeText(101)];
      const reader = createReader(texts, memberships);
      const result = await reader.advance();
      assert.equal(result.textNo, 100);
      assert.equal(reader.state.currentConfNo, 1);
    });

    it('advance() returns texts in order within a conference', async () => {
      const memberships = [makeMembership(1, [100, 101, 102])];
      const texts = [makeText(100), makeText(101), makeText(102)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      const r1 = await reader.advance();
      assert.equal(r1.textNo, 100);
      markAsRead(memberships, 100);

      const r2 = await reader.advance();
      assert.equal(r2.textNo, 101);
      markAsRead(memberships, 101);

      const r3 = await reader.advance();
      assert.equal(r3.textNo, 102);
      markAsRead(memberships, 102);
    });

    it('advance() returns null when all conferences exhausted', async () => {
      const memberships = [makeMembership(1, [100])];
      const texts = [makeText(100)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      await reader.advance();
      markAsRead(memberships, 100);

      const result = await reader.advance();
      assert.equal(result, null);
    });

    it('enterConference sets currentConfNo', () => {
      const memberships = [makeMembership(1, [100])];
      const texts = [makeText(100)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);
      assert.equal(reader.state.currentConfNo, 1);
    });

    it('empty conference — advance returns null', async () => {
      const memberships = [makeMembership(1, [])];
      const texts = [];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);
      const result = await reader.advance();
      assert.equal(result, null);
    });
  });

  // === DFS ordering ===

  describe('DFS ordering', () => {
    it('linear chain: 100→101→102 produces DFS order', async () => {
      const memberships = [makeMembership(1, [100, 101, 102])];
      const texts = [
        makeText(100, [{ textNo: 101 }]),
        makeText(101, [{ textNo: 102 }]),
        makeText(102),
      ];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      const r1 = await reader.advance();
      assert.equal(r1.textNo, 100);
      markAsRead(memberships, 100);

      const r2 = await reader.advance();
      assert.equal(r2.textNo, 101);
      assert.equal(r2.type, 'COMM-IN');
      markAsRead(memberships, 101);

      const r3 = await reader.advance();
      assert.equal(r3.textNo, 102);
      assert.equal(r3.type, 'COMM-IN');
      markAsRead(memberships, 102);

      assert.equal(await reader.advance(), null);
    });

    it('branching: 100→[101,102], 101→[103] produces DFS order', async () => {
      const memberships = [makeMembership(1, [100, 101, 102, 103])];
      const texts = [
        makeText(100, [{ textNo: 101 }, { textNo: 102 }]),
        makeText(101, [{ textNo: 103 }]),
        makeText(102),
        makeText(103),
      ];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      const r1 = await reader.advance();
      assert.equal(r1.textNo, 100);
      markAsRead(memberships, 100);

      const r2 = await reader.advance();
      assert.equal(r2.textNo, 101);
      markAsRead(memberships, 101);

      const r3 = await reader.advance();
      assert.equal(r3.textNo, 103);
      markAsRead(memberships, 103);

      const r4 = await reader.advance();
      assert.equal(r4.textNo, 102);
      markAsRead(memberships, 102);

      assert.equal(await reader.advance(), null);
    });

    it('deep tree: 100→101→102→103 produces DFS order', async () => {
      const memberships = [makeMembership(1, [100, 101, 102, 103])];
      const texts = [
        makeText(100, [{ textNo: 101 }]),
        makeText(101, [{ textNo: 102 }]),
        makeText(102, [{ textNo: 103 }]),
        makeText(103),
      ];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      const order = [];
      let r;
      while ((r = await reader.advance()) !== null) {
        order.push(r.textNo);
        markAsRead(memberships, r.textNo);
      }
      assert.deepEqual(order, [100, 101, 102, 103]);
    });

    it('wide tree: 100→[101,102,103] produces DFS order', async () => {
      const memberships = [makeMembership(1, [100, 101, 102, 103])];
      const texts = [
        makeText(100, [{ textNo: 101 }, { textNo: 102 }, { textNo: 103 }]),
        makeText(101),
        makeText(102),
        makeText(103),
      ];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      const order = [];
      let r;
      while ((r = await reader.advance()) !== null) {
        order.push(r.textNo);
        markAsRead(memberships, r.textNo);
      }
      assert.deepEqual(order, [100, 101, 102, 103]);
    });
  });

  // === Footnote ordering ===

  describe('footnote ordering', () => {
    it('footnotes are read before comments for the same parent', async () => {
      const memberships = [makeMembership(1, [100, 101, 105])];
      const texts = [
        makeText(100, [
          { textNo: 101, type: 'comment' },
          { textNo: 105, type: 'footnote' },
        ]),
        makeText(101),
        makeText(105),
      ];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      const r1 = await reader.advance();
      assert.equal(r1.textNo, 100);
      markAsRead(memberships, 100);

      const r2 = await reader.advance();
      assert.equal(r2.textNo, 105);
      assert.equal(r2.type, 'FOOTN-IN');
      markAsRead(memberships, 105);

      const r3 = await reader.advance();
      assert.equal(r3.textNo, 101);
      assert.equal(r3.type, 'COMM-IN');
      markAsRead(memberships, 101);

      assert.equal(await reader.advance(), null);
    });
  });

  // === Duplicate prevention ===

  describe('duplicate prevention', () => {
    it('text consumed via COMM-IN is skipped in CONF entry', async () => {
      const memberships = [makeMembership(1, [100, 101])];
      const texts = [
        makeText(100, [{ textNo: 101 }]),
        makeText(101),
      ];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      const r1 = await reader.advance();
      assert.equal(r1.textNo, 100);
      markAsRead(memberships, 100);

      const r2 = await reader.advance();
      assert.equal(r2.textNo, 101);
      assert.equal(r2.type, 'COMM-IN');
      markAsRead(memberships, 101);

      // 101 was already read via COMM-IN, should not appear again from CONF
      assert.equal(await reader.advance(), null);
    });

    it('cross-conference duplicate: text in two conferences', async () => {
      const memberships = [
        makeMembership(1, [100]),
        makeMembership(2, [100]),
      ];
      const texts = [makeText(100)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      const r1 = await reader.advance();
      assert.equal(r1.textNo, 100);
      // Mark as read in both conferences
      markAsRead(memberships, 100);

      // Auto-transition to conf 2, but text 100 already read → null
      assert.equal(await reader.advance(), null);
    });

    it('cross-conference duplicate via explicit enter', async () => {
      const memberships = [
        makeMembership(1, [100]),
        makeMembership(2, [100]),
      ];
      const texts = [makeText(100)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      const r1 = await reader.advance();
      assert.equal(r1.textNo, 100);
      markAsRead(memberships, 100);

      // Explicit enter conference 2 — text 100 already read
      reader.enterConference(2);
      assert.equal(await reader.advance(), null);
    });
  });

  // === Conference transitions ===

  describe('conference transitions', () => {
    it('nextUnreadConference returns conf with unreads', () => {
      const memberships = [
        makeMembership(1, []),
        makeMembership(2, [200]),
      ];
      const reader = createReader([], memberships);
      assert.equal(reader.nextUnreadConference(), 2);
    });

    it('nextUnreadConference excludes current conference', () => {
      const memberships = [
        makeMembership(1, [100]),
        makeMembership(2, [200]),
      ];
      const reader = createReader([], memberships);
      reader.enterConference(1);
      assert.equal(reader.nextUnreadConference(), 2);
    });

    it('nextUnreadConference excludes skipped conferences', () => {
      const memberships = [
        makeMembership(1, [100]),
        makeMembership(2, [200]),
        makeMembership(3, [300]),
      ];
      const reader = createReader([], memberships);
      reader.enterConference(2);
      reader.skipConference();
      // Now conf 2 is skipped, conf 1 should be next
      assert.equal(reader.nextUnreadConference(), 1);
    });

    it('nextUnreadConference returns null when all read', () => {
      const memberships = [
        makeMembership(1, []),
        makeMembership(2, []),
      ];
      const reader = createReader([], memberships);
      assert.equal(reader.nextUnreadConference(), null);
    });

    it('nextUnreadConference respects membership sort order', () => {
      // Memberships are pre-sorted by priority (highest first)
      const memberships = [
        makeMembership(1, [100], 200), // higher priority
        makeMembership(2, [200], 100), // lower priority
      ];
      const reader = createReader([], memberships);
      // Should pick first one with unreads in the list
      assert.equal(reader.nextUnreadConference(), 1);
    });
  });

  // === Skip conference ===

  describe('skip conference', () => {
    it('skipConference clears readingList entries for current conf', async () => {
      const memberships = [makeMembership(1, [100, 101])];
      const texts = [makeText(100), makeText(101)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);
      reader.skipConference();
      assert.equal(reader.state.readingList.length, 0);
    });

    it('skipConference adds to skippedConferences set', () => {
      const memberships = [
        makeMembership(1, [100]),
        makeMembership(2, [200]),
      ];
      const reader = createReader([], memberships);
      reader.enterConference(1);
      reader.skipConference();
      // Conference 1 is skipped, so nextUnreadConference won't return it
      assert.equal(reader.nextUnreadConference(), 2);
      // Even though conf 1 has unreads, it's skipped
      reader.enterConference(2);
      assert.equal(reader.nextUnreadConference(), null);
    });

    it('advance returns null after skip', async () => {
      const memberships = [makeMembership(1, [100, 101])];
      const texts = [makeText(100), makeText(101)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);
      reader.skipConference();
      assert.equal(await reader.advance(), null);
    });
  });

  // === showText (REVIEW) ===

  describe('showText', () => {
    it('showText works for already-read texts (bypasses isUnread)', async () => {
      const memberships = [makeMembership(1, [100])];
      const texts = [makeText(100), makeText(50)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      // Text 50 is NOT in any membership's unread_texts
      reader.showText(50);
      const r1 = await reader.advance();
      assert.equal(r1.textNo, 50);
      assert.equal(r1.type, 'REVIEW');
    });

    it('showText during conference reading — REVIEW consumed first', async () => {
      const memberships = [makeMembership(1, [100, 101])];
      const texts = [makeText(100), makeText(101), makeText(50)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      // Read first text
      const r1 = await reader.advance();
      assert.equal(r1.textNo, 100);
      markAsRead(memberships, 100);

      // User requests to see text 50 (already read)
      reader.showText(50);

      // Next advance should return the REVIEW text
      const r2 = await reader.advance();
      assert.equal(r2.textNo, 50);
      assert.equal(r2.type, 'REVIEW');

      // Then continue with conference
      const r3 = await reader.advance();
      assert.equal(r3.textNo, 101);
      assert.equal(r3.type, 'CONF');
    });
  });

  // === New unreads mid-session ===

  describe('new unreads mid-session', () => {
    it('CONF entry refreshes from memberships when textList exhausted', async () => {
      const memberships = [makeMembership(1, [100])];
      const texts = [makeText(100), makeText(101)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      const r1 = await reader.advance();
      assert.equal(r1.textNo, 100);
      markAsRead(memberships, 100);

      // Simulate polling: new text arrives
      memberships[0] = {
        ...memberships[0],
        no_of_unread: 1,
        unread_texts: [101],
      };

      const r2 = await reader.advance();
      assert.equal(r2.textNo, 101);
      markAsRead(memberships, 101);

      assert.equal(await reader.advance(), null);
    });
  });

  // === State access ===

  describe('state access', () => {
    it('reader.state exposes currentConfNo and readingList', () => {
      const memberships = [makeMembership(1, [100, 101])];
      const texts = [makeText(100), makeText(101)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      const s = reader.state;
      assert.equal(s.currentConfNo, 1);
      assert.equal(s.readingList.length, 1);
      assert.equal(s.readingList[0].type, 'CONF');
      assert.deepEqual(s.readingList[0].textList, [100, 101]);
    });

    it('reader.state.allRead is true when readingList empty', () => {
      const memberships = [makeMembership(1, [])];
      const reader = createReader([], memberships);
      reader.enterConference(1);
      assert.equal(reader.state.allRead, true);
    });

    it('reader.state returns copies (not mutable references)', () => {
      const memberships = [makeMembership(1, [100])];
      const texts = [makeText(100)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      const s1 = reader.state;
      s1.readingList[0].textList.push(999);

      const s2 = reader.state;
      assert.deepEqual(s2.readingList[0].textList, [100]);
    });
  });

  // === Auto-transition ===

  describe('auto-transition', () => {
    it('auto-transitions to next conference when current exhausted', async () => {
      const memberships = [
        makeMembership(1, [100, 101]),
        makeMembership(2, [200]),
      ];
      const texts = [makeText(100), makeText(101), makeText(200)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      const r1 = await reader.advance();
      assert.equal(r1.textNo, 100);
      markAsRead(memberships, 100);

      const r2 = await reader.advance();
      assert.equal(r2.textNo, 101);
      markAsRead(memberships, 101);

      // Auto-transition to conf 2
      const r3 = await reader.advance();
      assert.equal(r3.textNo, 200);
      assert.equal(r3.confNo, 2);
      assert.equal(reader.state.currentConfNo, 2);
    });

    it('returns null when all conferences exhausted', async () => {
      const memberships = [makeMembership(1, [100])];
      const texts = [makeText(100)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      await reader.advance();
      markAsRead(memberships, 100);

      assert.equal(await reader.advance(), null);
    });

    it('skipped conferences are not auto-transitioned to', async () => {
      const memberships = [
        makeMembership(1, [100]),
        makeMembership(2, [200]),
        makeMembership(3, [300]),
      ];
      const texts = [makeText(100), makeText(200), makeText(300)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      await reader.advance(); // 100
      markAsRead(memberships, 100);

      // Skip conf 2 before auto-transition happens
      // (nextUnreadConference won't return skipped confs — but we need
      // to enter conf 2 first to skip it)
      reader.enterConference(2);
      reader.skipConference();

      // Now advance should skip conf 2 and go to conf 3
      const r = await reader.advance();
      assert.equal(r.textNo, 300);
      assert.equal(r.confNo, 3);
    });

    it('no conference entered initially — finds first with unreads', async () => {
      const memberships = [
        makeMembership(1, []),
        makeMembership(2, [200]),
      ];
      const texts = [makeText(200)];
      const reader = createReader(texts, memberships);

      const r = await reader.advance();
      assert.equal(r.textNo, 200);
      assert.equal(reader.state.currentConfNo, 2);
    });

    it('DFS across conference transition', async () => {
      const memberships = [
        makeMembership(1, [100, 101]),
        makeMembership(2, [200]),
      ];
      const texts = [
        makeText(100, [{ textNo: 101 }]),
        makeText(101),
        makeText(200),
      ];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      const order = [];
      let r;
      while ((r = await reader.advance()) !== null) {
        order.push(r.textNo);
        markAsRead(memberships, r.textNo);
      }
      // DFS: 100, then its comment 101, then auto-transition to conf 2
      assert.deepEqual(order, [100, 101, 200]);
    });

    it('cross-posted text dedup across auto-transition', async () => {
      const memberships = [
        makeMembership(1, [100]),
        makeMembership(2, [100, 200]),
      ];
      const texts = [makeText(100), makeText(200)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      const r1 = await reader.advance();
      assert.equal(r1.textNo, 100);
      markAsRead(memberships, 100);

      // Auto-transition to conf 2 — text 100 already read, should get 200
      const r2 = await reader.advance();
      assert.equal(r2.textNo, 200);
      assert.equal(r2.confNo, 2);
    });

    it('new unreads from polling trigger reading after all-done', async () => {
      const memberships = [makeMembership(1, [100])];
      const texts = [makeText(100), makeText(101)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      await reader.advance();
      markAsRead(memberships, 100);

      assert.equal(await reader.advance(), null);

      // Polling adds new unreads
      memberships[0] = {
        ...memberships[0],
        no_of_unread: 1,
        unread_texts: [101],
      };

      // Re-enter conference to pick up new unreads
      reader.enterConference(1);
      const r = await reader.advance();
      assert.equal(r.textNo, 101);
    });
  });

  // === Edge cases ===

  describe('edge cases', () => {
    it('text with no comment_in_list — advance works normally', async () => {
      const memberships = [makeMembership(1, [100])];
      const texts = [makeText(100)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      const r = await reader.advance();
      assert.equal(r.textNo, 100);
      assert.equal(r.type, 'CONF');
    });

    it('textGetter returns text without comment_in_list field', async () => {
      const memberships = [makeMembership(1, [100])];
      const textMap = new Map([[100, { text_no: 100 }]]);
      const reader = new Reader(
        (no) => Promise.resolve(textMap.get(no)),
        () => memberships
      );
      reader.enterConference(1);

      const r = await reader.advance();
      assert.equal(r.textNo, 100);
    });

    it('conference with single unread text', async () => {
      const memberships = [makeMembership(1, [100])];
      const texts = [makeText(100)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      const r = await reader.advance();
      assert.equal(r.textNo, 100);
      markAsRead(memberships, 100);

      assert.equal(await reader.advance(), null);
    });

    it('already-read text in initial unread_texts — skipped', async () => {
      // Text 100 is in unread_texts but has been read elsewhere
      const memberships = [makeMembership(1, [100, 101])];
      const texts = [makeText(100), makeText(101)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      // Simulate text 100 being read before advance
      markAsRead(memberships, 100);

      const r = await reader.advance();
      assert.equal(r.textNo, 101);
    });

    it('advance result includes confNo and type', async () => {
      const memberships = [makeMembership(5, [200])];
      const texts = [makeText(200)];
      const reader = createReader(texts, memberships);
      reader.enterConference(5);

      const r = await reader.advance();
      assert.equal(r.textNo, 200);
      assert.equal(r.confNo, 5);
      assert.equal(r.type, 'CONF');
      assert.equal(r.commTo, undefined);
    });

    it('COMM-IN advance result includes commTo', async () => {
      const memberships = [makeMembership(1, [100, 101])];
      const texts = [
        makeText(100, [{ textNo: 101 }]),
        makeText(101),
      ];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      await reader.advance(); // 100
      markAsRead(memberships, 100);

      const r = await reader.advance();
      assert.equal(r.textNo, 101);
      assert.equal(r.type, 'COMM-IN');
      assert.equal(r.commTo, 100);
    });

    it('re-entering the same conference replaces its readingList entry', async () => {
      const memberships = [makeMembership(1, [100, 101])];
      const texts = [makeText(100), makeText(101)];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      // Read one text
      await reader.advance();
      markAsRead(memberships, 100);

      // Re-enter same conference — should get a fresh CONF entry
      reader.enterConference(1);
      const s = reader.state;
      assert.equal(s.readingList.length, 1);
      assert.deepEqual(s.readingList[0].textList, [101]);
    });

    it('textGetter rejection — text is returned, DFS skipped', async () => {
      const memberships = [makeMembership(1, [100, 101])];
      const texts = [makeText(101)];
      const textMap = new Map(texts.map((t) => [t.text_no, t]));
      const reader = new Reader(
        (no) => {
          if (no === 100) return Promise.reject(new Error('network error'));
          return Promise.resolve(textMap.get(no));
        },
        () => memberships
      );
      reader.enterConference(1);

      // Text 100 fails to fetch — should still be returned
      const r1 = await reader.advance();
      assert.equal(r1.textNo, 100);
      markAsRead(memberships, 100);

      // Text 101 works normally
      const r2 = await reader.advance();
      assert.equal(r2.textNo, 101);
    });

    it('mixed read/unread comments — only unread are followed', async () => {
      // Text 100 has comments 101, 102, 103
      // Only 101 and 103 are unread
      const memberships = [makeMembership(1, [100, 101, 103])];
      const texts = [
        makeText(100, [{ textNo: 101 }, { textNo: 102 }, { textNo: 103 }]),
        makeText(101),
        makeText(102),
        makeText(103),
      ];
      const reader = createReader(texts, memberships);
      reader.enterConference(1);

      const order = [];
      let r;
      while ((r = await reader.advance()) !== null) {
        order.push(r.textNo);
        markAsRead(memberships, r.textNo);
      }
      // 102 is already read, so DFS only follows 101 and 103
      assert.deepEqual(order, [100, 101, 103]);
    });

    it('enterConference for non-member conference — auto-transitions to next with unreads', async () => {
      const memberships = [makeMembership(1, [100])];
      const texts = [makeText(100)];
      const reader = createReader(texts, memberships);
      reader.enterConference(99); // not a member
      assert.equal(reader.state.currentConfNo, 99);
      assert.equal(reader.state.readingList.length, 0);
      // Auto-transitions to conf 1
      const r = await reader.advance();
      assert.equal(r.textNo, 100);
      assert.equal(reader.state.currentConfNo, 1);
    });

    it('enterConference for non-member conference with no other unreads', async () => {
      const memberships = [makeMembership(1, [])];
      const reader = createReader([], memberships);
      reader.enterConference(99); // not a member
      assert.equal(await reader.advance(), null);
    });
  });
});
