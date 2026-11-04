import { afterAll, beforeAll, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DataSource } from "typeorm";
import Entities from "Common/Models/DatabaseModels/Index";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import OpenStackResourceService, {
  OpenStackInventorySummary,
  ParsedOpenStackResource,
} from "Common/Server/Services/OpenStackResourceService";
import logger from "Common/Server/Utils/Logger";
import OpenStackProbeMetrics, {
  OpenStackProbeMetricsPayload,
} from "Common/Server/Utils/OpenStack/OpenStackProbeMetrics";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  getOpenStackHostsToReconcile,
  isOpenStackSnapshotDatapoint,
} from "Common/Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackCollectionReport } from "Common/Types/OpenStack/OpenStackProbeCollection";
import { OpenStackResourceKind, OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_LARGE_CLOUD,
  OPENSTACK_MEDIUM_CLOUD,
  OPENSTACK_SMALL_CLOUD,
  OpenStackCloudCounts,
  simulateOpenStackProbeRequests,
} from "Common/Types/OpenStack/OpenStackScale";
import { FastestRun, fastestRunAsync } from "Common/Tests/Helpers/FastestRun";
import OpenStackCollector from "../../../Utils/OpenStack/OpenStackCollector";
import OpenStackCollectorMemory from "../../../Utils/OpenStack/OpenStackCollectorMemory";
import { splitOpenStackReport } from "../../../Utils/OpenStack/OpenStackReportParts";
import { DEFAULT_OPENSTACK_CLOCK } from "../../../Utils/OpenStack/OpenStackServiceClient";
import { CollectorHarness, collectionJob, createCollectorHarness } from "./Helpers/CollectorHarness";
import MockOpenStackCloud, { MOCK_AUTH_URL } from "./Helpers/MockOpenStackCloud";

/*
 * THE SOAK: the largest size held for an hour, on a real clock, with its budgets asserted.
 *
 * The real collector reads a mock API of that size every two minutes. What it reports goes through
 * the real prepare, fold and upsert into a real Postgres, in the parts a probe uploads, while the
 * real sweep and the Overview's real reads run beside it, so a writer has something to wait for.
 *
 * What it leaves out, because this does not run them: the HTTP server and queue between a probe
 * and ingest, and ClickHouse. A monitor's or a chart's read of the series is not in here, only the
 * inventory's write and read path.
 *
 * Opt in, against a database the registered migrations have been applied to:
 *
 *   RUN_OPENSTACK_SOAK=true OPENSTACK_SOAK_MINUTES=60 OPENSTACK_SOAK_SIZE=large \
 *   OPENSTACK_INVENTORY_TEST_DATABASE_HOST=127.0.0.1 \
 *   OPENSTACK_INVENTORY_TEST_DATABASE_PORT=5400 DATABASE_PASSWORD=... \
 *   OPENSTACK_SOAK_MEASURES=/tmp/soak.json \
 *   node --max-old-space-size=8192 node_modules/.bin/jest --runInBand \
 *     Tests/Utils/OpenStack/OpenStackSoak.test.ts --forceExit
 *
 * The clock is real, so a machine busy with other things can overrun a time budget by itself. The
 * request counts cannot: they are exact, and fail on any machine or none. Times go through
 * fastestRunAsync, which allows for how much slower than usual the machine ran.
 */
const describeSoak: typeof describe =
  process.env["RUN_OPENSTACK_SOAK"] === "true" ? describe : describe.skip;

const MINUTES: number = Number(process.env["OPENSTACK_SOAK_MINUTES"] || "60");
const INTERVAL_IN_MINUTES: number = 2;
const INTERVAL_IN_MS: number = INTERVAL_IN_MINUTES * 60_000;

const SIZES: Record<string, OpenStackCloudCounts> = {
  small: OPENSTACK_SMALL_CLOUD,
  medium: OPENSTACK_MEDIUM_CLOUD,
  large: OPENSTACK_LARGE_CLOUD,
};

const COUNTS: OpenStackCloudCounts =
  SIZES[process.env["OPENSTACK_SOAK_SIZE"] || "large"] || OPENSTACK_LARGE_CLOUD;

// A cloud is never still: this many of each change in a collection's time.
const INSTANCES_CHANGED_PER_COLLECTION: number = Math.ceil(COUNTS.instances / 1000);

// The stated budgets.
const INGEST_LAG_BUDGET_IN_MS: number = INTERVAL_IN_MS;
const OVERVIEW_BUDGET_IN_MS: number = 6000;
const LOCK_WAIT_BUDGET_IN_MS: number = 5000;

