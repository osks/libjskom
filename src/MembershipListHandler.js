// The MembershipListHandler regularly polls the server for any
// new unread texts/memberships and upates the membership
// list. The handling parts include updating the list of
// memberships with what texts are unread and how many unread
// there are.


export class MembershipListHandler {
  conn;

  #memberships;
  #membershipList;
  #initializePromise = null;
  #refreshIntervalSeconds = 2 * 60;
  #autoRefreshTimeout = null;

  constructor(conn, memberships, membershipList) {
    this.conn = conn;

    this.#memberships = memberships;
    this.#membershipList = membershipList;
  }

  async initialize() {
    if (!this.conn.isLoggedIn()) {
      throw new Error('Not logged in');
    }
    return this.#initialize();
  }

  async #initialize() {
    if (this.#initializePromise) {
      return this.#initializePromise;
    }

    this.#initializePromise = (async () => {
      try {
        await Promise.all([
          this.#fetchUnreadMemberships(),
          this.#fetchMembershipUnreads()
        ]);

        this.#registerEvents();
        this.#fetchAllMemberships();
        await this.enableAutoRefresh();
        console.log(`MembershipListHandler - initialize() - success`);
      } catch (error) {
        console.log(`MembershipListHandler - initialize() - error`);
        this.#initializePromise = null;
        throw error;
      }
    })();

    return this.#initializePromise;
  }

  #registerEvents() {
    this.conn.on('jskom:session:created', () => {
      console.log(`MembershipListHandler - on(jskom:session:created)`);
      this.reset();
    });

    this.conn.on('jskom:session:changed', () => {
      console.log(`MembershipListHandler - on(jskom:session:changed)`);
      this.reset();
    });

    this.conn.on('jskom:session:deleted', () => {
      console.log(`MembershipListHandler - on(jskom:session:deleted)`);
      this.reset();
    });

    this.conn.on('jskom:readMarking:created', (_, text) => {
      console.log(`MembershipListHandler - on(jskom:readMarking:created)`);
      const recipientConfNos = text.recipient_list.map(r => r.recpt.conf_no);
      this.#membershipList.markTextAsRead(text.text_no, recipientConfNos);
    });

    this.conn.on('jskom:readMarking:deleted', (_, text) => {
      console.log(`MembershipListHandler - on(jskom:readMarking:deleted)`);
      const recipientConfNos = text.recipient_list.map(r => r.recpt.conf_no);
      this.#membershipList.markTextAsUnread(text.text_no, recipientConfNos);
    });

    this.conn.on('jskom:membership:created', (_, confNo) => {
      console.log(`MembershipListHandler - on(jskom:membership:created, ${confNo})`);
      this.#fetchMembership(confNo);
      this.#fetchMembershipUnread(confNo);
    });

    this.conn.on('jskom:membership:deleted', (_, confNo) => {
      console.log(`MembershipListHandler - on(jskom:membership:deleted, ${confNo})`);
      this.#membershipList.deleteMembership(confNo);
    });

    this.conn.on('jskom:membership:changed', (_, confNo) => {
      console.log(`MembershipListHandler - on(jskom:membership:changed, ${confNo})`);
      this.#fetchMembership(confNo);
    });

    this.conn.on('jskom:membershipUnread:changed', (_, confNo) => {
      console.log(`MembershipListHandler - on(jskom:membershipUnread:changed)`);
      this.#fetchMembershipUnread(confNo);
    });

    this.conn.on('jskom:text:created', (_, textNo, recipientList) => {
      console.log(`MembershipListHandler - on(jskom:text:created, ${textNo})`);
      const recipientConfNos = recipientList.map(r => r.recpt.conf_no);
      this.#membershipList.markTextAsUnread(textNo, recipientConfNos);
    });

    this.conn.on('jskom:text:fetched', (_, text) => {
      console.log(`MembershipListHandler - on(jskom:text:fetched, ${text.text_no})`);
      const recipientConfNos = text.recipient_list.map(r => r.recpt.conf_no);
    });
  }

  async #fetchMembershipUnreads() {
    const logp = `MembershipListHandler - getMembershipUnreads() - `;
    try {
      const membershipUnreads = await this.#memberships.getMembershipUnreads(this.conn);
      console.log(`${logp}success`);
      this.#membershipList.setMembershipUnreads(membershipUnreads);
    } catch (error) {
      console.log(`${logp}error`);
      throw error;
    }
  }

  async #fetchMembershipUnread(confNo) {
    const logp = `MembershipListHandler - getMembershipUnread(${confNo}) - `;
    try {
      const membershipUnread = await this.#memberships.getMembershipUnread(this.conn, confNo);
      console.log(`${logp}success`);
      this.#membershipList.setMembershipUnread(membershipUnread);
    } catch (error) {
      console.log(`${logp}error`);
      throw error;
    }
  }

  async #fetchUnreadMemberships() {
    const options = { unread: true };
    const logp = `MembershipListHandler - getMemberships(${JSON.stringify(options)}) - `;
    try {
      const unreadMembershipList = await this.#memberships.getMemberships(this.conn, options);
      console.log(`${logp}success`);
      this.#membershipList.addMemberships(unreadMembershipList.memberships);
    } catch (error) {
      console.log(`${logp}error`);
      throw error;
    }
  }

  #fetchAllMemberships() {
    const noOfMemberships = 100;
    const maxNoOfMemberships = 2000;
    this.#fetchMemberships(0, noOfMemberships, maxNoOfMemberships);
  }

  async #fetchMemberships(first, noOfMemberships, maxNoOfMemberships) {
    const logp = `MembershipListHandler - getMemberships({ unread: false }) - `;
    const count = first === 0 ? 20 : noOfMemberships;
    const options = { unread: false, first, noOfMemberships: count };

    try {
      const membershipList = await this.#memberships.getMemberships(this.conn, options);
      console.log(`${logp}success`);
      this.#membershipList.addMemberships(membershipList.memberships);

      const nextFirst = first + count;
      if (membershipList.has_more && nextFirst < maxNoOfMemberships) {
        await this.#fetchMemberships(nextFirst, noOfMemberships, maxNoOfMemberships);
      }
    } catch (error) {
      console.log(`${logp}error`);
      throw error;
    }
  }

  async #fetchMembership(confNo) {
    const logp = `MembershipListHandler - getMemberships(${confNo}) - `;
    try {
      const membership = await this.#memberships.getMembership(this.conn, confNo);
      console.log(`${logp}success`);
      this.#membershipList.addMembership(membership);
    } catch (error) {
      console.log(`${logp}error`);
      throw error;
    }
  }

  reset() {
    this.disableAutoRefresh();
    this.#membershipList.clear();
    this.#initializePromise = null;
  }

  async getMembershipList() {
    await this.#initialize();
    return this.#membershipList;
  }

  #enableAutoRefresh() {
    console.log(`MembershipListHandler - enabling auto-refresh`);
    const defaultIntervalMs = this.#refreshIntervalSeconds * 1000;
    this.#scheduleRefresh(defaultIntervalMs);
  }

  async #refresh(defaultIntervalMs) {
    try {
      await this.#fetchMembershipUnreads();
      this.#scheduleRefresh(defaultIntervalMs);
    } catch (error) {
      this.#scheduleRefresh(defaultIntervalMs * 2); // failed: delay next attempt
    }
  }

  #scheduleRefresh(refreshIntervalMs) {
    if (this.#autoRefreshTimeout) {
      clearTimeout(this.#autoRefreshTimeout);
    }
    this.#autoRefreshTimeout = setTimeout(() => this.#refresh(refreshIntervalMs), refreshIntervalMs);
  }

  async enableAutoRefresh() {
    await this.#initialize();
    this.#enableAutoRefresh();
  }

  disableAutoRefresh() {
    if (this.#autoRefreshTimeout) {
      console.log(`MembershipListHandler - disabling auto-refresh`);
      clearTimeout(this.#autoRefreshTimeout);
      this.#autoRefreshTimeout = null;
    }
  }

  async refreshUnread() {
    await this.#initialize();
    this.#enableAutoRefresh();
    return this.#fetchMembershipUnreads();
  }
}
