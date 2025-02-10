export class Sessions {
  conn;

  constructor(conn) {
    this.conn = conn;
  }

  // Methods on current session:

  async userIsActive() {
    return this.conn.http({ method: 'post', url: '/sessions/current/active' }, true, true);
  }

  async login(persNo, passwd) {
    const request = {
      method: 'post',
      url: '/sessions/current/login',
      data: {pers_no: persNo, passwd: passwd},
    };

    const response = await this.conn.http(request, true, false);
    this.conn.session.person = response.data;
    this.conn.clearAllCaches();
    // Ensure the session remains marked as active
    await this.userIsActive();
    this.conn.broadcast('jskom:connection:changed', conn);
    this.conn.broadcast('jskom:session:changed');
    return response.data;
  }

  async logout() {
    const response = await this.conn.http(
      { method: 'post', url: '/sessions/current/logout' },
      true,
      true
    );
    this.conn.session.person = null;
    this.conn.clearAllCaches();
    this.conn.broadcast('jskom:connection:changed', conn);
    this.conn.broadcast('jskom:session:changed');
    return response.data;
  }
}
