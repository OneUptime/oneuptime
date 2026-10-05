import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import Queue from "../../../Server/Infrastructure/Queue";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import logger from "../../../Server/Utils/Logger";
import { Green, Red } from "../../../Types/BrandColors";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

/*
 * The state, severity and monitor status services through the real
 * create(), updateOneById() and deleteOneById() pipelines - only the
 * database, permissions and side effects that reach the network are stubbed.
 * Where StateOrderGuard.test.ts pins the guard's decisions, this pins that
 * the services and DatabaseService (@ListOrderColumn) put them together:
 *
 *   - a new incident state lands just above the resolved state, and the
 *     resolved state (and anything below it) steps down once it is saved;
 *   - a severity created with a number another one holds takes its place -
 *     no "same order already exists" refusal - and a severity created without
 *     one goes to the end (it used to fail: "order is required");
 *   - a signed-in drag of a state is written, and the states in the way
 *     step aside; a drag that would put the resolved state above the
 *     acknowledged one is refused before anything is written;
 *   - a monitor status's priority can be changed by a signed-in caller (it
 *     used to be refused outright);
 *   - the project's last resolved state cannot be deleted.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const SIGNED_IN: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("55555555-5555-4555-8555-555555555555"),
};

const id: (n: number) => string = (n: number): string => {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
};

const at: (minute: number) => Date = (minute: number): Date => {
  return new Date(Date.UTC(2026, 0, 1, 0, minute));
};

type Written = { id: string; data: Record<string, unknown> };

interface Harness {
  // The project's list, as findAllBy reads it.
  rows: Array<Record<string, unknown>>;
  saved: Array<Record<string, unknown>>;
  written: Array<Written>;
  repositoryUpdates: Array<Record<string, unknown>>;
  deleted: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stub: (service: any, modelType: any) => Harness = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modelType: any,
): Harness => {
  const harness: Harness = {
    rows: [],
    saved: [],
    written: [],
    repositoryUpdates: [],
    deleted: 0,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toModel: (row: Record<string, unknown>) => any = (
    row: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any => {
    const model: Record<string, unknown> = new modelType();
    for (const [key, value] of Object.entries(row)) {
      model[key] = value;
    }
    return model;
  };

  getJestSpyOn(service, "getRepository").mockReturnValue({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    save: async (entity: any): Promise<any> => {
      entity._id = entity._id || id(999);
      harness.saved.push({ ...entity });
      return entity;
    },
    update: async (
      _criteria: unknown,
      data: Record<string, unknown>,
    ): Promise<{ affected: number }> => {
      harness.repositoryUpdates.push(data);
      return { affected: 1 };
    },
    delete: async (): Promise<{ affected: number }> => {
      harness.deleted++;
      return { affected: 1 };
    },
  } as never);

  getJestSpyOn(service, "countBy").mockResolvedValue(
    new PositiveNumber(0) as never,
  );
  getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );

  getJestSpyOn(service, "findAllBy").mockImplementation((async () => {
    return harness.rows.map(toModel);
  }) as never);

  // The rows a write targets, and the row an update reads before writing.
  getJestSpyOn(service, "_findBy").mockImplementation((async (args: {
    query: Record<string, unknown>;
  }) => {
    return harness.rows
      .filter((row: Record<string, unknown>) => {
        return (
          args.query["_id"] === undefined ||
          String(row["_id"]) === String(args.query["_id"])
        );
      })
      .map(toModel);
  }) as never);

  getJestSpyOn(service, "updateColumnsByIdWithoutHooks").mockImplementation(
    (async (input: { id: ObjectID; data: Record<string, unknown> }) => {
      harness.written.push({ id: input.id.toString(), data: input.data });
    }) as never,
  );

  return harness;
};

const state: (
  n: number,
  name: string,
  order: number,
  flags?: Record<string, boolean>,
) => Record<string, unknown> = (
  n: number,
  name: string,
  order: number,
  flags: Record<string, boolean> = {},
): Record<string, unknown> => {
  return {
    _id: id(n),
    name: name,
    order: order,
    projectId: PROJECT_ID,
    createdAt: at(n),
    ...flags,
  };
};

beforeEach(() => {
  jest.restoreAllMocks();

  jest
    .spyOn(ModelPermission, "checkCreatePermissions")
    .mockImplementation((() => {
      return undefined;
    }) as never);
  jest
    .spyOn(ModelPermission, "checkUpdatePermissionByModel")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ModelPermission, "checkUpdateQueryPermissions")
    .mockImplementation(((_modelType: unknown, query: unknown) => {
      return Promise.resolve(query);
    }) as never);
  jest
    .spyOn(ModelPermission, "checkDeletePermissionByModel")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ModelPermission, "checkDeleteQueryPermission")
    .mockImplementation(((_modelType: unknown, query: unknown) => {
      return Promise.resolve(query);
    }) as never);
  // The same checks, as DatabaseService asks them before the hooks.
  jest
    .spyOn(ModelPermission, "checkTableWritePermission")
    .mockImplementation((() => {
      return undefined;
    }) as never);
  jest
    .spyOn(ModelPermission, "getUpdatableQuery")
    .mockImplementation(((_modelType: unknown, query: unknown) => {
      return Promise.resolve(query);
    }) as never);
  jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);
  jest.spyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentStateService", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = stub(IncidentStateService, IncidentState);
    harness.rows = [
      state(1, "Identified", 1, { isCreatedState: true }),
      state(2, "Acknowledged", 2, { isAcknowledgedState: true }),
      state(3, "Resolved", 3, { isResolvedState: true }),
      state(4, "Postmortem", 4),
    ];
  });

  test("a new state lands just above Resolved, which steps down once it is saved", async () => {
    const created: IncidentState = new IncidentState();
    created.name = "Mitigated";
    created.color = Green;

    await IncidentStateService.create({ data: created, props: SIGNED_IN });

    expect(harness.saved).toHaveLength(1);
    expect(harness.saved[0]!["order"]).toBe(3);
    expect(String(harness.saved[0]!["projectId"])).toBe(PROJECT_ID.toString());
    expect(harness.written).toEqual([
      { id: id(3), data: { order: 4 } },
      { id: id(4), data: { order: 5 } },
    ]);
  });

  test("a new state with a number takes that place: no 'same order already exists' refusal", async () => {
    const created: IncidentState = new IncidentState();
    created.name = "Investigating";
    created.color = Red;
    created.order = 2;

    await expect(
      IncidentStateService.create({ data: created, props: SIGNED_IN }),
    ).resolves.toBeDefined();

    expect(harness.saved[0]!["order"]).toBe(2);
    expect(harness.written).toEqual([
      { id: id(2), data: { order: 3 } },
      { id: id(3), data: { order: 4 } },
      { id: id(4), data: { order: 5 } },
    ]);
  });

  test("a drag of a state is written, and the states in the way step aside", async () => {
    // Postmortem dropped onto Resolved's place: the dashboard sends 3.
    await IncidentStateService.updateOneById({
      id: new ObjectID(id(4)),
      data: { order: 3 },
      props: SIGNED_IN,
    });

    expect(harness.repositoryUpdates).toEqual([
      expect.objectContaining({ order: 3 }),
    ]);
    expect(harness.written).toEqual([{ id: id(3), data: { order: 4 } }]);
  });

  test("a drag that would put Resolved above Acknowledged is refused before anything is written", async () => {
    await expect(
      IncidentStateService.updateOneById({
        id: new ObjectID(id(3)),
        data: { order: 2 },
        props: SIGNED_IN,
      }),
    ).rejects.toThrow(
      'Incidents only ever move down this list, so the resolved state ("Resolved") has to stay below the acknowledged state ("Acknowledged").',
    );

    expect(harness.repositoryUpdates).toEqual([]);
    expect(harness.written).toEqual([]);
  });

  test("renaming a built-in state is just an edit", async () => {
    await IncidentStateService.updateOneById({
      id: new ObjectID(id(3)),
      data: { name: "Closed" },
      props: SIGNED_IN,
    });

    expect(harness.repositoryUpdates).toEqual([
      expect.objectContaining({ name: "Closed" }),
    ]);
  });

  test("the project's only resolved state cannot be deleted", async () => {
    await expect(
      IncidentStateService.deleteOneById({
        id: new ObjectID(id(3)),
        props: SIGNED_IN,
      }),
    ).rejects.toThrow(BadDataException);

    expect(harness.deleted).toBe(0);
  });

  test("a state the project added is deleted, and nothing is renumbered", async () => {
    await IncidentStateService.deleteOneById({
      id: new ObjectID(id(4)),
      props: SIGNED_IN,
    });

    expect(harness.deleted).toBe(1);
    expect(harness.written).toEqual([]);
    expect(harness.repositoryUpdates).toEqual([]);
  });
});

describe("IncidentSeverityService", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = stub(IncidentSeverityService, IncidentSeverity);
    harness.rows = [
      state(1, "Critical", 1),
      state(2, "Major", 2),
      state(3, "Minor", 3),
    ];
  });

  test("a severity created without a number goes to the end - it used to be refused", async () => {
    const created: IncidentSeverity = new IncidentSeverity();
    created.name = "Informational";
    created.color = Green;

    await IncidentSeverityService.create({ data: created, props: SIGNED_IN });

    expect(harness.saved[0]!["order"]).toBe(4);
    expect(harness.written).toEqual([]);
  });

  test("a severity created with the number another holds takes its place", async () => {
    const created: IncidentSeverity = new IncidentSeverity();
    created.name = "Severe";
    created.color = Red;
    created.order = 2;

    await IncidentSeverityService.create({ data: created, props: SIGNED_IN });

    expect(harness.saved[0]!["order"]).toBe(2);
    expect(harness.written).toEqual([
      { id: id(2), data: { order: 3 } },
      { id: id(3), data: { order: 4 } },
    ]);
  });

  test("a severity can be dragged to any rank", async () => {
    await IncidentSeverityService.updateOneById({
      id: new ObjectID(id(3)),
      data: { order: 1 },
      props: SIGNED_IN,
    });

    expect(harness.repositoryUpdates).toEqual([
      expect.objectContaining({ order: 1 }),
    ]);
    expect(harness.written).toEqual([
      { id: id(1), data: { order: 2 } },
      { id: id(2), data: { order: 3 } },
    ]);
  });
});

describe("MonitorStatusService", () => {
  let harness: Harness;

  const status: (
    n: number,
    name: string,
    priority: number,
    flags?: Record<string, boolean>,
  ) => Record<string, unknown> = (
    n: number,
    name: string,
    priority: number,
    flags: Record<string, boolean> = {},
  ): Record<string, unknown> => {
    return {
      _id: id(n),
      name: name,
      priority: priority,
      projectId: PROJECT_ID,
      createdAt: at(n),
      ...flags,
    };
  };

  beforeEach(() => {
    harness = stub(MonitorStatusService, MonitorStatus);
    harness.rows = [
      status(1, "Operational", 1, { isOperationalState: true }),
      status(2, "Degraded", 2),
      status(3, "Offline", 3, { isOfflineState: true }),
    ];
  });

  test("a new status lands just above Offline, which steps down", async () => {
    const created: MonitorStatus = new MonitorStatus();
    created.name = "Partial Outage";
    created.color = Red;

    await MonitorStatusService.create({ data: created, props: SIGNED_IN });

    expect(harness.saved[0]!["priority"]).toBe(3);
    expect(harness.written).toEqual([{ id: id(3), data: { priority: 4 } }]);
  });

  test("a signed-in caller can change a status's priority - dragging it", async () => {
    await MonitorStatusService.updateOneById({
      id: new ObjectID(id(2)),
      data: { priority: 3 },
      props: SIGNED_IN,
    });

    expect(harness.repositoryUpdates).toEqual([
      expect.objectContaining({ priority: 3 }),
    ]);
    expect(harness.written).toEqual([{ id: id(3), data: { priority: 2 } }]);
  });
});
