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
  await client.conn.disconnect();

  console.log("world");
}

run();
