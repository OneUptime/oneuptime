import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ConnectedWorkspaces, {
  WORKSPACE_TYPES,
  WorkspaceConnections,
  useWorkspaceConnections,
} from "../../Utils/Workspace/ConnectedWorkspaces";
import {
  WORKSPACE_CONNECTIONS_PAGE_COPY,
  WORKSPACE_CONNECTION_COPY,
  WorkspaceConnectionCopy,
} from "./WorkspaceConnectionCopy";
import Route from "Common/Types/API/Route";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "Maybe show Workspace page where you show which one is active." (the
 * maintainer)
 *
 * A product's Workspace page, listed in its side menu while the project has
 * no chat workspace connected: Slack and Microsoft Teams side by side, which
 * of them is connected, what each would do, and one step to take for each:
 * connect it (in Project Settings, where a workspace is connected once for
 * the whole project) or, once connected, set up this product's notifications
 * for it.
 */

export interface WorkspaceTileProps {
  workspaceType: WorkspaceType;
  isConnected: boolean;
  // This product's page for the workspace: its notification rules.
  productPage: PageMap;
}

export const WorkspaceConnectionTile: FunctionComponent<WorkspaceTileProps> = (
  props: WorkspaceTileProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const copy: WorkspaceConnectionCopy =
    WORKSPACE_CONNECTION_COPY[props.workspaceType];

  const actionTitle: string = props.isConnected
    ? WORKSPACE_CONNECTIONS_PAGE_COPY.setUpNotifications
    : copy.connectTitle;
  const actionPage: PageMap = props.isConnected
    ? props.productPage
    : copy.settingsPage;

  return (
    <li
      data-testid={`workspace-connection-${props.workspaceType}`}
      data-connected={props.isConnected ? "true" : "false"}
      className="flex items-start gap-4 rounded-lg border border-gray-200 bg-white p-4"
    >
      <div
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${copy.iconBackgroundClassName}`}
      >
        <Icon icon={copy.icon} className="h-5 w-5 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-900">
            {translateString(copy.name)}
          </span>
          <span
            data-testid={`workspace-connection-status-${props.workspaceType}`}
            className={
              props.isConnected
                ? "inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
                : "inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200"
            }
          >
            {translateString(
              props.isConnected
                ? WORKSPACE_CONNECTIONS_PAGE_COPY.connected
                : WORKSPACE_CONNECTIONS_PAGE_COPY.notConnected,
            )}
          </span>
        </div>
        <div className="mt-1 text-sm text-gray-500">
          {translateString(copy.description)}
        </div>
        <Link
          to={RouteUtil.populateRouteParams(RouteMap[actionPage] as Route)}
          className="mt-2 inline-flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          {`${translateString(actionTitle)} →`}
        </Link>
      </div>
    </li>
  );
};

export interface ComponentProps {
  slackPage: PageMap;
  microsoftTeamsPage: PageMap;
}

const WorkspaceConnectionsOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const connections: WorkspaceConnections = useWorkspaceConnections();

  const productPages: Record<WorkspaceType, PageMap> = {
    [WorkspaceType.Slack]: props.slackPage,
    [WorkspaceType.MicrosoftTeams]: props.microsoftTeamsPage,
  };

  let body: ReactElement;

  if (connections.isFresh && connections.connected) {
    const connected: ReadonlyArray<WorkspaceType> = connections.connected;

    body = (
      <ul
        data-testid="workspace-connections"
        className="grid grid-cols-1 gap-3 lg:grid-cols-2"
      >
        {WORKSPACE_TYPES.map((workspaceType: WorkspaceType): ReactElement => {
          return (
            <WorkspaceConnectionTile
              key={workspaceType}
              workspaceType={workspaceType}
              isConnected={connected.includes(workspaceType)}
              productPage={productPages[workspaceType]}
            />
          );
        })}
      </ul>
    );
  } else if (connections.error) {
    body = (
      <ErrorMessage
        message={connections.error}
        onRefreshClick={() => {
          ConnectedWorkspaces.refresh().catch(() => {
            // A failed request is kept as `error` and shown here again.
          });
        }}
      />
    );
  } else {
    body = <ComponentLoader />;
  }

  return (
    <Card
      title={WORKSPACE_CONNECTIONS_PAGE_COPY.title}
      description={WORKSPACE_CONNECTIONS_PAGE_COPY.description}
    >
      {body}
    </Card>
  );
};

export default WorkspaceConnectionsOverview;
