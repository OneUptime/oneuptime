import Monitor from "../../../../Models/DatabaseModels/Monitor";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ClaimedMonitor, {
  ClaimedMonitorRow,
} from "../../../../Server/Utils/Probe/ClaimedMonitor";
import { JSONObject } from "../../../../Types/JSON";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * THE MONITOR A PROBE IS HANDED, AS THE CLAIM'S OWN STATEMENT READS IT
 * (issue #11120).
 *
 * The claim hands back each claimed row's monitor columns, and the probe's
 * answer is built from them instead of a second read. Each column must come
 * out as TypeORM hands it from a monitor read through MonitorProbe.monitor -
 * the id as text, the project as an ObjectID, the steps as MonitorSteps,
 * a NULL as null, a column not read not set - or the probe reads something
 * else than it did. MonitorProbeClaimedMonitorsPostgres.test.ts compares
 * the two on Postgres; here, each column's reading.
 */

const MONITOR_ID: string = "1f1f1f1f-0000-4000-8000-00000000001f";
const PROJECT_ID: string = "2e2e2e2e-0000-4000-8000-00000000002e";

// A monitor's steps as the database holds them (the column's transformer writes this).
function stepsAsStored(): unknown {
  const steps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
    defaultMonitorStatusId: ObjectID.generate(),
    monitorType: MonitorType.Website,
    monitorName: "Website",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });

  return JSON.parse(
    JSON.stringify(MonitorSteps.getDatabaseTransformer().to(steps)),
  );
}

function fullRow(): ClaimedMonitorRow {
  return {
    monitorId: MONITOR_ID,
    monitorProjectId: PROJECT_ID,
    monitorType: MonitorType.Website,
    monitoringInterval: "*/5 * * * *",
    monitorSteps: stepsAsStored(),
  };
}

