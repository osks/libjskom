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

export interface ReaderState {
  confNo: number;
  queue: number[];
  position: number;
  building: boolean;
  pending: number[];
}

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
  reader: ReaderState | null;
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
}
