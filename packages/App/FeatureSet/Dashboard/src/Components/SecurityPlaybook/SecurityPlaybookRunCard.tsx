import SecurityCaseApi from "../SecurityCase/SecurityCaseApi";
import { SecurityPlaybookRunStatusPill } from "../SecurityCase/SecurityCasePills";
import {
  RunStepsSummary,
  didStartRun,
  getApprovalTargets,
  getRunStepRows,
  summarizeRunSteps,
} from "./SecurityPlaybookRunStepRows";
import SecurityPlaybookRunSteps, {
  describeRunTarget,
} from "./SecurityPlaybookRunSteps";
import SecurityPlaybookRun from "Common/Models/DatabaseModels/SecurityPlaybookRun";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SecurityPlaybookRunStatus, {
  isFinishedSecurityPlaybookRunStatus,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { SecurityPlaybookTarget } from "Common/Types/SecurityPlaybook/SecurityPlaybookStepResult";
import { CategoryCheckboxOption } from "Common/UI/Components/CategoryCheckbox/CategoryCheckboxTypes";
import Field from "Common/UI/Components/Forms/Types/Field";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";

export interface ComponentProps {
  run: SecurityPlaybookRun;
  onChanged: () => void;
  // The case's number, when the card is shown away from its case.
  caseLink?: ReactElement | undefined;
  /*
   * What the card is called, in place of the playbook's name: on a
   * playbook's own page every run is that playbook's, and the case each ran
   * on is what tells them apart.
   */
  heading?: ReactElement | undefined;
  /*
   * In a list of runs - every run of the project, a playbook's latest - a
   * run is its header and a line of how far it got, its steps a click away:
   * fifty runs drawn whole, every step of each, made a page nobody could
   * scan. A run waiting for approval opens, since its steps are what the
   * approver decides on. A case's own runs are drawn whole.
   */
  isCollapsible?: boolean | undefined;
}

export const RUN_CARD_STEPS_TOGGLE_TEST_ID: string =
  "security-playbook-run-steps-toggle";
export const RUN_CARD_SUMMARY_TEST_ID: string = "security-playbook-run-summary";

type Decision = "approve" | "reject";

// The form key of the approval's target list.
export const APPROVAL_TARGETS_FIELD: string = "targets";

/*
 * One playbook run: its steps and what each did, and - while a step waits
 * for approval - the Approve and Reject buttons that decide it. Approving
 * carries the run on from that step; rejecting ends it. Either way the
 * decision, with its comment, is kept on the step and on the case's timeline.
 *
 * A step that acts on users or hosts asks the approver about its targets,
 * all ticked: untick any it should leave alone. Whoever started the run
 * cannot approve it - somebody else does - but may reject it.
 */
const SecurityPlaybookRunCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [showCancel, setShowCancel] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [isWorking, setIsWorking] = useState<boolean>(false);

  const run: SecurityPlaybookRun = props.run;
  const runId: ObjectID = new ObjectID(run._id!.toString());
  const isWaiting: boolean =
    run.status === SecurityPlaybookRunStatus.WaitingForApproval;
  const isFinished: boolean = isFinishedSecurityPlaybookRunStatus(run.status);

  const gate: PermissionGateResult = PermissionGate.check(
    new SecurityPlaybookRun(),
    ModelAction.Update,
  );

  const [isExpanded, setIsExpanded] = useState<boolean>(
    !props.isCollapsible || isWaiting,
  );
  const stepsId: string = useId();

  // A run that comes to wait for an approval while folded opens: it needs a decision.
  useEffect(() => {
    if (isWaiting) {
      setIsExpanded(true);
    }
  }, [isWaiting]);

  const summary: RunStepsSummary = summarizeRunSteps(
    getRunStepRows({ steps: run.steps, stepResults: run.stepResults }),
  );

  const isOwnRun: boolean = didStartRun(
    run.triggeredByUserId,
    User.getUserId(),
  );
  const approveDisabledReason: string | undefined = !gate.isAllowed
    ? gate.disabledReason
    : isOwnRun
      ? translator.translateText(
          "You started this run, so someone else must approve its steps.",
        )
      : undefined;
  const { proposed, protectedTargets } = getApprovalTargets(run);

  const targetField: Field<JSONObject> = {
    field: { [APPROVAL_TARGETS_FIELD]: true },
    title: "Act On",
    description: "Every one is ticked. Untick any the step should leave alone.",
    fieldType: FormFieldSchemaType.CategoryCheckbox,
    required: true,
    categoryCheckboxProps: {
      categories: [],
      options: proposed.map(
        (target: SecurityPlaybookTarget): CategoryCheckboxOption => {
          return {
            value: target.value,
            label: (
              <span>
                <span className="font-mono">{target.value}</span>
                <span className="ml-2 font-normal text-gray-500">
                  {describeRunTarget(target, translator)}
                </span>
              </span>
            ),
          };
        },
      ),
    },
  };

  const startedAt: Date | undefined = run.startedAt || run.createdAt;
  const who: string | undefined = run.triggeredByUser?.name?.toString();

  return (
    <div
      className={`rounded-xl border bg-white shadow-sm ${
        isWaiting ? "border-amber-300 ring-1 ring-amber-200" : "border-gray-200"
      }`}
      data-testid="security-playbook-run-card"
    >
      <div
        className={`flex flex-wrap items-start justify-between gap-3 px-4 py-3 ${
          isExpanded ? "border-b border-gray-100" : ""
        }`}
      >
        {/*
         * The run's words take the row and wrap inside it, and the buttons
         * keep the row's top right: a long case title used to push Approve
         * and Reject onto a row of their own, under an empty band. Only
         * where the words cannot keep 16rem beside them (a phone) do the
         * buttons drop under them, still on the right.
         */}
        <div className="min-w-0 grow basis-64">
          <div className="flex flex-wrap items-center gap-2">
            {props.heading || (
              <span className="truncate text-sm font-semibold text-gray-900">
                {run.playbookName || translator.translateText("Playbook")}
              </span>
            )}
            <SecurityPlaybookRunStatusPill value={run.status} />
            {props.caseLink || <></>}
          </div>
          <p className="mt-0.5 text-xs text-gray-500">
            {who
              ? translator.translateTemplate("Run by {{name}}", { name: who })
              : translator.translateTemplate(
                  "Started on its own: {{trigger}}",
                  {
                    trigger:
                      translator.translateText(run.trigger || "") ||
                      run.trigger ||
                      "",
                  },
                )}
            {startedAt
              ? ` · ${OneUptimeDate.getDateAsLocalFormattedString(startedAt)}`
              : ""}
          </p>
          {props.isCollapsible ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span
                data-testid={RUN_CARD_SUMMARY_TEST_ID}
                className={summary.stoppedAt ? "text-red-700" : "text-gray-600"}
              >
                {summary.stoppedAt
                  ? translator.translateTemplate(
                      "Stopped at step {{number}}: {{title}}",
                      {
                        number: translator.formatNumber(
                          summary.stoppedAt.index + 1,
                        ),
                        title:
                          translator.translateText(summary.stoppedAt.title) ||
                          summary.stoppedAt.title,
                      },
                    )
                  : translator.translatePlural(
                      {
                        one: "{{done}} of {{count}} step done",
                        other: "{{done}} of {{count}} steps done",
                      },
                      summary.total,
                      { done: translator.formatNumber(summary.done) },
                    )}
              </span>
              <button
                type="button"
                aria-expanded={isExpanded}
                aria-controls={stepsId}
                data-testid={RUN_CARD_STEPS_TOGGLE_TEST_ID}
                className="inline-flex items-center gap-0.5 rounded font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                onClick={() => {
                  setIsExpanded(!isExpanded);
                }}
              >
                {translator.translateText(
                  isExpanded ? "Hide steps" : "Show steps",
                )}
                <Icon
                  icon={isExpanded ? IconProp.ChevronUp : IconProp.ChevronDown}
                  className="h-3.5 w-3.5"
                />
              </button>
            </div>
          ) : (
            <></>
          )}
        </div>

        {isWaiting ? (
          <div className="ms-auto flex flex-shrink-0 items-center gap-2">
            <Button
              title="Reject"
              icon={IconProp.Close}
              buttonStyle={ButtonStyleType.DANGER_OUTLINE}
              buttonSize={ButtonSize.Small}
              disabled={!gate.isAllowed || isWorking}
              tooltip={gate.isAllowed ? undefined : gate.disabledReason}
              onClick={() => {
                setError("");
                setDecision("reject");
              }}
            />
            <Button
              title="Approve"
              icon={IconProp.Check}
              buttonStyle={ButtonStyleType.SUCCESS}
              buttonSize={ButtonSize.Small}
              disabled={Boolean(approveDisabledReason) || isWorking}
              tooltip={approveDisabledReason}
              onClick={() => {
                setError("");
                setDecision("approve");
              }}
            />
          </div>
        ) : !isFinished ? (
          // In the same place as Approve and Reject: the row's right, a phone's too.
          <div className="ms-auto flex flex-shrink-0 items-center">
            <Button
              title="Cancel Run"
              icon={IconProp.Stop}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              disabled={!gate.isAllowed || isWorking}
              tooltip={gate.isAllowed ? undefined : gate.disabledReason}
              onClick={() => {
                setError("");
                setShowCancel(true);
              }}
            />
          </div>
        ) : (
          <></>
        )}
      </div>

      {isExpanded ? (
        <div id={stepsId} className="px-4 py-3">
          {isWaiting ? (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {translator.translateText(
                "This run is waiting for someone to approve its next step before it does anything.",
              )}
            </p>
          ) : (
            <></>
          )}
          <SecurityPlaybookRunSteps
            steps={run.steps}
            stepResults={run.stepResults}
            runId={runId}
            canUndo={
              gate.isAllowed &&
              run.status !== SecurityPlaybookRunStatus.Queued &&
              run.status !== SecurityPlaybookRunStatus.Running
            }
            undoDisabledReason={
              gate.isAllowed
                ? translator.translateText(
                    "Undo once the run has stopped running.",
                  )
                : gate.disabledReason
            }
            onChanged={props.onChanged}
          />
          {run.errorMessage &&
          run.status === SecurityPlaybookRunStatus.Failed ? (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {run.errorMessage}
            </p>
          ) : (
            <></>
          )}
          {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : <></>}
        </div>
      ) : error ? (
        // A decision or a cancel that failed says so, steps shown or not.
        <p className="px-4 pb-3 text-sm text-red-700">{error}</p>
      ) : (
        <></>
      )}

      {decision ? (
        <BasicFormModal<JSONObject>
          title={decision === "approve" ? "Approve Step" : "Reject Step"}
          description={
            decision === "approve"
              ? protectedTargets.length > 0
                ? translator.translateTemplate(
                    "The run carries on and never acts on protected entities: {{values}}. Your decision is kept on the step, the case's timeline and the audit log.",
                    {
                      values: protectedTargets
                        .map((target: SecurityPlaybookTarget): string => {
                          return target.value;
                        })
                        .join(", "),
                    },
                  )
                : "The run carries on from this step. Your decision is kept on the step, on the case's timeline and in the audit log."
              : "The run stops here and nothing after this step runs. Your decision is kept on the step, on the case's timeline and in the audit log."
          }
          submitButtonText={decision === "approve" ? "Approve" : "Reject"}
          submitButtonStyleType={
            decision === "approve"
              ? ButtonStyleType.PRIMARY
              : ButtonStyleType.DANGER
          }
          onClose={() => {
            setDecision(null);
          }}
          formProps={{
            name: "security-playbook-approval",
            initialValues:
              decision === "approve" && proposed.length > 0
                ? {
                    [APPROVAL_TARGETS_FIELD]: proposed.map(
                      (target: SecurityPlaybookTarget): string => {
                        return target.value;
                      },
                    ),
                  }
                : {},
            fields: [
              ...(decision === "approve" && proposed.length > 0
                ? [targetField]
                : []),
              {
                field: { comment: true },
                title: "Comment",
                fieldType: FormFieldSchemaType.LongText,
                required: false,
                placeholder: "Optional. Why you decided this way.",
              },
            ],
          }}
          onSubmit={async (values: FormValues<JSONObject>) => {
            const isApproved: boolean = decision === "approve";
            const kept: unknown = values[APPROVAL_TARGETS_FIELD];
            setDecision(null);
            setIsWorking(true);

            try {
              await SecurityCaseApi.decideApproval({
                runId,
                isApproved,
                comment:
                  typeof values["comment"] === "string"
                    ? (values["comment"] as string)
                    : undefined,
                targets:
                  isApproved && proposed.length > 0
                    ? (Array.isArray(kept) ? kept : []).map(
                        (value: unknown): string => {
                          return String(value);
                        },
                      )
                    : undefined,
              });
            } catch (err) {
              setError(API.getFriendlyMessage(err));
            }

            setIsWorking(false);
            props.onChanged();
          }}
        />
      ) : (
        <></>
      )}

      {showCancel ? (
        <ConfirmModal
          title="Cancel Run"
          description="The run stops before its next step. Steps that already ran are not undone."
          submitButtonText="Cancel Run"
          submitButtonType={ButtonStyleType.DANGER}
          closeButtonText="Keep Running"
          onClose={() => {
            setShowCancel(false);
          }}
          onSubmit={async () => {
            setShowCancel(false);
            setIsWorking(true);

            try {
              await ModelAPI.updateById<SecurityPlaybookRun>({
                modelType: SecurityPlaybookRun,
                id: runId,
                data: { status: SecurityPlaybookRunStatus.Cancelled },
              });
            } catch (err) {
              setError(API.getFriendlyMessage(err));
            }

            setIsWorking(false);
            props.onChanged();
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default SecurityPlaybookRunCard;
