import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../../Models/DatabaseModels/Index";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentMember from "../../../../Models/DatabaseModels/IncidentMember";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import ScheduledMaintenanceStateTimeline from "../../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import ArchivedValueCheck, {
  ArchivableValueColumn,
  ArchivableValuePick,
  ArchivedPick,
  ArchivedValuePickedException,
  ArchivedValueRow,
  FindArchivedValues,
} from "../../../../Server/Utils/Database/ArchivedValueCheck";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import UserType from "../../../../Types/UserType";
import {
  ARCHIVABLE_VALUES,
  ArchivableValueType,
  isArchivableValueTable,
} from "../../../../Utils/ArchivableValues";
import { describe, expect, test } from "@jest/globals";

/*
 * ArchivedValueCheck: how the server tells which of a write's references
 * name an archived state, severity, monitor status, label or incident role,
 * whose writes are held to it, and what a refused write is told. The reads
 * are handed in, so no database: DatabaseServiceArchivedValues drives the
 * real write path.
 */

const PROJECT_ID: string = "0193c0de-aaaa-4aaa-8bbb-000000000001";
const OTHER_PROJECT_ID: string = "0193c0de-aaaa-4aaa-8bbb-000000000002";

const id: (n: number) => string = (n: number): string => {
  return `0193c0de-bbbb-4bbb-8bbb-${String(n).padStart(12, "0")}`;
};

const SEVERITY_LIVE: string = id(1);
const SEVERITY_ARCHIVED: string = id(2);
const LABEL_LIVE: string = id(3);
const LABEL_ARCHIVED: string = id(4);
const STATUS_ARCHIVED: string = id(5);
const OTHER_PROJECT_SEVERITY: string = id(6);

type ModelType = { new (): BaseModel };

const columnNamed: (
  modelType: ModelType,
  column: string,
) => ArchivableValueColumn = (
  modelType: ModelType,
  column: string,
): ArchivableValueColumn => {
  const found: ArchivableValueColumn | undefined =
    ArchivedValueCheck.getColumns(new modelType()).find(
      (candidate: ArchivableValueColumn) => {
        return candidate.column === column;
      },
    );

  if (!found) {
    throw new Error(`${modelType.name}.${column} is not an archivable column`);
  }

  return found;
};

// The archived values the fake reads answer with, by table.
const ARCHIVED: Record<string, Array<ArchivedValueRow>> = {
  IncidentSeverity: [
    {
      id: SEVERITY_ARCHIVED,
      name: "[DONOTUSE] Very critical",
      projectId: PROJECT_ID,
    },
    {
      id: OTHER_PROJECT_SEVERITY,
      name: "Elsewhere",
      projectId: OTHER_PROJECT_ID,
    },
  ],
  Label: [{ id: LABEL_ARCHIVED, name: "legacy-db", projectId: PROJECT_ID }],
  MonitorStatus: [
    { id: STATUS_ARCHIVED, name: "Degraded", projectId: PROJECT_ID },
  ],
};

const reads: Array<{ table: string; ids: Array<string> }> = [];

const findArchived: FindArchivedValues = async (data: {
  modelType: { new (): BaseModel };
  ids: Array<string>;
}): Promise<Array<ArchivedValueRow>> => {
  const table: string = new data.modelType().tableName || "";
  reads.push({ table, ids: [...data.ids] });

  return (ARCHIVED[table] || []).filter((row: ArchivedValueRow) => {
    return data.ids.includes(row.id.toLowerCase());
  });
};

describe("whose writes are checked", () => {
  test("a person's, an API key's and a master admin's", () => {
    expect(
      ArchivedValueCheck.isCheckedWrite({
        userId: new ObjectID(id(90)),
        userType: UserType.User,
        tenantId: new ObjectID(PROJECT_ID),
      }),
    ).toBe(true);
    expect(
      ArchivedValueCheck.isCheckedWrite({
        userType: UserType.API,
        tenantId: new ObjectID(PROJECT_ID),
      }),
    ).toBe(true);
    expect(
      ArchivedValueCheck.isCheckedWrite({
        isMasterAdmin: true,
        userType: UserType.MasterAdmin,
      }),
    ).toBe(true);
  });

  test("not OneUptime's own (root), with or without a project on it", () => {
    expect(ArchivedValueCheck.isCheckedWrite({ isRoot: true })).toBe(false);
    expect(
      ArchivedValueCheck.isCheckedWrite({
        isRoot: true,
        tenantId: new ObjectID(PROJECT_ID),
        userId: new ObjectID(id(90)),
      }),
    ).toBe(false);
  });

  test("not a workflow's: it runs as it was built", () => {
    expect(
      ArchivedValueCheck.isCheckedWrite({
        userType: UserType.Workflow,
        tenantId: new ObjectID(PROJECT_ID),
      }),
    ).toBe(false);
  });
});

