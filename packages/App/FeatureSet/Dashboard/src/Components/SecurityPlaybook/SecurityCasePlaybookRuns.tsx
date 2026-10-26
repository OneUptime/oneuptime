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
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

// What the card holds, under its title, while the case has runs.
export const CASE_PLAYBOOK_RUNS_DESCRIPTION: string = translationKey(
  "The playbooks that ran on this case and what each step did. A step that needs approval waits here for someone to approve or reject it.",
);

/*
 * Before any playbook has run on the case: what runs here, and when - in
 * the words Playbook Runs' empty state has for every case.
 */
export const CASE_PLAYBOOK_RUNS_EMPTY_TITLE: string = translationKey(
  "No playbook has run on this case yet.",
);
export const CASE_PLAYBOOK_RUNS_EMPTY_DESCRIPTION: string = translationKey(
  "A playbook runs here when the case opens or grows, or when someone runs it on the case.",
);
export const CASE_PLAYBOOK_RUNS_EMPTY_TEST_ID: string =
  "security-case-playbook-runs-empty";

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

  /*
   * While no playbook has run, the empty state says what the page is for,
   * so the card leaves its own description out - as Approvals and Playbook
   * Runs do, and a table's empty state does.
   */
  const isEmptyStateShown: boolean =
    !result.error && !result.isLoading && result.runs.length === 0;

  return (
    <Card
      title="Playbooks"
      description={
        isEmptyStateShown ? undefined : CASE_PLAYBOOK_RUNS_DESCRIPTION
      }
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
        <div className="space-y-2" aria-busy="true">
          <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
          <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
        </div>
      ) : result.runs.length === 0 ? (
        <TableEmptyState
          kind={TableEmptyStateKind.Empty}
          icon={IconProp.Play}
          title={CASE_PLAYBOOK_RUNS_EMPTY_TITLE}
          description={CASE_PLAYBOOK_RUNS_EMPTY_DESCRIPTION}
          isCompact={true}
          dataTestId={CASE_PLAYBOOK_RUNS_EMPTY_TEST_ID}
        />
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
