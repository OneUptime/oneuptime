import DatabaseService from "../../../Server/Services/DatabaseService";
import MonitorService from "../../../Server/Services/MonitorService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import Realtime from "../../../Server/Utils/Realtime";
import RealtimeReaders from "../../../Server/Utils/Realtime/RealtimeReaders";
import {
  NO_READER_ACCESS,
  RealtimeReadAccess,
} from "../../../Server/Utils/Realtime/RealtimeReadAccess";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import StatusPageOverviewCache from "../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ObjectID from "../../../Types/ObjectID";
import ModelEventType from "../../../Types/Realtime/ModelEventType";
import ServerMonitorResponse from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import NotOperationalMonitorQuery from "../../../Utils/Monitor/NotOperationalMonitorQuery";
import MonitorFirstMeasured from "../../../Server/Utils/Monitor/MonitorFirstMeasured";
import { useInMemoryTable } from "../TestingUtils/InMemoryRepository";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * MONITORS AND MAINTENANCE EVENTS ANNOUNCE THEIR CHANGES (#6918).
 *
 * The Monitors menu counts Not Operational, Disabled, Probe Disconnected and
 * Probe Disabled, and the Maintenance Events menu counts the events in
 * progress. What they count changes on its own - a check fails and moves a
 * monitor's status, every probe watching it disconnects, an event starts at
 * its time - and the counts and the lists beside them used to move only
 * after a reload. The server now announces every monitor and event created,
 * changed or deleted, to the people who may read it (Realtime), and the
 * Dashboard's counts and lists read again (UseLiveCount, UseLiveRows).
 *
 * What is pinned here:
 *
 *   - a write made through the service - a status change, a probe's flags,
 *     monitoring turned off, an archive, an event's state - is announced,
 *     with the service's own read deciding who hears it, and only when it
 *     changed the row;
 *   - the bookkeeping a heartbeat or a probe's result stamps is written
 *     without hooks and announces nothing, so an open Monitors page is not
 *     asked to read again every minute for a change nothing on it shows;
 *   - but a monitor's first measurement, stamped the same way, is announced
 *     once it took (#8974): the list's row says Waiting for data until it,
 *     and a first result that keeps the status changes nothing else;
 *   - the writes the counts follow go through the service, never around it.
 *
 * The real services and the real update pipeline, without Postgres
 * (InMemoryRepository).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const MONITOR_ID: string = "b0000000-0000-4000-8000-00000000000b";
const EVENT_ID: string = "c0000000-0000-4000-8000-00000000000c";
const ONLINE_STATUS_ID: string = "d0000000-0000-4000-8000-00000000000d";
const OFFLINE_STATUS_ID: string = "e0000000-0000-4000-8000-00000000000e";
const SCHEDULED_STATE_ID: string = "f0000000-0000-4000-8000-00000000000f";
const ONGOING_STATE_ID: string = "a1000000-0000-4000-8000-0000000000a1";

interface EmittedEvent {
  tenantId: unknown;
  eventType: ModelEventType;
  modelId: ObjectID;
  modelType: unknown;
  access: RealtimeReadAccess;
}

let emitted: jest.SpyInstance;

function eventsSent(): Array<EmittedEvent> {
  return emitted.mock.calls.map((call: Array<unknown>): EmittedEvent => {
    return call[0] as EmittedEvent;
  });
}

/*
 * The service's table in memory, with what a write calls on its way out
 * stubbed - except onTriggerRealtime, which is the real one, so a write is
 * followed all the way to Realtime.emitModelEvent.
 */
function inMemory<TBaseModel extends BaseModel>(
  service: DatabaseService<TBaseModel>,
  row: Record<string, unknown>,
): ReturnType<typeof useInMemoryTable> {
  const table: ReturnType<typeof useInMemoryTable> = useInMemoryTable(
    service as unknown as DatabaseService<BaseModel>,
    [row],
  );

  (service.onTriggerRealtime as unknown as jest.SpyInstance).mockRestore();

  return table;
}

beforeEach(() => {
  RealtimeReaders.clear();

  jest.spyOn(PublishedImages, "afterUpdate").mockResolvedValue(undefined);
  jest
    .spyOn(StatusPageOverviewCache, "afterUpdate")
    .mockResolvedValue(undefined);
  jest.spyOn(AuditLogService, "recordUpdate").mockResolvedValue(undefined);

  // Realtime runs on this server; nobody listens before the write.
  jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);
  jest
    .spyOn(Realtime, "snapshotReadAccess")
    .mockResolvedValue(NO_READER_ACCESS);
  emitted = jest.spyOn(Realtime, "emitModelEvent").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a monitor's changes are announced, so the Monitors menu follows them", () => {
  let table: ReturnType<typeof useInMemoryTable>;

  beforeEach(() => {
    table = inMemory(MonitorService as unknown as DatabaseService<Monitor>, {
      _id: MONITOR_ID,
      projectId: PROJECT_ID.toString(),
      name: "Checkout API",
      currentMonitorStatusId: ONLINE_STATUS_ID,
      disableActiveMonitoring: false,
      isArchived: false,
      isAllProbesDisconnectedFromThisMonitor: false,
      isNoProbeEnabledOnThisMonitor: false,
    });
  });

  async function write(data: Record<string, unknown>): Promise<void> {
    await MonitorService.updateOneBy({
      query: { _id: MONITOR_ID },
      data: data as never,
      props: { isRoot: true, ignoreHooks: true },
    });
  }

  test("the model announces every kind of change, or none of this is heard", () => {
    expect(new Monitor().enableRealtimeEventsOn).toEqual({
      create: true,
      update: true,
      delete: true,
    });
    // An update is announced beside its workflow trigger (DatabaseService).
    expect(new Monitor().enableWorkflowOn?.update).toBe(true);
  });

  test("a check that moves its status (Not Operational) is announced, to whoever its own read lets in", async () => {
    await write({ currentMonitorStatusId: OFFLINE_STATUS_ID });

    expect(eventsSent()).toHaveLength(1);

    const event: EmittedEvent = eventsSent()[0]!;
    expect(event.eventType).toBe(ModelEventType.Update);
    expect(event.modelType).toBe(Monitor);
    expect(event.tenantId?.toString()).toBe(PROJECT_ID.toString());
    expect(event.modelId.toString()).toBe(MONITOR_ID);
    // Who hears it is the service's own read: labels, Owned and blocks count.
    expect(event.access).toBe(MonitorService.getRealtimeReadAccess());

    expect(String(table.get(MONITOR_ID)!["currentMonitorStatusId"])).toBe(
      OFFLINE_STATUS_ID,
    );
  });

  test("a status written back as it stands is no change: nothing is announced", async () => {
    await write({ currentMonitorStatusId: ONLINE_STATUS_ID });

    expect(eventsSent()).toHaveLength(0);
  });

  test.each([
    [
      "every probe disconnected (Probe Disconnected)",
      "isAllProbesDisconnectedFromThisMonitor",
    ],
    ["no probe left enabled (Probe Disabled)", "isNoProbeEnabledOnThisMonitor"],
    ["monitoring turned off (Disabled)", "disableActiveMonitoring"],
    ["archived (out of every count)", "isArchived"],
  ])("%s is announced", async (_what: string, column: string) => {
    await write({ [column]: true });

    expect(
      eventsSent().map((event: EmittedEvent): string => {
        return `${event.eventType}:${event.modelId.toString()}`;
      }),
    ).toEqual([`${ModelEventType.Update}:${MONITOR_ID}`]);
  });

  /*
   * What a one-statement, hook-free write reads of the table - its columns
   * and its driver - with `query` standing in for Postgres.
   */
  function withHookFreeWrites(query: MockFunction): void {
    Object.assign(table.repository as unknown as Record<string, unknown>, {
      metadata: {
        tableName: "Monitor",
        findColumnWithPropertyName: (
          propertyName: string,
        ): { databaseName: string; propertyName: string } | undefined => {
          return new Monitor().isTableColumn(propertyName)
            ? { databaseName: propertyName, propertyName: propertyName }
            : undefined;
        },
        updateDateColumn: { databaseName: "updatedAt" },
        primaryColumns: [{ databaseName: "_id" }],
      },
      manager: {
        connection: {
          driver: {
            preparePersistentValue: (value: unknown): unknown => {
              return value;
            },
          },
        },
        query: query,
      },
    });
  }

  test("a heartbeat's stamp is written without hooks, and announces nothing", async () => {
    const query: MockFunction = getJestMockFunction().mockResolvedValue([]);

    withHookFreeWrites(query);

    await MonitorService.updateColumnsByIdWithoutHooks({
      id: new ObjectID(MONITOR_ID),
      data: {
        incomingRequestMonitorHeartbeatCheckedAt: new Date(),
      },
    });

    // The stamp was written...
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0]![0])).toContain(
      '"incomingRequestMonitorHeartbeatCheckedAt"',
    );
    // ...and no open page was asked to read again for it.
    expect(eventsSent()).toHaveLength(0);
  });

  /*
   * A monitor's first measurement (#8974). Its stamp, firstMeasuredAt, is
   * written without hooks as the heartbeat's bookkeeping is - it must never
   * queue behind another writer of the row - and used to announce nothing
   * like it: a first result that left the status as it was left a Monitors
   * list open on Waiting for data. A stamp that took is announced now, once
   * in the monitor's life.
   */
  describe("a monitor's first measurement", () => {
    // Postgres's answer to the guarded stamp: written while the column is empty.
    function guardedStamp(): MockFunction {
      return getJestMockFunction().mockImplementation((async (
        sql: string,
        params: Array<unknown>,
      ): Promise<Array<{ _id: unknown }>> => {
        expect(sql).toContain('"firstMeasuredAt" IS NOT DISTINCT FROM $3');
        // It yields to another writer of the row rather than queue behind it.
        expect(sql).toContain("FOR UPDATE SKIP LOCKED");
        expect(params[2]).toBeNull();

        const row: Record<string, unknown> | undefined = table.get(
          String(params[1]),
        );

        if (
          !row ||
          (row["firstMeasuredAt"] !== undefined &&
            row["firstMeasuredAt"] !== null)
        ) {
          return [];
        }

        row["firstMeasuredAt"] = params[0];

        return [{ _id: row["_id"] }];
      }) as never);
    }

    // The monitor as a probe's result reads it, before anything measured it.
    const readBeforeTheStamp: () => Monitor = (): Monitor => {
      const monitor: Monitor = new Monitor();
      monitor.id = new ObjectID(MONITOR_ID);
      monitor.projectId = PROJECT_ID;
      (monitor as unknown as Record<string, unknown>)["firstMeasuredAt"] = null;
      return monitor;
    };

    const probeResult: ProbeMonitorResponse = {
      projectId: PROJECT_ID,
      monitorId: new ObjectID(MONITOR_ID),
      isOnline: true,
    } as unknown as ProbeMonitorResponse;

    test("that keeps its status is announced, once, to whoever its own read lets in", async () => {
      const query: MockFunction = guardedStamp();
      withHookFreeWrites(query);

      expect(
        await MonitorFirstMeasured.stampIfFirst({
          monitor: readBeforeTheStamp(),
          dataToProcess: probeResult,
        }),
      ).toBe(true);

      // Stamped, and the status left as it was: no write went through the service.
      expect(query).toHaveBeenCalledTimes(1);
      expect(table.get(MONITOR_ID)!["firstMeasuredAt"]).toBeInstanceOf(Date);
      expect(String(table.get(MONITOR_ID)!["currentMonitorStatusId"])).toBe(
        ONLINE_STATUS_ID,
      );
      expect(table.updates).toHaveLength(0);

      expect(eventsSent()).toHaveLength(1);

      const event: EmittedEvent = eventsSent()[0]!;
      expect(event.eventType).toBe(ModelEventType.Update);
      expect(event.modelType).toBe(Monitor);
      expect(event.tenantId?.toString()).toBe(PROJECT_ID.toString());
      expect(event.modelId.toString()).toBe(MONITOR_ID);
      // Labels, Owned and blocks count: the service's own read decides.
      expect(event.access).toBe(MonitorService.getRealtimeReadAccess());
    });

    test("a second first result, read before the stamp landed, finds the column taken: nothing written, nothing announced", async () => {
      withHookFreeWrites(guardedStamp());

      await MonitorFirstMeasured.stampIfFirst({
        monitor: readBeforeTheStamp(),
        dataToProcess: probeResult,
      });
      emitted.mockClear();

      expect(
        await MonitorFirstMeasured.stampIfFirst({
          monitor: readBeforeTheStamp(),
          dataToProcess: probeResult,
        }),
      ).toBe(false);
      expect(eventsSent()).toHaveLength(0);
    });

    test("a row another writer holds is skipped, and announces nothing", async () => {
      // Locked: the sub-SELECT skips it, and nothing is written.
      withHookFreeWrites(getJestMockFunction().mockResolvedValue([] as never));

      expect(
        await MonitorFirstMeasured.stampIfFirst({
          monitor: readBeforeTheStamp(),
          dataToProcess: probeResult,
        }),
      ).toBe(false);
      expect(eventsSent()).toHaveLength(0);
    });

    test("a heartbeat sweep's look at what has not arrived stamps nothing and announces nothing", async () => {
      const query: MockFunction = guardedStamp();
      withHookFreeWrites(query);

      expect(
        await MonitorFirstMeasured.stampIfFirst({
          monitor: readBeforeTheStamp(),
          dataToProcess: {
            projectId: PROJECT_ID,
            monitorId: new ObjectID(MONITOR_ID),
            onlyCheckRequestReceivedAt: true,
          } as unknown as ServerMonitorResponse,
        }),
      ).toBe(false);
      expect(query).not.toHaveBeenCalled();
      expect(eventsSent()).toHaveLength(0);
    });
  });

  test.each([
    ["created", ModelEventType.Create],
    ["deleted", ModelEventType.Delete],
  ])(
    "a monitor %s is announced too",
    async (_what: string, eventType: ModelEventType) => {
      const monitorId: ObjectID = ObjectID.generate();

      await MonitorService.onTriggerRealtime(monitorId, PROJECT_ID, eventType);

      expect(eventsSent()).toEqual([
        {
          tenantId: PROJECT_ID,
          eventType: eventType,
          modelId: monitorId,
          modelType: Monitor,
          access: MonitorService.getRealtimeReadAccess(),
        },
      ]);
    },
  );
});

