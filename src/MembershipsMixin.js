export class MembershipsMixin {
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

  async addMembership(confNo) {
    return this.addMembershipForPerson(this.getPersNo(), confNo);
  }

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

  async deleteMembership(confNo) {
    return this.deleteMembershipForPerson(this.getPersNo(), confNo);
  }

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

  async getMembership(confNo) {
    return this.getMembershipForPerson(this.getPersNo(), confNo);
  }

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

  async getMemberships(options) {
    return this.getMembershipsForPerson(this.getPersNo(), options);
  }

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

  async getMembershipUnread(confNo) {
    return this.getMembershipUnreadForPerson(this.getPersNo(), confNo);
  }

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

  async getMembershipUnreads(conn) {
    return this.getMembershipUnreadsForPerson(this.getPersNo());
  }

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
