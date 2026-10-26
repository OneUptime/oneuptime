import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ADD PROBE AND REMOVE PROBE IN THE MONITORS LIST'S BULK ACTIONS
 * (issue #5299: every bulk action, fast).
 *
 * Each of these used to read every selected monitor on its own - is the
 * probe on it already? - and then change it, one monitor after the other,
 * and listed a monitor it had nothing to do for as a failure. Now:
 *
 *   - whether the probe is on the monitors is read fifty monitors to a list
 *     request, and a window whose request fails reads its monitors one by
 *     one;
 *   - four monitors are changed at once, never more;
 *   - each monitor gets what one monitor's Add or Remove gives it: one
 *     enabled MonitorProbe row, or that row deleted - nothing else;
 *   - a monitor no probe runs, one the probe is on already (Add) or one it
 *     is not on (Remove) is left as it was and listed as not changed, with
 *     why in the reader's words - not as a failure - and nothing is written
 *     for it; a monitor no probe runs is never read about;
 *   - one the server refuses fails alone, in the server's words;
 *   - a Stop changes no monitor after it.
 *
 * The API layer is a fake that answers from the probes it holds, counts the
 * reads and holds the writes in flight when a test asks it to.
 */

const PROJECT_ID: string = "8a5c0e2f-1111-4111-8111-000000000001";
const PROBE_ID: string = "8a5c0e2f-2222-4222-8222-000000000002";

interface ListRead {
  monitorIds: Array<string>;
  probeId: string;
  projectId: string;
}

interface CreatedRow {
  modelName: string;
  monitorId: string;
  probeId: string;
  projectId: string;
  isEnabled: boolean | undefined;
}

// The MonitorProbe rows the server holds, by monitor id.
let serverAssignments: Map<string, string> = new Map<string, string>();
const listReads: Array<ListRead> = [];
const created: Array<CreatedRow> = [];
const deleted: Array<{ modelName: string; id: string }> = [];
// A list read naming more than one monitor fails when set.
let failWindowReads: boolean = false;
// Monitors whose write the server refuses, with its words.
let refusedMonitorIds: Map<string, string> = new Map<string, string>();
// When set, every write waits until the test releases it.
let holdWrites: boolean = false;
let heldWrites: Array<() => void> = [];
let writesInFlight: number = 0;
let mostWritesInFlight: number = 0;

async function write(monitorId: string): Promise<void> {
  writesInFlight += 1;
  mostWritesInFlight = Math.max(mostWritesInFlight, writesInFlight);

  try {
    if (holdWrites) {
      await new Promise<void>((resolve: () => void) => {
        heldWrites.push(resolve);
      });
    }

    const refusal: string | undefined = refusedMonitorIds.get(monitorId);

    if (refusal) {
      throw new Error(refusal);
    }
  } finally {
    writesInFlight -= 1;
  }
}

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (request: {
        modelType: { new (): { constructor: { name: string } } };
        query: Record<string, unknown>;
      }): Promise<unknown> => {
        const MonitorProbeModel: { new (): Record<string, unknown> } = (
          jest.requireActual("../../../Models/DatabaseModels/MonitorProbe") as {
            default: { new (): Record<string, unknown> };
          }
        ).default;
        const ObjectIDClass: { new (id: string): unknown } = (
          jest.requireActual("../../../Types/ObjectID") as {
            default: { new (id: string): unknown };
          }
        ).default;

        const monitorIds: Array<string> = (
          (request.query["monitorId"] as { values: Array<unknown> }).values ||
          []
        ).map((id: unknown): string => {
          return String(id);
        });

        listReads.push({
          monitorIds: monitorIds,
          probeId: String(request.query["probeId"]),
          projectId: String(request.query["projectId"]),
        });

        if (failWindowReads && monitorIds.length > 1) {
          throw new Error("The list could not be read.");
        }

        const rows: Array<Record<string, unknown>> = [];

        for (const monitorId of monitorIds) {
          const rowId: string | undefined = serverAssignments.get(monitorId);

          if (rowId) {
            const row: Record<string, unknown> = new MonitorProbeModel();
            row["_id"] = rowId;
            row["monitorId"] = new ObjectIDClass(monitorId);
            rows.push(row);
          }
        }

        return { data: rows, count: rows.length, skip: 0, limit: 10000 };
      },
      create: async (request: {
        model: Record<string, unknown>;
        modelType: { name: string };
      }): Promise<unknown> => {
        const monitorId: string = String(request.model["monitorId"]);

        await write(monitorId);

        created.push({
          modelName: request.modelType.name,
          monitorId: monitorId,
          probeId: String(request.model["probeId"]),
          projectId: String(request.model["projectId"]),
          isEnabled: request.model["isEnabled"] as boolean | undefined,
        });

        return { data: request.model };
      },
      deleteItem: async (request: {
        modelType: { name: string };
        id: { toString: () => string };
      }): Promise<void> => {
        const rowId: string = request.id.toString();
        let monitorId: string = "";

        for (const [key, value] of serverAssignments.entries()) {
          if (value === rowId) {
            monitorId = key;
          }
        }

        await write(monitorId);

        deleted.push({ modelName: request.modelType.name, id: rowId });
      },
    },
  };
});

