import eventBus from './EventBus.js';


// TODO: is this unlikely enough to not get duplicates?
let newId = function() {
  var min = 1;
  var max = 1000000000;
  // should be unique for each session within a specific browser
  // (i.e. localStorage instance).
  return "conn-" + (Math.floor(Math.random() * (max - min + 1)) + min);
};

export class HttpkomConnection {
  server_id; // httpkom's lyskom server_id
  id; // our own unique (per-browser) instance identifer
  httpkomId = null; // httpkom connection id
  session = null; // lyskom session

  httpkomServer = "/httpkom"; // httpkom url prefix
  httpkomConnectionHeader = "Httpkom-Connection";
  clientName = "libjskom";
  clientVersion = "0.1";
  cacheVersion = 0; // Set version number to add to URLs to break caches.
  cacheVersionKey = "_v";

  #pendingRequests = new Set();
  #createSessionPromise = null; // Promise used for creating a session.

  constructor({
    server_id,
    id = null,
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
    this.server_id = server_id;
    this.id = id ?? newId();
    this.httpkomId = httpkomId;
    this.session = session;

    this.httpkomServer = httpkomServer ?? this.httpkomServer;
    this.httpkomConnectionHeader = httpkomConnectionHeader ?? this.httpkomConnectionHeader;
    this.clientName = clientName ?? this.clientName;
    this.clientVersion = clientVersion ?? this.clientVersion;
    this.cacheVersion = cacheVersion ?? this.cacheVersion;
    this.cacheVersionKey = cacheVersionKey ?? this.cacheVersionKey;
  }

  // For saving connection to localStorage.
  toObject() {
    return {
      server_id: this.server_id,
      id: this.id,
      httpkomId: this.httpkomId,
      session: this.session,
    };
  }

  // For instantiating based on connection saved to localStorage.
  static fromObject({server_id, id, httpkomId, session}) {
    return new HttpkomConnection({server_id, id, httpkomId, session});
  }

  isConnected() {
    return Boolean(this.httpkomId && this.session);
  }

  isLoggedIn() {
    // Ensure we explicitly return a boolean.
    return Boolean(this.isConnected() && this.session.person);
  }

  async connect() {
    // TODO: Perhaps we should fail if already connected?

    const request = {
      method: 'post',
      url: '/sessions/',
      data: { client: { name: this.clientName, version: this.clientVersion } }
    };

    const response = await this.http(request, false, false);
    this.httpkomId = response.data.connection_id;
    // Remove the connection_id from the session. We clone using spread.
    const session = { ...response.data };
    delete session.connection_id;
    this.session = session;
    //this.clearAllCaches();
    this.broadcast('jskom:connection:changed', this);
    this.broadcast('jskom:session:created', session);
    return session;
  }

  async disconnect(sessionNo = 0) {
    const response = await this.http(
      { method: 'delete', url: `/sessions/${sessionNo}` },
      true,
      false
    );
    // Check if we deleted our own session
    if (sessionNo === 0 || sessionNo === this.session.session_no) {
      this.httpkomId = null;
      this.session = null;
      //this.clearAllCaches();
      this.broadcast('jskom:connection:changed', this);
      this.broadcast('jskom:session:deleted');
    }
    return response.data;
  }

  /**
   * Create an internal broadcast name by combining eventName with the connection id.
   */
  #getBroadcastName(eventName) {
    return `${eventName}:${this.id}`;
  }

  /**
   * Broadcast an event.
   *
   * Instead of AngularJS $broadcast, we use the simple event emitter.
   * Any attached listener will receive an event object that contains
   * the actual event name (without our internal suffix), the connection, and any additional arguments.
   */
  broadcast(eventName, ...args) {
    // The event object: overwrite the name property to the original event name.
    const eventObject = {
      name: eventName,
      connection: this,
      args
    };

    eventBus.emit(this.#getBroadcastName(eventName), eventObject);
  }

  /**
   * Attach an event listener.
   * Returns an unsubscribe function.
   */
  on(name, listenerFn) {
    // The stored event name includes the connection id.
    return eventBus.on(this.#getBroadcastName(name), (event) => {
      // We check that the event belongs to this connection.
      if (event.connection === this) {
        // Call the listener with the event object and extra args.
        listenerFn(event, ...event.args);
      }
    });
  }

