export class Persons {
  conn;

  constructor(conn) {
    this.conn = conn;
  }

  async createPerson(name, passwd) {
    const request = {
      method: 'post',
      url: '/persons/',
      data: { name: name, passwd: passwd },
    };
    const response = await this.conn.http(request, true, false);
    return response.data;
  }
}