import {
  canMonitorHaveProbes,
  PROBE_ALREADY_ASSIGNED_REASON,
  PROBE_NOT_ASSIGNED_REASON,
  PROBES_NOT_SUPPORTED_REASON,
  runBulkMonitorProbeChange,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/BulkMonitorProbeChange";
import { BULK_ACTION_CONCURRENCY } from "../../../UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionFailed,
  BulkActionOnClickProps,
  BulkActionUnchanged,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";

function monitorId(index: number): string {
  return `8a5c0e2f-3333-4333-8333-${String(index).padStart(12, "0")}`;
}

function makeMonitor(index: number, monitorType: MonitorType): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = monitorId(index);
  monitor.name = `Monitor ${index}`;
  monitor.monitorType = monitorType;
  return monitor;
}

function pingMonitors(count: number): Array<Monitor> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return makeMonitor(index + 1, MonitorType.Ping);
  });
}

// The reader's words: marked, so a test sees the reason went through them.
function translate(text: string): string {
  return `«${text}»`;
}

interface Run {
  props: BulkActionOnClickProps<Monitor>;
  reports: Array<ProgressInfo<Monitor>>;
  onStart: MockFunction;
  onEnd: MockFunction;
  stop: () => void;
  last: () => ProgressInfo<Monitor>;
}

function harness(items: Array<Monitor>): Run {
  const reports: Array<ProgressInfo<Monitor>> = [];
  const onStart: MockFunction = getJestMockFunction();
  const onEnd: MockFunction = getJestMockFunction();
  const stopController: AbortController = new AbortController();

  return {
    reports: reports,
    onStart: onStart,
    onEnd: onEnd,
    stop: (): void => {
      stopController.abort();
    },
    last: (): ProgressInfo<Monitor> => {
      return reports[reports.length - 1]!;
    },
    props: {
      items: items,
      stopSignal: stopController.signal,
      onBulkActionStart: onStart,
      onBulkActionEnd: onEnd,
      onProgressInfo: (info: ProgressInfo<Monitor>): void => {
        reports.push(info);
      },
    },
  };
}

function idsOf(monitors: Array<Monitor>): Array<string> {
  return monitors.map((monitor: Monitor): string => {
    return monitor._id!.toString();
  });
}

function unchangedOf(
  info: ProgressInfo<Monitor>,
): Array<{ id: string; reason: string }> {
  return (info.unchanged || []).map(
    (entry: BulkActionUnchanged<Monitor>): { id: string; reason: string } => {
      return { id: entry.item._id!.toString(), reason: String(entry.reason) };
    },
  );
}

function failedOf(
  info: ProgressInfo<Monitor>,
): Array<{ id: string; message: string }> {
  return info.failed.map(
    (entry: BulkActionFailed<Monitor>): { id: string; message: string } => {
      return {
        id: entry.item._id!.toString(),
        message: String(entry.failedMessage),
      };
    },
  );
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 20; i++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
}

function change(run: Run, mode: "add" | "remove"): Promise<void> {
  return runBulkMonitorProbeChange({
    actionProps: run.props,
    probeId: new ObjectID(PROBE_ID),
    projectId: new ObjectID(PROJECT_ID),
    mode: mode,
    translate: translate,
  });
}

beforeEach(() => {
  serverAssignments = new Map<string, string>();
  listReads.length = 0;
  created.length = 0;
  deleted.length = 0;
  failWindowReads = false;
  refusedMonitorIds = new Map<string, string>();
  holdWrites = false;
  heldWrites = [];
  writesInFlight = 0;
  mostWritesInFlight = 0;
});

afterEach(() => {
  // A test that held writes lets the rest go, so nothing is left waiting.
  holdWrites = false;
  for (const release of heldWrites) {
    release();
  }
  heldWrites = [];
});

