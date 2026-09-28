// === Session & Connection ===

export interface Session {
  session_no: number;
  person: Person | null;
}

export interface Person {
  pers_no: number;
  pers_name: string;
}

export interface LyskomServer {
  id: string;
  name: string;
  host: string;
  port: number;
}

export type ConnectionStatus = 'disconnected' | 'connected' | 'reconnecting';

// === Conferences ===

export interface Conference {
  conf_no: number;
  name: string;
  highest_local_no: number;
  nice: number;
  type: ConfType;
}

export interface ConfType {
  rd_prot: number;
  original: number;
  secret: number;
  letterbox: number;
  allow_anonymous: number;
  forbid_secret: number;
  reserved2: number;
  reserved3: number;
}

// === Memberships ===

export interface Membership {
  conference: Conference;
  pers_no: number;
  priority: number;
  position: number;
  added_at: string;
  last_time_read: string;
  added_by: Person;
  type: MembershipType;
  no_of_unread: number;
  unread_texts: number[];
}

export interface MembershipType {
  invitation: number;
  passive: number;
  secret: number;
  passive_message_invert: number;
}

export interface MembershipUnread {
  conf_no: number;
  pers_no: number;
  no_of_unread: number;
  unread_texts: number[];
}

// === Texts ===

export interface KomText {
  text_no: number;
  subject: string;
  body: string;
  content_type: string;
  author: Person;
  creation_time: string;
  no_of_marks: number;
  recipient_list: MIRecipient[];
  comment_to_list: MICommentRef[];
  comment_in_list: MICommentRef[];
  aux_items: AuxItem[];
}

/** A text's metadata: everything but subject, body and content type. Can change. */
export type KomTextStat = Omit<KomText, 'subject' | 'body' | 'content_type'>;

/** A text's contents. Never changes once the text is created. */
export interface KomTextBody {
  subject: string;
  body: string;
  content_type: string;
}

/** A text stat as stored in a TextStore, with when it was fetched. */
export interface StoredTextStat {
  stat: KomTextStat;
  /** Milliseconds since the epoch */
  fetchedAt: number;
}

/**
 * Persistent storage for the text cache, e.g. IndexedDB in a browser.
 * Bodies and stats are separate: bodies never change, stats do. Which
 * server and person the texts belong to is up to the implementation (one
 * store per server and person). Limits and eviction too.
 */
export interface TextStore {
  getBodies(textNos: number[]): Promise<Map<number, KomTextBody>>;
  getStats(textNos: number[]): Promise<Map<number, StoredTextStat>>;
  putBody(textNo: number, body: KomTextBody): Promise<void>;
  putStat(textNo: number, stat: StoredTextStat): Promise<void>;
  delete(textNo: number): Promise<void>;
  clear(): Promise<void>;
}

export interface MICommentRef {
  type: 'comment' | 'footnote';
  text_no: number;
  author: Person;
}

export interface MIRecipient {
  type: 'to' | 'cc' | 'bcc';
  recpt: { conf_no: number; name: string };
  loc_no: number;
  sent_by?: Person;
}

export interface AuxItem {
  aux_no: number;
  tag: string;
  creator: Person;
  created_at: string;
  flags: {
    deleted: boolean;
    inherit: boolean;
    secret: boolean;
    hide_creator: boolean;
    dont_garb: boolean;
  };
  inherit_limit: number;
  data: string;
}

// === Marks ===

export interface KomMark {
  text_no: number;
  type: number;
}

// === Reader ===

// --- Reader types ---

// ReadInfoType categorizes entries in the reading list. These types
// originate from the elisp LysKOM client's read-info model and are
// a client-side concept — Protocol A has no notion of reading lists.
//
// - CONF:    Unread texts discovered from a conference membership's
//            unread_texts list. The normal reading flow.
// - COMM-IN: Comments on a text the user just read, discovered lazily
//            during advance(). Prepended to the reading list for DFS.
// - FOOTN-IN: Footnotes on a text. Like COMM-IN but read before comments.
// - REVIEW:  Explicitly requested text view (e.g. "show parent",
//            "show commented text", viewing a marked text). Unlike the
//            other types, REVIEW bypasses the isUnread check — the text
//            may have already been read. The caller decides whether to
//            mark it as read. In the elisp client, REVIEW entries are
//            never marked as read; our caller (LyskomClient) can choose
//            the same behavior.
export type ReadInfoType = 'CONF' | 'COMM-IN' | 'FOOTN-IN' | 'REVIEW';

export interface ReadInfo {
  type: ReadInfoType;
  confNo: number;
  textList: number[];
  commTo?: number;
}

export interface AdvanceResult {
  textNo: number;
  type: ReadInfoType;
  confNo: number;
  commTo?: number;
}

export interface ReaderSnapshot {
  currentConfNo: number | null;
  readingList: ReadInfo[];
  allRead: boolean;
  /** Whether advance() will show a text before moving to another conference. */
  hasPendingText: boolean;
  /** Conference that advance() moves to when no text is pending. */
  nextConfNo: number | null;
  advancing: boolean;
}

export type TextGetter = (textNo: number) => Promise<KomText | undefined>;
export type GetMemberships = () => Membership[];

// === Snapshot ===

export interface Snapshot {
  connectionStatus: ConnectionStatus;
  isLoggedIn: boolean;
  persNo: number | null;
  personName: string | null;
  serverId: string;
  servers: Record<string, LyskomServer>;
  memberships: Membership[];
  texts: Map<number, KomText>;
  reader: ReaderSnapshot | null;
  marks: KomMark[];
}

// === Client ===

export interface ClientObject {
  id: string;
  lyskomServerId: string;
  httpkomId: string | null;
  session: Session | null;
}

export interface LyskomClientOptions {
  id?: string | null;
  lyskomServerId?: string;
  httpkomId?: string | null;
  session?: Session | null;
  httpkomServer?: string;
  httpkomConnectionHeader?: string;
  clientName?: string;
  clientVersion?: string;
  cacheVersion?: number | null;
  cacheVersionKey?: string;
  /** Abort requests that get no response within this time. Default 30000. */
  requestTimeoutMs?: number;
  /** Persistent text cache; without it, texts are only cached in memory. */
  textStore?: TextStore;
}
