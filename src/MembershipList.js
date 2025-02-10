// The MembershipList stores the memberships. It provides
// methods for accessing the full list of membership and the
// list of unread memberships separately.

export class MembershipList {
  constructor() {
    this._membershipsMap = {};
    this._membershipUnreadsMap = null;
    this._unreadMemberships = null;
    this._readMemberships = null;
  }

  _patchMembership(membership) {
    const confNo = membership.conference.conf_no;
    if (this._membershipUnreadsMap && Object.prototype.hasOwnProperty.call(this._membershipUnreadsMap, confNo)) {
      const mu = this._membershipUnreadsMap[confNo];
      membership.no_of_unread = mu.no_of_unread;
      membership.unread_texts = mu.unread_texts;
    } else {
      membership.no_of_unread = 0;
      membership.unread_texts = [];
    }
  }

  _rebuildMembershipLists() {
    if (this._membershipUnreadsMap !== null) {
      // Patch each membership
      Object.values(this._membershipsMap).forEach(m => this._patchMembership(m));

      // Build the read memberships list (no unread texts)
      this._readMemberships = Object.values(this._membershipsMap).filter(
        m => m.no_of_unread === 0
      );

      // Build the unread memberships list (has unread texts)
      this._unreadMemberships = Object.values(this._membershipsMap).filter(
        m => m.no_of_unread > 0
      );
    }
  }

  clear() {
    this._membershipsMap = {};
    this._membershipUnreadsMap = null;
    this._unreadMemberships = null;
    this._readMemberships = null;
  }

  // Must return the same object if nothing has changed.
  getReadMemberships() {
    return this._readMemberships;
  }

  // Must return the same object if nothing has changed.
  getUnreadMemberships() {
    return this._unreadMemberships;
  }

  // Must return the same object if nothing has changed.
  getMembership(confNo) {
    if (Object.prototype.hasOwnProperty.call(this._membershipsMap, confNo)) {
      return this._membershipsMap[confNo];
    } else {
      return null;
    }
  }

  addMembership(membership) {
    this.addMemberships([membership]);
  }

  addMemberships(memberships) {
    memberships.forEach(m => {
      const confNo = m.conference.conf_no;
      this._membershipsMap[confNo] = m;
    });
    this._rebuildMembershipLists();
  }

  deleteMembership(confNo) {
    if (Object.prototype.hasOwnProperty.call(this._membershipsMap, confNo)) {
      delete this._membershipsMap[confNo];
      this._rebuildMembershipLists();
    }
  }

  updateMembership(membership) {
    // Update an existing membership object
    this._patchMembership(membership);
  }

  setMembershipUnreads(membershipUnreads) {
    // Build an object mapping confNo to membership unread details.
    this._membershipUnreadsMap = membershipUnreads.reduce((acc, mu) => {
      acc[mu.conf_no] = mu;
      return acc;
    }, {});
    this._rebuildMembershipLists();
  }

  setMembershipUnread(membershipUnread) {
    if (this._membershipUnreadsMap !== null) {
      this._membershipUnreadsMap[membershipUnread.conf_no] = membershipUnread;
      this._rebuildMembershipLists();
    } else {
      // This should never happen
      console.warn('setMembershipUnread called but _membershipUnreadsMap is null');
    }
  }

  markTextAsRead(textNo, recipientConfNos) {
    // Update the membership unreads only and then rebuild the membership lists.
    let shouldUpdate = false;
    if (this._membershipUnreadsMap !== null) {
      recipientConfNos.forEach(confNo => {
        const mu = this._membershipUnreadsMap[confNo];
        if (mu != null) {
          const idx = mu.unread_texts.indexOf(textNo);
          if (idx !== -1) {
            mu.unread_texts.splice(idx, 1);
            mu.no_of_unread -= 1;
            shouldUpdate = true;
          }
        }
      });
    }
    if (shouldUpdate) {
      this._rebuildMembershipLists();
    }
  }

  markTextAsUnread(textNo, recipientConfNos) {
    // Update the membership unreads only and then rebuild the membership lists.
    let shouldUpdate = false;
    if (this._membershipUnreadsMap !== null) {
      recipientConfNos.forEach(confNo => {
        const mu = this._membershipUnreadsMap[confNo];
        if (mu != null) {
          if (mu.unread_texts.indexOf(textNo) === -1) {
            mu.unread_texts.push(textNo);
            mu.no_of_unread += 1;
            shouldUpdate = true;
          }
        }
      });
    }
    if (shouldUpdate) {
      this._rebuildMembershipLists();
    }
  }
}
