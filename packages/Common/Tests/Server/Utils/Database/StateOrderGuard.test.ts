import StateOrderGuard from "../../../../Server/Utils/Database/StateOrderGuard";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import {
  STATE_LISTS,
  StateListDefinition,
  StateListType,
} from "../../../../Utils/StateOrder";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * StateOrderGuard: what the state, severity and monitor status services do
 * around a write so a project's lists keep meaning what OneUptime reads them
 * as. The service is faked - a project's rows in memory - so these pin the
 * guard's own decisions and the reads it makes:
 *
 *   - a row created without a place goes where its list wants a new one;
 *   - a signed-in write that puts the built-in states of a path out of order
 *     is refused before anything is written, with why;
 *   - a signed-in delete may not take away the last row of a built-in kind;
 *   - root writes (seeding, migrations) are only placed, never refused;
 *   - writes that cannot change any of that cost no read at all;
 *   - the rows a write targets are read in the caller's project only.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

const id: (n: number) => string = (n: number): string => {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
};

type FakeRow = Record<string, unknown> & { _id: string; projectId: ObjectID };

interface FakeService {
  rows: Array<FakeRow>;
  findAllByQueries: Array<Record<string, unknown>>;
  findAllBySelects: Array<Record<string, unknown>>;
  findByQueries: Array<Record<string, unknown>>;
  service: never;
}

const fakeService: (
  modelType: { new (): BaseModel },
  rows: Array<FakeRow>,
) => FakeService = (
  modelType: { new (): BaseModel },
  rows: Array<FakeRow>,
): FakeService => {
  const fake: FakeService = {
    rows: rows,
    findAllByQueries: [],
    findAllBySelects: [],
    findByQueries: [],
    service: undefined as never,
  };

  const toModel: (row: FakeRow) => BaseModel = (row: FakeRow): BaseModel => {
    const model: BaseModel = new modelType();
    for (const [key, value] of Object.entries(row)) {
      (model as unknown as Record<string, unknown>)[key] = value;
    }
    return model;
  };

  const inProject: (row: FakeRow, projectId: unknown) => boolean = (
    row: FakeRow,
    projectId: unknown,
  ): boolean => {
    return (
      projectId === undefined ||
      row.projectId.toString() === (projectId as ObjectID).toString()
    );
  };

  fake.service = {
    getModel: (): BaseModel => {
      return new modelType();
    },
    findAllBy: async (args: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<Array<BaseModel>> => {
      fake.findAllByQueries.push(args.query);
      fake.findAllBySelects.push(args.select);
      return fake.rows
        .filter((row: FakeRow) => {
          return inProject(row, args.query["projectId"]);
        })
        .map(toModel);
    },
    findBy: async (args: {
      query: Record<string, unknown>;
    }): Promise<Array<BaseModel>> => {
      fake.findByQueries.push(args.query);
      return fake.rows
        .filter((row: FakeRow) => {
          return (
            inProject(row, args.query["projectId"]) &&
            (args.query["_id"] === undefined ||
              row._id === args.query["_id"]?.toString())
          );
        })
        .map(toModel);
    },
  } as never;

  return fake;
};

const incidentState: (
  n: number,
  name: string,
  order: number,
  flags: Record<string, boolean> = {},
) => FakeRow = (
  n: number,
  name: string,
  order: number,
  flags: Record<string, boolean> = {},
): FakeRow => {
  return {
    _id: id(n),
    name: name,
    order: order,
    projectId: PROJECT_ID,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, n)),
    ...flags,
  };
};

// Identified, Investigating, Acknowledged, Resolved, Postmortem.
const incidentStates: () => Array<FakeRow> = (): Array<FakeRow> => {
  return [
    incidentState(1, "Identified", 1, { isCreatedState: true }),
    incidentState(2, "Investigating", 2),
    incidentState(3, "Acknowledged", 3, { isAcknowledgedState: true }),
    incidentState(4, "Resolved", 4, { isResolvedState: true }),
    incidentState(5, "Postmortem", 5),
  ];
};

const INCIDENT: StateListDefinition = STATE_LISTS[StateListType.IncidentState];

