import CommonAPI from "Common/Server/API/CommonAPI";
import { DisableQueueWorkers } from "Common/Server/EnvironmentConfig";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import BackupRunService from "Common/Server/Services/BackupRunService";
import BackupSettingService, {
  Service as BackupSettingServiceClass,
} from "Common/Server/Services/BackupSettingService";
import BackupSettingsUtil, {
  BackupDestinationSettings,
} from "Common/Server/Utils/Backup/BackupSettings";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import BackupSetting from "Common/Models/DatabaseModels/BackupSetting";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupRunTrigger,
  BackupStepKey,
  BackupStepStatus,
  getCurrentBackupStep,
  isBackupRunActive,
  readBackupSteps,
} from "Common/Types/Backup/BackupRunTypes";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import BackupCatalogSync, {
  BackupCatalogSyncResult,
} from "../BackupCatalogSync";
import {
  BackupTestResult,
  testBackupDestination,
} from "../BackupDestinationTest";
import { getBackupFolderKey } from "../BackupLayout";
import BackupRunner from "../BackupRunner";
import BackupScheduler, {
  BACKUP_LICENSE_REQUIRED_MESSAGE,
  backupScheduler,
} from "../BackupScheduler";
import {
  buildRestorePreview,
  RestorePreview,
  restorePreviewToJson,
} from "../RestorePreview";
import { errorText } from "../Storage/BackupHttp";
import { deleteBackupPrefix } from "../Storage/BackupStorage";

/*
 * What the Backups page asks of the server beyond reading its rows (Admin
 * Dashboard > Settings > Backups). Master admins only, every route:
 *
 *   POST /backup/test              test a destination before it is saved
 *   GET  /backup/overview          what the page's top says: the next backup,
 *                                  the databases' sizes, the tools, the license
 *   POST /backup/run-now           queue a backup now
 *   POST /backup/restore-preview   what a restore of a backup would replace
 *   POST /backup/restore           queue a restore (typed confirmation)
 *   POST /backup/cancel            cancel a queued or running backup or restore
 *   POST /backup/delete            delete a backup (its files, then its row)
 *   POST /backup/find              find the backups at the destination
 *
 * Testing a destination and making new backups need a license that
 * includes backups. Restoring, deleting, finding and reading never do: a
 * lapsed license never stands between an installation and its own data.
 *
 * Routes only, no router.use() (ee/Tests/Server/ModuleShape.test.ts).
 */

const router: ExpressRouter = Express.getRouter();

// What a master admin types to restore.
export const RESTORE_CONFIRMATION_WORD: string = "restore";

export const BACKUP_ALREADY_RUNNING_MESSAGE: string =
  "A backup or a restore is already queued or running. Wait for it to finish.";

function readBody(body: unknown): JSONObject {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as JSONObject)
    : {};
}

function readObject(value: JSONValue | undefined, label: string): JSONObject {
  if (value === undefined || value === null || value === "") {
    return {};
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadDataException(`${label} must be a JSON object.`);
  }

  return value as JSONObject;
}

function readId(value: JSONValue | undefined, label: string): ObjectID {
  const text: string = typeof value === "string" ? value.trim() : "";

  if (!ObjectID.isValidUUID(text)) {
    throw new BadDataException(`A valid ${label} is required.`);
  }

  return new ObjectID(text);
}

async function getSettingOrThrow(): Promise<BackupSetting> {
  const setting: BackupSetting | null = await BackupSettingService.getSetting();

  if (!setting?.id) {
    throw new BadDataException(
      "Backups are not set up yet. Choose a destination first.",
    );
  }

  return setting;
}

async function hasActiveRun(): Promise<boolean> {
  const count: number = (
    await BackupRunService.countBy({
      query: { status: BackupRunStatus.Queued },
      props: { isRoot: true },
    })
  ).toNumber();

  if (count > 0) {
    return true;
  }

  return (
    (
      await BackupRunService.countBy({
        query: { status: BackupRunStatus.Running },
        props: { isRoot: true },
      })
    ).toNumber() > 0
  );
}

async function getRunOrThrow(id: ObjectID): Promise<BackupRun> {
  const run: BackupRun | null = await BackupRunService.findOneById({
    id,
    select: {
      _id: true,
      kind: true,
      trigger: true,
      status: true,
      name: true,
      startedAt: true,
      destinationFingerprint: true,
      includesPostgres: true,
      includesClickhouse: true,
      restoredBackupRunId: true,
      runnerState: true,
      steps: true,
    },
    props: { isRoot: true },
  });

  if (!run) {
    throw new BadDataException("That backup no longer exists.");
  }

  return run;
}

