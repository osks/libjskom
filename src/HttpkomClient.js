import { HttpkomConnection } from './HttpkomConnection.js';
import { MembershipList } from './MembershipList.js';
import { MembershipListHandler } from './MembershipListHandler.js';

import { MembershipsMixin } from './MembershipsMixin.js';
import { SessionsMixin } from './SessionsMixin.js';
import { PersonsMixin } from './PersonsMixin.js';

// Create a helper to mix in methods to the target prototype.
function mixin(target, source) {
  Object.getOwnPropertyNames(source.prototype).forEach(name => {
    if (name !== 'constructor') {
      target.prototype[name] = source.prototype[name];
    }
  });
}


/**
 * Full-featured LysKOM client. Extends `HttpkomConnection` with
 * session management, person operations, membership handling, and
 * conference tracking.
 *
 * @extends HttpkomConnection
 * @mixes SessionsMixin
 * @mixes PersonsMixin
 * @mixes MembershipsMixin
 */
class HttpkomClient extends HttpkomConnection{
  /** @type {number} */
  currentConferenceNo = 0;
  memberships;

  #membershipListHandler;

  // Variables for user-active functionality.
  #userActiveIntervalMs = 40 * 1000; // ms
  #userActiveLastSent = null;
  #userActivePromise = null;

  /** @param {HttpkomConnectionOptions} [options] */
  constructor({
    // For restoring a connection from localStorage:
    id,
    lyskomServerId,
    httpkomId,
    session,

    // Settings
    httpkomServer,
    httpkomConnectionHeader,
    clientName,
    clientVersion,
    cacheVersion,
    cacheVersionKey,
  } = {}) {
    super({
      id,
      lyskomServerId,
      httpkomId,
      session,
      httpkomServer,
      httpkomConnectionHeader,
      clientName,
      clientVersion,
      cacheVersion,
      cacheVersionKey,
    });

    this.#membershipListHandler = new MembershipListHandler(
      this, this.memberships, new MembershipList());

    //this.textsCache = this._jskomCacheFactory(this.id + '-texts', { capacity: 100 });
    //this.marksCache = this._jskomCacheFactory(this.id + '-marks', { capacity: 100 });
  }


  /**
   * Restore a client from a serialized object (e.g. from localStorage).
   * @param {{ id: string, lyskomServerId: string, httpkomId: ?string, session: ?Session }} obj
   * @returns {HttpkomClient}
   */
  static fromObject({id, lyskomServerId, httpkomId, session}) {
    return new HttpkomClient({id, lyskomServerId, httpkomId, session});
  }


  /**
   * Get the membership list, initializing it if needed.
   * The list is managed by the internal MembershipListHandler which
   * auto-refreshes unread counts.
   * @returns {Promise<MembershipList>}
   */
  async getMembershipList() {
    return await this.#membershipListHandler.getMembershipList();
  }


  /**
   * Get the person number of the logged-in user.
   * @returns {?number} Person number, or null if not logged in.
   */
  getPersNo() {
    if (this.isLoggedIn()) {
      return this.session.person.pers_no;
    } else {
      return null;
    }
  }

  /**
   * Signal that the user is active. Throttled to at most once per 40 seconds.
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

  /**
   * Change the current working conference. This updates the server's
   * last-time-read for the previous conference.
   * @param {number} confNo - Conference number to switch to.
   * @returns {Promise<void>}
   */
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
      await this.http(request, true, true);
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
    console.log("HttpkomClient - connection(id: " + this.id + ") - clearing all caches");
    this.textsCache.removeAll();
    this.marksCache.removeAll();
  }

  destroyAllCaches() {
    this.textsCache.destroy();
    this.marksCache.destroy();
  }*/

}

mixin(HttpkomClient, MembershipsMixin);
mixin(HttpkomClient, PersonsMixin);
mixin(HttpkomClient, SessionsMixin);

export { HttpkomClient };
