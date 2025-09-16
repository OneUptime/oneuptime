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
import { APP_API_URL, HOME_URL, MicrosoftTeamsAppClientId } from "Common/UI/Config";
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
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsMiscData,
} from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import WorkspaceUserAuthToken from "Common/Models/DatabaseModels/WorkspaceUserAuthToken";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import MicrosoftTeamsIntegrationDocumentation from "./MicrosoftTeamsIntegrationDocumentation";
import Link from "Common/UI/Components/Link/Link";

export interface ComponentProps {
  onConnected: VoidFunction;
  onDisconnected: VoidFunction;
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
  const [availableTeams, setAvailableTeams] = React.useState<Array<{ id: string; displayName: string }>>([]);
  const [isSelectingTeam, setIsSelectingTeam] = React.useState<boolean>(false);
  const [selectedTeamId, setSelectedTeamId] = React.useState<string>("");
  const [teamSearch, setTeamSearch] = React.useState<string>("");
  const filteredTeams = React.useMemo(() => {
    if (!teamSearch) { return availableTeams; }
    return availableTeams.filter(t => t.displayName.toLowerCase().includes(teamSearch.toLowerCase()));
  }, [teamSearch, availableTeams]);

  const confirmTeamSelection: PromiseVoidFunction = async (): Promise<void> => {
    if (!selectedTeamId || isButtonLoading) { return; }
    try {
      setIsButtonLoading(true);
      setError(null);
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      const userId: ObjectID | null = UserUtil.getUserId();
      if (!projectId || !userId) {
        throw new Error('Missing project or user context');
      }
      const result = await API.post(
        URL.fromString(`${HOME_URL.toString()}/api/microsoft-teams/select-team`),
        {
          projectId: projectId.toString(),
            userId: userId.toString(),
          teamId: selectedTeamId,
        } as JSONObject,
      );
      if (result instanceof HTTPErrorResponse) {
        throw result;
      }
      setIsSelectingTeam(false);
      setAvailableTeams([]);
      await loadItems();
    } catch (err) {
      setError(<div>{API.getFriendlyErrorMessage(err as Error)}</div>);
    } finally {
      setIsButtonLoading(false);
    }
  };

