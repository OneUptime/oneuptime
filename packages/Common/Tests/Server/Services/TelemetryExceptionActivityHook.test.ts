import TelemetryExceptionService from "../../../Server/Services/TelemetryExceptionService";
import TelemetryExceptionActivityService, {
  TelemetryExceptionActivityActor,
  TelemetryExceptionActivityEntry,
} from "../../../Server/Services/TelemetryExceptionActivityService";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import { TelemetryExceptionActivityType } from "../../../Models/DatabaseModels/TelemetryExceptionActivity";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
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
 * EVERY TRIAGE AND ASSIGNMENT IS RECORDED ON THE EXCEPTION'S TIMELINE.
 *
 * Whoever makes the change - the exception's page, a row's menu, Bulk
 * Actions (one update per row), a script through the API (an update of one
 * row or of many by a query), OneUptime itself - it goes through
 * TelemetryExceptionService's update hooks: onBeforeUpdate reads the rows it
 * is about to write as they are (findRowsAndHoldUpdateToThem), and
 * onUpdateSuccess records what the write changed, crediting who made it.
 * Pinned at the hooks, and then through updateOneById / updateBy - what
 * the API's update routes call - with the database faked.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const A: string = "30000000-0000-4000-8000-00000000000a";
const B: string = "30000000-0000-4000-8000-00000000000b";
const PRIYA: ObjectID = new ObjectID("90000000-0000-4000-8000-000000000001");
const ALEX: ObjectID = new ObjectID("90000000-0000-4000-8000-000000000002");
const PLATFORM: ObjectID = new ObjectID("a0000000-0000-4000-8000-000000000001");

type BeforeUpdate = (
  updateBy: UpdateBy<TelemetryException>,
) => Promise<OnUpdate<TelemetryException>>;
type UpdateSuccess = (
  onUpdate: OnUpdate<TelemetryException>,
  ids: Array<ObjectID>,
) => Promise<OnUpdate<TelemetryException>>;

interface RowState {
  id: string;
  isResolved?: boolean;
  isArchived?: boolean;
  resolvedInReleaseAfter?: string;
  assignToUserId?: ObjectID;
  assignToTeamId?: ObjectID;
}

function exceptionRow(state: RowState): TelemetryException {
  const model: TelemetryException = new TelemetryException();
  model._id = state.id;
  model.projectId = PROJECT_ID;
  model.isResolved = Boolean(state.isResolved);
  model.isArchived = Boolean(state.isArchived);

  if (state.resolvedInReleaseAfter) {
    model.resolvedInReleaseAfter = state.resolvedInReleaseAfter;
  }

  if (state.assignToUserId) {
    model.assignToUserId = state.assignToUserId;
  }

  if (state.assignToTeamId) {
    model.assignToTeamId = state.assignToTeamId;
  }

  return model;
}

let rowsBefore: Array<TelemetryException>;
let recorded: Array<{
  entries: Array<TelemetryExceptionActivityEntry>;
  actor: TelemetryExceptionActivityActor;
}>;
let heldReads: number;

function recordedTypes(): Array<TelemetryExceptionActivityType> {
  return recorded.flatMap(
    (call: {
      entries: Array<TelemetryExceptionActivityEntry>;
    }): Array<TelemetryExceptionActivityType> => {
      return call.entries.map(
        (
          entry: TelemetryExceptionActivityEntry,
        ): TelemetryExceptionActivityType => {
          return entry.activityType;
        },
      );
    },
  );
}

