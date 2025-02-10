import { HttpkomConnection } from '../src/HttpkomConnection.js';
import { HttpkomClient } from '../src/HttpkomClient.js';


async function run() {
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

  await client.conn.connect();

  console.log("world");
}

run();
