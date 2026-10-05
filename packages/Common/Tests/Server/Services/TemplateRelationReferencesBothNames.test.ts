import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import ScheduledMaintenanceTemplateService from "../../../Server/Services/ScheduledMaintenanceTemplateService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import {
  getRelationAndIdColumnReferences,
  ProjectScopedReference,
} from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import RelationIdUtil from "../../../Server/Utils/Database/RelationIdUtil";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  ProjectDirectoryStub,
  stubProjectDirectory,
} from "../TestingUtils/ProjectDirectory";

/*
 * A template's single relations - the monitor status its events or
 * incidents change their monitors to, an incident template's initial state
 * and severity - can be written by two names: the ID column
 * (`changeMonitorStatusToId`) and the relation (`changeMonitorStatusTo`).
 * The template's cards write the relation and the API takes either, so a
 * create or an update may carry both: each name that holds an id is
 * checked against the template's project, and two names that hold
 * different values are refused before anything is read.
 *
 * The services' own hooks run; which records the project has is a stand-in
 * (stubProjectDirectory).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-b07b-4aaa-8bbb-000000000001",
);

const OWN_STATUS_ID: string = "0193c0de-b07b-4aaa-8bbb-0000000000b1";
const OTHER_OWN_STATUS_ID: string = "0193c0de-b07b-4aaa-8bbb-0000000000b2";
const OWN_STATE_ID: string = "0193c0de-b07b-4aaa-8bbb-0000000000c1";
const OTHER_OWN_STATE_ID: string = "0193c0de-b07b-4aaa-8bbb-0000000000c2";
const OWN_SEVERITY_ID: string = "0193c0de-b07b-4aaa-8bbb-0000000000d1";
const OTHER_OWN_SEVERITY_ID: string = "0193c0de-b07b-4aaa-8bbb-0000000000d2";
// An id no record has, in any project.
const MISSING_ID: string = "0193c0de-b07b-4aaa-8bbb-0000000000e9";

const FOREIGN_STATUS_ID: string = "0193c0de-b07b-4aaa-8bbb-0000000000f1";
const FOREIGN_STATE_ID: string = "0193c0de-b07b-4aaa-8bbb-0000000000f2";
const FOREIGN_SEVERITY_ID: string = "0193c0de-b07b-4aaa-8bbb-0000000000f3";

let directory: ProjectDirectoryStub;

beforeEach(() => {
  directory = stubProjectDirectory({
    projectId: PROJECT_ID,
    records: {
      MonitorStatus: [OWN_STATUS_ID, OTHER_OWN_STATUS_ID],
      IncidentState: [OWN_STATE_ID, OTHER_OWN_STATE_ID],
      IncidentSeverity: [OWN_SEVERITY_ID, OTHER_OWN_SEVERITY_ID],
    },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function callHook(
  service: unknown,
  hook: "onBeforeCreate" | "onBeforeUpdate",
  payload: unknown,
): Promise<unknown> {
  return (service as Record<string, (input: unknown) => Promise<unknown>>)[
    hook
  ]!(payload);
}

// The ids looked up in one model's table, in the order they were asked.
function idsLookedUpIn(table: string): Array<string> {
  return directory.recordLookups
    .filter((lookup: { model: string }) => {
      return lookup.model === table;
    })
    .flatMap((lookup: { ids: Array<string> }) => {
      return lookup.ids;
    })
    .map((id: string): string => {
      return id.toLowerCase();
    });
}

describe("getRelationAndIdColumnReferences", () => {
  const service: DatabaseService<DatabaseBaseModel> =
    MonitorStatusService as unknown as DatabaseService<DatabaseBaseModel>;

  function ids(idColumnValue: unknown, relationValue: unknown): Array<string> {
    return getRelationAndIdColumnReferences({
      modelName: "Monitor Status",
      service: service,
      idColumnValue: idColumnValue,
      relationValue: relationValue,
    }).map((reference: ProjectScopedReference): string => {
      return String(reference.id);
    });
  }

  test("reads both names, the ID column first", () => {
    expect(ids(OWN_STATUS_ID, { _id: FOREIGN_STATUS_ID })).toEqual([
      OWN_STATUS_ID,
      FOREIGN_STATUS_ID,
    ]);
  });

  test("reads a name alone", () => {
    expect(ids(OWN_STATUS_ID, undefined)).toEqual([OWN_STATUS_ID]);
    expect(ids(undefined, { _id: OWN_STATUS_ID })).toEqual([OWN_STATUS_ID]);
  });

  test("reads every shape the API and the forms send", () => {
    const status: MonitorStatus = new MonitorStatus();
    status._id = OWN_STATUS_ID;

    // An ObjectID, a bare uuid in the relation slot, a model, `{ _id }`.
    expect(ids(new ObjectID(OWN_STATUS_ID), FOREIGN_STATUS_ID)).toEqual([
      OWN_STATUS_ID,
      FOREIGN_STATUS_ID,
    ]);
    expect(ids(undefined, status)).toEqual([OWN_STATUS_ID]);
  });

  test("names nothing for a name left out, cleared or blank", () => {
    expect(ids(undefined, undefined)).toEqual([]);
    expect(ids(null, null)).toEqual([]);
    expect(ids("", { _id: "" })).toEqual([]);
    expect(ids("   ", undefined)).toEqual([]);
  });

  test("each reference names the model and the service it is checked against", () => {
    const references: Array<ProjectScopedReference> =
      getRelationAndIdColumnReferences({
        modelName: "Monitor Status",
        service: service,
        idColumnValue: OWN_STATUS_ID,
        relationValue: { _id: OTHER_OWN_STATUS_ID },
      });

    expect(references).toHaveLength(2);

    for (const reference of references) {
      expect(reference.modelName).toBe("Monitor Status");
      expect(reference.service).toBe(service);
    }
  });
});

interface RelationCase {
  name: string;
  idColumn: string;
  relation: string;
  modelName: string;
  table: string;
  ownId: string;
  // Another record of the project, of the same kind.
  otherOwnId: string;
  foreignId: string;
}

// A refusal for a write whose two names of the relation disagree.
function conflictMessage(relation: RelationCase): string {
  return RelationIdUtil.getConflictMessage(relation.modelName, [
    relation.idColumn,
    relation.relation,
  ]);
}

const INCIDENT_TEMPLATE_RELATIONS: Array<RelationCase> = [
  {
    name: "Change Monitor Status to",
    idColumn: "changeMonitorStatusToId",
    relation: "changeMonitorStatusTo",
    modelName: "Monitor Status",
    table: "MonitorStatus",
    ownId: OWN_STATUS_ID,
    otherOwnId: OTHER_OWN_STATUS_ID,
    foreignId: FOREIGN_STATUS_ID,
  },
  {
    name: "Initial Incident State",
    idColumn: "initialIncidentStateId",
    relation: "initialIncidentState",
    modelName: "Incident State",
    table: "IncidentState",
    ownId: OWN_STATE_ID,
    otherOwnId: OTHER_OWN_STATE_ID,
    foreignId: FOREIGN_STATE_ID,
  },
  {
    name: "Incident Severity",
    idColumn: "incidentSeverityId",
    relation: "incidentSeverity",
    modelName: "Incident Severity",
    table: "IncidentSeverity",
    ownId: OWN_SEVERITY_ID,
    otherOwnId: OTHER_OWN_SEVERITY_ID,
    foreignId: FOREIGN_SEVERITY_ID,
  },
];

const SCHEDULED_MAINTENANCE_TEMPLATE_RELATIONS: Array<RelationCase> = [
  INCIDENT_TEMPLATE_RELATIONS[0]!,
];

interface TemplateServiceCase {
  kind: string;
  service: unknown;
  // A template the service's own create checks accept, but for references.
  newTemplate: () => Record<string, unknown>;
  relations: Array<RelationCase>;
}

const SERVICES: Array<TemplateServiceCase> = [
  {
    kind: "incident template",
    service: IncidentTemplateService,
    newTemplate: (): Record<string, unknown> => {
      return { templateName: "Payments down", title: "Payments are down" };
    },
    relations: INCIDENT_TEMPLATE_RELATIONS,
  },
  {
    kind: "scheduled maintenance template",
    service: ScheduledMaintenanceTemplateService,
    newTemplate: (): Record<string, unknown> => {
      return {
        templateName: "Database upgrade",
        title: "Database upgrade",
        description: "The database is upgraded.",
      };
    },
    relations: SCHEDULED_MAINTENANCE_TEMPLATE_RELATIONS,
  },
];

function create(
  service: TemplateServiceCase,
  fields: Record<string, unknown>,
): Promise<unknown> {
  const data: Record<string, unknown> = {
    ...service.newTemplate(),
    ...fields,
  };

  return callHook(service.service, "onBeforeCreate", {
    data:
      service.kind === "incident template"
        ? (data as unknown as IncidentTemplate)
        : (data as unknown as ScheduledMaintenanceTemplate),
    props: { tenantId: PROJECT_ID },
  });
}

function update(
  service: TemplateServiceCase,
  fields: Record<string, unknown>,
): Promise<unknown> {
  /*
   * The scheduled maintenance template's update reads the templates it
   * matches for their recurring settings: none here, as root.
   */
  jest
    .spyOn(service.service as { findBy: () => Promise<unknown> }, "findBy")
    .mockResolvedValue([] as never);

  return callHook(service.service, "onBeforeUpdate", {
    data: fields,
    query: {},
    props: { tenantId: PROJECT_ID },
  });
}

