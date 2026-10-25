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
import CardMoreMenu from "Common/UI/Components/Card/CardMoreMenu";
import { getFeedClock } from "Common/UI/Components/Feed/FeedTime";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import { composedValue, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The top of the Backups page: how backups are doing, in one look. What
 * runs now (a backup or a restore, its step, how far, for how long), or
 * else whether backups are on, when the last one ran - or that it failed,
 * why, and the newest backup there still is to go back to - and when the
 * next one runs.
 *
 * One primary action: Back up now, or Turn on while the schedule is off
 * (what puts the page right again). The rest - Find backups, turning the
 * schedule off - is in the card's ⋯, the same button as every card's.
 */

export interface ComponentProps {
  setting: BackupSetting;
  // The run going on now, queued or running.
  activeRun: BackupRun | null;
  // The newest backup that finished, whatever its outcome.
  lastBackup: BackupRun | null;
  // The newest backup that succeeded: what a failed last one leaves to restore.
  newestSucceeded?: BackupRun | null | undefined;
  // The time the next scheduled backup runs (the overview's).
  nextBackupAt: string | null;
  // New backups and settings changes are allowed (the license includes backups).
  canBackUp: boolean;
  lockedReason?: string | undefined;
  /*
   * The page already says, above the card, that the license has paused new
   * backups and what still works: the card does not say it again.
   */
  isLicenseNoticeShown?: boolean | undefined;
  // Something is being sent: every action waits.
  isBusy: boolean;
  // Which one, so only its own button spins.
  isStarting?: boolean | undefined;
  isChangingSchedule?: boolean | undefined;
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

  const backUpNowButton: ReactElement = (
    <Button
      title={BackupsCopy.backUpNowButton}
      icon={IconProp.CloudArrowUp}
      // Off, turning the schedule back on comes first.
      buttonStyle={isOn ? ButtonStyleType.PRIMARY : ButtonStyleType.NORMAL}
      disabled={!props.canBackUp || props.isBusy}
      isLoading={Boolean(props.isStarting)}
      tooltip={
        props.canBackUp ? BackupsCopy.backUpNowTooltip : props.lockedReason
      }
      dataTestId="backups-back-up-now"
      onClick={props.onBackUpNow}
    />
  );

  const buttons: ReactElement = (
    <>
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
      ) : isOn ? (
        backUpNowButton
      ) : (
        <>
          <Button
            title={BackupsCopy.turnOnButton}
            icon={IconProp.Play}
            buttonStyle={ButtonStyleType.PRIMARY}
            disabled={!props.canBackUp || props.isBusy}
            isLoading={Boolean(props.isChangingSchedule)}
            tooltip={
              props.canBackUp ? BackupsCopy.turnOnTooltip : props.lockedReason
            }
            dataTestId="backups-turn-on"
            onClick={() => {
              props.onSetEnabled(true);
            }}
          />
          {backUpNowButton}
        </>
      )}
    </>
  );

  const moreMenu: ReactElement = (
    <CardMoreMenu
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
                icon={IconProp.PauseCircle}
                text={BackupsCopy.turnOffAction}
                isDisabled={!props.canBackUp}
                onClick={() => {
                  props.onSetEnabled(false);
                }}
              />,
            ]
          : []),
      ]}
    </CardMoreMenu>
  );

  const getBody: () => ReactElement = (): ReactElement => {
    if (run) {
      const progress: BackupRunProgress = getBackupRunProgress(run);
      const isRestore: boolean = run.kind === BackupRunKind.Restore;
      const isQueued: boolean = run.status === BackupRunStatus.Queued;
      const written: number | undefined = progress.step?.progress?.doneBytes;
      const elapsed: number | null = isQueued
        ? null
        : getBackupRunDurationInMs(run, clock.now);

      return (
        <div
          className="flex min-w-0 items-start gap-4"
          data-testid="backups-status-running"
        >
          <StatusIcon icon={IconProp.Spinner} tone="indigo" isSpinning={true} />
          <div className="min-w-0 flex-1">
            {/* The card's title, a heading as every card's is. */}
            <h2 className="text-base font-semibold text-gray-900">
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
            </h2>
            <div
              className="mt-1 text-sm text-gray-600"
              data-testid="backups-status-step"
            >
              {isQueued
                ? translator.translateText(BackupsCopy.queuedText)
                : translator.translateTemplate(BackupsCopy.stepOf, {
                    number: translator.formatNumber(progress.number),
                    total: translator.formatNumber(progress.total),
                    // The step's name in the sentence's language.
                    step: composedValue((sentence: Translator): string => {
                      return progress.step
                        ? sentence.translateText(
                            BACKUP_STEP_COPY[progress.step.key],
                          ) || ""
                        : "";
                    }),
                  })}
              {!isQueued && written !== undefined && written > 0 ? (
                <span className="text-gray-500">
                  {" · "}
                  {isRestore && progress.step?.progress?.totalBytes
                    ? translator.translateTemplate(BackupsCopy.stepsRead, {
                        done: formatBackupSize(written, translator.language),
                        total: formatBackupSize(
                          progress.step.progress.totalBytes,
                          translator.language,
                        ),
                      })
                    : translator.translateTemplate(BackupsCopy.stepsWritten, {
                        size: formatBackupSize(written, translator.language),
                      })}
                </span>
              ) : (
                <></>
              )}
            </div>
            {elapsed !== null ? (
              <div
                className="mt-0.5 text-sm text-gray-500"
                data-testid="backups-status-elapsed"
              >
                {translator.translateTemplate(BackupsCopy.runningFor, {
                  duration: formatBackupDuration(elapsed, translator.language),
                })}
              </div>
            ) : (
              <></>
            )}
            {progress.percent !== null ? (
              <div
                className="mt-3 h-2 w-full max-w-xl overflow-hidden rounded-full bg-gray-200"
                role="progressbar"
                aria-label={
                  progress.step
                    ? translator.translateText(
                        BACKUP_STEP_COPY[progress.step.key],
                      )
                    : undefined
                }
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
    /*
     * Without a license that includes backups nothing new runs, whatever
     * the schedule says: the card says so rather than promise a next backup.
     */
    const isLocked: boolean = !props.canBackUp;
    const title: string = lastFailed
      ? BackupsCopy.statusFailing
      : isLocked
        ? BackupsCopy.statusLocked
        : isOn
          ? BackupsCopy.statusOn
          : BackupsCopy.statusOff;
    const lines: Array<ReactElement> = [];

    if (last?.startedAt) {
      const duration: number | null = getBackupRunDurationInMs(last, clock.now);
      const goodBackup: BackupRun | null | undefined = props.newestSucceeded;

      lines.push(
        <div key="last" data-testid="backups-status-last">
          {translator.translateTemplate(BackupsCopy.lastBackup, {
            time: formatBackupTimeAgo(new Date(last.startedAt), clock),
          })}
          {lastFailed ? (
            /*
             * A failed backup leaves the one before it: how old that is is
             * what tells an operator how much a restore now would lose.
             */
            <span
              className="text-gray-500"
              data-testid="backups-status-last-good"
            >
              {" · "}
              {goodBackup?.startedAt
                ? translator.translateTemplate(BackupsCopy.lastGoodBackup, {
                    time: formatBackupTimeAgo(
                      new Date(goodBackup.startedAt),
                      clock,
                    ),
                  })
                : translator.translateText(BackupsCopy.noGoodBackup)}
            </span>
          ) : duration !== null ? (
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

    if (lastFailed && last?.error) {
      /*
       * Why, in the storage's or the database's own words: a few lines at
       * most here, the whole of it in View steps.
       */
      lines.push(
        <div
          key="failed"
          className="my-2 min-w-0 rounded-md bg-red-50 px-3 py-2 text-red-700"
          data-testid="backups-status-failed"
          title={last.error}
        >
          <span className="line-clamp-4 whitespace-pre-wrap" dir="auto">
            {last.error}
          </span>
        </div>,
      );
    }

    const next: string = isLocked
      ? props.isLicenseNoticeShown
        ? ""
        : translator.translateText(BackupsCopy.statusLockedText) || ""
      : isOn && props.nextBackupAt
        ? translator.translateTemplate(BackupsCopy.nextBackup, {
            time: `${formatBackupDateTime(new Date(props.nextBackupAt), clock)} (${formatBackupTimeUntil(new Date(props.nextBackupAt), clock)})`,
          })
        : isOn
          ? ""
          : translator.translateText(BackupsCopy.nextBackupOff) || "";

    if (next) {
      lines.push(
        <div key="next" data-testid="backups-status-next">
          {next}
        </div>,
      );
    }

    return (
      <div
        className="flex min-w-0 items-start gap-4"
        data-testid="backups-status-idle"
      >
        <StatusIcon
          icon={
            lastFailed
              ? IconProp.Error
              : isOn && !isLocked
                ? IconProp.CheckCircle
                : IconProp.PauseCircle
          }
          tone={lastFailed ? "red" : isOn && !isLocked ? "green" : "gray"}
        />
        <div className="min-w-0 flex-1">
          <h2
            className="text-base font-semibold text-gray-900"
            data-testid="backups-status-title"
          >
            {translator.translateText(title)}
          </h2>
          <div className="mt-1 space-y-0.5 break-words text-sm text-gray-600">
            {lines}
          </div>
          {lastFailed && last ? (
            <div className="mt-2 [&>button]:ml-0 [&>button]:pl-0 [&>button]:md:ml-0">
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

  /*
   * The ⋯ stays at the title's end at every width, as a card header's does;
   * the buttons sit between them on a wide screen and go under the text on
   * a narrow one, stacked full width on a phone like every page's buttons.
   * In the page's order they come before the ⋯, as they are read.
   */
  return (
    <div
      className="mb-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
      data-testid="backups-status"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-4 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="col-start-1 row-start-1 min-w-0">{getBody()}</div>
        <div
          className="col-span-2 col-start-1 row-start-2 flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center lg:col-span-1 lg:col-start-2 lg:row-start-1 [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0"
          data-testid="backups-status-actions"
        >
          {buttons}
        </div>
        <div className="col-start-2 row-start-1 flex justify-end lg:col-start-3">
          {moreMenu}
        </div>
      </div>
    </div>
  );
};

export default BackupStatusCard;
