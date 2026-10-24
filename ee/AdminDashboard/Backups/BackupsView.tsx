import { BACKUP_PLURALS, BackupsCopy } from "./BackupsCopy";
import BackupsApi, { BackupsOverview, FindBackupsResult } from "./BackupsApi";
import BackupsHero from "./BackupsHero";
import BackupsLicenseNotice from "./BackupsLicenseNotice";
import BackupRunStepsModal from "./BackupRunStepsModal";
import BackupRunsTable from "./BackupRunsTable";
import BackupSettingsCard from "./BackupSettingsCard";
import BackupSettingsFormModal from "./BackupSettingsFormModal";
import BackupStatusCard from "./BackupStatusCard";
import { isBackupAtCurrentDestination } from "./BackupFormat";
import RestoreBackupModal from "./RestoreBackupModal";
import { EnterpriseLicenseMode } from "../../Dashboard/Identity/License/EnterpriseLicenseMode";
import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import BackupSetting from "Common/Models/DatabaseModels/BackupSetting";
import {
  BackupRunKind,
  BackupRunStatus,
  isBackupRunActive,
} from "Common/Types/Backup/BackupRunTypes";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * Settings > Backups, below the page chrome: before anything is set up,
 * what backups do and the one button that sets them up; afterwards, how
 * they are doing (live, while one runs), what they are set to, every backup
 * - each one restorable - and every restore.
 *
 * The page follows a running backup or restore by reading its row every few
 * seconds, and looks for a new one (a scheduled backup starting) every
 * twenty; the tables are read again only when a run starts or finishes. A
 * read that fails in between - a restore's switch-over drops connections
 * for a moment - keeps what the page shows.
 */

export const ACTIVE_RUN_POLL_INTERVAL_IN_MS: number = 3000;
export const IDLE_POLL_INTERVAL_IN_MS: number = 20000;
// A restore's row is missing for a moment while it switches databases.
const MISSING_RESTORE_POLLS_BEFORE_RELOAD: number = 10;

export const BACKUP_SETTING_SELECT: {
  [key: string]: true;
} = {
  _id: true,
  destinationType: true,
  destinationProvider: true,
  config: true,
  isEnabled: true,
  frequency: true,
  timeOfDay: true,
  dayOfWeek: true,
  retentionInDays: true,
  includesClickhouse: true,
  nextBackupAt: true,
};

export const BACKUP_RUN_SELECT: {
  [key: string]: true;
} = {
  _id: true,
  kind: true,
  trigger: true,
  status: true,
  steps: true,
  name: true,
  location: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  includesPostgres: true,
  includesClickhouse: true,
  postgresSizeInBytes: true,
  clickhouseSizeInBytes: true,
  destinationFingerprint: true,
  error: true,
  restoredBackupRunId: true,
  cancelRequestedAt: true,
  manifest: true,
};

export interface BackupsPageData {
  setting: BackupSetting | null;
  overview: BackupsOverview;
  activeRun: BackupRun | null;
  // The newest backup that succeeded or failed (a cancelled one says nothing of how backups are doing).
  lastBackup: BackupRun | null;
  newestSucceeded: BackupRun | null;
  restoreCount: number;
}

async function findFirstRun(data: {
  query: Record<string, unknown>;
  sortBy: "startedAt" | "createdAt";
  sortOrder: SortOrder;
}): Promise<BackupRun | null> {
  const result: ListResult<BackupRun> = await AdminModelAPI.getList<BackupRun>({
    modelType: BackupRun,
    query: data.query as never,
    limit: 1,
    skip: 0,
    select: BACKUP_RUN_SELECT as never,
    sort: { [data.sortBy]: data.sortOrder } as never,
  });

  return result.data[0] || null;
}

// The run going on now: the running one, or else the oldest queued (the next to start).
export async function findActiveBackupRun(): Promise<BackupRun | null> {
  return (
    (await findFirstRun({
      query: { status: BackupRunStatus.Running },
      sortBy: "createdAt",
      sortOrder: SortOrder.Descending,
    })) ||
    (await findFirstRun({
      query: { status: BackupRunStatus.Queued },
      sortBy: "createdAt",
      sortOrder: SortOrder.Ascending,
    }))
  );
}

