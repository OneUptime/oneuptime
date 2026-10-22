import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import DatabaseService from "../../../Server/Services/DatabaseService";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  ArchivedValuePickedException,
  ArchivedValueRow,
} from "../../../Server/Utils/Database/ArchivedValueCheck";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import { getJestSpyOn } from "../../Spy";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  stubReadableParents,
  stubRecordLabels,
  stubRecordsInProject,
} from "../TestingUtils/ReadableParents";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * NOBODY PICKS AN ARCHIVED VALUE, end to end through DatabaseService.
 *
 * A create or an update a person, an API key or the admin dashboard makes
 * that sets an archived severity, state, monitor status, label or incident
 * role is refused, after their permission to write is checked and before
 * anything is written; one OneUptime (root) or a workflow makes keeps the
 * values it was set up with; an update that sends back a value the row
 * already has picks nothing new. These drive the real write path of a plain
 * service for incidents. The archived values are answered without a
 * database (DatabaseService.findArchivedValues), and so are the rows an
 * update writes; a write that gets past the check stops just before its
 * statement.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-aaaa-4aaa-8bbb-000000000001",
);
const OTHER_PROJECT_ID: string = "0193c0de-aaaa-4aaa-8bbb-000000000002";
const USER_ID: ObjectID = new ObjectID("0193c0de-aaaa-4aaa-8bbb-0000000000e1");
const INCIDENT_ID: string = "0193c0de-aaaa-4aaa-8bbb-0000000000a1";

const SEVERITY_LIVE: string = "0193c0de-aaaa-4aaa-8bbb-0000000005a1";
const SEVERITY_ARCHIVED: string = "0193c0de-aaaa-4aaa-8bbb-0000000005a2";
const SEVERITY_ARCHIVED_ELSEWHERE: string =
  "0193c0de-aaaa-4aaa-8bbb-0000000005a3";
const LABEL_LIVE: string = "0193c0de-aaaa-4aaa-8bbb-0000000001a1";
const LABEL_ARCHIVED: string = "0193c0de-aaaa-4aaa-8bbb-0000000001a2";
const STATE_LIVE: string = "0193c0de-aaaa-4aaa-8bbb-0000000002a1";

const ARCHIVED: Record<string, Array<ArchivedValueRow>> = {
  IncidentSeverity: [
    {
      id: SEVERITY_ARCHIVED,
      name: "[DONOTUSE] Very critical",
      projectId: PROJECT_ID.toString(),
    },
    {
      id: SEVERITY_ARCHIVED_ELSEWHERE,
      name: "Another project's",
      projectId: OTHER_PROJECT_ID,
    },
  ],
  Label: [
    {
      id: LABEL_ARCHIVED,
      name: "legacy-db",
      projectId: PROJECT_ID.toString(),
    },
  ],
};

const SEVERITY_REFUSAL: string =
  '"[DONOTUSE] Very critical" is an archived incident severity and can\'t be picked. Choose another, or unarchive it in Incidents > Settings > Incident Severity.';
const LABEL_REFUSAL: string =
  '"legacy-db" is an archived label and can\'t be picked. Choose another, or unarchive it in Project Settings > Labels.';

function grant(permissions: Array<Permission>): UserTenantAccessPermission {
  return {
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  };
}

function personProps(): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    ...ON_HIGHEST_PLAN,
    userGlobalAccessPermission: {
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: grant([Permission.ProjectOwner]),
    },
  };
}

function apiKeyProps(): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userType: UserType.API,
    ...ON_HIGHEST_PLAN,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: grant([Permission.ProjectOwner]),
    },
  };
}

function workflowProps(): DatabaseCommonInteractionProps {
  return {
    ...WorkflowPrincipal.getPropsWithoutPlan({
      projectId: PROJECT_ID,
      workflowId: new ObjectID("0193c0de-aaaa-4aaa-8bbb-0000000000c1"),
      workflowName: "Escalate stale incidents",
    }),
    ...ON_HIGHEST_PLAN,
  };
}

const ADMIN_DASHBOARD_PROPS: DatabaseCommonInteractionProps = {
  isMasterAdmin: true,
  userId: USER_ID,
  userType: UserType.MasterAdmin,
};

const ROOT_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
};

class PastTheCheck extends Error {}

let archivedReads: Array<{ table: string; ids: Array<string> }> = [];