type Write = (
  service: TemplateServiceCase,
  fields: Record<string, unknown>,
) => Promise<unknown>;

const WRITES: Array<[string, Write]> = [
  ["create", create],
  ["update", update],
];

describe.each(SERVICES)("$kind", (service: TemplateServiceCase) => {
  describe.each(WRITES)("%s", (_write: string, write: Write) => {
    describe.each(service.relations)("$name", (relation: RelationCase) => {
      test("another project's record behind one of the project's own, by the relation, is refused before anything is read", async () => {
        await expect(
          write(service, {
            [relation.idColumn]: relation.ownId,
            [relation.relation]: { _id: relation.foreignId },
          }),
        ).rejects.toThrow(conflictMessage(relation));

        expect(idsLookedUpIn(relation.table)).toEqual([]);
      });

      test("another project's record by the ID column, beside one of the project's own by the relation, is refused", async () => {
        await expect(
          write(service, {
            [relation.idColumn]: relation.foreignId,
            [relation.relation]: { _id: relation.ownId },
          }),
        ).rejects.toThrow(conflictMessage(relation));

        expect(idsLookedUpIn(relation.table)).toEqual([]);
      });

      test("two of the project's own records under the two names are refused as well: they disagree", async () => {
        await expect(
          write(service, {
            [relation.idColumn]: relation.ownId,
            [relation.relation]: { _id: relation.otherOwnId },
          }),
        ).rejects.toThrow(conflictMessage(relation));
      });

      test("a record under one name beside a clear under the other is refused", async () => {
        await expect(
          write(service, {
            [relation.idColumn]: null,
            [relation.relation]: { _id: relation.ownId },
          }),
        ).rejects.toThrow(conflictMessage(relation));
      });

      test("another project's record is refused with the same words as a record that does not exist", async () => {
        const foreign: unknown = await write(service, {
          [relation.relation]: { _id: relation.foreignId },
        }).catch((error: Error) => {
          return error.message;
        });
        const missing: unknown = await write(service, {
          [relation.relation]: { _id: MISSING_ID },
        }).catch((error: Error) => {
          return error.message;
        });

        expect(foreign).toBe(
          `This ${service.kind} references records that are not in this project: ${relation.modelName} "${relation.foreignId}". Please pick values from this project and try again.`,
        );
        expect(missing).toBe(
          `This ${service.kind} references records that are not in this project: ${relation.modelName} "${MISSING_ID}". Please pick values from this project and try again.`,
        );
      });

      test("another project's record by the relation alone is refused", async () => {
        await expect(
          write(service, { [relation.relation]: { _id: relation.foreignId } }),
        ).rejects.toThrow(`${relation.modelName} "${relation.foreignId}"`);
      });

      test("another project's record by the ID column alone is refused", async () => {
        await expect(
          write(service, { [relation.idColumn]: relation.foreignId }),
        ).rejects.toThrow(`${relation.modelName} "${relation.foreignId}"`);
      });

      test("the project's own record by both names is accepted, and looked up once", async () => {
        await write(service, {
          [relation.idColumn]: relation.ownId,
          [relation.relation]: { _id: relation.ownId },
        });

        expect(idsLookedUpIn(relation.table)).toEqual([
          relation.ownId.toLowerCase(),
        ]);
      });

      test("the project's own record by the relation alone is accepted", async () => {
        await write(service, { [relation.relation]: { _id: relation.ownId } });

        expect(idsLookedUpIn(relation.table)).toEqual([
          relation.ownId.toLowerCase(),
        ]);
      });

      test("clearing it by either name looks nothing up", async () => {
        await write(service, {
          [relation.idColumn]: null,
          [relation.relation]: null,
        });

        expect(idsLookedUpIn(relation.table)).toEqual([]);
      });
    });
  });
});