export async function loadBackupsPageData(): Promise<BackupsPageData> {
  const [settings, overview] = await Promise.all([
    AdminModelAPI.getList<BackupSetting>({
      modelType: BackupSetting,
      query: {},
      limit: 1,
      skip: 0,
      select: BACKUP_SETTING_SELECT as never,
      sort: {},
    }),
    BackupsApi.getOverview(),
  ]);

  const [activeRun, lastBackup, newestSucceeded, restoreCount] =
    await Promise.all([
      findActiveBackupRun(),
      findFirstRun({
        query: {
          kind: BackupRunKind.Backup,
          status: new Includes([
            BackupRunStatus.Succeeded,
            BackupRunStatus.Failed,
          ]),
        },
        sortBy: "startedAt",
        sortOrder: SortOrder.Descending,
      }),
      findFirstRun({
        query: {
          kind: BackupRunKind.Backup,
          status: BackupRunStatus.Succeeded,
        },
        sortBy: "startedAt",
        sortOrder: SortOrder.Descending,
      }),
      AdminModelAPI.count<BackupRun>({
        modelType: BackupRun,
        query: { kind: BackupRunKind.Restore },
      }),
    ]);

  return {
    setting: settings.data[0] || null,
    overview,
    activeRun,
    lastBackup,
    newestSucceeded,
    restoreCount,
  };
}

// What Find backups found, in a sentence or two.
export function describeFindResult(data: {
  result: FindBackupsResult;
  translator: Translator;
}): string {
  if (data.result.found === 0) {
    return data.translator.translateText(BackupsCopy.foundNoBackups) || "";
  }

  const found: string = data.translator.translatePlural(
    BACKUP_PLURALS.found,
    data.result.found,
  );

  return data.result.added > 0
    ? `${found} ${data.translator.translatePlural(BACKUP_PLURALS.added, data.result.added)}`
    : found;
}

export interface ComponentProps {
  licenseMode: EnterpriseLicenseMode;
}

