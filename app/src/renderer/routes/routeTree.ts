import { rootRoute } from './__root.js';
import { indexRoute } from './index.js';
import { workspaceRoute } from './workspace.js';
import { settingsRoute } from './settings.js';

export const routeTree = rootRoute.addChildren([indexRoute, workspaceRoute, settingsRoute]);
