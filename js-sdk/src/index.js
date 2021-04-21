import Logger from './logger.js';
import ErrorTracker from './tracker.js';
// Due to issue with handling exports/imports in the server-monitor cli
// we need to build the server-monitor project into the build folder then point to it there
// This way we won't worry about whether we are using module/commonjs syntax
import ServerMonitor from '../build/server-monitor/lib/api';
import PerformanceTracker from './performanceTracker.js';

export default { Logger, ErrorTracker, ServerMonitor, PerformanceTracker };
