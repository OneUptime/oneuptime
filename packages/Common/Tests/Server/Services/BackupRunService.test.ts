import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import BackupRun from "../../../Models/DatabaseModels/BackupRun";
import EnterpriseFeature from "../../../Server/Enterprise/EnterpriseFeature";
import BackupRunService, {
  BACKUP_RUN_WRITE_REFUSED_MESSAGE,
} from "../../../Server/Services/BackupRunService";
import logger from "../../../Server/Utils/Logger";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupRunTrigger,
} from "../../../Types/Backup/BackupRunTypes";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import {
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

/*
 * Backup runs are OneUptime's record of what it did at the destination, so
 * only OneUptime writes them: a row written through the CRUD API would
 * claim a backup that does not exist, and one deleted there would leave its
 * files behind. Master admins read them; the Backups page's routes start,
 * cancel, restore and delete.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const RUN_ID: string = "7ba7b831-9dad-41d1-80b4-00c04fd43101";

const MASTER_ADMIN: DatabaseCommonInteractionProps = {
  ...ON_HIGHEST_PLAN,
  userId: ObjectID.generate(),
  userType: UserType.MasterAdmin,
  isMasterAdmin: true,
} as unknown as DatabaseCommonInteractionProps;

const SIGNED_IN_USER: DatabaseCommonInteractionProps = {
  ...ON_HIGHEST_PLAN,
  userId: ObjectID.generate(),
  userType: UserType.User,
} as unknown as DatabaseCommonInteractionProps;

function newRun(): BackupRun {
  const run: BackupRun = new BackupRun();
  run.kind = BackupRunKind.Backup;
  run.trigger = BackupRunTrigger.Manual;
  run.status = BackupRunStatus.Queued;
  run.includesPostgres = true;
  run.includesClickhouse = true;
  return run;
}

describe("BackupRunService", () => {
  let runs: InMemoryTable;

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    setTestBillingEnabled(false);
    installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.Backups]);

    runs = useInMemoryTable(BackupRunService, [
      {
        _id: RUN_ID,
        kind: BackupRunKind.Backup,
        trigger: BackupRunTrigger.Scheduled,
        status: BackupRunStatus.Succeeded,
        includesPostgres: true,
        includesClickhouse: true,
        name: "20261024T020000Z-7ba7b831",
        location:
          "s3://acme-backups/oneuptime/backups/20261024T020000Z-7ba7b831/",
        startedAt: new Date("2026-10-24T02:00:00.000Z"),
        finishedAt: new Date("2026-10-24T02:00:06.000Z"),
        postgresSizeInBytes: 4300000,
        clickhouseSizeInBytes: 2200000,
        version: 1,
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    uninstallEnterpriseModule();
  });

  test("OneUptime records a run", async () => {
    await BackupRunService.create({
      data: newRun(),
      props: { isRoot: true },
    });

    expect(runs.inserts).toHaveLength(1);
    expect(runs.inserts[0]!["status"]).toBe(BackupRunStatus.Queued);
  });

  test.each([
    ["a master admin", MASTER_ADMIN],
    ["a signed-in user", SIGNED_IN_USER],
  ])(
    "%s cannot write a run through the API",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      await expect(
        BackupRunService.create({ data: newRun(), props }),
      ).rejects.toThrow();
      await expect(
        BackupRunService.updateOneById({
          id: new ObjectID(RUN_ID),
          data: { status: BackupRunStatus.Failed },
          props,
        }),
      ).rejects.toThrow();
      await expect(
        BackupRunService.deleteOneById({ id: new ObjectID(RUN_ID), props }),
      ).rejects.toThrow();

      expect(runs.inserts).toHaveLength(0);
      expect(runs.updates).toHaveLength(0);
      expect(runs.deletes).toHaveLength(0);
    },
  );

  test("a master admin is told where backups are started and deleted", async () => {
    await expect(
      BackupRunService.deleteOneById({
        id: new ObjectID(RUN_ID),
        props: MASTER_ADMIN,
      }),
    ).rejects.toThrow(BACKUP_RUN_WRITE_REFUSED_MESSAGE);
  });

  test("a master admin reads the runs", async () => {
    const run: BackupRun | null = await BackupRunService.findOneById({
      id: new ObjectID(RUN_ID),
      select: {
        _id: true,
        status: true,
        location: true,
        postgresSizeInBytes: true,
      },
      props: MASTER_ADMIN,
    });

    expect(run?.status).toBe(BackupRunStatus.Succeeded);
    expect(run?.location).toBe(
      "s3://acme-backups/oneuptime/backups/20261024T020000Z-7ba7b831/",
    );
  });

  test("a signed-in user reads none", async () => {
    await expect(
      BackupRunService.findOneById({
        id: new ObjectID(RUN_ID),
        select: { _id: true, status: true },
        props: SIGNED_IN_USER,
      }),
    ).rejects.toThrow();
  });

  test("with the license lapsed, master admins still read every backup (restoring never needs a license)", async () => {
    installFakeEnterpriseModuleWithFeatures([]);

    const run: BackupRun | null = await BackupRunService.findOneById({
      id: new ObjectID(RUN_ID),
      select: { _id: true, status: true },
      props: MASTER_ADMIN,
    });

    expect(run?.status).toBe(BackupRunStatus.Succeeded);
  });
});
