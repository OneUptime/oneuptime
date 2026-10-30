import { CLOUD_DRY_RUN_COPY } from "./CloudDryRunCopy";
import {
  AiRemediationCommandDryRun,
  AiRemediationDryRunStatus,
} from "Common/Types/AutoRemediation/AiRemediationCommandPlan";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { getEffectiveDryRunStatus } from "Common/Utils/AiRemediation/CloudChangeDryRunPlan";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The latest dry run of a cloud change a fix proposes, under the change on
 * the Remediation card: being checked, would run, would be refused, or
 * could not finish - each saying nothing was changed - and what the agent
 * said, in its own words, below it (what the change would call and how it
 * would be undone, or why it would not run).
 */

export const CLOUD_DRY_RUN_NOTE_TEST_ID: string = "remediation-dry-run";

export interface ComponentProps {
  dryRun: AiRemediationCommandDryRun;
  // The time it is read at (tests pin it); now when absent.
  now?: Date | undefined;
}

const CloudDryRunNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const now: Date = props.now || OneUptimeDate.getCurrentDate();
  const status: AiRemediationDryRunStatus = getEffectiveDryRunStatus(
    props.dryRun,
    now,
  );
  const checkedAt: Date = new Date(props.dryRun.checkedAt);
  const time: string = Number.isFinite(checkedAt.getTime())
    ? OneUptimeDate.fromNow(checkedAt)
    : "";
  const summary: string = (props.dryRun.summary || "").trim();

  if (status === AiRemediationDryRunStatus.Running) {
    return (
      <div
        className="mt-2 flex items-center gap-2 text-xs text-gray-600"
        data-testid={CLOUD_DRY_RUN_NOTE_TEST_ID}
        data-status={status}
        role="status"
      >
        <Icon
          icon={IconProp.Spinner}
          className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-gray-400"
        />
        <span>{translator.translateText(CLOUD_DRY_RUN_COPY.running)}</span>
      </div>
    );
  }

  const isRefused: boolean =
    status === AiRemediationDryRunStatus.WouldBeRefused;
  const isFailed: boolean = status === AiRemediationDryRunStatus.Failed;

  const headline: string = translator.translateTemplate(
    isRefused
      ? CLOUD_DRY_RUN_COPY.wouldBeRefused
      : isFailed
        ? CLOUD_DRY_RUN_COPY.failed
        : CLOUD_DRY_RUN_COPY.wouldRun,
    { time },
  );

  return (
    <div
      className={`mt-2 rounded border px-2 py-1.5 text-xs ${
        isRefused
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-gray-200 bg-white text-gray-700"
      }`}
      data-testid={CLOUD_DRY_RUN_NOTE_TEST_ID}
      data-status={status}
    >
      <div className="flex items-start gap-1.5">
        <Icon
          icon={
            isRefused
              ? IconProp.Alert
              : isFailed
                ? IconProp.Info
                : IconProp.CheckCircle
          }
          className={`mt-px h-3.5 w-3.5 flex-shrink-0 ${
            isRefused
              ? "text-amber-600"
              : isFailed
                ? "text-gray-400"
                : "text-emerald-600"
          }`}
        />
        <span
          className="font-medium"
          data-testid={`${CLOUD_DRY_RUN_NOTE_TEST_ID}-headline`}
        >
          {headline}
        </span>
      </div>
      {summary ? (
        <div className="mt-1 pl-5">
          <div className="sr-only">
            {translator.translateText(CLOUD_DRY_RUN_COPY.agentSaid)}
          </div>
          <p
            className={`whitespace-pre-line break-words ${
              isRefused ? "text-amber-800" : "text-gray-500"
            }`}
            data-testid={`${CLOUD_DRY_RUN_NOTE_TEST_ID}-summary`}
          >
            {summary}
          </p>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default CloudDryRunNote;
