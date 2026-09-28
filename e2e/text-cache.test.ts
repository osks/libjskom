import { describe, it, expect, afterEach } from "vitest";
import {
  blackholeLyskom,
  clearLyskomToxics,
  createClient,
  createLoggedInClient,
  safeDisconnect,
  someUnreadTextNo,
  waitForMemberships,
  withTimeout,
  ANOTHER_USER,
  TEST_USER,
} from "./helpers";
import { LyskomClient, MemoryTextStore } from "../dist/index.js";

describe("text cache", { retry: 0 }, () => {
  const clients: LyskomClient[] = [];

  afterEach(async () => {
    await clearLyskomToxics();
    for (const c of clients.splice(0)) await safeDisconnect(c);
  });

  async function loggedIn(user = TEST_USER, textStore?: MemoryTextStore) {
    const client = createClient({ textStore });
    await client.connect();
    await client.login({ name: user.name, passwd: user.passwd });
    await waitForMemberships(client);
    clients.push(client);
    return client;
  }


  it("stats from /textstats match texts from /texts (verifyCache finds nothing)", async () => {
    const client = await loggedIn(TEST_USER, new MemoryTextStore());
    await someUnreadTextNo(client);
    const textNos = client.getSnapshot().memberships.flatMap((m: any) => m.unread_texts).slice(0, 5);
    for (const textNo of textNos) await client.getText(textNo);

    expect(await client.verifyCache()).toEqual([]);
    expect(await client.revalidateTexts(textNos)).toEqual({ checked: textNos.length, changed: 0, removed: 0 });
  });

  it("a restored client shows stored texts without reaching the LysKOM server", async () => {
    const store = new MemoryTextStore();
    const first = await loggedIn(TEST_USER, store);
    const textNo = await someUnreadTextNo(first);
    const text = await first.getText(textNo);

    // As after a reload, with the connection to the LysKOM server dead
    await blackholeLyskom();
    const restored = createClient({ ...first.toObject(), textStore: store, requestTimeoutMs: 1000 });
    clients.push(restored);
    expect(await restored.loadStoredTexts([textNo])).toBe(1);
    expect(restored.getSnapshot().texts.get(textNo)).toEqual(text);
    expect(await withTimeout(restored.getText(textNo), 500, "getText from the store")).toEqual(text);
  });

  it("revalidation picks up a comment someone else wrote", async () => {
    const reader = await loggedIn(TEST_USER, new MemoryTextStore());
    const writer = await loggedIn(ANOTHER_USER);

    // A text of our own to comment on, so other tests' data isn't touched
    const confNo = writer.getSnapshot().memberships.find((m: any) => m.conference.name === "Test Conference")!.conference.conf_no;
    const recipientList = [{ type: "to", recpt: { conf_no: confNo } }];
    const { text_no: textNo } = await writer.createText({ subject: "Text cache test", body: "Parent", recipientList });
    await reader.getText(textNo);

    const { text_no: commentNo } = await writer.createText({
      subject: "Text cache test",
      body: "A comment",
      recipientList,
      commentToList: [{ type: "comment", text_no: textNo }],
    });

    // The cache doesn't know yet, and the consistency check says so
    expect(await reader.verifyCache()).toEqual([{ textNo, fields: ["comment_in_list"] }]);

    const result = await reader.revalidateTexts([textNo]);
    expect(result).toEqual({ checked: 1, changed: 1, removed: 0 });
    expect(reader.getSnapshot().texts.get(textNo)!.comment_in_list.map((c: any) => c.text_no)).toContain(commentNo);
    expect(await reader.verifyCache()).toEqual([]);
  });
});
