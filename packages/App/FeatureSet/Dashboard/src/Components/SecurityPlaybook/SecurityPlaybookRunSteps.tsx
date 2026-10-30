import SecurityCaseApi from "../SecurityCase/SecurityCaseApi";
import { SecurityPlaybookStepStatusPill } from "../SecurityCase/SecurityCasePills";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { getSecurityEntityIcon } from "Common/Types/SecurityCase/SecurityEntity";
import {
  SecurityPlaybookActionDefinition,
  getSecurityPlaybookUndoAction,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookApprovalDecision,
  SecurityPlaybookStepResult,
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
  wasContainedByStep,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookStepResult";
import {
  RunStepRow,
  UNDO_BUTTON_TITLES,
  getRunStepRows,
  getSkippedRunIf,
} from "./SecurityPlaybookRunStepRows";
import SecurityPlaybookStepFlag from "./SecurityPlaybookStepFlag";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import LazyMarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

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

/*
 * What a target's line says after its value: why a waiting step picked it,
 * that it is protected or left out, or what the product did with it.
 */
export function describeRunTarget(
  target: SecurityPlaybookTarget,
  translator: Translator,
): string {
  switch (target.state) {
    case SecurityPlaybookTargetState.Proposed:
      return target.reason === SecurityPlaybookTargetReason.ThreatIntel
        ? translator.translateText("Known to threat intel") ||
            "Known to threat intel"
        : translator.translateText("What the case is grouped on") ||
            "What the case is grouped on";
    case SecurityPlaybookTargetState.Protected:
      return target.protectedBy &&
        target.protectedBy.toLowerCase() !== target.value.toLowerCase()
        ? translator.translateTemplate(
            "Protected (matches {{pattern}}): never acted on",
            { pattern: target.protectedBy },
          )
        : translator.translateText("Protected: never acted on") ||
            "Protected: never acted on";
    case SecurityPlaybookTargetState.LeftOut:
      return (
        translator.translateText("Left out by the approver") ||
        "Left out by the approver"
      );
    default:
      // What the product said, in its own words: "suspended", or its refusal.
      return target.detail || target.state;
  }
}

function targetTextClass(state: SecurityPlaybookTargetState): string {
  switch (state) {
    case SecurityPlaybookTargetState.Done:
    case SecurityPlaybookTargetState.AlreadyDone:
      return "text-emerald-700";
    case SecurityPlaybookTargetState.Failed:
    case SecurityPlaybookTargetState.NotFound:
      return "text-red-700";
    default:
      return "text-gray-500";
  }
}

export interface ComponentProps {
  steps: JSONArray | undefined;
  stepResults: JSONArray | undefined;
  // For the undo on a contained target; without these the list only reads.
  runId?: ObjectID | undefined;
  canUndo?: boolean | undefined;
  undoDisabledReason?: string | undefined;
  onChanged?: (() => void) | undefined;
}

interface PendingUndo {
  row: RunStepRow;
  target: SecurityPlaybookTarget;
  undo: SecurityPlaybookActionDefinition;
}

/*
 * The run's steps as a vertical checklist, each with what it did. A step
 * that acts on users or hosts lists its targets, each with what became of
 * it; a contained one can be released with one click - the step's undo,
 * through the same connection - once the run has stopped.
 */
const SecurityPlaybookRunSteps: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);
  const [undoError, setUndoError] = useState<string>("");
  const [isUndoing, setIsUndoing] = useState<boolean>(false);

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
    <>
      <ol className="relative space-y-3">
        {rows.map((row: RunStepRow): ReactElement => {
          const status: string | undefined = row.result?.status;
          const marker: { icon: IconProp; className: string } =
            getMarker(status);
          /*
           * Skipped because of what an earlier step found: the step card's
           * own words, in place of the run's English sentence.
           */
          const skippedRunIf: string | undefined = getSkippedRunIf({
            rows,
            row,
            translator,
          });
          const detail: string | undefined = skippedRunIf
            ? undefined
            : row.result?.error || row.result?.message;
          // A skipped step never got as far as asking anyone.
          const showsApproval: boolean =
            row.requiresApproval &&
            status !== SecurityPlaybookStepStatus.Skipped;
          const approval: SecurityPlaybookStepResult["approval"] =
            row.result?.approval;
          const targets: Array<SecurityPlaybookTarget> =
            row.result?.targets || [];
          const undo: SecurityPlaybookActionDefinition | undefined =
            getSecurityPlaybookUndoAction(row.action);

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
                    {translator.translateTemplate(
                      "Step {{number}}: {{title}}",
                      {
                        number: translator.formatNumber(row.index + 1),
                        title: translator.translateText(row.title) || row.title,
                      },
                    )}
                  </span>
                  {status && status !== SecurityPlaybookStepStatus.Pending ? (
                    <SecurityPlaybookStepStatusPill
                      value={status}
                      isMinimal={true}
                    />
                  ) : (
                    <></>
                  )}
                  {showsApproval ? (
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
                {skippedRunIf ? (
                  <div className="mt-1.5">
                    <SecurityPlaybookStepFlag
                      icon={IconProp.Condition}
                      text={skippedRunIf}
                      isTranslated={true}
                      dataTestId={`security-playbook-run-step-${row.index}-run-if`}
                    />
                  </div>
                ) : (
                  <></>
                )}
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
                {targets.length > 0 ? (
                  <ul
                    className="mt-2 divide-y divide-gray-100 rounded-md border border-gray-200"
                    data-testid={`security-playbook-run-step-${row.index}-targets`}
                  >
                    {targets.map(
                      (target: SecurityPlaybookTarget): ReactElement => {
                        const canBeUndone: boolean = Boolean(
                          undo && wasContainedByStep(target),
                        );

                        return (
                          <li
                            key={target.value}
                            className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <Icon
                                icon={getSecurityEntityIcon(target.type)}
                                className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                              />
                              <span className="break-all font-mono text-xs text-gray-900">
                                {target.value}
                              </span>
                              <span
                                className={`text-xs ${targetTextClass(target.state)}`}
                              >
                                {describeRunTarget(target, translator)}
                              </span>
                            </div>
                            {canBeUndone && undo && props.runId ? (
                              <Button
                                title={UNDO_BUTTON_TITLES[undo.type] || "Undo"}
                                icon={IconProp.ArrowUturnLeft}
                                buttonStyle={ButtonStyleType.NORMAL}
                                buttonSize={ButtonSize.Small}
                                disabled={!props.canUndo || isUndoing}
                                tooltip={
                                  props.canUndo
                                    ? undefined
                                    : props.undoDisabledReason
                                }
                                dataTestId={`security-playbook-undo-${target.value}`}
                                onClick={() => {
                                  setUndoError("");
                                  setPendingUndo({ row, target, undo });
                                }}
                              />
                            ) : (
                              <></>
                            )}
                          </li>
                        );
                      },
                    )}
                  </ul>
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

      {undoError ? (
        <p className="mt-3 text-sm text-red-700">{undoError}</p>
      ) : (
        <></>
      )}

      {pendingUndo && props.runId ? (
        <ConfirmModal
          title={
            translator.translateText(pendingUndo.undo.title) ||
            pendingUndo.undo.title
          }
          description={translator.translateTemplate(
            translationKey(
              "{{value}} gets its access back, undoing step {{number}}. Do it once the threat is gone. It is kept on the case's timeline and in the audit log.",
            ),
            {
              value: pendingUndo.target.value,
              number: pendingUndo.row.index + 1,
            },
          )}
          submitButtonText={UNDO_BUTTON_TITLES[pendingUndo.undo.type] || "Undo"}
          submitButtonType={ButtonStyleType.PRIMARY}
          onClose={() => {
            setPendingUndo(null);
          }}
          onSubmit={async () => {
            const chosen: PendingUndo = pendingUndo;
            setPendingUndo(null);
            setIsUndoing(true);

            try {
              await SecurityCaseApi.undoTarget({
                runId: props.runId!,
                stepId: chosen.row.stepId,
                value: chosen.target.value,
              });
            } catch (err) {
              setUndoError(API.getFriendlyMessage(err));
            }

            setIsUndoing(false);

            if (props.onChanged) {
              props.onChanged();
            }
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default SecurityPlaybookRunSteps;
