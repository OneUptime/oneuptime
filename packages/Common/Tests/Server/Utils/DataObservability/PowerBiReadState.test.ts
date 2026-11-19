import { describe, expect, test } from "@jest/globals";
import {
  MAX_POWER_BI_READ_STATE_LENGTH,
  mergePowerBiWorkspaces,
  planPowerBiScan,
  POWER_BI_READ_STATE_VERSION,
  PowerBiReadState,
  PowerBiScanPlan,
  readPowerBiReadState,
  writePowerBiReadState,
} from "../../../../Server/Utils/DataObservability/Bi/PowerBiReadState";
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
    workspaces: [workspace("a"), workspace("b"), workspace("c")],
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
    ).toEqual({ isFull: true, modifiedSince: null });
  });

  test("what changed since a half hour before the last read began", () => {
    expect(
      planPowerBiScan({ state: state(), now: NOW, isScheduled: true }),
    ).toEqual({
      isFull: false,
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
    ).toEqual({ isFull: true, modifiedSince: null });
  });
});

describe("the workspaces after a read that scanned only what changed", () => {
  test("a changed workspace is replaced, a new one added, and the rest kept as they were", () => {
    const merged: ReturnType<typeof mergePowerBiWorkspaces> =
      mergePowerBiWorkspaces({
        kept: state().workspaces,
        isFull: false,
        requestedIds: ["b", "d"],
        scannedIds: ["b", "d"],
        scanned: [workspace("b", "Renamed"), workspace("d")],
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
        requestedIds: ["b"],
        scannedIds: ["b"],
        scanned: [],
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
        requestedIds: ["b", "e"],
        scannedIds: [],
        scanned: [],
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
  test("those listed, in Power BI's order; one no longer listed is gone; one unscanned keeps what it was", () => {
    const merged: ReturnType<typeof mergePowerBiWorkspaces> =
      mergePowerBiWorkspaces({
        kept: state().workspaces,
        isFull: true,
        requestedIds: ["c", "b", "f"],
        scannedIds: ["c", "f"],
        scanned: [workspace("c", "Fresh"), workspace("f")],
      });

    expect(names(merged.workspaces)).toEqual([
      "c: Fresh",
      "b: Report in b",
      "f: Report in f",
    ]);
    expect(merged.pendingWorkspaceIds).toEqual(["b"]);
  });
});

describe("what a read keeps, written and read back", () => {
  test("round trips: dates as their ISO text, every table and source as read", () => {
    const kept: PowerBiReadState = state({ pendingWorkspaceIds: ["x"] });
    const written: JSONObject | null = writePowerBiReadState(kept);

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
      readPowerBiReadState(writePowerBiReadState(kept))!.workspaces[0]!
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
    const written: JSONObject = writePowerBiReadState(state())!;

    expect(readPowerBiReadState({ ...written, version: 2 })).toBeNull();
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

  test("a tenant too big to keep is not kept", () => {
    const many: Array<PowerBiWorkspaceRead> = [];
    let length: number = 0;

    while (length <= MAX_POWER_BI_READ_STATE_LENGTH) {
      const each: PowerBiWorkspaceRead = workspace(`w${many.length}`);

      many.push(each);
      length += JSON.stringify(each).length;
    }

    expect(writePowerBiReadState(state({ workspaces: many }))).toBeNull();
  });
});
