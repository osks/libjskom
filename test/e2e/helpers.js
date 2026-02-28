import { before } from 'node:test';
import { HttpkomClient } from '../../src/HttpkomClient.js';

export const HTTPKOM_BASE_URL = process.env.HTTPKOM_BASE_URL || 'http://localhost:5001';
export const LYSKOM_SERVER_ID = 'default';

// Wait for httpkom to be reachable before any tests run.
// Docker Compose ensures seed completes before httpkom starts,
// so once httpkom responds, the fixture data is ready.
before(async () => {
  const maxAttempts = 60;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const res = await fetch(`${HTTPKOM_BASE_URL}/`);
      if (res.ok) return;
    } catch {}
    if (i === maxAttempts) throw new Error(`httpkom not ready at ${HTTPKOM_BASE_URL} after ${maxAttempts}s`);
    await new Promise(r => setTimeout(r, 1000));
  }
});

// Credentials from fixture.json
export const TEST_USER = { name: 'Test User', passwd: 'test123' };
export const ANOTHER_USER = { name: 'Another User', passwd: 'test456' };

export function createClient() {
  return new HttpkomClient({
    lyskomServerId: LYSKOM_SERVER_ID,
    httpkomServer: HTTPKOM_BASE_URL,
  });
}

/**
 * Create a client that is already connected and logged in.
 * Caller is responsible for disconnecting after use.
 */
export async function createLoggedInClient(user = TEST_USER) {
  const client = createClient();
  await client.connect();
  await client.login({ name: user.name, passwd: user.passwd });
  return client;
}
