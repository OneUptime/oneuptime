import { describe, expect, test } from "@jest/globals";
import {
  getAgedPowerBiWorkspaces,
  getPowerBiShownNeeds,
  getPowerBiWorkspacesToScan,
  isPowerBiWorkspaceIncomplete,
  MAX_POWER_BI_READ_STATE_LENGTH,
  mergePowerBiWorkspaces,
  planPowerBiScan,
  POWER_BI_READ_STATE_VERSION,
  POWER_BI_RESCAN_AGE_IN_MS,
  PowerBiReadState,
  PowerBiScanPlan,
  readPowerBiReadState,
  trimPowerBiWorkspace,
  writePowerBiReadState,
} from "../../../../Server/Utils/DataObservability/Bi/PowerBiReadState";
import {
  composePowerBiScan,
  PowerBiDatasetRead,
  PowerBiItem,
  PowerBiWorkspaceRead,
} from "../../../../Server/Utils/DataObservability/Bi/PowerBiScan";
import { PowerBiPendingScan } from "../../../../Server/Utils/DataObservability/Bi/PowerBiScanner";
import { JSONObject } from "../../../../Types/JSON";

/*
 * Power BI's daily read and a tenant too big to keep (#9901).
 *
 * The daily read lists the whole tenant, which drops what is gone, and now
 * asks what changed too: it scans again only what changed or is new, what
 * an earlier read could not scan, workspaces whose datasets came without
 * their tables or queries, and the seventh of the rest whose scans are
 * oldest - not every workspace, as before.
 *
 * A tenant whose state is past 8,000,000 characters kept nothing before,
 * and its scans still running were dropped with the rest. It now lets go
 * of what shows least, a step at a time, and always keeps those scans.
 */

