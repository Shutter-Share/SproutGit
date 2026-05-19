import { ipcMain, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC } from '@sproutgit/types';

function send(channel: string, ...args: unknown[]): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}

export function registerUpdateHandlers(): void {
  // electron-updater configuration
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    send(IPC.EVENT_UPDATE_CHECKING);
  });

  autoUpdater.on('update-available', (info) => {
    send(IPC.EVENT_UPDATE_AVAILABLE, (info as { version?: string }).version ?? '');
  });

  autoUpdater.on('update-not-available', () => {
    send(IPC.EVENT_UPDATE_NOT_AVAILABLE);
  });

  autoUpdater.on('download-progress', (progress) => {
    send(IPC.EVENT_UPDATE_DOWNLOADING, Math.round((progress as { percent?: number }).percent ?? 0));
  });

  autoUpdater.on('update-downloaded', () => {
    send(IPC.EVENT_UPDATE_READY);
  });

  autoUpdater.on('error', (err: Error) => {
    send(IPC.EVENT_UPDATE_ERROR, err.message);
  });

  // Renderer-triggered check
  ipcMain.handle(IPC.UPDATE_CHECK, async () => {
    await autoUpdater.checkForUpdates();
  });

  // Renderer-triggered install (quit + install)
  ipcMain.handle(IPC.UPDATE_INSTALL, () => {
    autoUpdater.quitAndInstall();
  });
}

/** Call once after the main window is shown. */
export function startUpdateCheck(): void {
  // Only check in production builds (not dev / test).
  if (process.env['NODE_ENV'] !== 'development') {
    void autoUpdater.checkForUpdates();
  }
}