describe("the references a model has to archivable values", () => {
  test("an incident's severity, state, labels and the status it sets", () => {
    const columns: Array<ArchivableValueColumn> = ArchivedValueCheck.getColumns(
      new Incident(),
    );

    const byColumn: Record<string, ArchivableValueColumn> = {};
    for (const column of columns) {
      byColumn[column.column] = column;
    }

    expect(byColumn["incidentSeverity"]).toMatchObject({
      idColumn: "incidentSeverityId",
      isList: false,
    });
    expect(byColumn["incidentSeverity"]!.definition.type).toBe(
      ArchivableValueType.IncidentSeverity,
    );
    expect(byColumn["currentIncidentState"]).toMatchObject({
      idColumn: "currentIncidentStateId",
      isList: false,
    });
    expect(byColumn["changeMonitorStatusTo"]).toMatchObject({
      idColumn: "changeMonitorStatusToId",
      isList: false,
    });
    expect(byColumn["labels"]).toMatchObject({ isList: true });
    expect(byColumn["labels"]!.idColumn).toBeUndefined();
  });

  test("every state timeline's state: changing a record's state picks one", () => {
    expect(
      columnNamed(IncidentStateTimeline, "incidentState").definition.type,
    ).toBe(ArchivableValueType.IncidentState);
    expect(columnNamed(AlertStateTimeline, "alertState").definition.type).toBe(
      ArchivableValueType.AlertState,
    );
    expect(
      columnNamed(
        ScheduledMaintenanceStateTimeline,
        "scheduledMaintenanceState",
      ).definition.type,
    ).toBe(ArchivableValueType.ScheduledMaintenanceState);
    expect(
      columnNamed(MonitorStatusTimeline, "monitorStatus").definition.type,
    ).toBe(ArchivableValueType.MonitorStatus);
  });

  test("an incident member's role", () => {
    expect(columnNamed(IncidentMember, "incidentRole").definition.type).toBe(
      ArchivableValueType.IncidentRole,
    );
  });

  test("lists of values on settings: a status page's downtime statuses", () => {
    expect(
      columnNamed(StatusPage, "downtimeMonitorStatuses").definition.type,
    ).toBe(ArchivableValueType.MonitorStatus);
    expect(
      columnNamed(Monitor, "suppressAlertsWhenParentMonitorStatuses").isList,
    ).toBe(true);
  });

  test("never who archived or created a value, nor its project", () => {
    for (const modelType of [IncidentSeverity, Label]) {
      expect(ArchivedValueCheck.getColumns(new modelType())).toEqual([]);
    }
  });

  test("covers every model's references to the eight values, read from the metadata", () => {
    let found: number = 0;

    for (const modelType of Entities as Array<ModelType>) {
      const model: BaseModel = new modelType();

      for (const column of ArchivedValueCheck.getColumns(model)) {
        expect(isArchivableValueTable(column.definition.tableName)).toBe(true);
        expect(new column.modelType().tableName).toBe(
          column.definition.tableName,
        );
        found++;
      }
    }

    // Incidents, alerts, monitors, maintenance, timelines, rules, templates...
    expect(found).toBeGreaterThan(150);
  });

  test("are read once per model", () => {
    const first: Array<ArchivableValueColumn> = ArchivedValueCheck.getColumns(
      new Incident(),
    );

    expect(ArchivedValueCheck.getColumns(new Incident())).toBe(first);
  });
});

describe("the values a payload picks", () => {
  test("under the relation, the id column, or both - once", () => {
    const picks: Array<ArchivableValuePick> = ArchivedValueCheck.getPicks(
      new Incident(),
      {
        incidentSeverity: { _id: SEVERITY_ARCHIVED },
        incidentSeverityId: new ObjectID(SEVERITY_ARCHIVED.toUpperCase()),
        currentIncidentStateId: id(7),
      },
    );

    expect(
      picks.map((pick: ArchivableValuePick) => {
        return [pick.column.column, pick.id];
      }),
    ).toEqual([
      ["currentIncidentState", id(7)],
      ["incidentSeverity", SEVERITY_ARCHIVED],
    ]);
  });

  test("a list as models, { _id } objects, ObjectIDs or strings", () => {
    const label: Label = new Label(new ObjectID(LABEL_LIVE));

    const picks: Array<ArchivableValuePick> = ArchivedValueCheck.getPicks(
      new Monitor(),
      {
        labels: [label, { _id: LABEL_ARCHIVED }, new ObjectID(id(8)), id(9)],
      },
    );

    expect(
      picks.map((pick: ArchivableValuePick) => {
        return pick.id;
      }),
    ).toEqual([LABEL_LIVE, LABEL_ARCHIVED, id(8), id(9)]);
  });

  test("leaves out what is not a uuid, and an empty payload", () => {
    expect(
      ArchivedValueCheck.getPicks(new Incident(), {
        incidentSeverityId: "not-an-id",
        labels: ["", "1", null],
      }),
    ).toEqual([]);
    expect(ArchivedValueCheck.getPicks(new Incident(), undefined)).toEqual([]);
    expect(ArchivedValueCheck.getPicks(new Incident(), "text")).toEqual([]);
  });

  test("columns that hold no value picks nothing", () => {
    expect(
      ArchivedValueCheck.getPicks(new Incident(), { title: "Database down" }),
    ).toEqual([]);
  });
});

