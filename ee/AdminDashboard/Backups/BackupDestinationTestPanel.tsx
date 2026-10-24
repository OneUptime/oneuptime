import { BackupsCopy } from "./BackupsCopy";
import BackupsApi, { BackupTestCheck, BackupTestResult } from "./BackupsApi";
import { auditLogExportTestSettingsKey } from "../../Dashboard/AuditLogExport/AuditLogExportTest";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * "Test the destination", inside the form, before anything is saved: the
 * server does once, small, what a backup does (POST /backup/test) - writes,
 * reads, lists and deletes a test file; checks pg_dump fits PostgreSQL; has
 * ClickHouse write a test backup of its tables' definitions - and each check
 * says what it did or what to change.
 *
 * A result is shown only while the form still holds the settings it was
 * sent with: a green check beside a key pasted since would say something it
 * never checked.
 */

export const BACKUP_TEST_CHECK_TITLES: Record<BackupTestCheck["key"], string> =
  {
    storage: BackupsCopy.testStorageCheck,
    postgres: BackupsCopy.testPostgresCheck,
    clickhouse: BackupsCopy.testClickhouseCheck,
  };

export const BackupTestResultBox: FunctionComponent<{
  result: BackupTestResult;
  // A refusal before any check ran (a setting missing, the license).
  refusal?: string | undefined;
}> = (props: {
  result: BackupTestResult;
  refusal?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const isSuccessful: boolean = props.result.isSuccessful && !props.refusal;

  return (
    <div
      role="status"
      data-testid="backup-test-result"
      data-successful={isSuccessful ? "true" : "false"}
      className={
        isSuccessful
          ? "overflow-hidden rounded-lg border border-emerald-200 bg-white"
          : "overflow-hidden rounded-lg border border-red-200 bg-white"
      }
    >
      <div
        className={
          isSuccessful
            ? "flex items-start gap-2 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
            : "flex items-start gap-2 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
        }
      >
        <Icon
          icon={isSuccessful ? IconProp.CheckCircle : IconProp.Error}
          className="mt-0.5 h-4 w-4 flex-none"
        />
        <span className="min-w-0 break-words">
          {props.refusal ||
            translator.translateText(
              isSuccessful ? BackupsCopy.testSucceeded : BackupsCopy.testFailed,
            )}
        </span>
      </div>
      {props.result.checks.length > 0 ? (
        <ul className="divide-y divide-gray-100">
          {props.result.checks.map((check: BackupTestCheck) => {
            return (
              <li
                key={check.key}
                className="flex items-start gap-3 px-4 py-3"
                data-testid={`backup-test-check-${check.key}`}
                data-successful={check.isSuccessful ? "true" : "false"}
              >
                <div
                  className={
                    check.isSuccessful
                      ? "mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-emerald-50 text-emerald-700"
                      : "mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-red-50 text-red-700"
                  }
                >
                  <Icon
                    icon={check.isSuccessful ? IconProp.Check : IconProp.Close}
                    className="h-3.5 w-3.5"
                  />
                </div>
                <div className="min-w-0 text-sm">
                  <div className="font-medium text-gray-900">
                    {translator.translateText(
                      BACKUP_TEST_CHECK_TITLES[check.key] || check.key,
                    )}
                  </div>
                  <div
                    className={
                      check.isSuccessful
                        ? "mt-0.5 break-words text-gray-600"
                        : "mt-0.5 whitespace-pre-wrap break-words text-red-700"
                    }
                  >
                    {check.message}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <></>
      )}
    </div>
  );
};

export interface ComponentProps {
  // What is sent: the form's settings the moment Test is pressed.
  buildBody: () => JSONObject;
  disabledReason?: string | undefined;
}

const BackupDestinationTestPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [result, setResult] = useState<{
    key: string;
    value: BackupTestResult;
    refusal?: string | undefined;
  } | null>(null);
  const settingsKey: string = auditLogExportTestSettingsKey(props.buildBody);

  const test: () => Promise<void> = async (): Promise<void> => {
    const key: string = settingsKey;
    setIsTesting(true);

    try {
      setResult({ key, value: await BackupsApi.test(props.buildBody()) });
    } catch (err) {
      setResult({
        key,
        value: { isSuccessful: false, checks: [] },
        refusal: API.getFriendlyErrorMessage(err as Error),
      });
    }

    setIsTesting(false);
  };

  return (
    <div className="space-y-3" data-testid="backup-destination-test">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
        <Button
          title={isTesting ? BackupsCopy.testRunning : BackupsCopy.testButton}
          icon={IconProp.PaperAirplane}
          buttonStyle={ButtonStyleType.NORMAL}
          isLoading={isTesting}
          disabled={Boolean(props.disabledReason) || isTesting}
          dataTestId="backup-destination-test-button"
          onClick={() => {
            void test();
          }}
        />
        <p
          className="text-xs text-gray-500"
          data-testid="backup-destination-test-hint"
        >
          {translator.translateText(
            props.disabledReason || BackupsCopy.testHint,
          )}
        </p>
      </div>
      {!isTesting && result && result.key === settingsKey ? (
        <BackupTestResultBox result={result.value} refusal={result.refusal} />
      ) : (
        <></>
      )}
    </div>
  );
};

export default BackupDestinationTestPanel;
