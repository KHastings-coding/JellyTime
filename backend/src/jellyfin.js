import axios from 'axios';
import { getDb } from './db.js';

function getJellyfinConfig() {
  const db = getDb();
  const url = db.prepare("SELECT value FROM settings WHERE key='jellyfin_url'").get();
  const apiKey = db.prepare("SELECT value FROM settings WHERE key='jellyfin_api_key'").get();
  return {
    baseUrl: url?.value,
    apiKey: apiKey?.value,
  };
}

function jellyfinClient() {
  const { baseUrl, apiKey } = getJellyfinConfig();
  if (!baseUrl || !apiKey) throw new Error('Jellyfin not configured');
  return axios.create({
    baseURL: baseUrl,
    headers: { Authorization: `MediaBrowser Token="${apiKey}"` },
    timeout: 5000,
  });
}

export async function getActiveSessions() {
  try {
    const client = jellyfinClient();
    const res = await client.get('/Sessions');
    return res.data || [];
  } catch (e) {
    console.error('Jellyfin sessions error:', e.message);
    return [];
  }
}

export async function getUsers() {
  const client = jellyfinClient();
  const res = await client.get('/Users');
  return res.data || [];
}

export async function disableUser(jellyfinUserId) {
  try {
    const client = jellyfinClient();
    // Get current policy first
    const userRes = await client.get(`/Users/${jellyfinUserId}`);
    const policy = userRes.data.Policy || {};
    policy.IsDisabled = true;
    await client.post(`/Users/${jellyfinUserId}/Policy`, policy);
    return true;
  } catch (e) {
    console.error('Failed to disable user:', e.message);
    return false;
  }
}

export async function enableUser(jellyfinUserId) {
  try {
    const client = jellyfinClient();
    const userRes = await client.get(`/Users/${jellyfinUserId}`);
    const policy = userRes.data.Policy || {};
    policy.IsDisabled = false;
    await client.post(`/Users/${jellyfinUserId}/Policy`, policy);
    return true;
  } catch (e) {
    console.error('Failed to enable user:', e.message);
    return false;
  }
}

export async function testConnection(baseUrl, apiKey) {
  try {
    const res = await axios.get(`${baseUrl}/System/Info`, {
      headers: { Authorization: `MediaBrowser Token="${apiKey}"` },
      timeout: 5000,
    });
    return { ok: true, serverName: res.data.ServerName };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