describe("Add Probe", () => {
  test("reads whether the probe is on the monitors fifty to a request, never one monitor at a time", async () => {
    const monitors: Array<Monitor> = pingMonitors(120);
    const run: Run = harness(monitors);

    await change(run, "add");

    expect(
      listReads.map((read: ListRead): number => {
        return read.monitorIds.length;
      }),
    ).toEqual([50, 50, 20]);

    // Each window names its own monitors, in order, for this probe only.
    expect(
      listReads.flatMap((read: ListRead): Array<string> => {
        return read.monitorIds;
      }),
    ).toEqual(idsOf(monitors));

    for (const read of listReads) {
      expect(read.probeId).toBe(PROBE_ID);
      expect(read.projectId).toBe(PROJECT_ID);
    }

    expect(created).toHaveLength(120);
  });

  test("gives each monitor without the probe exactly one enabled MonitorProbe row, as one monitor's Add does", async () => {
    const monitors: Array<Monitor> = pingMonitors(3);
    const run: Run = harness(monitors);

    await change(run, "add");

    expect(created).toEqual(
      idsOf(monitors).map((id: string): CreatedRow => {
        return {
          modelName: "MonitorProbe",
          monitorId: id,
          probeId: PROBE_ID,
          projectId: PROJECT_ID,
          isEnabled: true,
        };
      }),
    );
    expect(deleted).toEqual([]);
    expect(idsOf(run.last().successItems)).toEqual(idsOf(monitors));
    expect(run.last().failed).toEqual([]);
    expect(run.onStart).toHaveBeenCalledTimes(1);
    expect(run.onEnd).toHaveBeenCalledTimes(1);
  });

  test("leaves a monitor the probe is on already as it was - not changed, with why in the reader's words, not failed - and writes nothing for it", async () => {
    const monitors: Array<Monitor> = pingMonitors(3);
    serverAssignments.set(monitorId(2), "8a5c0e2f-4444-4444-8444-000000000002");
    const run: Run = harness(monitors);

    await change(run, "add");

    expect(
      created.map((row: CreatedRow): string => {
        return row.monitorId;
      }),
    ).toEqual([monitorId(1), monitorId(3)]);
    expect(unchangedOf(run.last())).toEqual([
      {
        id: monitorId(2),
        reason: translate(PROBE_ALREADY_ASSIGNED_REASON),
      },
    ]);
    expect(run.last().failed).toEqual([]);
    expect(idsOf(run.last().successItems)).toEqual([
      monitorId(1),
      monitorId(3),
    ]);
  });

  test("leaves a monitor no probe runs as it was, with why, and never reads about it", async () => {
    const manual: Monitor = makeMonitor(1, MonitorType.Manual);
    const incoming: Monitor = makeMonitor(2, MonitorType.IncomingRequest);
    const ping: Monitor = makeMonitor(3, MonitorType.Ping);
    const run: Run = harness([manual, incoming, ping]);

    await change(run, "add");

    // Only the monitor a probe runs is read about, and only it is changed.
    expect(listReads).toEqual([
      { monitorIds: [monitorId(3)], probeId: PROBE_ID, projectId: PROJECT_ID },
    ]);
    expect(
      created.map((row: CreatedRow): string => {
        return row.monitorId;
      }),
    ).toEqual([monitorId(3)]);
    expect(unchangedOf(run.last())).toEqual([
      { id: monitorId(1), reason: translate(PROBES_NOT_SUPPORTED_REASON) },
      { id: monitorId(2), reason: translate(PROBES_NOT_SUPPORTED_REASON) },
    ]);
    expect(run.last().failed).toEqual([]);
  });

  test(`changes ${BULK_ACTION_CONCURRENCY} monitors at once, no more`, async () => {
    holdWrites = true;
    const run: Run = harness(pingMonitors(10));
    const running: Promise<void> = change(run, "add");

    await settle();
    expect(writesInFlight).toBe(BULK_ACTION_CONCURRENCY);

    // Each write done lets exactly one more start.
    while (heldWrites.length > 0) {
      heldWrites.shift()!();
      await settle();
      expect(writesInFlight).toBeLessThanOrEqual(BULK_ACTION_CONCURRENCY);
    }

    await running;

    expect(mostWritesInFlight).toBe(BULK_ACTION_CONCURRENCY);
    expect(created).toHaveLength(10);
  });

  test("a window whose read fails reads its monitors one by one, and changes them all the same", async () => {
    failWindowReads = true;
    const monitors: Array<Monitor> = pingMonitors(3);
    serverAssignments.set(monitorId(3), "8a5c0e2f-4444-4444-8444-000000000003");
    const run: Run = harness(monitors);

    await change(run, "add");

    // The window's one failed read, then one read for each of its monitors.
    expect(
      listReads.map((read: ListRead): Array<string> => {
        return read.monitorIds;
      }),
    ).toEqual([
      idsOf(monitors),
      [monitorId(1)],
      [monitorId(2)],
      [monitorId(3)],
    ]);
    expect(
      created.map((row: CreatedRow): string => {
        return row.monitorId;
      }),
    ).toEqual([monitorId(1), monitorId(2)]);
    expect(unchangedOf(run.last())).toEqual([
      {
        id: monitorId(3),
        reason: translate(PROBE_ALREADY_ASSIGNED_REASON),
      },
    ]);
    expect(run.last().failed).toEqual([]);
  });

  test("a monitor the server refuses fails alone, in the server's words, and the rest are changed", async () => {
    refusedMonitorIds.set(
      monitorId(2),
      "This probe is not available to this project.",
    );
    const monitors: Array<Monitor> = pingMonitors(3);
    const run: Run = harness(monitors);

    await change(run, "add");

    expect(failedOf(run.last())).toEqual([
      {
        id: monitorId(2),
        message: "This probe is not available to this project.",
      },
    ]);
    expect(idsOf(run.last().successItems)).toEqual([
      monitorId(1),
      monitorId(3),
    ]);
  });

  test("can be stopped part-way: no monitor is changed after the Stop, and the rest are listed as not started", async () => {
    holdWrites = true;
    const monitors: Array<Monitor> = pingMonitors(12);
    const run: Run = harness(monitors);
    const running: Promise<void> = change(run, "add");

    await settle();
    expect(writesInFlight).toBe(BULK_ACTION_CONCURRENCY);

    run.stop();

    // The ones running finish; nothing new starts.
    while (heldWrites.length > 0) {
      heldWrites.shift()!();
      await settle();
    }

    await running;

    expect(created).toHaveLength(BULK_ACTION_CONCURRENCY);
    expect(idsOf(run.last().successItems)).toEqual(
      idsOf(monitors.slice(0, BULK_ACTION_CONCURRENCY)),
    );
    expect(idsOf(run.last().notStartedItems || [])).toEqual(
      idsOf(monitors.slice(BULK_ACTION_CONCURRENCY)),
    );
  });
});

