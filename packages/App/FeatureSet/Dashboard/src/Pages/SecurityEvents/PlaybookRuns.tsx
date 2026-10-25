import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import SecurityPlaybookRunCard from "../../Components/SecurityPlaybook/SecurityPlaybookRunCard";
import {
  PLAYBOOK_RUNS_PAGE_LIMIT,
  SecurityPlaybookRunView,
  SecurityPlaybookRunViewKey,
  getSecurityPlaybookRunView,
} from "../../Components/SecurityPlaybook/SecurityPlaybookRunViews";
import useSecurityPlaybookRuns, {
  UseSecurityPlaybookRunsResult,
} from "../../Components/SecurityPlaybook/useSecurityPlaybookRuns";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SecurityPlaybookRun from "Common/Models/DatabaseModels/SecurityPlaybookRun";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TableEmptyState, {
  TableEmptyStateAction,
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

// Playbook Runs' way forward when no playbook has run: the playbooks.
export const VIEW_PLAYBOOKS: string = translationKey("View Playbooks");
export const VIEW_PLAYBOOKS_TEST_ID: string =
  "security-playbook-runs-view-playbooks";

export interface ComponentProps extends PageComponentProps {
  /*
   * Which of the two runs pages this is (SecurityPlaybookRunViews.ts): the
   * runs waiting for an approval, or every run. The runs waiting when not
   * given.
   */
  view?: SecurityPlaybookRunViewKey | undefined;
}

/*
 * The playbook runs of the project, newest first, as two pages under
 * Playbooks: Waiting for Approval, the runs a step holds until a person
 * decides - they do nothing until somebody does - and Playbook Runs, every
 * run, to read back what each playbook did.
 */
const SecurityPlaybookRunsPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const view: SecurityPlaybookRunView = getSecurityPlaybookRunView(props.view);

  const runs: UseSecurityPlaybookRunsResult = useSecurityPlaybookRuns({
    query: view.query,
    queryKey: view.key,
    limit: PLAYBOOK_RUNS_PAGE_LIMIT,
  });

  const emptyActions: Array<TableEmptyStateAction> = view.isEmptyGoodNews
    ? []
    : [
        {
          title: VIEW_PLAYBOOKS,
          icon: IconProp.Bolt,
          dataTestId: VIEW_PLAYBOOKS_TEST_ID,
          onClick: (): void => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.SECURITY_PLAYBOOKS] as Route,
              ),
            );
          },
        },
      ];

  /*
   * While the list is empty its empty state says what the page is for, so
   * the card leaves its own description out - the same thing twice, a few
   * lines apart, as a table's empty state does (BaseModelTable).
   */
  const isEmptyStateShown: boolean =
    !runs.error && !runs.isLoading && runs.runs.length === 0;

  return (
    <Card
      title={view.title}
      description={isEmptyStateShown ? undefined : view.description}
    >
      {runs.error ? (
        <ErrorMessage message={runs.error} />
      ) : runs.isLoading && runs.runs.length === 0 ? (
        <div className="space-y-3" aria-busy="true">
          <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
        </div>
      ) : runs.runs.length === 0 ? (
        <TableEmptyState
          kind={
            view.isEmptyGoodNews
              ? TableEmptyStateKind.AllClear
              : TableEmptyStateKind.Empty
          }
          icon={view.isEmptyGoodNews ? undefined : view.icon}
          title={view.emptyTitle}
          description={view.emptyDescription}
          actions={emptyActions}
          isCompact={true}
          dataTestId="security-playbook-runs-empty"
        />
      ) : (
        <div className="space-y-3">
          {runs.runs.map((run: SecurityPlaybookRun): ReactElement => {
            return (
              <SecurityPlaybookRunCard
                key={run._id!.toString()}
                run={run}
                onChanged={runs.refresh}
                isCollapsible={true}
                caseLink={
                  run.securityCaseId ? (
                    <AppLink
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SECURITY_CASE_VIEW] as Route,
                        {
                          modelId: new ObjectID(run.securityCaseId.toString()),
                        },
                      )}
                      className="truncate text-xs font-medium text-indigo-600 hover:underline"
                    >
                      {`${run.securityCase?.caseNumberWithPrefix || ""} ${
                        run.securityCase?.title || ""
                      }`.trim() ||
                        translator.translateText("Open case") ||
                        ""}
                    </AppLink>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}
    </Card>
  );
};

export default SecurityPlaybookRunsPage;
