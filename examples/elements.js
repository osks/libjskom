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
  static properties = {
    sendRequestFunc: {},
  };

  constructor() {
    super();
    this.sendRequestFunc = null;
    this.request = "78 212";
  }

  render() {
    return html`
      <label>Request</label>
      <input id="request" type="text" value="${this.request}"/>
      <button id="send" type="button" @click=${this.sendClicked}>Send</button>
    `;
  }

  sendClicked = (event) => {
    console.log("send clicked");
    if (this.sendRequestFunc) {
      this.sendRequestFunc(this.request);
    }
  }
}
customElements.define('kom-requester', KomRequesterElement);
