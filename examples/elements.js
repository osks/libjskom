import {LitElement, html} from './lit-core.min.js'


class KomMessagesElement extends LitElement {
  static properties = {
    messages: {type: Array},
  };

  constructor() {
    super();
    this.messages = [];
  }

  addMessage(message) {
    this.messages = [...this.messages, message]; // Create new array reference
  }

  render() {
    return html`
    <ul>
      ${this.messages.map((message) =>
        html`<li>${message}</li>`
      )}
    </ul>
    `;
  }
}
customElements.define('kom-messages', KomMessagesElement);


class KomRequesterElement extends LitElement {
  render() {
    return html`
      <label>Request</label>
      <input id="request" type="text"/>
    `;
  }
}
customElements.define('kom-requester', KomRequesterElement);
