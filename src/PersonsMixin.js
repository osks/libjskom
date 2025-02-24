export class PersonsMixin {
  async createPerson(name, passwd) {
    const data = {
      name: name,
      passwd: passwd
    };

    const response = await this.conn.http({
      method: 'post',
      url: '/persons/',
      data
    }, true, false);

    return response.data;
  }

  async setPresentation(persNo, textNo) {
    return this.conn.http({
      method: 'post',
      url: `/persons/${persNo}/set-presentation`,
      data: { text_no: textNo }
    }, true, false);
  }

  async setPassword(persNo, oldPwd, newPwd) {
    return this.conn.http({
      method: 'post',
      url: `/persons/${persNo}/set-passwd`,
      data: {
        old_pwd: oldPwd,
        new_pwd: newPwd
      }
    }, true, false);
  }
}
