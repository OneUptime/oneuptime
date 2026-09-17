/*
 * Node.js timers cannot safely represent delays above 2^31 - 1 milliseconds.
 * Keep enough of that budget for browser launch, controller setup, and worker
 * readiness so the configured script deadline can still be enforced without
 * overflowing the supervisor timer.
 */
export const MAX_NODE_TIMER_DELAY_IN_MS: number = 2_147_483_647;
export const SYNTHETIC_MONITOR_WORKER_STARTUP_ALLOWANCE_IN_MS: number = 120_000;
export const MAX_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS: number =
  MAX_NODE_TIMER_DELAY_IN_MS - SYNTHETIC_MONITOR_WORKER_STARTUP_ALLOWANCE_IN_MS;
