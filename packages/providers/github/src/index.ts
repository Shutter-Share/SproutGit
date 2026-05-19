import type {
  DeviceCodeResponse,
  GitHubPollResult,
  GitHubEmailSuggestion,
  GitHubRepo,
} from '@sproutgit/types';

export const GITHUB_CLIENT_ID = 'Ov23li7ulFUcqulDi8u8';

// ── Low-level fetch helpers ───────────────────────────────────────────────────

async function ghFormFetch(url: string, params: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
}

async function ghApiFetch(endpoint: string, token: string): Promise<Response> {
  return fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}

// ── Auth / device flow ────────────────────────────────────────────────────────

export async function deviceFlowStart(): Promise<DeviceCodeResponse> {
  const res = await ghFormFetch('https://github.com/login/device/code', {
    client_id: GITHUB_CLIENT_ID,
    scope: 'read:user user:email repo',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub device flow start failed: ${res.status}${body ? ` — ${body}` : ''}`);
  }
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
}

/**
 * Poll GitHub for the access token.
 * Returns the access token + username on success, or a status/error for
 * pending / expired / error states. Token storage is left to the caller
 * (the Electron main process handles safeStorage encryption).
 */
export async function deviceFlowPoll(
  deviceCode: string,
): Promise<GitHubPollResult & { accessToken: string | null; username: string | null }> {
  const res = await ghFormFetch('https://github.com/login/oauth/access_token', {
    client_id: GITHUB_CLIENT_ID,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (!res.ok) {
    return { status: 'error', accessToken: null, username: null, error: `HTTP ${res.status}` };
  }
  const data = await res.json() as { access_token?: string; error?: string };

  if (data.error === 'authorization_pending' || data.error === 'slow_down') {
    return { status: 'pending', accessToken: null, username: null, error: null };
  }
  if (data.error === 'expired_token') {
    return { status: 'expired', accessToken: null, username: null, error: null };
  }
  if (data.error) {
    return { status: 'error', accessToken: null, username: null, error: data.error };
  }
  if (!data.access_token) {
    return { status: 'pending', accessToken: null, username: null, error: null };
  }

  const username = await getUsername(data.access_token);
  return { status: 'complete', accessToken: data.access_token, username, error: null };
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function getUsername(token: string): Promise<string | null> {
  const res = await ghApiFetch('/user', token);
  if (!res.ok) return null;
  const user = await res.json() as { login: string };
  return user.login ?? null;
}

export async function listEmails(token: string): Promise<GitHubEmailSuggestion[]> {
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
}

export async function listRepos(token: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
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
}