const SIGNED_IN: { tenantId: ObjectID; userId: ObjectID } = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("55555555-5555-4555-8555-555555555555"),
};

const newIncidentState: (data: Record<string, unknown>) => IncidentState = (
  data: Record<string, unknown>,
): IncidentState => {
  const state: IncidentState = new IncidentState();
  state.name = "New";
  state.projectId = PROJECT_ID;
  for (const [key, value] of Object.entries(data)) {
    (state as unknown as Record<string, unknown>)[key] = value;
  }
  return state;
};

const update: (
  fake: FakeService,
  rowId: string,
  data: Record<string, unknown>,
  props: Record<string, unknown> = SIGNED_IN,
) => Promise<void> = (
  fake: FakeService,
  rowId: string,
  data: Record<string, unknown>,
  props: Record<string, unknown> = SIGNED_IN,
): Promise<void> => {
  return StateOrderGuard.beforeUpdate({
    service: fake.service,
    definition: INCIDENT,
    updateBy: {
      query: { _id: rowId },
      data: data,
      limit: 1,
      skip: 0,
      props: props,
    } as unknown as UpdateBy<IncidentState>,
  });
};

const remove: (
  fake: FakeService,
  definition: StateListDefinition,
  query: Record<string, unknown>,
  props: Record<string, unknown> = SIGNED_IN,
) => Promise<void> = (
  fake: FakeService,
  definition: StateListDefinition,
  query: Record<string, unknown>,
  props: Record<string, unknown> = SIGNED_IN,
): Promise<void> => {
  return StateOrderGuard.beforeDelete({
    service: fake.service,
    definition: definition,
    deleteBy: {
      query: query,
      limit: 10,
      skip: 0,
      props: props,
    } as unknown as DeleteBy<BaseModel>,
  });
};

