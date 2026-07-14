import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import AIPlanGate from "../../Components/AI/AIPlanGate";
import AIFixOutcomeStats from "../../Components/AIAgentTask/AIFixOutcomeStats";
import CodeFixRunsTable from "../../Components/AIAgentTask/CodeFixRunsTable";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Link from "Common/UI/Components/Link/Link";

const AIAgentTasksPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const codeRepositoriesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CODE_REPOSITORY] as Route,
  );

  const llmProvidersRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SETTINGS_AI_LLM_PROVIDERS] as Route,
  );

  return (
    <Fragment>
      <AIPlanGate />

      <Alert
        type={AlertType.INFO}
        strongTitle="Prerequisites"
        className="mb-5"
        title={
          <span>
            To open fix pull requests, AI needs a{" "}
            <Link to={codeRepositoriesRoute} className="underline">
              connected GitHub repository
            </Link>{" "}
            and a project{" "}
            <Link to={llmProvidersRoute} className="underline">
              LLM provider
            </Link>
            .
          </span>
        }
      />

      <div className="mb-5">
        <AIFixOutcomeStats />
      </div>

      <CodeFixRunsTable />
    </Fragment>
  );
};

export default AIAgentTasksPage;
