import ContiguousOrder from "../../../../Server/Utils/Database/ContiguousOrder";
import StateOrderGuard, {
  StateListCreatePlacement,
} from "../../../../Server/Utils/Database/StateOrderGuard";
import logger from "../../../../Server/Utils/Logger";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
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
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * StateOrderGuard: what the state, severity and monitor status services do
 * around a write so a project's lists keep meaning what OneUptime reads them
 * as. The service is faked - a project's rows in memory - so these pin the
 * guard's own decisions and the reads it makes:
 *
 *   - a row created without a place goes where its list wants a new one:
 *     saved at the end of its list like any other row, then moved to the
 *     place of the row it goes above (beforeCreate says which, afterCreate
 *     moves it) - so it never shares that row's number (issue #9609);
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
  // The reads of the rows an update writes, each holding the update to them.
  holds: Array<{
    updateBy: UpdateBy<BaseModel>;
    select: Record<string, unknown>;
  }>;
  // The reads of the rows a delete removes, each holding the delete to them.
  deleteHolds: Array<{
    deleteBy: DeleteBy<BaseModel>;
    select: Record<string, unknown>;
  }>;
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
    holds: [],
    deleteHolds: [],
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
    /*
     * The rows the update writes: those it names that the caller may write,
     * which for a teammate are in their own project.
     */
    findRowsAndHoldUpdateToThem: async (
      updateBy: UpdateBy<BaseModel>,
      select: Record<string, unknown>,
    ): Promise<Array<BaseModel>> => {
      fake.holds.push({ updateBy, select });
      const query: Record<string, unknown> = updateBy.query as Record<
        string,
        unknown
      >;
      return fake.rows
        .filter((row: FakeRow) => {
          return (
            inProject(row, updateBy.props.tenantId) &&
            (query["_id"] === undefined || row._id === query["_id"]?.toString())
          );
        })
        .map(toModel);
    },
    /*
     * The rows the delete removes: those it names that the caller may
     * delete, which for a teammate are in their own project.
     */
    findRowsAndHoldDeleteToThem: async (
      deleteBy: DeleteBy<BaseModel>,
      select: Record<string, unknown>,
    ): Promise<Array<BaseModel>> => {
      fake.deleteHolds.push({ deleteBy, select });
      const query: Record<string, unknown> = deleteBy.query as Record<
        string,
        unknown
      >;
      return fake.rows
        .filter((row: FakeRow) => {
          return (
            inProject(row, deleteBy.props.tenantId) &&
            (query["_id"] === undefined || row._id === query["_id"]?.toString())
          );
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
  flags?: Record<string, boolean>,
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
  props?: Record<string, unknown>,
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
  props?: Record<string, unknown>,
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

  /*
   * The row is saved at the end of its list, with no number of its own, and
   * moved to the resolved state's place once it is saved (afterCreate): it
   * no longer takes the resolved state's number, which put two states at
   * one number when writing a number stopped moving the rest.
   */
  test("a state created without a place is to go just above the resolved state, once saved at the end", async () => {
    const state: IncidentState = newIncidentState({});

    const placement: StateListCreatePlacement | null =
      await StateOrderGuard.beforeCreate({
        service: fake.service,
        definition: INCIDENT,
        createBy: {
          data: state,
          props: SIGNED_IN,
        } as unknown as CreateBy<IncidentState>,
      });

    expect(placement).toEqual({ placeAboveId: id(4) });
    expect(state.order).toBeUndefined();
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
    // Rows that share a number are read by id: no time of creation.
    expect(fake.findAllBySelects[0]).toEqual({
      _id: true,
      name: true,
      order: true,
      isCreatedState: true,
      isAcknowledgedState: true,
      isResolvedState: true,
    });
  });

  test("a state created with a place keeps it, is moved nowhere, and costs no read", async () => {
    const state: IncidentState = newIncidentState({ order: 99 });

    const placement: StateListCreatePlacement | null =
      await StateOrderGuard.beforeCreate({
        service: fake.service,
        definition: INCIDENT,
        createBy: {
          data: state,
          props: SIGNED_IN,
        } as unknown as CreateBy<IncidentState>,
      });

    expect(placement).toBeNull();
    expect(state.order).toBe(99);
    expect(fake.findAllByQueries).toHaveLength(0);
  });

  test("a state created at the resolved state's own number keeps it: two states at one number, listed by id", async () => {
    const state: IncidentState = newIncidentState({ order: 4 });

    const placement: StateListCreatePlacement | null =
      await StateOrderGuard.beforeCreate({
        service: fake.service,
        definition: INCIDENT,
        createBy: {
          data: state,
          props: SIGNED_IN,
        } as unknown as CreateBy<IncidentState>,
      });

    expect(placement).toBeNull();
    expect(state.order).toBe(4);
  });

  test("with no resolved state, the new row is left at the end", async () => {
    fake.rows = fake.rows.filter((row: FakeRow) => {
      return !row["isResolvedState"];
    });

    const state: IncidentState = newIncidentState({});

    const placement: StateListCreatePlacement | null =
      await StateOrderGuard.beforeCreate({
        service: fake.service,
        definition: INCIDENT,
        createBy: {
          data: state,
          props: SIGNED_IN,
        } as unknown as CreateBy<IncidentState>,
      });

    expect(placement).toBeNull();
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
    ).resolves.toBeNull();
  });

  test("a signed-in built-in state created without a place is checked where it will go: just above the resolved state", async () => {
    // A project whose list has lost its created state.
    fake.rows = fake.rows.map((row: FakeRow): FakeRow => {
      return { ...row, isCreatedState: false };
    });

    // The created state, just above Resolved: below Acknowledged - refused.
    await expect(
      StateOrderGuard.beforeCreate({
        service: fake.service,
        definition: INCIDENT,
        createBy: {
          data: newIncidentState({ name: "Opened", isCreatedState: true }),
          props: SIGNED_IN,
        } as unknown as CreateBy<IncidentState>,
      }),
    ).rejects.toThrow(BadDataException);
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
    ).resolves.toBeNull();

    await expect(
      StateOrderGuard.beforeCreate({
        service: fake.service,
        definition: INCIDENT,
        createBy: {
          data: newIncidentState({ name: "Seeded" }),
          props: { isRoot: true },
        } as unknown as CreateBy<IncidentState>,
      }),
    ).resolves.toEqual({ placeAboveId: id(4) });
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

  test("a monitor status is to go just above the offline status", async () => {
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

    const placement: StateListCreatePlacement | null =
      await StateOrderGuard.beforeCreate({
        service: statuses.service,
        definition: STATE_LISTS[StateListType.MonitorStatus],
        createBy: {
          data: status,
          props: SIGNED_IN,
        } as unknown as CreateBy<MonitorStatus>,
      });

    expect(placement).toEqual({ placeAboveId: id(3) });
    expect(status.priority).toBeUndefined();
  });

  test("a severity is left alone - to the end of its list - with no read", async () => {
    const severities: FakeService = fakeService(AlertSeverity, [
      { _id: id(1), name: "High", order: 1, projectId: PROJECT_ID },
      { _id: id(2), name: "Low", order: 2, projectId: PROJECT_ID },
    ]);

    const severity: AlertSeverity = new AlertSeverity();
    severity.name = "Medium";
    severity.projectId = PROJECT_ID;

    const placement: StateListCreatePlacement | null =
      await StateOrderGuard.beforeCreate({
        service: severities.service,
        definition: STATE_LISTS[StateListType.AlertSeverity],
        createBy: {
          data: severity,
          props: SIGNED_IN,
        } as unknown as CreateBy<AlertSeverity>,
      });

    expect(placement).toBeNull();
    expect(severity.order).toBeUndefined();
    expect(severities.findAllByQueries).toHaveLength(0);
  });

  test("a maintenance state is to go just above the completed state", async () => {
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

    const placement: StateListCreatePlacement | null =
      await StateOrderGuard.beforeCreate({
        service: maintenance.service,
        definition: STATE_LISTS[StateListType.ScheduledMaintenanceState],
        createBy: {
          data: state,
          props: SIGNED_IN,
        } as unknown as CreateBy<ScheduledMaintenanceState>,
      });

    expect(placement).toEqual({ placeAboveId: id(4) });
    expect(state.order).toBeUndefined();
  });
});

/*
 * Once the row beforeCreate placed is saved at the end of its list, it is
 * moved to the place of the row it goes above, in one transaction holding
 * the list (ContiguousOrder.moveRowOfList): that row and the rows after it
 * step down one, the list numbered 1..n.
 */
describe("StateOrderGuard.afterCreate", () => {
  let moves: Array<Record<string, unknown>>;
  let fake: FakeService;

  beforeEach(() => {
    moves = [];
    fake = fakeService(IncidentState, incidentStates());

    jest
      .spyOn(ContiguousOrder, "moveRowOfList")
      .mockImplementation(async (data: unknown) => {
        moves.push(data as Record<string, unknown>);
        // New (6) to Resolved's place: it is 4, Resolved 5, Postmortem 6.
        return {
          changedRows: [
            { id: id(6), order: 4 },
            { id: id(4), order: 5 },
            { id: id(5), order: 6 },
          ],
        };
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const created: () => IncidentState = (): IncidentState => {
    const state: IncidentState = newIncidentState({ order: 6 });
    state.id = new ObjectID(id(6));
    return state;
  };

  test("moves the new row to the place of the row it goes above, in its project's list, and hands back its number", async () => {
    const state: IncidentState = created();

    await StateOrderGuard.afterCreate({
      service: fake.service,
      placement: { placeAboveId: id(4) },
      createdItem: state,
    });

    expect(moves).toHaveLength(1);
    expect(moves[0]!["rowId"]?.toString()).toBe(id(6));
    expect(moves[0]!["placeOfId"]?.toString()).toBe(id(4));
    expect(moves[0]!["orderColumn"]).toBe("order");
    expect(moves[0]!["sortOrder"]).toBe(SortOrder.Ascending);
    expect(moves[0]!["list"]).toEqual([
      { column: "projectId", value: PROJECT_ID.toString(), isId: true },
    ]);
    expect(state.order).toBe(4);
  });

  test("moves nothing for a row beforeCreate left where it was saved", async () => {
    await StateOrderGuard.afterCreate({
      service: fake.service,
      placement: null,
      createdItem: created(),
    });

    expect(moves).toHaveLength(0);
  });

  test("a move that fails leaves the row at the end of its list, and the create stands", async () => {
    jest
      .spyOn(ContiguousOrder, "moveRowOfList")
      .mockRejectedValue(new Error("lock timeout") as never);
    const logged: jest.SpiedFunction<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((() => {}) as never);

    const state: IncidentState = created();

    await expect(
      StateOrderGuard.afterCreate({
        service: fake.service,
        placement: { placeAboveId: id(4) },
        createdItem: state,
      }),
    ).resolves.toBeUndefined();

    expect(state.order).toBe(6);
    expect(logged).toHaveBeenCalled();
  });

  test("a monitor status is moved by its priority", async () => {
    const statuses: FakeService = fakeService(MonitorStatus, []);
    const status: MonitorStatus = new MonitorStatus();
    status.id = new ObjectID(id(6));
    status.projectId = PROJECT_ID;
    // Saved at the end of the list, past the offline status.
    status.priority = 6;

    await StateOrderGuard.afterCreate({
      service: statuses.service,
      placement: { placeAboveId: id(3) },
      createdItem: status,
    });

    expect(moves[0]!["orderColumn"]).toBe("priority");
    expect(status.priority).toBe(4);
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

    expect(fake.holds).toHaveLength(0);
    expect(fake.findByQueries).toHaveLength(0);
    expect(fake.findAllByQueries).toHaveLength(0);
  });

  test("root writes are not checked", async () => {
    await expect(
      update(fake, id(4), { order: 1 }, { isRoot: true }),
    ).resolves.toBeUndefined();

    expect(fake.holds).toHaveLength(0);
    expect(fake.findByQueries).toHaveLength(0);
  });

  test("the moved row is read by the update's own query, and the update is held to what was read", async () => {
    await update(fake, id(2), { order: 1 });

    expect(fake.holds).toHaveLength(1);
    expect(
      (fake.holds[0]!.updateBy.query as Record<string, unknown>)["_id"],
    ).toBe(id(2));
    expect(fake.holds[0]!.select).toEqual({ _id: true, projectId: true });
    expect(fake.findByQueries).toHaveLength(0);
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

    expect(statuses.holds).toHaveLength(0);
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
    expect(fake.deleteHolds).toHaveLength(0);
  });

  test("the rows checked are the rows the delete removes, read with the delete held to them", async () => {
    await expect(remove(fake, INCIDENT, { _id: id(2) })).resolves.toBe(
      undefined,
    );

    expect(fake.deleteHolds).toHaveLength(1);
    expect(fake.deleteHolds[0]!.deleteBy.query).toEqual({ _id: id(2) });
    expect(fake.deleteHolds[0]!.select).toEqual({
      _id: true,
      projectId: true,
    });
    // Nothing else read by the delete's own query.
    expect(
      fake.findByQueries.filter((query: Record<string, unknown>) => {
        return query["_id"] !== undefined;
      }),
    ).toHaveLength(0);
  });

  test("a delete that reaches several states is judged on all of them together", async () => {
    // Every state of the project in one delete: the built-ins with them.
    await expect(remove(fake, INCIDENT, {})).rejects.toThrow("is the");
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
    expect(severities.deleteHolds).toHaveLength(0);
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
