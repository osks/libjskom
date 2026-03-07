import type {
  AdvanceResult,
  GetMemberships,
  ReadInfo,
  ReaderSnapshot,
  TextGetter,
} from './types.js';

export class Reader {
  #readingList: ReadInfo[] = [];
  #skippedConferences = new Set<number>();
  #currentConfNo: number | null = null;

  #textGetter: TextGetter;
  #getMemberships: GetMemberships;

  constructor(textGetter: TextGetter, getMemberships: GetMemberships) {
    this.#textGetter = textGetter;
    this.#getMemberships = getMemberships;
  }

  enterConference(confNo: number): void {
    const membership = this.#getMemberships().find(
      (m) => m.conference.conf_no === confNo
    );
    const unreadTexts = membership?.unread_texts ?? [];

    // Clear the entire reading list — switching conferences starts fresh.
    // Old entries (COMM-IN from DFS, leftover CONF entries) would otherwise
    // be processed before the new conference's texts.
    this.#readingList = [];

    if (unreadTexts.length > 0) {
      this.#readingList.push({
        type: 'CONF',
        confNo,
        textList: [...unreadTexts],
      });
    }

    this.#currentConfNo = confNo;
  }

  nextUnreadConference(): number | null {
    const memberships = this.#getMemberships();
    for (const m of memberships) {
      const confNo = m.conference.conf_no;
      if (confNo === this.#currentConfNo) continue;
      if (this.#skippedConferences.has(confNo)) continue;
      if (m.no_of_unread > 0) return confNo;
    }
    return null;
  }

  skipConference(): void {
    if (this.#currentConfNo !== null) {
      this.#skippedConferences.add(this.#currentConfNo);
      this.#readingList = this.#readingList.filter(
        (ri) => ri.confNo !== this.#currentConfNo
      );
    }
  }

  async advance(): Promise<AdvanceResult | null> {
    while (this.#readingList.length > 0) {
      const front = this.#readingList[0];

      // Find next text in front entry (REVIEW skips the unread check)
      let textNo: number | null = null;
      while (front.textList.length > 0) {
        const candidate = front.textList.shift()!;
        if (front.type === 'REVIEW' || this.#isUnread(candidate)) {
          textNo = candidate;
          break;
        }
      }

      if (textNo !== null) {
        // DFS: discover unread footnotes and comments
        let text: Awaited<ReturnType<TextGetter>> | undefined;
        try {
          text = await this.#textGetter(textNo);
        } catch {
          // textGetter failed (network error, deleted text, etc.)
          // Return the text anyway — caller can decide how to handle it.
          // DFS discovery is skipped for this text.
        }
        const commentInList = text?.comment_in_list ?? [];

        const footnotes = commentInList
          .filter((c) => c.type === 'footnote' && this.#isUnread(c.text_no))
          .map((c) => c.text_no);
        const comments = commentInList
          .filter((c) => c.type === 'comment' && this.#isUnread(c.text_no))
          .map((c) => c.text_no);

        // Prepend comments first, then footnotes in front of those
        // Result: [FOOTN-IN, COMM-IN, front, ...rest]
        if (comments.length > 0) {
          this.#readingList.unshift({
            type: 'COMM-IN',
            confNo: front.confNo,
            textList: comments,
            commTo: textNo,
          });
        }
        if (footnotes.length > 0) {
          this.#readingList.unshift({
            type: 'FOOTN-IN',
            confNo: front.confNo,
            textList: footnotes,
            commTo: textNo,
          });
        }

        return {
          textNo,
          type: front.type,
          confNo: front.confNo,
          commTo: front.commTo,
        };
      }

      // front.textList exhausted
      if (front.type === 'CONF') {
        // Refresh from memberships — catches polling-discovered texts
        const membership = this.#getMemberships().find(
          (m) => m.conference.conf_no === front.confNo
        );
        const remaining = membership?.unread_texts ?? [];
        if (remaining.length > 0) {
          front.textList = [...remaining];
          continue;
        }
      }

      this.#readingList.shift();
    }

    return null;
  }

  showText(textNo: number): void {
    this.#readingList.unshift({
      type: 'REVIEW',
      confNo: this.#currentConfNo ?? 0,
      textList: [textNo],
    });
  }

  get state(): ReaderSnapshot {
    return {
      currentConfNo: this.#currentConfNo,
      readingList: this.#readingList.map((ri) => ({
        ...ri,
        textList: [...ri.textList],
      })),
      conferenceFinished: this.#readingList.length === 0,
    };
  }

  #isUnread(textNo: number): boolean {
    return this.#getMemberships().some((m) =>
      m.unread_texts.includes(textNo)
    );
  }
}
