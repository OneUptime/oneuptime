/*
 * What a probe's syslog receiver does unless its operator changes it.
 *
 * The port is 5140, not the standard 514: ports below 1024 need privileges
 * outside a container, and a receiver that cannot bind hears nothing. The
 * same number is used for UDP and for TCP.
 *
 * Read by the probe (its listeners), the dashboard (the set-up steps on the
 * Events pages) and the docs tests, so the three can never disagree.
 */
export const DEFAULT_SYSLOG_RECEIVER_PORT: number = 5140;

// Messages a probe forwards a minute before it starts shedding them.
export const DEFAULT_SYSLOG_RATE_LIMIT_PER_MINUTE: number = 600;
