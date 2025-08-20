import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import WorkspaceModel from "Common/Models/DatabaseModels/Model";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import Link from "Common/UI/Components/Link/Link";
import URL from "Common/Types/API/URL";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";

export interface ComponentProps {
  integratedModels: Array<WorkspaceModel>;
  workspaceType: WorkspaceType;
}

const MicrosoftTeamsIntegrationDocumentation: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const projectId: ObjectID | undefined = ProjectUtil.getCurrentProjectId();

  const getModelRoute: (model: WorkspaceModel) => Route = (
    model: WorkspaceModel,
  ): Route => {
    const modelName: string = model.singularName || "";

    if (modelName === "Monitor") {
      return RouteUtil.populateRouteParams(
        RouteMap[PageMap.MONITORS] as Route,
        { projectId: projectId?.toString() || "" },
      );
    }

    if (modelName === "Alert") {
      return RouteUtil.populateRouteParams(
        RouteMap[PageMap.ALERTS] as Route,
        { projectId: projectId?.toString() || "" },
      );
    }

    if (modelName === "Incident") {
      return RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENTS] as Route,
        { projectId: projectId?.toString() || "" },
      );
    }

    if (modelName === "Scheduled Maintenance Event") {
      return RouteUtil.populateRouteParams(
        RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route,
        { projectId: projectId?.toString() || "" },
      );
    }

    if (modelName === "On-Call Duty Policy") {
      return RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY_POLICIES] as Route,
        { projectId: projectId?.toString() || "" },
      );
    }

    return new Route("/");
  };

  return (
    <Card
      title={"How to use Microsoft Teams Integration"}
      description={
        <div>
          <p className="mb-4">
            Microsoft Teams integration allows you to receive notifications and
            interact with OneUptime directly from your Teams channels. Here's
            how to use it:
          </p>

          <h3 className="font-semibold text-lg mb-2">
            Receiving Notifications
          </h3>
          <p className="mb-4">
            You can configure which Teams channels receive notifications for
            different events:
          </p>
          <ul className="list-disc ml-6 mb-4">
            {props.integratedModels.map((model: WorkspaceModel) => {
              return (
                <li key={model.tableName}>
                  <Link
                    to={URL.fromRoute(getModelRoute(model))}
                    onClick={() => {
                      Navigation.navigate(getModelRoute(model));
                    }}
                    className="underline"
                  >
                    {model.singularName}
                  </Link>{" "}
                  - Configure Teams channels for {model.singularName}{" "}
                  notifications
                </li>
              );
            })}
          </ul>

          <h3 className="font-semibold text-lg mb-2">
            Interactive Actions from Teams
          </h3>
          <p className="mb-4">
            When you receive notifications in Teams, you can take actions
            directly from the Teams interface:
          </p>
          <ul className="list-disc ml-6 mb-4">
            <li>
              <strong>Incidents:</strong> Acknowledge, resolve, or add notes to
              incidents
            </li>
            <li>
              <strong>Alerts:</strong> Acknowledge, resolve, or add notes to
              alerts
            </li>
            <li>
              <strong>Monitors:</strong> Trigger manual checks or view monitor
              status
            </li>
            <li>
              <strong>Scheduled Maintenance:</strong> End maintenance events or
              add notes
            </li>
            <li>
              <strong>On-Call Duty:</strong> View and execute on-call policies
            </li>
          </ul>

          <h3 className="font-semibold text-lg mb-2">Teams Commands</h3>
          <p className="mb-4">
            You can use the following commands in Teams to interact with
            OneUptime:
          </p>
          <ul className="list-disc ml-6 mb-4">
            <li>
              <code>@OneUptime help</code> - Show available commands
            </li>
            <li>
              <code>@OneUptime incidents</code> - List recent incidents
            </li>
            <li>
              <code>@OneUptime alerts</code> - List recent alerts
            </li>
          </ul>

          <h3 className="font-semibold text-lg mb-2">Channel Configuration</h3>
          <p className="mb-4">
            To configure which Teams channels receive notifications:
          </p>
          <ol className="list-decimal ml-6 mb-4">
            <li>Navigate to the resource (Monitor, Incident, etc.)</li>
            <li>Click on "Microsoft Teams" in the resource menu</li>
            <li>Add the Teams channel ID where you want to receive notifications</li>
            <li>Save your configuration</li>
          </ol>

          <h3 className="font-semibold text-lg mb-2">Finding Channel IDs</h3>
          <p className="mb-4">To find a Teams channel ID:</p>
          <ol className="list-decimal ml-6 mb-4">
            <li>Go to Microsoft Teams</li>
            <li>Navigate to the channel you want to use</li>
            <li>Click on the three dots (...) next to the channel name</li>
            <li>Select "Get link to channel"</li>
            <li>
              The channel ID is the part after <code>/channel/</code> in the URL
            </li>
          </ol>

          <h3 className="font-semibold text-lg mb-2">Troubleshooting</h3>
          <p className="mb-4">If you're not receiving notifications:</p>
          <ul className="list-disc ml-6">
            <li>Ensure the Teams app is installed in your workspace</li>
            <li>Verify the channel ID is correct</li>
            <li>Check that the OneUptime bot has access to the channel</li>
            <li>
              Confirm notifications are enabled for the specific resource
            </li>
          </ul>
        </div>
      }
    />
  );
};

export default MicrosoftTeamsIntegrationDocumentation;