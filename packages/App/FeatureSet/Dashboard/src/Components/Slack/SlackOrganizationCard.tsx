import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon, { SizeProp, ThickProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import { SlackOrganizationWorkspace } from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * ONEUPTIME IN A SLACK ENTERPRISE ORGANIZATION, ON PROJECT SETTINGS.
 *
 * A project whose Slack connection is OneUptime installed for a whole
 * Slack Enterprise organization (SlackOrganization) works in each workspace
 * an organization admin added it to. This card lists them, says which one is
 * the default - where a notification rule that names no workspace creates
 * its channel - lets a member make another one the default, and says how
 * to add OneUptime to more workspaces: in Slack, where OneUptime is not told
 * about it, so Refresh asks Slack again.
 *
 * A project connected to one workspace that is part of an Enterprise
 * organization is told it could be installed for the whole organization
 * instead, keeping its rules, channels and connected accounts. Any other
 * project sees nothing here.
 */

export const SLACK_WORKSPACES_TITLE: string =
  translationKey("Slack workspaces");

export const SLACK_WORKSPACES_DESCRIPTION: string = translationKey(
  "OneUptime is installed for the whole {{organization}} organization and works in each workspace it was added to. A notification rule that names no workspace creates its channels in the default one.",
);

export const SLACK_WORKSPACES_REFRESH: string = translationKey("Refresh");

export const SLACK_WORKSPACE_DEFAULT_BADGE: string = translationKey("Default");

export const SLACK_WORKSPACE_MAKE_DEFAULT: string =
  translationKey("Make default");

export const SLACK_WORKSPACE_MAKE_DEFAULT_LABEL: string = translationKey(
  "Make {{workspace}} the default workspace",
);

export const SLACK_NO_WORKSPACES_TITLE: string = translationKey(
  "OneUptime is not added to any workspace yet",
);

export const SLACK_ADD_TO_MORE_WORKSPACES_HINT: string = translationKey(
  "To use OneUptime in another workspace, an organization admin adds it in Slack: Organization settings → Integrations → Installed apps → OneUptime → Add to more workspaces. Then click Refresh.",
);

export const SLACK_INSTALL_FOR_ORGANIZATION_TITLE: string = translationKey(
  "Use OneUptime in every workspace of your Slack organization",
);

export const SLACK_INSTALL_FOR_ORGANIZATION_DESCRIPTION: string =
  translationKey(
    "{{team}} is in a Slack Enterprise organization. An organization admin can install OneUptime for the whole organization. Rules, channels and connected accounts stay, and {{team}} becomes the default workspace.",
  );

export const SLACK_INSTALL_FOR_ORGANIZATION_BUTTON: string = translationKey(
  "Install for the organization",
);

export const SLACK_THIS_WORKSPACE: string = translationKey("This workspace");

// What GET /slack/workspaces answers.
export interface SlackConnectionDescription {
  isOrganization: boolean;
  isInOrganization: boolean;
  organizationName: string;
  workspaces: Array<SlackOrganizationWorkspace>;
  defaultWorkspaceId: string | null;
  // The workspaces OneUptime was removed from, by the names they had.
  removedWorkspaces: Array<SlackOrganizationWorkspace>;
}

// Workspaces as the route lists them: each with an id, and its name.
const readWorkspaces: (value: unknown) => Array<SlackOrganizationWorkspace> = (
  value: unknown,
): Array<SlackOrganizationWorkspace> => {
  return (Array.isArray(value) ? (value as Array<JSONObject>) : [])
    .map((workspace: JSONObject): SlackOrganizationWorkspace => {
      return {
        id: typeof workspace?.["id"] === "string" ? workspace["id"] : "",
        name: typeof workspace?.["name"] === "string" ? workspace["name"] : "",
      };
    })
    .filter((workspace: SlackOrganizationWorkspace): boolean => {
      return Boolean(workspace.id);
    });
};

export const readSlackConnectionDescription: (
  data: JSONObject | undefined,
) => SlackConnectionDescription = (
  data: JSONObject | undefined,
): SlackConnectionDescription => {
  return {
    isOrganization: data?.["isOrganization"] === true,
    isInOrganization: data?.["isInOrganization"] === true,
    organizationName:
      typeof data?.["organizationName"] === "string"
        ? (data["organizationName"] as string)
        : "",
    workspaces: readWorkspaces(data?.["workspaces"]),
    defaultWorkspaceId:
      typeof data?.["defaultWorkspaceId"] === "string"
        ? (data["defaultWorkspaceId"] as string)
        : null,
    removedWorkspaces: readWorkspaces(data?.["removedWorkspaces"]),
  };
};

export interface ComponentProps {
  // The workspace a project connected to one workspace is connected to, by name.
  teamName?: string | undefined;
  // Spacing above the card, when it shows: it draws nothing otherwise.
  className?: string | undefined;
  // Starts installing OneUptime again - for the whole organization, in Slack.
  onInstallForOrganization: () => void;
}

const SlackOrganizationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();

  const [connection, setConnection] =
    useState<SlackConnectionDescription | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  // The workspace being made the default, while the request is out.
  const [makingDefaultId, setMakingDefaultId] = useState<string>("");

  type LoadFunction = (refresh: boolean) => Promise<void>;

  const load: LoadFunction = async (refresh: boolean): Promise<void> => {
    try {
      setError("");

      if (refresh) {
        setIsRefreshing(true);
      }

      const url: URL = URL.fromURL(APP_API_URL).addRoute("/slack/workspaces");

      if (refresh) {
        url.addQueryParam("refresh", "true");
      }

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: url,
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setConnection(readSlackConnectionDescription(response.data));
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    load(false).catch((err: Exception) => {
      setError(API.getFriendlyErrorMessage(err));
    });
  }, []);

  type MakeDefaultFunction = (workspaceId: string) => Promise<void>;

  const makeDefault: MakeDefaultFunction = async (
    workspaceId: string,
  ): Promise<void> => {
    try {
      setError("");
      setMakingDefaultId(workspaceId);

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.put<JSONObject>({
          url: URL.fromURL(APP_API_URL).addRoute("/slack/default-workspace"),
          data: { workspaceId: workspaceId },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setConnection(readSlackConnectionDescription(response.data));
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setMakingDefaultId("");
    }
  };

  /*
   * Most projects are connected to one workspace, and this card shows them
   * nothing: it shows nothing until it knows - no loader that then goes.
   * Slack could not be asked, or the project's connection could not be
   * read: the rest of the page works all the same, so this card says
   * nothing rather than an error about something nobody asked for.
   */
  if (isLoading || !connection) {
    return null;
  }

  /*
   * One workspace of an Enterprise organization: it could be the whole
   * organization's installation instead.
   */
  if (!connection.isOrganization) {
    if (!connection.isInOrganization) {
      return null;
    }

    return (
      <div
        data-testid="slack-install-for-organization"
        className={props.className}
      >
        <Card
          title={SLACK_INSTALL_FOR_ORGANIZATION_TITLE}
          description={translator.translateTemplate(
            SLACK_INSTALL_FOR_ORGANIZATION_DESCRIPTION,
            {
              team:
                props.teamName ||
                translator.translateText(SLACK_THIS_WORKSPACE) ||
                SLACK_THIS_WORKSPACE,
            },
          )}
          buttons={[
            {
              title: SLACK_INSTALL_FOR_ORGANIZATION_BUTTON,
              buttonStyle: ButtonStyleType.NORMAL,
              icon: IconProp.Slack,
              onClick: () => {
                props.onInstallForOrganization();
              },
            },
          ]}
        />
      </div>
    );
  }

  const organizationName: string =
    connection.organizationName || translator.translateText("Slack") || "Slack";

  return (
    <div
      data-testid="slack-organization-workspaces"
      className={props.className}
    >
      <Card
        title={SLACK_WORKSPACES_TITLE}
        description={translator.translateTemplate(
          SLACK_WORKSPACES_DESCRIPTION,
          { organization: organizationName },
        )}
        buttons={[
          {
            title: SLACK_WORKSPACES_REFRESH,
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Refresh,
            isLoading: isRefreshing,
            disabled: isRefreshing || Boolean(makingDefaultId),
            onClick: () => {
              load(true).catch((err: Exception) => {
                setError(API.getFriendlyErrorMessage(err));
              });
            },
          },
        ]}
      >
        <div className="mt-2 space-y-3">
          {error && <ErrorMessage message={error} />}

          {connection.workspaces.length === 0 && (
            <div
              className="rounded-lg border border-dashed border-gray-300 px-6 py-8 text-center"
              data-testid="slack-workspaces-empty"
            >
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                <Icon
                  icon={IconProp.Slack}
                  size={SizeProp.Large}
                  thick={ThickProp.Thick}
                  className="h-6 w-6"
                />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-gray-900">
                {translator.translateText(SLACK_NO_WORKSPACES_TITLE) ||
                  SLACK_NO_WORKSPACES_TITLE}
              </h3>
              <p className="mx-auto mt-1 max-w-lg text-sm text-gray-500">
                {translator.translateText(SLACK_ADD_TO_MORE_WORKSPACES_HINT) ||
                  SLACK_ADD_TO_MORE_WORKSPACES_HINT}
              </p>
            </div>
          )}

          {connection.workspaces.length > 0 && (
            <ul
              className="divide-y divide-gray-200 overflow-hidden rounded-md border border-gray-200 bg-white"
              data-testid="slack-workspaces-list"
            >
              {connection.workspaces.map(
                (workspace: SlackOrganizationWorkspace) => {
                  const isDefault: boolean =
                    workspace.id === connection.defaultWorkspaceId;
                  const name: string = workspace.name || workspace.id;

                  return (
                    <li
                      key={workspace.id}
                      className="flex flex-wrap items-center gap-3 px-4 py-3"
                      data-testid={`slack-workspace-${workspace.id}`}
                    >
                      <div
                        className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-indigo-50 text-sm font-semibold uppercase text-indigo-700"
                        aria-hidden="true"
                      >
                        {name.trim().charAt(0) || "#"}
                      </div>
                      {/*
                       * A floor rather than min-w-0, as on the channels
                       * card: on a phone the button wraps onto its own line
                       * instead of squeezing the name to nothing.
                       */}
                      <div className="min-w-[8rem] flex-1">
                        <div className="truncate font-medium text-gray-900">
                          {name}
                        </div>
                      </div>
                      {isDefault ? (
                        <span
                          className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-600/20"
                          data-testid="slack-workspace-default"
                        >
                          {translator.translateText(
                            SLACK_WORKSPACE_DEFAULT_BADGE,
                          ) || SLACK_WORKSPACE_DEFAULT_BADGE}
                        </span>
                      ) : (
                        <Button
                          title={SLACK_WORKSPACE_MAKE_DEFAULT}
                          ariaLabel={translator.translateTemplate(
                            SLACK_WORKSPACE_MAKE_DEFAULT_LABEL,
                            { workspace: name },
                          )}
                          isAriaLabelTranslated={true}
                          buttonStyle={ButtonStyleType.OUTLINE}
                          buttonSize={ButtonSize.Small}
                          isLoading={makingDefaultId === workspace.id}
                          disabled={Boolean(makingDefaultId) || isRefreshing}
                          dataTestId={`slack-workspace-make-default-${workspace.id}`}
                          onClick={() => {
                            makeDefault(workspace.id).catch(
                              (err: Exception) => {
                                setError(API.getFriendlyErrorMessage(err));
                              },
                            );
                          }}
                        />
                      )}
                    </li>
                  );
                },
              )}
            </ul>
          )}

          {connection.workspaces.length > 0 && (
            <p
              className="text-xs text-gray-500"
              data-testid="slack-workspaces-hint"
            >
              {translator.translateText(SLACK_ADD_TO_MORE_WORKSPACES_HINT) ||
                SLACK_ADD_TO_MORE_WORKSPACES_HINT}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
};

export default SlackOrganizationCard;
