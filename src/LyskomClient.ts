import { LRUMap } from './lru.js';
import type {
  Session,
  Person,
  LyskomServer,
  Snapshot,
  Membership,
  MembershipUnread,
  KomText,
  KomMark,
  ReaderState,
  ClientObject,
  LyskomClientOptions,
  MIRecipient,
  MICommentRef,
} from './types.js';

// --- Helpers ---

let idCounter = 0;
function newId(): string {
  const min = 1;
  const max = 1000000000;
  return 'conn-' + (Math.floor(Math.random() * (max - min + 1)) + min);
}

interface HttpConfig {
  method: string;
  url: string;
  data?: unknown;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
}

interface HttpResponse {
  data: unknown;
  status: number;
  headers: Headers;
}

interface HttpError {
  data: unknown;
  status: number;
  headers: Headers | null;
  config?: HttpConfig;
}

interface PendingRequest {
  controller: AbortController;
  requireLogin: boolean;
  requireSession: boolean;
}

function initialSnapshot(): Snapshot {
  return {
    connectionStatus: 'disconnected',
    isLoggedIn: false,
    persNo: null,
    personName: null,
    serverId: '',
    servers: {},
    memberships: [],
    texts: new Map(),
    reader: null,
    marks: [],
  };
}

export class LyskomClient {
  // --- Identity ---
  #id: string;
  #lyskomServerId: string;
  #httpkomId: string | null = null;
  #session: Session | null = null;

  // --- Settings ---
  #httpkomServer: string;
  #httpkomConnectionHeader: string;
  #clientName: string;
  #clientVersion: string;
  #cacheVersion: number | null;
  #cacheVersionKey: string;

  // --- State management ---
  #state: Snapshot;
  #listeners = new Set<() => void>();

  // --- HTTP internals ---
  #pendingRequests = new Set<PendingRequest>();
  #createSessionPromise: Promise<Session> | null = null;

  // --- Membership internals ---
  #membershipInitPromise: Promise<void> | null = null;
  #pollTimer: ReturnType<typeof setTimeout> | null = null;
  #pollIntervalMs = 2 * 60 * 1000;

  // --- Text cache ---
  #textCache = new LRUMap<number, KomText>(500);
  #inFlight = new Map<number, Promise<KomText>>();

  // --- Reader ---
  #buildReaderAbort: AbortController | null = null;

  // --- Conference tracking ---
  #currentConferenceNo = 0;

  constructor(options: LyskomClientOptions = {}) {
    this.#id = options.id ?? newId();
    this.#lyskomServerId = options.lyskomServerId ?? '';
    this.#httpkomId = options.httpkomId ?? null;
    this.#session = options.session ?? null;

    this.#httpkomServer = options.httpkomServer ?? '/httpkom';
    this.#httpkomConnectionHeader = options.httpkomConnectionHeader ?? 'Httpkom-Connection';
    this.#clientName = options.clientName ?? 'libjskom';
    this.#clientVersion = options.clientVersion ?? '0.2';
    this.#cacheVersion = options.cacheVersion !== undefined ? options.cacheVersion : 0;
    this.#cacheVersionKey = options.cacheVersionKey ?? '_v';

    // Initialize state from restored session if available
    if (this.#httpkomId && this.#session) {
      this.#state = {
        ...initialSnapshot(),
        connectionStatus: 'connected',
        isLoggedIn: Boolean(this.#session.person),
        persNo: this.#session.person?.pers_no ?? null,
        personName: this.#session.person?.pers_name ?? null,
        serverId: this.#lyskomServerId,
      };
    } else {
      this.#state = initialSnapshot();
    }
  }

  // ================================================================
  // State management (Phase 2)
  // ================================================================

  getSnapshot(): Snapshot {
    return this.#state;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #setState(update: Partial<Snapshot>): void {
    this.#state = { ...this.#state, ...update };
    this.#emit();
  }

