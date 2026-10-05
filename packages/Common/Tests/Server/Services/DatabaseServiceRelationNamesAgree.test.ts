import DatabaseService from "../../../Server/Services/DatabaseService";
import RelationIdUtil from "../../../Server/Utils/Database/RelationIdUtil";
import RelationNames, {
  RelationName,
} from "../../../Server/Utils/Database/RelationNames";
import Entities from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A reference has two names a write can use - the relation (`monitor`, which
 * the dashboard's forms post) and its ID column (`monitorId`, which the API
 * reference, Terraform and server-side callers use). They are one database
 * column, and TypeORM stores the relation's id when a write carries both
 * (RelationNamePrecedence.test.ts), while a hook that checks the reference
 * may read the ID column. So every write made in a project - through the API,
 * a workflow or the admin dashboard - whose two names of one reference hold
 * different values is refused by DatabaseService before any hook reads it.
 *
 * This holds every reference of every model to that, on create and on
 * update, through the real DatabaseService write path. The write stops at
 * the first step after the check (a sentinel), so nothing reaches a hook or
 * the database.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-dddd-4aaa-8bbb-0000000000e1");
const ID_A: string = "0193c0de-dddd-4aaa-8bbb-0000000000a1";
const ID_B: string = "0193c0de-dddd-4aaa-8bbb-0000000000b2";

// A workflow writes as root, with its project's tenant: a write made in a project.
const WORKFLOW_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
  tenantId: PROJECT_ID,
};

// A job or an engine writes as root, with no project on the request.
const SERVER_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
};

// Someone signed in who owns the project.
const OWNER_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
  userGlobalAccessPermission: {
    projectIds: [PROJECT_ID],
    globalPermissions: [Permission.Public, Permission.User],
    _type: "UserGlobalAccessPermission",
  },
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      projectId: PROJECT_ID,
      permissions: [
        {
          permission: Permission.ProjectOwner,
          labelIds: [],
          isBlockPermission: false,
          _type: "UserPermission",
        },
      ],
      _type: "UserTenantAccessPermission",
    },
  },
};

// Thrown by the first step after the check: the write got past it.
class PastTheCheck extends Error {}

type ModelType = { new (): DatabaseBaseModel };

interface ReferenceCase {
  table: string;
  modelType: ModelType;
  relation: RelationName;
}

const CASES: Array<ReferenceCase> = (Entities as Array<ModelType>).flatMap(
  (modelType: ModelType): Array<ReferenceCase> => {
    const model: DatabaseBaseModel = new modelType();

    return RelationNames.getSingleRelations(model).map(
      (relation: RelationName): ReferenceCase => {
        return {
          table: model.tableName || modelType.name,
          modelType: modelType,
          relation: relation,
        };
      },
    );
  },
);

function serviceFor(modelType: ModelType): DatabaseService<DatabaseBaseModel> {
  const service: DatabaseService<DatabaseBaseModel> =
    new DatabaseService<DatabaseBaseModel>(modelType);

  // The step after the check, on each path: stop there.
  jest
    .spyOn(
      service as unknown as { _onBeforeCreate: () => Promise<unknown> },
      "_onBeforeCreate",
    )
    .mockRejectedValue(new PastTheCheck() as never);
  jest
    .spyOn(
      service as unknown as { keepRowsCallerMayWrite: () => Promise<unknown> },
      "keepRowsCallerMayWrite",
    )
    .mockRejectedValue(new PastTheCheck() as never);

  return service;
}

function payloadFor(
  modelType: ModelType,
  values: Record<string, unknown>,
): DatabaseBaseModel {
  const data: DatabaseBaseModel = new modelType();

  for (const [key, value] of Object.entries(values)) {
    (data as unknown as Record<string, unknown>)[key] = value;
  }

  return data;
}

async function outcomeOf(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
    return "written";
  } catch (error) {
    return error;
  }
}

