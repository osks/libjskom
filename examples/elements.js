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
      <input id="request" type="text" @input=${this.changeRequest} value="${this.request}"/>
      <button id="send" type="button" @click=${this.clickSend}>Send</button>
    `;
  }

  changeRequest(event) {
    console.log("changeRequest");
    const input = event.target;
    this.request = input.value;
  }

  clickSend = (event) => {
    console.log("clickSend");
    if (this.sendRequestFunc) {
      this.sendRequestFunc(this.request);
    }
  }
}
customElements.define('kom-requester', KomRequesterElement);