const NOW: Date = new Date("2026-11-20T08:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;
// How many reports and dashboards a read shows (MAX_BI_DASHBOARDS).
const SHOWN: number = 2_000;

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

function dataset(
  id: string,
  fields: Partial<PowerBiDatasetRead> = {},
): PowerBiDatasetRead {
  return {
    datasetId: id,
    name: `Dataset ${id}`,
    tables: [
      {
        database: "Sales",
        schema: "dbo",
        table: "Orders",
        engine: "sqlserver",
        host: "sql01",
      },
    ],
    sources: [],
    hasTables: true,
    hasQueries: true,
    schemaError: null,
    upstreamDatasetIds: [],
    dataflowIds: [],
    dataflowEntities: [],
    ...fields,
  };
}

/*
 * A workspace with `reports` reports, each charting `charts` (its own
 * dataset by default), and its own datasets.
 */
function workspace(
  id: string,
  data: {
    reports?: number;
    charts?: Array<string>;
    datasets?: Array<PowerBiDatasetRead>;
    dataflows?: PowerBiWorkspaceRead["dataflows"];
    scannedAt?: string;
  } = {},
): PowerBiWorkspaceRead {
  return {
    id,
    name: `Workspace ${id}`,
    onCapacity: false,
    items: Array.from(
      { length: data.reports ?? 1 },
      (_: unknown, index: number): PowerBiItem => {
        return {
          externalId: `${id}-r${index}`,
          name: `Report ${index} in ${id}`,
          url: `https://app.powerbi.com/groups/${id}/reports/${id}-r${index}`,
          folder: `Workspace ${id}`,
          owner: null,
          changedAt: null,
          datasetIds: data.charts || [`ds-${id}`],
        };
      },
    ),
    datasets: data.datasets || [dataset(`ds-${id}`)],
    dataflows: data.dataflows || [],
    ...(data.scannedAt ? { scannedAt: data.scannedAt } : {}),
  };
}

function state(fields: Partial<PowerBiReadState> = {}): PowerBiReadState {
  return {
    version: POWER_BI_READ_STATE_VERSION,
    scannedFrom: ago(HOUR),
    fullScanAt: ago(DAY),
    pendingWorkspaceIds: [],
    pendingScans: [],
    workspaces: [],
    hasEveryWorkspace: true,
    dataflows: new Map(),
    dataflowExports: [],
    ...fields,
  };
}

function ids(workspaces: Array<PowerBiWorkspaceRead>): Array<string> {
  return workspaces.map((each: PowerBiWorkspaceRead): string => {
    return each.id;
  });
}

function pending(
  scanId: string,
  workspaceIds: Array<string>,
): PowerBiPendingScan {
  return { scanId, workspaceIds, startedAt: ago(HOUR) };
}

describe("the daily read's plan", () => {
  test("once a day the hourly read lists the whole tenant, and asks what changed since a half hour before the last read began", () => {
    expect(
      planPowerBiScan({ state: state(), now: NOW, isScheduled: true }),
    ).toEqual({
      isFull: true,
      isDaily: true,
      modifiedSince: new Date(NOW.getTime() - HOUR - 30 * 60 * 1000),
    });
  });

  test("a read someone asked for is never the daily one", () => {
    expect(
      planPowerBiScan({ state: state(), now: NOW, isScheduled: false }),
    ).toEqual({
      isFull: false,
      isDaily: false,
      modifiedSince: new Date(NOW.getTime() - HOUR - 30 * 60 * 1000),
    });
  });

  test("a state that does not hold every workspace lists the tenant whole at every read, and still asks what changed", () => {
    const partial: PowerBiReadState = state({
      hasEveryWorkspace: false,
      fullScanAt: ago(HOUR),
    });

    expect(
      planPowerBiScan({ state: partial, now: NOW, isScheduled: false }),
    ).toEqual({
      isFull: true,
      isDaily: false,
      modifiedSince: new Date(NOW.getTime() - HOUR - 30 * 60 * 1000),
    });
  });

  test("a last read older than Power BI lists changes for: every workspace counts as changed", () => {
    expect(
      planPowerBiScan({
        state: state({ scannedFrom: ago(30 * DAY) }),
        now: NOW,
        isScheduled: true,
      }),
    ).toEqual({ isFull: true, isDaily: true, modifiedSince: null });
  });
});

describe("what the daily read scans again", () => {
  const DAILY: PowerBiScanPlan = {
    isFull: true,
    isDaily: true,
    modifiedSince: new Date(NOW.getTime() - 90 * 60 * 1000),
  };

  function toScan(data: {
    kept?: Partial<PowerBiReadState>;
    listed: Array<string>;
    changed: Array<string> | null;
    pickUp?: Array<PowerBiPendingScan>;
    expired?: Array<string>;
    plan?: PowerBiScanPlan;
  }): Array<string> {
    return getPowerBiWorkspacesToScan({
      state: state(data.kept),
      plan: data.plan || DAILY,
      listedIds: data.listed,
      changedIds: data.changed,
      pickUp: data.pickUp || [],
      expiredWorkspaceIds: data.expired || [],
      now: NOW,
    });
  }

  test("only what changed or is new, and the oldest of the rest; a workspace Power BI no longer lists is not scanned", () => {
    expect(
      toScan({
        kept: {
          workspaces: [
            workspace("a", { scannedAt: ago(6 * DAY) }),
            workspace("b", { scannedAt: ago(HOUR) }),
            workspace("c", { scannedAt: ago(2 * HOUR) }),
            workspace("d", { scannedAt: ago(HOUR) }),
          ],
        },
        // d was deleted; e is new.
        listed: ["a", "b", "c", "e"],
        changed: ["b"],
      }),
      // a: the oldest of the two unchanged, a seventh of them rounded up.
    ).toEqual(["b", "e", "a"]);
  });

  test("those an earlier read could not scan, and those whose kept scan is too old to pick up, come first", () => {
    expect(
      toScan({
        kept: {
          workspaces: ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map(
            (id: string): PowerBiWorkspaceRead => {
              return workspace(id, { scannedAt: ago(HOUR) });
            },
          ),
          pendingWorkspaceIds: ["g", "gone"],
        },
        listed: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
        changed: ["b"],
        expired: ["h"],
      }),
      // a: the first of the six unchanged, all as old, a seventh of them rounded up.
    ).toEqual(["g", "h", "b", "a"]);
  });

  test("a workspace a picked-up scan gives is not scanned again, unless it changed since that scan started", () => {
    expect(
      toScan({
        // Neither is kept: their first scan is the one still running.
        listed: ["x", "y"],
        changed: ["y"],
        pickUp: [pending("s-1", ["x", "y"])],
      }),
    ).toEqual(["y"]);
  });

  test("with no list of changes, every workspace counts as changed, as the daily read did before", () => {
    expect(
      toScan({
        kept: { workspaces: [workspace("a"), workspace("b")] },
        listed: ["a", "b", "c"],
        changed: null,
        pickUp: [pending("s-1", ["a"])],
      }),
    ).toEqual(["a", "b", "c"]);
  });

  test("a read of what changed scans those an earlier read could not scan first, then what changed", () => {
    expect(
      toScan({
        kept: {
          workspaces: [workspace("a"), workspace("b")],
          pendingWorkspaceIds: ["b"],
        },
        listed: ["a", "z"],
        changed: null,
        expired: ["y"],
        plan: {
          isFull: false,
          isDaily: false,
          modifiedSince: DAILY.modifiedSince,
        },
      }),
    ).toEqual(["b", "y", "a", "z"]);
  });

  test("a workspace whose datasets came without their tables or queries is scanned again by the daily read only; one Power BI cannot describe is not", () => {
    const noTables: PowerBiWorkspaceRead = workspace("no-tables", {
      datasets: [dataset("ds-1", { hasTables: false, hasQueries: false })],
      scannedAt: ago(HOUR),
    });
    const noQueries: PowerBiWorkspaceRead = workspace("no-queries", {
      datasets: [dataset("ds-2", { hasQueries: false })],
      scannedAt: ago(HOUR),
    });
    const excel: PowerBiWorkspaceRead = workspace("excel", {
      datasets: [
        dataset("ds-3", {
          hasTables: false,
          hasQueries: false,
          schemaError:
            "Unsupported request. Excel full fidelity datasets are not supported",
        }),
      ],
      scannedAt: ago(HOUR),
    });
    // The rest, scanned just now: the seventh oldest of them is one.
    const fresh: Array<PowerBiWorkspaceRead> = ["f1", "f2", "f3"].map(
      (id: string): PowerBiWorkspaceRead => {
        return workspace(id, { scannedAt: ago(0) });
      },
    );

    expect(isPowerBiWorkspaceIncomplete(noTables)).toBe(true);
    expect(isPowerBiWorkspaceIncomplete(noQueries)).toBe(true);
    expect(isPowerBiWorkspaceIncomplete(excel)).toBe(false);
    expect(isPowerBiWorkspaceIncomplete(workspace("whole"))).toBe(false);
    expect(isPowerBiWorkspaceIncomplete(trimPowerBiWorkspace(noTables))).toBe(
      false,
    );

    const kept: Partial<PowerBiReadState> = {
      workspaces: [noTables, noQueries, excel, ...fresh],
    };
    const listed: Array<string> = ids([noTables, noQueries, excel, ...fresh]);

    expect(toScan({ kept, listed, changed: [] })).toEqual([
      "no-tables",
      "no-queries",
      // The oldest of the four left.
      "excel",
    ]);
    // A whole read that is not the daily one (a state that holds only some workspaces) asks them nothing.
    expect(
      toScan({
        kept,
        listed,
        changed: [],
        plan: { ...DAILY, isDaily: false },
      }),
    ).toEqual([]);
  });

  test("each unchanged workspace is scanned again within a week: a daily read takes the seventh whose scans are oldest", () => {
    const start: number = NOW.getTime();
    let kept: Array<PowerBiWorkspaceRead> = Array.from(
      { length: 14 },
      (_: unknown, index: number): PowerBiWorkspaceRead => {
        return workspace(`w${String(index).padStart(2, "0")}`, {
          scannedAt: new Date(start).toISOString(),
        });
      },
    );
    const scannedOn: Map<string, Array<number>> = new Map();

    for (let day: number = 1; day <= 7; day++) {
      const at: Date = new Date(start + day * DAY);
      const scanned: Array<string> = getPowerBiWorkspacesToScan({
        state: state({ workspaces: kept, fullScanAt: ago(-day * DAY + DAY) }),
        plan: DAILY,
        listedIds: ids(kept),
        changedIds: [],
        pickUp: [],
        expiredWorkspaceIds: [],
        now: at,
      });

      // Two a day of the fourteen, the first as old in the order they are kept.
      expect({ day, count: scanned.length }).toEqual({ day, count: 2 });

      for (const id of scanned) {
        scannedOn.set(id, [...(scannedOn.get(id) || []), day]);
      }

      kept = kept.map((each: PowerBiWorkspaceRead): PowerBiWorkspaceRead => {
        return scanned.includes(each.id)
          ? { ...each, scannedAt: at.toISOString() }
          : each;
      });
    }

    // Every one, once, and none waited a week: the scans are spread over the days.
    expect(Array.from(scannedOn.keys()).sort()).toEqual(ids(kept).sort());
    expect(
      Array.from(scannedOn.values()).every((days: Array<number>): boolean => {
        return days.length === 1;
      }),
    ).toBe(true);
  });

  test("every workspace a week old is scanned, more than a seventh when reads were missed; one kept before #9901 counts as scanned at the last whole read", () => {
    const old: Array<PowerBiWorkspaceRead> = ["a", "b", "c"].map(
      (id: string): PowerBiWorkspaceRead => {
        return workspace(id, { scannedAt: ago(8 * DAY) });
      },
    );
    const recent: Array<PowerBiWorkspaceRead> = ["d", "e", "f", "g"].map(
      (id: string): PowerBiWorkspaceRead => {
        return workspace(id, { scannedAt: ago(DAY) });
      },
    );

    expect(
      ids(
        getAgedPowerBiWorkspaces({
          workspaces: [...recent, ...old],
          state: state(),
          now: NOW,
        }),
      ),
    ).toEqual(["a", "b", "c"]);
    expect(POWER_BI_RESCAN_AGE_IN_MS).toBe(7 * DAY);

    // No scan time: as old as the last whole read, at least.
    const unknown: Array<PowerBiWorkspaceRead> = [
      workspace("x"),
      workspace("y"),
    ];

    expect(
      ids(
        getAgedPowerBiWorkspaces({
          workspaces: unknown,
          state: state({ fullScanAt: ago(9 * DAY) }),
          now: NOW,
        }),
      ),
    ).toEqual(["x", "y"]);
    expect(
      ids(
        getAgedPowerBiWorkspaces({
          workspaces: unknown,
          state: state({ fullScanAt: ago(DAY) }),
          now: NOW,
        }),
      ),
    ).toEqual(["x"]);
  });
});

describe("what the dashboards shown need kept whole", () => {
  test("the workspaces whose reports are among those shown, in turn", () => {
    const needs: ReturnType<typeof getPowerBiShownNeeds> = getPowerBiShownNeeds(
      [
        workspace("a", { reports: 3 }),
        workspace("b", { reports: 3 }),
        workspace("c", { reports: 3 }),
      ],
      5,
    );

    // b shows two of its three: it is shown, so kept whole.
    expect(Array.from(needs.whole)).toEqual(["a", "b"]);
    expect(Array.from(needs.rescan)).toEqual([]);
  });

  test("the workspace of a dataset a shown report charts, and of those it is built on, as deep as the tenant is put together", () => {
    const chain: Array<PowerBiWorkspaceRead> = Array.from(
      { length: 8 },
      (_: unknown, index: number): PowerBiWorkspaceRead => {
        // u0 is built on u1, u1 on u2, and so on: none of them shows a report.
        return workspace(`u${index}`, {
          reports: 0,
          datasets: [
            dataset(`ds-u${index}`, {
              upstreamDatasetIds: [`ds-u${index + 1}`],
            }),
          ],
        });
      },
    );
    const needs: ReturnType<typeof getPowerBiShownNeeds> = getPowerBiShownNeeds(
      [workspace("shown", { charts: ["ds-u0"], datasets: [] }), ...chain],
      SHOWN,
    );

    // The charted dataset, then five datasets it is built on, as composePowerBiScan follows them.
    expect(Array.from(needs.whole)).toEqual([
      "shown",
      "u0",
      "u1",
      "u2",
      "u3",
      "u4",
      "u5",
    ]);
  });

  test("the workspace of a dataflow a needed dataset reads, by its id or by an entity's name", () => {
    const flows: PowerBiWorkspaceRead = workspace("flows", {
      reports: 0,
      datasets: [],
      dataflows: [
        { id: "df-1", name: "Orders Flow", modifiedAt: null, sources: [] },
      ],
    });
    const named: PowerBiWorkspaceRead = workspace("named", {
      reports: 0,
      datasets: [],
      dataflows: [
        { id: "df-2", name: "Sales Flow", modifiedAt: null, sources: [] },
      ],
    });
    const needs: ReturnType<typeof getPowerBiShownNeeds> = getPowerBiShownNeeds(
      [
        workspace("shown", {
          datasets: [
            dataset("ds-shown", {
              dataflowIds: ["df-1"],
              dataflowEntities: [
                {
                  workspaceId: null,
                  workspaceName: null,
                  dataflowId: null,
                  dataflowName: "Sales Flow",
                  entity: "Orders",
                },
              ],
            }),
          ],
          charts: ["ds-shown"],
        }),
        flows,
        named,
        workspace("unrelated", { reports: 0 }),
      ],
      SHOWN,
    );

    expect(Array.from(needs.whole).sort()).toEqual(["flows", "named", "shown"]);
  });

  test("a trimmed workspace among them is to be scanned again: one whose reports come among those shown, or that holds a dataset a shown report charts", () => {
    const inTurn: PowerBiWorkspaceRead = trimPowerBiWorkspace(
      workspace("in-turn", { reports: 2 }),
    );
    const holder: PowerBiWorkspaceRead = trimPowerBiWorkspace(
      workspace("holder", { reports: 0, datasets: [dataset("DS-Shared")] }),
    );
    const needs: ReturnType<typeof getPowerBiShownNeeds> = getPowerBiShownNeeds(
      [
        workspace("a", { charts: ["ds-shared"], datasets: [] }),
        inTurn,
        holder,
        trimPowerBiWorkspace(workspace("past", { reports: 5 })),
      ],
      3,
    );

    expect(Array.from(needs.whole)).toEqual(["a"]);
    expect(Array.from(needs.rescan).sort()).toEqual(["holder", "in-turn"]);
  });
});

describe("a trimmed workspace", () => {
  test("keeps its dataflows, how many reports it had and its datasets' ids; bare, its id and scan time alone", () => {
    const whole: PowerBiWorkspaceRead = workspace("w", {
      reports: 3,
      datasets: [dataset("DS-1"), dataset("ds-1"), dataset("ds-2")],
      dataflows: [
        { id: "df-1", name: "Orders Flow", modifiedAt: null, sources: [] },
      ],
      scannedAt: ago(HOUR),
    });

    expect(trimPowerBiWorkspace(whole)).toEqual({
      id: "w",
      name: "Workspace w",
      onCapacity: false,
      items: [],
      datasets: [],
      dataflows: whole.dataflows,
      scannedAt: ago(HOUR),
      trimmed: { itemCount: 3, datasetIds: ["ds-1", "ds-2"] },
    });
    expect(trimPowerBiWorkspace(whole, { isBare: true })).toEqual({
      id: "w",
      name: null,
      onCapacity: false,
      items: [],
      datasets: [],
      dataflows: [],
      scannedAt: ago(HOUR),
      trimmed: { itemCount: 0, datasetIds: [] },
    });
    // Trimmed again, it keeps what it held.
    expect(trimPowerBiWorkspace(trimPowerBiWorkspace(whole))).toEqual(
      trimPowerBiWorkspace(whole),
    );
  });

  test("its reports keep their place among those shown, so the next workspace's do not take it for an hour and go", () => {
    const read: ReturnType<typeof composePowerBiScan> = composePowerBiScan(
      [
        workspace("a", { reports: 2 }),
        trimPowerBiWorkspace(workspace("t", { reports: 2 })),
        workspace("b", { reports: 2 }),
      ],
      4,
    );

    expect(
      read.items.map((item: PowerBiItem): string => {
        return item.externalId;
      }),
    ).toEqual(["a-r0", "a-r1"]);
  });

  test("is read back strictly: a count that is no count is no trim, and the workspace reads whole", () => {
    const written: JSONObject = writePowerBiReadState(state(), SHOWN)!;
    const read: (trimmed: unknown) => PowerBiWorkspaceRead = (
      trimmed: unknown,
    ): PowerBiWorkspaceRead => {
      return readPowerBiReadState({
        ...written,
        workspaces: [
          {
            ...JSON.parse(JSON.stringify(workspace("w"))),
            trimmed,
          },
        ],
      })!.workspaces[0]!;
    };

    expect(read({ itemCount: 5, datasetIds: ["DS-1", "ds-1", 7] })).toEqual(
      expect.objectContaining({
        items: [],
        datasets: [],
        trimmed: { itemCount: 5, datasetIds: ["ds-1"] },
      }),
    );
    expect(read({ itemCount: 99_999, datasetIds: [] }).trimmed).toEqual({
      itemCount: 2_000,
      datasetIds: [],
    });

    for (const notATrim of [
      { itemCount: -1 },
      { itemCount: 1.5 },
      "yes",
      null,
    ]) {
      const whole: PowerBiWorkspaceRead = read(notATrim);

      expect(whole.trimmed).toBeUndefined();
      expect(whole.items).toHaveLength(1);
    }
  });

  test("scanned again, it is whole again, in its place", () => {
    const merged: ReturnType<typeof mergePowerBiWorkspaces> =
      mergePowerBiWorkspaces({
        kept: [
          workspace("a"),
          trimPowerBiWorkspace(workspace("t")),
          workspace("b"),
        ],
        isFull: true,
        listedIds: ["n", "b", "t", "a"],
        scans: [
          { workspaceIds: ["t", "n"], read: [workspace("t"), workspace("n")] },
        ],
      });

    expect(ids(merged.workspaces)).toEqual(["a", "t", "b", "n"]);
    expect(merged.workspaces[1]!.trimmed).toBeUndefined();
  });
});

/*
 * The steps a state too big to keep whole lets go by (#9901), each tried
 * in turn until one fits in MAX_POWER_BI_READ_STATE_LENGTH characters.
 * The scans still running are kept at every step.
 */
describe("a state past 8,000,000 characters", () => {
  // A workspace whose one report's dataset reads `tables` tables: about 95 characters each.
  function heavy(id: string, tables: number): PowerBiWorkspaceRead {
    return workspace(id, {
      datasets: [
        dataset(`ds-${id}`, {
          tables: Array.from(
            { length: tables },
            (_: unknown, index: number) => {
              return {
                database: "Sales",
                schema: "dbo",
                table: `Orders_${String(index).padStart(6, "0")}`,
                engine: "sqlserver",
                host: "sql01",
              };
            },
          ),
        }),
      ],
      scannedAt: ago(HOUR),
    });
  }

  const SCANS: Array<PowerBiPendingScan> = [
    pending("e7d03602-4873-4760-b37e-1563ef5358e3", ["w0"]),
    pending("e7d03602-4873-4760-b37e-1563ef5358e4", ["w5", "w6"]),
  ];

  function written(
    kept: PowerBiReadState,
    shown: number = SHOWN,
  ): { json: JSONObject; read: PowerBiReadState } {
    const json: JSONObject | null = writePowerBiReadState(kept, shown);

    expect(json).not.toBeNull();
    expect(JSON.stringify(json).length).toBeLessThanOrEqual(
      MAX_POWER_BI_READ_STATE_LENGTH,
    );

    const read: PowerBiReadState = readPowerBiReadState(json)!;

    // The scans still running are kept at every step: the next read picks them up.
    expect(read.pendingScans).toEqual(kept.pendingScans);

    return { json: json!, read };
  }

  test("1: its dataflows' definitions go first: they are read again, within Power BI's limit", () => {
    const { read } = written(
      state({
        workspaces: [workspace("w0"), workspace("w1")],
        pendingScans: SCANS,
        dataflows: new Map([
          [
            "df-1",
            {
              modifiedAt: null,
              readAt: ago(HOUR),
              entities: null,
              error: "x".repeat(MAX_POWER_BI_READ_STATE_LENGTH),
              version: 1,
            },
          ],
        ]),
      }),
    );

    expect(read.dataflows.size).toBe(0);
    expect(read.workspaces).toEqual([workspace("w0"), workspace("w1")]);
    expect(read.hasEveryWorkspace).toBe(true);
  });

  test("2: then the reports and datasets of the workspaces the dashboards shown do not need: each kept trimmed, every workspace still known", () => {
    // Ten workspaces of about a megabyte each; two reports are shown.
    const kept: PowerBiReadState = state({
      workspaces: Array.from(
        { length: 10 },
        (_: unknown, index: number): PowerBiWorkspaceRead => {
          return heavy(`w${index}`, 11_000);
        },
      ),
      pendingScans: SCANS,
    });

    expect(JSON.stringify({ ...kept, dataflows: {} }).length).toBeGreaterThan(
      MAX_POWER_BI_READ_STATE_LENGTH,
    );

    const { read } = written(kept, 2);

    expect(read.hasEveryWorkspace).toBe(true);
    expect(ids(read.workspaces)).toEqual(ids(kept.workspaces));
    expect(read.workspaces.slice(0, 2)).toEqual(kept.workspaces.slice(0, 2));
    expect(read.workspaces[7]).toEqual({
      id: "w7",
      name: "Workspace w7",
      onCapacity: false,
      items: [],
      datasets: [],
      dataflows: [],
      scannedAt: ago(HOUR),
      trimmed: { itemCount: 1, datasetIds: ["ds-w7"] },
    });
    // Its reports still come after those shown, in the same place.
    expect(
      composePowerBiScan(read.workspaces, 2).items.map(
        (item: PowerBiItem): string => {
          return item.externalId;
        },
      ),
    ).toEqual(["w0-r0", "w1-r0"]);
    expect(read.pendingWorkspaceIds).toEqual([]);
  });

  test("3: then all but the ids and scan times of those workspaces", () => {
    // Trimmed already, each holding the ids of 80,000 datasets.
    const stubs: Array<PowerBiWorkspaceRead> = Array.from(
      { length: 3 },
      (_: unknown, index: number): PowerBiWorkspaceRead => {
        return {
          ...trimPowerBiWorkspace(workspace(`t${index}`, { reports: 0 })),
          scannedAt: ago(HOUR),
          trimmed: {
            itemCount: 0,
            datasetIds: Array.from(
              { length: 80_000 },
              (_x: unknown, at: number): string => {
                return `00000000-0000-4000-8000-${String(at).padStart(12, "0")}`;
              },
            ),
          },
        };
      },
    );
    const { read } = written(
      state({
        workspaces: [workspace("w0"), ...stubs],
        pendingScans: SCANS,
      }),
    );

    expect(read.hasEveryWorkspace).toBe(true);
    expect(read.workspaces[0]).toEqual(workspace("w0"));
    expect(read.workspaces.slice(1)).toEqual(
      stubs.map((stub: PowerBiWorkspaceRead): PowerBiWorkspaceRead => {
        return trimPowerBiWorkspace(stub, { isBare: true });
      }),
    );
  });

  test("4: then those workspaces altogether: the state no longer holds every workspace, but keeps the shown dashboards' and what is still to scan", () => {
    // 90,000 workspaces that show nothing: too many to keep even by their ids.
    const many: Array<PowerBiWorkspaceRead> = Array.from(
      { length: 90_000 },
      (_: unknown, index: number): PowerBiWorkspaceRead => {
        return trimPowerBiWorkspace(
          {
            ...workspace(`quiet-${String(index).padStart(6, "0")}`, {
              reports: 0,
              datasets: [],
            }),
            scannedAt: ago(HOUR),
          },
          { isBare: true },
        );
      },
    );
    const { read } = written(
      state({
        workspaces: [workspace("w0"), workspace("w1"), ...many],
        pendingScans: SCANS,
        pendingWorkspaceIds: ["quiet-000001"],
      }),
    );

    expect(read.hasEveryWorkspace).toBe(false);
    expect(read.workspaces).toEqual([workspace("w0"), workspace("w1")]);
    expect(read.pendingWorkspaceIds).toEqual(["quiet-000001"]);
    // The next read lists the tenant whole, and scans each workspace it does not keep.
    expect(
      planPowerBiScan({ state: read, now: NOW, isScheduled: false }).isFull,
    ).toBe(true);
  });

  test("5: then every workspace: the scans still running and the workspaces still to scan are kept, so the next read picks them up", () => {
    // Ten shown workspaces of about a megabyte each: those alone are too big.
    const { read } = written(
      state({
        workspaces: Array.from(
          { length: 10 },
          (_: unknown, index: number): PowerBiWorkspaceRead => {
            return heavy(`w${index}`, 11_000);
          },
        ),
        pendingScans: SCANS,
        pendingWorkspaceIds: ["w9"],
      }),
    );

    expect(read.hasEveryWorkspace).toBe(false);
    expect(read.workspaces).toEqual([]);
    expect(read.pendingWorkspaceIds).toEqual(["w9"]);
  });

  test("6: and the scans alone, when the workspaces still to scan are too many to keep too", () => {
    const { read } = written(
      state({
        workspaces: Array.from(
          { length: 10 },
          (_: unknown, index: number): PowerBiWorkspaceRead => {
            return heavy(`w${index}`, 11_000);
          },
        ),
        pendingScans: SCANS,
        pendingWorkspaceIds: Array.from(
          { length: 250_000 },
          (_: unknown, index: number): string => {
            return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
          },
        ),
      }),
    );

    expect(read.hasEveryWorkspace).toBe(false);
    expect(read.workspaces).toEqual([]);
    expect(read.pendingWorkspaceIds).toEqual([]);
  });

  test("a trimmed workspace the dashboards shown need again is scanned by the next read, whole state or not", () => {
    const { read } = written(
      state({
        workspaces: [
          workspace("a", { charts: ["ds-held"], datasets: [] }),
          trimPowerBiWorkspace(
            workspace("holder", { reports: 0, datasets: [dataset("ds-held")] }),
          ),
        ],
        pendingWorkspaceIds: ["other"],
      }),
    );

    expect(read.pendingWorkspaceIds).toEqual(["other", "holder"]);
  });
});
