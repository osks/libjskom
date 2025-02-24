import {LitElement, html} from './lit-core.min.js'

import {HttpkomClient} from '../src/HttpkomClient.js';


class Router {
    constructor(state) {
        this.state = state;
        window.addEventListener('popstate', this.handlePopState.bind(this));
    }

    handlePopState(event) {
        const path = window.location.pathname;
        this.navigateTo(path);
    }

    navigateTo(path) {
        switch(path) {
            case '/login':
                this.state.currentScreen = 'login';
                break;
            case '/messages':
                this.state.currentScreen = 'messages';
                break;
            case '/create-person':
                this.state.currentScreen = 'createPerson';
                break;
        }
        this.state.notify();
    }

    start() {
        this.handlePopState();
    }
}


class AppState {
    constructor() {
        this.clients = new Map(); // Map<string, HttpkomClient>
        this.activeClientId = null;
        this.currentScreen = 'login'; // 'login' | 'messages' | 'createPerson'
        this.observers = new Set();
    }

    // Observer pattern for UI updates
    subscribe(callback) {
        this.observers.add(callback);
        return () => this.observers.delete(callback);
    }

    notify() {
        this.observers.forEach(callback => callback());
    }

    async createSession(lyskomServerId) {
        const client = new HttpkomClient({
          lyskomServerId: lyskomServerId,
          httpkomServer: "http://127.0.0.1:5000/httpkom",
        });
        const clientId = crypto.randomUUID();

        await client.conn.connect();
        this.clients.set(clientId, client);
        this.activeClientId = clientId;
        this.notify();

        return clientId;
    }

    async login(clientId, username, password) {
        const client = this.clients.get(clientId);
        if (!client) throw new Error('Invalid client ID');

        await client.sessions.login({name: username, passwd: password});
        this.currentScreen = 'messages';
        this.notify();
    }

    async createPerson(clientId, username, password) {
        const client = this.clients.get(clientId);
        if (!client) throw new Error('Invalid client ID');

        await client.persons.createPerson(username, password);
        this.currentScreen = 'login';
        this.notify();
    }

    setActiveClient(clientId) {
        if (!this.clients.has(clientId)) throw new Error('Invalid client ID');
        this.activeClientId = clientId;
        this.notify();
    }

    getActiveClient() {
        return this.clients.get(this.activeClientId);
    }

    getAllClients() {
        return Array.from(this.clients.entries());
    }
}


// app.js
class JskomApp {
    constructor(rootSelector) {
        // Create and initialize state
        this.state = new AppState();

        // Create and initialize router
        this.router = new Router(this.state);

        // Initialize the app container
        this.initializeApp(rootSelector);

        // Start the router
        this.router.start();
    }

    initializeApp(rootSelector) {
        const container = document.querySelector(rootSelector);
        if (!container) {
            throw new Error(`Container element ${rootSelector} not found`);
        }

        // Create the app shell
        const appShell = document.createElement('app-shell');
        appShell.state = this.state;
        container.appendChild(appShell);
    }

    navigate(path) {
        this.router.navigateTo(path);
    }
}


class AppShell extends LitElement {
    static properties = {
        state: { type: Object },
        currentScreen: { type: String }
    };

    constructor() {
        super();
        this.currentScreen = 'login';
    }

    connectedCallback() {
        super.connectedCallback();
        // Subscribe to state changes
        this._stateUnsubscribe = this.state?.subscribe(() => {
            this.currentScreen = this.state.currentScreen;
            this.requestUpdate();
        });
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._stateUnsubscribe) {
            this._stateUnsubscribe();
        }
    }

    render() {
        const screens = {
            login: () => html`<login-screen .state=${this.state}></login-screen>`,
            messages: () => html`<messages-screen .state=${this.state}></messages-screen>`,
            createPerson: () => html`<create-person-screen .state=${this.state}></create-person-screen>`
        };

        const renderScreen = screens[this.currentScreen];
        if (!renderScreen) {
            return html`<div>Unknown screen: ${this.currentScreen}</div>`;
        }

        return renderScreen();
    }
}

customElements.define('app-shell', AppShell);


class LoginScreen extends LitElement {
    static properties = {
        state: { type: Object },
        lyskomServerId: { type: String },
        username: { type: String },
        password: { type: String }
    };

    constructor() {
        super();
        this.lyskomServerId = 'localhost';
        this.username = '';
        this.password = '';
    }

    async handleSubmit(e) {
        e.preventDefault();
        try {
            const clientId = await this.state.createSession(this.lyskomServerId);
            await this.state.login(clientId, this.username, this.password);
        } catch (error) {
            console.error('Login failed:', error);
        }
    }

    render() {
        return html`
            <h1>Login</h1>
            <form @submit=${this.handleSubmit}>
                <input 
                    type="text" 
                    .value=${this.lyskomServerId}
                    @input=${e => this.lyskomServerId = e.target.value}
                    placeholder="Server ID"
                >
                <input 
                    type="text" 
                    .value=${this.username}
                    @input=${e => this.username = e.target.value}
                    placeholder="Username"
                >
                <input 
                    type="password" 
                    .value=${this.password}
                    @input=${e => this.password = e.target.value}
                    placeholder="Password"
                >
                <button type="submit">Login</button>
            </form>
        `;
    }
}

customElements.define('login-screen', LoginScreen);


class CreatePersonScreen extends LitElement {
    static properties = {
        state: { type: Object },
        lyskomServerId: { type: String },
        username: { type: String },
        password: { type: String }
    };

    constructor() {
        super();
        this.lyskomServerId = 'localhost';
        this.username = '';
        this.password = '';
    }

    async handleSubmit(e) {
        e.preventDefault();
        try {
            const clientId = await this.state.createSession(this.lyskomServerId);
            await this.state.createPerson(clientId, this.username, this.password);
        } catch (error) {
            console.error('CreatePerson failed:', error);
        }
    }

    render() {
        return html`
            <h1>Create person</h1>
            <form @submit=${this.handleSubmit}>
                <input 
                    type="text" 
                    .value=${this.lyskomServerId}
                    @input=${e => this.lyskomServerId = e.target.value}
                    placeholder="Server ID"
                >
                <input 
                    type="text" 
                    .value=${this.username}
                    @input=${e => this.username = e.target.value}
                    placeholder="Username"
                >
                <input 
                    type="password" 
                    .value=${this.password}
                    @input=${e => this.password = e.target.value}
                    placeholder="Password"
                >
                <button type="submit">CreatePerson</button>
            </form>
        `;
    }
}

customElements.define('create-person-screen', CreatePersonScreen);


const app = new JskomApp('#jskom');
app.navigate('/create-person');
