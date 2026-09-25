import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import Permission from "Common/Types/Permission";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceProjectAuthToken from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "Common/Models/DatabaseModels/WorkspaceUserAuthToken";

export interface ComponentProps {
  hideProjectCards?: boolean;
}

const DiscordIntegration: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [callbackError, setCallbackError] = useState<boolean>(
    Boolean(Navigation.getQueryStringByName("error")),
  );
  const [config, setConfig] = useState<JSONObject>({});
  const [project, setProject] = useState<WorkspaceProjectAuthToken | null>(
    null,
  );
  const [user, setUser] = useState<WorkspaceUserAuthToken | null>(null);
  const [channels, setChannels] = useState<Array<DropdownOption>>([]);
  const [channelId, setChannelId] = useState<string>("");
  const [saved, setSaved] = useState<boolean>(false);
  const permissions: Array<Permission> = PermissionUtil.getAllPermissions();
  const canDisconnect: boolean =
    UserUtil.isMasterAdmin() ||
    permissions.some((permission: Permission): boolean => {
      return [Permission.ProjectOwner, Permission.ProjectAdmin].includes(
        permission,
      );
    });
  const canManage: boolean =
    canDisconnect || permissions.includes(Permission.ProjectMember);

  const get: (path: string) => Promise<JSONObject> = async (
    path: string,
  ): Promise<JSONObject> => {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: URL.fromURL(APP_API_URL).addRoute(`/discord/${path}`),
        headers: ModelAPI.getCommonHeaders(),
      });
    if (response instanceof HTTPErrorResponse) {
      throw response;
    }
    return response.data;
  };

  const load: () => Promise<void> = async (): Promise<void> => {
    setLoading(true);
    setError("");
    setChannels([]);
    try {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      const userId: ObjectID | null = UserUtil.getUserId();
      if (!projectId || !userId) {
        throw new Error("Select a project and sign in to configure Discord.");
      }
      const setup: JSONObject = await get("config");
      setConfig(setup);
      const projectRows: ListResult<WorkspaceProjectAuthToken> =
        await ModelAPI.getList<WorkspaceProjectAuthToken>({
          modelType: WorkspaceProjectAuthToken,
          query: { projectId, workspaceType: WorkspaceType.Discord },
          select: { _id: true, miscData: true, workspaceProjectId: true },
          limit: 1,
          skip: 0,
          sort: { createdAt: SortOrder.Descending },
        });
      const userRows: ListResult<WorkspaceUserAuthToken> =
        await ModelAPI.getList<WorkspaceUserAuthToken>({
          modelType: WorkspaceUserAuthToken,
          query: { projectId, userId, workspaceType: WorkspaceType.Discord },
          select: { _id: true, miscData: true, workspaceUserId: true },
          limit: 1,
          skip: 0,
          sort: { createdAt: SortOrder.Descending },
        });
      const installed: WorkspaceProjectAuthToken | null =
        projectRows.data[0] || null;
      setProject(installed);
      setUser(userRows.data[0] || null);
      setChannelId(String(installed?.miscData?.["incidentChannelId"] || ""));
      if (
        installed &&
        setup["enabled"] &&
        !props.hideProjectCards &&
        canManage
      ) {
        const channelData: JSONObject = await get("channels");
        setChannels(
          ((channelData["channels"] || []) as Array<JSONObject>).map(
            (channel: JSONObject): DropdownOption => {
              return {
                value: String(channel["id"]),
                label: String(channel["name"]),
              };
            },
          ),
        );
      }
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const run: (action: () => Promise<void>) => Promise<void> = async (
    action: () => Promise<void>,
  ): Promise<void> => {
    setBusy(true);
    setError("");
    setCallbackError(false);
    setSaved(false);
    Navigation.setQueryString({ error: null, success: null });
    try {
      await action();
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Error));
    } finally {
      setBusy(false);
    }
  };

  const authorize: (path: string) => Promise<void> = async (
    path: string,
  ): Promise<void> => {
    const response: JSONObject = await get(path);
    const target: unknown = response["authorizationUrl"];
    if (
      typeof target !== "string" ||
      !target.startsWith("https://discord.com/oauth2/authorize?")
    ) {
      throw new Error(
        "OneUptime could not start the Discord connection. Retry the connection.",
      );
    }
    Navigation.navigate(URL.fromString(target));
  };

  if (loading) {
    return <PageLoader isVisible={true} />;
  }
  const enabled: boolean = config["enabled"] === true;
  const selected: DropdownOption | undefined = channels.find(
    (item: DropdownOption) => {
      return item.value === channelId;
    },
  );
  const guildName: string = String(
    project?.miscData?.["guildName"] ||
      project?.workspaceProjectId ||
      "No Discord server connected",
  );
  const userName: string = String(
    user?.miscData?.["displayName"] ||
      user?.miscData?.["username"] ||
      user?.workspaceUserId ||
      "No Discord account linked",
  );

  return (
    <div className="space-y-6">
      {(error || callbackError) && (
        <div role="alert">
          <ErrorMessage
            message={
              error || "Discord authorization failed. Retry the connection."
            }
          />
          <Button
            title="Retry"
            disabled={busy}
            onClick={() => {
              void run(load);
            }}
          />
        </div>
      )}
      {!enabled && (
        <Card
          title="Discord setup required"
          description="Discord integration is not configured for this deployment. Ask your OneUptime administrator to complete the setup."
        />
      )}
      <Card
        title="Discord server"
        description={
          props.hideProjectCards
            ? "The Discord server connected to this project."
            : "Connect one Discord server to this project, then choose a channel for incident threads."
        }
      >
        <div className="space-y-3">
          <p>{guildName}</p>
          {!props.hideProjectCards && (
            <Button
              title={
                project ? "Disconnect Discord server" : "Connect Discord server"
              }
              buttonStyle={
                project ? ButtonStyleType.DANGER : ButtonStyleType.PRIMARY
              }
              disabled={
                busy || (project ? !canDisconnect : !enabled || !canManage)
              }
              tooltip={
                project && !canDisconnect
                  ? "Only project owners and administrators can disconnect the server."
                  : !canManage
                    ? "Project membership with connection-management permission is required."
                    : undefined
              }
              isLoading={busy}
              onClick={() => {
                void run(async (): Promise<void> => {
                  if (project?.id) {
                    await ModelAPI.deleteItem({
                      modelType: WorkspaceProjectAuthToken,
                      id: project.id,
                    });
                    await load();
                  } else {
                    await authorize("install-url");
                  }
                });
              }}
            />
          )}
        </div>
      </Card>
      {project && !props.hideProjectCards && (
        <Card
          title="Incident parent channel"
          description="Incident discussions use threads in this channel. Resolving an incident archives and locks its thread while preserving the channel and message history."
        >
          <div className="space-y-3">
            <Dropdown
              ariaLabel="Incident parent channel"
              options={channels}
              value={selected}
              disabled={busy || !enabled || !canManage}
              placeholder="Select an incident channel"
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ): void => {
                setChannelId(typeof value === "string" ? value : "");
                setSaved(false);
              }}
            />
            {channelId && !selected && <p>Configured channel: {channelId}.</p>}
            {!canManage && (
              <p>
                Only project owners, administrators, and members can change the
                incident channel.
              </p>
            )}
            {canManage && !channels.length && (
              <p>
                No eligible text channels are available. Check the bot&apos;s
                channel and thread permissions, then retry.
              </p>
            )}
            <Button
              title="Save incident channel"
              disabled={busy || !enabled || !selected || !canManage}
              isLoading={busy}
              buttonStyle={ButtonStyleType.PRIMARY}
              onClick={() => {
                void run(async (): Promise<void> => {
                  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                    await API.put<JSONObject>({
                      url: URL.fromURL(APP_API_URL).addRoute(
                        "/discord/incident-channel",
                      ),
                      headers: ModelAPI.getCommonHeaders(),
                      data: { channelId },
                    });
                  if (response instanceof HTTPErrorResponse) {
                    throw response;
                  }
                  await load();
                  setSaved(true);
                });
              }}
            />
            {saved && <p role="status">Incident channel saved.</p>}
          </div>
        </Card>
      )}
      <Card
        title="Discord account"
        description="Link your own Discord identity for this project."
      >
        <div className="space-y-3">
          <p>{userName}</p>
          {!project && (
            <p>
              Connect a Discord server in project settings before linking your
              account.
            </p>
          )}
          <Button
            title={user ? "Unlink Discord account" : "Link Discord account"}
            disabled={busy || (!user && (!project || !enabled))}
            isLoading={busy}
            buttonStyle={
              user ? ButtonStyleType.DANGER : ButtonStyleType.PRIMARY
            }
            onClick={() => {
              void run(async (): Promise<void> => {
                if (user?.id) {
                  await ModelAPI.deleteItem({
                    modelType: WorkspaceUserAuthToken,
                    id: user.id,
                  });
                  await load();
                } else {
                  await authorize("sign-in-url");
                }
              });
            }}
          />
        </div>
      </Card>
      {!props.hideProjectCards && (
        <Card title="Discord application setup">
          <div className="space-y-2">
            <p>
              Register both OAuth callback URLs in the Discord developer portal.
              Set the interaction endpoint separately.
            </p>
            <p>
              Application ID:{" "}
              {String(config["applicationId"] || "Not configured")}
            </p>
            <p>
              Install callback:{" "}
              <code>
                {String(config["installCallbackUrl"] || "Unavailable")}
              </code>
            </p>
            <p>
              Account callback:{" "}
              <code>{String(config["userCallbackUrl"] || "Unavailable")}</code>
            </p>
            <p>
              Interaction endpoint:{" "}
              <code>{String(config["interactionUrl"] || "Unavailable")}</code>
            </p>
            <Link
              to={new Route("/docs/self-hosted/discord-integration")}
              openInNewTab={true}
            >
              Discord setup guide
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
};

export default DiscordIntegration;