  const renderTeamGrid = (): ReactElement => {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{filteredTeams.length} team{filteredTeams.length === 1 ? '' : 's'} {teamSearch && `(filtered)`}</div>
          <input
            placeholder="Search teams..."
            value={teamSearch}
            onChange={(e) => setTeamSearch(e.target.value)}
            style={{
              padding: '6px 10px',
              border: '1px solid var(--gray-300)',
              borderRadius: 4,
              width: '200px'
            }}
          />
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '12px'
          }}
        >
          {filteredTeams.map(team => {
            const isSelected: boolean = selectedTeamId === team.id;
            return (
              <div
                key={team.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                onClick={() => setSelectedTeamId(team.id)}
                onDoubleClick={() => { setSelectedTeamId(team.id); confirmTeamSelection().catch(() => {}); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { setSelectedTeamId(team.id); }
                  if (e.key === 'Enter' && selectedTeamId === team.id) { confirmTeamSelection().catch(() => {}); }
                }}
                style={{
                  border: isSelected ? '2px solid var(--primary-500)' : '1px solid var(--gray-300)',
                  padding: '12px 12px 14px 12px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: isSelected ? 'linear-gradient(135deg,var(--primary-50), #ffffff)' : '#fff',
                  boxShadow: isSelected ? '0 0 0 2px var(--primary-100)' : '0 1px 2px rgba(0,0,0,0.04)',
                  transition: 'all 120ms ease'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <strong style={{ fontSize: 14, lineHeight: '18px' }}>{team.displayName}</strong>
                  {isSelected && <span style={{ fontSize: 11, color: 'var(--primary-600)', fontWeight: 600 }}>Selected</span>}
                </div>
                <div style={{ fontSize: 11, opacity: 0.6, wordBreak: 'break-all' }}>ID: {team.id}</div>
                <div style={{ fontSize: 11, opacity: 0.55, marginTop: 6 }}>Double-click or press Enter twice to confirm</div>
              </div>
            );
          })}
          {filteredTeams.length === 0 && (
            <div style={{ fontSize: 13, opacity: 0.7 }}>No teams match "{teamSearch}".</div>
          )}
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (isProjectAccountConnected) {
      props.onConnected();
    } else {
      props.onDisconnected();
    }
  }, [isProjectAccountConnected]);

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
        const teamsTeamName: string | undefined = (
          projectAuth.data[0]!.miscData! as MicrosoftTeamsMiscData
        ).teamName;
        setWorkspaceProjectAuthTokenId(projectAuth.data[0]!.id);
        setTeamsTeamName(teamsTeamName);
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
            miscData: true,
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
        const miscData: any = userAuth.data[0]!.miscData || {};
        if (miscData.availableTeams && Array.isArray(miscData.availableTeams)) {
          setAvailableTeams(
            miscData.availableTeams.map((t: any) => ({
              id: t.id as string,
              displayName: t.displayName as string,
            })),
          );
          setIsSelectingTeam(true);
        }
      }

      if (!isUserAccountConnected || !isProjectAccountConnected) {
        // if any of this is not connected then fetch the app manifest, so we can connect with Teams.

        // fetch app manifest.
        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.get<JSONObject>(
            URL.fromString(`${HOME_URL.toString()}/api/microsoft-teams/app-manifest`),
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
        <div>
          There was an error while connecting with Microsoft Teams. Please try again.
          <br />
          Error: {error}
        </div>,
      );
      return;
    }

    loadItems().catch((error: Exception) => {
      setError(<div>{API.getFriendlyErrorMessage(error)}</div>);
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }
  // Show team selection UI if user has multiple teams available and project not yet connected.
  if (isSelectingTeam && !isProjectAccountConnected && availableTeams.length > 0) {
    return (
      <Fragment>
        <Card
          title="Select a Microsoft Teams Team"
          description="Choose which Microsoft Teams team you want to connect. You can only connect one team per project."
          buttons={[]}
        >
          {renderTeamGrid()}
          <div style={{ marginTop: '16px' }}>
            <Card
              title=""
              description=""
              buttons={[
                {
                  title: 'Confirm Selection',
                  isLoading: isButtonLoading,
                  buttonStyle: ButtonStyleType.PRIMARY,
                  icon: IconProp.Check,
                  onClick: async () => {
                    confirmTeamSelection().catch(() => {});
                  }
                },
                {
                  title: 'Cancel',
                  buttonStyle: ButtonStyleType.SECONDARY,
                  icon: IconProp.Close,
                  onClick: () => {
                    setIsSelectingTeam(false);
                  }
                }
              ]}
            />
            <div style={{ marginTop: 8, fontSize: 11, opacity: 0.65 }}>
              Tip: Double-click a team card to confirm immediately.
            </div>
            <div style={{ marginTop: 4, fontSize: 11, opacity: 0.55 }}>
              You can reconnect later to choose a different team (feature coming soon).
            </div>
          </div>
        </Card>
      </Fragment>
    );
  }

  let cardTitle: string = "";
  let cardDescription: string = "";
  let cardButtons: Array<CardButtonSchema> = [];

  // if user and project both connected with Microsoft Teams, then.
  if (isUserAccountConnected && isProjectAccountConnected) {
    cardTitle = `You are connected with ${teamsTeamName} team on Microsoft Teams`;
    cardDescription = `Your account is already connected with Microsoft Teams.`;
    cardButtons = [
      {
        title: `Disconnect`,
        isLoading: isButtonLoading,
        buttonStyle: ButtonStyleType.DANGER,
        onClick: async () => {
          try {
            setIsButtonLoading(true);
            setError(null);
            if (userAuthTokenId) {
              await ModelAPI.deleteItem({
                modelType: WorkspaceUserAuthToken,
                id: userAuthTokenId!,
              });

              setIsUserAccountConnected(false);
              setWorkspaceUserAuthTokenId(null);
            } else {
              setError(
                <div>
                  Looks like the user auth token id is not set properly. Please
                  try again.
                </div>,
              );
            }
          } catch (error) {
            setError(
              <div>{API.getFriendlyErrorMessage(error as Exception)}</div>,
            );
          }
          setIsButtonLoading(false);
        },
        icon: IconProp.Close,
      },
    ];
  }

  const connectWithTeams: VoidFunction = (): void => {
    if (MicrosoftTeamsAppClientId) {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      const userId: ObjectID | null = UserUtil.getUserId();

      if (!projectId) {
        setError(
          <div>
            Looks like you have not selected any project. Please select a
            project to continue.
          </div>,
        );
        return;
      }

      if (!userId) {
        setError(
          <div>
            Looks like you are not logged in. Please login to continue.
          </div>,
        );
        return;
      }

  // Use static redirect URI (no projectId/userId in path) and encode both values in the state param.
  const redirectUri: string = `${APP_API_URL}/microsoft-teams/auth`;
  const scopes: string = "https://graph.microsoft.com/User.Read https://graph.microsoft.com/Team.ReadBasic.All https://graph.microsoft.com/Channel.ReadBasic.All https://graph.microsoft.com/ChannelMessage.Send";
  const state: string = `${projectId.toString()}:${userId.toString()}`;

      if (!isProjectAccountConnected) {
        // Install the app and connect the project
        Navigation.navigate(
          URL.fromString(
            `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${MicrosoftTeamsAppClientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&response_mode=query&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}`
          ),
        );
      } else {
        // if project account is already connected then we just need to sign in with Teams and not install the app.
        Navigation.navigate(
          URL.fromString(
            `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${MicrosoftTeamsAppClientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&response_mode=query&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}`
          ),
        );
      }
    } else {
      setError(
        <div>
          Looks like the Microsoft Teams App Client ID is not set in the environment
          variables when you installed OneUptime. For more information, please
          check this guide to set up Microsoft Teams App properly:{" "}
          <Link
            to={new Route("/docs/self-hosted/microsoft-teams-integration")}
            openInNewTab={true}
          >
            Microsoft Teams Integration
          </Link>
        </div>,
      );
    }
  };

  type GetConnectWithTeamsButtonFunction = (title: string) => CardButtonSchema;

  const getConnectWithTeamsButton: GetConnectWithTeamsButtonFunction = (
    title: string,
  ): CardButtonSchema => {
    return {
      title: title || `Connect with Microsoft Teams`,
      buttonStyle: ButtonStyleType.PRIMARY,
      onClick: () => {
        return connectWithTeams();
      },
      icon: IconProp.MicrosoftTeams,
    };
  };

  // if user is not connected and the project is connected with Teams.
  if (!isUserAccountConnected && isProjectAccountConnected) {
    cardTitle = `You are disconnected from Microsoft Teams (but OneUptime is already installed in ${teamsTeamName} team)`;
    cardDescription = `Connect your account with Microsoft Teams to make the most out of OneUptime.`;
    cardButtons = [
      // connect with Teams button.
      getConnectWithTeamsButton(`Connect my account with Microsoft Teams`),
      {
        title: `Uninstall OneUptime from Microsoft Teams`,
        isLoading: isButtonLoading,
        buttonStyle: ButtonStyleType.DANGER,
        onClick: async () => {
          try {
            setIsButtonLoading(true);
            setError(null);
            if (projectAuthTokenId) {
              await ModelAPI.deleteItem({
                modelType: WorkspaceProjectAuthToken,
                id: projectAuthTokenId!,
              });

              setIsProjectAccountConnected(false);
              setWorkspaceProjectAuthTokenId(null);
            } else {
              setError(
                <div>
                  Looks like the project auth token id is not set properly. Please
                  try again.
                </div>,
              );
            }
          } catch (error) {
            setError(
              <div>{API.getFriendlyErrorMessage(error as Exception)}</div>,
            );
          }
          setIsButtonLoading(false);
        },
        icon: IconProp.Trash,
      },
    ];
  }

  if (!isProjectAccountConnected) {
    cardTitle = `Connect with Microsoft Teams`;
    cardDescription = `Connect your account with Microsoft Teams to make the most out of OneUptime.`;
    cardButtons = [getConnectWithTeamsButton(`Connect with Microsoft Teams`)];
  }

  if (!MicrosoftTeamsAppClientId) {
    return <MicrosoftTeamsIntegrationDocumentation manifest={manifest as JSONObject} />;
  }

  return (
    <Fragment>
      <div>
        <Card
          title={cardTitle}
          description={cardDescription}
          buttons={cardButtons}
        />
      </div>
    </Fragment>
  );
};

export default MicrosoftTeamsIntegration;