describe("incident template: every name of every relation in one write", () => {
  test("is checked whole: one foreign record among them refuses the write", async () => {
    await expect(
      callHook(IncidentTemplateService, "onBeforeUpdate", {
        data: {
          changeMonitorStatusToId: OWN_STATUS_ID,
          changeMonitorStatusTo: { _id: OWN_STATUS_ID },
          initialIncidentState: { _id: OWN_STATE_ID },
          incidentSeverity: { _id: FOREIGN_SEVERITY_ID },
        },
        query: {},
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(`Incident Severity "${FOREIGN_SEVERITY_ID}"`);
  });

  test("is refused whole when any relation's two names disagree", async () => {
    await expect(
      callHook(IncidentTemplateService, "onBeforeUpdate", {
        data: {
          changeMonitorStatusToId: OWN_STATUS_ID,
          changeMonitorStatusTo: { _id: OWN_STATUS_ID },
          incidentSeverityId: OWN_SEVERITY_ID,
          incidentSeverity: { _id: FOREIGN_SEVERITY_ID },
        },
        query: {},
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(
      "Conflicting Incident Severity references were provided. incidentSeverityId and incidentSeverity are names for the same field",
    );
  });

  test("passes when every one of them is the project's own", async () => {
    await callHook(IncidentTemplateService, "onBeforeUpdate", {
      data: {
        changeMonitorStatusToId: OWN_STATUS_ID,
        changeMonitorStatusTo: { _id: OWN_STATUS_ID },
        initialIncidentState: { _id: OWN_STATE_ID },
        incidentSeverity: { _id: OWN_SEVERITY_ID },
      },
      query: {},
      props: { tenantId: PROJECT_ID },
    });

    expect(idsLookedUpIn("MonitorStatus")).toEqual([OWN_STATUS_ID]);
    expect(idsLookedUpIn("IncidentState")).toEqual([OWN_STATE_ID]);
    expect(idsLookedUpIn("IncidentSeverity")).toEqual([OWN_SEVERITY_ID]);
  });

  test("each relation is looked up in its own model's table", async () => {
    await callHook(IncidentTemplateService, "onBeforeCreate", {
      data: {
        templateName: "Payments down",
        title: "Payments are down",
        changeMonitorStatusTo: { _id: OWN_STATUS_ID },
        initialIncidentState: { _id: OWN_STATE_ID },
        incidentSeverity: { _id: OWN_SEVERITY_ID },
      } as unknown as IncidentTemplate,
      props: { tenantId: PROJECT_ID },
    });

    expect(idsLookedUpIn("MonitorStatus")).toEqual([OWN_STATUS_ID]);
    expect(idsLookedUpIn("IncidentState")).toEqual([OWN_STATE_ID]);
    expect(idsLookedUpIn("IncidentSeverity")).toEqual([OWN_SEVERITY_ID]);
  });
});
