import type { SproutGitApi } from '../preload/index.js';

declare global {
  interface Window {
    api: SproutGitApi;
  }
}