  /**
   * Construct the full URL.
   * Optionally add the httpkomId as a query parameter.
   */
  urlFor(path, addHttpkomIdQueryParameter) {
    let url = `${this.httpkomServer}/${this.server_id}${path}`;
    if (addHttpkomIdQueryParameter) {
      const kv = `${encodeURIComponent(this.httpkomConnectionHeader)}=${encodeURIComponent(this.httpkomId)}`;
      url += (url.indexOf('?') === -1 ? '?' : '&') + kv;
    }
    if (this.cacheVersion != null) {
      const kv = `${encodeURIComponent(this.cacheVersionKey)}=${encodeURIComponent(this.cacheVersion)}`;
      url += (url.indexOf('?') === -1 ? '?' : '&') + kv;
    }
    return url;
  }

  /**
   * Our http request wrapper.
   *
   * 1. If a request requires login and the user is not logged in, it is immediately rejected.
   * 2. If a request requires a session and there is none, create a new session first and then retry.
   * 3. If the request fails with a 403 (and login is not required), then try to create a new session and retry.
   */
  async http(config, requireSession = false, requireLogin = false) {
    // Prefix URL with the httpkom server and server id
    config.url = this.urlFor(config.url, false);
    // Requests that require login fail immediately if not logged in.
    if (requireLogin && !this.isLoggedIn()) {
      console.log("HttpkomConnection - http() - failing request that requires login");
      throw {
        data: null,
        status: 401,
        headers: null,
        config
      };
    }

    try {
      // If session is required but we are not connected, create a session first
      if (requireSession && !this.isConnected()) {
        console.log("HttpkomConnection - http() - retrying request after create session");
        return await this.#createSessionAndRetry(config, requireSession, requireLogin);
      }

      // Try the request
      return await this.#request(config, requireSession, requireLogin);
    } catch (error) {
      // If the error is 403 and login is not required, try to create a new session.
      if (error.status === 403 && !requireLogin) {
        return await this.#createSessionAndRetry(config, requireSession, requireLogin);
      }
      // Otherwise, propagate the error.
      throw error;
    }
  }

  async #request(config, requireSession, requireLogin) {
    const controller = new AbortController();
    const headers = new Headers(config.headers || {});

    if (requireSession) {
      headers.set(this.httpkomConnectionHeader, this.httpkomId);
    }

    if (config.method?.toLowerCase() === 'post') {
      headers.set('Cache-Control', 'no-cache');
    }

    let body = null;
    if (config.data && typeof config.data === 'object') {
      body = JSON.stringify(config.data);
      headers.append('Content-Type', 'application/json');
    } else {
      body = config.data;
    }

    const fetchConfig = {
      method: config.method || 'GET',
      headers: headers,
      body: body,
      signal: controller.signal,
      mode: 'cors',
    };

    this.#addPendingRequest(controller, requireSession, requireLogin);

