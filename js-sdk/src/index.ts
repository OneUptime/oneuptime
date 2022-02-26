import Logger from './logger.js';
import ErrorTracker from './tracker.js';
// Due to issue with handling exports/imports in the server-monitor cli
// we need to build the server-monitor project into the build folder then point to it there
// This way we won't worry about whether we are using module/commonjs syntax
// @ts-expect-error ts-migrate(2306) FIXME: File '/home/nawazdhandala/Projects/OneUptime/app/j... Remove this comment to see the full error message
import ServerMonitor from '../build/server-monitor/lib/api';
import PerformanceTracker from './performanceTracker.js';

export default { Logger, ErrorTracker, ServerMonitor, PerformanceTracker };
