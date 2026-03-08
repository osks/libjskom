import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createLoggedInClient,
  safeDisconnect,
  waitForMemberships,
  waitForReader,
  waitForCondition,
} from "./helpers";
import { LyskomClient } from "../dist/index.js";

describe("reader", () => {
  let client: LyskomClient;
  let readerConfNo: number;

  /**
   * Find the "Reader Test" conference conf_no from memberships.
   */
  async function getReaderTestConfNo(c: LyskomClient) {
    const snap = c.getSnapshot();
    const m = snap.memberships.find(
      (m: any) => m.conference.name === "Reader Test"
    );
    expect(m).toBeTruthy();
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
      const m = client
        .getSnapshot()
        .memberships.find(
          (m: any) => m.conference.conf_no === readerConfNo
        );
      return m && m.no_of_unread > 0 && m.unread_texts.length > 0;
    });
  });

  afterEach(async () => {
    await safeDisconnect(client);
  });

  it("should set reader state after enterConference", async () => {
    await client.enterConference(readerConfNo);
    await waitForReader(client);

    const reader = client.getSnapshot().reader;
    expect(reader).toBeTruthy();
    expect(reader.currentConfNo).toBe(readerConfNo);
    expect(Array.isArray(reader.readingList)).toBe(true);
    expect(reader.readingList.length).toBeGreaterThan(0);
  });

  it("should set currentConferenceNo after enterConference", async () => {
    await client.enterConference(readerConfNo);

    expect(client.currentConferenceNo).toBe(readerConfNo);
  });

  it("should advance through texts sequentially", async () => {
    await client.enterConference(readerConfNo);
    await waitForReader(client);

    const textNos: number[] = [];
    let result;
    while ((result = await client.advance()) !== null) {
      textNos.push(result.textNo);
    }

    expect(textNos.length).toBeGreaterThan(0);
    // All text numbers should be unique
    expect(new Set(textNos).size).toBe(textNos.length);
  });

  it("should return null when all read", async () => {
    await client.enterConference(readerConfNo);
    await waitForReader(client);

    // Drain the queue
    while ((await client.advance()) !== null) {}

    expect(await client.advance()).toBeNull();
  });

  it("should mark texts as read when advancing", async () => {
    await client.enterConference(readerConfNo);
    await waitForReader(client);

    const membershipBefore = client
      .getSnapshot()
      .memberships.find(
        (m: any) => m.conference.conf_no === readerConfNo
      );
    const unreadBefore = membershipBefore.no_of_unread;
    expect(unreadBefore).toBeGreaterThan(0);

    // Advance once
    const result = await client.advance();
    expect(result).not.toBeNull();

    // Give the optimistic update a tick
    await new Promise((r) => setTimeout(r, 50));

    const membershipAfter = client
      .getSnapshot()
      .memberships.find(
        (m: any) => m.conference.conf_no === readerConfNo
      );
    expect(membershipAfter.no_of_unread).toBeLessThan(unreadBefore);
  });

  it("should order texts in DFS with footnotes before comments", async () => {
    await client.enterConference(readerConfNo);
    await waitForReader(client);

    // Collect all text subjects in reader order
    const subjects: string[] = [];
    let result;
    while ((result = await client.advance()) !== null) {
      const text = await client.getText(result.textNo);
      subjects.push(text.subject);
    }

    // Expected DFS order:
    // Root A -> Footnote A -> Reply A1 -> Reply A1 Deep -> Reply A2 -> Root B
    const expected = [
      "Root A",
      "Footnote A",
      "Reply A1",
      "Reply A1 Deep",
      "Reply A2",
      "Root B",
    ];

    expect(subjects).toEqual(expected);
  });

  it("should return pending texts first from advance()", async () => {
    await client.enterConference(readerConfNo);
    await waitForReader(client);

    // Grab text 1 ("Welcome" from Test Conference) as a "show" target
    await client.getText(1);
    client.showText(1);

    // advance() should return the pending text first
    const result = await client.advance();
    expect(result).not.toBeNull();
    expect(result!.textNo).toBe(1);
  });

  it("should auto-transition to next unread conference via advance()", async () => {
    // Also reset unreads on other conferences
    const memberships = client.getSnapshot().memberships;
    for (const m of memberships) {
      if (
        !m.conference.type.letterbox &&
        m.conference.conf_no !== readerConfNo
      ) {
        await client.setNumberOfUnreadTexts(m.conference.conf_no, 100);
      }
    }

    // Wait for at least 2 conferences with unreads
    await waitForCondition(() => {
      const snap = client.getSnapshot();
      return (
        snap.memberships.filter(
          (m: any) => m.no_of_unread > 0 && !m.conference.type.letterbox
        ).length >= 2
      );
    });

    // Enter the first conference
    await client.enterConference(readerConfNo);
    await waitForReader(client);

    // Drain all texts in this conference
    while ((await client.advance()) !== null) {}

    // After draining, the reader should have auto-transitioned or be allRead
    const reader = client.getSnapshot().reader;
    expect(reader).toBeTruthy();
  });

  it("should return null from advance() when no conferences have unreads", async () => {
    // Set all conferences to 0 unread
    const memberships = client.getSnapshot().memberships;
    for (const m of memberships) {
      await client.setNumberOfUnreadTexts(m.conference.conf_no, 0);
    }

    // Wait for memberships to reflect the changes
    await waitForCondition(() => {
      const snap = client.getSnapshot();
      return snap.memberships.every((m: any) => m.no_of_unread === 0);
    });

    // Enter any conference
    const confNo = memberships.find(
      (m: any) => !m.conference.type.letterbox
    )?.conference.conf_no;
    if (!confNo) return;
    await client.enterConference(confNo);

    const result = await client.advance();
    expect(result).toBeNull();
  });

  it("should clear reader and set unread to 0 on skipConference", async () => {
    await client.enterConference(readerConfNo);
    await waitForReader(client);

    await client.skipConference();

    const snap = client.getSnapshot();
    // After skip, reader is allRead with empty readingList
    expect(snap.reader).toBeTruthy();
    expect(snap.reader.allRead).toBe(true);
    expect(snap.reader.readingList).toEqual([]);

    const membership = snap.memberships.find(
      (m: any) => m.conference.conf_no === readerConfNo
    );
    expect(membership.no_of_unread).toBe(0);
  });

  it("should have reader state available immediately after enterConference", async () => {
    // Call enterConference but don't await — reader state should be set
    // synchronously before the first internal await
    const promise = client.enterConference(readerConfNo);

    const reader = client.getSnapshot().reader;
    expect(reader).toBeTruthy();
    expect(reader.currentConfNo).toBe(readerConfNo);
    expect(reader.readingList.length).toBeGreaterThan(0);

    await promise;
  });

  it("should cancel previous build when entering conference again", async () => {
    // Enter once
    await client.enterConference(readerConfNo);

    // Enter again immediately (should cancel the first build)
    await client.enterConference(readerConfNo);
    await waitForReader(client);

    const reader = client.getSnapshot().reader;
    expect(reader).toBeTruthy();
    expect(reader.currentConfNo).toBe(readerConfNo);
    expect(reader.advancing).toBe(false);
  });
});
