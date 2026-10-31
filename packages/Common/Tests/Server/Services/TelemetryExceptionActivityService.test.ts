import TelemetryExceptionActivityService, {
  MAX_EXCEPTIONS_READ_AT_ONCE,
  Service as TelemetryExceptionActivityServiceClass,
} from "../../../Server/Services/TelemetryExceptionActivityService";
import TelemetryExceptionService from "../../../Server/Services/TelemetryExceptionService";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import TelemetryExceptionActivity, {
  TelemetryExceptionActivityType,
} from "../../../Models/DatabaseModels/TelemetryExceptionActivity";
import FindBy from "../../../Server/Types/Database/FindBy";
import { OnFind } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import Includes from "../../../Types/BaseDatabase/Includes";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * AN EXCEPTION'S ACTIVITY: WRITTEN BY ONEUPTIME, READ AS THE EXCEPTION IS.
 *
 * record() writes the entries the hooks hand it as OneUptime, crediting the
 * person or the API key, and never fails the change it records. A read
 * names the exceptions whose activity it wants and is kept to those the
 * caller may read - asked of TelemetryExceptionService as the caller, so the
 * scope every read of exceptions follows decides it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const A: string = "30000000-0000-4000-8000-00000000000a";
const B: string = "30000000-0000-4000-8000-00000000000b";
const ENTRY: string = "40000000-0000-4000-8000-000000000001";
const PRIYA: ObjectID = new ObjectID("90000000-0000-4000-8000-000000000001");
const NO_EXCEPTION_ID: string = "00000000-0000-0000-0000-000000000000";

const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: PRIYA,
};