function createWith(
  reference: ReferenceCase,
  values: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<unknown> {
  return outcomeOf(
    serviceFor(reference.modelType).create({
      data: payloadFor(reference.modelType, values),
      props: props,
    }),
  );
}

function updateWith(
  reference: ReferenceCase,
  values: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<unknown> {
  return outcomeOf(
    serviceFor(reference.modelType).updateBy({
      query: { _id: ID_A },
      data: values as never,
      limit: 1,
      skip: 0,
      props: props,
    }),
  );
}

type Write = (
  reference: ReferenceCase,
  values: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
) => Promise<unknown>;

const WRITES: Array<[string, Write]> = [
  ["create", createWith],
  ["update", updateWith],
];

function conflictMessage(reference: ReferenceCase): string {
  return RelationIdUtil.getConflictMessage(reference.relation.title, [
    reference.relation.idColumn,
    reference.relation.relation,
  ]);
}

function describeOutcome(outcome: unknown): string {
  return outcome instanceof Error
    ? `${outcome.constructor.name}: ${outcome.message}`
    : String(outcome);
}

afterEach(() => {
  jest.restoreAllMocks();
});

test("the sweep sees the references of every model", () => {
  expect(CASES.length).toBeGreaterThan(1000);
  expect(
    CASES.some((reference: ReferenceCase): boolean => {
      return (
        reference.table === "Incident" &&
        reference.relation.relation === "changeMonitorStatusTo"
      );
    }),
  ).toBe(true);
});

describe.each(WRITES)("%s", (_name: string, write: Write) => {
  test("two names naming different records are refused, with a message naming both fields, before any hook", async () => {
    const wrong: Array<string> = [];

    for (const reference of CASES) {
      const outcome: unknown = await write(
        reference,
        {
          [reference.relation.idColumn]: new ObjectID(ID_A),
          [reference.relation.relation]: { _id: ID_B },
        },
        WORKFLOW_PROPS,
      );

      if (
        !(outcome instanceof Error) ||
        outcome.message !== conflictMessage(reference)
      ) {
        wrong.push(
          `${reference.table}.${reference.relation.relation}: ${describeOutcome(outcome)}`,
        );
      }
    }

    expect(wrong).toEqual([]);
  });

  test("a record under one name and a clear under the other are refused", async () => {
    const wrong: Array<string> = [];

    for (const reference of CASES) {
      const outcome: unknown = await write(
        reference,
        {
          [reference.relation.idColumn]: null,
          [reference.relation.relation]: { _id: ID_B },
        },
        WORKFLOW_PROPS,
      );

      if (
        !(outcome instanceof Error) ||
        outcome.message !== conflictMessage(reference)
      ) {
        wrong.push(
          `${reference.table}.${reference.relation.relation}: ${describeOutcome(outcome)}`,
        );
      }
    }

    expect(wrong).toEqual([]);
  });

  test("the same record under both names, in any case, goes on to the hooks", async () => {
    const wrong: Array<string> = [];

    for (const reference of CASES) {
      const outcome: unknown = await write(
        reference,
        {
          [reference.relation.idColumn]: new ObjectID(ID_A.toUpperCase()),
          [reference.relation.relation]: { _id: ID_A },
        },
        WORKFLOW_PROPS,
      );

      if (!(outcome instanceof PastTheCheck)) {
        wrong.push(
          `${reference.table}.${reference.relation.relation}: ${describeOutcome(outcome)}`,
        );
      }
    }

    expect(wrong).toEqual([]);
  });

  test("a reference under one name alone goes on to the hooks", async () => {
    const wrong: Array<string> = [];

    for (const reference of CASES) {
      for (const values of [
        { [reference.relation.idColumn]: new ObjectID(ID_A) },
        { [reference.relation.relation]: { _id: ID_B } },
      ]) {
        const outcome: unknown = await write(reference, values, WORKFLOW_PROPS);

        if (!(outcome instanceof PastTheCheck)) {
          wrong.push(
            `${reference.table}.${reference.relation.relation}: ${describeOutcome(outcome)}`,
          );
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  test("OneUptime's own writes are left to the services that check their references", async () => {
    const wrong: Array<string> = [];

    for (const reference of CASES) {
      const outcome: unknown = await write(
        reference,
        {
          [reference.relation.idColumn]: new ObjectID(ID_A),
          [reference.relation.relation]: { _id: ID_B },
        },
        SERVER_PROPS,
      );

      if (!(outcome instanceof PastTheCheck)) {
        wrong.push(
          `${reference.table}.${reference.relation.relation}: ${describeOutcome(outcome)}`,
        );
      }
    }

    expect(wrong).toEqual([]);
  });
});

describe("a person's request", () => {
  const changeMonitorStatus: ReferenceCase = CASES.find(
    (reference: ReferenceCase): boolean => {
      return (
        reference.table === "Incident" &&
        reference.relation.relation === "changeMonitorStatusTo"
      );
    },
  )!;

  test.each(WRITES)(
    "%s: two names that disagree are refused, by the same words",
    async (_name: string, write: Write) => {
      const outcome: unknown = await write(
        changeMonitorStatus,
        {
          changeMonitorStatusToId: new ObjectID(ID_A),
          changeMonitorStatusTo: { _id: ID_B },
        },
        OWNER_PROPS,
      );

      expect(describeOutcome(outcome)).toBe(
        `BadDataException: ${conflictMessage(changeMonitorStatus)}`,
      );
    },
  );

  test.each(WRITES)(
    "%s: a master admin's write is held to it too",
    async (_name: string, write: Write) => {
      const outcome: unknown = await write(
        changeMonitorStatus,
        {
          changeMonitorStatusToId: new ObjectID(ID_A),
          changeMonitorStatusTo: { _id: ID_B },
        },
        { isMasterAdmin: true, userId: USER_ID },
      );

      expect(describeOutcome(outcome)).toBe(
        `BadDataException: ${conflictMessage(changeMonitorStatus)}`,
      );
    },
  );
});

describe("who created a record is the person making the request", () => {
  function capturedCreate(): {
    service: DatabaseService<DatabaseBaseModel>;
    reached: () => Record<string, unknown> | undefined;
  } {
    const service: DatabaseService<DatabaseBaseModel> =
      new DatabaseService<DatabaseBaseModel>(Incident as unknown as ModelType);
    let reached: Record<string, unknown> | undefined = undefined;

    jest
      .spyOn(
        service as unknown as {
          _onBeforeCreate: (createBy: {
            data: Record<string, unknown>;
          }) => Promise<unknown>;
        },
        "_onBeforeCreate",
      )
      .mockImplementation(
        async (createBy: { data: Record<string, unknown> }) => {
          reached = { ...createBy.data };
          throw new PastTheCheck();
        },
      );

    return {
      service: service,
      reached: (): Record<string, unknown> | undefined => {
        return reached;
      },
    };
  }

  test("a createdByUser relation is dropped before the hooks when the requester is stamped as the creator", async () => {
    const { service, reached } = capturedCreate();

    const outcome: unknown = await outcomeOf(
      service.create({
        data: payloadFor(Incident as unknown as ModelType, {
          title: "Payments are down",
          createdByUser: { _id: ID_B },
        }),
        props: OWNER_PROPS,
      }),
    );

    expect(outcome).toBeInstanceOf(PastTheCheck);
    expect(reached()?.["createdByUser"]).toBeUndefined();
    expect(reached()?.["title"]).toBe("Payments are down");
  });

  test("with no person on the request, the creator the write names stays", async () => {
    const { service, reached } = capturedCreate();

    await outcomeOf(
      service.create({
        data: payloadFor(Incident as unknown as ModelType, {
          createdByUser: { _id: ID_B },
        }),
        props: WORKFLOW_PROPS,
      }),
    );

    expect(reached()?.["createdByUser"]).toEqual({ _id: ID_B });
  });
});
