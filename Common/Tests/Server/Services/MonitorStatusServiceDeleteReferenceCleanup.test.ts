import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Deleting a monitor status must not be blocked by ALREADY soft-deleted
 * monitors that still hold a currentMonitorStatusId foreign key
 * (ON DELETE NO ACTION) to the status being removed. MonitorStatusService's
 * onBeforeDelete repoints those dead rows to the project's default (lowest
 * priority) operational status via
 * MonitorService.repointDeletedMonitorsAwayFromStatuses.
 *
 * These tests pin the fallback selection (default operational, never a status
 * that is itself being deleted), the per-project grouping, and the "do nothing
 * when no valid fallback survives" edge, all without a database.
 */

const PROJECT_A: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PROJECT_B: ObjectID = new ObjectID("bbbbbbbb-1111-4111-8111-111111111111");

const DELETED_OPERATIONAL_A: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SEEDED_OPERATIONAL_A: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const DELETED_STATUS_B: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SEEDED_OPERATIONAL_B: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

function makeStatus(
  id: ObjectID,
  projectId: ObjectID,
  isOperationalState: boolean,
): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.id = id;
  status.projectId = projectId;
  status.isOperationalState = isOperationalState;
  return status;
}

describe("MonitorStatusService delete reference cleanup", () => {
  let repointMock: MockFunction;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    repointMock = getJestMockFunction();
    repointMock.mockImplementation(() => {
      return Promise.resolve(1);
    });
    jest
      .spyOn(MonitorService, "repointDeletedMonitorsAwayFromStatuses")
      .mockImplementation(repointMock as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const runOnBeforeDelete: (id: ObjectID) => Promise<void> = async (
    id: ObjectID,
  ): Promise<void> => {
    const deleteBy: DeleteBy<MonitorStatus> = {
      query: { _id: id.toString() },
      props: { isRoot: true },
    } as DeleteBy<MonitorStatus>;

    await (
      MonitorStatusService as unknown as {
        onBeforeDelete: (d: DeleteBy<MonitorStatus>) => Promise<unknown>;
      }
    ).onBeforeDelete(deleteBy);
  };

  test("repoints deleted monitors to the default operational status, excluding the status being deleted", async () => {
    // findBy is called for: (1) statuses being deleted, (2) operational statuses.
    jest.spyOn(MonitorStatusService, "findBy").mockImplementation(((
      findBy: FindBy<MonitorStatus>,
    ) => {
      const query: Record<string, unknown> = findBy.query as Record<
        string,
        unknown
      >;

      if (query["isOperationalState"] === true) {
        // Ordered by priority ascending: the deleted one appears too, but the
        // seeded default is the first that is NOT being deleted.
        return Promise.resolve([
          makeStatus(DELETED_OPERATIONAL_A, PROJECT_A, true),
          makeStatus(SEEDED_OPERATIONAL_A, PROJECT_A, true),
        ]);
      }

      // Statuses being deleted.
      return Promise.resolve([
        makeStatus(DELETED_OPERATIONAL_A, PROJECT_A, true),
      ]);
    }) as never);

    await runOnBeforeDelete(DELETED_OPERATIONAL_A);

    expect(repointMock).toHaveBeenCalledTimes(1);
    const arg: {
      fromMonitorStatusIds: Array<ObjectID>;
      toMonitorStatusId: ObjectID;
      projectId: ObjectID;
    } = repointMock.mock.calls[0]![0] as {
      fromMonitorStatusIds: Array<ObjectID>;
      toMonitorStatusId: ObjectID;
      projectId: ObjectID;
    };

    expect(arg.projectId.toString()).toBe(PROJECT_A.toString());
    expect(arg.fromMonitorStatusIds.map((i: ObjectID) => i.toString())).toEqual(
      [DELETED_OPERATIONAL_A.toString()],
    );
    // Must NOT reassign to the status being deleted.
    expect(arg.toMonitorStatusId.toString()).not.toBe(
      DELETED_OPERATIONAL_A.toString(),
    );
    expect(arg.toMonitorStatusId.toString()).toBe(
      SEEDED_OPERATIONAL_A.toString(),
    );
  });

  test("the operational-status fallback lookup is priority-ascending and project-scoped", async () => {
    const findByMock: MockFunction = getJestMockFunction();
    findByMock.mockImplementation((findBy: FindBy<MonitorStatus>) => {
      const query: Record<string, unknown> = findBy.query as Record<
        string,
        unknown
      >;
      if (query["isOperationalState"] === true) {
        return Promise.resolve([
          makeStatus(SEEDED_OPERATIONAL_A, PROJECT_A, true),
        ]);
      }
      return Promise.resolve([
        makeStatus(DELETED_OPERATIONAL_A, PROJECT_A, true),
      ]);
    });
    jest
      .spyOn(MonitorStatusService, "findBy")
      .mockImplementation(findByMock as never);

    await runOnBeforeDelete(DELETED_OPERATIONAL_A);

    const operationalCall: FindBy<MonitorStatus> | undefined = (
      findByMock.mock.calls as Array<Array<FindBy<MonitorStatus>>>
    )
      .map((c: Array<FindBy<MonitorStatus>>) => {
        return c[0]!;
      })
      .find((c: FindBy<MonitorStatus>) => {
        return (c.query as { isOperationalState?: boolean }).isOperationalState === true;
      });

    expect(operationalCall).toBeDefined();
    expect(
      (operationalCall!.query as { projectId?: ObjectID }).projectId?.toString(),
    ).toBe(PROJECT_A.toString());
    const sort: Partial<Record<string, SortOrder>> =
      operationalCall!.sort as Partial<Record<string, SortOrder>>;
    expect(sort["priority"]).toBe(SortOrder.Ascending);
  });

  test("falls back to any remaining status when no operational status survives", async () => {
    jest.spyOn(MonitorStatusService, "findBy").mockImplementation(((
      findBy: FindBy<MonitorStatus>,
    ) => {
      const query: Record<string, unknown> = findBy.query as Record<
        string,
        unknown
      >;

      if (query["isOperationalState"] === true) {
        // Only the status being deleted is operational -> no survivor.
        return Promise.resolve([
          makeStatus(DELETED_OPERATIONAL_A, PROJECT_A, true),
        ]);
      }

      if (Object.prototype.hasOwnProperty.call(query, "_id")) {
        // Statuses being deleted.
        return Promise.resolve([
          makeStatus(DELETED_OPERATIONAL_A, PROJECT_A, true),
        ]);
      }

      // "any remaining status" lookup (project-scoped, no _id, no operational).
      return Promise.resolve([
        makeStatus(DELETED_OPERATIONAL_A, PROJECT_A, true),
        makeStatus(SEEDED_OPERATIONAL_A, PROJECT_A, false),
      ]);
    }) as never);

    await runOnBeforeDelete(DELETED_OPERATIONAL_A);

    expect(repointMock).toHaveBeenCalledTimes(1);
    const arg: { toMonitorStatusId: ObjectID } = repointMock.mock
      .calls[0]![0] as { toMonitorStatusId: ObjectID };
    expect(arg.toMonitorStatusId.toString()).toBe(
      SEEDED_OPERATIONAL_A.toString(),
    );
  });

  test("does not repoint when no fallback status survives", async () => {
    jest.spyOn(MonitorStatusService, "findBy").mockImplementation(((
      findBy: FindBy<MonitorStatus>,
    ) => {
      const query: Record<string, unknown> = findBy.query as Record<
        string,
        unknown
      >;

      if (Object.prototype.hasOwnProperty.call(query, "_id")) {
        return Promise.resolve([
          makeStatus(DELETED_OPERATIONAL_A, PROJECT_A, true),
        ]);
      }

      // Neither an operational survivor nor any other status remains.
      return Promise.resolve([]);
    }) as never);

    await runOnBeforeDelete(DELETED_OPERATIONAL_A);

    expect(repointMock).not.toHaveBeenCalled();
  });

  test("groups statuses being deleted per project and repoints each independently", async () => {
    jest.spyOn(MonitorStatusService, "findBy").mockImplementation(((
      findBy: FindBy<MonitorStatus>,
    ) => {
      const query: Record<string, unknown> = findBy.query as Record<
        string,
        unknown
      >;

      if (query["isOperationalState"] === true) {
        const projectId: ObjectID = query["projectId"] as ObjectID;
        if (projectId.toString() === PROJECT_A.toString()) {
          return Promise.resolve([
            makeStatus(DELETED_OPERATIONAL_A, PROJECT_A, true),
            makeStatus(SEEDED_OPERATIONAL_A, PROJECT_A, true),
          ]);
        }
        return Promise.resolve([
          makeStatus(DELETED_STATUS_B, PROJECT_B, true),
          makeStatus(SEEDED_OPERATIONAL_B, PROJECT_B, true),
        ]);
      }

      // Statuses being deleted span two projects.
      return Promise.resolve([
        makeStatus(DELETED_OPERATIONAL_A, PROJECT_A, true),
        makeStatus(DELETED_STATUS_B, PROJECT_B, true),
      ]);
    }) as never);

    // Multi-status delete (isRoot, query without _id is allowed for root).
    const deleteBy: DeleteBy<MonitorStatus> = {
      query: {},
      props: { isRoot: true },
    } as DeleteBy<MonitorStatus>;
    await (
      MonitorStatusService as unknown as {
        onBeforeDelete: (d: DeleteBy<MonitorStatus>) => Promise<unknown>;
      }
    ).onBeforeDelete(deleteBy);

    expect(repointMock).toHaveBeenCalledTimes(2);

    const byProject: Record<string, ObjectID> = {};
    for (const call of repointMock.mock.calls as Array<
      Array<{ projectId: ObjectID; toMonitorStatusId: ObjectID }>
    >) {
      const a: { projectId: ObjectID; toMonitorStatusId: ObjectID } = call[0]!;
      byProject[a.projectId.toString()] = a.toMonitorStatusId;
    }

    expect(byProject[PROJECT_A.toString()]?.toString()).toBe(
      SEEDED_OPERATIONAL_A.toString(),
    );
    expect(byProject[PROJECT_B.toString()]?.toString()).toBe(
      SEEDED_OPERATIONAL_B.toString(),
    );
  });
});

describe("MonitorService.repointDeletedMonitorsAwayFromStatuses", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is a no-op (no DB access) when there are no source statuses", async () => {
    // getRepository throws without a DB connection; an empty source list must
    // short-circuit before touching it.
    const getRepositorySpy: MockFunction = getJestMockFunction();
    jest
      .spyOn(
        MonitorService as unknown as { getRepository: () => unknown },
        "getRepository",
      )
      .mockImplementation(getRepositorySpy as never);

    const affected: number =
      await MonitorService.repointDeletedMonitorsAwayFromStatuses({
        fromMonitorStatusIds: [],
        toMonitorStatusId: SEEDED_OPERATIONAL_A,
        projectId: PROJECT_A,
      });

    expect(affected).toBe(0);
    expect(getRepositorySpy).not.toHaveBeenCalled();
  });
});
