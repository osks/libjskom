import { describe, it, expect, afterEach } from "vitest";
import { createLoggedInClient, safeDisconnect, waitForMemberships } from "./helpers";
import { LyskomClient } from "../dist/index.js";

describe("texts", () => {
  let client: LyskomClient;

  afterEach(async () => {
    await safeDisconnect(client);
  });

  it("should fetch a known text with expected fields", async () => {
    client = await createLoggedInClient();

    // Text 1 is "Welcome" from fixture
    const text = await client.getText(1);

    expect(text.text_no).toBe(1);
    expect(text.subject).toBe("Welcome");
    expect(text.body).toBe("Welcome to the test conference!");
    expect(text.author).toBeTruthy();
    expect(text.author.pers_no).toBeGreaterThan(0);
    expect(Array.isArray(text.recipient_list)).toBe(true);
    expect(text.recipient_list.length).toBeGreaterThan(0);
    expect(Array.isArray(text.comment_to_list)).toBe(true);
    expect(Array.isArray(text.comment_in_list)).toBe(true);
  });

  it("should return the same cached object on second getText call", async () => {
    client = await createLoggedInClient();

    const text1 = await client.getText(1);
    const text2 = await client.getText(1);

    expect(text1).toBe(text2);
  });

  it("should create a new text and fetch it back", async () => {
    client = await createLoggedInClient();

    // Get a conference to post in
    const memberships = await client.getMemberships();
    const confNo = memberships.memberships.find(
      (m: any) => !m.conference.type.letterbox
    ).conference.conf_no;

    const result = await client.createText({
      subject: "Created by test",
      body: "This text was created in an e2e test.",
      recipientList: [{ type: "to", recpt: { conf_no: confNo } }],
    });

    expect(result.text_no).toBeGreaterThan(0);

    const text = await client.getText(result.text_no);
    expect(text.subject).toBe("Created by test");
    expect(text.body).toBe("This text was created in an e2e test.");
  });

  it("should create a comment on an existing text", async () => {
    client = await createLoggedInClient();

    // Text 1 is "Welcome" — comment on it
    const parent = await client.getText(1);
    const confNo = parent.recipient_list[0].recpt.conf_no;

    const result = await client.createText({
      subject: "Test comment",
      body: "This is a comment.",
      recipientList: [{ type: "to", recpt: { conf_no: confNo } }],
      commentToList: [{ type: "comment", text_no: parent.text_no }],
    });

    const comment = await client.getText(result.text_no);
    expect(
      comment.comment_to_list.some(
        (c: any) => c.text_no === parent.text_no
      )
    ).toBe(true);

    // Invalidate parent to get fresh data with the new comment_in_list
    client.invalidateText(parent.text_no);
    const refreshedParent = await client.getText(parent.text_no);
    expect(
      refreshedParent.comment_in_list.some(
        (c: any) => c.text_no === result.text_no
      )
    ).toBe(true);
  });

  it("should mark a text as read and decrease unread count", async () => {
    client = await createLoggedInClient();
    await waitForMemberships(client);

    // Find a conference with unreads
    const snap = client.getSnapshot();
    const membership = snap.memberships.find(
      (m: any) => m.no_of_unread > 0
    );
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

    const unreadAfter = client
      .getSnapshot()
      .memberships.find((m: any) => m.conference.conf_no === confNo);
    expect(unreadAfter.no_of_unread).toBeLessThan(unreadBefore);
  });

  it("should work with createReadMarking backward-compatible alias", async () => {
    client = await createLoggedInClient();

    const text = await client.getText(1);
    // Should not throw
    await client.createReadMarking(text.text_no, text);
  });

  it("should work with deleteReadMarking", async () => {
    client = await createLoggedInClient();

    const text = await client.getText(1);
    // Should not throw
    await client.deleteReadMarking(text.text_no, text);
  });

  it("should invalidate a cached text", async () => {
    client = await createLoggedInClient();

    const text1 = await client.getText(1);
    client.invalidateText(1);

    // After invalidation, snapshot should not contain the text
    const snap = client.getSnapshot();
    expect(snap.texts.has(1)).toBe(false);

    // Fetching again should return fresh data (different object)
    const text2 = await client.getText(1);
    expect(text1).not.toBe(text2);
    expect(text2.text_no).toBe(1);
  });

  it("should populate snapshot.texts Map", async () => {
    client = await createLoggedInClient();

    const snapBefore = client.getSnapshot();
    expect(snapBefore.texts.size).toBe(0);

    await client.getText(1);

    const snapAfter = client.getSnapshot();
    expect(snapAfter.texts.has(1)).toBe(true);
    expect(snapAfter.texts.get(1).text_no).toBe(1);
  });
});