/*
 * Starts the queued run at once when this process runs workers (one
 * container that is both, as Docker Compose runs it); otherwise a worker's
 * next tick, within a minute, does.
 */
function startSoon(): void {
  if (DisableQueueWorkers) {
    return;
  }

  void backupScheduler.tick().catch((error: unknown) => {
    logger.warn(
      `Backups: could not start the run at once: ${errorText(error)}`,
    );
  });
}

export class BackupApiHandlers {
  public static runner: BackupRunner = new BackupRunner();

  public static async test(data: { body: unknown }): Promise<JSONObject> {
    EnterpriseEdition.assertFeatureAvailableSync(EnterpriseFeature.Backups);

    const body: JSONObject = readBody(data.body);
    let settings: BackupDestinationSettings;

    if (body["settingId"]) {
      // The saved settings, with the edit form's unsaved values over them.
      const settingId: ObjectID = readId(body["settingId"], "settings ID");
      const stored: BackupSetting | null =
        await BackupSettingService.findOneById({
          id: settingId,
          select: {
            _id: true,
            destinationType: true,
            destinationProvider: true,
            config: true,
            secrets: true,
          },
          props: { isRoot: true },
        });

      if (!stored?.destinationType) {
        throw new BadDataException("The backup settings no longer exist.");
      }

      const type: unknown = body["destinationType"] || stored.destinationType;

      settings = await BackupSettingServiceClass.validateDestination({
        type,
        provider:
          body["destinationProvider"] !== undefined
            ? body["destinationProvider"]
            : stored.destinationProvider,
        config:
          body["config"] !== undefined
            ? readObject(body["config"], "Configuration")
            : (stored.config as JSONObject) || {},
        secrets: BackupSettingServiceClass.mergeSecrets({
          type,
          storedType: stored.destinationType,
          stored: stored.secrets,
          provided: body["secrets"],
        }),
      });
    } else {
      settings = await BackupSettingServiceClass.validateDestination({
        type: body["destinationType"],
        provider: body["destinationProvider"],
        config: readObject(body["config"], "Configuration"),
        secrets: readObject(body["secrets"], "Credentials"),
      });
    }

    const result: BackupTestResult = await testBackupDestination({
      settings,
      storage: this.runner.createStorageFor(settings),
      postgres: this.runner.getPostgresEngine(),
      clickhouse: this.runner.getClickhouseEngine(),
      includesClickhouse: body["includesClickhouse"] !== false,
    });

    return result as unknown as JSONObject;
  }

  public static async overview(): Promise<JSONObject> {
    const setting: BackupSetting | null =
      await BackupSettingService.getSetting();
    const isActive: boolean = EnterpriseEdition.isFeatureActive(
      EnterpriseFeature.Backups,
    );
    const isAvailable: boolean = EnterpriseEdition.isFeatureAvailableSync(
      EnterpriseFeature.Backups,
    );

    const overview: JSONObject = {
      isSetUp: Boolean(setting?.id),
      isActive,
      isAvailable,
      nextBackupAt: setting?.nextBackupAt
        ? new Date(setting.nextBackupAt).toISOString()
        : null,
      postgres: null,
      clickhouse: null,
      destinationFingerprint: null,
    };

    if (setting?.id) {
      try {
        const settings: BackupDestinationSettings =
          await BackupSettingService.getDestinationSettings(setting.id);
        overview["destinationFingerprint"] =
          BackupSettingsUtil.getDestinationFingerprint(settings);
        overview["location"] = this.runner
          .createStorageFor(settings)
          .describeKey(BackupSettingsUtil.getFolder(settings));
      } catch (error) {
        overview["destinationError"] = errorText(error) + ".";
      }
    }

    try {
      const info: Awaited<
        ReturnType<
          ReturnType<BackupRunner["getPostgresEngine"]>["getServerInfo"]
        >
      > = await this.runner.getPostgresEngine().getServerInfo();
      overview["postgres"] = {
        version: info.version,
        sizeInBytes: info.sizeInBytes,
        database: info.database,
        canRestore: info.isSuperuser || info.canCreateDatabases,
        user: info.user,
      };
    } catch (error) {
      overview["postgres"] = { error: errorText(error) + "." };
    }

    try {
      overview["clickhouse"] = {
        version: await this.runner.getClickhouseEngine().getServerVersion(),
        sizeInBytes: await this.runner
          .getClickhouseEngine()
          .getDatabaseSizeInBytes(),
        database: this.runner.getClickhouseEngine().database,
      };
    } catch (error) {
      overview["clickhouse"] = { error: errorText(error) + "." };
    }

    return overview;
  }

  public static async runNow(data: {
    props: DatabaseCommonInteractionProps;
  }): Promise<JSONObject> {
    if (!EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.Backups)) {
      throw new BadDataException(BACKUP_LICENSE_REQUIRED_MESSAGE);
    }

