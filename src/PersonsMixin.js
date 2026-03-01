export class PersonsMixin {
  /**
   * Create a new person (user account) on the LysKOM server.
   * Requires an active session (but not login).
   * @param {string} name - Name for the new person.
   * @param {string} passwd - Password for the new person.
   * @returns {Promise<{ pers_no: number, pers_name: string }>} The created person.
   */
  async createPerson(name, passwd) {
    const data = {
      name: name,
      passwd: passwd
    };

    const response = await this.http({
      method: 'post',
      url: '/persons/',
      data
    }, true, false);

    return response.data;
  }

  /**
   * Set the presentation text for a person.
   * @param {number} persNo - Person number.
   * @param {number} textNo - Text number to use as presentation.
   * @returns {Promise<void>}
   */
  async setPresentation(persNo, textNo) {
    return this.http({
      method: 'post',
      url: `/persons/${persNo}/set-presentation`,
      data: { text_no: textNo }
    }, true, false);
  }

  /**
   * Change a person's password.
   * @param {number} persNo - Person number.
   * @param {string} oldPwd - Current password.
   * @param {string} newPwd - New password.
   * @returns {Promise<void>}
   */
  async setPassword(persNo, oldPwd, newPwd) {
    return this.http({
      method: 'post',
      url: `/persons/${persNo}/set-passwd`,
      data: {
        old_pwd: oldPwd,
        new_pwd: newPwd
      }
    }, true, false);
  }
}
