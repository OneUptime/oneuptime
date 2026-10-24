import { BackupsCopy, RESTORE_ISSUE_COPY } from "./BackupsCopy";
import BackupsApi, { RestoreIssue, RestorePreview } from "./BackupsApi";
import {
  describeBackupCounts,
  formatBackupDateTime,
  formatBackupSize,
} from "./BackupFormat";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import IconProp from "Common/Types/Icon/IconProp";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import TypeToConfirmDelete, {
  isTypedNameConfirmed,
} from "Common/UI/Components/DeleteConfirmation/TypeToConfirmDelete";
import { getFeedClock } from "Common/UI/Components/Feed/FeedTime";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * Restore a backup: the one thing on the page that replaces data. So it
 * says, before anything happens, what goes back to when - PostgreSQL's
 * projects, monitors and users (with how many the backup holds, and how
 * many there are now), ClickHouse's telemetry - and what is lost; it backs
 * the current data up first unless that is unticked (and says what that
 * costs); it says what OneUptime does while it restores; and the Restore
 * button waits for "restore" to be typed.
 *
 * What it says comes from the server's own check of the backup (POST
 * /backup/restore-preview), read again when what is chosen changes; a
 * problem it finds (the files are gone, a newer OneUptime made the backup,
 * PostgreSQL's tools or user cannot restore it) keeps Restore locked.
 */

// What a master admin types to restore (the server checks it too).
export const RESTORE_CONFIRMATION_WORD: string = "restore";

export interface ComponentProps {
  backup: BackupRun;
  onClose: () => void;
  // The restore's run, queued.
  onStarted: (restoreRunId: string) => void;
}

// What the dialog says of a problem or warning: in the reader's language when the code is known.
export function describeRestoreIssue(data: {
  issue: RestoreIssue;
  translator: Translator;
}): { text: string; detail: string | null } {
  const copy: string | undefined = RESTORE_ISSUE_COPY[data.issue.code];

  if (!copy) {
    return { text: data.issue.message, detail: null };
  }

  return {
    text: data.translator.translateText(copy) || copy,
    // The tools' problem names the server's versions, which only its sentence holds.
    detail: data.issue.code === "tools-missing" ? data.issue.message : null,
  };
}

const IssueList: FunctionComponent<{
  issues: Array<RestoreIssue>;
  testId: string;
}> = (props: { issues: Array<RestoreIssue>; testId: string }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ul className="mt-1 list-disc space-y-1 pl-5" data-testid={props.testId}>
      {props.issues.map((issue: RestoreIssue) => {
        const described: { text: string; detail: string | null } =
          describeRestoreIssue({ issue, translator });

        return (
          <li key={issue.code} data-code={issue.code}>
            <span>{described.text}</span>
            {described.detail ? (
              <span className="mt-0.5 block break-words opacity-80">
                {described.detail}
              </span>
            ) : (
              <></>
            )}
          </li>
        );
      })}
    </ul>
  );
};

const ChoiceBox: FunctionComponent<{
  testId: string;
  title: string;
  isChecked: boolean;
  isAvailable: boolean;
  onChange: (value: boolean) => void;
  lines: Array<string>;
}> = (props: {
  testId: string;
  title: string;
  isChecked: boolean;
  isAvailable: boolean;
  onChange: (value: boolean) => void;
  lines: Array<string>;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className={
        props.isChecked && props.isAvailable
          ? "rounded-lg border border-indigo-300 bg-indigo-50/40 px-4 py-3"
          : "rounded-lg border border-gray-200 bg-white px-4 py-3"
      }
      data-testid={props.testId}
      data-checked={props.isChecked && props.isAvailable ? "true" : "false"}
    >
      <CheckboxElement
        title={props.title}
        value={props.isChecked && props.isAvailable}
        disabled={!props.isAvailable}
        hoverText={
          props.isAvailable ? undefined : BackupsCopy.restoreNotInBackup
        }
        dataTestId={`${props.testId}-checkbox`}
        onChange={props.onChange}
        description={
          <div className="space-y-0.5">
            {(props.isAvailable
              ? props.lines
              : [translator.translateText(BackupsCopy.restoreNotInBackup) || ""]
            ).map((line: string) => {
              return <div key={line}>{line}</div>;
            })}
          </div>
        }
      />
    </div>
  );
};

const RestoreBackupModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const clock: ReturnType<typeof getFeedClock> = getFeedClock({
    language: translator.language,
  });
  const backupHasPostgres: boolean = props.backup.includesPostgres !== false;
  const backupHasClickhouse: boolean = props.backup.includesClickhouse === true;

  const [includesPostgres, setIncludesPostgres] =
    useState<boolean>(backupHasPostgres);
  const [includesClickhouse, setIncludesClickhouse] =
    useState<boolean>(backupHasClickhouse);
  const [takeBackupFirst, setTakeBackupFirst] = useState<boolean>(true);
  const [typed, setTyped] = useState<string>("");
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState<boolean>(true);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const requestCount: React.MutableRefObject<number> = useRef<number>(0);

  const hasChoice: boolean = includesPostgres || includesClickhouse;

  useEffect(() => {
    if (!hasChoice || !props.backup.id) {
      setIsChecking(false);
      return;
    }

    const request: number = ++requestCount.current;
    setIsChecking(true);

    BackupsApi.getRestorePreview({
      backupRunId: props.backup.id.toString(),
      includesPostgres,
      includesClickhouse,
    })
      .then((next: RestorePreview) => {
        if (request === requestCount.current) {
          setPreview(next);
          setPreviewError(null);
          setIsChecking(false);
        }
      })
      .catch((err: unknown) => {
        if (request === requestCount.current) {
          setPreviewError(API.getFriendlyErrorMessage(err as Error));
          setIsChecking(false);
        }
      });
  }, [includesPostgres, includesClickhouse, props.backup.id?.toString()]);

  useEffect(() => {
    return () => {
      // A closed dialog ignores the answers still on their way.
      requestCount.current++;
    };
  }, []);

  const backupTime: string = props.backup.startedAt
    ? formatBackupDateTime(new Date(props.backup.startedAt), clock)
    : preview?.backup.startedAt
      ? formatBackupDateTime(new Date(preview.backup.startedAt), clock)
      : "";

  const problems: Array<RestoreIssue> = preview?.problems || [];
  const warnings: Array<RestoreIssue> = preview?.warnings || [];
  const isConfirmed: boolean = isTypedNameConfirmed({
    typed,
    name: RESTORE_CONFIRMATION_WORD,
  });
  const canRestore: boolean =
    hasChoice &&
    !isChecking &&
    !previewError &&
    Boolean(preview) &&
    problems.length === 0 &&
    isConfirmed &&
    !isStarting;

  const postgresLines: Array<string> = [
    translator.translateTemplate(BackupsCopy.restorePostgresText, {
      time: backupTime,
    }),
  ];
  const backupCounts: string = describeBackupCounts({
    counts: preview?.backup.postgres?.counts,
    translator,
  });
  const currentCounts: string = describeBackupCounts({
    counts: preview?.current.postgres?.counts,
    translator,
  });

  if (backupCounts) {
    postgresLines.push(
      `${translator.translateTemplate(BackupsCopy.restorePostgresCounts, {
        counts: backupCounts,
      })}${
        currentCounts
          ? ` ${translator.translateTemplate(BackupsCopy.restorePostgresNow, {
              counts: currentCounts,
            })}`
          : ""
      }`,
    );
  }

  const clickhouseSize: number | undefined =
    preview?.backup.clickhouse?.sizeInBytes ??
    props.backup.clickhouseSizeInBytes;

  const start: () => Promise<void> = async (): Promise<void> => {
    if (!canRestore || !props.backup.id) {
      return;
    }

    setError(undefined);
    setIsStarting(true);

    try {
      const restoreRunId: string = await BackupsApi.restore({
        backupRunId: props.backup.id.toString(),
        includesPostgres,
        includesClickhouse,
        takeBackupFirst,
        confirmation: typed.trim(),
      });

      setIsStarting(false);
      props.onStarted(restoreRunId);
    } catch (err) {
      setIsStarting(false);
      setError(API.getFriendlyErrorMessage(err as Error));
    }
  };

  return (
    <Modal
      title={translator.translateTemplate(BackupsCopy.restoreTitle, {
        time: backupTime,
      })}
      description={BackupsCopy.restoreDescription}
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      submitButtonText={BackupsCopy.restoreButton}
      submitButtonStyleType={ButtonStyleType.DANGER}
      disableSubmitButton={!canRestore}
      isLoading={isStarting}
      error={error}
      onSubmit={() => {
        void start();
      }}
    >
      <div className="space-y-5" data-testid="restore-backup-dialog">
        {isChecking && !preview ? (
          <div
            className="flex items-center gap-2 text-sm text-gray-500"
            role="status"
            data-testid="restore-backup-checking"
          >
            <Icon icon={IconProp.Spinner} className="h-4 w-4 animate-spin" />
            <span>{translator.translateText(BackupsCopy.restoreChecking)}</span>
          </div>
        ) : (
          <></>
        )}

        {previewError ? (
          <Alert
            type={AlertType.DANGER}
            strongTitle={BackupsCopy.restoreCannot}
            title={previewError}
            dataTestId="restore-backup-preview-error"
          />
        ) : (
          <></>
        )}

        {problems.length > 0 ? (
          <Alert
            type={AlertType.DANGER}
            strongTitle={BackupsCopy.restoreCannot}
            title={
              <IssueList issues={problems} testId="restore-backup-problems" />
            }
          />
        ) : (
          <></>
        )}

        {warnings.length > 0 ? (
          <Alert
            type={AlertType.WARNING}
            title={
              <IssueList issues={warnings} testId="restore-backup-warnings" />
            }
          />
        ) : (
          <></>
        )}

        <div>
          <div className="mb-2 text-sm font-medium text-gray-900">
            {translator.translateText(BackupsCopy.restoreWhatTitle)}
          </div>
          <div className="space-y-2">
            <ChoiceBox
              testId="restore-backup-postgres"
              title={BackupsCopy.restorePostgresTitle}
              isChecked={includesPostgres}
              isAvailable={backupHasPostgres}
              onChange={setIncludesPostgres}
              lines={postgresLines}
            />
            <ChoiceBox
              testId="restore-backup-clickhouse"
              title={BackupsCopy.restoreClickhouseTitle}
              isChecked={includesClickhouse}
              isAvailable={backupHasClickhouse}
              onChange={setIncludesClickhouse}
              lines={[
                translator.translateTemplate(
                  BackupsCopy.restoreClickhouseText,
                  {
                    size:
                      typeof clickhouseSize === "number"
                        ? formatBackupSize(clickhouseSize, translator.language)
                        : "—",
                  },
                ),
              ]}
            />
          </div>
          {hasChoice ? (
            <></>
          ) : (
            <p
              className="mt-2 text-sm text-red-700"
              data-testid="restore-backup-choose-something"
            >
              {translator.translateText(BackupsCopy.restoreChooseSomething)}
            </p>
          )}
        </div>

        <div
          className="rounded-lg border border-gray-200 px-4 py-3"
          data-testid="restore-backup-first"
        >
          <CheckboxElement
            title={BackupsCopy.restoreBackupFirstTitle}
            description={BackupsCopy.restoreBackupFirstText}
            value={takeBackupFirst}
            dataTestId="restore-backup-first-checkbox"
            onChange={setTakeBackupFirst}
          />
          {takeBackupFirst ? (
            <></>
          ) : (
            <p
              className="mt-2 flex items-start gap-2 text-sm text-amber-700"
              data-testid="restore-backup-without-backup"
            >
              <Icon
                icon={IconProp.Alert}
                className="mt-0.5 h-4 w-4 flex-none"
              />
              <span>
                {translator.translateText(
                  BackupsCopy.restoreWithoutBackupWarning,
                )}
              </span>
            </p>
          )}
        </div>

        <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
          <div className="font-medium text-gray-900">
            {translator.translateText(BackupsCopy.restoreWhileRunningTitle)}
          </div>
          <p className="mt-1">
            {translator.translateText(BackupsCopy.restoreWhileRunningText)}
          </p>
          {includesPostgres ? (
            <p className="mt-1">
              {translator.translateText(BackupsCopy.restoreSignInText)}
            </p>
          ) : (
            <></>
          )}
        </div>

        <TypeToConfirmDelete
          name={RESTORE_CONFIRMATION_WORD}
          value={typed}
          onChange={setTyped}
          onConfirm={() => {
            void start();
          }}
        />
      </div>
    </Modal>
  );
};

export default RestoreBackupModal;
