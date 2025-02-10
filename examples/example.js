import { HttpkomConnection } from '../src/HttpkomConnection.js';
import { HttpkomClient } from '../src/HttpkomClient.js';

console.log("hello");

let conn = new HttpkomConnection({
  server_id: "localhost",
  httpkomServer: "http://127.0.0.1:5000/httpkom",
});

//conn.connect();

let client = new HttpkomClient({
  server_id: "localhost",
  httpkomServer: "http://127.0.0.1:5000/httpkom",
});

client.connect();

console.log("world");
