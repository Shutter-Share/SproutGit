/**
 * Declare the Electron preload bridge API on window.
 * This allows UI components to access window.api without type errors.
 */

declare global {
  interface Window {
    api: {
      windowIsMaximized: () => Promise<boolean>;
      onWindowMaximized: (cb: () => void) => () => void;
      onWindowUnmaximized: (cb: () => void) => () => void;
      windowMinimize: () => Promise<void>;
      windowMaximize: () => Promise<void>;
      windowUnmaximize: () => Promise<void>;
      windowClose: () => Promise<void>;
      [key: string]: any;
    };
  }
}

export {};
