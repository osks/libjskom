import { HttpkomConnection } from '../src/HttpkomConnection.js';
import { HttpkomClient } from '../src/HttpkomClient.js';


const messages = []
const messagesElement = document.querySelector('kom-messages');
messagesElement.messages = messages;

const sleepMs = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run1() {
  console.log("hello");

  //let conn = new HttpkomConnection({
  //  lyskomServerId: "localhost",
  //  httpkomServer: "http://127.0.0.1:5000/httpkom",
  //});
  //await conn.connect();

  let client = new HttpkomClient({
    lyskomServerId: "localhost",
    httpkomServer: "http://127.0.0.1:5000/httpkom",
  });

  const lyskomServers = await client.getLyskomServers();
  console.log("Available lyskom servers: ", lyskomServers);

  await client.connect();

  console.log("world");


  wstest(client);
}

async function wstest(conn) {
  //const ws = new WebSocket("ws://127.0.0.1:5000/ws");
  const ws = conn.websocket();

  ws.onopen = () => {
    console.log("WebSocket connection opened");


    sendMessage("hej websocket");

    //await sleepMs(5000);
    setTimeout(() => ws.close(), 5000)
  };

  ws.onmessage = (event) => {
    console.log(`Received: ${event.data}`);
    messages.push(`Received: ${event.data}`);
    messagesElement.requestUpdate();
  };

  ws.onerror = (error) => {
    console.error(`WebSocket error: ${JSON.stringify(error)}`);
  };

  function sendMessage(message) {
    ws.send(message);
    console.log(`Sent: ${message}`);
  }
}


async function run2() {
  console.log("hello");

  let conn = new HttpkomConnection({
    server_id: "localhost",
    httpkomServer: "http://127.0.0.1:5000/httpkom",
  });

  await conn.connect();


  let client = new HttpkomClient({
    server_id: "localhost",
    httpkomServer: "http://127.0.0.1:5000/httpkom",
  });

  await client.connect();

  try {
    let respCreateP = await client.createPerson("oskar1", "oskar1");
    console.log(respCreateP);
  } catch (error) {
    console.log("error:");
    console.log(error);
    if (error.data.error_msg == "PersonExists") {
      // this is ok
    } else {
      throw error;
    }
  }


  let respLogin = await client.login(6, "oskar1");
  console.log(respLogin);

  await client.logout();
  await client.disconnect();

  console.log("world");

}

run1();
