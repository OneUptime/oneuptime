import { describe, expect, test } from "@jest/globals";
import {
  getPowerBiPickUps,
  MAX_POWER_BI_PENDING_SCANS,
  MAX_POWER_BI_PICK_UP_AGE_IN_MS,
  MAX_POWER_BI_READ_STATE_LENGTH,
  mergePowerBiWorkspaces,
  planPowerBiScan,
  POWER_BI_READ_STATE_VERSION,
  PowerBiReadState,
  PowerBiScanPlan,
  readPowerBiReadState,
  writePowerBiReadState,
} from "../../../../Server/Utils/DataObservability/Bi/PowerBiReadState";
import { PowerBiPendingScan } from "../../../../Server/Utils/DataObservability/Bi/PowerBiScanner";
import { PowerBiWorkspaceRead } from "../../../../Server/Utils/DataObservability/Bi/PowerBiScan";
import { JSONObject } from "../../../../Types/JSON";

/*
 * What a Power BI read keeps so the next scans only what changed (#9552):
 * the next read asks for the workspaces changed since a half hour before
 * the last began (Power BI takes up to 30 minutes to note a change, and a
 * modifiedSince from 30 minutes to 30 days back), the hourly read scans the
 * whole tenant once a day, and a workspace a read could not scan keeps what
 * it was and is scanned next time.
 */