    const setting: BackupSetting = await getSettingOrThrow();

    if (await hasActiveRun()) {
      throw new BadDataException(BACKUP_ALREADY_RUNNING_MESSAGE);
    }

    const run: BackupRun = await BackupScheduler.queueManualBackup({
      createdByUserId: data.props.userId,
      includesClickhouse: setting.includesClickhouse !== false,
    });

    startSoon();

    return { backupRunId: run.id!.toString() };
  }

  private static async preview(body: JSONObject): Promise<RestorePreview> {
    const setting: BackupSetting = await getSettingOrThrow();
    const settings: BackupDestinationSettings =
      await BackupSettingService.getDestinationSettings(setting.id!);
    const backupRun: BackupRun = await getRunOrThrow(
      readId(body["backupRunId"], "backup ID"),
    );

    if (backupRun.kind !== BackupRunKind.Backup) {
      throw new BadDataException("Only a backup can be restored.");
    }

    return await buildRestorePreview({
      backupRun,
      settings,
      storage: this.runner.createStorageFor(settings),
      postgres: this.runner.getPostgresEngine(),
      clickhouse: this.runner.getClickhouseEngine(),
      includesPostgres: body["includesPostgres"] !== false,
      includesClickhouse: body["includesClickhouse"] === true,
    });
  }

  public static async restorePreview(data: {
    body: unknown;
  }): Promise<JSONObject> {
    return restorePreviewToJson(await this.preview(readBody(data.body)));
  }

  public static async restore(data: {
    body: unknown;
    props: DatabaseCommonInteractionProps;
  }): Promise<JSONObject> {
    const body: JSONObject = readBody(data.body);
    const confirmation: string =
      typeof body["confirmation"] === "string"
        ? body["confirmation"].trim().toLowerCase()
        : "";

    if (confirmation !== RESTORE_CONFIRMATION_WORD) {
      throw new BadDataException(
        `Type ${RESTORE_CONFIRMATION_WORD} to confirm the restore.`,
      );
    }

    const includesPostgres: boolean = body["includesPostgres"] !== false;
    const includesClickhouse: boolean = body["includesClickhouse"] === true;

    if (!includesPostgres && !includesClickhouse) {
      throw new BadDataException(
        "Choose what to restore: PostgreSQL, ClickHouse or both.",
      );
    }

    if (await hasActiveRun()) {
      throw new BadDataException(BACKUP_ALREADY_RUNNING_MESSAGE);
    }

    const preview: RestorePreview = await this.preview(body);

    if (preview.problems.length > 0) {
      throw new BadDataException(
        preview.problems
          .map((problem: { message: string }): string => {
            return problem.message;
          })
          .join(" "),
      );
    }

    const run: BackupRun = new BackupRun();
    run.kind = BackupRunKind.Restore;
    run.trigger = BackupRunTrigger.Manual;
    run.status = BackupRunStatus.Queued;
    run.includesPostgres = includesPostgres;
    run.includesClickhouse = includesClickhouse;
    run.restoredBackupRunId = new ObjectID(preview.backup.id);
    run.runnerState = { takeBackupFirst: body["takeBackupFirst"] !== false };

    if (data.props.userId) {
      run.createdByUserId = data.props.userId;
    }

    const created: BackupRun = await BackupRunService.create({
      data: run,
      props: { isRoot: true },
    });

    startSoon();

    return { backupRunId: created.id!.toString() };
  }

  public static async cancel(data: { body: unknown }): Promise<JSONObject> {
    const run: BackupRun = await getRunOrThrow(
      readId(readBody(data.body)["backupRunId"], "backup ID"),
    );

    if (!isBackupRunActive(run.status)) {
      throw new BadDataException("It has already finished.");
    }

    if (run.status === BackupRunStatus.Queued) {
      await BackupRunService.updateOneById({
        id: run.id!,
        data: {
          status: BackupRunStatus.Cancelled,
          cancelRequestedAt: OneUptimeDate.getCurrentDate(),
          finishedAt: OneUptimeDate.getCurrentDate(),
          error: "Cancelled by a master admin before it started.",
        },
        props: { isRoot: true },
      });

      return { isCancelled: true };
    }

    if (run.kind === BackupRunKind.Restore) {
      const current: ReturnType<typeof getCurrentBackupStep> =
        getCurrentBackupStep(readBackupSteps(run.steps));
      const pastTheLiveData: Array<BackupStepKey> = [
        BackupStepKey.RestoreClickhouse,
        BackupStepKey.SwitchOver,
        BackupStepKey.UpgradeRestoredData,
        BackupStepKey.CleanUp,
      ];

      if (
        current &&
        current.status === BackupStepStatus.Running &&
        pastTheLiveData.includes(current.key)
      ) {
        throw new BadDataException(
          "This restore is already replacing the data, and stopping now would leave it half done. It finishes on its own.",
        );
      }
    }

    await BackupRunService.updateOneById({
      id: run.id!,
      data: { cancelRequestedAt: OneUptimeDate.getCurrentDate() },
      props: { isRoot: true },
    });

    return { isCancelled: false, isCancelRequested: true };
  }

  public static async delete(data: { body: unknown }): Promise<JSONObject> {
    const run: BackupRun = await getRunOrThrow(
      readId(readBody(data.body)["backupRunId"], "backup ID"),
    );

    if (isBackupRunActive(run.status)) {
      throw new BadDataException(
        "It is still queued or running. Cancel it first.",
      );
    }

    const readers: number = (
      await BackupRunService.countBy({
        query: {
          kind: BackupRunKind.Restore,
          restoredBackupRunId: run.id!,
          status: BackupRunStatus.Running,
        },
        props: { isRoot: true },
      })
    ).toNumber();

    if (readers > 0) {
      throw new BadDataException("A restore is reading this backup right now.");
    }

    let deletedFiles: number = 0;

    if (run.kind === BackupRunKind.Backup && run.name) {
      const setting: BackupSetting | null =
        await BackupSettingService.getSetting();

      if (setting?.id) {
        const settings: BackupDestinationSettings =
          await BackupSettingService.getDestinationSettings(setting.id);

        if (
          BackupSettingsUtil.getDestinationFingerprint(settings) ===
          run.destinationFingerprint
        ) {
          deletedFiles = await deleteBackupPrefix({
            storage: this.runner.createStorageFor(settings),
            prefix: getBackupFolderKey(
              BackupSettingsUtil.getFolder(settings),
              run.name,
            ),
          });
        }
      }
    }

    await BackupRunService.deleteOneById({
      id: run.id!,
      props: { isRoot: true },
    });

    return { deletedFiles };
  }

  public static async find(): Promise<JSONObject> {
    const setting: BackupSetting = await getSettingOrThrow();
    const settings: BackupDestinationSettings =
      await BackupSettingService.getDestinationSettings(setting.id!);
    const result: BackupCatalogSyncResult = await BackupCatalogSync.sync({
      settings,
      storage: this.runner.createStorageFor(settings),
    });

    return result as unknown as JSONObject;
  }
}