beforeEach(() => {
  archivedReads = [];

  // Every record a write names is the project's, and readable.
  stubRecordsInProject();
  stubReadableParents();
  stubRecordLabels();

  getJestSpyOn(
    DatabaseService as unknown as {
      findArchivedValues: (data: {
        modelType: { new (): DatabaseBaseModel };
        ids: Array<string>;
      }) => Promise<Array<ArchivedValueRow>>;
    },
    "findArchivedValues",
  ).mockImplementation(
    async (data: {
      modelType: { new (): DatabaseBaseModel };
      ids: Array<string>;
    }): Promise<Array<ArchivedValueRow>> => {
      const table: string = new data.modelType().tableName || "";
      archivedReads.push({ table, ids: [...data.ids] });

      return (ARCHIVED[table] || []).filter((row: ArchivedValueRow) => {
        return data.ids.includes(row.id);
      });
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function outcomeOf(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
    return "written";
  } catch (error) {
    return error;
  }
}

function label(id: string): Label {
  const value: Label = new Label();
  value._id = id;
  return value;
}

// An incident a caller creates, with the values it picks.
function newIncident(values: {
  severity?: string;
  labels?: Array<string>;
  projectId?: string;
}): Incident {
  const incident: Incident = new Incident();
  incident.projectId = new ObjectID(values.projectId || PROJECT_ID.toString());
  incident.title = "Payments are down";
  incident.currentIncidentStateId = new ObjectID(STATE_LIVE);

  if (values.severity) {
    incident.incidentSeverityId = new ObjectID(values.severity);
  }

  if (values.labels) {
    incident.labels = values.labels.map(label);
  }

  return incident;
}

// A plain incidents service whose create stops just before its INSERT.
function creating(): {
  service: DatabaseService<Incident>;
  inserted: () => boolean;
} {
  const service: DatabaseService<Incident> = new DatabaseService<Incident>(
    Incident,
  );
  let inserted: boolean = false;

  // No incident has this number yet: answered without a database.
  getJestSpyOn(service, "checkForUniqueValues").mockImplementation(
    async (data: Incident): Promise<Incident> => {
      return data;
    },
  );

  getJestSpyOn(service, "assertCreateWillInsert").mockImplementation(
    (): never => {
      inserted = true;
      throw new PastTheCheck();
    },
  );

  return {
    service,
    inserted: (): boolean => {
      return inserted;
    },
  };
}

async function create(
  incident: Incident,
  props: DatabaseCommonInteractionProps,
): Promise<unknown> {
  const { service } = creating();

  return await outcomeOf(service.create({ data: incident, props: props }));
}

describe("creating a record", () => {
  test.each([
    ["a person", personProps],
    ["an API key", apiKeyProps],
    [
      "the admin dashboard",
      (): DatabaseCommonInteractionProps => {
        return ADMIN_DASHBOARD_PROPS;
      },
    ],
  ])(
    "%s picking an archived severity is refused, naming it and where to unarchive it",
    async (_who: string, propsFor: () => DatabaseCommonInteractionProps) => {
      const outcome: unknown = await create(
        newIncident({ severity: SEVERITY_ARCHIVED }),
        propsFor(),
      );

      expect(outcome).toBeInstanceOf(ArchivedValuePickedException);
      expect(outcome).toBeInstanceOf(BadDataException);
      expect((outcome as Error).message).toBe(SEVERITY_REFUSAL);
    },
  );

  test("an archived label among live ones is refused", async () => {
    const outcome: unknown = await create(
      newIncident({
        severity: SEVERITY_LIVE,
        labels: [LABEL_LIVE, LABEL_ARCHIVED],
      }),
      personProps(),
    );

    expect((outcome as Error).message).toBe(LABEL_REFUSAL);
  });

  test("both at once: one sentence for each kind", async () => {
    const outcome: unknown = await create(
      newIncident({ severity: SEVERITY_ARCHIVED, labels: [LABEL_ARCHIVED] }),
      personProps(),
    );

    expect((outcome as Error).message).toContain(SEVERITY_REFUSAL);
    expect((outcome as Error).message).toContain(LABEL_REFUSAL);
  });

  test("live values are created, read once per kind of value", async () => {
    const outcome: unknown = await create(
      newIncident({ severity: SEVERITY_LIVE, labels: [LABEL_LIVE] }),
      personProps(),
    );

    expect(outcome).toBeInstanceOf(PastTheCheck);
    expect(
      archivedReads
        .map((read: { table: string }) => {
          return read.table;
        })
        .sort(),
    ).toEqual(["IncidentSeverity", "IncidentState", "Label"]);
  });

  test.each([
    ["OneUptime (root)", ROOT_PROPS],
    ["a workflow", workflowProps()],
  ])(
    "%s keeps the values it was set up with, and reads none",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      const outcome: unknown = await create(
        newIncident({
          severity: SEVERITY_ARCHIVED,
          labels: [LABEL_ARCHIVED],
        }),
        props,
      );

      expect(outcome).toBeInstanceOf(PastTheCheck);
      expect(archivedReads).toEqual([]);
    },
  );

  test("another project's archived value is not named here", async () => {
    // The project reference check is the one that refuses it (stubbed here).
    const outcome: unknown = await create(
      newIncident({ severity: SEVERITY_ARCHIVED_ELSEWHERE }),
      personProps(),
    );

    expect(outcome).toBeInstanceOf(PastTheCheck);
  });

  test("what a service's hook adds is not the caller's pick", async () => {
    const { service } = creating();

    getJestSpyOn(service, "_onBeforeCreate").mockImplementation(
      async (createBy: { data: Incident }): Promise<never> => {
        // A rule adding the labels it was set up with.
        createBy.data.labels = [label(LABEL_ARCHIVED)];
        return { createBy, carryForward: [] } as never;
      },
    );

    const outcome: unknown = await outcomeOf(
      service.create({
        data: newIncident({ severity: SEVERITY_LIVE }),
        props: personProps(),
      }),
    );

    expect(outcome).toBeInstanceOf(PastTheCheck);
  });

  test("the refusal comes after the permission check: a caller who may not create learns nothing", async () => {
    const outcome: unknown = await create(
      newIncident({ severity: SEVERITY_ARCHIVED }),
      {
        ...personProps(),
        // May read incidents, not create them.
        userTenantAccessPermission: {
          [PROJECT_ID.toString()]: grant([Permission.ReadProjectIncident]),
        },
      },
    );

    expect(outcome).toBeInstanceOf(Error);
    expect(outcome).not.toBeInstanceOf(ArchivedValuePickedException);
    expect(outcome).not.toBeInstanceOf(PastTheCheck);
    expect(archivedReads).toEqual([]);
  });
});

/*
 * A plain incidents service whose update reads `rows` as the rows it writes
 * and stops just before its statement.
 */
function updating(rows: Array<Record<string, unknown>>): {
  service: DatabaseService<Incident>;
  holds: Array<{ select: Record<string, unknown> }>;
  listReads: Array<{ select: Record<string, unknown> }>;
} {
  const service: DatabaseService<Incident> = new DatabaseService<Incident>(
    Incident,
  );
  const holds: Array<{ select: Record<string, unknown> }> = [];
  const listReads: Array<{ select: Record<string, unknown> }> = [];

  const toModel: (row: Record<string, unknown>) => Incident = (
    row: Record<string, unknown>,
  ): Incident => {
    const model: Incident = new Incident();
    for (const [key, value] of Object.entries(row)) {
      (model as unknown as Record<string, unknown>)[key] = value;
    }
    return model;
  };

  getJestSpyOn(service, "_findBy").mockResolvedValue([] as never);
  getJestSpyOn(service, "findRowsAndHoldUpdateToThem").mockImplementation(
    async (
      _updateBy: UpdateBy<Incident>,
      select: unknown,
    ): Promise<Array<Incident>> => {
      holds.push({ select: select as Record<string, unknown> });
      return rows.map(toModel);
    },
  );
  getJestSpyOn(service, "findBy").mockImplementation(
    async (args: { select: unknown }): Promise<Array<Incident>> => {
      listReads.push({ select: args.select as Record<string, unknown> });
      return rows.map(toModel);
    },
  );
  getJestSpyOn(service, "getFileReferenceChecksOnUpdate").mockImplementation(
    (): never => {
      throw new PastTheCheck();
    },
  );

  return { service, holds, listReads };
}

async function update(
  service: DatabaseService<Incident>,
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<unknown> {
  return await outcomeOf(
    service.updateBy({
      query: { _id: INCIDENT_ID },
      data: data as never,
      limit: 1,
      skip: 0,
      props: props,
    }),
  );
}

const incidentRow: (
  values: Record<string, unknown>,
) => Record<string, unknown> = (
  values: Record<string, unknown>,
): Record<string, unknown> => {
  return {
    _id: INCIDENT_ID,
    projectId: PROJECT_ID,
    ...values,
  };
};

describe("updating a record", () => {
  test("changing to an archived severity is refused", async () => {
    const { service, holds } = updating([
      incidentRow({ incidentSeverityId: new ObjectID(SEVERITY_LIVE) }),
    ]);

    const outcome: unknown = await update(
      service,
      { incidentSeverityId: new ObjectID(SEVERITY_ARCHIVED) },
      personProps(),
    );

    expect((outcome as Error).message).toBe(SEVERITY_REFUSAL);
    // The rows it writes are read with what they hold, and the update held to them.
    expect(holds).toEqual([
      { select: { _id: true, incidentSeverityId: true, projectId: true } },
    ]);
  });

  test("sending back the archived severity the incident has is no new pick", async () => {
    const { service } = updating([
      incidentRow({ incidentSeverityId: new ObjectID(SEVERITY_ARCHIVED) }),
    ]);

    const outcome: unknown = await update(
      service,
      {
        title: "Payments are down (EU)",
        incidentSeverityId: new ObjectID(SEVERITY_ARCHIVED),
      },
      personProps(),
    );

    expect(outcome).toBeInstanceOf(PastTheCheck);
  });

  test("an archived label the incident has stays through an edit; one it lacks is refused", async () => {
    const keeping: { service: DatabaseService<Incident> } = updating([
      incidentRow({ labels: [label(LABEL_ARCHIVED)] }),
    ]);

    expect(
      await update(
        keeping.service,
        { labels: [label(LABEL_ARCHIVED), label(LABEL_LIVE)] },
        personProps(),
      ),
    ).toBeInstanceOf(PastTheCheck);

    const adding: { service: DatabaseService<Incident> } = updating([
      incidentRow({ labels: [label(LABEL_LIVE)] }),
    ]);

    expect(
      (
        (await update(
          adding.service,
          { labels: [label(LABEL_ARCHIVED), label(LABEL_LIVE)] },
          personProps(),
        )) as Error
      ).message,
    ).toBe(LABEL_REFUSAL);
  });

  test("a list and a field at once: the second is read by the rows' ids and merged", async () => {
    const { service, holds, listReads } = updating([
      incidentRow({
        incidentSeverityId: new ObjectID(SEVERITY_ARCHIVED),
        labels: [label(LABEL_ARCHIVED)],
      }),
    ]);

    const outcome: unknown = await update(
      service,
      {
        incidentSeverityId: new ObjectID(SEVERITY_ARCHIVED),
        labels: [label(LABEL_ARCHIVED)],
      },
      personProps(),
    );

    expect(outcome).toBeInstanceOf(PastTheCheck);
    expect(holds).toHaveLength(1);
    expect(listReads).toHaveLength(1);
  });

  test("an update that picks nothing archived reads no rows for it", async () => {
    const { service, holds } = updating([incidentRow({})]);

    expect(
      await update(
        service,
        {
          incidentSeverityId: new ObjectID(SEVERITY_LIVE),
          labels: [label(LABEL_LIVE)],
        },
        personProps(),
      ),
    ).toBeInstanceOf(PastTheCheck);
    expect(holds).toEqual([]);
  });

  test("an update that picks no value at all reads nothing", async () => {
    const { service } = updating([incidentRow({})]);

    expect(
      await update(service, { title: "Payments are down" }, personProps()),
    ).toBeInstanceOf(PastTheCheck);
    expect(archivedReads).toEqual([]);
  });

  test.each([
    ["OneUptime (root)", ROOT_PROPS],
    ["a workflow", workflowProps()],
  ])(
    "%s may set an archived value",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      const { service, holds } = updating([
        incidentRow({ incidentSeverityId: new ObjectID(SEVERITY_LIVE) }),
      ]);

      expect(
        await update(
          service,
          { incidentSeverityId: new ObjectID(SEVERITY_ARCHIVED) },
          props,
        ),
      ).not.toBeInstanceOf(ArchivedValuePickedException);
      expect(archivedReads).toEqual([]);
      expect(holds).toEqual([]);
    },
  );

  test("an API key is refused as a person is", async () => {
    const { service } = updating([
      incidentRow({ incidentSeverityId: new ObjectID(SEVERITY_LIVE) }),
    ]);

    expect(
      (
        (await update(
          service,
          { incidentSeverity: { _id: SEVERITY_ARCHIVED } },
          apiKeyProps(),
        )) as Error
      ).message,
    ).toBe(SEVERITY_REFUSAL);
  });
});

test("the severity model is what the archived values are read from", () => {
  // The check finds the severity's table through the incident's own metadata.
  expect(new IncidentSeverity().tableName).toBe("IncidentSeverity");
});
