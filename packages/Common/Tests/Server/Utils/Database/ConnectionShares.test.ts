import {
  ConnectionShares,
  DEFAULT_PROBE_SCHEDULING_MONITOR_TEST_REQUESTS,
  PROBE_SCHEDULING_SHARE_OF_POOL,
  REQUEST_SHARE_OF_POOL,
  computeConnectionShares,
  defaultMonitorTestRequests,
  shareOfPool,
} from "../../../../Server/Utils/Database/ConnectionShares";
import { describe, expect, test } from "@jest/globals";

/*
 * How one process shares its Postgres pool between probe scheduling, queue
 * jobs and requests (#7920): probe scheduling and queue jobs each get a
 * bounded share, and requests always keep the rest - in a process that
 * serves them. A process that serves none (the Helm chart's worker pods)
 * keeps the whole pool for its jobs, as it always did. Probe scheduling's
 * share has two lanes since #10819: its work, and the Test Monitor runs it
 * hands out, which the queue jobs' default makes room for.
 */

describe("computeConnectionShares", () => {
  test("the default pool of 50: probe scheduling 10 and 2 Test Monitor fetches, queue jobs 28, requests always keep 10", () => {
    expect(REQUEST_SHARE_OF_POOL).toBe(0.2);
    expect(PROBE_SCHEDULING_SHARE_OF_POOL).toBe(0.2);
    expect(DEFAULT_PROBE_SCHEDULING_MONITOR_TEST_REQUESTS).toBe(2);
    expect(
      computeConnectionShares({ poolSize: 50, receivesIngressTraffic: true }),
    ).toEqual({
      poolSize: 50,
      probeSchedulingMaxConcurrentRequests: 10,
      probeSchedulingMaxConcurrentMonitorTestRequests: 2,
      maxQueueJobConnections: 28,
      connectionsKeptForRequests: 10,
    });
  });

  test("the Test Monitor lane: 2, or 1 on a pool of fewer than 30", () => {
    expect(defaultMonitorTestRequests(50)).toBe(2);
    expect(defaultMonitorTestRequests(30)).toBe(2);
    expect(defaultMonitorTestRequests(29)).toBe(1);
    expect(defaultMonitorTestRequests(4)).toBe(1);
    expect(defaultMonitorTestRequests(1)).toBe(1);
    expect(defaultMonitorTestRequests(500)).toBe(2);
  });

  test("a Test Monitor lane setting moves the queue jobs' default with it, never past the pool", () => {
    expect(
      computeConnectionShares({
        poolSize: 50,
        receivesIngressTraffic: true,
        probeSchedulingMaxConcurrentMonitorTestRequests: 5,
      }),
    ).toMatchObject({
      probeSchedulingMaxConcurrentRequests: 10,
      probeSchedulingMaxConcurrentMonitorTestRequests: 5,
      maxQueueJobConnections: 25,
      connectionsKeptForRequests: 10,
    });
    expect(
      computeConnectionShares({
        poolSize: 8,
        receivesIngressTraffic: true,
        probeSchedulingMaxConcurrentMonitorTestRequests: 40,
      }).probeSchedulingMaxConcurrentMonitorTestRequests,
    ).toBe(8);
    for (const value of [0, -1, Number.NaN]) {
      expect(
        computeConnectionShares({
          poolSize: 50,
          receivesIngressTraffic: true,
          probeSchedulingMaxConcurrentMonitorTestRequests: value,
        }).probeSchedulingMaxConcurrentMonitorTestRequests,
      ).toBe(2);
    }
  });

  test("the shares follow the pool's size", () => {
    expect(
      computeConnectionShares({ poolSize: 100, receivesIngressTraffic: true }),
    ).toMatchObject({
      probeSchedulingMaxConcurrentRequests: 20,
      probeSchedulingMaxConcurrentMonitorTestRequests: 2,
      maxQueueJobConnections: 58,
      connectionsKeptForRequests: 20,
    });
    expect(
      computeConnectionShares({ poolSize: 10, receivesIngressTraffic: true }),
    ).toMatchObject({
      probeSchedulingMaxConcurrentRequests: 2,
      probeSchedulingMaxConcurrentMonitorTestRequests: 1,
      maxQueueJobConnections: 5,
      connectionsKeptForRequests: 2,
    });
  });

  test("on a tiny pool every share is at least one connection, and queue jobs always get one", () => {
    expect(shareOfPool(3, 0.2)).toBe(1);
    expect(
      computeConnectionShares({ poolSize: 4, receivesIngressTraffic: true }),
    ).toMatchObject({
      probeSchedulingMaxConcurrentRequests: 1,
      probeSchedulingMaxConcurrentMonitorTestRequests: 1,
      maxQueueJobConnections: 1,
      connectionsKeptForRequests: 1,
    });
    // Too small for every share: queue jobs still make progress.
    expect(
      computeConnectionShares({ poolSize: 2, receivesIngressTraffic: true }),
    ).toMatchObject({
      probeSchedulingMaxConcurrentRequests: 1,
      maxQueueJobConnections: 1,
      connectionsKeptForRequests: 0,
    });
  });

  test("a process that takes no ingress traffic keeps the whole pool for its queue jobs", () => {
    expect(
      computeConnectionShares({ poolSize: 50, receivesIngressTraffic: false }),
    ).toEqual({
      poolSize: 50,
      probeSchedulingMaxConcurrentRequests: 10,
      probeSchedulingMaxConcurrentMonitorTestRequests: 2,
      maxQueueJobConnections: 50,
      connectionsKeptForRequests: 0,
    });
  });

  test("a probe scheduling setting moves the queue jobs' default with it", () => {
    const shares: ConnectionShares = computeConnectionShares({
      poolSize: 50,
      receivesIngressTraffic: true,
      probeSchedulingMaxConcurrentRequests: 4,
    });
    expect(shares).toMatchObject({
      probeSchedulingMaxConcurrentRequests: 4,
      maxQueueJobConnections: 34,
      connectionsKeptForRequests: 10,
    });
  });

  test("an explicit queue job setting wins, never past the pool; set to the pool it is no cap", () => {
    expect(
      computeConnectionShares({
        poolSize: 50,
        receivesIngressTraffic: true,
        maxQueueJobConnections: 20,
      }),
    ).toMatchObject({
      maxQueueJobConnections: 20,
      connectionsKeptForRequests: 18,
    });
    expect(
      computeConnectionShares({
        poolSize: 50,
        receivesIngressTraffic: true,
        maxQueueJobConnections: 50,
      }),
    ).toMatchObject({
      maxQueueJobConnections: 50,
      connectionsKeptForRequests: 0,
    });
    expect(
      computeConnectionShares({
        poolSize: 50,
        receivesIngressTraffic: true,
        maxQueueJobConnections: 500,
      }).maxQueueJobConnections,
    ).toBe(50);
    // On a worker pod too, an explicit cap is a cap.
    expect(
      computeConnectionShares({
        poolSize: 50,
        receivesIngressTraffic: false,
        maxQueueJobConnections: 40,
      }).maxQueueJobConnections,
    ).toBe(40);
  });

  test("a setting that is not a whole number above 0 falls back to the default", () => {
    for (const value of [0, -3, Number.NaN, Infinity]) {
      expect(
        computeConnectionShares({
          poolSize: 50,
          receivesIngressTraffic: true,
          probeSchedulingMaxConcurrentRequests: value,
          maxQueueJobConnections: value,
        }),
      ).toMatchObject({
        probeSchedulingMaxConcurrentRequests: 10,
        maxQueueJobConnections: 28,
      });
    }
    // Fractions are cut to whole connections.
    expect(
      computeConnectionShares({
        poolSize: 50,
        receivesIngressTraffic: true,
        probeSchedulingMaxConcurrentRequests: 7.9,
      }).probeSchedulingMaxConcurrentRequests,
    ).toBe(7);
  });

  test("probe scheduling never runs more requests at once than the pool has connections", () => {
    expect(
      computeConnectionShares({
        poolSize: 8,
        receivesIngressTraffic: true,
        probeSchedulingMaxConcurrentRequests: 40,
      }),
    ).toMatchObject({
      probeSchedulingMaxConcurrentRequests: 8,
      maxQueueJobConnections: 1,
    });
  });
});
