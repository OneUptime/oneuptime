import {
  BACKUP_RUN_STATUS_COPY,
  BACKUP_RUN_TRIGGER_COPY,
  BACKUP_RUNS_TABLE_ID,
  BACKUP_STEP_COPY,
  BackupsCopy,
  RESTORE_RUNS_TABLE_ID,
} from "./BackupsCopy";
import {
  BackupRunProgress,
  canRestoreBackup,
  describeBackupContents,
  formatBackupDateTime,
  formatBackupDuration,
  getBackupRunDurationInMs,
  getBackupRunProgress,
  getBackupRunStatusColor,
  isBackupAtCurrentDestination,
} from "./BackupFormat";
import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupRunTrigger,
  isBackupRunActive,
} from "Common/Types/Backup/BackupRunTypes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { getFeedClock } from "Common/UI/Components/Feed/FeedTime";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The backups (or the restores) of the instance, newest first: when each
 * ran and what started it, what it holds and how big, how long it took
 * and how it went - with Restore on a backup that can be restored, Cancel
 * on one still going, View steps on all, and Delete in the menu.
 *
 * The rows are re-read when the page says so (refreshToggle: a run started
 * or finished), not on a timer: the status card above follows a running
 * one live.
 */

export interface ComponentProps {
  kind: BackupRunKind;
  refreshToggle: string;
  currentFingerprint: string | null;
  // Restoring, deleting and cancelling are master admins' at any license.
  isBusy: boolean;
  onRestore: (run: BackupRun) => void;
  onViewSteps: (run: BackupRun) => void;
  onCancel: (run: BackupRun) => void;
  // Backups only.
  onDelete?: ((run: BackupRun) => void) | undefined;
  // The restores' table shows when it backs up: the backup each one restored.
  backupStartedAtById?: Record<string, Date> | undefined;
}

const BackupRunsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const clock: ReturnType<typeof getFeedClock> = getFeedClock({
    language: translator.language,
  });
  const isBackups: boolean = props.kind === BackupRunKind.Backup;

  return (
    <ModelTable<BackupRun>
      modelType={BackupRun}
      modelAPI={AdminModelAPI}
      refreshToggle={props.refreshToggle}
      query={{ kind: props.kind }}
      selectMoreFields={{
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
      }}
      id={isBackups ? BACKUP_RUNS_TABLE_ID : RESTORE_RUNS_TABLE_ID}
      name={isBackups ? "Settings > Backups" : "Settings > Backups > Restores"}
      userPreferencesKey={
        isBackups ? BACKUP_RUNS_TABLE_ID : RESTORE_RUNS_TABLE_ID
      }
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      sortBy="startedAt"
      sortOrder={SortOrder.Descending}
      cardProps={{
        title: isBackups ? BackupsCopy.backupsTitle : BackupsCopy.restoresTitle,
        description: isBackups
          ? BackupsCopy.backupsDescription
          : BackupsCopy.restoresDescription,
      }}
      noItemsMessage={
        <TableEmptyState
          kind={TableEmptyStateKind.Empty}
          icon={IconProp.Database}
          title={BackupsCopy.backupsEmptyTitle}
          description={BackupsCopy.backupsEmptyDescription}
          isCompact={true}
          dataTestId="backup-runs-empty"
        />
      }
      showRefreshButton={true}
      actionButtons={[
        {
          title: BackupsCopy.restoreAction,
          icon: IconProp.ArrowUturnLeft,
          buttonStyleType: ButtonStyleType.OUTLINE,
          isVisible: (item: BackupRun): boolean => {
            return (
              isBackups &&
              canRestoreBackup({
                run: item,
                currentFingerprint: props.currentFingerprint,
              })
            );
          },
          disabled: props.isBusy,
          tooltip: BackupsCopy.restoreActionTooltip,
          onClick: (item: BackupRun, onCompleteAction: () => void): void => {
            props.onRestore(item);
            onCompleteAction();
          },
        },
        {
          title: BackupsCopy.cancelButton,
          icon: IconProp.Close,
          buttonStyleType: ButtonStyleType.OUTLINE,
          isVisible: (item: BackupRun): boolean => {
            return isBackupRunActive(item.status) && !item.cancelRequestedAt;
          },
          tooltip: BackupsCopy.cancelTooltip,
          onClick: (item: BackupRun, onCompleteAction: () => void): void => {
            props.onCancel(item);
            onCompleteAction();
          },
        },
        {
          title: BackupsCopy.viewStepsAction,
          icon: IconProp.ListBullet,
          buttonStyleType: ButtonStyleType.OUTLINE,
          onClick: (item: BackupRun, onCompleteAction: () => void): void => {
            props.onViewSteps(item);
            onCompleteAction();
          },
        },
        {
          title: BackupsCopy.deleteAction,
          icon: IconProp.Trash,
          buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
          // A restore has no files to delete: its row is the history of what was restored.
          isVisible: (item: BackupRun): boolean => {
            return isBackups && !isBackupRunActive(item.status);
          },
          onClick: (item: BackupRun, onCompleteAction: () => void): void => {
            props.onDelete?.(item);
            onCompleteAction();
          },
        },
      ]}
      filters={[]}
      columns={[
        {
          field: { startedAt: true },
          title: isBackups
            ? BackupsCopy.backupColumn
            : BackupsCopy.restoreColumn,
          type: FieldType.DateTime,
          getElement: (item: BackupRun): ReactElement => {
            const when: Date | undefined = item.startedAt || item.createdAt;
            const isElsewhere: boolean =
              isBackups &&
              item.status === BackupRunStatus.Succeeded &&
              !isBackupAtCurrentDestination({
                run: item,
                currentFingerprint: props.currentFingerprint,
              });

            return (
              <div className="min-w-0" data-testid="backup-run-when">
                <div className="font-medium text-gray-900">
                  {when ? formatBackupDateTime(new Date(when), clock) : ""}
                </div>
                <div className="text-xs text-gray-500">
                  {translator.translateText(
                    BACKUP_RUN_TRIGGER_COPY[
                      item.trigger || BackupRunTrigger.Manual
                    ],
                  )}
                  {isElsewhere ? (
                    <span
                      className="text-amber-700"
                      title={translator.translateText(
                        BackupsCopy.previousDestinationTooltip,
                      )}
                    >
                      {` · ${translator.translateText(BackupsCopy.previousDestinationNote)}`}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
              </div>
            );
          },
        },
        ...(isBackups
          ? []
          : [
              {
                field: { restoredBackupRunId: true },
                title: BackupsCopy.fromBackupColumn,
                type: FieldType.Text,
                getElement: (item: BackupRun): ReactElement => {
                  const startedAt: unknown = item.manifest?.["startedAt"];
                  const fromMap: Date | undefined = item.restoredBackupRunId
                    ? props.backupStartedAtById?.[
                        item.restoredBackupRunId.toString()
                      ]
                    : undefined;
                  const when: Date | undefined =
                    typeof startedAt === "string"
                      ? new Date(startedAt)
                      : fromMap;

                  return (
                    <span className="text-gray-900">
                      {when ? formatBackupDateTime(when, clock) : "—"}
                    </span>
                  );
                },
              },
            ]),
        {
          field: { includesPostgres: true },
          title: BackupsCopy.contentsColumn,
          type: FieldType.Text,
          getElement: (item: BackupRun): ReactElement => {
            const parts: Array<{ title: string; size: string }> =
              describeBackupContents({ run: item, translator });

            return (
              <div
                className="flex flex-col gap-0.5"
                data-testid="backup-run-contents"
              >
                {parts.map((part: { title: string; size: string }) => {
                  return (
                    <span key={part.title} className="whitespace-nowrap">
                      <span className="text-gray-900">{part.title}</span>
                      {isBackups && part.size ? (
                        <span className="text-gray-500">{` · ${part.size}`}</span>
                      ) : (
                        <></>
                      )}
                    </span>
                  );
                })}
              </div>
            );
          },
        },
        {
          field: { finishedAt: true },
          title: BackupsCopy.durationColumn,
          type: FieldType.Text,
          getElement: (item: BackupRun): ReactElement => {
            const duration: number | null = getBackupRunDurationInMs(
              item,
              clock.now,
            );

            return (
              <span className="whitespace-nowrap text-gray-700">
                {duration !== null && item.finishedAt
                  ? formatBackupDuration(duration, translator.language)
                  : "—"}
              </span>
            );
          },
        },
        {
          field: { status: true },
          title: BackupsCopy.statusColumn,
          type: FieldType.Text,
          getElement: (item: BackupRun): ReactElement => {
            const status: BackupRunStatus =
              item.status || BackupRunStatus.Queued;
            const progress: BackupRunProgress | null =
              status === BackupRunStatus.Running
                ? getBackupRunProgress(item)
                : null;

            return (
              <div className="flex min-w-0 flex-col items-start gap-1">
                <Pill
                  color={getBackupRunStatusColor(status)}
                  text={BACKUP_RUN_STATUS_COPY[status].title}
                  tooltip={BACKUP_RUN_STATUS_COPY[status].description}
                />
                {progress?.step ? (
                  <span
                    className="text-xs text-gray-500"
                    data-testid="backup-run-step"
                  >
                    {translator.translateText(
                      BACKUP_STEP_COPY[progress.step.key],
                    )}
                  </span>
                ) : (
                  <></>
                )}
                {status === BackupRunStatus.Failed && item.error ? (
                  <span
                    className="line-clamp-2 max-w-xs break-words text-xs text-red-700"
                    title={item.error}
                    data-testid="backup-run-error"
                  >
                    {item.error}
                  </span>
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
      ]}
    />
  );
};

export default BackupRunsTable;