describe("the picks that name an archived value", () => {
  test("one read per value table, for all of its ids", async () => {
    reads.length = 0;

    const picks: Array<ArchivableValuePick> = ArchivedValueCheck.getPicks(
      new Incident(),
      {
        incidentSeverityId: SEVERITY_ARCHIVED,
        labels: [LABEL_LIVE, LABEL_ARCHIVED],
        changeMonitorStatusToId: STATUS_ARCHIVED,
      },
    );

    const archived: Array<ArchivedPick> =
      await ArchivedValueCheck.findArchivedPicks({
        picks,
        findArchived,
      });

    // In the model's column order; which order is not the point here.
    expect(
      archived
        .map((archivedPick: ArchivedPick) => {
          return archivedPick.row.name;
        })
        .sort(),
    ).toEqual(["Degraded", "[DONOTUSE] Very critical", "legacy-db"]);
    expect(
      reads
        .map((read: { table: string }) => {
          return read.table;
        })
        .sort(),
    ).toEqual(["IncidentSeverity", "Label", "MonitorStatus"]);
    expect(
      reads.find((read: { table: string }) => {
        return read.table === "Label";
      })!.ids,
    ).toEqual([LABEL_LIVE, LABEL_ARCHIVED]);
  });

  test("finds an archived value whatever case its id is written in", async () => {
    const archived: Array<ArchivedPick> =
      await ArchivedValueCheck.findArchivedPicks({
        picks: ArchivedValueCheck.getPicks(new Incident(), {
          incidentSeverityId: SEVERITY_ARCHIVED.toUpperCase(),
        }),
        findArchived,
      });

    expect(archived).toHaveLength(1);
    expect(archived[0]!.row.id).toBe(SEVERITY_ARCHIVED);
  });

  test("live values pick nothing archived", async () => {
    expect(
      await ArchivedValueCheck.findArchivedPicks({
        picks: ArchivedValueCheck.getPicks(new Incident(), {
          incidentSeverityId: SEVERITY_LIVE,
          labels: [LABEL_LIVE],
        }),
        findArchived,
      }),
    ).toEqual([]);
  });
});

