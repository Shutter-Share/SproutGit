import log from 'electron-log/main';

export function initTelemetry(): void {
  log.initialize();
  log.transports.file.level = 'info';
  log.info('[main] SproutGit started');
}

export async function shutdownTelemetry(): Promise<void> {
  // electron-log handles cleanup automatically
}

export { log };
