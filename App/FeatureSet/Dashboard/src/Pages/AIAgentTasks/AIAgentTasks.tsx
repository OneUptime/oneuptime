import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import AIAgentTaskTable from "../../Components/AIAgentTask/AIAgentTaskTable";
import AIFixOutcomeStats from "../../Components/AIAgentTask/AIFixOutcomeStats";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Link from "Common/UI/Components/Link/Link";
import Pill from "Common/UI/Components/Pill/Pill";
import { Blue, Yellow, Green } from "Common/Types/BrandColors";

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
      <Alert
        type={AlertType.INFO}
        strongTitle="Prerequisites"
        className="mb-5"
        title={
          <span>
            To open fix pull requests, the agent needs a{" "}
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

      <Tabs
        tabs={[
          {
            name: "All",
            children: (
              <AIAgentTaskTable
                id="ai-agent-tasks-table-all"
                name="AI Agent Tasks"
                title="All Tasks"
                description="View and manage all tasks assigned to AI agents for automated incident management."
                showStatusFilter={true}
                dateField="createdAt"
                dateFieldTitle="Created At"
              />
            ),
          },
          {
            name: "Scheduled",
            children: (
              <AIAgentTaskTable
                id="ai-agent-tasks-table-scheduled"
                name="Scheduled Tasks"
                title="Scheduled Tasks"
                description="Tasks that are scheduled and waiting to be picked up by an AI agent."
                query={{
                  status: AIAgentTaskStatus.Scheduled,
                }}
                dateField="createdAt"
                dateFieldTitle="Created At"
                getStatusElement={(): ReactElement => {
                  return <Pill text="Scheduled" color={Blue} />;
                }}
                noItemsMessage="No scheduled tasks. New tasks will appear here when incidents, alerts, or code issues trigger AI Agent work."
              />
            ),
          },
          {
            name: "In Progress",
            children: (
              <AIAgentTaskTable
                id="ai-agent-tasks-table-in-progress"
                name="In Progress Tasks"
                title="In Progress Tasks"
                description="Tasks that are currently being processed by an AI agent."
                query={{
                  status: AIAgentTaskStatus.InProgress,
                }}
                dateField="startedAt"
                dateFieldTitle="Started At"
                getStatusElement={(): ReactElement => {
                  return <Pill text="In Progress" color={Yellow} />;
                }}
                noItemsMessage="No tasks currently in progress. Tasks will appear here when an AI Agent picks them up for processing."
              />
            ),
          },
          {
            name: "Completed",
            children: (
              <AIAgentTaskTable
                id="ai-agent-tasks-table-completed"
                name="Completed Tasks"
                title="Completed Tasks"
                description="Tasks that have been completed successfully by an AI agent."
                query={{
                  status: AIAgentTaskStatus.Completed,
                }}
                dateField="completedAt"
                dateFieldTitle="Completed At"
                getStatusElement={(): ReactElement => {
                  return <Pill text="Completed" color={Green} />;
                }}
                noItemsMessage="No completed tasks yet. Tasks will appear here once AI Agents finish processing them."
              />
            ),
          },
        ]}
        onTabChange={() => {}}
      />
    </Fragment>
  );
};

export default AIAgentTasksPage;
