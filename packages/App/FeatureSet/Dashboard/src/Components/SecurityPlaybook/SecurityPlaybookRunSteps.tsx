import { SecurityPlaybookStepStatusPill } from "../SecurityCase/SecurityCasePills";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray } from "Common/Types/JSON";
import { SecurityPlaybookStepStatus } from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookApprovalDecision,
  SecurityPlaybookStepResult,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookStepResult";
import { RunStepRow, getRunStepRows } from "./SecurityPlaybookRunStepRows";
import Icon from "Common/UI/Components/Icon/Icon";
import LazyMarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

function getMarker(status: string | undefined): {
  icon: IconProp;
  className: string;
} {
  switch (status) {
    case SecurityPlaybookStepStatus.Succeeded:
      return { icon: IconProp.Check, className: "bg-emerald-500 text-white" };
    case SecurityPlaybookStepStatus.Failed:
    case SecurityPlaybookStepStatus.Rejected:
      return { icon: IconProp.Close, className: "bg-red-500 text-white" };
    case SecurityPlaybookStepStatus.WaitingForApproval:
      return {
        icon: IconProp.Pause,
        className: "bg-amber-400 text-white",
      };
    case SecurityPlaybookStepStatus.Running:
      return {
        icon: IconProp.Play,
        className: "bg-indigo-500 text-white animate-pulse",
      };
    case SecurityPlaybookStepStatus.Skipped:
      return {
        icon: IconProp.ChevronRight,
        className: "bg-gray-200 text-gray-500",
      };
    default:
      return {
        icon: IconProp.Circle,
        className: "border border-gray-300 bg-white text-gray-300",
      };
  }
}

export interface ComponentProps {
  steps: JSONArray | undefined;
  stepResults: JSONArray | undefined;
}

// The run's steps as a vertical checklist, each with what it did.
const SecurityPlaybookRunSteps: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const rows: Array<RunStepRow> = getRunStepRows({
    steps: props.steps,
    stepResults: props.stepResults,
  });

  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        {translator.translateText("This run has no steps.")}
      </p>
    );
  }

  return (
    <ol className="relative space-y-3">
      {rows.map((row: RunStepRow): ReactElement => {
        const status: string | undefined = row.result?.status;
        const marker: { icon: IconProp; className: string } = getMarker(status);
        const detail: string | undefined =
          row.result?.error || row.result?.message;
        const approval: SecurityPlaybookStepResult["approval"] =
          row.result?.approval;

        return (
          <li
            key={row.index}
            className="flex gap-3"
            data-testid={`security-playbook-run-step-${row.index}`}
          >
            <span
              className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${marker.className}`}
            >
              <Icon icon={marker.icon} className="h-3 w-3" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-900">
                  {translator.translateTemplate("Step {{number}}: {{title}}", {
                    number: row.index + 1,
                    title: translator.translateText(row.title) || row.title,
                  })}
                </span>
                {status && status !== SecurityPlaybookStepStatus.Pending ? (
                  <SecurityPlaybookStepStatusPill
                    value={status}
                    isMinimal={true}
                  />
                ) : (
                  <></>
                )}
                {row.requiresApproval ? (
                  <span
                    className="inline-flex items-center gap-1 text-xs text-gray-500"
                    title={translator.translateText(
                      "This step waits for a person to approve it.",
                    )}
                  >
                    <Icon icon={IconProp.Lock} className="h-3 w-3" />
                    {translator.translateText("Needs approval")}
                  </span>
                ) : (
                  <></>
                )}
              </div>
              {detail ? (
                <div
                  className={`mt-1 text-sm ${
                    row.result?.error ? "text-red-700" : "text-gray-600"
                  }`}
                >
                  <LazyMarkdownViewer text={detail} />
                </div>
              ) : (
                <></>
              )}
              {approval ? (
                <p className="mt-1 text-xs text-gray-500">
                  {approval.decision ===
                  SecurityPlaybookApprovalDecision.Approved
                    ? translator.translateText("Approved")
                    : translator.translateText("Rejected")}
                  {approval.comment ? ` · “${approval.comment}”` : ""}
                </p>
              ) : (
                <></>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default SecurityPlaybookRunSteps;