const TABLE: string = "OpenStackResource";
const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();

interface Round {
  startedAtMinute: number;
  collectMs: number;
  writeMs: number;
  // From when the collection began to its last row being written.
  lagMs: number;
  uploads: number;
  payloadBytes: number;
  datapoints: number;
  rowsWritten: number;
  heapUsedMb: number;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, milliseconds);
  });
}

// The fold of one upload, exactly as OtelMetricsIngestService does it, without ClickHouse.
function foldUpload(report: OpenStackCollectionReport): Array<OpenStackResourceBufferEntry> {
  const payload: OpenStackProbeMetricsPayload = OpenStackProbeMetrics.prepare({
    resourceMetrics: report.resourceMetrics,
    cloudName: "soak",
  });
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();

  for (const resource of payload.resourceMetrics as Array<JSONObject>) {
    for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of scope["metrics"] as Array<JSONObject>) {
        const metricName: string = metric["name"] as string;
        const gauge: JSONObject | undefined = metric["gauge"] as JSONObject | undefined;

        for (const datapoint of (gauge?.["dataPoints"] || []) as Array<JSONObject>) {
          if (isOpenStackSnapshotDatapoint({ metricName, datapoint })) {
            bufferOpenStackSnapshotMetric({ metricName, datapoint, buffer });
          }
        }
      }
    }
  }

  return finishOpenStackBatch(buffer.values());
}

function toRow(entry: OpenStackResourceBufferEntry): ParsedOpenStackResource {
  return {
    kind: entry.kind,
    externalId: entry.externalId,
    name: entry.name,
    regionName: entry.regionName,
    availabilityZone: entry.availabilityZone,
    hypervisorName: entry.hypervisorName,
    openStackProjectId: entry.openStackProjectId,
    status: entry.status,
    adminState: entry.adminState,
    disabledReason: entry.disabledReason,
    vcpuCapacity: entry.vcpuCapacity,
    vcpuAllocated: entry.vcpuAllocated,
    memoryCapacityBytes: entry.memoryCapacityBytes,
    memoryAllocatedBytes: entry.memoryAllocatedBytes,
    diskCapacityBytes: entry.diskCapacityBytes,
    diskAllocatedBytes: entry.diskAllocatedBytes,
    instanceCount: entry.instanceCount,
    facts: entry.facts,
    lastSeenAt: entry.observedAt,
  };
}

