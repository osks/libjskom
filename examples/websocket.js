import { HttpkomConnection } from '../src/HttpkomConnection.js';
import { HttpkomClient } from '../src/HttpkomClient.js';


const messages = []
const messagesElement = document.querySelector('kom-messages');
messagesElement.messages = messages;


async function run1() {
  console.log("run1");

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

  const lyskomServers = await HttpkomClient.getLyskomServers();
  console.log("Available lyskom servers: ", lyskomServers);

  await client.connect();

  console.log("world");

}


async function runWsConn() {
  console.log("runWsConn");

  let conn = new HttpkomConnection({
    lyskomServerId: "localhost",
    httpkomServer: "http://127.0.0.1:5000/httpkom",
  });
  await conn.connect();

  console.log("Connected");

  //const ws = new WebSocket("ws://127.0.0.1:5000/ws");
  const ws = conn.websocket();

  ws.onopen = () => {
    console.log("WebSocket connection opened");


    sendMessage({"msg": "hej websocket"});

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
    const data = JSON.stringify(message);
    ws.send(data);
    console.log(`Sent: ${data}`);
  }
}


async function runWsClient() {
  console.log("runWsClient()");

  let client = new HttpkomClient({
    lyskomServerId: "localhost",
    httpkomServer: "http://127.0.0.1:5000/httpkom",
  });

  await client.connect();
  console.log("Connected");

  const ws = client.websocket();
  let nextRefNo = 1;

  const sendMessage = (data) => {
    ws.send(data);
    console.log(`Sent: ${data}`);
    messages.push(`Sent: ${data}`);
    messagesElement.requestUpdate();
  }

  const requesterElement = document.querySelector('kom-requester');
  requesterElement.sendRequestFunc = (request) => {
    sendMessage(JSON.stringify({"protocol": "a", "ref_no": nextRefNo++, "request": request}));
  };

  ws.onopen = () => {
    console.log("WebSocket connection opened");

    sendMessage(JSON.stringify({"protocol": "echo", "ref_no": nextRefNo++, "request": "hej websocket"}));

    //setTimeout(() => ws.close(), 5000)
  };

  ws.onmessage = (event) => {
    console.log(`Received: ${event.data}`);
    messages.push(`Received: ${event.data}`);
    messagesElement.requestUpdate();
  };

  ws.onerror = (error) => {
    console.error(`WebSocket error: ${JSON.stringify(error)}`);
  };

}


async function runCreatePerson() {
  console.log("runCreatePerson");

  let conn = new HttpkomConnection({
    lyskomServerId: "localhost",
    httpkomServer: "http://127.0.0.1:5000/httpkom",
  });
  await conn.connect();


  let client = new HttpkomClient({
    lyskomServerId: "localhost",
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

//run1();
//runCreatePerson();
//runWsConn();
runWsClient();