describe("ClaimedMonitor.fromRow", () => {
  test("reads each column as its type: the id as text, the project as an ObjectID, the steps as MonitorSteps", () => {
    const monitor: Monitor = ClaimedMonitor.fromRow(fullRow());

    expect(monitor).toBeInstanceOf(Monitor);
    expect(monitor._id).toBe(MONITOR_ID);
    expect(monitor.id?.toString()).toBe(MONITOR_ID);
    expect(monitor.projectId).toBeInstanceOf(ObjectID);
    expect(monitor.projectId?.toString()).toBe(PROJECT_ID);
    expect(monitor.monitorType).toBe(MonitorType.Website);
    expect(monitor.monitoringInterval).toBe("*/5 * * * *");
    expect(monitor.monitorSteps).toBeInstanceOf(MonitorSteps);
    expect(
      monitor.monitorSteps?.data?.monitorStepsInstanceArray.length,
    ).toBeGreaterThan(0);
  });

  test("the steps are read exactly as the column's own transformer reads them", () => {
    const stored: unknown = stepsAsStored();
    const monitor: Monitor = ClaimedMonitor.fromRow({
      ...fullRow(),
      monitorSteps: stored,
    });
    const readByTheColumn: MonitorSteps =
      MonitorSteps.getDatabaseTransformer().from(stored) as MonitorSteps;

    expect(monitor.monitorSteps!.toJSON()).toEqual(readByTheColumn.toJSON());
    // Each step and criterion by its own id, as stored.
    expect(
      monitor.monitorSteps!.data!.monitorStepsInstanceArray.map(
        (step: { id: ObjectID }): string => {
          return step.id.toString();
        },
      ),
    ).toEqual(
      readByTheColumn.data!.monitorStepsInstanceArray.map(
        (step: { id: ObjectID }): string => {
          return step.id.toString();
        },
      ),
    );
  });

  test("holds exactly the columns the probe's answer was always made of, and nothing else", () => {
    const json: JSONObject = BaseModel.toJSON(
      ClaimedMonitor.fromRow(fullRow()),
      Monitor,
    );

    expect(Object.keys(json).sort()).toEqual(
      [
        "_id",
        "monitorSteps",
        "monitorType",
        "monitoringInterval",
        "projectId",
      ].sort(),
    );
  });

  test("serializes as a monitor read through the relation does: the same JSON as the same columns set by hand", () => {
    const row: ClaimedMonitorRow = fullRow();
    const byHand: Monitor = new Monitor(new ObjectID(MONITOR_ID));
    byHand.projectId = new ObjectID(PROJECT_ID);
    byHand.monitorType = MonitorType.Website;
    byHand.monitoringInterval = "*/5 * * * *";
    byHand.monitorSteps = MonitorSteps.getDatabaseTransformer().from(
      row.monitorSteps,
    ) as MonitorSteps;

    expect(BaseModel.toJSON(ClaimedMonitor.fromRow(row), Monitor)).toEqual(
      BaseModel.toJSON(byHand, Monitor),
    );
  });

  test("a probe reading the answer gets the monitor back: BaseModel.fromJSON of what it is sent", () => {
    const sent: JSONObject = BaseModel.toJSON(
      ClaimedMonitor.fromRow(fullRow()),
      Monitor,
    );
    const read: Monitor = BaseModel.fromJSON(
      JSON.parse(JSON.stringify(sent)) as JSONObject,
      Monitor,
    ) as Monitor;

    expect(read.id?.toString()).toBe(MONITOR_ID);
    expect(read.projectId?.toString()).toBe(PROJECT_ID);
    expect(read.monitorType).toBe(MonitorType.Website);
    expect(read.monitoringInterval).toBe("*/5 * * * *");
    expect(read.monitorSteps).toBeInstanceOf(MonitorSteps);
  });

  test("a NULL is null, as TypeORM reads it, through the column's transformer", () => {
    const monitor: Monitor = ClaimedMonitor.fromRow({
      monitorId: MONITOR_ID,
      monitorProjectId: null,
      monitorType: null,
      monitoringInterval: null,
      monitorSteps: null,
    });

    expect(monitor.projectId).toBeNull();
    expect(monitor.monitorType).toBeNull();
    expect(monitor.monitoringInterval).toBeNull();
    expect(monitor.monitorSteps).toBeNull();

    // And is sent as null, as a monitor read with NULLs always was.
    const json: JSONObject = BaseModel.toJSON(monitor, Monitor);
    expect(json["monitoringInterval"]).toBeNull();
    expect(json["monitorSteps"]).toBeNull();
    expect(json["projectId"]).toBeNull();
  });

  test("a column the statement did not hand back stays unset, and is not sent", () => {
    const monitor: Monitor = ClaimedMonitor.fromRow({ monitorId: MONITOR_ID });

    expect(monitor.projectId).toBeUndefined();
    expect(monitor.monitorType).toBeUndefined();
    expect(monitor.monitoringInterval).toBeUndefined();
    expect(monitor.monitorSteps).toBeUndefined();
    expect(Object.keys(BaseModel.toJSON(monitor, Monitor))).toEqual(["_id"]);
  });

  test("steps the database holds that do not read as steps are read as the column always reads them - new steps, never a throw that fails the probe's whole batch", () => {
    let monitor: Monitor | null = null;

    expect(() => {
      monitor = ClaimedMonitor.fromRow({
        ...fullRow(),
        monitorSteps: { not: "monitor steps" },
      });
    }).not.toThrow();

    expect(monitor!.monitorSteps).toBeInstanceOf(MonitorSteps);
    expect(monitor!.monitorSteps!.data!.monitorStepsInstanceArray.length).toBe(
      new MonitorSteps().data!.monitorStepsInstanceArray.length,
    );
  });

  test("a row with no monitor id gives a monitor without one, which the route leaves out", () => {
    expect(
      ClaimedMonitor.fromRow({ ...fullRow(), monitorId: null })._id,
    ).toBeUndefined();

    // A row the statement handed back no monitor id for at all.
    const withoutId: ClaimedMonitorRow = fullRow();
    delete withoutId.monitorId;
    expect(ClaimedMonitor.fromRow(withoutId)._id).toBeUndefined();
  });

  test("each call builds a monitor of its own: secrets filled into one never reach another", () => {
    const row: ClaimedMonitorRow = fullRow();
    const first: Monitor = ClaimedMonitor.fromRow(row);
    const second: Monitor = ClaimedMonitor.fromRow(row);

    expect(first).not.toBe(second);
    expect(first.monitorSteps).not.toBe(second.monitorSteps);
  });
});

describe("the columns the claim's statement names", () => {
  test("the read names each monitor column once, from the monitor (m)", () => {
    expect(ClaimedMonitor.COLUMNS).toEqual([
      `m."_id" AS "monitorId"`,
      `m."projectId" AS "monitorProjectId"`,
      `m."monitorType"`,
      `m."monitorSteps"`,
    ]);
  });

  test("the claimed rows hand on exactly the names the read gave them", () => {
    const namesRead: Array<string> = ClaimedMonitor.COLUMNS.map(
      (column: string): string => {
        const alias: RegExpMatchArray | null = column.match(/AS "([^"]+)"$/);
        return alias ? alias[1]! : column.replace(/^m\."([^"]+)"$/, "$1");
      },
    );

    expect(
      ClaimedMonitor.COLUMNS_OF_CLAIMED.map((column: string): string => {
        return column.replace(/^c\."([^"]+)"$/, "$1");
      }),
    ).toEqual(namesRead);
  });

  test("every name is one fromRow reads", () => {
    const row: Record<string, unknown> = fullRow() as Record<string, unknown>;

    for (const column of ClaimedMonitor.COLUMNS_OF_CLAIMED) {
      const name: string = column.replace(/^c\."([^"]+)"$/, "$1");
      expect(Object.keys(row)).toContain(name);
    }
  });
});
