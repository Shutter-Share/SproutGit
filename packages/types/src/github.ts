export type DeviceCodeResponse = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
};

export type GitHubPollResult = {
  status: 'pending' | 'complete' | 'expired' | 'error';
  username: string | null;
  error: string | null;
};

export type GitHubAuthStatus = {
  authenticated: boolean;
  username: string | null;
  provider: string;
};

export type GitHubRepo = {
  fullName: string;
  cloneUrl: string;
  private: boolean;
  description: string | null;
};

export type GitHubEmailSuggestion = {
  label: string;
  email: string;
  kind: string;
  primary: boolean;
  verified: boolean;
};
