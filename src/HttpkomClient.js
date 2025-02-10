import { HttpkomConnection } from './HttpkomConnection.js';
import { MembershipList } from './MembershipList.js';
import { MembershipListHandler } from './MembershipListHandler.js';
import { Memberships } from './Memberships.js';
import { Sessions } from './Sessions.js';


export class HttpkomClient {
  conn;

  currentConferenceNo = 0; // The conference number for the current working conference.
  memberships;
  sessions;

  #membershipListHandler;

  // Variables for user-active functionality.
  #userActiveIntervalMs = 40 * 1000; // ms
  #userActiveLastSent = null;
  #userActivePromise = null;

  constructor({
    server_id,

    // For restoring a connection from localStorage:
    id,
    httpkomId,
    session,

    httpkomServer,
  } = {}) {
    this.conn = new HttpkomConnection({
      server_id,
      id,
      httpkomId,
      session,
      httpkomServer,
    });

    this.memberships = new Memberships(this.conn);
    this.#membershipListHandler = new MembershipListHandler(
      this.conn, this.memberships, new MembershipList());
    this.sessions = new Sessions(this.conn);

    //this.textsCache = this._jskomCacheFactory(this.id + '-texts', { capacity: 100 });
    //this.marksCache = this._jskomCacheFactory(this.id + '-marks', { capacity: 100 });

  }

  async getMembershipList() {
    return await this.#membershipListHandler.getMembershipList();
  }


  getPersNo() {
    if (this.conn.isLoggedIn()) {
      return this.conn.session.person.pers_no;
    } else {
      return null;
    }
  }

  /**
   * Indicates that the user is active.
   * This sends a "user-active" signal.
   */
  userIsActive() {
    if (this.#userActiveLastSent == null ||
        Date.now() - this.#userActiveIntervalMs >= this.#userActiveLastSent) {
      if (this.#userActivePromise == null) {
        console.log(`HttpkomClient - userIsActive(${this.getPersNo()}) - sending new user-active`);
        this.#userActivePromise = this.session.userIsActive()
          .then(() => {
            this.#userActivePromise = null;
            // Only update on a successful response.
            this.#userActiveLastSent = Date.now();
          })
          .catch(() => {
            this.#userActivePromise = null;
          });
      }
    }
  }

  async changeConference(confNo) {
    confNo = parseInt(confNo, 10);
    const request = {
      method: 'post',
      url: '/sessions/current/working-conference',
      data: { conf_no: confNo }
    };
    const previousConfNo = this.currentConferenceNo;
    this.currentConferenceNo = confNo; // update pre-request
    try {
      await this.conn.http(request, true, true);
      console.log(`HttpkomClient - changeConference(${confNo})`);
      // Changing conference triggers the lyskom server to update the last-time-read for the previous conference.
      this.currentConferenceNo = confNo; // ensure the correct conf is stored
      if (previousConfNo !== 0) {
        // Broadcast a change for the previous conference if necessary.
        this.broadcast('jskom:membership:changed', previousConfNo);
      }
    } catch (error) {
      this.currentConferenceNo = previousConfNo; // revert if the request failed
      return Promise.reject(error);
    }
  }

  /*
  clearAllCaches() {
    console.log("HttpkomClient - connection(id: " + this.conn.id + ") - clearing all caches");
    this.textsCache.removeAll();
    this.marksCache.removeAll();
  }

  destroyAllCaches() {
    this.textsCache.destroy();
    this.marksCache.destroy();
  }*/

}
