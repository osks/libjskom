import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createLoggedInClient, safeDisconnect } from "./helpers";
import { LyskomClient } from "../dist/index.js";

describe("marks", () => {
  let client: LyskomClient;
  let marksAvailable = true;

  beforeAll(async () => {
    const c = await createLoggedInClient();
    try {
      await c.getMarks();
    } catch {
      marksAvailable = false;
    }
    try {
      await c.disconnect();
    } catch {}
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
    }
    await safeDisconnect(client);
  });

  it("should get marks (initially empty or known state)", async ({
    skip,
  }) => {
    if (!marksAvailable) skip();
    client = await createLoggedInClient();

    const marks = await client.getMarks();

    expect(Array.isArray(marks)).toBe(true);
  });

  it("should create a mark and find it in getMarks", async ({ skip }) => {
    if (!marksAvailable) skip();
    client = await createLoggedInClient();

    await client.createMark(1, 100);

    const marks = await client.getMarks();
    const found = marks.find((m: any) => m.text_no === 1);
    expect(found).toBeTruthy();
    expect(found.type).toBe(100);
  });

  it("should optimistically update snapshot on createMark", async ({
    skip,
  }) => {
    if (!marksAvailable) skip();
    client = await createLoggedInClient();

    // Wait for background getMarks() from login() to settle
    await new Promise((r) => setTimeout(r, 200));
    await client.getMarks();

    await client.createMark(1, 50);

    const snap = client.getSnapshot();
    const found = snap.marks.find((m: any) => m.text_no === 1);
    expect(found).toBeTruthy();
    expect(found.type).toBe(50);
  });

  it("should delete a mark and verify it is gone", async ({ skip }) => {
    if (!marksAvailable) skip();
    client = await createLoggedInClient();

    await client.createMark(1, 100);

    let marks = await client.getMarks();
    expect(marks.find((m: any) => m.text_no === 1)).toBeTruthy();

    await client.deleteMark(1);

    marks = await client.getMarks();
    expect(marks.find((m: any) => m.text_no === 1)).toBeUndefined();
  });

  it("should optimistically remove from snapshot on deleteMark", async ({
    skip,
  }) => {
    if (!marksAvailable) skip();
    client = await createLoggedInClient();

    // Wait for background getMarks() from login() to settle
    await new Promise((r) => setTimeout(r, 200));

    await client.createMark(1, 100);

    let snap = client.getSnapshot();
    expect(snap.marks.find((m: any) => m.text_no === 1)).toBeTruthy();

    await client.deleteMark(1);

    snap = client.getSnapshot();
    expect(snap.marks.find((m: any) => m.text_no === 1)).toBeUndefined();
  });

  it("should update an existing mark (change type)", async ({ skip }) => {
    if (!marksAvailable) skip();
    client = await createLoggedInClient();

    await client.createMark(1, 100);

    // Update the same text with a different type
    await client.createMark(1, 200);

    const marks = await client.getMarks();
    const found = marks.find((m: any) => m.text_no === 1);
    expect(found).toBeTruthy();
    expect(found.type).toBe(200);

    const all = marks.filter((m: any) => m.text_no === 1);
    expect(all.length).toBe(1);
  });
});
