import SecurityCaseApi from "../SecurityCase/SecurityCaseApi";
import { SecurityPlaybookRunStatusPill } from "../SecurityCase/SecurityCasePills";
import SecurityPlaybookRunSteps from "./SecurityPlaybookRunSteps";
import SecurityPlaybookRun from "Common/Models/DatabaseModels/SecurityPlaybookRun";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SecurityPlaybookRunStatus, {
  isFinishedSecurityPlaybookRunStatus,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
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
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  run: SecurityPlaybookRun;
  onChanged: () => void;
  // The case's number, when the card is shown away from its case.
  caseLink?: ReactElement | undefined;
}

type Decision = "approve" | "reject";

/*
 * One playbook run: its steps and what each did, and - while a step waits
 * for approval - the Approve and Reject buttons that decide it. Approving
 * carries the run on from that step; rejecting ends it. Either way the
 * decision, with its comment, is kept on the step and on the case's timeline.
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

  const startedAt: Date | undefined = run.startedAt || run.createdAt;
  const who: string | undefined = run.triggeredByUser?.name?.toString();

  return (
    <div
      className={`rounded-xl border bg-white shadow-sm ${
        isWaiting ? "border-amber-300 ring-1 ring-amber-200" : "border-gray-200"
      }`}
      data-testid="security-playbook-run-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-gray-900">
              {run.playbookName || translator.translateText("Playbook")}
            </span>
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
        </div>

        {isWaiting ? (
          <div className="ml-auto flex flex-shrink-0 items-center gap-2">
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
              disabled={!gate.isAllowed || isWorking}
              tooltip={gate.isAllowed ? undefined : gate.disabledReason}
              onClick={() => {
                setError("");
                setDecision("approve");
              }}
            />
          </div>
        ) : !isFinished ? (
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
        ) : (
          <></>
        )}
      </div>

      <div className="px-4 py-3">
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
        />
        {run.errorMessage && run.status === SecurityPlaybookRunStatus.Failed ? (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {run.errorMessage}
          </p>
        ) : (
          <></>
        )}
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : <></>}
      </div>

      {decision ? (
        <BasicFormModal<JSONObject>
          title={decision === "approve" ? "Approve Step" : "Reject Step"}
          description={
            decision === "approve"
              ? "The run carries on from this step. Your name and comment are kept on the step and on the case's timeline."
              : "The run stops here and nothing after this step runs. Your name and comment are kept on the step and on the case's timeline."
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
            fields: [
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
