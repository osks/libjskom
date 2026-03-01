/**
 * @typedef {Object} Membership
 * @property {{ conf_no: number, name: string, highest_local_no: number, nice: number, type: Object }} conference
 * @property {number} pers_no
 * @property {number} priority
 * @property {number} position
 * @property {string} added_at
 * @property {string} last_time_read
 * @property {{ pers_no: number, pers_name: string }} added_by
 * @property {{ invitation: number, passive: number, secret: number, passive_message_invert: number }} type
 */

/**
 * @typedef {Object} MembershipUnread
 * @property {number} conf_no
 * @property {number} pers_no
 * @property {number} no_of_unread
 * @property {number[]} unread_texts
 */

export class MembershipsMixin {
  /**
   * Set the number of unread texts in a conference for the logged-in user.
   * @param {number} confNo - Conference number.
   * @param {number} noOfUnread - Number of texts to mark as unread.
   * @returns {Promise<void>}
   */
  async setNumberOfUnreadTexts(confNo, noOfUnread) {
    const data = { no_of_unread: parseInt(noOfUnread, 10) };
    try {
      await this.http(
        {
          method: 'post',
          url: `/persons/current/memberships/${confNo}/unread`,
          data
        },
        true,
        true
      );
      this.broadcast('jskom:membership:changed', confNo);
      this.broadcast('jskom:membershipUnread:changed', confNo);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Add a membership for the logged-in user.
   * @param {number} confNo - Conference number to join.
   * @returns {Promise<void>}
   */
  async addMembership(confNo) {
    return this.addMembershipForPerson(this.getPersNo(), confNo);
  }

  /**
   * Add a membership for a specific person.
   * @param {number} persNo - Person number.
   * @param {number} confNo - Conference number.
   * @returns {Promise<void>}
   */
  async addMembershipForPerson(persNo, confNo) {
    const data = { priority: 100 };
    try {
      await this.http(
        {
          method: 'put',
          url: `/persons/${persNo}/memberships/${confNo}`,
          data
        },
        true,
        true
      );
      // Only broadcast changes if for the current person.
      if (this.getPersNo() === persNo) {
        this.broadcast('jskom:membership:created', confNo);
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Delete a membership for the logged-in user.
   * @param {number} confNo - Conference number to leave.
   * @returns {Promise<void>}
   */
  async deleteMembership(confNo) {
    return this.deleteMembershipForPerson(this.getPersNo(), confNo);
  }

  /**
   * Delete a membership for a specific person.
   * @param {number} persNo - Person number.
   * @param {number} confNo - Conference number.
   * @returns {Promise<void>}
   */
  async deleteMembershipForPerson(persNo, confNo) {
    try {
      await this.http(
        {
          method: 'delete',
          url: `/persons/${persNo}/memberships/${confNo}`
        },
        true,
        true
      );
      if (this.getPersNo() === persNo) {
        this.broadcast('jskom:membership:deleted', confNo);
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get a single membership for the logged-in user.
   * @param {number} confNo - Conference number.
   * @returns {Promise<Membership>}
   */
  async getMembership(confNo) {
    return this.getMembershipForPerson(this.getPersNo(), confNo);
  }

  /**
   * Get a single membership for a specific person.
   * @param {number} persNo - Person number.
   * @param {number} confNo - Conference number.
   * @returns {Promise<Membership>}
   */
  async getMembershipForPerson(persNo, confNo) {
    try {
      const response = await this.http(
        {
          method: 'get',
          url: `/persons/${persNo}/memberships/${confNo}`
        },
        true,
        true
      );
      console.log(`memberships - getMembershipForPerson(${persNo}, ${confNo}) - success`);
      return response.data;
    } catch (error) {
      console.log(`memberships - getMembershipForPerson(${persNo}, ${confNo}) - error`);
      return Promise.reject(error);
    }
  }

  /**
   * List memberships for the logged-in user.
   * @param {Object} [options]
   * @param {boolean} [options.unread=false] - If true, only return memberships with unread texts.
   * @param {number} [options.first] - Index of the first membership to return (for pagination).
   * @param {number} [options.noOfMemberships] - Maximum number of memberships to return.
   * @returns {Promise<{ memberships: Membership[], has_more: boolean }>}
   */
  async getMemberships(options) {
    return this.getMembershipsForPerson(this.getPersNo(), options);
  }

  /**
   * List memberships for a specific person.
   * @param {number} persNo - Person number.
   * @param {Object} [options]
   * @param {boolean} [options.unread=false] - If true, only return memberships with unread texts.
   * @param {number} [options.first] - Index of the first membership to return (for pagination).
   * @param {number} [options.noOfMemberships] - Maximum number of memberships to return.
   * @returns {Promise<{ memberships: Membership[], has_more: boolean }>}
   */
  async getMembershipsForPerson(persNo, options = { unread: false }) {
    // Build request parameters.
    const params = { unread: options.unread };
    if (options.first !== undefined) {
      params.first = options.first;
    }
    if (options.noOfMemberships !== undefined) {
      params["no-of-memberships"] = options.noOfMemberships;
    }
    const logPrefix = `memberships - getMembershipsForPerson(${persNo}, ${JSON.stringify(options)}) - `;
    try {
      const response = await this.http(
        {
          method: 'get',
          url: `/persons/${persNo}/memberships/`,
          params
        },
        true,
        true
      );
      console.log(`${logPrefix}success`);
      return response.data;
    } catch (error) {
      console.log(`${logPrefix}error`);
      return Promise.reject(error);
    }
  }

  /**
   * Get unread information for a single membership of the logged-in user.
   * @param {number} confNo - Conference number.
   * @returns {Promise<MembershipUnread>}
   */
  async getMembershipUnread(confNo) {
    return this.getMembershipUnreadForPerson(this.getPersNo(), confNo);
  }

  /**
   * Get unread information for a single membership of a specific person.
   * @param {number} persNo - Person number.
   * @param {number} confNo - Conference number.
   * @returns {Promise<MembershipUnread>}
   */
  async getMembershipUnreadForPerson(persNo, confNo) {
    const logPrefix = `memberships - getMembershipUnreadForPerson(${persNo}, ${confNo}) - `;
    try {
      const response = await this.http(
        {
          method: 'get',
          url: `/persons/${persNo}/memberships/${confNo}/unread`
        },
        true,
        true
      );
      console.log(`${logPrefix}success`);
      return response.data;
    } catch (error) {
      console.log(`${logPrefix}error`);
      return Promise.reject(error);
    }
  }

  /**
   * Get unread counts for all memberships of the logged-in user.
   * @returns {Promise<MembershipUnread[]>}
   */
  async getMembershipUnreads(conn) {
    return this.getMembershipUnreadsForPerson(this.getPersNo());
  }

  /**
   * Get unread counts for all memberships of a specific person.
   * @param {number} persNo - Person number.
   * @returns {Promise<MembershipUnread[]>}
   */
  async getMembershipUnreadsForPerson(persNo) {
    const logPrefix = `memberships - getMembershipUnreadsForPerson(${persNo}) - `;
    try {
      const response = await this.http(
        {
          method: 'get',
          url: `/persons/${persNo}/memberships/unread/`
        },
        true,
        true
      );
      console.log(`${logPrefix}success`);
      return response.data.list;
    } catch (error) {
      console.log(`${logPrefix}error`);
      return Promise.reject(error);
    }
  }
}
