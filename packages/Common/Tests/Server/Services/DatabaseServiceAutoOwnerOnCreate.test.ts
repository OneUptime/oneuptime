import MonitorOwnerUserService from "../../../Server/Services/MonitorOwnerUserService";
import MonitorService from "../../../Server/Services/MonitorService";
import PostgresErrorTranslator from "../../../Server/Utils/Database/PostgresErrorTranslator";
import logger from "../../../Server/Utils/Logger";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * DatabaseService.autoOwnerOnCreate makes whoever creates an operational
 * resource one of its owners. Two things about it matter for issue #3394:
 *
 *   - The monitor (or incident, alert...) create form can list the creator as
 *     an owner as well, and that path may insert the row first. Owner rows are
 *     unique now, so the second insert is refused. The creator is an owner
 *     either way, so that refusal is not an error worth logging.
 *
 *   - It used to build the row on getModel(), the owner service's one shared
 *     model instance. A save writes the generated _id back onto the object it
 *     was given, so the next auto-owner insert - for a different resource,
 *     by a different user - carried the previous row's _id, and TypeORM's
 *     save() turns an entity with an existing _id into an UPDATE of that row.
 *     The earlier creator would silently stop owning their resource.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0000000a-0000-4000-8000-000000000001",
);
const MONITOR_A: ObjectID = new ObjectID(
  "0000000c-0000-4000-8000-00000000000a",
);
const MONITOR_B: ObjectID = new ObjectID(
  "0000000c-0000-4000-8000-00000000000b",
);
const USER_A: ObjectID = new ObjectID("0000000e-0000-4000-8000-00000000000a");
const USER_B: ObjectID = new ObjectID("0000000e-0000-4000-8000-00000000000b");

function monitor(id: ObjectID, projectId?: ObjectID): Monitor {
  const item: Monitor = new Monitor(id);

  if (projectId) {
    item.projectId = projectId;
  }

  return item;
}

function autoOwn(
  createdItem: Monitor,
  props: DatabaseCommonInteractionProps,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (MonitorService as any).autoOwnerOnCreate(createdItem, props);
}

let create: jest.SpyInstance;
let written: Array<MonitorOwnerUser>;
let createError: unknown;