const NOW: Date = new Date("2026-11-19T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;
// How many reports and dashboards a read shows (MAX_BI_DASHBOARDS).
const SHOWN: number = 2_000;

function workspace(
  id: string,
  report: string = `Report in ${id}`,
): PowerBiWorkspaceRead {
  return {
    id,
    name: `Workspace ${id}`,
    onCapacity: false,
    items: [
      {
        externalId: `r-${id}`,
        name: report,
        url: `https://app.powerbi.com/groups/${id}/reports/r-${id}`,
        folder: `Workspace ${id}`,
        owner: "john@contoso.com",
        changedAt: new Date("2026-11-18T08:00:00.000Z"),
        datasetIds: [`ds-${id}`],
      },
    ],
    datasets: [
      {
        datasetId: `ds-${id}`,
        name: `Dataset ${id}`,
        tables: [
          {
            database: "Sales",
            schema: "dbo",
            table: "Orders",
            engine: "sqlserver",
            host: "sql01",
            isDatabaseExact: true,
          },
        ],
        sources: [
          {
            type: "SQL Server",
            engine: "sqlserver",
            server: "sql01",
            database: "Sales",
            location: null,
          },
        ],
        hasTables: true,
        hasQueries: true,
        schemaError: null,
        upstreamDatasetIds: [],
        dataflowIds: [],
        dataflowEntities: [],
      },
    ],
    dataflows: [],
  };
}

function state(fields: Partial<PowerBiReadState> = {}): PowerBiReadState {
  return {
    version: POWER_BI_READ_STATE_VERSION,
    scannedFrom: new Date(NOW.getTime() - HOUR).toISOString(),
    fullScanAt: new Date(NOW.getTime() - 5 * HOUR).toISOString(),
    pendingWorkspaceIds: [],
    pendingScans: [],
    workspaces: [workspace("a"), workspace("b"), workspace("c")],
    hasEveryWorkspace: true,
    dataflows: new Map(),
    dataflowExports: [],
    ...fields,
  };
}

function names(workspaces: Array<PowerBiWorkspaceRead>): Array<string> {
  return workspaces.map((each: PowerBiWorkspaceRead): string => {
    return `${each.id}: ${each.items[0]?.name || ""}`;
  });
}

describe("whether a read scans the whole tenant or only what changed", () => {
  test("the whole tenant with nothing kept", () => {
    expect(
      planPowerBiScan({ state: null, now: NOW, isScheduled: false }),
    ).toEqual({ isFull: true, isDaily: false, modifiedSince: null });
  });

  test("what changed since a half hour before the last read began", () => {
    expect(
      planPowerBiScan({ state: state(), now: NOW, isScheduled: true }),
    ).toEqual({
      isFull: false,
      isDaily: false,
      modifiedSince: new Date("2026-11-19T10:30:00.000Z"),
    });
  });

  test("never sooner than a half hour back, as Power BI takes it: a read just after another", () => {
    const plan: PowerBiScanPlan = planPowerBiScan({
      state: state({
        scannedFrom: new Date(NOW.getTime() - 5 * 60 * 1000).toISOString(),
      }),
      now: NOW,
      isScheduled: false,
    });

    expect(plan.modifiedSince?.toISOString()).toBe("2026-11-19T11:25:00.000Z");
    expect(
      NOW.getTime() - plan.modifiedSince!.getTime(),
    ).toBeGreaterThanOrEqual(30 * 60 * 1000);
  });

  test("the hourly read scans the whole tenant once a day; a read someone asked for does not wait for it", () => {
    const dayOld: PowerBiReadState = state({
      fullScanAt: new Date(NOW.getTime() - 24 * HOUR).toISOString(),
    });

    expect(
      planPowerBiScan({ state: dayOld, now: NOW, isScheduled: true }).isFull,
    ).toBe(true);
    expect(
      planPowerBiScan({ state: dayOld, now: NOW, isScheduled: false }).isFull,
    ).toBe(false);
  });

  test("a last read older than Power BI lists changes for: the whole tenant", () => {
    expect(
      planPowerBiScan({
        state: state({
          scannedFrom: new Date(NOW.getTime() - 29 * 24 * HOUR).toISOString(),
        }),
        now: NOW,
        isScheduled: false,
      }),
    ).toEqual({ isFull: true, isDaily: false, modifiedSince: null });
  });
});

describe("the workspaces after a read that scanned only what changed", () => {
  test("a changed workspace is replaced, a new one added, and the rest kept as they were", () => {
    const merged: ReturnType<typeof mergePowerBiWorkspaces> =
      mergePowerBiWorkspaces({
        kept: state().workspaces,
        isFull: false,
        listedIds: ["b", "d"],
        scans: [
          {
            workspaceIds: ["b", "d"],
            read: [workspace("b", "Renamed"), workspace("d")],
          },
        ],
      });

    expect(names(merged.workspaces)).toEqual([
      "a: Report in a",
      "b: Renamed",
      "c: Report in c",
      "d: Report in d",
    ]);
    expect(merged.pendingWorkspaceIds).toEqual([]);
  });

  test("one a scan that worked did not return is gone: deleted, or no longer the tenant's", () => {
    const merged: ReturnType<typeof mergePowerBiWorkspaces> =
      mergePowerBiWorkspaces({
        kept: state().workspaces,
        isFull: false,
        listedIds: ["b"],
        scans: [{ workspaceIds: ["b"], read: [] }],
      });

    expect(names(merged.workspaces)).toEqual([
      "a: Report in a",
      "c: Report in c",
    ]);
  });

  test("one whose scan failed keeps what it was, and is scanned next time", () => {
    const merged: ReturnType<typeof mergePowerBiWorkspaces> =
      mergePowerBiWorkspaces({
        kept: state().workspaces,
        isFull: false,
        listedIds: ["b", "e"],
        scans: [{ workspaceIds: ["b", "e"] }],
      });

    expect(names(merged.workspaces)).toEqual([
      "a: Report in a",
      "b: Report in b",
      "c: Report in c",
    ]);
    expect(merged.pendingWorkspaceIds).toEqual(["b", "e"]);
  });
});

describe("the workspaces after a read that scanned the whole tenant", () => {
  /*
   * The kept workspaces keep their places and new ones come after them
   * (#9901): the 2,000 reports shown stay the same whatever order Power BI
   * lists the tenant in. Before, a whole read took Power BI's order.
   */
  test("those listed, each kept in its place and new ones after; one no longer listed is gone; one unscanned keeps what it was", () => {
    const merged: ReturnType<typeof mergePowerBiWorkspaces> =
      mergePowerBiWorkspaces({
        kept: state().workspaces,
        isFull: true,
        listedIds: ["c", "b", "f"],
        scans: [
          {
            workspaceIds: ["c", "f"],
            read: [workspace("c", "Fresh"), workspace("f")],
          },
          { workspaceIds: ["b"] },
        ],
      });

    expect(names(merged.workspaces)).toEqual([
      "b: Report in b",
      "c: Fresh",
      "f: Report in f",
    ]);
    expect(merged.pendingWorkspaceIds).toEqual(["b"]);
  });
});

describe("what a read keeps, written and read back", () => {
  test("round trips: dates as their ISO text, every table and source as read", () => {
    const kept: PowerBiReadState = state({ pendingWorkspaceIds: ["x"] });
    const written: JSONObject | null = writePowerBiReadState(kept, SHOWN);

    expect(written).not.toBeNull();
    expect(
      (
        (written!["workspaces"] as Array<JSONObject>)[0]![
          "items"
        ] as Array<JSONObject>
      )[0]!["changedAt"],
    ).toBe("2026-11-18T08:00:00.000Z");
    expect(readPowerBiReadState(written)).toEqual(kept);
  });

  test("an entity set and an exact database are kept as such", () => {
    const kept: PowerBiReadState = state({
      workspaces: [
        {
          ...workspace("a"),
          datasets: [
            {
              ...workspace("a").datasets[0]!,
              tables: [
                {
                  database: null,
                  schema: null,
                  table: "accounts",
                  engine: "dataverse",
                  host: "contoso.crm.dynamics.com",
                  isEntitySet: true,
                },
              ],
            },
          ],
        },
      ],
    });

    expect(
      readPowerBiReadState(writePowerBiReadState(kept, SHOWN))!.workspaces[0]!
        .datasets[0]!.tables[0],
    ).toEqual({
      database: null,
      schema: null,
      table: "accounts",
      engine: "dataverse",
      host: "contoso.crm.dynamics.com",
      isEntitySet: true,
    });
  });

  test("another version, or a state that does not fit, is none: the next read scans whole", () => {
    const written: JSONObject = writePowerBiReadState(state(), SHOWN)!;

    expect(readPowerBiReadState({ ...written, version: 3 })).toBeNull();
    // A state kept before #9901 is read: it held every workspace whole.
    expect(
      readPowerBiReadState({
        ...written,
        version: 1,
        hasEveryWorkspace: undefined,
      }),
    ).toEqual(state());
    expect(
      readPowerBiReadState({ ...written, scannedFrom: "never" }),
    ).toBeNull();
    expect(readPowerBiReadState({ ...written, workspaces: "all" })).toBeNull();
    expect(readPowerBiReadState(null)).toBeNull();
    expect(readPowerBiReadState({ workspaces: { w1: {} } })).toBeNull();
    // A workspace or item that does not fit is left out; the rest is kept.
    expect(
      readPowerBiReadState({
        ...written,
        workspaces: [
          { name: "no id" },
          {
            id: "z",
            items: [{ name: "no id" }],
            datasets: [{}],
            dataflows: [7],
          },
        ],
      })!.workspaces,
    ).toEqual([
      {
        id: "z",
        name: null,
        onCapacity: false,
        items: [],
        datasets: [],
        dataflows: [],
      },
    ]);
  });

  /*
   * Before #9901 such a tenant kept nothing, and was scanned whole at every
   * read; PowerBiBigTenantState.test.ts holds each step it lets go by.
   */
  test("a tenant too big to keep whole is still kept, never past the length", () => {
    const many: Array<PowerBiWorkspaceRead> = [];
    let length: number = 0;

    while (length <= MAX_POWER_BI_READ_STATE_LENGTH) {
      const each: PowerBiWorkspaceRead = workspace(`w${many.length}`);

      many.push(each);
      length += JSON.stringify(each).length;
    }

    const written: JSONObject | null = writePowerBiReadState(
      state({ workspaces: many }),
      SHOWN,
    );

    expect(written).not.toBeNull();
    expect(JSON.stringify(written).length).toBeLessThanOrEqual(
      MAX_POWER_BI_READ_STATE_LENGTH,
    );

    // Every workspace is still known: those the 2,000 shown do not need are trimmed.
    const read: PowerBiReadState = readPowerBiReadState(written)!;

    expect(read.hasEveryWorkspace).toBe(true);
    expect(read.workspaces).toHaveLength(many.length);
    expect(
      read.workspaces.filter((each: PowerBiWorkspaceRead): boolean => {
        return !each.trimmed;
      }),
    ).toHaveLength(SHOWN);
  });
});

/*
 * A scan still running when a read stopped waiting is kept by its id, and
 * the next read picks it up (#9697): its result, once read, is the
 * workspaces' newest unless a later scan of the same read worked too.
 */
describe("the scans a read stopped waiting for", () => {
  function pending(
    scanId: string,
    workspaceIds: Array<string>,
    startedAt: string = new Date(NOW.getTime() - HOUR).toISOString(),
  ): PowerBiPendingScan {
    return { scanId, workspaceIds, startedAt };
  }

  test("one still running keeps its workspaces as they were, and is kept by its id: they are not scanned anew", () => {
    const merged: ReturnType<typeof mergePowerBiWorkspaces> =
      mergePowerBiWorkspaces({
        kept: state().workspaces,
        isFull: false,
        listedIds: ["b"],
        scans: [{ workspaceIds: ["b"], pending: pending("s-1", ["b"]) }],
      });

    expect(names(merged.workspaces)).toEqual([
      "a: Report in a",
      "b: Report in b",
      "c: Report in c",
    ]);
    expect(merged.pendingWorkspaceIds).toEqual([]);
    expect(merged.pendingScans).toEqual([pending("s-1", ["b"])]);
  });

  test("a picked-up scan's result replaces what was kept, and a newer scan's of the same read replaces it", () => {
    const merged: ReturnType<typeof mergePowerBiWorkspaces> =
      mergePowerBiWorkspaces({
        kept: state().workspaces,
        isFull: false,
        listedIds: ["b"],
        scans: [
          {
            workspaceIds: ["a", "b"],
            read: [workspace("a", "Picked up"), workspace("b", "Picked up")],
          },
          { workspaceIds: ["b"], read: [workspace("b", "Newer")] },
        ],
      });

    expect(names(merged.workspaces)).toEqual([
      "a: Picked up",
      "b: Newer",
      "c: Report in c",
    ]);
    expect(merged.pendingScans).toEqual([]);
  });

  test("a newer scan that failed or is still running leaves the older one's result, and says what the next read does", () => {
    const merged: ReturnType<typeof mergePowerBiWorkspaces> =
      mergePowerBiWorkspaces({
        kept: state().workspaces,
        isFull: false,
        listedIds: ["a", "b"],
        scans: [
          {
            workspaceIds: ["a", "b"],
            read: [workspace("a", "Picked up"), workspace("b", "Picked up")],
          },
          { workspaceIds: ["a"], pending: pending("s-2", ["a"]) },
          { workspaceIds: ["b"] },
        ],
      });

    expect(names(merged.workspaces)).toEqual([
      "a: Picked up",
      "b: Picked up",
      "c: Report in c",
    ]);
    expect(merged.pendingScans).toEqual([pending("s-2", ["a"])]);
    expect(merged.pendingWorkspaceIds).toEqual(["b"]);
  });

  test("a scan keeps only the workspaces no later scan of the read took; one left with none is dropped", () => {
    const merged: ReturnType<typeof mergePowerBiWorkspaces> =
      mergePowerBiWorkspaces({
        kept: state().workspaces,
        isFull: false,
        listedIds: ["a"],
        scans: [
          { workspaceIds: ["a", "b"], pending: pending("old", ["a", "b"]) },
          { workspaceIds: ["c"], pending: pending("older", ["c"]) },
          { workspaceIds: ["a"], read: [workspace("a", "Fresh")] },
          { workspaceIds: ["c"], read: [workspace("c", "Fresh")] },
        ],
      });

    expect(merged.pendingScans).toEqual([pending("old", ["b"])]);
    expect(names(merged.workspaces)).toEqual([
      "a: Fresh",
      "b: Report in b",
      "c: Fresh",
    ]);
  });

  test("workspaces a first read could not wait for come in when their scan is picked up", () => {
    const merged: ReturnType<typeof mergePowerBiWorkspaces> =
      mergePowerBiWorkspaces({
        kept: [],
        isFull: false,
        listedIds: [],
        scans: [
          {
            workspaceIds: ["x", "y"],
            read: [workspace("x"), workspace("y")],
          },
        ],
      });

    expect(names(merged.workspaces)).toEqual([
      "x: Report in x",
      "y: Report in y",
    ]);
  });

  test("a whole scan keeps only what Power BI lists, each in its place, though a picked-up scan read more", () => {
    const merged: ReturnType<typeof mergePowerBiWorkspaces> =
      mergePowerBiWorkspaces({
        kept: state().workspaces,
        isFull: true,
        listedIds: ["c", "a"],
        scans: [
          {
            workspaceIds: ["a", "b"],
            read: [workspace("a", "Picked up"), workspace("b", "Picked up")],
          },
          { workspaceIds: ["c", "a"] },
        ],
      });

    // b is no longer the tenant's; a's whole scan failed, so the picked-up result stands.
    expect(names(merged.workspaces)).toEqual([
      "a: Picked up",
      "c: Report in c",
    ]);
    expect(merged.pendingWorkspaceIds).toEqual(["c", "a"]);
  });

  test("a whole scan keeps no scan of a workspace it no longer lists: it is gone, and the next read must not bring it back", () => {
    const merged: ReturnType<typeof mergePowerBiWorkspaces> =
      mergePowerBiWorkspaces({
        kept: state().workspaces,
        isFull: true,
        listedIds: ["a"],
        scans: [
          {
            workspaceIds: ["a", "gone"],
            pending: pending("old", ["a", "gone"]),
          },
          { workspaceIds: ["deleted"] },
        ],
      });

    expect(merged.pendingScans).toEqual([pending("old", ["a"])]);
    expect(merged.pendingWorkspaceIds).toEqual([]);
    expect(names(merged.workspaces)).toEqual(["a: Report in a"]);
  });

  test("the next read picks up those Power BI still keeps; one started 23 hours ago or more has its workspaces scanned anew", () => {
    const fresh: PowerBiPendingScan = pending(
      "fresh",
      ["a"],
      new Date(NOW.getTime() - 22 * HOUR).toISOString(),
    );
    const old: PowerBiPendingScan = pending(
      "old",
      ["b", "c"],
      new Date(NOW.getTime() - MAX_POWER_BI_PICK_UP_AGE_IN_MS).toISOString(),
    );

    expect(
      getPowerBiPickUps({
        state: state({ pendingScans: [fresh, old] }),
        now: NOW,
      }),
    ).toEqual({ pickUp: [fresh], expiredWorkspaceIds: ["b", "c"] });
    expect(getPowerBiPickUps({ state: null, now: NOW })).toEqual({
      pickUp: [],
      expiredWorkspaceIds: [],
    });
    // An hour is kept to spare: a read can wait 20 minutes before it reads a result.
    expect(MAX_POWER_BI_PICK_UP_AGE_IN_MS).toBe(23 * HOUR);
  });

  test("they are written and read back with their ids, workspaces and starts; a state kept before them reads as none", () => {
    const kept: PowerBiReadState = state({
      pendingScans: [pending("e7d03602-4873-4760-b37e-1563ef5358e3", ["a"])],
    });

    expect(readPowerBiReadState(writePowerBiReadState(kept, SHOWN))).toEqual(
      kept,
    );

    const before: JSONObject = writePowerBiReadState(state(), SHOWN)!;

    delete before["pendingScans"];

    expect(readPowerBiReadState(before)!.pendingScans).toEqual([]);
  });

  test("one that does not fit is left out: an id that is no scan's, no workspace, no start", () => {
    const written: JSONObject = writePowerBiReadState(state(), SHOWN)!;
    const startedAt: string = new Date(NOW.getTime() - HOUR).toISOString();

    expect(
      readPowerBiReadState({
        ...written,
        pendingScans: [
          { scanId: "../../admin/groups", workspaceIds: ["a"], startedAt },
          { scanId: "s-1", workspaceIds: [], startedAt },
          { scanId: "s-2", workspaceIds: ["a"], startedAt: "yesterday" },
          { scanId: "s-3", workspaceIds: ["a", "a", 7], startedAt },
          "s-4",
        ],
      })!.pendingScans,
    ).toEqual([{ scanId: "s-3", workspaceIds: ["a"], startedAt }]);

    expect(
      readPowerBiReadState({
        ...written,
        pendingScans: Array.from(
          { length: MAX_POWER_BI_PENDING_SCANS + 10 },
          (_: unknown, index: number): JSONObject => {
            return {
              scanId: `s-${index}`,
              workspaceIds: [`w-${index}`],
              startedAt,
            };
          },
        ),
      })!.pendingScans,
    ).toHaveLength(MAX_POWER_BI_PENDING_SCANS);
  });
});