describe("Remove Probe", () => {
  test("deletes each monitor's MonitorProbe row by its id, and nothing else", async () => {
    const monitors: Array<Monitor> = pingMonitors(3);
    serverAssignments.set(monitorId(1), "8a5c0e2f-4444-4444-8444-000000000001");
    serverAssignments.set(monitorId(3), "8a5c0e2f-4444-4444-8444-000000000003");
    const run: Run = harness(monitors);

    await change(run, "remove");

    expect(deleted).toEqual([
      {
        modelName: "MonitorProbe",
        id: "8a5c0e2f-4444-4444-8444-000000000001",
      },
      {
        modelName: "MonitorProbe",
        id: "8a5c0e2f-4444-4444-8444-000000000003",
      },
    ]);
    expect(created).toEqual([]);

    // The monitor the probe is not on is left as it was, with why.
    expect(unchangedOf(run.last())).toEqual([
      { id: monitorId(2), reason: translate(PROBE_NOT_ASSIGNED_REASON) },
    ]);
    expect(idsOf(run.last().successItems)).toEqual([
      monitorId(1),
      monitorId(3),
    ]);
    expect(run.last().failed).toEqual([]);
  });

  test("reads a window at a time too, and leaves a monitor no probe runs alone", async () => {
    const monitors: Array<Monitor> = [
      ...pingMonitors(60),
      makeMonitor(61, MonitorType.Manual),
    ];

    for (let index: number = 1; index <= 60; index++) {
      serverAssignments.set(
        monitorId(index),
        `8a5c0e2f-4444-4444-8444-${String(index).padStart(12, "0")}`,
      );
    }

    const run: Run = harness(monitors);

    await change(run, "remove");

    expect(
      listReads.map((read: ListRead): number => {
        return read.monitorIds.length;
      }),
    ).toEqual([50, 10]);
    expect(deleted).toHaveLength(60);
    expect(unchangedOf(run.last())).toEqual([
      { id: monitorId(61), reason: translate(PROBES_NOT_SUPPORTED_REASON) },
    ]);
  });
});

describe("canMonitorHaveProbes", () => {
  test("is true for the monitors a probe runs and false for the others", () => {
    expect(canMonitorHaveProbes(makeMonitor(1, MonitorType.Ping))).toBe(true);
    expect(canMonitorHaveProbes(makeMonitor(2, MonitorType.Website))).toBe(
      true,
    );
    expect(canMonitorHaveProbes(makeMonitor(3, MonitorType.Manual))).toBe(
      false,
    );
    expect(
      canMonitorHaveProbes(makeMonitor(4, MonitorType.IncomingRequest)),
    ).toBe(false);

    // A monitor read without its type cannot be told to have probes.
    const untyped: Monitor = new Monitor();
    untyped._id = monitorId(5);
    expect(canMonitorHaveProbes(untyped)).toBe(false);
  });
});