describe("a maintenance event's changes are announced, so Ongoing follows them", () => {
  let table: ReturnType<typeof useInMemoryTable>;

  beforeEach(() => {
    table = inMemory(
      ScheduledMaintenanceService as unknown as DatabaseService<ScheduledMaintenance>,
      {
        _id: EVENT_ID,
        projectId: PROJECT_ID.toString(),
        title: "Database upgrade",
        currentScheduledMaintenanceStateId: SCHEDULED_STATE_ID,
      },
    );
  });

  test("the model announces every kind of change, or none of this is heard", () => {
    expect(new ScheduledMaintenance().enableRealtimeEventsOn).toEqual({
      create: true,
      update: true,
      delete: true,
    });
    expect(new ScheduledMaintenance().enableWorkflowOn?.update).toBe(true);
  });

  test("an event starting at its time (its state moving on) is announced", async () => {
    await ScheduledMaintenanceService.updateOneBy({
      query: { _id: EVENT_ID },
      data: { currentScheduledMaintenanceStateId: ONGOING_STATE_ID } as never,
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(eventsSent()).toHaveLength(1);

    const event: EmittedEvent = eventsSent()[0]!;
    expect(event.eventType).toBe(ModelEventType.Update);
    expect(event.modelType).toBe(ScheduledMaintenance);
    expect(event.modelId.toString()).toBe(EVENT_ID);
    expect(event.access).toBe(
      ScheduledMaintenanceService.getRealtimeReadAccess(),
    );

    expect(
      String(table.get(EVENT_ID)!["currentScheduledMaintenanceStateId"]),
    ).toBe(ONGOING_STATE_ID);
  });

  test.each([
    ["created", ModelEventType.Create],
    ["deleted", ModelEventType.Delete],
  ])(
    "an event %s is announced too",
    async (_what: string, eventType: ModelEventType) => {
      const eventId: ObjectID = ObjectID.generate();

      await ScheduledMaintenanceService.onTriggerRealtime(
        eventId,
        PROJECT_ID,
        eventType,
      );

      expect(
        eventsSent().map((event: EmittedEvent): string => {
          return `${event.eventType}:${event.modelId.toString()}`;
        }),
      ).toEqual([`${eventType}:${eventId.toString()}`]);
    },
  );
});

/*
 * A count follows what is announced, and only a write made through the
 * service is announced. So the writes that move what the menus count must
 * stay on that path: one moved to a hook-free write would leave the count
 * where it was, with nothing failing anywhere. These read the source.
 */
describe("the writes the counts follow are made through the service", () => {
  const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");
  const SERVER: string = path.join(REPOSITORY_ROOT, "packages/Common/Server");

  // All whitespace removed, for code Prettier may wrap either way.
  function dense(text: string): string {
    return text.replace(/\s+/g, "");
  }

  function read(relativePath: string): string {
    return fs.readFileSync(path.join(SERVER, relativePath), "utf8");
  }

  // What the Monitors menu counts by (Pages/Monitor/SideMenu.tsx).
  const COUNTED_MONITOR_COLUMNS: Array<string> = Array.from(
    new Set<string>([
      ...Object.keys(NotOperationalMonitorQuery.getQuery(PROJECT_ID)),
      "currentMonitorStatusId",
      "isArchived",
      "disableActiveMonitoring",
      "isAllProbesDisconnectedFromThisMonitor",
      "isNoProbeEnabledOnThisMonitor",
    ]),
  );

  test("a status change writes the monitor's status through MonitorService", () => {
    expect(dense(read("Services/MonitorStatusTimelineService.ts"))).toContain(
      dense(`await MonitorService.updateOneBy({
        query: {
          _id: createdItem.monitorId?.toString(),
        },
        data: {
          currentMonitorStatusId: createdItem.monitorStatusId,
        },`),
    );
  });

  test("a probe's flags are written through the service, never around it", () => {
    const source: string = read("Services/MonitorService.ts");
    const start: number = source.indexOf("public async syncMonitorProbeFlags(");
    const end: number = source.indexOf("@CaptureSpan()", start);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const body: string = source.slice(start, end);

    for (const column of [
      "isNoProbeEnabledOnThisMonitor",
      "isAllProbesDisconnectedFromThisMonitor",
    ]) {
      expect(dense(body)).toContain(
        dense(`await this.updateOneById({
          id: monitorId,
          data: {
            ${column}:`),
      );
    }

    expect(body).not.toContain("WithoutHooks");
  });

  test("an event's state is written through ScheduledMaintenanceService, and the workers move it through its timeline", () => {
    expect(
      dense(read("Services/ScheduledMaintenanceStateTimelineService.ts")),
    ).toContain(
      dense(`await ScheduledMaintenanceService.updateOneBy({
        query: {
          _id: createdItem.scheduledMaintenanceId?.toString(),
        },
        data: {
          currentScheduledMaintenanceStateId:
            createdItem.scheduledMaintenanceStateId,
        },`),
    );

    const service: string = read("Services/ScheduledMaintenanceService.ts");
    const start: number = service.indexOf(
      "public async changeScheduledMaintenanceState(",
    );
    expect(start).toBeGreaterThan(-1);
    expect(service.slice(start)).toContain(
      "await ScheduledMaintenanceStateTimelineService.create(",
    );
  });

  test("no hook-free write of a monitor writes a column the Monitors menu counts", () => {
    const roots: Array<string> = [
      SERVER,
      path.join(REPOSITORY_ROOT, "packages/App/FeatureSet"),
    ];
    const calls: Array<{ file: string; call: string }> = [];

    const visit: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          if (
            entry.name !== "node_modules" &&
            entry.name !== "build" &&
            entry.name !== "dist"
          ) {
            visit(entryPath);
          }

          continue;
        }

        if (!entry.name.endsWith(".ts")) {
          continue;
        }

        const source: string = fs.readFileSync(entryPath, "utf8");
        const pattern: RegExp = /MonitorService\.[A-Za-z]*WithoutHooks\(/g;
        let match: RegExpExecArray | null = pattern.exec(source);

        while (match) {
          // The call's arguments, to the parenthesis that closes it.
          let depth: number = 0;
          let index: number = match.index + match[0].length - 1;

          for (; index < source.length; index++) {
            if (source[index] === "(") {
              depth++;
            } else if (source[index] === ")") {
              depth--;

              if (depth === 0) {
                break;
              }
            }
          }

          calls.push({
            file: path.relative(REPOSITORY_ROOT, entryPath),
            call: source.slice(match.index, index + 1),
          });

          match = pattern.exec(source);
        }
      }
    };

    for (const root of roots) {
      visit(root);
    }

    // The scan sees the heartbeat stamps it is there for.
    expect(
      calls.some((found: { file: string }): boolean => {
        return found.file.endsWith("IncomingRequestMonitor/CheckHeartbeat.ts");
      }),
    ).toBe(true);

    for (const found of calls) {
      const named: Array<string> = COUNTED_MONITOR_COLUMNS.filter(
        (column: string): boolean => {
          return new RegExp(`\\b${column}\\b`).test(found.call);
        },
      );

      expect({ file: found.file, counted: named }).toEqual({
        file: found.file,
        counted: [],
      });
    }
  });
});
