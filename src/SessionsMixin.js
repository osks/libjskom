export class SessionsMixin {
  async userIsActive() {
    return this.http({ method: 'post', url: '/sessions/current/active' }, true, true);
  }

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
