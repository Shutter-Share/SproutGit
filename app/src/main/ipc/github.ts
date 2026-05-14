import { ipcMain, safeStorage } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { IPC } from '@sproutgit/types';
import type { DeviceCodeResponse, GitHubPollResult, GitHubAuthStatus, GitHubEmailSuggestion } from '@sproutgit/types';

// ── Token storage via electron.safeStorage ────────────────────────────────────

const GITHUB_CLIENT_ID = 'Ov23li2wz7N1W5K8PZIB'; // public OAuth App client ID

function tokenFilePath(userDataPath: string): string {
  return join(userDataPath, 'github-token.bin');
}

function saveToken(userDataPath: string, token: string): void {
  const encrypted = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(token)
    : Buffer.from(token, 'utf8');
  writeFileSync(tokenFilePath(userDataPath), encrypted);
}

function loadToken(userDataPath: string): string | null {
  const path = tokenFilePath(userDataPath);
  if (!existsSync(path)) return null;
  try {
    const buf = readFileSync(path);
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf8');
  } catch {
    return null;
  }
}

function deleteToken(userDataPath: string): void {
  const path = tokenFilePath(userDataPath);
  if (existsSync(path)) unlinkSync(path);
}

// ── GitHub REST helpers ───────────────────────────────────────────────────────

async function ghFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

async function ghApiFetch(endpoint: string, token: string): Promise<Response> {
  return ghFetch(`https://api.github.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}

// ── IPC registration ──────────────────────────────────────────────────────────

export function registerGithubHandlers(userDataPath: string): void {
  ipcMain.handle(IPC.GITHUB_AUTH_STATUS, (): GitHubAuthStatus => {
    const token = loadToken(userDataPath);
    if (!token) return { authenticated: false, username: null, provider: 'github' };
    // We stored username alongside token as JSON
    try {
      const parsed = JSON.parse(token) as { token: string; username: string };
      return { authenticated: true, username: parsed.username, provider: 'github' };
    } catch {
      return { authenticated: true, username: null, provider: 'github' };
    }
  });

  ipcMain.handle(IPC.GITHUB_DEVICE_FLOW_START, async (): Promise<DeviceCodeResponse> => {
    const res = await ghFetch('https://github.com/login/device/code', {
      method: 'POST',
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: 'read:user user:email repo' }),
    });
    if (!res.ok) throw new Error(`GitHub device flow start failed: ${res.status}`);
    const data = await res.json() as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    };
    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
      interval: data.interval,
    };
  });

  ipcMain.handle(IPC.GITHUB_DEVICE_FLOW_POLL, async (_e, deviceCode: string): Promise<GitHubPollResult> => {
    const res = await ghFetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    if (!res.ok) return { status: 'error', username: null, error: `HTTP ${res.status}` };
    const data = await res.json() as {
      access_token?: string;
      error?: string;
    };
    if (data.error === 'authorization_pending' || data.error === 'slow_down') {
      return { status: 'pending', username: null, error: null };
    }
    if (data.error === 'expired_token') {
      return { status: 'expired', username: null, error: null };
    }
    if (data.error) {
      return { status: 'error', username: null, error: data.error };
    }
    if (!data.access_token) {
      return { status: 'pending', username: null, error: null };
    }
    // Fetch username
    const userRes = await ghApiFetch('/user', data.access_token);
    const user = await userRes.json() as { login: string };
    const username = user.login ?? null;
    saveToken(userDataPath, JSON.stringify({ token: data.access_token, username }));
    return { status: 'complete', username, error: null };
  });

  ipcMain.handle(IPC.GITHUB_LOGOUT, () => {
    deleteToken(userDataPath);
  });

  ipcMain.handle(IPC.GITHUB_LIST_EMAILS, async (): Promise<GitHubEmailSuggestion[]> => {
    const stored = loadToken(userDataPath);
    if (!stored) return [];
    let token: string;
    try {
      const parsed = JSON.parse(stored) as { token: string };
      token = parsed.token;
    } catch {
      return [];
    }
    const res = await ghApiFetch('/user/emails', token);
    if (!res.ok) return [];
    const emails = await res.json() as Array<{
      email: string;
      primary: boolean;
      verified: boolean;
    }>;
    return emails.map(e => ({
      label: e.email,
      email: e.email,
      kind: e.primary ? 'primary' : 'secondary',
      primary: e.primary,
      verified: e.verified,
    }));
  });

  ipcMain.handle(IPC.GITHUB_LIST_REPOS, async () => {
    const stored = loadToken(userDataPath);
    if (!stored) return [];
    let token: string;
    try {
      const parsed = JSON.parse(stored) as { token: string };
      token = parsed.token;
    } catch {
      return [];
    }
    const repos: import('@sproutgit/types').GitHubRepo[] = [];
    let page = 1;
    while (true) {
      const res = await ghApiFetch(`/user/repos?per_page=100&sort=pushed&page=${page}`, token);
      if (!res.ok) break;
      const batch = await res.json() as Array<{
        full_name: string;
        clone_url: string;
        private: boolean;
        description: string | null;
      }>;
      if (batch.length === 0) break;
      for (const r of batch) {
        repos.push({
          fullName: r.full_name,
          cloneUrl: r.clone_url,
          private: r.private,
          description: r.description,
        });
      }
      if (batch.length < 100) break;
      page++;
    }
    return repos;
  });
}