  #emit(): void {
    for (const fn of this.#listeners) {
      fn();
    }
  }

  // ================================================================
  // HTTP internals (Phase 2 — ported from HttpkomConnection)
  // ================================================================

  #urlFor(path: string): string {
    let url = `${this.#httpkomServer}/${this.#lyskomServerId}${path}`;
    if (this.#cacheVersion != null) {
      const kv = `${encodeURIComponent(this.#cacheVersionKey)}=${encodeURIComponent(this.#cacheVersion)}`;
      url += (url.indexOf('?') === -1 ? '?' : '&') + kv;
    }
    return url;
  }

  async #http(config: HttpConfig, requireSession = false, requireLogin = false): Promise<HttpResponse> {
    // Prefix URL with the httpkom server and server id
    config = { ...config, url: this.#urlFor(config.url) };

    // Append query parameters from config.params
    if (config.params) {
      const defined = Object.fromEntries(
        Object.entries(config.params).filter(([, v]) => v !== undefined)
      );
      if (Object.keys(defined).length > 0) {
        const sep = config.url.indexOf('?') === -1 ? '?' : '&';
        config = { ...config, url: config.url + sep + new URLSearchParams(defined as Record<string, string>) };
      }
    }

    // Requests that require login fail immediately if not logged in
    if (requireLogin && !this.isLoggedIn()) {
      throw { data: null, status: 401, headers: null, config } as HttpError;
    }

    try {
      // If session is required but we are not connected, create a session first
      if (requireSession && !this.isConnected()) {
        return await this.#createSessionAndRetry(config, requireSession, requireLogin);
      }
      return await this.#request(config, requireSession, requireLogin);
    } catch (error: unknown) {
      // If the error is 403 and login is not required, try to create a new session
      if (typeof error === 'object' && error !== null && 'status' in error && (error as HttpError).status === 403 && !requireLogin) {
        return await this.#createSessionAndRetry(config, requireSession, requireLogin);
      }
      throw error;
    }
  }

  async #request(config: HttpConfig, requireSession: boolean, requireLogin: boolean): Promise<HttpResponse> {
    const controller = new AbortController();
    const headers = new Headers(config.headers || {});

    if (requireSession && this.#httpkomId) {
      headers.set(this.#httpkomConnectionHeader, this.#httpkomId);
    }

    if (config.method?.toLowerCase() === 'post') {
      headers.set('Cache-Control', 'no-cache');
    }

    let body: string | null = null;
    if (config.data && typeof config.data === 'object') {
      body = JSON.stringify(config.data);
      headers.append('Content-Type', 'application/json');
    }

    const fetchConfig: RequestInit = {
      method: config.method || 'GET',
      headers,
      body,
      signal: controller.signal,
      mode: 'cors',
    };

    this.#addPendingRequest(controller, requireSession, requireLogin);

    try {
      const response = await fetch(config.url, fetchConfig);

      if (!this.#hasPendingRequest(controller)) {
        // Request was cancelled
        throw { data: null, status: 0, headers: null, config } as HttpError;
      }

      // No content — but still check for errors
      if (response.status === 204 || response.headers.get('Content-Length') === '0') {
        if (!response.ok) {
          throw { status: response.status, data: null } as HttpError;
        }
        this.#removePendingRequest(controller);
        return { data: null, status: response.status, headers: response.headers };
      }

      // Parse response
      const contentType = response.headers.get('Content-Type');
      let payload: unknown;
      if (contentType && contentType.indexOf('application/json') !== -1) {
        payload = await response.json();
      } else {
        payload = await response.text();
      }

      if (!response.ok) {
        throw { status: response.status, data: payload } as HttpError;
      }

      this.#removePendingRequest(controller);
      return { data: payload, status: response.status, headers: response.headers };
    } catch (error: unknown) {
      if (!this.#hasPendingRequest(controller)) {
        throw { data: null, status: 0, headers: null, config } as HttpError;
      }
      this.#removePendingRequest(controller);

      const status = typeof error === 'object' && error !== null && 'status' in error
        ? (error as HttpError).status
        : undefined;

      if (status === 401) {
        this.#cancelAllPendingRequestsRequiringLogin();
        this.#resetPerson();
      } else if (status === 403) {
        this.#cancelAllPendingRequestsRequiringSession();
        this.#resetSession();
      } else if (status === 502) {
        this.#cancelAllPendingRequestsRequiringSession();
      } else if (status === 500) {
        const errorData = typeof error === 'object' && error !== null && 'data' in error
          ? (error as HttpError).data as Record<string, unknown> | null
          : null;
        if (errorData?.error_type === 'httpkom' && errorData.error_msg === '') {
          this.#cancelAllPendingRequestsRequiringSession();
          this.#resetSession();
        }
      }
      throw error;
    }
  }

  async #createSessionAndRetry(originalRequest: HttpConfig, requireSession: boolean, requireLogin: boolean): Promise<HttpResponse> {
    if (this.#createSessionPromise === null) {
      this.#createSessionPromise = this.#createSession();
      try {
        await this.#createSessionPromise;
      } catch {
        this.#createSessionPromise = null;
        throw { data: null, status: 403, headers: null, config: originalRequest } as HttpError;
      }
      this.#createSessionPromise = null;
    } else {
      try {
        await this.#createSessionPromise;
      } catch {
        throw { data: null, status: 403, headers: null, config: originalRequest } as HttpError;
      }
    }
    return await this.#request(originalRequest, requireSession, requireLogin);
  }

  async #createSession(): Promise<Session> {
    const config: HttpConfig = {
      method: 'post',
      url: this.#urlFor('/sessions/'),
      data: { client: { name: this.#clientName, version: this.#clientVersion } },
    };
    const response = await this.#request(config, false, false);
    const data = response.data as Record<string, unknown>;
    this.#httpkomId = data.connection_id as string;
    const { connection_id: _, ...sessionData } = data;
    const session = sessionData as unknown as Session;
    this.#session = session;
    this.#setState({ connectionStatus: 'connected' });
    return session;
  }

  #resetSession(): void {
    if (this.#httpkomId || this.#session) {
      this.#httpkomId = null;
      this.#session = null;
      this.#setState({
        connectionStatus: 'disconnected',
        isLoggedIn: false,
        persNo: null,
        personName: null,
      });
    }
  }

  #resetPerson(): void {
    if (this.isLoggedIn() && this.#session) {
      this.#session = { ...this.#session, person: null };
      this.#setState({
        isLoggedIn: false,
        persNo: null,
        personName: null,
      });
    }
  }

  // --- Pending request tracking ---

  #addPendingRequest(controller: AbortController, requireSession: boolean, requireLogin: boolean): void {
    this.#pendingRequests.add({ controller, requireLogin, requireSession });
  }

  #removePendingRequest(controller: AbortController): void {
    for (const req of this.#pendingRequests) {
      if (req.controller === controller) {
        this.#pendingRequests.delete(req);
        break;
      }
    }
  }

  #hasPendingRequest(controller: AbortController): boolean {
    for (const req of this.#pendingRequests) {
      if (req.controller === controller) return true;
    }
    return false;
  }

  #cancelAllPendingRequestsRequiringLogin(): void {
    for (const req of [...this.#pendingRequests]) {
      if (req.requireLogin) {
        req.controller.abort();
        this.#pendingRequests.delete(req);
      }
    }
  }

  #cancelAllPendingRequestsRequiringSession(): void {
    this.#cancelAllPendingRequestsRequiringLogin();
    for (const req of [...this.#pendingRequests]) {
      if (req.requireSession) {
        req.controller.abort();
        this.#pendingRequests.delete(req);
      }
    }
  }

  // ================================================================
  // Session + Connection (Phase 3)
  // ================================================================

  isConnected(): boolean {
    return Boolean(this.#httpkomId && this.#session);
  }

  isLoggedIn(): boolean {
    return Boolean(this.isConnected() && this.#session?.person);
  }

  getPersNo(): number | null {
    return this.#session?.person?.pers_no ?? null;
  }

  get currentConferenceNo(): number {
    return this.#currentConferenceNo;
  }

  async connect(lyskomServerId?: string | null): Promise<Session> {
    if (this.isConnected()) {
      throw new Error('Already connected');
    }

    if (lyskomServerId != null) {
      this.#lyskomServerId = lyskomServerId;
    }

    const response = await this.#http(
      {
        method: 'post',
        url: '/sessions/',
        data: { client: { name: this.#clientName, version: this.#clientVersion } },
      },
      false,
      false
    );

    const data = response.data as Record<string, unknown>;
    this.#httpkomId = data.connection_id as string;
    const session: Session = {
      session_no: data.session_no as number,
      person: (data.person as Person) ?? null,
    };
    this.#session = session;
    this.#setState({ connectionStatus: 'connected', serverId: this.#lyskomServerId });
    return session;
  }

  async disconnect(sessionNo = 0): Promise<void> {
    const response = await this.#http(
      { method: 'delete', url: `/sessions/${sessionNo}` },
      true,
      false
    );
    // Check if we deleted our own session
    if (sessionNo === 0 || sessionNo === this.#session?.session_no) {
      this.#stopPolling();
      this.#cancelBuildReader();
      for (const req of this.#pendingRequests) {
        req.controller.abort();
      }
      this.#pendingRequests.clear();
      this.#httpkomId = null;
      this.#session = null;
      this.#membershipInitPromise = null;
      this.#setState({
        connectionStatus: 'disconnected',
        isLoggedIn: false,
        persNo: null,
        personName: null,
      });
    }
  }

  async login(credentials: { persNo?: number; name?: string; passwd: string }): Promise<Person> {
    const data: Record<string, unknown> = {};

    if (credentials.persNo !== undefined) {
      data.pers_no = credentials.persNo;
    } else if (credentials.name !== undefined) {
      data.pers_name = credentials.name;
    } else {
      throw new Error('Either persNo or name must be provided');
    }
    data.passwd = credentials.passwd;

    const response = await this.#http(
      { method: 'post', url: '/sessions/current/login', data },
      true,
      false
    );

    const person = response.data as Person;
    this.#session = { ...this.#session!, person };

    this.#setState({
      isLoggedIn: true,
      persNo: person.pers_no,
      personName: person.pers_name,
    });

    // Kick off background tasks
    this.#fetchMemberships();
    this.#startPolling();
    this.getMarks().catch(() => {}); // fire-and-forget

    return person;
  }

  async logout(): Promise<void> {
    this.#stopPolling();
    await this.#http(
      { method: 'post', url: '/sessions/current/logout' },
      true,
      true
    );
    if (this.#session) {
      this.#session = { ...this.#session, person: null };
    }
    this.#membershipInitPromise = null;
    this.#textCache.clear();
    this.#inFlight.clear();
    this.#cancelBuildReader();
    this.#setState({
      isLoggedIn: false,
      persNo: null,
      personName: null,
      memberships: [],
      texts: new Map(),
      reader: null,
      marks: [],
    });
  }

  /** Re-fetch memberships, marks, and restart polling after restoring from a serialized session. */
  resume(): void {
    if (!this.isLoggedIn()) return;
    this.fetchServers().catch(() => {});
    this.#fetchMemberships();
    this.#startPolling();
    this.getMarks().catch(() => {});
  }

  destroy(): void {
    this.#stopPolling();
    this.#cancelBuildReader();
    for (const req of this.#pendingRequests) {
      req.controller.abort();
    }
    this.#pendingRequests.clear();
    this.#listeners.clear();
  }

  async fetchServers(): Promise<Record<string, LyskomServer>> {
    let url = `${this.#httpkomServer}/`;
    if (this.#cacheVersion != null) {
      const kv = `${encodeURIComponent(this.#cacheVersionKey)}=${encodeURIComponent(this.#cacheVersion)}`;
      url += (url.indexOf('?') === -1 ? '?' : '&') + kv;
    }
    const response = await fetch(url, { method: 'GET', mode: 'cors' });
    const servers = (await response.json()) as Record<string, LyskomServer>;
    this.#setState({ servers });
    return servers;
  }

  // Backward-compatible alias
  async getLyskomServers(): Promise<Record<string, LyskomServer>> {
    return this.fetchServers();
  }

  toObject(): ClientObject {
    return {
      id: this.#id,
      lyskomServerId: this.#lyskomServerId,
      httpkomId: this.#httpkomId,
      session: this.#session,
    };
  }

  static fromObject(obj: ClientObject & { httpkomServer?: string }): LyskomClient {
    return new LyskomClient({
      id: obj.id,
      lyskomServerId: obj.lyskomServerId,
      httpkomId: obj.httpkomId,
      session: obj.session,
      httpkomServer: obj.httpkomServer,
    });
  }

  // ================================================================
  // Person + stateless methods (Phase 4)
  // ================================================================

  async createPerson(name: string, passwd: string): Promise<Person> {
    const response = await this.#http(
      { method: 'post', url: '/persons/', data: { name, passwd } },
      true,
      false
    );
    return response.data as Person;
  }

  async setPassword(persNo: number, oldPwd: string, newPwd: string): Promise<void> {
    await this.#http(
      {
        method: 'post',
        url: `/persons/${persNo}/set-passwd`,
        data: { old_pwd: oldPwd, new_pwd: newPwd },
      },
      true,
      false
    );
  }

  async setPresentation(persNo: number, textNo: number): Promise<void> {
    await this.#http(
      {
        method: 'post',
        url: `/persons/${persNo}/set-presentation`,
        data: { text_no: textNo },
      },
      true,
      false
    );
  }

  async lookupConferences(
    name: string,
    wantConfs = true,
    wantPersons = false
  ): Promise<Array<{ conf_no: number; name: string }>> {
    const response = await this.#http(
      {
        method: 'get',
        url: '/conferences/',
        params: {
          name,
          'want-confs': wantConfs,
          'want-persons': wantPersons,
        },
      },
      true,
      true
    );
    const body = response.data as { conferences: Array<{ conf_no: number; name: string }> };
    return body.conferences;
  }

  async getConference(confNo: number): Promise<unknown> {
    const response = await this.#http(
      { method: 'get', url: `/conferences/${confNo}` },
      true,
      true
    );
    return response.data;
  }

  // ================================================================
  // Memberships (Phase 5)
  // ================================================================

  // --- Public HTTP wrappers ---

  async getMemberships(options?: {
    unread?: boolean;
    first?: number;
    noOfMemberships?: number;
  }): Promise<{ memberships: Membership[]; has_more: boolean }> {
    return this.getMembershipsForPerson(this.getPersNo()!, options);
  }

  async getMembershipsForPerson(
    persNo: number,
    options: { unread?: boolean; first?: number; noOfMemberships?: number } = {}
  ): Promise<{ memberships: Membership[]; has_more: boolean }> {
    const params: Record<string, unknown> = {};
    if (options.unread !== undefined) params.unread = options.unread;
    if (options.first !== undefined) params.first = options.first;
    if (options.noOfMemberships !== undefined) params['no-of-memberships'] = options.noOfMemberships;

    const response = await this.#http(
      { method: 'get', url: `/persons/${persNo}/memberships/`, params },
      true,
      true
    );
    return response.data as { memberships: Membership[]; has_more: boolean };
  }

  async getMembership(confNo: number): Promise<Membership> {
    return this.getMembershipForPerson(this.getPersNo()!, confNo);
  }

  async getMembershipForPerson(persNo: number, confNo: number): Promise<Membership> {
    const response = await this.#http(
      { method: 'get', url: `/persons/${persNo}/memberships/${confNo}` },
      true,
      true
    );
    return response.data as Membership;
  }

  async getMembershipUnreads(): Promise<MembershipUnread[]> {
    return this.getMembershipUnreadsForPerson(this.getPersNo()!);
  }

  async getMembershipUnreadsForPerson(persNo: number): Promise<MembershipUnread[]> {
    const response = await this.#http(
      { method: 'get', url: `/persons/${persNo}/memberships/unread/` },
      true,
      true
    );
    return (response.data as { list: MembershipUnread[] }).list;
  }

  async getMembershipUnread(confNo: number): Promise<MembershipUnread> {
    return this.getMembershipUnreadForPerson(this.getPersNo()!, confNo);
  }

  async getMembershipUnreadForPerson(persNo: number, confNo: number): Promise<MembershipUnread> {
    const response = await this.#http(
      { method: 'get', url: `/persons/${persNo}/memberships/${confNo}/unread` },
      true,
      true
    );
    return response.data as MembershipUnread;
  }

  async addMembership(confNo: number): Promise<void> {
    return this.addMembershipForPerson(this.getPersNo()!, confNo);
  }

  async addMembershipForPerson(persNo: number, confNo: number): Promise<void> {
    await this.#http(
      { method: 'put', url: `/persons/${persNo}/memberships/${confNo}`, data: { priority: 100 } },
      true,
      true
    );
    // If for current user, re-fetch membership data
    if (this.getPersNo() === persNo) {
      try {
        const [membership, unread] = await Promise.all([
          this.getMembershipForPerson(persNo, confNo),
          this.getMembershipUnreadForPerson(persNo, confNo).catch(() => null),
        ]);
        if (unread) {
          membership.no_of_unread = unread.no_of_unread;
          membership.unread_texts = unread.unread_texts;
        } else {
          membership.no_of_unread = 0;
          membership.unread_texts = [];
        }
        this.#setState({
          memberships: this.#mergeMemberships([...this.#state.memberships, membership]),
        });
      } catch {
        // Best-effort update
      }
    }
  }

  async deleteMembership(confNo: number): Promise<void> {
    return this.deleteMembershipForPerson(this.getPersNo()!, confNo);
  }

  async deleteMembershipForPerson(persNo: number, confNo: number): Promise<void> {
    await this.#http(
      { method: 'delete', url: `/persons/${persNo}/memberships/${confNo}` },
      true,
      true
    );
    if (this.getPersNo() === persNo) {
      this.#setState({
        memberships: this.#state.memberships.filter(
          m => m.conference.conf_no !== confNo
        ),
      });
    }
  }

  async setNumberOfUnreadTexts(confNo: number, noOfUnread: number): Promise<void> {
    await this.#http(
      {
        method: 'post',
        url: `/persons/current/memberships/${confNo}/unread`,
        data: { no_of_unread: noOfUnread },
      },
      true,
      true
    );
    // Re-fetch to get the actual unread_texts list from server
    try {
      const unread = await this.getMembershipUnread(confNo);
      this.#setState({
        memberships: this.#state.memberships.map(m =>
          m.conference.conf_no === confNo
            ? { ...m, no_of_unread: unread.no_of_unread, unread_texts: unread.unread_texts }
            : m
        ),
      });
      // If currently reading this conference, rebuild reading order
      if (this.#state.reader?.confNo === confNo) {
        this.enterConference(confNo);
      }
    } catch {
      // Best-effort
    }
  }

  // --- Private membership methods ---

  #fetchMemberships(): void {
    if (this.#membershipInitPromise) return;

    this.#membershipInitPromise = (async () => {
      try {
        // Fetch unread memberships + unread counts in parallel
        const [unreadResult, unreads] = await Promise.all([
          this.getMemberships({ unread: true }),
          this.getMembershipUnreads(),
        ]);

        // Patch unread info into memberships
        const unreadMap = new Map(unreads.map(u => [u.conf_no, u]));
        const patched = unreadResult.memberships.map(m => {
          const u = unreadMap.get(m.conference.conf_no);
          return u
            ? { ...m, no_of_unread: u.no_of_unread, unread_texts: u.unread_texts }
            : { ...m, no_of_unread: 0, unread_texts: [] as number[] };
        });

        this.#setState({ memberships: this.#mergeMemberships(patched) });

        // Paginate all memberships in background (20 first, then 100 at a time)
        this.#fetchAllMemberships(unreads);
      } catch {
        this.#membershipInitPromise = null;
      }
    })();
  }

  async #fetchAllMemberships(unreads: MembershipUnread[]): Promise<void> {
    const unreadMap = new Map(unreads.map(u => [u.conf_no, u]));
    const maxNoOfMemberships = 2000;
    let first = 0;

    while (first < maxNoOfMemberships) {
      const count = first === 0 ? 20 : 100;
      try {
        const result = await this.getMemberships({ first, noOfMemberships: count });
        const patched = result.memberships.map(m => {
          const u = unreadMap.get(m.conference.conf_no);
          return u
            ? { ...m, no_of_unread: u.no_of_unread, unread_texts: u.unread_texts }
            : { ...m, no_of_unread: 0, unread_texts: [] as number[] };
        });

        // Merge into existing memberships
        const merged = this.#mergeIncomingMemberships(this.#state.memberships, patched);
        this.#setState({ memberships: merged });

        first += count;
        if (!result.has_more) break;
      } catch {
        break;
      }
    }
  }

  #mergeIncomingMemberships(existing: Membership[], incoming: Membership[]): Membership[] {
    const map = new Map<number, Membership>();
    for (const m of existing) {
      map.set(m.conference.conf_no, m);
    }
    for (const m of incoming) {
      const prev = map.get(m.conference.conf_no);
      if (prev) {
        // Preserve unread data if incoming doesn't have it
        if (m.no_of_unread === undefined || m.no_of_unread === 0) {
          map.set(m.conference.conf_no, {
            ...m,
            no_of_unread: prev.no_of_unread,
            unread_texts: prev.unread_texts,
          });
        } else {
          map.set(m.conference.conf_no, m);
        }
      } else {
        map.set(m.conference.conf_no, m);
      }
    }
    return this.#mergeMemberships([...map.values()]);
  }

  #mergeMemberships(memberships: Membership[]): Membership[] {
    // Deduplicate by conf_no, keeping latest
    const map = new Map<number, Membership>();
    for (const m of memberships) {
      map.set(m.conference.conf_no, m);
    }
    const arr = [...map.values()];
    // Sort: unread first, then by priority (higher = more important)
    arr.sort((a, b) => {
      const aUnread = a.no_of_unread > 0 ? 1 : 0;
      const bUnread = b.no_of_unread > 0 ? 1 : 0;
      if (aUnread !== bUnread) return bUnread - aUnread;
      return (b.priority ?? 0) - (a.priority ?? 0);
    });
    return arr;
  }

  #startPolling(): void {
    this.#stopPolling();
    this.#scheduleRefresh(this.#pollIntervalMs);
  }

  #stopPolling(): void {
    if (this.#pollTimer) {
      clearTimeout(this.#pollTimer);
      this.#pollTimer = null;
    }
  }

  #scheduleRefresh(intervalMs: number): void {
    this.#stopPolling();
    this.#pollTimer = setTimeout(() => this.#refreshUnreads(intervalMs), intervalMs);
  }

  async #refreshUnreads(defaultIntervalMs: number): Promise<void> {
    try {
      const unreads = await this.getMembershipUnreads();
      if (!this.isLoggedIn()) return;
      this.#mergeUnreads(unreads);
      if (this.#state.connectionStatus === 'reconnecting') {
        this.#setState({ connectionStatus: 'connected' });
      }
      this.#scheduleRefresh(defaultIntervalMs);
    } catch {
      if (!this.isLoggedIn()) return;
      if (this.#state.connectionStatus === 'connected') {
        this.#setState({ connectionStatus: 'reconnecting' });
      }
      // Backoff on failure, cap at 5 minutes
      const next = Math.min(defaultIntervalMs * 2, 5 * 60 * 1000);
      this.#scheduleRefresh(next);
    }
  }

  #mergeUnreads(unreads: MembershipUnread[]): void {
    const unreadMap = new Map(unreads.map(u => [u.conf_no, u]));
    this.#setState({
      memberships: this.#state.memberships.map(m => {
        const u = unreadMap.get(m.conference.conf_no);
        if (u) {
          return { ...m, no_of_unread: u.no_of_unread, unread_texts: u.unread_texts };
        }
        return m;
      }),
    });

    // If the reader is active, check for new unread texts in the current conference
    const reader = this.#state.reader;
    if (reader) {
      const u = unreadMap.get(reader.confNo);
      if (u) {
        const known = new Set([...reader.queue, ...reader.pending]);
        const newTexts = u.unread_texts.filter(t => !known.has(t));
        if (newTexts.length > 0) {
          // Prefetch so they're ready when advance() returns them
          for (const t of newTexts) {
            this.getText(t).catch(() => {});
          }
          this.#setState({
            reader: { ...this.#state.reader!, pending: [...this.#state.reader!.pending, ...newTexts] },
          });
        }
      }
    }
  }

  #markTextAsReadLocally(textNo: number, confNos: number[]): void {
    const confNoSet = new Set(confNos);
    let changed = false;
    const memberships = this.#state.memberships.map(m => {
      if (confNoSet.has(m.conference.conf_no)) {
        const idx = m.unread_texts.indexOf(textNo);
        if (idx !== -1) {
          changed = true;
          return {
            ...m,
            no_of_unread: m.no_of_unread - 1,
            unread_texts: m.unread_texts.filter(t => t !== textNo),
          };
        }
      }
      return m;
    });
    if (changed) {
      this.#setState({ memberships });
    }
  }

  // ================================================================
  // Texts + caching (Phase 6)
  // ================================================================

  async getText(textNo: number): Promise<KomText> {
    // Check LRU cache
    const cached = this.#textCache.get(textNo);
    if (cached) return cached;

    // Dedup: if already fetching, return the same promise
    const existing = this.#inFlight.get(textNo);
    if (existing) return existing;

    const promise = this.#fetchText(textNo);
    this.#inFlight.set(textNo, promise);
    try {
      return await promise;
    } finally {
      this.#inFlight.delete(textNo);
    }
  }

  async #fetchText(textNo: number): Promise<KomText> {
    const response = await this.#http(
      { method: 'get', url: `/texts/${textNo}` },
      true,
      true
    );
    const text = response.data as KomText;
    this.#textCache.set(textNo, text);
    this.#setState({ texts: this.#textCache.toMap() });
    return text;
  }

  async createText(params: {
    subject: string;
    body: string;
    contentType?: string;
    recipientList: Array<{ type: string; recpt: { conf_no: number } }>;
    commentToList?: Array<{ type: string; text_no: number }>;
  }): Promise<{ text_no: number }> {
    const data = {
      subject: params.subject,
      body: params.body,
      content_type: params.contentType ?? 'text/plain',
      recipient_list: params.recipientList,
      comment_to_list: params.commentToList ?? [],
    };
    const response = await this.#http(
      { method: 'post', url: '/texts/', data },
      true,
      true
    );
    const result = response.data as { text_no: number };

    // Refresh unreads so the new text appears in memberships and reader
    this.#refreshUnreads(this.#pollIntervalMs).catch(() => {});

    return result;
  }

  async markAsRead(textNo: number): Promise<void> {
    const text = this.#textCache.get(textNo);
    if (text) {
      const confNos = text.recipient_list.map(r => r.recpt.conf_no);
      this.#markTextAsReadLocally(textNo, confNos);
    }
    // Fire-and-forget HTTP
    await this.#http(
      { method: 'put', url: `/texts/${textNo}/read-marking`, data: {} },
      true,
      true
    );
  }

  // Backward-compatible aliases
  async createReadMarking(textNo: number, text: KomText): Promise<void> {
    const confNos = text.recipient_list.map(r => r.recpt.conf_no);
    this.#markTextAsReadLocally(textNo, confNos);
    await this.#http(
      { method: 'put', url: `/texts/${textNo}/read-marking`, data: {} },
      true,
      true
    );
  }

  async deleteReadMarking(textNo: number, text: KomText): Promise<void> {
    await this.#http(
      { method: 'delete', url: `/texts/${textNo}/read-marking` },
      true,
      true
    );
  }

  invalidateText(textNo: number): void {
    if (!this.#textCache.has(textNo)) return;
    this.#textCache.delete(textNo);
    this.#setState({ texts: this.#textCache.toMap() });
  }

  // ================================================================
  // Reader (Phase 7)
  // ================================================================

  async enterConference(confNo: number): Promise<void> {
    this.#cancelBuildReader();

    // Set working conference on server
    const previousConfNo = this.#currentConferenceNo;
    this.#currentConferenceNo = confNo;
    try {
      await this.#http(
        {
          method: 'post',
          url: '/sessions/current/working-conference',
          data: { conf_no: confNo },
        },
        true,
        true
      );
    } catch {
      this.#currentConferenceNo = previousConfNo;
      throw new Error(`Failed to enter conference ${confNo}`);
    }

    // If leaving a previous conference, re-fetch its membership (last-time-read updated)
    if (previousConfNo !== 0 && previousConfNo !== confNo) {
      this.#refreshMembership(previousConfNo);
    }

    // Initialize reader state
    const membership = this.#state.memberships.find(
      m => m.conference.conf_no === confNo
    );
    const unreadTexts = membership?.unread_texts ?? [];

    this.#setState({
      reader: {
        confNo,
        queue: [...unreadTexts],
        position: -1,
        building: true,
        pending: [],
      },
    });

    // Start building DFS reading order
    this.#buildReadingOrder(confNo, unreadTexts);
  }

  // Backward-compatible alias for changeConference
  async changeConference(confNo: number): Promise<void> {
    confNo = parseInt(String(confNo), 10);
    const previousConfNo = this.#currentConferenceNo;
    this.#currentConferenceNo = confNo;
    try {
      await this.#http(
        {
          method: 'post',
          url: '/sessions/current/working-conference',
          data: { conf_no: confNo },
        },
        true,
        true
      );
      if (previousConfNo !== 0) {
        this.#refreshMembership(previousConfNo);
      }
    } catch (error) {
      this.#currentConferenceNo = previousConfNo;
      throw error;
    }
  }

  advance(): number | null {
    const reader = this.#state.reader;
    if (!reader) return null;

    // Pending texts take priority
    if (reader.pending.length > 0) {
      const [textNo, ...rest] = reader.pending;
      this.#setState({
        reader: { ...reader, pending: rest },
      });
      // Mark as read (optimistic)
      const text = this.#textCache.get(textNo);
      if (text) {
        const confNos = text.recipient_list.map(r => r.recpt.conf_no);
        this.#markTextAsReadLocally(textNo, confNos);
      }
      this.markAsRead(textNo).catch(() => {});
      return textNo;
    }

    // Then continue DFS queue
    const next = reader.position + 1;
    if (next >= reader.queue.length) return null;

    const textNo = reader.queue[next];
    this.#setState({
      reader: { ...reader, position: next },
    });

    // Mark as read (optimistic)
    const text = this.#textCache.get(textNo);
    if (text) {
      const confNos = text.recipient_list.map(r => r.recpt.conf_no);
      this.#markTextAsReadLocally(textNo, confNos);
    }
    this.markAsRead(textNo).catch(() => {});

    // Prefetch ahead
    this.#prefetch(next);

    return textNo;
  }

  nextUnreadConference(): number | null {
    const currentConfNo = this.#state.reader?.confNo;
    const next = this.#state.memberships.find(
      m => m.no_of_unread > 0 && m.conference.conf_no !== currentConfNo
    );
    if (next) {
      this.enterConference(next.conference.conf_no);
      return next.conference.conf_no;
    }
    return null;
  }

  async skipConference(): Promise<void> {
    const reader = this.#state.reader;
    if (!reader) return;

    const confNo = reader.confNo;

    // Tell server to set unread count to 0
    await this.#http(
      {
        method: 'post',
        url: `/persons/current/memberships/${confNo}/unread`,
        data: { no_of_unread: 0 },
      },
      true,
      true
    );

    this.#cancelBuildReader();
    this.#setState({
      reader: null,
      memberships: this.#state.memberships.map(m =>
        m.conference.conf_no === confNo
          ? { ...m, no_of_unread: 0, unread_texts: [] }
          : m
      ),
    });
  }

  showText(textNo: number): void {
    const reader = this.#state.reader;
    if (!reader) return;

    // Fetch if not cached
    if (!this.#textCache.has(textNo)) {
      this.getText(textNo).catch(() => {});
    }

    this.#setState({
      reader: { ...reader, pending: [...reader.pending, textNo] },
    });
  }

  // --- Reader internals ---

  #cancelBuildReader(): void {
    if (this.#buildReaderAbort) {
      this.#buildReaderAbort.abort();
      this.#buildReaderAbort = null;
    }
  }

  async #buildReadingOrder(confNo: number, unreadTexts: number[]): Promise<void> {
    const abort = new AbortController();
    this.#buildReaderAbort = abort;

    const unreadSet = new Set(unreadTexts);
    const ordered: number[] = [];
    const remaining = [...unreadTexts];

    while (remaining.length > 0) {
      if (abort.signal.aborted) return;

      const textNo = remaining.shift()!;
      if (!unreadSet.has(textNo)) continue;
      unreadSet.delete(textNo);
      ordered.push(textNo);

      try {
        const text = await this.getText(textNo);

        // Find unread comments — insert them next (DFS)
        const unreadComments = (text.comment_in_list ?? [])
          .filter(c => c.type === 'comment' && unreadSet.has(c.text_no))
          .map(c => c.text_no);

        // Footnotes first, then comments
        const unreadFootnotes = (text.comment_in_list ?? [])
          .filter(c => c.type === 'footnote' && unreadSet.has(c.text_no))
          .map(c => c.text_no);

        remaining.unshift(...unreadFootnotes, ...unreadComments);
      } catch {
        // If fetch fails, keep textNo in order but don't expand
      }

      // Update queue incrementally
      if (!abort.signal.aborted && this.#state.reader?.confNo === confNo) {
        this.#setState({
          reader: {
            ...this.#state.reader,
            queue: [...ordered, ...remaining],
            building: remaining.length > 0,
          },
        });
      }
    }

    // Mark building as done
    if (!abort.signal.aborted && this.#state.reader?.confNo === confNo) {
      this.#setState({
        reader: { ...this.#state.reader, building: false },
      });
    }
  }

  #prefetch(fromPosition: number): void {
    const reader = this.#state.reader;
    if (!reader) return;

    const AHEAD = 5;
    for (let i = fromPosition + 1; i < Math.min(fromPosition + AHEAD, reader.queue.length); i++) {
      const textNo = reader.queue[i];
      if (!this.#textCache.has(textNo)) {
        this.getText(textNo).catch(() => {}); // fire-and-forget
      }
    }
  }

  async #refreshMembership(confNo: number): Promise<void> {
    try {
      const [membership, unread] = await Promise.all([
        this.getMembershipForPerson(this.getPersNo()!, confNo),
        this.getMembershipUnreadForPerson(this.getPersNo()!, confNo).catch(() => null),
      ]);
      if (unread) {
        membership.no_of_unread = unread.no_of_unread;
        membership.unread_texts = unread.unread_texts;
      }
      this.#setState({
        memberships: this.#state.memberships.map(m =>
          m.conference.conf_no === confNo ? membership : m
        ),
      });
    } catch {
      // Best-effort
    }
  }

  // ================================================================
  // Marks (Phase 8)
  // ================================================================

  async getMarks(): Promise<KomMark[]> {
    const response = await this.#http(
      { method: 'get', url: '/texts/marks/' },
      true,
      true
    );
    const body = response.data as { marks: KomMark[] };
    this.#setState({ marks: body.marks });
    return body.marks;
  }

  async createMark(textNo: number, type: number): Promise<void> {
    // Optimistic update
    const marks = [...this.#state.marks.filter(m => m.text_no !== textNo), { text_no: textNo, type }];
    this.#setState({ marks });

    await this.#http(
      { method: 'put', url: `/texts/${textNo}/mark`, data: { type } },
      true,
      true
    );
  }

  async deleteMark(textNo: number): Promise<void> {
    // Optimistic update
    const marks = this.#state.marks.filter(m => m.text_no !== textNo);
    this.#setState({ marks });

    await this.#http(
      { method: 'delete', url: `/texts/${textNo}/mark` },
      true,
      true
    );
  }

  // ================================================================
  // Event compatibility layer
  // ================================================================

  /** Backward-compatible event listener. Maps to subscribe internally. */
  on(name: string, listener: (event: unknown, ...args: unknown[]) => void): () => void {
    // Map the most common events to snapshot changes
    let prevSnapshot = this.#state;
    return this.subscribe(() => {
      const curr = this.#state;
      const event = { name, connection: this };

      if (name === 'jskom:connection:changed') {
        if (curr.connectionStatus !== prevSnapshot.connectionStatus ||
            curr.isLoggedIn !== prevSnapshot.isLoggedIn) {
          listener(event, this);
        }
      } else if (name === 'jskom:session:changed') {
        if (curr.isLoggedIn !== prevSnapshot.isLoggedIn ||
            curr.persNo !== prevSnapshot.persNo) {
          listener(event);
        }
      } else if (name === 'jskom:membership:changed') {
        if (curr.memberships !== prevSnapshot.memberships) {
          // Find which conferences changed
          const prevMap = new Map(prevSnapshot.memberships.map(m => [m.conference.conf_no, m]));
          for (const m of curr.memberships) {
            if (prevMap.get(m.conference.conf_no) !== m) {
              listener(event, m.conference.conf_no);
            }
          }
        }
      }

      prevSnapshot = curr;
    });
  }

  /** No-op for backward compatibility. Events are now state changes. */
  broadcast(_name: string, ..._args: unknown[]): void {
    // No-op — state changes trigger subscribers automatically
  }
}
