import PageMap from "../../Utils/PageMap";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
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
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import ProviderLogoImage from "Common/UI/Components/ProviderLogo/ProviderLogoImage";
import useTranslateValue from "Common/UI/Utils/Translation";
import { getArrowOn } from "Common/Types/DirectionArrow";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "Maybe show Workspace page where you show which one is active." (the
 * maintainer)
 *
 * A product's Workspace page, listed in its side menu while the project has
 * no chat workspace connected: Slack, Microsoft Teams and Mattermost side by
 * side, which of them is connected, what each would do, and one step to take
 * for each:
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
  const { translateString, language } = useTranslateValue();
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
      <ProviderLogoImage logo={copy.logo} size={40} isDecorative={true} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-900">
            {translateString(copy.name)}
          </span>
          <Pill
            text={
              props.isConnected
                ? WORKSPACE_CONNECTIONS_PAGE_COPY.connected
                : WORKSPACE_CONNECTIONS_PAGE_COPY.notConnected
            }
            tone={props.isConnected ? PillTone.Success : PillTone.Neutral}
            dataTestId={`workspace-connection-status-${props.workspaceType}`}
          />
        </div>
        <div className="mt-1 text-sm text-gray-500">
          {translateString(copy.description)}
        </div>
        <Link
          to={RouteUtil.populateRouteParams(RouteMap[actionPage] as Route)}
          className="mt-2 inline-flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          {`${translateString(actionTitle)} ${getArrowOn(language)}`}
        </Link>
      </div>
    </li>
  );
};

export interface ComponentProps {
  slackPage: PageMap;
  microsoftTeamsPage: PageMap;
  mattermostPage: PageMap;
}

const WorkspaceConnectionsOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const connections: WorkspaceConnections = useWorkspaceConnections();

  const productPages: Record<WorkspaceType, PageMap> = {
    [WorkspaceType.Slack]: props.slackPage,
    [WorkspaceType.MicrosoftTeams]: props.microsoftTeamsPage,
    [WorkspaceType.Mattermost]: props.mattermostPage,
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
    body = <TableSkeleton rows={3} />;
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
