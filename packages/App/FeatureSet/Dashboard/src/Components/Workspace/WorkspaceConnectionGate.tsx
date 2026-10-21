import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ConnectedWorkspaces, {
  WorkspaceConnections,
  useWorkspaceConnections,
} from "../../Utils/Workspace/ConnectedWorkspaces";
import {
  WORKSPACE_CONNECTION_COPY,
  WorkspaceConnectionCopy,
} from "./WorkspaceConnectionCopy";
import Route from "Common/Types/API/Route";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

export interface NotConnectedProps {
  workspaceType: WorkspaceType;
}

/*
 * A product's Slack or Microsoft Teams page, when the project has not
 * connected that workspace. It used to end with "Please go to Project
 * Settings > Workspace Connections > Slack", a path to retype by hand; it
 * now has the button that goes there.
 */
export const WorkspaceNotConnected: FunctionComponent<NotConnectedProps> = (
  props: NotConnectedProps,
): ReactElement => {
  const copy: WorkspaceConnectionCopy =
    WORKSPACE_CONNECTION_COPY[props.workspaceType];

  return (
    <EmptyState
      id={`workspace-not-connected-${props.workspaceType}`}
      icon={copy.icon}
      title={copy.notConnectedTitle}
      description={copy.notConnectedDescription}
      footer={
        <Button
          title={copy.connectTitle}
          icon={copy.icon}
          buttonStyle={ButtonStyleType.PRIMARY}
          dataTestId={`workspace-connect-${props.workspaceType}`}
          onClick={() => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[copy.settingsPage] as Route,
              ),
            );
          }}
        />
      }
    />
  );
};

export interface ComponentProps {
  workspaceType: WorkspaceType;
  children: ReactElement;
}

/*
 * The body of a product's Slack or Microsoft Teams page: the page itself
 * once this page load knows the workspace is connected, and the way to
 * connect it once it knows it is not.
 *
 * It waits for this page load's own answer (from the store the side menu
 * shares, so it is asked once), not the one remembered from an earlier
 * visit: a page of notification rules must not flash up for a workspace
 * that has since been disconnected.
 */
const WorkspaceConnectionGate: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const connections: WorkspaceConnections = useWorkspaceConnections();

  if (!connections.isFresh) {
    if (connections.error) {
      return (
        <ErrorMessage
          message={connections.error}
          onRefreshClick={() => {
            ConnectedWorkspaces.refresh().catch(() => {
              // A failed request is kept as `error` and shown here again.
            });
          }}
        />
      );
    }

    return <PageLoader isVisible={true} />;
  }

  if (connections.connected?.includes(props.workspaceType)) {
    return props.children;
  }

  return <WorkspaceNotConnected workspaceType={props.workspaceType} />;
};

export default WorkspaceConnectionGate;