// The ids a QueryHelper.any condition holds.
function idsOf(condition: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    (condition as FindOperator<unknown>).objectLiteralParameters || {};

  return ((Object.values(parameters)[0] as Array<unknown>) || []).map(
    (id: unknown): string => {
      return String(id);
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who an entry credits", () => {
  test("the person, when a person made the change", () => {
    expect(TelemetryExceptionActivityService.getActor(CALLER)).toEqual({
      userId: PRIYA,
    });
  });

  test("the project API key, by its name - or 'API key' when it has none", () => {
    expect(
      TelemetryExceptionActivityService.getActor({
        tenantId: PROJECT_ID,
        apiKeyId: ObjectID.generate(),
        apiKeyName: "  Deploy pipeline ",
      }),
    ).toEqual({ apiKeyName: "Deploy pipeline" });

    expect(
      TelemetryExceptionActivityService.getActor({
        tenantId: PROJECT_ID,
        apiKeyId: ObjectID.generate(),
      }),
    ).toEqual({ apiKeyName: "API key" });
  });

  test("nobody - OneUptime itself - otherwise", () => {
    expect(
      TelemetryExceptionActivityService.getActor({ isRoot: true }),
    ).toEqual({});
    expect(TelemetryExceptionActivityService.getActor(undefined)).toEqual({});
  });
});

describe("writing entries", () => {
  let created: Array<TelemetryExceptionActivity>;

  beforeEach(() => {
    created = [];
    jest
      .spyOn(TelemetryExceptionActivityService, "create")
      .mockImplementation((async (data: {
        data: TelemetryExceptionActivity;
        props: DatabaseCommonInteractionProps;
      }) => {
        expect(data.props).toEqual({ isRoot: true });
        created.push(data.data);
        return data.data;
      }) as never);
  });

  test("each entry as OneUptime, with what it names", async () => {
    const written: number = await TelemetryExceptionActivityService.record({
      entries: [
        {
          projectId: PROJECT_ID,
          telemetryExceptionId: new ObjectID(A),
          activityType: TelemetryExceptionActivityType.Assigned,
          assigneeUserId: PRIYA.toString(),
          assigneeTeamId: null,
        },
        {
          projectId: PROJECT_ID,
          telemetryExceptionId: new ObjectID(A),
          activityType: TelemetryExceptionActivityType.Merged,
          relatedTelemetryExceptionId: B,
        },
        {
          projectId: PROJECT_ID,
          telemetryExceptionId: new ObjectID(A),
          activityType: TelemetryExceptionActivityType.ResolvedInNextRelease,
          release: " v1.4.0 ",
        },
      ],
      actor: { userId: PRIYA },
    });

    expect(written).toBe(3);
    expect(
      created.map((entry: TelemetryExceptionActivity) => {
        return {
          projectId: entry.projectId?.toString(),
          telemetryExceptionId: entry.telemetryExceptionId?.toString(),
          activityType: entry.activityType,
          userId: entry.userId?.toString(),
          assigneeUserId: entry.assigneeUserId?.toString(),
          assigneeTeamId: entry.assigneeTeamId?.toString(),
          relatedTelemetryExceptionId:
            entry.relatedTelemetryExceptionId?.toString(),
          release: entry.release,
        };
      }),
    ).toEqual([
      {
        projectId: PROJECT_ID.toString(),
        telemetryExceptionId: A,
        activityType: TelemetryExceptionActivityType.Assigned,
        userId: PRIYA.toString(),
        assigneeUserId: PRIYA.toString(),
        assigneeTeamId: undefined,
        relatedTelemetryExceptionId: undefined,
        release: undefined,
      },
      {
        projectId: PROJECT_ID.toString(),
        telemetryExceptionId: A,
        activityType: TelemetryExceptionActivityType.Merged,
        userId: PRIYA.toString(),
        assigneeUserId: undefined,
        assigneeTeamId: undefined,
        relatedTelemetryExceptionId: B,
        release: undefined,
      },
      {
        projectId: PROJECT_ID.toString(),
        telemetryExceptionId: A,
        activityType: TelemetryExceptionActivityType.ResolvedInNextRelease,
        userId: PRIYA.toString(),
        assigneeUserId: undefined,
        assigneeTeamId: undefined,
        relatedTelemetryExceptionId: undefined,
        release: "v1.4.0",
      },
    ]);
  });

  test("an API key's entry names the key; OneUptime's names nobody", async () => {
    await TelemetryExceptionActivityService.record({
      entries: [
        {
          projectId: PROJECT_ID,
          telemetryExceptionId: new ObjectID(A),
          activityType: TelemetryExceptionActivityType.Archived,
        },
      ],
      actor: { apiKeyName: "Deploy pipeline" },
    });

    await TelemetryExceptionActivityService.record({
      entries: [
        {
          projectId: PROJECT_ID,
          telemetryExceptionId: new ObjectID(A),
          activityType: TelemetryExceptionActivityType.Regressed,
        },
      ],
      actor: {},
    });

    expect([created[0]!.userId, created[0]!.apiKeyName]).toEqual([
      undefined,
      "Deploy pipeline",
    ]);
    expect([created[1]!.userId, created[1]!.apiKeyName]).toEqual([
      undefined,
      undefined,
    ]);
  });

  test("an Assigned entry starts untold, for the Workers to tell; every other entry has no one to tell", async () => {
    await TelemetryExceptionActivityService.record({
      entries: Object.values(TelemetryExceptionActivityType).map(
        (activityType: TelemetryExceptionActivityType) => {
          return {
            projectId: PROJECT_ID,
            telemetryExceptionId: new ObjectID(A),
            activityType,
          };
        },
      ),
      actor: { userId: PRIYA },
    });

    expect(
      created
        .filter((entry: TelemetryExceptionActivity): boolean => {
          return entry.isAssigneeNotified === false;
        })
        .map((entry: TelemetryExceptionActivity) => {
          return entry.activityType;
        }),
    ).toEqual([TelemetryExceptionActivityType.Assigned]);
    expect(created).toHaveLength(
      Object.values(TelemetryExceptionActivityType).length,
    );
  });

  test("an id that is no id is left out rather than written", async () => {
    await TelemetryExceptionActivityService.record({
      entries: [
        {
          projectId: PROJECT_ID,
          telemetryExceptionId: new ObjectID(A),
          activityType: TelemetryExceptionActivityType.Assigned,
          assigneeUserId: "not-an-id",
        },
      ],
      actor: {},
    });

    expect(created[0]!.assigneeUserId).toBeUndefined();
  });

  test("never throws: an entry that cannot be written is logged, and the others are still written", async () => {
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });

    let calls: number = 0;
    (
      TelemetryExceptionActivityService.create as unknown as jest.Mock
    ).mockImplementation(async (data: { data: TelemetryExceptionActivity }) => {
      calls++;
      if (calls === 1) {
        throw new Error("connection lost");
      }
      created.push(data.data);
      return data.data;
    });

    const written: number = await TelemetryExceptionActivityService.record({
      entries: [
        {
          projectId: PROJECT_ID,
          telemetryExceptionId: new ObjectID(A),
          activityType: TelemetryExceptionActivityType.Resolved,
        },
        {
          projectId: PROJECT_ID,
          telemetryExceptionId: new ObjectID(B),
          activityType: TelemetryExceptionActivityType.Resolved,
        },
      ],
      actor: {},
    });

    expect(written).toBe(1);
    expect(created[0]!.telemetryExceptionId?.toString()).toBe(B);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("reading an exception's activity", () => {
  let readableIds: Array<string> | "refuse";
  let readsAs: Array<DatabaseCommonInteractionProps>;

  beforeEach(() => {
    readableIds = [A];
    readsAs = [];

    jest.spyOn(TelemetryExceptionService, "findBy").mockImplementation((async (
      findBy: FindBy<TelemetryException>,
    ) => {
      readsAs.push(findBy.props);

      if (readableIds === "refuse") {
        throw new NotAuthorizedException(
          "You do not have permission to read Exceptions.",
        );
      }

      const asked: Array<string> = idsOf(
        (findBy.query as Record<string, unknown>)["_id"],
      );

      return (readableIds as Array<string>)
        .filter((id: string): boolean => {
          return asked.includes(id);
        })
        .map((id: string): TelemetryException => {
          const model: TelemetryException = new TelemetryException();
          model._id = id;
          return model;
        });
    }) as never);
  });

  async function keep(
    query: Record<string, unknown>,
    props: DatabaseCommonInteractionProps = CALLER,
  ): Promise<Record<string, unknown>> {
    return TelemetryExceptionActivityService.keepToReadableExceptions(
      query,
      props,
    );
  }

  test("an exception the caller may read: its activity, asked of the exceptions as the caller", async () => {
    expect(await keep({ telemetryExceptionId: new ObjectID(A) })).toEqual({
      telemetryExceptionId: A,
    });
    expect(readsAs).toEqual([CALLER]);
  });

  test("an exception the caller may not read - another resource's, another project's: nothing", async () => {
    readableIds = [];

    const query: Record<string, unknown> = await keep({
      telemetryExceptionId: B,
    });

    expect(idsOf(query["telemetryExceptionId"])).toEqual([NO_EXCEPTION_ID]);
  });

  test("a list: kept to the ones the caller may read", async () => {
    readableIds = [A];

    const query: Record<string, unknown> = await keep({
      telemetryExceptionId: new Includes([A, B]),
    });

    expect(query["telemetryExceptionId"]).toBe(A);
  });

  test("a caller who may not read exceptions at all is refused", async () => {
    readableIds = "refuse";

    await expect(keep({ telemetryExceptionId: A })).rejects.toThrow(
      NotAuthorizedException,
    );
  });

  test("a read that names no exception is refused, so nothing is read across the project unasked", async () => {
    await expect(keep({})).rejects.toThrow(BadDataException);
    await expect(keep({ activityType: "Resolved" })).rejects.toThrow(
      BadDataException,
    );
    await expect(
      keep({ telemetryExceptionId: { $ne: A } as unknown }),
    ).rejects.toThrow(BadDataException);
    expect(readsAs).toHaveLength(0);
  });

  test(`at most ${MAX_EXCEPTIONS_READ_AT_ONCE} exceptions at once`, async () => {
    const ids: Array<string> = [];

    for (let index: number = 0; index <= MAX_EXCEPTIONS_READ_AT_ONCE; index++) {
      ids.push(ObjectID.generate().toString());
    }

    await expect(keep({ telemetryExceptionId: ids })).rejects.toThrow(
      BadDataException,
    );
  });

  test("one entry by its id: read as the exception it is on", async () => {
    jest
      .spyOn(TelemetryExceptionActivityService, "findOneBy")
      .mockImplementation((async () => {
        const entry: TelemetryExceptionActivity =
          new TelemetryExceptionActivity();
        entry.telemetryExceptionId = new ObjectID(B);
        return entry;
      }) as never);

    readableIds = [];
    const refused: Record<string, unknown> = await keep({ _id: ENTRY });
    expect(idsOf(refused["telemetryExceptionId"])).toEqual([NO_EXCEPTION_ID]);

    readableIds = [B];
    expect((await keep({ _id: ENTRY }))["telemetryExceptionId"]).toBe(B);
  });

  test("root and master admins read as asked", async () => {
    expect(await keep({}, { isRoot: true })).toEqual({});
    expect(
      await keep({ activityType: "Resolved" }, { isMasterAdmin: true }),
    ).toEqual({ activityType: "Resolved" });
    expect(readsAs).toHaveLength(0);
  });

  test("the caller's own query object is left as it was", async () => {
    const query: Record<string, unknown> = {
      telemetryExceptionId: new Includes([A, B]),
    };

    await keep(query);

    expect(query["telemetryExceptionId"]).toBeInstanceOf(Includes);
  });

  test("every find and every count goes through it", async () => {
    type BeforeFind = (
      findBy: FindBy<TelemetryExceptionActivity>,
    ) => Promise<OnFind<TelemetryExceptionActivity>>;

    const onBeforeFind: BeforeFind = (
      TelemetryExceptionActivityService as unknown as {
        onBeforeFind: BeforeFind;
      }
    ).onBeforeFind.bind(TelemetryExceptionActivityService);

    const found: OnFind<TelemetryExceptionActivity> = await onBeforeFind({
      query: { telemetryExceptionId: A },
      props: CALLER,
      limit: 10,
      skip: 0,
    } as unknown as FindBy<TelemetryExceptionActivity>);

    expect(found.findBy.query).toEqual({ telemetryExceptionId: A });

    await expect(
      TelemetryExceptionActivityService.countBy({
        query: {},
        props: CALLER,
      }),
    ).rejects.toThrow(BadDataException);
  });

  test("names: an id, an ObjectID, a list, an Includes; anything else is not a name", () => {
    expect(TelemetryExceptionActivityServiceClass.readNamedIds(A)).toEqual([A]);
    expect(
      TelemetryExceptionActivityServiceClass.readNamedIds(new ObjectID(A)),
    ).toEqual([A]);
    expect(
      TelemetryExceptionActivityServiceClass.readNamedIds([A, A.toUpperCase()]),
    ).toEqual([A]);
    expect(
      TelemetryExceptionActivityServiceClass.readNamedIds(new Includes([A, B])),
    ).toEqual([A, B]);
    expect(TelemetryExceptionActivityServiceClass.readNamedIds(undefined)).toBe(
      null,
    );
    expect(TelemetryExceptionActivityServiceClass.readNamedIds("nope")).toBe(
      null,
    );
    expect(TelemetryExceptionActivityServiceClass.readNamedIds([])).toBe(null);
  });
});

describe("the model", () => {
  test("nobody writes, edits or deletes an entry through the API; exception readers read them", () => {
    const model: TelemetryExceptionActivity = new TelemetryExceptionActivity();

    expect(model.createRecordPermissions).toEqual([]);
    expect(model.updateRecordPermissions).toEqual([]);
    expect(model.deleteRecordPermissions).toEqual([]);
    expect(model.readRecordPermissions).toEqual(
      new TelemetryException().readRecordPermissions,
    );
    expect(model.readRecordPermissions).toContain(
      Permission.ReadTelemetryException,
    );
  });

  test("every column is closed to every write", () => {
    const model: TelemetryExceptionActivity = new TelemetryExceptionActivity();

    for (const column of model.getTableColumns().columns) {
      const access: { create?: Array<Permission>; update?: Array<Permission> } =
        model.getColumnAccessControlFor(column) || {};

      expect({ column, create: access.create || [] }).toEqual({
        column,
        create: [],
      });
      expect({ column, update: access.update || [] }).toEqual({
        column,
        update: [],
      });
    }
  });
});
