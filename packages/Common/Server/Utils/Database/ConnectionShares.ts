/*
 * HOW ONE PROCESS SHARES ITS POSTGRES POOL (issue #7920).
 *
 * A process has one pool, DATABASE_MAX_OPEN_CONNECTIONS connections (50 by
 * default), and pg-pool hands them out first come, first served. In a
 * process that serves requests AND runs the queue workers - every App pod
 * while the Helm chart's worker.enabled is false, the default, and the App
 * container of docker compose - up to TELEMETRY_CONCURRENCY plus
 * WORKER_CONCURRENCY jobs (200 by default) and every worker of every probe
 * replica's scheduling requests ask the same pool as a person signing in.
 * When the database slows down, their queries fill the pool and its queue,
 * and a sign-in waits behind all of them until DATABASE_CONNECTION_TIMEOUT_MS
 * runs out: a customer saw every pod's 50 connections busy and sign-ins,
 * Network Overview and on-call policies time out.
 *
 * So background work gets bounded shares of the pool:
 *
 *   - Probe scheduling - the monitors, monitor tests and network devices a
 *     probe is handed, and the pending count its autoscaler reads - runs at
 *     most PROBE_SCHEDULING_MAX_CONCURRENT_REQUESTS requests at once (about
 *     one connection each), a fifth of the pool by default
 *     (Probe/ProbeSchedulingLimiter).
 *   - Queue jobs hold at most DATABASE_MAX_QUEUE_JOB_CONNECTIONS connections
 *     at once (Infrastructure/Postgres/QueueJobConnections). By default the
 *     pool less a fifth kept for requests and less probe scheduling's share.
 *
 * What is left - a fifth of the pool by default, and whatever the others are
 * not using - is always there for requests: a sign-in finds a connection
 * however busy the jobs and the probes are.
 *
 * A process that takes no ingress traffic (RECEIVES_INGRESS_TRAFFIC=false:
 * the Helm chart's worker pods) serves no requests and no probes, so its
 * queue jobs may use the whole pool, as they always could.
 *
 * Nothing here imports anything: EnvironmentConfig reads it.
 */

// The share of the pool kept for requests, and probe scheduling's.
export const REQUEST_SHARE_OF_POOL: number = 0.2;
export const PROBE_SCHEDULING_SHARE_OF_POOL: number = 0.2;

export interface ConnectionSharesInput {
  // DATABASE_MAX_OPEN_CONNECTIONS.
  poolSize: number;
  // RECEIVES_INGRESS_TRAFFIC: whether requests and probes reach this process.
  receivesIngressTraffic: boolean;
  // PROBE_SCHEDULING_MAX_CONCURRENT_REQUESTS, when set.
  probeSchedulingMaxConcurrentRequests?: number | undefined;
  // DATABASE_MAX_QUEUE_JOB_CONNECTIONS, when set.
  maxQueueJobConnections?: number | undefined;
}

export interface ConnectionShares {
  poolSize: number;
  // Probe scheduling requests running at once in this process.
  probeSchedulingMaxConcurrentRequests: number;
  // Connections queue jobs may hold at once; the pool size is no cap at all.
  maxQueueJobConnections: number;
  /*
   * Connections neither takes even when both take all they may: what
   * requests always have. 0 in a process that serves none.
   */
  connectionsKeptForRequests: number;
}

// A share of the pool, never less than one connection.
export function shareOfPool(poolSize: number, share: number): number {
  return Math.max(1, Math.round(poolSize * share));
}

function positiveWholeNumber(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return undefined;
  }
  return Math.floor(value);
}

export function computeConnectionShares(
  input: ConnectionSharesInput,
): ConnectionShares {
  const poolSize: number = Math.max(
    1,
    positiveWholeNumber(input.poolSize) || 1,
  );

  const probeSchedulingMaxConcurrentRequests: number = Math.min(
    poolSize,
    positiveWholeNumber(input.probeSchedulingMaxConcurrentRequests) ??
      shareOfPool(poolSize, PROBE_SCHEDULING_SHARE_OF_POOL),
  );

  const configuredQueueJobConnections: number | undefined = positiveWholeNumber(
    input.maxQueueJobConnections,
  );

  let maxQueueJobConnections: number;

  if (configuredQueueJobConnections !== undefined) {
    maxQueueJobConnections = Math.min(poolSize, configuredQueueJobConnections);
  } else if (!input.receivesIngressTraffic) {
    maxQueueJobConnections = poolSize;
  } else {
    // Queue jobs always get at least one, so they make progress on any pool.
    maxQueueJobConnections = Math.max(
      1,
      poolSize -
        shareOfPool(poolSize, REQUEST_SHARE_OF_POOL) -
        probeSchedulingMaxConcurrentRequests,
    );
  }

  return {
    poolSize,
    probeSchedulingMaxConcurrentRequests,
    maxQueueJobConnections,
    connectionsKeptForRequests: input.receivesIngressTraffic
      ? Math.max(
          0,
          poolSize -
            probeSchedulingMaxConcurrentRequests -
            maxQueueJobConnections,
        )
      : 0,
  };
}