beforeEach(() => {
  rowsBefore = [exceptionRow({ id: A })];
  recorded = [];
  heldReads = 0;

  jest
    .spyOn(TelemetryExceptionActivityService, "record")
    .mockImplementation((async (data: {
      entries: Array<TelemetryExceptionActivityEntry>;
      actor: TelemetryExceptionActivityActor;
    }) => {
      recorded.push(data);
      return data.entries.length;
    }) as never);

  // The rows an update writes, as they were: the database's, faked.
  jest
    .spyOn(TelemetryExceptionService, "findRowsAndHoldUpdateToThem")
    .mockImplementation((async () => {
      heldReads++;
      return rowsBefore;
    }) as never);

  /*
   * A write that names a person or a team is first checked against the
   * project (the person a member, the team the project's own), which needs
   * the database. That check is ProjectReferencesService's, tested with it.
   */
  jest
    .spyOn(
      ProjectReferencesService.prototype as unknown as {
        onBeforeUpdate: BeforeUpdate;
      },
      "onBeforeUpdate",
    )
    .mockImplementation(async (updateBy: UpdateBy<TelemetryException>) => {
      return { updateBy, carryForward: null };
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function runHooks(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = { isRoot: true, userId: PRIYA },
  updatedIds: Array<string> = [A],
): Promise<void> {
  const onBeforeUpdate: BeforeUpdate = (
    TelemetryExceptionService as unknown as { onBeforeUpdate: BeforeUpdate }
  ).onBeforeUpdate.bind(TelemetryExceptionService);
  const onUpdateSuccess: UpdateSuccess = (
    TelemetryExceptionService as unknown as { onUpdateSuccess: UpdateSuccess }
  ).onUpdateSuccess.bind(TelemetryExceptionService);

  const onUpdate: OnUpdate<TelemetryException> = await onBeforeUpdate({
    query: { _id: A },
    data: data,
    props: props,
  } as unknown as UpdateBy<TelemetryException>);

  await onUpdateSuccess(
    onUpdate,
    updatedIds.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
  );
}

describe("the update hooks record what a write changed", () => {
  test("Resolve on the exception's page: Resolved, by the person", async () => {
    await runHooks({ isResolved: true });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.actor).toEqual({ userId: PRIYA });
    expect(recorded[0]!.entries).toEqual([
      {
        projectId: PROJECT_ID,
        telemetryExceptionId: new ObjectID(A),
        activityType: TelemetryExceptionActivityType.Resolved,
        assigneeUserId: undefined,
        assigneeTeamId: undefined,
        release: undefined,
      },
    ]);
  });

  test("Resolve in next release records the release it waits out", async () => {
    await runHooks({ isResolved: true, resolvedInReleaseAfter: "v1.4.0" });

    expect(recorded[0]!.entries[0]).toMatchObject({
      activityType: TelemetryExceptionActivityType.ResolvedInNextRelease,
      release: "v1.4.0",
    });
  });

  test("Reopen, Archive and Unarchive", async () => {
    rowsBefore = [exceptionRow({ id: A, isResolved: true })];
    await runHooks({ isResolved: false });

    rowsBefore = [exceptionRow({ id: A })];
    await runHooks({ isArchived: true });

    rowsBefore = [exceptionRow({ id: A, isArchived: true })];
    await runHooks({ isArchived: false });

    expect(recordedTypes()).toEqual([
      TelemetryExceptionActivityType.Reopened,
      TelemetryExceptionActivityType.Archived,
      TelemetryExceptionActivityType.Unarchived,
    ]);
  });

  test("assigning a person, then a team, then nobody", async () => {
    await runHooks({ assignToUserId: ALEX });

    rowsBefore = [exceptionRow({ id: A, assignToUserId: ALEX })];
    await runHooks({ assignToTeamId: PLATFORM });

    rowsBefore = [exceptionRow({ id: A, assignToTeamId: PLATFORM })];
    await runHooks({ assignToUserId: null, assignToTeamId: null });

    expect(
      recorded.map(
        (call: { entries: Array<TelemetryExceptionActivityEntry> }) => {
          const entry: TelemetryExceptionActivityEntry = call.entries[0]!;
          return [
            entry.activityType,
            entry.assigneeUserId,
            entry.assigneeTeamId,
          ];
        },
      ),
    ).toEqual([
      [TelemetryExceptionActivityType.Assigned, ALEX.toString(), null],
      [TelemetryExceptionActivityType.Assigned, null, PLATFORM.toString()],
      [TelemetryExceptionActivityType.Unassigned, null, PLATFORM.toString()],
    ]);
  });

  test("a write that changes nothing records nothing", async () => {
    rowsBefore = [exceptionRow({ id: A, isResolved: true })];
    await runHooks({ isResolved: true });

    rowsBefore = [exceptionRow({ id: A, assignToUserId: PRIYA })];
    await runHooks({ assignToUserId: PRIYA });

    expect(recorded).toHaveLength(0);
  });

  test("a write that is no triage reads no rows and records nothing", async () => {
    await runHooks({ aiClassification: "CodeFault" });
    await runHooks({ aiFixDeclinedAt: new Date() });
    await runHooks({ aiExplanationGeneratedAt: new Date() });

    expect(heldReads).toBe(0);
    expect(recorded).toHaveLength(0);
  });

  test("a row the write did not reach - deleted meanwhile - records nothing", async () => {
    await runHooks({ isResolved: true }, { isRoot: true }, []);

    expect(recorded).toHaveLength(0);
  });

  test("one update of many rows, as an API script's by a query: one entry per row it changed", async () => {
    rowsBefore = [
      exceptionRow({ id: A }),
      exceptionRow({ id: B, isResolved: true }),
    ];

    await runHooks({ isResolved: true }, { isRoot: true, userId: PRIYA }, [
      A,
      B,
    ]);

    // B was resolved already.
    expect(recorded).toHaveLength(1);
    expect(
      recorded[0]!.entries.map((entry: TelemetryExceptionActivityEntry) => {
        return entry.telemetryExceptionId.toString();
      }),
    ).toEqual([A]);
  });

  test("an API key's change is credited to the key, by the name it has", async () => {
    await runHooks(
      { isArchived: true },
      {
        tenantId: PROJECT_ID,
        isRoot: true,
        apiKeyId: ObjectID.generate(),
        apiKeyName: "Deploy pipeline",
      },
    );

    expect(recorded[0]!.actor).toEqual({ apiKeyName: "Deploy pipeline" });
  });

  test("OneUptime's own changes - an AI fix merged, a fix that did not hold - are credited to nobody: OneUptime", async () => {
    await runHooks(
      { isResolved: true, markedAsResolvedAt: new Date() },
      {
        isRoot: true,
      },
    );

    rowsBefore = [exceptionRow({ id: A, isResolved: true })];
    await runHooks(
      { isResolved: false, regressedAt: new Date() },
      {
        isRoot: true,
      },
    );

    expect(
      recorded.map((call: { actor: TelemetryExceptionActivityActor }) => {
        return call.actor;
      }),
    ).toEqual([{}, {}]);
    expect(recordedTypes()).toEqual([
      TelemetryExceptionActivityType.Resolved,
      TelemetryExceptionActivityType.Regressed,
    ]);
  });
});

/*
 * Through updateOneById and updateBy - the calls the API's update routes,
 * Bulk Actions and OneUptime's own code make - with the database faked: the
 * rows the write finds, and the UPDATE.
 */
describe("updates through the service record their activity", () => {
  let updateMock: MockFunction;

  beforeEach(() => {
    (
      TelemetryExceptionService.findRowsAndHoldUpdateToThem as unknown as jest.Mock
    ).mockRestore();

    jest
      .spyOn(TelemetryExceptionService as never, "_findBy")
      .mockImplementation((async () => {
        return rowsBefore;
      }) as never);

    updateMock = getJestMockFunction();
    updateMock.mockImplementation(() => {
      return Promise.resolve({ affected: 1 });
    });
    jest
      .spyOn(TelemetryExceptionService, "getRepository")
      .mockReturnValue({ update: updateMock } as never);

    jest
      .spyOn(ModelPermission, "checkUpdatePermissionByModel")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockImplementation(((_modelType: unknown, query: unknown) => {
        return Promise.resolve(query);
      }) as never);
  });

  test("updateOneById - the API's update route, one row of Bulk Actions - records the change, crediting the caller", async () => {
    await TelemetryExceptionService.updateOneById({
      id: new ObjectID(A),
      data: { isResolved: true },
      props: { isRoot: true, userId: PRIYA },
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(recordedTypes()).toEqual([TelemetryExceptionActivityType.Resolved]);
    expect(recorded[0]!.actor).toEqual({ userId: PRIYA });
    expect(recorded[0]!.entries[0]!.telemetryExceptionId.toString()).toBe(A);
  });

  test("updateBy over several rows records each row it changed", async () => {
    rowsBefore = [exceptionRow({ id: A }), exceptionRow({ id: B })];

    await TelemetryExceptionService.updateBy({
      query: { _id: QueryHelper.any([A, B]) },
      data: { isArchived: true },
      limit: 10,
      skip: 0,
      props: { isRoot: true, userId: PRIYA },
    });

    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(
      recorded[0]!.entries.map((entry: TelemetryExceptionActivityEntry) => {
        return [entry.activityType, entry.telemetryExceptionId.toString()];
      }),
    ).toEqual([
      [TelemetryExceptionActivityType.Archived, A],
      [TelemetryExceptionActivityType.Archived, B],
    ]);
  });

  test("a row deleted between the read and the write records nothing", async () => {
    updateMock.mockImplementation(() => {
      return Promise.resolve({ affected: 0 });
    });

    await TelemetryExceptionService.updateOneById({
      id: new ObjectID(A),
      data: { isResolved: true },
      props: { isRoot: true, userId: PRIYA },
    });

    expect(recorded).toHaveLength(0);
  });

  test("a write that fails records nothing", async () => {
    updateMock.mockImplementation(() => {
      return Promise.reject(new Error("connection lost"));
    });

    await expect(
      TelemetryExceptionService.updateOneById({
        id: new ObjectID(A),
        data: { isResolved: true },
        props: { isRoot: true, userId: PRIYA },
      }),
    ).rejects.toThrow();

    expect(recorded).toHaveLength(0);
  });
});
