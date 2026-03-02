export class TextsMixin {
  /**
   * Fetch a text by number.
   * @param {number} textNo - The text number to fetch.
   * @returns {Promise<Object>} The text object from httpkom.
   */
  async getText(textNo) {
    const response = await this.http(
      { method: 'get', url: `/texts/${textNo}` },
      true,
      true
    );
    const text = response.data;
    this.broadcast('jskom:text:fetched', text);
    return text;
  }

  /**
   * Create a new text.
   * @param {Object} params
   * @param {string} params.subject - The subject line.
   * @param {string} params.body - The text body.
   * @param {string} [params.contentType="text/plain"] - MIME content type.
   * @param {Array} params.recipientList - List of recipients ({type, recpt: {conf_no}}).
   * @param {Array} [params.commentToList=[]] - List of texts this is a comment to ({type, text_no}).
   * @returns {Promise<{ text_no: number }>}
   */
  async createText({ subject, body, contentType = 'text/plain', recipientList, commentToList = [] }) {
    const data = {
      subject,
      body,
      content_type: contentType,
      recipient_list: recipientList,
      comment_to_list: commentToList,
    };
    const response = await this.http(
      { method: 'post', url: '/texts/', data },
      true,
      true
    );
    const result = response.data;
    this.broadcast('jskom:text:created', result.text_no, recipientList);
    return result;
  }

  /**
   * Mark a text as read.
   * @param {number} textNo - The text number.
   * @param {Object} text - The full text object (needed for recipient info).
   * @returns {Promise<void>}
   */
  async createReadMarking(textNo, text) {
    await this.http(
      { method: 'put', url: `/texts/${textNo}/read-marking`, data: {} },
      true,
      true
    );
    this.broadcast('jskom:readMarking:created', text);
  }

  /**
   * Mark a text as unread.
   * @param {number} textNo - The text number.
   * @param {Object} text - The full text object (needed for recipient info).
   * @returns {Promise<void>}
   */
  async deleteReadMarking(textNo, text) {
    await this.http(
      { method: 'delete', url: `/texts/${textNo}/read-marking` },
      true,
      true
    );
    this.broadcast('jskom:readMarking:deleted', text);
  }
}
