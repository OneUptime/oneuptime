import SecurityPlaybookRunCard from "./SecurityPlaybookRunCard";
import useSecurityPlaybookRuns, {
  UseSecurityPlaybookRunsResult,
} from "./useSecurityPlaybookRuns";
import SecurityPlaybookRun from "Common/Models/DatabaseModels/SecurityPlaybookRun";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

export interface ComponentProps {
  securityCaseId: ObjectID;
  // Bumped by the page when it starts a run, so the new one shows at once.
  refreshToggle?: string | undefined;
  onRunPlaybook?: (() => void) | undefined;
  canRunPlaybook?: boolean | undefined;
  onRunsChanged?: (() => void) | undefined;
}

// The playbooks that ran on a case, newest first, each with its steps.
const SecurityCasePlaybookRuns: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const caseId: string = props.securityCaseId.toString();

  const result: UseSecurityPlaybookRunsResult = useSecurityPlaybookRuns({
    query: { securityCaseId: props.securityCaseId },
    queryKey: caseId,
    limit: 25,
  });

  useEffect(() => {
    if (props.refreshToggle) {
      result.refresh();
    }
  }, [props.refreshToggle]);

  return (
    <Card
      title="Playbooks"
      description="The playbooks that ran on this case and what each step did. A step that needs approval waits here for someone to approve or reject it."
      buttons={
        props.onRunPlaybook
          ? [
              {
                title: "Run Playbook",
                icon: IconProp.Play,
                buttonStyle: ButtonStyleType.NORMAL,
                disabled: props.canRunPlaybook === false,
                onClick: props.onRunPlaybook,
              },
            ]
          : []
      }
    >
      {result.error ? (
        <ErrorMessage message={result.error} />
      ) : result.isLoading && result.runs.length === 0 ? (
        <div className="space-y-2">
          <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
          <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
        </div>
      ) : result.runs.length === 0 ? (
        <p className="text-sm text-gray-500">
          {translator.translateText(
            "No playbook has run on this case yet. Playbooks set to start when a case opens run here by themselves; you can run any playbook by hand.",
          )}
        </p>
      ) : (
        <div className="space-y-3">
          {result.runs.map((run: SecurityPlaybookRun): ReactElement => {
            return (
              <SecurityPlaybookRunCard
                key={run._id!.toString()}
                run={run}
                onChanged={() => {
                  result.refresh();
                  props.onRunsChanged?.();
                }}
              />
            );
          })}
        </div>
      )}
    </Card>
  );
};

export default SecurityCasePlaybookRuns;