describe("what the rows an update writes already hold", () => {
  const archivedLabel: () => Promise<Array<ArchivedPick>> = async (): Promise<
    Array<ArchivedPick>
  > => {
    return await ArchivedValueCheck.findArchivedPicks({
      picks: ArchivedValueCheck.getPicks(new Monitor(), {
        labels: [LABEL_LIVE, LABEL_ARCHIVED],
      }),
      findArchived,
    });
  };

  const archivedSeverity: () => Promise<
    Array<ArchivedPick>
  > = async (): Promise<Array<ArchivedPick>> => {
    return await ArchivedValueCheck.findArchivedPicks({
      picks: ArchivedValueCheck.getPicks(new Incident(), {
        incidentSeverityId: SEVERITY_ARCHIVED,
      }),
      findArchived,
    });
  };

  const projectOf: (row: unknown) => string = (row: unknown): string => {
    return String((row as Record<string, unknown>)["projectId"]);
  };

  test("a value every row already has is no new pick", async () => {
    expect(
      ArchivedValueCheck.getArchivedPicksNotHeld({
        archivedPicks: await archivedSeverity(),
        rows: [
          { projectId: PROJECT_ID, incidentSeverityId: SEVERITY_ARCHIVED },
          {
            projectId: PROJECT_ID,
            incidentSeverityId: new ObjectID(SEVERITY_ARCHIVED.toUpperCase()),
          },
        ],
        getRowProjectId: projectOf,
      }),
    ).toEqual([]);
  });

  test("a value only some of the rows have is a new pick for the others", async () => {
    expect(
      ArchivedValueCheck.getArchivedPicksNotHeld({
        archivedPicks: await archivedSeverity(),
        rows: [
          { projectId: PROJECT_ID, incidentSeverityId: SEVERITY_ARCHIVED },
          { projectId: PROJECT_ID, incidentSeverityId: SEVERITY_LIVE },
        ],
        getRowProjectId: projectOf,
      }),
    ).toHaveLength(1);
  });

  test("a list keeps an archived label it has, and refuses one it adds", async () => {
    expect(
      ArchivedValueCheck.getArchivedPicksNotHeld({
        archivedPicks: await archivedLabel(),
        rows: [
          {
            projectId: PROJECT_ID,
            labels: [{ _id: LABEL_ARCHIVED }, { _id: id(10) }],
          },
        ],
        getRowProjectId: projectOf,
      }),
    ).toEqual([]);

    expect(
      ArchivedValueCheck.getArchivedPicksNotHeld({
        archivedPicks: await archivedLabel(),
        rows: [{ projectId: PROJECT_ID, labels: [{ _id: id(10) }] }],
        getRowProjectId: projectOf,
      }),
    ).toHaveLength(1);
  });

  test("an archived value of another project is not this check's to name", async () => {
    const elsewhere: Array<ArchivedPick> =
      await ArchivedValueCheck.findArchivedPicks({
        picks: ArchivedValueCheck.getPicks(new Incident(), {
          incidentSeverityId: OTHER_PROJECT_SEVERITY,
        }),
        findArchived,
      });

    expect(elsewhere).toHaveLength(1);
    expect(
      ArchivedValueCheck.getArchivedPicksNotHeld({
        archivedPicks: elsewhere,
        rows: [{ projectId: PROJECT_ID, incidentSeverityId: SEVERITY_LIVE }],
        getRowProjectId: projectOf,
      }),
    ).toEqual([]);
  });

  test("an update that writes no rows refuses nothing", async () => {
    expect(
      ArchivedValueCheck.getArchivedPicksNotHeld({
        archivedPicks: await archivedSeverity(),
        rows: [],
        getRowProjectId: projectOf,
      }),
    ).toEqual([]);
  });

  test("the held select reads a list's ids and a relation's id column", () => {
    expect(
      ArchivedValueCheck.getHeldSelect([
        columnNamed(Incident, "labels"),
        columnNamed(Incident, "incidentSeverity"),
      ]),
    ).toEqual({
      _id: true,
      labels: { _id: true },
      incidentSeverityId: true,
    });
  });

  test("held ids read off a model too", () => {
    const incident: Incident = new Incident();
    incident.incidentSeverityId = new ObjectID(SEVERITY_ARCHIVED);

    expect(
      Array.from(
        ArchivedValueCheck.getHeldIds(
          incident,
          columnNamed(Incident, "incidentSeverity"),
        ),
      ),
    ).toEqual([SEVERITY_ARCHIVED]);
  });
});

describe("what a refused write is told", () => {
  test("one sentence per kind, each value once", async () => {
    const archived: Array<ArchivedPick> =
      await ArchivedValueCheck.findArchivedPicks({
        picks: ArchivedValueCheck.getPicks(new Incident(), {
          incidentSeverity: { _id: SEVERITY_ARCHIVED },
          incidentSeverityId: SEVERITY_ARCHIVED,
          labels: [LABEL_ARCHIVED],
        }),
        findArchived,
      });

    const severitySentence: string =
      '"[DONOTUSE] Very critical" is an archived incident severity and can\'t be picked. Choose another, or unarchive it in Incidents > Settings > Incident Severity.';
    const labelSentence: string =
      '"legacy-db" is an archived label and can\'t be picked. Choose another, or unarchive it in Project Settings > Labels.';

    // The sentences follow the model's column order.
    expect([
      `${severitySentence} ${labelSentence}`,
      `${labelSentence} ${severitySentence}`,
    ]).toContain(ArchivedValueCheck.getRefusalMessage(archived));
  });

  test("refuse throws a BadDataException (a 400), and nothing when there is nothing", async () => {
    expect(() => {
      ArchivedValueCheck.refuse([]);
    }).not.toThrow();

    const archived: Array<ArchivedPick> =
      await ArchivedValueCheck.findArchivedPicks({
        picks: ArchivedValueCheck.getPicks(new Incident(), {
          incidentSeverityId: SEVERITY_ARCHIVED,
        }),
        findArchived,
      });

    let thrown: unknown = null;

    try {
      ArchivedValueCheck.refuse(archived);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ArchivedValuePickedException);
    expect(thrown).toBeInstanceOf(BadDataException);
  });

  test("refuseValues says the same for values named some other way", () => {
    expect(() => {
      ArchivedValueCheck.refuseValues([
        {
          definition: ARCHIVABLE_VALUES[ArchivableValueType.IncidentRole],
          name: "Comms Lead",
        },
      ]);
    }).toThrow(
      '"Comms Lead" is an archived incident role and can\'t be picked. Choose another, or unarchive it in Incidents > Settings > Incident Roles.',
    );

    expect(() => {
      ArchivedValueCheck.refuseValues([]);
    }).not.toThrow();
  });
});
