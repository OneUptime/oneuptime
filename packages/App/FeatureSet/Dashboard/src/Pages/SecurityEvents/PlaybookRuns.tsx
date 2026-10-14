import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import SecurityPlaybookRunCard from "../../Components/SecurityPlaybook/SecurityPlaybookRunCard";
import useSecurityPlaybookRuns, {
  UseSecurityPlaybookRunsResult,
} from "../../Components/SecurityPlaybook/useSecurityPlaybookRuns";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SecurityPlaybookRun from "Common/Models/DatabaseModels/SecurityPlaybookRun";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SecurityPlaybookRunStatus from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

type RunView = "waiting" | "active" | "all";

interface RunViewDefinition {
  key: RunView;
  title: string;
  icon: IconProp;
  emptyText: string;
  query: Query<SecurityPlaybookRun>;
}

export const PLAYBOOK_RUN_VIEWS: Array<RunViewDefinition> = [
  {
    key: "waiting",
    title: translationKey("Waiting for Approval"),
    icon: IconProp.Pause,
    emptyText: translationKey("No step is waiting for approval."),
    query: { status: SecurityPlaybookRunStatus.WaitingForApproval },
  },
  {
    key: "active",
    title: translationKey("Running"),
    icon: IconProp.Play,
    emptyText: translationKey("No playbook is running right now."),
    query: {
      status: new Includes([
        SecurityPlaybookRunStatus.Queued,
        SecurityPlaybookRunStatus.Running,
        SecurityPlaybookRunStatus.WaitingForApproval,
      ]),
    } as Query<SecurityPlaybookRun>,
  },
  {
    key: "all",
    title: translationKey("All Runs"),
    icon: IconProp.List,
    emptyText: translationKey("No playbook has run yet."),
    query: {},
  },
];

/*
 * Every playbook run in the project, newest first - with the approvals
 * waiting on someone first of all, since a run held for approval does
 * nothing until it gets one.
 */
const SecurityPlaybookRunsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [view, setView] = useState<RunView>("waiting");
  const definition: RunViewDefinition =
    PLAYBOOK_RUN_VIEWS.find((item: RunViewDefinition): boolean => {
      return item.key === view;
    }) || PLAYBOOK_RUN_VIEWS[0]!;

  const runs: UseSecurityPlaybookRunsResult = useSecurityPlaybookRuns({
    query: definition.query,
    queryKey: view,
    limit: 50,
  });

  return (
    <Card
      title="Playbook Runs"
      description="Every playbook run, with each step and what it did. A step that needs approval holds its run here until someone approves or rejects it."
      // The views drop under the title beside the side menu.
      headerLayout="stacked"
      rightElement={
        <div className="flex flex-wrap items-center gap-1">
          {PLAYBOOK_RUN_VIEWS.map((item: RunViewDefinition): ReactElement => {
            const isActive: boolean = item.key === view;

            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={isActive}
                data-testid={`security-playbook-runs-view-${item.key}`}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
                onClick={() => {
                  setView(item.key);
                }}
              >
                <Icon icon={item.icon} className="h-3.5 w-3.5" />
                {translator.translateText(item.title)}
              </button>
            );
          })}
        </div>
      }
    >
      {runs.error ? (
        <ErrorMessage message={runs.error} />
      ) : runs.isLoading && runs.runs.length === 0 ? (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
        </div>
      ) : runs.runs.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">
          {translator.translateText(definition.emptyText)}
        </p>
      ) : (
        <div className="space-y-3">
          {runs.runs.map((run: SecurityPlaybookRun): ReactElement => {
            return (
              <SecurityPlaybookRunCard
                key={run._id!.toString()}
                run={run}
                onChanged={runs.refresh}
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
