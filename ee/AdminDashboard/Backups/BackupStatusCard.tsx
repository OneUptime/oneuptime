import { BACKUP_STEP_COPY, BackupsCopy } from "./BackupsCopy";
import {
  BackupRunProgress,
  formatBackupDateTime,
  formatBackupDuration,
  formatBackupSize,
  formatBackupTimeAgo,
  formatBackupTimeUntil,
  getBackupRunDurationInMs,
  getBackupRunProgress,
  getBackupRunTotalSize,
} from "./BackupFormat";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import BackupSetting from "Common/Models/DatabaseModels/BackupSetting";
import {
  BackupRunKind,
  BackupRunStatus,
} from "Common/Types/Backup/BackupRunTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { getFeedClock } from "Common/UI/Components/Feed/FeedTime";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The top of the Backups page: how backups are doing, in one look. What
 * runs now (a backup or a restore, its step, how far), or else whether
 * backups are on, when the last one ran (or that it failed, and why) and
 * when the next one runs - with Back up now, and Turn on for a schedule
 * that is off. The rest (Find backups, turning the schedule off) is in ⋯.
 */

export interface ComponentProps {
  setting: BackupSetting;
  // The run going on now, queued or running.
  activeRun: BackupRun | null;
  // The newest backup that finished, whatever its outcome.
  lastBackup: BackupRun | null;
  // The time the next scheduled backup runs (the overview's).
  nextBackupAt: string | null;
  // New backups and settings changes are allowed (the license includes backups).
  canBackUp: boolean;
  lockedReason?: string | undefined;
  isBusy: boolean;
  isCancelRequested: boolean;
  onBackUpNow: () => void;
  onSetEnabled: (isEnabled: boolean) => void;
  onFindBackups: () => void;
  onViewSteps: (run: BackupRun) => void;
  onCancel: (run: BackupRun) => void;
  now?: Date | undefined;
}

const StatusIcon: FunctionComponent<{
  icon: IconProp;
  tone: "green" | "red" | "gray" | "indigo";
  isSpinning?: boolean | undefined;
}> = (props: {
  icon: IconProp;
  tone: "green" | "red" | "gray" | "indigo";
  isSpinning?: boolean | undefined;
}): ReactElement => {
  const tones: Record<string, string> = {
    green: "bg-emerald-50 text-emerald-700",
    red: "bg-red-50 text-red-700",
    gray: "bg-gray-100 text-gray-500",
    indigo: "bg-indigo-50 text-indigo-600",
  };

  return (
    <div
      className={`flex h-10 w-10 flex-none items-center justify-center rounded-full ${tones[props.tone]}`}
    >
      <Icon
        icon={props.icon}
        className={`h-5 w-5${props.isSpinning ? " animate-spin" : ""}`}
      />
    </div>
  );
};

const BackupStatusCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const clock: ReturnType<typeof getFeedClock> = getFeedClock({
    language: translator.language,
    now: props.now,
  });
  const run: BackupRun | null = props.activeRun;
  const isOn: boolean = props.setting.isEnabled !== false;
  const lastFailed: boolean =
    props.lastBackup?.status === BackupRunStatus.Failed;

  const actions: ReactElement = (
    <div className="flex flex-none items-center gap-2 [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
      {run ? (
        <>
          <Button
            title={BackupsCopy.viewStepsButton}
            icon={IconProp.ListBullet}
            buttonStyle={ButtonStyleType.NORMAL}
            dataTestId="backups-active-view-steps"
            onClick={() => {
              props.onViewSteps(run);
            }}
          />
          <Button
            title={
              props.isCancelRequested
                ? BackupsCopy.cancelRequested
                : BackupsCopy.cancelButton
            }
            icon={IconProp.Close}
            buttonStyle={ButtonStyleType.NORMAL}
            tooltip={BackupsCopy.cancelTooltip}
            disabled={props.isCancelRequested}
            dataTestId="backups-active-cancel"
            onClick={() => {
              props.onCancel(run);
            }}
          />
        </>
      ) : (
        <>
          {isOn ? (
            <></>
          ) : (
            <Button
              title={BackupsCopy.turnOnButton}
              icon={IconProp.Play}
              buttonStyle={ButtonStyleType.NORMAL}
              disabled={!props.canBackUp || props.isBusy}
              tooltip={
                props.canBackUp ? BackupsCopy.turnOnTooltip : props.lockedReason
              }
              dataTestId="backups-turn-on"
              onClick={() => {
                props.onSetEnabled(true);
              }}
            />
          )}
          <Button
            title={BackupsCopy.backUpNowButton}
            icon={IconProp.CloudArrowUp}
            buttonStyle={ButtonStyleType.PRIMARY}
            disabled={!props.canBackUp || props.isBusy}
            isLoading={props.isBusy}
            tooltip={
              props.canBackUp
                ? BackupsCopy.backUpNowTooltip
                : props.lockedReason
            }
            dataTestId="backups-back-up-now"
            onClick={props.onBackUpNow}
          />
        </>
      )}
      <MoreMenu
        menuIcon={IconProp.More}
        text=""
        ariaLabel={translator.translateText(BackupsCopy.statusTitle)}
        dataTestId="backups-status-more"
      >
        {[
          <MoreMenuItem
            key="find"
            icon={IconProp.MagnifyingGlass}
            text={BackupsCopy.findBackupsAction}
            onClick={props.onFindBackups}
          />,
          ...(isOn
            ? [
                <MoreMenuItem
                  key="off"
                  icon={IconProp.Stop}
                  text={BackupsCopy.turnOffAction}
                  isDisabled={!props.canBackUp}
                  onClick={() => {
                    props.onSetEnabled(false);
                  }}
                />,
              ]
            : []),
        ]}
      </MoreMenu>
    </div>
  );

  const getBody: () => ReactElement = (): ReactElement => {
    if (run) {
      const progress: BackupRunProgress = getBackupRunProgress(run);
      const isRestore: boolean = run.kind === BackupRunKind.Restore;
      const isQueued: boolean = run.status === BackupRunStatus.Queued;
      const stepTitle: string = progress.step
        ? translator.translateText(BACKUP_STEP_COPY[progress.step.key]) || ""
        : "";
      const written: number | undefined = progress.step?.progress?.doneBytes;

      return (
        <div
          className="flex min-w-0 items-start gap-4"
          data-testid="backups-status-running"
        >
          <StatusIcon icon={IconProp.Spinner} tone="indigo" isSpinning={true} />
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-gray-900">
              {isRestore
                ? run.manifest?.["startedAt"]
                  ? translator.translateTemplate(BackupsCopy.restoring, {
                      time: formatBackupDateTime(
                        new Date(String(run.manifest["startedAt"])),
                        clock,
                      ),
                    })
                  : translator.translateText(BackupsCopy.restoringPlain)
                : translator.translateText(BackupsCopy.backingUp)}
            </div>
            <div
              className="mt-1 text-sm text-gray-600"
              data-testid="backups-status-step"
            >
              {isQueued
                ? translator.translateText(BackupsCopy.queuedText)
                : translator.translateTemplate(BackupsCopy.stepOf, {
                    number: translator.formatNumber(progress.number),
                    total: translator.formatNumber(progress.total),
                    step: stepTitle,
                  })}
              {!isQueued && written !== undefined && written > 0 ? (
                <span className="text-gray-500">
                  {" · "}
                  {translator.translateTemplate(BackupsCopy.stepsWritten, {
                    size: formatBackupSize(written, translator.language),
                  })}
                </span>
              ) : (
                <></>
              )}
            </div>
            {progress.percent !== null ? (
              <div
                className="mt-3 h-2 w-full max-w-xl overflow-hidden rounded-full bg-gray-200"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.percent}
              >
                <div
                  className="h-2 rounded-full bg-indigo-600 transition-all"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            ) : (
              <></>
            )}
            {isRestore ? (
              <p className="mt-3 text-sm text-gray-500">
                {translator.translateText(BackupsCopy.restoreRunningNote)}
              </p>
            ) : (
              <></>
            )}
          </div>
        </div>
      );
    }

    const last: BackupRun | null = props.lastBackup;
    const title: string = lastFailed
      ? BackupsCopy.statusFailing
      : isOn
        ? BackupsCopy.statusOn
        : BackupsCopy.statusOff;
    const lines: Array<ReactElement> = [];

    if (last?.startedAt && !lastFailed) {
      const duration: number | null = getBackupRunDurationInMs(last, clock.now);

      lines.push(
        <div key="last" data-testid="backups-status-last">
          {translator.translateTemplate(BackupsCopy.lastBackup, {
            time: formatBackupTimeAgo(new Date(last.startedAt), clock),
          })}
          {duration !== null ? (
            <span className="text-gray-500">
              {" · "}
              {translator.translateTemplate(BackupsCopy.lastBackupSize, {
                size: formatBackupSize(
                  getBackupRunTotalSize(last),
                  translator.language,
                ),
                duration: formatBackupDuration(duration, translator.language),
              })}
            </span>
          ) : (
            <></>
          )}
        </div>,
      );
    } else if (!last) {
      lines.push(
        <div key="none" data-testid="backups-status-none">
          {translator.translateText(BackupsCopy.statusNoBackupYet)}
        </div>,
      );
    }

    if (lastFailed && last) {
      lines.push(
        <div
          key="failed"
          className="min-w-0"
          data-testid="backups-status-failed"
        >
          <span className="text-gray-700">
            {last.startedAt
              ? formatBackupTimeAgo(new Date(last.startedAt), clock)
              : ""}
          </span>
          {last.error ? (
            <span className="text-red-700">{` · ${last.error}`}</span>
          ) : (
            <></>
          )}
        </div>,
      );
    }

    lines.push(
      <div key="next" data-testid="backups-status-next">
        {isOn && props.nextBackupAt
          ? translator.translateTemplate(BackupsCopy.nextBackup, {
              time: `${formatBackupDateTime(new Date(props.nextBackupAt), clock)} (${formatBackupTimeUntil(new Date(props.nextBackupAt), clock)})`,
            })
          : isOn
            ? ""
            : translator.translateText(BackupsCopy.nextBackupOff)}
      </div>,
    );

    return (
      <div
        className="flex min-w-0 items-start gap-4"
        data-testid="backups-status-idle"
      >
        <StatusIcon
          icon={
            lastFailed
              ? IconProp.Error
              : isOn
                ? IconProp.CheckCircle
                : IconProp.PauseCircle
          }
          tone={lastFailed ? "red" : isOn ? "green" : "gray"}
        />
        <div className="min-w-0 flex-1">
          <div
            className="text-base font-semibold text-gray-900"
            data-testid="backups-status-title"
          >
            {translator.translateText(title)}
          </div>
          <div className="mt-1 space-y-0.5 break-words text-sm text-gray-600">
            {lines}
          </div>
          {lastFailed && last ? (
            <div className="mt-2 [&>button]:ml-0 [&>button]:md:ml-0">
              <Button
                title={BackupsCopy.viewStepsButton}
                icon={IconProp.ListBullet}
                buttonStyle={ButtonStyleType.LINK}
                dataTestId="backups-failed-view-steps"
                onClick={() => {
                  props.onViewSteps(last);
                }}
              />
            </div>
          ) : (
            <></>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="mb-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
      data-testid="backups-status"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">{getBody()}</div>
        {actions}
      </div>
    </div>
  );
};

export default BackupStatusCard;