type Handler = (
  req: ExpressRequest,
  props: DatabaseCommonInteractionProps,
) => Promise<JSONObject>;

function route(handler: Handler) {
  return async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      Response.sendJsonObjectResponse(req, res, await handler(req, props));
    } catch (error) {
      next(error);
    }
  };
}

router.post(
  "/backup/test",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  UserMiddleware.getUserMiddleware,
  route(async (req: ExpressRequest): Promise<JSONObject> => {
    return await BackupApiHandlers.test({ body: req.body });
  }),
);

router.get(
  "/backup/overview",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  UserMiddleware.getUserMiddleware,
  route(async (): Promise<JSONObject> => {
    return await BackupApiHandlers.overview();
  }),
);

router.post(
  "/backup/run-now",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  UserMiddleware.getUserMiddleware,
  route(
    async (
      _req: ExpressRequest,
      props: DatabaseCommonInteractionProps,
    ): Promise<JSONObject> => {
      return await BackupApiHandlers.runNow({ props });
    },
  ),
);

router.post(
  "/backup/restore-preview",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  UserMiddleware.getUserMiddleware,
  route(async (req: ExpressRequest): Promise<JSONObject> => {
    return await BackupApiHandlers.restorePreview({ body: req.body });
  }),
);

router.post(
  "/backup/restore",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  UserMiddleware.getUserMiddleware,
  route(
    async (
      req: ExpressRequest,
      props: DatabaseCommonInteractionProps,
    ): Promise<JSONObject> => {
      return await BackupApiHandlers.restore({ body: req.body, props });
    },
  ),
);

router.post(
  "/backup/cancel",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  UserMiddleware.getUserMiddleware,
  route(async (req: ExpressRequest): Promise<JSONObject> => {
    return await BackupApiHandlers.cancel({ body: req.body });
  }),
);

router.post(
  "/backup/delete",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  UserMiddleware.getUserMiddleware,
  route(async (req: ExpressRequest): Promise<JSONObject> => {
    return await BackupApiHandlers.delete({ body: req.body });
  }),
);

router.post(
  "/backup/find",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  UserMiddleware.getUserMiddleware,
  route(async (): Promise<JSONObject> => {
    return await BackupApiHandlers.find();
  }),
);

export default router;