    try {
      const response = await fetch(config.url, fetchConfig);

      if (!this.#hasPendingRequest(controller)) {
        return;
      }

      // Optionally check if there's no content at all
      if (response.status === 204 || response.headers.get('Content-Length') === '0') {
        // Clear pending request if necessary and return an appropriate object
        this.#removePendingRequest(controller);
        return { data: null, status: response.status, headers: response.headers };
      }

      // Check if response content is JSON based on the Content-Type header
      const contentType = response.headers.get('Content-Type');

      // Parse the response accordingly
      let payload;
      if (contentType && contentType.indexOf('application/json') !== -1) {
        payload = await response.json();
      } else {
        // For non-JSON responses, you could read as text or handle appropriately
        payload = await response.text();
      }

      if (!response.ok) {
        throw { status: response.status, data: payload };
      }

      // Remove the pending request before returning
      this.#removePendingRequest(controller);

      return { data: payload, status: response.status, headers: response.headers };
    } catch (error) {
      if (!this.#hasPendingRequest(controller)) {
        return;
      }
      this.#removePendingRequest(controller);

      const status = error.status;
      if (status === 401) {
        console.log("HttpkomConnection - #request() - 401:", config.url);
        this.#cancelAllPendingRequestsRequiringLogin();
        this.#resetPerson();
      } else if (status === 403) {
        console.log("HttpkomConnection - #request() - 403:", config.url);
        this.#cancelAllPendingRequestsRequiringSession();
        this.#resetSession();
      } else if (status === 502) {
        console.log("HttpkomConnection - #request() - 502:", config.url);
        this.#cancelAllPendingRequestsRequiringSession();
      } else if (status === 500) {
        console.log("HttpkomConnection - #request() - 500:", config.url);
        const errorData = error.data;
        if (errorData?.error_type === 'httpkom' && errorData.error_msg === '') {
          this.#cancelAllPendingRequestsRequiringSession();
          this.#resetSession();
        }
      }
      throw error;
    }
  }

  #resetSession() {
    if (this.httpkomId || this.session) {
      this.httpkomId = null;
      this.session = null;
      //this.membershipListHandler.reset(); // commented out because it seems the MembershipListHandler already listens on this
      this.broadcast('jskom:connection:changed', this);
    }
  }

  #resetPerson() {
    if (this.isLoggedIn()) {
      this.session.person = null;
      //this.membershipListHandler.reset(); // commented out because it seems the MembershipListHandler already listens on this
      this.broadcast('jskom:connection:changed', this);
    }
  }

  #addPendingRequest(controller, requireSession, requireLogin) {
    this.#pendingRequests.add({ controller, requireLogin, requireSession });
  }

  #removePendingRequest(controller) {
    for (const req of this.#pendingRequests) {
      if (req.controller === controller) {
        this.#pendingRequests.delete(req);
        break;
      }
    }
  }

  #findPendingRequest(controller) {
    for (const req of this.#pendingRequests) {
      if (req.controller === controller) return req;
    }
    return null;
  }

  #hasPendingRequest(controller) {
    return this.#findPendingRequest(controller) !== null;
  }

  #cancelAllPendingRequestsRequiringLogin() {
    console.log("HttpkomConnection - canceling all requests requiring login");
    for (const req of [...this.#pendingRequests]) {
      if (req.requireLogin) {
        req.controller.abort();
        this.#pendingRequests.delete(req);
      }
    }
  }

  #cancelAllPendingRequestsRequiringSession() {
    this.#cancelAllPendingRequestsRequiringLogin();
    console.log("HttpkomConnection - canceling all requests requiring session");
    for (const req of [...this.#pendingRequests]) {
      if (req.requireSession) {
        req.controller.abort();
        this.#pendingRequests.delete(req);
      }
    }
  }

  //
  // Start of session methods
  //

  /**
   * Create a new session (if needed) and then retry the original request.
   * Returns a Promise for the request.
   */
  async #createSessionAndRetry(originalRequest, requireSession, requireLogin) {
    console.log("HttpkomConnection - createSessionAndRetry(): " + originalRequest.url);

    if (this.#createSessionPromise === null) {
      this.#createSessionPromise = this.createSession(this.clientName, this.clientVersion);
      try {
        await this.#createSessionPromise;
      } catch (err) {
        this.#createSessionPromise = null;
        throw { data: null, status: 403, headers: null, config: originalRequest };
      }
      // Reset the createSessionPromise after a successful session creation.
      this.#createSessionPromise = null;
    } else {
      // Wait for any existing session creation promise.
      try {
        await this.#createSessionPromise;
      } catch (err) {
        throw { data: null, status: 403, headers: null, config: originalRequest };
      }
    }
    // Retry the original request.
    return await this.#request(originalRequest, requireSession, requireLogin);
  }

}
