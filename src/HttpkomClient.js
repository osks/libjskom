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


class HttpkomClient extends HttpkomConnection{
  currentConferenceNo = 0; // The conference number for the current working conference.
  memberships;

  #membershipListHandler;

  // Variables for user-active functionality.
  #userActiveIntervalMs = 40 * 1000; // ms
  #userActiveLastSent = null;
  #userActivePromise = null;

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

  static async getLyskomServers() {
    let url = `${this.httpkomServer}/`;
    if (this.cacheVersion != null) {
      const kv = `${encodeURIComponent(this.cacheVersionKey)}=${encodeURIComponent(this.cacheVersion)}`;
      url += (url.indexOf('?') === -1 ? '?' : '&') + kv;
    }
    const fetchConfig = {
      method: 'GET',
      mode: 'cors',
    };
    const response = await fetch(url, fetchConfig);
    return await response.json();
  }


  async getMembershipList() {
    return await this.#membershipListHandler.getMembershipList();
  }


  getPersNo() {
    if (this.isLoggedIn()) {
      return this.session.person.pers_no;
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