describe("StateOrderGuard.beforeCreate", () => {
  let fake: FakeService;

  beforeEach(() => {
    fake = fakeService(IncidentState, incidentStates());
  });

  test("a state created without a place takes the resolved state's place", async () => {
    const state: IncidentState = newIncidentState({});

    await StateOrderGuard.beforeCreate({
      service: fake.service,
      definition: INCIDENT,
      createBy: {
        data: state,
        props: SIGNED_IN,
      } as unknown as CreateBy<IncidentState>,
    });

    expect(state.order).toBe(4);
  });

  test("the list is read in the new row's project, with its places and flags", async () => {
    await StateOrderGuard.beforeCreate({
      service: fake.service,
      definition: INCIDENT,
      createBy: {
        data: newIncidentState({}),
        props: SIGNED_IN,
      } as unknown as CreateBy<IncidentState>,
    });

    expect(fake.findAllByQueries).toHaveLength(1);
    expect(fake.findAllByQueries[0]!["projectId"]?.toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(fake.findAllBySelects[0]).toEqual({
      _id: true,
      name: true,
      createdAt: true,
      order: true,
      isCreatedState: true,
      isAcknowledgedState: true,
      isResolvedState: true,
    });
  });

  test("a state created with a place keeps it, and costs no read", async () => {
    const state: IncidentState = newIncidentState({ order: 99 });

    await StateOrderGuard.beforeCreate({
      service: fake.service,
      definition: INCIDENT,
      createBy: {
        data: state,
        props: SIGNED_IN,
      } as unknown as CreateBy<IncidentState>,
    });

    expect(state.order).toBe(99);
    expect(fake.findAllByQueries).toHaveLength(0);
  });

  test("with no resolved state, the new row is left to go to the end", async () => {
    fake.rows = fake.rows.filter((row: FakeRow) => {
      return !row["isResolvedState"];
    });

    const state: IncidentState = newIncidentState({});

    await StateOrderGuard.beforeCreate({
      service: fake.service,
      definition: INCIDENT,
      createBy: {
        data: state,
        props: SIGNED_IN,
      } as unknown as CreateBy<IncidentState>,
    });

    expect(state.order).toBeUndefined();
  });

  test("a signed-in create of a resolved state at the top is refused", async () => {
    await expect(
      StateOrderGuard.beforeCreate({
        service: fake.service,
        definition: INCIDENT,
        createBy: {
          data: newIncidentState({
            name: "Closed",
            order: 1,
            isResolvedState: true,
          }),
          props: SIGNED_IN,
        } as unknown as CreateBy<IncidentState>,
      }),
    ).rejects.toThrow(
      'Incidents only ever move down this list, so the resolved state ("Closed") has to stay below the created state ("Identified").',
    );
  });

  test("a built-in state created where it keeps the order is fine", async () => {
    await expect(
      StateOrderGuard.beforeCreate({
        service: fake.service,
        definition: INCIDENT,
        createBy: {
          data: newIncidentState({
            name: "Closed",
            order: 6,
            isResolvedState: true,
          }),
          props: SIGNED_IN,
        } as unknown as CreateBy<IncidentState>,
      }),
    ).resolves.toBeUndefined();
  });

  test("root (seeding, migrations) is placed but never refused", async () => {
    await expect(
      StateOrderGuard.beforeCreate({
        service: fake.service,
        definition: INCIDENT,
        createBy: {
          data: newIncidentState({
            name: "Closed",
            order: 1,
            isResolvedState: true,
          }),
          props: { isRoot: true },
        } as unknown as CreateBy<IncidentState>,
      }),
    ).resolves.toBeUndefined();
  });

  test("a row without a project is refused", async () => {
    const state: IncidentState = new IncidentState();
    state.name = "Orphan";

    await expect(
      StateOrderGuard.beforeCreate({
        service: fake.service,
        definition: INCIDENT,
        createBy: {
          data: state,
          props: SIGNED_IN,
        } as unknown as CreateBy<IncidentState>,
      }),
    ).rejects.toThrow("Incident State projectId is required");
  });

  test("a monitor status takes the offline status's place", async () => {
    const statuses: FakeService = fakeService(MonitorStatus, [
      {
        _id: id(1),
        name: "Operational",
        priority: 1,
        isOperationalState: true,
        projectId: PROJECT_ID,
      },
      { _id: id(2), name: "Degraded", priority: 2, projectId: PROJECT_ID },
      {
        _id: id(3),
        name: "Offline",
        priority: 3,
        isOfflineState: true,
        projectId: PROJECT_ID,
      },
    ]);

    const status: MonitorStatus = new MonitorStatus();
    status.name = "Maintenance";
    status.projectId = PROJECT_ID;

    await StateOrderGuard.beforeCreate({
      service: statuses.service,
      definition: STATE_LISTS[StateListType.MonitorStatus],
      createBy: {
        data: status,
        props: SIGNED_IN,
      } as unknown as CreateBy<MonitorStatus>,
    });

    expect(status.priority).toBe(3);
  });

  test("a severity is left alone - to the end of its list - with no read", async () => {
    const severities: FakeService = fakeService(AlertSeverity, [
      { _id: id(1), name: "High", order: 1, projectId: PROJECT_ID },
      { _id: id(2), name: "Low", order: 2, projectId: PROJECT_ID },
    ]);

    const severity: AlertSeverity = new AlertSeverity();
    severity.name = "Medium";
    severity.projectId = PROJECT_ID;

    await StateOrderGuard.beforeCreate({
      service: severities.service,
      definition: STATE_LISTS[StateListType.AlertSeverity],
      createBy: {
        data: severity,
        props: SIGNED_IN,
      } as unknown as CreateBy<AlertSeverity>,
    });

    expect(severity.order).toBeUndefined();
    expect(severities.findAllByQueries).toHaveLength(0);
  });

  test("a maintenance state takes the completed state's place", async () => {
    const maintenance: FakeService = fakeService(ScheduledMaintenanceState, [
      {
        _id: id(1),
        name: "Scheduled",
        order: 1,
        isScheduledState: true,
        projectId: PROJECT_ID,
      },
      {
        _id: id(2),
        name: "Ongoing",
        order: 2,
        isOngoingState: true,
        projectId: PROJECT_ID,
      },
      {
        _id: id(3),
        name: "Ended",
        order: 3,
        isEndedState: true,
        projectId: PROJECT_ID,
      },
      {
        _id: id(4),
        name: "Completed",
        order: 4,
        isResolvedState: true,
        projectId: PROJECT_ID,
      },
    ]);

    const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
    state.name = "Verifying";
    state.projectId = PROJECT_ID;

    await StateOrderGuard.beforeCreate({
      service: maintenance.service,
      definition: STATE_LISTS[StateListType.ScheduledMaintenanceState],
      createBy: {
        data: state,
        props: SIGNED_IN,
      } as unknown as CreateBy<ScheduledMaintenanceState>,
    });

    expect(state.order).toBe(4);
  });
});

describe("StateOrderGuard.beforeUpdate", () => {
  let fake: FakeService;

  beforeEach(() => {
    fake = fakeService(IncidentState, incidentStates());
  });

  test("a state the project added can be dragged anywhere - above Identified, below Resolved", async () => {
    await expect(update(fake, id(2), { order: 1 })).resolves.toBeUndefined();
    await expect(update(fake, id(2), { order: 5 })).resolves.toBeUndefined();
  });

  test("a built-in state can move as long as the built-ins keep their order", async () => {
    // Acknowledged dropped onto Investigating: it is still between the two.
    await expect(update(fake, id(3), { order: 2 })).resolves.toBeUndefined();
    // Resolved dropped onto Postmortem.
    await expect(update(fake, id(4), { order: 5 })).resolves.toBeUndefined();
  });

  test("the resolved state dropped above the acknowledged one is refused, with why", async () => {
    await expect(update(fake, id(4), { order: 2 })).rejects.toThrow(
      new BadDataException(
        'Incidents only ever move down this list, so the resolved state ("Resolved") has to stay below the acknowledged state ("Acknowledged").',
      ),
    );
  });

  test("the created state dropped below the acknowledged one is refused", async () => {
    await expect(update(fake, id(1), { order: 3 })).rejects.toThrow(
      'so the acknowledged state ("Acknowledged") has to stay below the created state ("Identified")',
    );
  });

  test("clearing the created state's number sends it to the end - refused", async () => {
    await expect(update(fake, id(1), { order: null })).rejects.toThrow(
      BadDataException,
    );
  });

  test("making a state above the acknowledged one the resolved state is refused", async () => {
    await expect(
      update(fake, id(2), { isResolvedState: true }),
    ).rejects.toThrow(
      'the resolved state ("Investigating") has to stay below the acknowledged state ("Acknowledged")',
    );
  });

  test("taking a flag away is fine: there is less order to keep", async () => {
    fake.rows.push(incidentState(6, "Closed", 6, { isResolvedState: true }));

    await expect(
      update(fake, id(6), { isResolvedState: false }),
    ).resolves.toBeUndefined();
  });

  test("a list that is already out of order can still be put right", async () => {
    fake.rows = [
      incidentState(1, "Identified", 1, { isCreatedState: true }),
      incidentState(4, "Resolved", 2, { isResolvedState: true }),
      incidentState(3, "Acknowledged", 3, { isAcknowledgedState: true }),
    ];

    await expect(update(fake, id(3), { order: 2 })).resolves.toBeUndefined();
  });

  test("an edit that neither moves a state nor changes its flags costs no read", async () => {
    await expect(
      update(fake, id(4), { name: "Closed", color: "#000000" }),
    ).resolves.toBeUndefined();

    expect(fake.findByQueries).toHaveLength(0);
    expect(fake.findAllByQueries).toHaveLength(0);
  });

  test("root writes are not checked", async () => {
    await expect(
      update(fake, id(4), { order: 1 }, { isRoot: true }),
    ).resolves.toBeUndefined();

    expect(fake.findByQueries).toHaveLength(0);
  });

  test("the moved row is read in the caller's project, never another", async () => {
    await update(fake, id(2), { order: 1 });

    expect(fake.findByQueries[0]!["projectId"]?.toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(fake.findByQueries[0]!["_id"]).toBe(id(2));
  });

  test("another project's state is not found, so nothing about it is told", async () => {
    fake.rows = fake.rows.map((row: FakeRow) => {
      return { ...row, projectId: OTHER_PROJECT_ID };
    });

    await expect(update(fake, id(4), { order: 1 })).resolves.toBeUndefined();
    expect(fake.findAllByQueries).toHaveLength(0);
  });

  test("a monitor status or a severity can go anywhere: no path to keep, no read", async () => {
    const statuses: FakeService = fakeService(MonitorStatus, [
      {
        _id: id(1),
        name: "Operational",
        priority: 1,
        isOperationalState: true,
        projectId: PROJECT_ID,
      },
      {
        _id: id(3),
        name: "Offline",
        priority: 3,
        isOfflineState: true,
        projectId: PROJECT_ID,
      },
    ]);

    await expect(
      StateOrderGuard.beforeUpdate({
        service: statuses.service,
        definition: STATE_LISTS[StateListType.MonitorStatus],
        updateBy: {
          query: { _id: id(3) },
          data: { priority: 1 },
          limit: 1,
          skip: 0,
          props: SIGNED_IN,
        } as unknown as UpdateBy<MonitorStatus>,
      }),
    ).resolves.toBeUndefined();

    expect(statuses.findByQueries).toHaveLength(0);
  });
});

describe("StateOrderGuard.beforeDelete", () => {
  let fake: FakeService;

  beforeEach(() => {
    fake = fakeService(IncidentState, incidentStates());
  });

  test("the only resolved state cannot be deleted, and the refusal says why", async () => {
    await expect(remove(fake, INCIDENT, { _id: id(4) })).rejects.toThrow(
      '"Resolved" is the resolved state of this project, and incidents need one. It can be renamed, but not deleted.',
    );
  });

  test.each([
    ["created state", 1],
    ["acknowledged state", 3],
  ])(
    "the only %s cannot be deleted either",
    async (role: string, n: number) => {
      await expect(remove(fake, INCIDENT, { _id: id(n) })).rejects.toThrow(
        `is the ${role} of this project`,
      );
    },
  );

  test("a state the project added can be deleted", async () => {
    await expect(
      remove(fake, INCIDENT, { _id: id(2) }),
    ).resolves.toBeUndefined();
  });

  test("a second resolved state can be deleted while the first remains", async () => {
    fake.rows.push(incidentState(6, "Closed", 6, { isResolvedState: true }));

    await expect(
      remove(fake, INCIDENT, { _id: id(6) }),
    ).resolves.toBeUndefined();
  });

  test("root deletes are not checked", async () => {
    await expect(
      remove(fake, INCIDENT, { _id: id(4) }, { isRoot: true }),
    ).resolves.toBeUndefined();
    expect(fake.findByQueries).toHaveLength(0);
  });

  test("the rows to delete are read in the caller's project only", async () => {
    await expect(remove(fake, INCIDENT, { _id: id(2) })).resolves.toBe(
      undefined,
    );

    expect(fake.findByQueries[0]!["projectId"]?.toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("a severity has no built-ins: any can go, with no read", async () => {
    const severities: FakeService = fakeService(AlertSeverity, [
      { _id: id(1), name: "High", order: 1, projectId: PROJECT_ID },
    ]);

    await expect(
      remove(severities, STATE_LISTS[StateListType.AlertSeverity], {
        _id: id(1),
      }),
    ).resolves.toBeUndefined();
    expect(severities.findByQueries).toHaveLength(0);
  });

  test("the only operational status cannot be deleted; a second one can", async () => {
    const statuses: FakeService = fakeService(MonitorStatus, [
      {
        _id: id(1),
        name: "Operational",
        priority: 1,
        isOperationalState: true,
        projectId: PROJECT_ID,
      },
      {
        _id: id(3),
        name: "Offline",
        priority: 3,
        isOfflineState: true,
        projectId: PROJECT_ID,
      },
    ]);
    const definition: StateListDefinition =
      STATE_LISTS[StateListType.MonitorStatus];

    await expect(remove(statuses, definition, { _id: id(1) })).rejects.toThrow(
      '"Operational" is the operational status of this project, and monitors need one.',
    );

    statuses.rows.push({
      _id: id(9),
      name: "TF Operational",
      priority: 99,
      isOperationalState: true,
      projectId: PROJECT_ID,
    });

    await expect(
      remove(statuses, definition, { _id: id(9) }),
    ).resolves.toBeUndefined();
  });
});
