import webpush from 'web-push';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const KEYS_PATH = process.env.VAPID_KEYS_PATH || path.join(DATA_DIR, 'vapid-keys.json');

fs.mkdirSync(path.dirname(KEYS_PATH), { recursive: true });

function loadOrCreateKeys() {
  if (fs.existsSync(KEYS_PATH)) {
    return JSON.parse(fs.readFileSync(KEYS_PATH, 'utf8'));
  }
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2));
  return keys;
}

const vapidKeys = loadOrCreateKeys();
webpush.setVapidDetails('mailto:admin@example.com', vapidKeys.publicKey, vapidKeys.privateKey);

export const publicKey = vapidKeys.publicKey;

// Returns true on success, false if the subscription is dead (410/404 — the
// caller should stop storing it) so a stale subscription doesn't get retried
// forever.
export async function sendPush(subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) return false;
    console.error('Push send failed:', err.message);
    return true; // transient error — keep the subscription, don't give up on it yet
  }
}