const BackupsView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [data, setData] = useState<BackupsPageData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tablesToggle, setTablesToggle] = useState<number>(0);
  const [now, setNow] = useState<Date>(new Date());
  const [notice, setNotice] = useState<{
    type: AlertType;
    text: string;
  } | null>(null);

  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [stepsRun, setStepsRun] = useState<BackupRun | null>(null);
  const [restoreRun, setRestoreRun] = useState<BackupRun | null>(null);
  const [deleteRun, setDeleteRun] = useState<BackupRun | null>(null);
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [isChangingSchedule, setIsChangingSchedule] = useState<boolean>(false);
  const [isFinding, setIsFinding] = useState<boolean>(false);

  const isPolling: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const missingPolls: React.MutableRefObject<number> = useRef<number>(0);

  const reload: (options?: {
    refreshTables?: boolean | undefined;
  }) => Promise<BackupsPageData | null> = useCallback(
    async (options?: {
      refreshTables?: boolean | undefined;
    }): Promise<BackupsPageData | null> => {
      try {
        const next: BackupsPageData = await loadBackupsPageData();

        setData(next);
        setLoadError(null);
        setNow(new Date());

        if (options?.refreshTables) {
          setTablesToggle((value: number): number => {
            return value + 1;
          });
        }

        return next;
      } catch (err) {
        setLoadError(API.getFriendlyErrorMessage(err as Error));
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    void reload();
  }, []);

  const activeRunId: string | null = data?.activeRun?.id?.toString() || null;
  const activeRunKind: BackupRunKind | undefined = data?.activeRun?.kind;

  useEffect(() => {
    if (!data) {
      return;
    }

    let isStopped: boolean = false;
    missingPolls.current = 0;

    const poll: () => Promise<void> = async (): Promise<void> => {
      if (isPolling.current) {
        return;
      }

      isPolling.current = true;

      try {
        setNow(new Date());

        if (!activeRunId) {
          const active: BackupRun | null = await findActiveBackupRun();

          if (!isStopped && active) {
            await reload({ refreshTables: true });
          }

          return;
        }

        const run: BackupRun | null = await AdminModelAPI.getItem<BackupRun>({
          modelType: BackupRun,
          id: new ObjectID(activeRunId),
          select: BACKUP_RUN_SELECT as never,
        });

        if (isStopped) {
          return;
        }

        if (
          !run &&
          activeRunKind === BackupRunKind.Restore &&
          ++missingPolls.current < MISSING_RESTORE_POLLS_BEFORE_RELOAD
        ) {
          return;
        }

        if (!run || !isBackupRunActive(run.status)) {
          await reload({ refreshTables: true });
          return;
        }

        missingPolls.current = 0;
        setData((current: BackupsPageData | null) => {
          return current ? { ...current, activeRun: run } : current;
        });
      } catch {
        // Read again on the next tick.
      } finally {
        isPolling.current = false;
      }
    };

    const timer: ReturnType<typeof setInterval> = setInterval(
      () => {
        void poll();
      },
      activeRunId ? ACTIVE_RUN_POLL_INTERVAL_IN_MS : IDLE_POLL_INTERVAL_IN_MS,
    );

    return () => {
      isStopped = true;
      clearInterval(timer);
    };
  }, [Boolean(data), activeRunId, activeRunKind]);

  if (!data) {
    return loadError ? (
      <div data-testid="backups-load-error">
        <ErrorMessage
          message={`${translator.translateText(BackupsCopy.couldNotLoad)} ${loadError}`}
          onRefreshClick={() => {
            void reload();
          }}
        />
      </div>
    ) : (
      <ComponentLoader />
    );
  }

  const setting: BackupSetting | null = data.setting;
  const overview: BackupsOverview = data.overview;
  const canBackUp: boolean = overview.isAvailable;
  const fingerprint: string | null = overview.destinationFingerprint;
  const isRunning: boolean = Boolean(data.activeRun);

  const showError: (err: unknown) => void = (err: unknown): void => {
    setNotice({
      type: AlertType.DANGER,
      text: API.getFriendlyErrorMessage(err as Error),
    });
  };

  const findBackups: (options?: {
    isQuiet?: boolean | undefined;
  }) => Promise<void> = async (options?: {
    isQuiet?: boolean | undefined;
  }): Promise<void> => {
    setIsFinding(true);

    try {
      const result: FindBackupsResult = await BackupsApi.find();

      if (!options?.isQuiet || result.found > 0) {
        setNotice({
          type: result.found > 0 ? AlertType.SUCCESS : AlertType.INFO,
          text: describeFindResult({ result, translator }),
        });
      }

      await reload({ refreshTables: true });
    } catch (err) {
      if (!options?.isQuiet) {
        showError(err);
      }
    }

    setIsFinding(false);
  };

  const notices: Array<ReactElement> = [];

  if (notice) {
    notices.push(
      <Alert
        key="notice"
        type={notice.type}
        title={notice.text}
        dataTestId="backups-notice"
        className="mb-5"
        onClose={() => {
          setNotice(null);
        }}
      />,
    );
  }

  if (setting && overview.destinationError) {
    notices.push(
      <Alert
        key="destination"
        type={AlertType.DANGER}
        strongTitle={BackupsCopy.destinationErrorTitle}
        title={overview.destinationError}
        dataTestId="backups-destination-error"
        className="mb-5"
      />,
    );
  }

  if (setting && overview.postgres?.canRestore === false) {
    notices.push(
      <Alert
        key="restore"
        type={AlertType.WARNING}
        strongTitle={BackupsCopy.cannotRestoreTitle}
        title={translator.translateTemplate(
          BackupsCopy.cannotRestoreDescription,
          { user: overview.postgres.user || "oneuptime" },
        )}
        dataTestId="backups-cannot-restore"
        className="mb-5"
      />,
    );
  }

  const isNewestSucceeded: boolean = Boolean(
    deleteRun?.id &&
      data.newestSucceeded?.id &&
      deleteRun.id.toString() === data.newestSucceeded.id.toString(),
  );

  return (
    <div data-testid="backups-view">
      <BackupsLicenseNotice mode={props.licenseMode} />
      {notices}

      {setting ? (
        <>
          <BackupStatusCard
            setting={setting}
            activeRun={data.activeRun}
            lastBackup={data.lastBackup}
            nextBackupAt={overview.nextBackupAt}
            canBackUp={canBackUp}
            lockedReason={BackupsCopy.licenseRequired}
            isBusy={isStarting || isChangingSchedule || isFinding}
            isCancelRequested={Boolean(data.activeRun?.cancelRequestedAt)}
            now={now}
            onBackUpNow={() => {
              setIsStarting(true);
              BackupsApi.runNow()
                .then(() => {
                  return reload({ refreshTables: true });
                })
                .catch(showError)
                .finally(() => {
                  setIsStarting(false);
                });
            }}
            onSetEnabled={(isEnabled: boolean) => {
              setIsChangingSchedule(true);
              AdminModelAPI.updateById<BackupSetting>({
                modelType: BackupSetting,
                id: setting.id!,
                data: { isEnabled },
              })
                .then(() => {
                  return reload();
                })
                .catch(showError)
                .finally(() => {
                  setIsChangingSchedule(false);
                });
            }}
            onFindBackups={() => {
              void findBackups();
            }}
            onViewSteps={setStepsRun}
            onCancel={(run: BackupRun) => {
              BackupsApi.cancel(run.id!.toString())
                .then(() => {
                  return reload({ refreshTables: true });
                })
                .catch(showError);
            }}
          />

          <div className="mb-5">
            <BackupSettingsCard
              setting={setting}
              location={overview.location}
              postgresSizeInBytes={overview.postgres?.sizeInBytes}
              clickhouseSizeInBytes={overview.clickhouse?.sizeInBytes}
              canEdit={canBackUp}
              editDisabledReason={BackupsCopy.licenseRequired}
              onEdit={() => {
                setIsFormOpen(true);
              }}
            />
          </div>

          <BackupRunsTable
            kind={BackupRunKind.Backup}
            refreshToggle={`backups-${tablesToggle}`}
            currentFingerprint={fingerprint}
            isBusy={isRunning}
            onRestore={setRestoreRun}
            onViewSteps={setStepsRun}
            onCancel={(run: BackupRun) => {
              BackupsApi.cancel(run.id!.toString())
                .then(() => {
                  return reload({ refreshTables: true });
                })
                .catch(showError);
            }}
            onDelete={(run: BackupRun) => {
              setDeleteError(undefined);
              setDeleteRun(run);
            }}
          />

          {data.restoreCount > 0 ? (
            <div className="mt-5">
              <BackupRunsTable
                kind={BackupRunKind.Restore}
                refreshToggle={`restores-${tablesToggle}`}
                currentFingerprint={fingerprint}
                isBusy={isRunning}
                onRestore={setRestoreRun}
                onViewSteps={setStepsRun}
                onCancel={(run: BackupRun) => {
                  BackupsApi.cancel(run.id!.toString())
                    .then(() => {
                      return reload({ refreshTables: true });
                    })
                    .catch(showError);
                }}
              />
            </div>
          ) : (
            <></>
          )}
        </>
      ) : (
        <BackupsHero
          canSetUp={canBackUp}
          setUpDisabledReason={BackupsCopy.licenseRequired}
          onSetUp={() => {
            setIsFormOpen(true);
          }}
        />
      )}

      {isFormOpen ? (
        <BackupSettingsFormModal
          setting={setting || undefined}
          onClose={() => {
            setIsFormOpen(false);
          }}
          onSaved={() => {
            setIsFormOpen(false);
            const previous: string | null = fingerprint;

            void reload({ refreshTables: true }).then(
              (next: BackupsPageData | null) => {
                // A new destination may hold backups already (a move to a new server): list them.
                if (
                  next?.overview.destinationFingerprint &&
                  next.overview.destinationFingerprint !== previous
                ) {
                  void findBackups({ isQuiet: true });
                }
              },
            );
          }}
        />
      ) : (
        <></>
      )}

      {stepsRun ? (
        <BackupRunStepsModal
          run={stepsRun}
          onClose={() => {
            setStepsRun(null);
          }}
        />
      ) : (
        <></>
      )}

      {restoreRun ? (
        <RestoreBackupModal
          backup={restoreRun}
          onClose={() => {
            setRestoreRun(null);
          }}
          onStarted={() => {
            setRestoreRun(null);
            void reload({ refreshTables: true });
          }}
        />
      ) : (
        <></>
      )}

      {deleteRun ? (
        <ConfirmModal
          title={BackupsCopy.deleteTitle}
          description={
            isBackupAtCurrentDestination({
              run: deleteRun,
              currentFingerprint: fingerprint,
            })
              ? BackupsCopy.deleteDescription
              : BackupsCopy.deletePreviousDescription
          }
          submitButtonText={BackupsCopy.deleteButton}
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isDeleting}
          error={deleteError}
          onClose={() => {
            setDeleteRun(null);
          }}
          onSubmit={() => {
            setIsDeleting(true);
            setDeleteError(undefined);
            BackupsApi.delete(deleteRun.id!.toString())
              .then(() => {
                setDeleteRun(null);
                return reload({ refreshTables: true });
              })
              .catch((err: unknown) => {
                setDeleteError(API.getFriendlyErrorMessage(err as Error));
              })
              .finally(() => {
                setIsDeleting(false);
              });
          }}
        >
          {isNewestSucceeded ? (
            <Alert
              type={AlertType.WARNING}
              title={BackupsCopy.deleteNewestWarning}
              dataTestId="backups-delete-newest"
              className="mt-3"
            />
          ) : (
            <></>
          )}
        </ConfirmModal>
      ) : (
        <></>
      )}
    </div>
  );
};

export default BackupsView;
