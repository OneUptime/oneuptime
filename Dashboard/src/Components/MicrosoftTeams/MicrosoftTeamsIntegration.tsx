import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
} from "react";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import URL from "Common/Types/API/URL";
import { APP_API_URL, HOME_URL, MicrosoftTeamsAppId } from "Common/UI/Config";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import Exception from "Common/Types/Exception/Exception";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import WorkspaceProjectAuthToken from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import WorkspaceUserAuthToken from "Common/Models/DatabaseModels/WorkspaceUserAuthToken";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import MicrosoftTeamsIntegrationDocumentation from "./MicrosoftTeamsIntegrationDocumentation";
import Link from "Common/UI/Components/Link/Link";
import WorkspaceModel from "Common/Models/DatabaseModels/Model";

export interface MicrosoftTeamsMiscData {
  teamId: string;
  teamName: string;
  tenantId: string;
  serviceUrl: string;
}

export interface ComponentProps {
  integratedModels: Array<WorkspaceModel>;
  workspaceType: WorkspaceType;
}

const MicrosoftTeamsIntegration: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [error, setError] = React.useState<ReactElement | null>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [manifest, setManifest] = React.useState<JSONObject | null>(null);
  const [isUserAccountConnected, setIsUserAccountConnected] =
    React.useState<boolean>(false);
  const [userAuthTokenId, setWorkspaceUserAuthTokenId] =
    React.useState<ObjectID | null>(null);
  const [projectAuthTokenId, setWorkspaceProjectAuthTokenId] =
    React.useState<ObjectID | null>(null);
  const [isProjectAccountConnected, setIsProjectAccountConnected] =
    React.useState<boolean>(false);
  const [isButtonLoading, setIsButtonLoading] = React.useState<boolean>(false);
  const [teamsTeamName, setTeamsTeamName] = React.useState<string | null>(null);

  const loadItems: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setError(null);
      setIsLoading(true);

      // check if the project is already connected with Microsoft Teams.
      const projectAuth: ListResult<WorkspaceProjectAuthToken> =
        await ModelAPI.getList<WorkspaceProjectAuthToken>({
          modelType: WorkspaceProjectAuthToken,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            workspaceType: WorkspaceType.MicrosoftTeams,
          },
          select: {
            _id: true,
            miscData: true,
          },
          limit: 1,
          skip: 0,
          sort: {
            createdAt: SortOrder.Descending,
          },
        });

      if (projectAuth.data.length > 0) {
        setIsProjectAccountConnected(true);
        const teamName: string | undefined = (
          projectAuth.data[0]!.miscData! as MicrosoftTeamsMiscData
        ).teamName;
        setWorkspaceProjectAuthTokenId(projectAuth.data[0]!.id);
        setTeamsTeamName(teamName);
      }

      // fetch user auth token.
      const userAuth: ListResult<WorkspaceUserAuthToken> =
        await ModelAPI.getList<WorkspaceUserAuthToken>({
          modelType: WorkspaceUserAuthToken,
          query: {
            userId: UserUtil.getUserId()!,
            workspaceType: WorkspaceType.MicrosoftTeams,
          },
          select: {
            _id: true,
          },
          limit: 1,
          skip: 0,
          sort: {
            createdAt: SortOrder.Descending,
          },
        });

      if (userAuth.data.length > 0) {
        setIsUserAccountConnected(true);
        setWorkspaceUserAuthTokenId(userAuth.data[0]!.id);
      }

      if (!isUserAccountConnected || !isProjectAccountConnected) {
        // if any of this is not connected then fetch the app manifest, so we can connect with Teams.

        // fetch app manifest.
        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.get<JSONObject>(
            URL.fromString(
              `${HOME_URL.toString()}/api/microsoft-teams/app-manifest`,
            ),
          );

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        setManifest(response.data);
      }
    } catch (error) {
      setError(<div>{API.getFriendlyErrorMessage(error as Error)}</div>);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // if this page has a query param with error, then there was the error in authentication.
    const error: string | null = Navigation.getQueryStringByName("error");

    if (error) {
      setError(
        <ErrorMessage error={new Exception(decodeURIComponent(error))} />,
      );
    }

    loadItems();
  }, []);

  const disconnectTeams: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsButtonLoading(true);

      if (userAuthTokenId) {
        await ModelAPI.deleteItem<WorkspaceUserAuthToken>({
          modelType: WorkspaceUserAuthToken,
          id: userAuthTokenId,
        });
      }

      if (projectAuthTokenId) {
        await ModelAPI.deleteItem<WorkspaceProjectAuthToken>({
          modelType: WorkspaceProjectAuthToken,
          id: projectAuthTokenId,
        });
      }

      await loadItems();
    } catch (error) {
      setError(<div>{API.getFriendlyErrorMessage(error as Error)}</div>);
    } finally {
      setIsButtonLoading(false);
    }
  };

  const connectTeamsApp: PromiseVoidFunction = async (): Promise<void> => {
    setIsButtonLoading(true);

    const projectId: ObjectID | undefined = ProjectUtil.getCurrentProjectId();
    const userId: ObjectID | undefined = UserUtil.getUserId();

    if (!projectId) {
      setError(<ErrorMessage error="No project selected." />);
      return;
    }

    if (!userId) {
      setError(<ErrorMessage error="User not logged in." />);
      return;
    }

    if (!MicrosoftTeamsAppId) {
      setError(
        <ErrorMessage error="Microsoft Teams App ID is not configured. Please contact your system administrator." />,
      );
      return;
    }

    // Construct Microsoft Teams OAuth URL
    const tenantId: string = "common"; // Use "common" for multi-tenant
    const authUrl: string = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;
    const redirectUri: string = `${APP_API_URL.toString()}/microsoft-teams/auth/${projectId.toString()}/${userId.toString()}`;
    const scope: string = "https://graph.microsoft.com/.default";

    const authParams: URLSearchParams = new URLSearchParams({
      client_id: MicrosoftTeamsAppId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: scope,
      response_mode: "query",
    });

    Navigation.navigate(URL.fromString(`${authUrl}?${authParams.toString()}`));
  };

  const connectUserAccount: PromiseVoidFunction = async (): Promise<void> => {
    setIsButtonLoading(true);

    const projectId: ObjectID | undefined = ProjectUtil.getCurrentProjectId();
    const userId: ObjectID | undefined = UserUtil.getUserId();

    if (!projectId) {
      setError(<ErrorMessage error="No project selected." />);
      return;
    }

    if (!userId) {
      setError(<ErrorMessage error="User not logged in." />);
      return;
    }

    if (!MicrosoftTeamsAppId) {
      setError(
        <ErrorMessage error="Microsoft Teams App ID is not configured. Please contact your system administrator." />,
      );
      return;
    }

    // For user account connection, we use the same OAuth flow
    const tenantId: string = "common";
    const authUrl: string = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;
    const redirectUri: string = `${APP_API_URL.toString()}/microsoft-teams/auth/${projectId.toString()}/${userId.toString()}`;
    const scope: string = "https://graph.microsoft.com/.default";

    const authParams: URLSearchParams = new URLSearchParams({
      client_id: MicrosoftTeamsAppId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: scope,
      response_mode: "query",
    });

    Navigation.navigate(URL.fromString(`${authUrl}?${authParams.toString()}`));
  };

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <>{error}</>;
  }

  return (
    <Fragment>
      {!isProjectAccountConnected && (
        <Card
          title={"Connect to Microsoft Teams Workspace"}
          description={
            <span>
              Connect your Microsoft Teams workspace to OneUptime. This will
              allow you to receive notifications on Teams channels when
              incidents, alerts, or other events are created.
            </span>
          }
          buttons={[
            {
              title: `${
                isProjectAccountConnected ? "Reconnect" : "Connect"
              } to Microsoft Teams`,
              onClick: connectTeamsApp,
              isLoading: isButtonLoading,
              buttonStyle: ButtonStyleType.PRIMARY,
              icon: IconProp.Slack,
            },
          ]}
        />
      )}

      {isProjectAccountConnected && (
        <Card
          title={"Microsoft Teams Workspace Connected"}
          description={
            <span>
              Your workspace is connected to Microsoft Teams team:{" "}
              <strong>{teamsTeamName}</strong>. You can now receive
              notifications on Teams channels when incidents, alerts, or other
              events are created.
            </span>
          }
          buttons={[
            {
              title: `Disconnect from Microsoft Teams`,
              onClick: disconnectTeams,
              isLoading: isButtonLoading,
              buttonStyle: ButtonStyleType.DANGER_OUTLINE,
              icon: IconProp.Slack,
            },
          ]}
        />
      )}

      {isProjectAccountConnected && !isUserAccountConnected && (
        <Card
          title={"Connect Your Microsoft Teams Account"}
          description={
            <span>
              Connect your personal Microsoft Teams account to OneUptime. This
              will allow you to interact with OneUptime directly from Microsoft
              Teams.
            </span>
          }
          buttons={[
            {
              title: `Connect Your Microsoft Teams Account`,
              onClick: connectUserAccount,
              isLoading: isButtonLoading,
              buttonStyle: ButtonStyleType.PRIMARY,
              icon: IconProp.User,
            },
          ]}
        />
      )}

      {isProjectAccountConnected && isUserAccountConnected && (
        <Card
          title={"Your Microsoft Teams Account Connected"}
          description={
            <span>
              Your Microsoft Teams account is connected to OneUptime. You can
              now interact with OneUptime directly from Microsoft Teams.
            </span>
          }
        />
      )}

      {isProjectAccountConnected && (
        <MicrosoftTeamsIntegrationDocumentation
          integratedModels={props.integratedModels}
          workspaceType={props.workspaceType}
        />
      )}

      {manifest && !isProjectAccountConnected && (
        <Card
          title={"Create Microsoft Teams App"}
          description={
            <div>
              <p>
                To connect OneUptime with Microsoft Teams, you need to create a
                Teams app first. Please follow these steps:
              </p>
              <ol>
                <li>
                  Go to{" "}
                  <Link
                    to={URL.fromString("https://dev.teams.microsoft.com/apps")}
                    openInNewTab={true}
                    className="underline"
                  >
                    Microsoft Teams Developer Portal
                  </Link>
                </li>
                <li>Click on "New app" to create a new app</li>
                <li>
                  Import the app manifest provided below or configure manually
                </li>
                <li>
                  Configure OAuth2 with redirect URL:{" "}
                  <code>
                    {APP_API_URL.toString()}/microsoft-teams/auth/
                    {ProjectUtil.getCurrentProjectId()?.toString()}/
                    {UserUtil.getUserId()?.toString()}
                  </code>
                </li>
                <li>
                  Once the app is created and published, click the "Connect to
                  Microsoft Teams" button above
                </li>
              </ol>
              <details>
                <summary>App Manifest (click to expand)</summary>
                <pre className="bg-gray-100 p-2 rounded mt-2 overflow-auto">
                  {JSON.stringify(manifest, null, 2)}
                </pre>
              </details>
            </div>
          }
        />
      )}
    </Fragment>
  );
};

export default MicrosoftTeamsIntegration;