export class SessionsMixin {
  /**
   * Send a user-active signal to the server.
   * Requires an active session and login.
   * @returns {Promise<void>}
   */
  async userIsActive() {
    return this.http({ method: 'post', url: '/sessions/current/active' }, true, true);
  }

  /**
   * Log in to the current session. Provide either `persNo` or `name`.
   * @param {Object} credentials
   * @param {number} [credentials.persNo] - Person number to log in as.
   * @param {string} [credentials.name] - Person name to log in as.
   * @param {string} credentials.passwd - Password.
   * @returns {Promise<{ pers_no: number, pers_name: string }>} The logged-in person.
   * @throws {Error} If neither persNo nor name is provided.
   */
  async login({ persNo, name, passwd }) {
    const data = {};

    if (persNo !== undefined) {
      data.pers_no = persNo;
    } else if (name !== undefined) {
      data.pers_name = name;
    } else {
      throw new Error('Either persNo or name must be provided');
    }

    const request = {
      method: 'post',
      url: '/sessions/current/login',
      data: { ...data, passwd: passwd },
    };

    const response = await this.http(request, true, false);
    this.session.person = response.data;
    //this.clearAllCaches(); // fixme
    // Ensure the session remains marked as active
    await this.userIsActive();
    this.broadcast('jskom:connection:changed', this);
    this.broadcast('jskom:session:changed');
    return response.data;
  }

  /**
   * Log out from the current session. The session remains connected.
   * @returns {Promise<*>}
   */
  async logout() {
    const response = await this.http(
      { method: 'post', url: '/sessions/current/logout' },
      true,
      true
    );
    this.session.person = null;
    //this.clearAllCaches(); // fixme
    this.broadcast('jskom:connection:changed', this);
    this.broadcast('jskom:session:changed');
    return response.data;
  }
}