describeSoak("the largest size, held for as long as it is asked", () => {
  const schema: string = `openstack_soak_${Date.now()}`;
  let database: DataSource;
  let monitor: DataSource;

  beforeAll(async () => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    const options: Record<string, unknown> = {
      type: "postgres",
      host: process.env["OPENSTACK_INVENTORY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["OPENSTACK_INVENTORY_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["OPENSTACK_INVENTORY_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
    };

    database = new DataSource({
      ...options,
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},pg_catalog`, max: 10 },
    } as never);
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."${TABLE}" (LIKE public."${TABLE}" INCLUDING ALL)`,
    );

    monitor = new DataSource({ ...options, entities: [] } as never);
    await monitor.initialize();

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  }, 120000);

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
    if (monitor?.isInitialized) {
      await monitor.destroy();
    }
    jest.restoreAllMocks();
  }, 120000);

  test(
    "requests per minute, ingest lag, the Overview's load time and writers waiting on locks all hold",
    async () => {
      const cloud: MockOpenStackCloud = new MockOpenStackCloud({
        counts: COUNTS,
        clock: DEFAULT_OPENSTACK_CLOCK,
      });
      const harness: CollectorHarness = createCollectorHarness({
        transport: cloud.transport,
        clock: DEFAULT_OPENSTACK_CLOCK as never,
        memory: new OpenStackCollectorMemory(),
      });
      const job: ReturnType<typeof collectionJob> = collectionJob({
        authUrl: MOCK_AUTH_URL,
        collectionIntervalInMinutes: INTERVAL_IN_MINUTES,
      });
      const scope: { projectId: ObjectID; openStackCloudId: ObjectID } = {
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
      };

      const overviewRead: () => Promise<number> = async (): Promise<number> => {
        const summary: OpenStackInventorySummary =
          await OpenStackResourceService.getInventorySummary(scope);

        await OpenStackResourceService.getAttentionRows({
          ...scope,
          now: new Date(),
        });
        await OpenStackResourceService.getRegionSummaries(scope);
        await OpenStackResourceService.getTopConsumers(scope);

        return summary.instanceCount;
      };

      const rounds: Array<Round> = [];
      const overviewMs: Array<number> = [];
      const lockWaits: Array<{ count: number; longestMs: number }> = [];
      const failures: Array<string> = [];
      let isRunning: boolean = true;
      let skipped: number = 0;

      // Whoever is waiting on a lock on this table right now, once a second.
      const watchLocks: Promise<void> = (async (): Promise<void> => {
        while (isRunning) {
          const rows: Array<{ count: string; longest: string | null }> =
            await monitor.query(
              `SELECT COUNT(*)::text AS "count",
                      (EXTRACT(EPOCH FROM MAX(now() - state_change)) * 1000)::text AS "longest"
               FROM pg_stat_activity
               WHERE wait_event_type = 'Lock' AND datname = current_database()
                 AND query LIKE '%"OpenStackResource"%'`,
            );

          lockWaits.push({
            count: Number(rows[0]?.count || "0"),
            longestMs: Number(rows[0]?.longest || "0"),
          });
          await sleep(1000);
        }
      })();

      // The Overview, opened now and then, and the sweep, as the worker runs it.
      const reads: Promise<void> = (async (): Promise<void> => {
        while (isRunning) {
          const startedAt: number = Date.now();

          try {
            await overviewRead();
            overviewMs.push(Date.now() - startedAt);
            await OpenStackResourceService.deleteStaleForCloud(scope);
          } catch (error) {
            failures.push(`The Overview's reads: ${String(error)}`);
          }

          await sleep(30_000);
        }
      })();

      const startedAt: number = Date.now();
      const until: number = startedAt + MINUTES * 60_000;
      let collection: number = 0;
      let inFlight: Promise<void> | null = null;

      const runOne: (index: number) => Promise<void> = async (
        index: number,
      ): Promise<void> => {
        const begun: number = Date.now();

        // What changed since the last one, in Nova, and in Placement where it writes generations.
        const changing: Array<number> = [];

        for (let offset: number = 0; offset < INSTANCES_CHANGED_PER_COLLECTION; offset++) {
          changing.push((index * INSTANCES_CHANGED_PER_COLLECTION + offset) % COUNTS.instances);
        }

        cloud.changeInstances(changing, index % 2 === 0 ? "SHUTOFF" : "ACTIVE");

        const report: OpenStackCollectionReport = await OpenStackCollector.collect(
          job,
          harness.dependencies,
        );

        if (report.status !== "Succeeded") {
          failures.push(
            `Collection ${index}: ${report.status}: ${report.errorMessage || ""}`,
          );
        }

        const collected: number = Date.now();
        const parts: Array<OpenStackCollectionReport> = splitOpenStackReport(report);
        let rowsWritten: number = 0;

        for (const part of parts) {
          const finished: Array<OpenStackResourceBufferEntry> = foldUpload(part);

          await OpenStackResourceService.bulkUpsert({
            ...scope,
            resources: finished.map(toRow),
          });
          await OpenStackResourceService.reconcileHypervisorStates({
            ...scope,
            shortHostNames: getOpenStackHostsToReconcile(finished),
          });
          rowsWritten += finished.length;
        }

        const written: number = Date.now();

        rounds.push({
          startedAtMinute: (begun - startedAt) / 60_000,
          collectMs: collected - begun,
          writeMs: written - collected,
          lagMs: written - begun,
          uploads: parts.length,
          payloadBytes: Buffer.byteLength(JSON.stringify(report.resourceMetrics)),
          datapoints: report.summary?.datapointCount || 0,
          rowsWritten: rowsWritten,
          heapUsedMb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
        });
      };

      /*
       * As the server hands out work: every two minutes, and never beside one still running. The
       * first collection of a cold cloud is the expensive one, so a cloud that does not keep up
       * shows as skipped rounds here rather than as anything stacked.
       */
      while (Date.now() < until) {
        const dueAt: number = startedAt + collection * INTERVAL_IN_MS;

        if (Date.now() >= dueAt) {
          if (inFlight) {
            skipped++;
          } else {
            const index: number = collection;

            inFlight = runOne(index)
              .catch((error: unknown) => {
                failures.push(`Collection ${index}: ${String(error)}`);
              })
              .finally(() => {
                inFlight = null;
              });
          }

          collection++;
        }

        await sleep(1000);
      }

      if (inFlight) {
        await inFlight;
      }

      isRunning = false;
      await Promise.all([watchLocks, reads]);

      const overview: FastestRun<number> = await fastestRunAsync({
        run: overviewRead,
        limitInMs: OVERVIEW_BUDGET_IN_MS,
      });

      const expected: Record<OpenStackServiceType, number> =
        simulateOpenStackProbeRequests({
          counts: COUNTS,
          fromMinute: 0,
          toMinute: collection * INTERVAL_IN_MINUTES,
          options: {
            collectionIntervalInMinutes: INTERVAL_IN_MINUTES,
            instancesChangedPerCollection: INSTANCES_CHANGED_PER_COLLECTION,
          },
        });

      const settled: Array<Round> = rounds.slice(1);
      const worst: (values: Array<number>) => number = (
        values: Array<number>,
      ): number => {
        return values.length > 0 ? Math.max(...values) : 0;
      };

      const measures: JSONObject = {
        ranOn: `${process.platform} ${process.arch}`,
        minutesAsked: MINUTES,
        collections: rounds.length,
        skippedCollections: skipped,
        counts: COUNTS as unknown as JSONObject,
        requests: cloud.countsByService(),
        requestsExpected: expected,
        requestsPerMinute: Object.fromEntries(
          Object.entries(cloud.countsByService()).map(
            ([service, count]: [string, number]): [string, number] => {
              return [service, Math.round((count / MINUTES) * 10) / 10];
            },
          ),
        ),
        firstCollectMs: rounds[0]?.collectMs ?? 0,
        firstWriteMs: rounds[0]?.writeMs ?? 0,
        worstCollectMs: worst(settled.map((round: Round) => {
          return round.collectMs;
        })),
        worstWriteMs: worst(settled.map((round: Round) => {
          return round.writeMs;
        })),
        worstLagMs: worst(rounds.map((round: Round) => {
          return round.lagMs;
        })),
        settledLagMs: settled.map((round: Round) => {
          return round.lagMs;
        }),
        payloadBytes: rounds.map((round: Round) => {
          return round.payloadBytes;
        }),
        uploads: rounds.map((round: Round) => {
          return round.uploads;
        }),
        rowsWritten: rounds.map((round: Round) => {
          return round.rowsWritten;
        }),
        worstHeapUsedMb: worst(rounds.map((round: Round) => {
          return round.heapUsedMb;
        })),
        overviewMsSamples: overviewMs,
        overviewFastestMs: overview.measuredInMs,
        overviewAdjustedMs: overview.inMs,
        overviewSlowdown: overview.slowdown,
        lockSamples: lockWaits.length,
        lockSamplesWithAWaiter: lockWaits.filter((sample: { count: number }) => {
          return sample.count > 0;
        }).length,
        longestLockWaitMs: Math.round(
          worst(lockWaits.map((sample: { longestMs: number }) => {
            return sample.longestMs;
          })),
        ),
        failures: failures,
      } as unknown as JSONObject;

      const file: string | undefined = process.env["OPENSTACK_SOAK_MEASURES"];

      if (file) {
        fs.writeFileSync(path.resolve(file), JSON.stringify(measures, null, 2));
      }

      // Nothing failed, on either side.
      expect(failures).toEqual([]);

      // The control plane's budget, which no machine can bend: each service's count is exact.
      expect(skipped).toBe(0);
      expect(cloud.countsByService()).toEqual(expected);

      // Every row is written before the next collection is due, once the first has built them.
      for (const round of settled) {
        expect(round.lagMs).toBeLessThan(INGEST_LAG_BUDGET_IN_MS);
      }

      // Every row is really there, and the Overview opens within its budget.
      expect(overview.result).toBe(COUNTS.instances);
      expect(overview.inMs).toBeLessThan(OVERVIEW_BUDGET_IN_MS);

      // No writer waited long on a lock on this table.
      expect(
        worst(lockWaits.map((sample: { longestMs: number }) => {
          return sample.longestMs;
        })),
      ).toBeLessThan(LOCK_WAIT_BUDGET_IN_MS);

      // The kinds are all there in the end, which says the parts all arrived.
      const rows: Array<{ kind: string; count: string }> = await database.query(
        `SELECT "kind", COUNT(*)::text AS "count" FROM "${schema}"."${TABLE}" GROUP BY "kind"`,
      );
      const byKind: Record<string, number> = Object.fromEntries(
        rows.map((row: { kind: string; count: string }): [string, number] => {
          return [row.kind, Number(row.count)];
        }),
      );

      expect(byKind[OpenStackResourceKind.Hypervisor]).toBe(COUNTS.hypervisors);
      expect(byKind[OpenStackResourceKind.Instance]).toBe(COUNTS.instances);
      expect(byKind[OpenStackResourceKind.Volume]).toBe(COUNTS.volumes);
      expect(byKind[OpenStackResourceKind.Project]).toBe(COUNTS.projects);
    },
    (MINUTES + 30) * 60_000,
  );
});
