import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService, {
  ROOT_ONLY_BACKUP_SCRIPT_COLUMNS,
} from "../../../Server/Services/GlobalConfigService";
import BackupScriptRuns from "../../../Server/Utils/ServerSetup/BackupScriptRuns";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import TableColumnType from "../../../Types/Database/TableColumnType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE LAST RUN OF `npm run backup`, AS GLOBALCONFIG KEEPS IT (#7026).
 *
 * backupScriptLastRun says when the backup script last told the server it
 * ran and whether it succeeded, and the setup checklist reads it as the
 * server's backups. Only the script may say so, with the server's cluster
 * key (POST /api/admin/health/backup-run): master admins bypass the (empty)
 * column ACLs, so through the CRUD API a session - or one stolen from them -
 * could otherwise mark a server as backed up last night. Its write is
 * bookkeeping: one statement, no hooks, the row's updatedAt left as it was.
 */

type GlobalConfigServiceWithHooks = {
  onBeforeCreate(
    createBy: CreateBy<GlobalConfig>,
  ): Promise<OnCreate<GlobalConfig>>;
  onBeforeUpdate(
    updateBy: UpdateBy<GlobalConfig>,
  ): Promise<OnUpdate<GlobalConfig>>;
};

const hooks: GlobalConfigServiceWithHooks =
  GlobalConfigService as unknown as GlobalConfigServiceWithHooks;

const MASTER_ADMIN_PROPS: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  isMasterAdmin: true,
} as DatabaseCommonInteractionProps;

const PROJECT_MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  tenantId: ObjectID.generate(),
} as DatabaseCommonInteractionProps;

const ROOT_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
} as DatabaseCommonInteractionProps;

const RUN: Record<string, unknown> = {
  at: "2026-11-17T02:00:00.000Z",
  succeeded: true,
  sizeInBytes: 4096,
};

const makeUpdateBy: (
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
) => UpdateBy<GlobalConfig> = (
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): UpdateBy<GlobalConfig> => {
  return {
    query: { _id: ObjectID.getZeroObjectID().toString() },
    data,
    limit: 1,
    skip: 0,
    props,
  } as unknown as UpdateBy<GlobalConfig>;
};

let updateColumns: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  updateColumns = jest
    .spyOn(GlobalConfigService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(GlobalConfigService, "findOneById")
    .mockResolvedValue(new GlobalConfig());
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who may say the server was backed up", () => {
  test("only backupScriptLastRun, a JSON column nobody may read or write through the API", () => {
    const model: GlobalConfig = new GlobalConfig();

    expect([...ROOT_ONLY_BACKUP_SCRIPT_COLUMNS]).toEqual([
      "backupScriptLastRun",
    ]);
    expect(model.isTableColumn("backupScriptLastRun")).toBe(true);
    expect(model.getTableColumnMetadata("backupScriptLastRun").type).toBe(
      TableColumnType.JSON,
    );
    expect(model.getColumnAccessControlFor("backupScriptLastRun")).toEqual({
      create: [],
      read: [],
      update: [],
    });
  });

  test.each([[{}], [null], [RUN]])(
    "a master admin writing %j through the CRUD API is refused",
    async (value: unknown) => {
      await expect(
        hooks.onBeforeUpdate(
          makeUpdateBy({ backupScriptLastRun: value }, MASTER_ADMIN_PROPS),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );

  test("a project's member is refused", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy({ backupScriptLastRun: RUN }, PROJECT_MEMBER_PROPS),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("hidden among ordinary settings, it is refused too", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy(
          { disableSignup: true, backupScriptLastRun: RUN },
          MASTER_ADMIN_PROPS,
        ),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("on create too", async () => {
    const model: GlobalConfig = new GlobalConfig();
    model.id = ObjectID.getZeroObjectID();
    model.backupScriptLastRun = RUN as never;

    await expect(
      hooks.onBeforeCreate({
        data: model,
        props: MASTER_ADMIN_PROPS,
      } as unknown as CreateBy<GlobalConfig>),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("a master admin's ordinary save, without it, goes on; OneUptime itself may write it", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy({ disableSignup: true }, MASTER_ADMIN_PROPS),
      ),
    ).resolves.toBeDefined();
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy({ backupScriptLastRun: RUN }, ROOT_PROPS),
      ),
    ).resolves.toBeDefined();
  });
});

describe("writing the last run", () => {
  test("one statement on the one row, no hooks, updatedAt kept", async () => {
    await GlobalConfigService.writeBackupScriptLastRun(RUN as never);

    expect(updateColumns).toHaveBeenCalledTimes(1);

    const args: Record<string, any> = updateColumns.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(args["id"].toString()).toBe(ObjectID.getZeroObjectID().toString());
    expect(args["skipUpdateDateColumn"]).toBe(true);
    expect(args["data"]).toEqual({ backupScriptLastRun: RUN });
  });

  test("a check-in is kept with the server's own time, what it said, and nothing else", async () => {
    const now: Date = new Date("2026-11-17T02:03:04.000Z");

    const run: unknown = await BackupScriptRuns.record({
      checkIn: { succeeded: true, sizeInBytes: 123 },
      now: now,
    });

    expect(run).toEqual({
      at: now.toISOString(),
      succeeded: true,
      sizeInBytes: 123,
    });
    expect(
      (updateColumns.mock.calls[0]![0] as Record<string, any>)["data"],
    ).toEqual({
      backupScriptLastRun: {
        at: now.toISOString(),
        succeeded: true,
        sizeInBytes: 123,
      },
    });
  });
});