beforeEach(() => {
  written = [];
  createError = undefined;

  create = jest
    .spyOn(MonitorOwnerUserService, "create")
    .mockImplementation((async (args: { data: MonitorOwnerUser }) => {
      if (createError) {
        throw createError;
      }

      // What TypeORM's save() does to the entity it is handed.
      args.data._id = ObjectID.generate().toString();
      written.push(args.data);
      return args.data;
    }) as never);

  jest.spyOn(logger, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DatabaseService.autoOwnerOnCreate", () => {
  test("makes the creating user an owner of the new monitor", async () => {
    await autoOwn(monitor(MONITOR_A, PROJECT_ID), {
      userId: USER_A,
      tenantId: PROJECT_ID,
    });

    expect(written).toHaveLength(1);
    expect(written[0]).toBeInstanceOf(MonitorOwnerUser);
    expect(written[0]!.monitorId!.toString()).toBe(MONITOR_A.toString());
    expect(written[0]!.userId!.toString()).toBe(USER_A.toString());
    expect(written[0]!.projectId!.toString()).toBe(PROJECT_ID.toString());
    expect(create.mock.calls[0]![0]).toMatchObject({
      props: { isRoot: true },
    });
  });

  test("falls back to the request's tenant when the item carries no project", async () => {
    await autoOwn(monitor(MONITOR_A), {
      userId: USER_A,
      tenantId: PROJECT_ID,
    });

    expect(written[0]!.projectId!.toString()).toBe(PROJECT_ID.toString());
  });

  test.each([
    ["a root write", { isRoot: true, userId: USER_A }],
    ["a master admin write", { isMasterAdmin: true, userId: USER_A }],
    ["a write with no user (API key, probe)", { tenantId: PROJECT_ID }],
  ])(
    "adds nobody for %s",
    async (_label: string, props: DatabaseCommonInteractionProps) => {
      await autoOwn(monitor(MONITOR_A, PROJECT_ID), props);

      expect(create).not.toHaveBeenCalled();
    },
  );

  describe("the owner row it writes", () => {
    test("is never the owner service's shared model instance", async () => {
      await autoOwn(monitor(MONITOR_A, PROJECT_ID), {
        userId: USER_A,
        tenantId: PROJECT_ID,
      });

      expect(written[0]).not.toBe(MonitorOwnerUserService.getModel());
    });

    test("is a new row for every resource, so an earlier owner is never overwritten", async () => {
      await autoOwn(monitor(MONITOR_A, PROJECT_ID), {
        userId: USER_A,
        tenantId: PROJECT_ID,
      });
      const firstRow: MonitorOwnerUser = written[0]!;
      const firstRowId: string = firstRow._id!;

      await autoOwn(monitor(MONITOR_B, PROJECT_ID), {
        userId: USER_B,
        tenantId: PROJECT_ID,
      });
      const secondRow: MonitorOwnerUser = written[1]!;

      expect(secondRow).not.toBe(firstRow);

      /*
       * The second insert was handed a row with no _id of its own - an _id
       * here is what would make save() update the first row instead.
       */
      const secondRowAsHanded: MonitorOwnerUser = create.mock.calls[1]![0]
        .data as MonitorOwnerUser;
      expect(secondRowAsHanded).toBe(secondRow);
      expect(secondRow._id).not.toBe(firstRowId);

      // And the first row still records the first creator and monitor.
      expect(firstRow._id).toBe(firstRowId);
      expect(firstRow.monitorId!.toString()).toBe(MONITOR_A.toString());
      expect(firstRow.userId!.toString()).toBe(USER_A.toString());
    });

    test("leaves the shared model instance untouched", async () => {
      await autoOwn(monitor(MONITOR_A, PROJECT_ID), {
        userId: USER_A,
        tenantId: PROJECT_ID,
      });

      const shared: MonitorOwnerUser = MonitorOwnerUserService.getModel();

      expect(shared._id).toBeFalsy();
      expect(shared.monitorId).toBeFalsy();
      expect(shared.userId).toBeFalsy();
    });

    test("starts without an _id, so the insert is an insert", async () => {
      const idsAsHanded: Array<string | undefined> = [];

      create.mockImplementation((async (args: { data: MonitorOwnerUser }) => {
        idsAsHanded.push(args.data._id);
        args.data._id = ObjectID.generate().toString();
        return args.data;
      }) as never);

      await autoOwn(monitor(MONITOR_A, PROJECT_ID), {
        userId: USER_A,
        tenantId: PROJECT_ID,
      });
      await autoOwn(monitor(MONITOR_B, PROJECT_ID), {
        userId: USER_B,
        tenantId: PROJECT_ID,
      });

      expect(idsAsHanded).toHaveLength(2);
      expect(idsAsHanded[0]).toBeFalsy();
      expect(idsAsHanded[1]).toBeFalsy();
    });
  });

  describe("when the creator is already an owner", () => {
    test("says nothing when the owner service's check refuses the duplicate", async () => {
      createError = PostgresErrorTranslator.createUniqueViolationException(
        "This user is already an owner of this monitor.",
      );

      await expect(
        autoOwn(monitor(MONITOR_A, PROJECT_ID), {
          userId: USER_A,
          tenantId: PROJECT_ID,
        }),
      ).resolves.toBeUndefined();

      expect(logger.error).not.toHaveBeenCalled();
    });

    test("says nothing when the unique index refuses a racing insert", async () => {
      createError = PostgresErrorTranslator.translate({
        code: "23505",
        table: "MonitorOwnerUser",
        detail:
          'Key ("monitorId", "userId", "projectId")=(c, e, a) already exists.',
      });

      await expect(
        autoOwn(monitor(MONITOR_A, PROJECT_ID), {
          userId: USER_A,
          tenantId: PROJECT_ID,
        }),
      ).resolves.toBeUndefined();

      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  test("still logs, without failing the create, when the insert fails for another reason", async () => {
    createError = new Error("connection reset");

    await expect(
      autoOwn(monitor(MONITOR_A, PROJECT_ID), {
        userId: USER_A,
        tenantId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalled();
  });
});
