import {
  BACKUP_PLURALS,
  BACKUP_RUN_STATUS_COPY,
  BACKUP_RUN_TRIGGER_COPY,
  BACKUP_STEP_COPY,
  BackupsCopy,
} from "./BackupsCopy";
import {
  formatBackupDateTime,
  formatBackupDuration,
  formatBackupSize,
  getBackupRunDurationInMs,
  getBackupRunStatusColor,
} from "./BackupFormat";
import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupRunTrigger,
  BackupStep,
  BackupStepKey,
  BackupStepStatus,
  isBackupRunActive,
  readBackupSteps,
} from "Common/Types/Backup/BackupRunTypes";
import IconProp from "Common/Types/Icon/IconProp";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import { getFeedClock } from "Common/UI/Components/Feed/FeedTime";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * View steps: a backup's or a restore's steps, one under the other, each
 * with how it went - done, running (and how far), failed (and why),
 * skipped, waiting - how long it took and what it found. While the run is
 * going on the dialog reads it again every few seconds.
 */

export const BACKUP_STEPS_POLL_INTERVAL_IN_MS: number = 2500;

export interface ComponentProps {
  run: BackupRun;
  onClose: () => void;
}

const STEP_SELECT: {
  [key: string]: true;
} = {
  _id: true,
  kind: true,
  trigger: true,
  status: true,
  steps: true,
  startedAt: true,
  finishedAt: true,
  location: true,
  error: true,
  manifest: true,
  includesPostgres: true,
  includesClickhouse: true,
  postgresSizeInBytes: true,
  clickhouseSizeInBytes: true,
};

const StepIcon: FunctionComponent<{ status: BackupStepStatus }> = (props: {
  status: BackupStepStatus;
}): ReactElement => {
  switch (props.status) {
    case BackupStepStatus.Succeeded:
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
          <Icon icon={IconProp.Check} className="h-4 w-4" />
        </div>
      );
    case BackupStepStatus.Failed:
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-50 text-red-700">
          <Icon icon={IconProp.Close} className="h-4 w-4" />
        </div>
      );
    case BackupStepStatus.Running:
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
          <Icon icon={IconProp.Spinner} className="h-4 w-4 animate-spin" />
        </div>
      );
    case BackupStepStatus.Skipped:
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-400">
          <Icon icon={IconProp.Minus} className="h-4 w-4" />
        </div>
      );
    default:
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 bg-white" />
      );
  }
};

export function describeStepFacts(data: {
  step: BackupStep;
  translator: Translator;
  now: Date;
}): Array<string> {
  const facts: Array<string> = [];
  const step: BackupStep = data.step;
  const progress: BackupStep["progress"] = step.progress;

  if (step.startedAt && step.status !== BackupStepStatus.Skipped) {
    const end: Date = step.finishedAt ? new Date(step.finishedAt) : data.now;
    const duration: number = Math.max(
      0,
      end.getTime() - new Date(step.startedAt).getTime(),
    );

    if (step.finishedAt || step.status === BackupStepStatus.Running) {
      facts.push(formatBackupDuration(duration, data.translator.language));
    }
  }

  if (progress?.doneBytes !== undefined && progress.doneBytes > 0) {
    facts.push(
      progress.totalBytes &&
        step.status === BackupStepStatus.Running &&
        progress.doneBytes < progress.totalBytes &&
        // A dump is compressed: the database's size says nothing of how far it is.
        step.key !== BackupStepKey.BackUpPostgres
        ? data.translator.translateTemplate(BackupsCopy.stepsRead, {
            done: formatBackupSize(
              progress.doneBytes,
              data.translator.language,
            ),
            total: formatBackupSize(
              progress.totalBytes,
              data.translator.language,
            ),
          })
        : formatBackupSize(progress.doneBytes, data.translator.language),
    );
  }

  if (progress?.doneFiles !== undefined && progress.doneFiles > 0) {
    facts.push(
      data.translator.translatePlural(BACKUP_PLURALS.files, progress.doneFiles),
    );
  }

  return facts;
}

const BackupRunStepsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [run, setRun] = useState<BackupRun>(props.run);
  const [now, setNow] = useState<Date>(new Date());
  const clock: ReturnType<typeof getFeedClock> = getFeedClock({
    language: translator.language,
    now,
  });
  const isActive: boolean = isBackupRunActive(run.status);

  useEffect(() => {
    if (!isActive || !props.run.id) {
      return;
    }

    let isMounted: boolean = true;

    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      AdminModelAPI.getItem<BackupRun>({
        modelType: BackupRun,
        id: props.run.id!,
        select: STEP_SELECT,
      })
        .then((next: BackupRun | null) => {
          if (isMounted && next) {
            setRun(next);
          }
        })
        .catch(() => {
          // Asked again with the next tick: a restore's switch-over drops connections for a moment.
        });

      if (isMounted) {
        setNow(new Date());
      }
    }, BACKUP_STEPS_POLL_INTERVAL_IN_MS);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [isActive, props.run.id]);

  const steps: Array<BackupStep> = readBackupSteps(run.steps);
  const status: BackupRunStatus = run.status || BackupRunStatus.Queued;
  const isRestore: boolean = run.kind === BackupRunKind.Restore;
  const backupTime: unknown = isRestore
    ? run.manifest?.["startedAt"]
    : run.startedAt;
  const timeText: string = backupTime
    ? formatBackupDateTime(new Date(String(backupTime)), clock)
    : "";
  const duration: number | null = getBackupRunDurationInMs(run, now);
  /*
   * The run's error on its own, unless the step it stopped on already says
   * it: an error with no step behind it (the worker stopped, a cancel).
   */
  const showsErrorBox: boolean = Boolean(
    run.error &&
      status !== BackupRunStatus.Running &&
      !steps.some((step: BackupStep): boolean => {
        return step.message === run.error;
      }),
  );

  return (
    <Modal
      title={translator.translateTemplate(
        isRestore
          ? BackupsCopy.stepsTitleRestore
          : BackupsCopy.stepsTitleBackup,
        { time: timeText },
      )}
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText={BackupsCopy.close}
      leftFooterElement={
        run.error ? (
          <CopyTextButton
            textToBeCopied={run.error}
            label={BackupsCopy.copyError}
            size="md"
            variant="soft"
          />
        ) : undefined
      }
    >
      <div className="space-y-5" data-testid="backup-run-steps">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600">
          <Pill
            color={getBackupRunStatusColor(status)}
            text={BACKUP_RUN_STATUS_COPY[status].title}
            tooltip={BACKUP_RUN_STATUS_COPY[status].description}
          />
          <span>
            {translator.translateText(
              BACKUP_RUN_TRIGGER_COPY[run.trigger || BackupRunTrigger.Manual],
            )}
          </span>
          {run.startedAt ? (
            <span>
              {translator.translateTemplate(BackupsCopy.stepsStarted, {
                time: formatBackupDateTime(new Date(run.startedAt), clock),
              })}
            </span>
          ) : (
            <></>
          )}
          {run.finishedAt && duration !== null ? (
            <span>
              {translator.translateTemplate(BackupsCopy.stepsTook, {
                duration: formatBackupDuration(duration, translator.language),
              })}
            </span>
          ) : (
            <></>
          )}
        </div>

        {run.location ? (
          <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {translator.translateText(BackupsCopy.stepsWhere)}
              </div>
              <div
                className="break-all text-sm text-gray-900"
                data-testid="backup-run-location"
              >
                {run.location}
              </div>
            </div>
            <CopyTextButton
              textToBeCopied={run.location}
              label={BackupsCopy.copyLocation}
              size="sm"
              variant="ghost"
            />
          </div>
        ) : (
          <></>
        )}

        <ol className="space-y-0" data-testid="backup-run-step-list">
          {steps.map((step: BackupStep, index: number) => {
            const facts: Array<string> = describeStepFacts({
              step,
              translator,
              now,
            });
            const isLast: boolean = index === steps.length - 1;

            return (
              <li
                key={step.key}
                className="relative flex gap-3 pb-5"
                data-testid={`backup-run-step-${step.key}`}
                data-status={step.status}
              >
                {isLast ? (
                  <></>
                ) : (
                  <div
                    className="absolute left-3 top-7 -ml-px h-[calc(100%-1.75rem)] w-0.5 bg-gray-200"
                    aria-hidden="true"
                  />
                )}
                <div className="relative flex-none">
                  <StepIcon status={step.status} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span
                      className={
                        step.status === BackupStepStatus.Skipped ||
                        step.status === BackupStepStatus.Pending
                          ? "text-sm font-medium text-gray-500"
                          : "text-sm font-medium text-gray-900"
                      }
                    >
                      {translator.translateText(BACKUP_STEP_COPY[step.key])}
                    </span>
                    {step.status === BackupStepStatus.Skipped ? (
                      <span className="text-xs text-gray-400">
                        {translator.translateText(BackupsCopy.stepsSkipped)}
                      </span>
                    ) : step.status === BackupStepStatus.Pending ? (
                      <span className="text-xs text-gray-400">
                        {translator.translateText(BackupsCopy.stepsWaiting)}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">
                        {facts.join(" · ")}
                      </span>
                    )}
                  </div>
                  {step.message && step.status !== BackupStepStatus.Pending ? (
                    <p
                      className={
                        step.status === BackupStepStatus.Failed
                          ? "mt-1 whitespace-pre-wrap break-words rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
                          : "mt-1 break-words text-sm text-gray-600"
                      }
                      data-testid={`backup-run-step-message-${step.key}`}
                    >
                      {step.message}
                    </p>
                  ) : (
                    <></>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {showsErrorBox ? (
          <div
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3"
            data-testid="backup-run-error-box"
          >
            <div className="text-sm font-medium text-red-700">
              {translator.translateText(BackupsCopy.errorTitle)}
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm text-red-700">
              {run.error}
            </pre>
          </div>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default BackupRunStepsModal;
