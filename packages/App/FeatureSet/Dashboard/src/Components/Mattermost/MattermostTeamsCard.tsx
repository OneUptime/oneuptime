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
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import IconProp from "Common/Types/Icon/IconProp";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import { MattermostConnectionTeam } from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { MattermostRuleTeams } from "../Workspace/NotificationRuleForm/NotificationRuleCopy";

/*
 * THE MATTERMOST TEAMS ONEUPTIME WORKS IN, ON PROJECT SETTINGS.
 *
 * A project connected to a Mattermost server works in every team its bot
 * account is a member of (MattermostTeams). This card lists them, says
 * which one is the default - where a notification rule that names no team
 * posts and creates its channels - lets a member make another one the
 * default, and says how to use OneUptime in another team: add the bot to it
 * in Mattermost, which tells OneUptime nothing, so Refresh asks the server
 * again. A default team the bot was taken out of is said so.
 */

export const MATTERMOST_TEAMS_TITLE: string =
  translationKey("Mattermost teams");

export const MATTERMOST_TEAMS_DESCRIPTION: string = translationKey(
  "OneUptime works in every team its bot @{{bot}} is a member of. A notification rule that names no team creates its channels in the default one.",
);

export const MATTERMOST_TEAMS_REFRESH: string = translationKey("Refresh");

export const MATTERMOST_TEAM_DEFAULT_BADGE: string = translationKey("Default");

export const MATTERMOST_TEAM_MAKE_DEFAULT: string =
  translationKey("Make default");

export const MATTERMOST_TEAM_MAKE_DEFAULT_LABEL: string = translationKey(
  "Make {{team}} the default team",
);

export const MATTERMOST_ADD_BOT_TO_TEAM_HINT: string = translationKey(
  "To use OneUptime in another team, add @{{bot}} to it in Mattermost as you would add a person: open the team, then Main Menu → Invite People. Then click Refresh.",
);

export const MATTERMOST_BOT_LEFT_DEFAULT_TEAM: string = translationKey(
  "OneUptime's bot is no longer a member of {{team}}, the default team. Add it back in Mattermost, or make another team the default.",
);

// A team of the project's connection, as GET /mattermost/connected-teams lists it.
export interface MattermostTeamOfProject extends MattermostConnectionTeam {
  isDefault: boolean;
}

// What GET /mattermost/connected-teams and PUT /mattermost/default-team answer.
export interface MattermostTeamsDescription {
  teams: Array<MattermostTeamOfProject>;
  defaultTeamId: string | null;
  isBotInDefaultTeam: boolean;
  botUsername: string;
  // The teams the bot was taken out of, by the names they had.
  removedTeams: Array<MattermostConnectionTeam>;
  // Whether the server has listed the bot's teams at all.
  areTeamsListed: boolean;
}

// The teams of an answer: each with an id, its name for no display name.
function readTeams(value: unknown): Array<MattermostConnectionTeam> {
  return (Array.isArray(value) ? (value as Array<JSONObject | null>) : [])
    .map((item: JSONObject | null): MattermostConnectionTeam => {
      const team: JSONObject = item && typeof item === "object" ? item : {};
      const id: string = typeof team["id"] === "string" ? team["id"] : "";
      const name: string = typeof team["name"] === "string" ? team["name"] : "";

      return {
        id: id,
        name: name,
        displayName:
          (typeof team["displayName"] === "string" && team["displayName"]) ||
          name,
      };
    })
    .filter((team: MattermostConnectionTeam): boolean => {
      return Boolean(team.id);
    });
}

export const readMattermostTeamsDescription: (
  data: JSONObject | undefined,
) => MattermostTeamsDescription = (
  data: JSONObject | undefined,
): MattermostTeamsDescription => {
  const defaultTeamId: string | null =
    typeof data?.["defaultTeamId"] === "string"
      ? (data["defaultTeamId"] as string)
      : null;

  const teams: Array<MattermostTeamOfProject> = readTeams(data?.["teams"]).map(
    (team: MattermostConnectionTeam): MattermostTeamOfProject => {
      return {
        ...team,
        isDefault: Boolean(defaultTeamId) && team.id === defaultTeamId,
      };
    },
  );

  return {
    teams: teams,
    defaultTeamId: defaultTeamId,
    isBotInDefaultTeam: data?.["isBotInDefaultTeam"] !== false,
    botUsername:
      typeof data?.["botUsername"] === "string"
        ? (data["botUsername"] as string)
        : "",
    removedTeams: readTeams(data?.["removedTeams"]),
    areTeamsListed: data?.["areTeamsListed"] === true,
  };
};

/*
 * The project's Mattermost connection, for a notification rule or a summary
 * to pick the team of its channels from (GET /mattermost/connected-teams):
 * the teams its bot is a member of, the default first, the teams it was
 * taken out of, by the names they had, and whether the server has listed
 * them at all. Undefined when it cannot be read: no picker, as before.
 */
export const fetchMattermostRuleTeams: () => Promise<
  MattermostRuleTeams | undefined
> = async (): Promise<MattermostRuleTeams | undefined> => {
  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          `/mattermost/connected-teams`,
        ),
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      return undefined;
    }

    const connection: MattermostTeamsDescription =
      readMattermostTeamsDescription(response.data);

    return {
      teams: connection.teams.map(
        (team: MattermostConnectionTeam): MattermostConnectionTeam => {
          return {
            id: team.id,
            name: team.name,
            displayName: team.displayName,
          };
        },
      ),
      removedTeams: connection.removedTeams,
      defaultTeamId: connection.defaultTeamId || "",
      isBotInDefaultTeam: connection.isBotInDefaultTeam,
      areTeamsListed: connection.areTeamsListed,
    };
  } catch {
    return undefined;
  }
};

export interface ComponentProps {
  // Spacing above the card.
  className?: string | undefined;
  /*
   * Told the teams each time they are read or the default changes: the
   * connection's card names the team while there is only one.
   */
  onTeamsChange?:
    | ((description: MattermostTeamsDescription) => void)
    | undefined;
}

const MattermostTeamsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();

  const [connection, setConnection] =
    useState<MattermostTeamsDescription | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  // The team being made the default, while the request is out.
  const [makingDefaultId, setMakingDefaultId] = useState<string>("");

  const show: (description: MattermostTeamsDescription) => void = (
    description: MattermostTeamsDescription,
  ): void => {
    setConnection(description);
    props.onTeamsChange?.(description);
  };

  type LoadFunction = (refresh: boolean) => Promise<void>;

  const load: LoadFunction = async (refresh: boolean): Promise<void> => {
    try {
      setError("");

      if (refresh) {
        setIsRefreshing(true);
      }

      const url: URL = URL.fromURL(APP_API_URL).addRoute(
        "/mattermost/connected-teams",
      );

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

      show(readMattermostTeamsDescription(response.data));
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

  type MakeDefaultFunction = (teamId: string) => Promise<void>;

  const makeDefault: MakeDefaultFunction = async (
    teamId: string,
  ): Promise<void> => {
    try {
      setError("");
      setMakingDefaultId(teamId);

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.put<JSONObject>({
          url: URL.fromURL(APP_API_URL).addRoute("/mattermost/default-team"),
          data: { teamId: teamId },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      show(readMattermostTeamsDescription(response.data));
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setMakingDefaultId("");
    }
  };

  // Nothing until the teams are known: no loader that then goes.
  if (isLoading) {
    return null;
  }

  const bot: string = connection?.botUsername || "oneuptime";
  const teams: Array<MattermostTeamOfProject> = connection?.teams || [];

  const defaultTeam: MattermostTeamOfProject | undefined = teams.find(
    (team: MattermostTeamOfProject): boolean => {
      return team.isDefault;
    },
  );

  return (
    <div data-testid="mattermost-teams" className={props.className}>
      <Card
        title={MATTERMOST_TEAMS_TITLE}
        description={translator.translateTemplate(
          MATTERMOST_TEAMS_DESCRIPTION,
          { bot: bot },
        )}
        buttons={[
          {
            title: MATTERMOST_TEAMS_REFRESH,
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

          {connection && !connection.isBotInDefaultTeam && defaultTeam && (
            <Alert
              type={AlertType.WARNING}
              dataTestId="mattermost-bot-left-default-team"
              title={translator.translateTemplate(
                MATTERMOST_BOT_LEFT_DEFAULT_TEAM,
                { team: defaultTeam.displayName || defaultTeam.name },
              )}
            />
          )}

          {teams.length > 0 && (
            <ul
              className="divide-y divide-gray-200 overflow-hidden rounded-md border border-gray-200 bg-white"
              data-testid="mattermost-teams-list"
            >
              {teams.map((team: MattermostTeamOfProject) => {
                const name: string = team.displayName || team.name || team.id;
                // Its name in URLs, under a display name that differs from it.
                const handle: string =
                  team.name && team.name.toLowerCase() !== name.toLowerCase()
                    ? team.name
                    : "";

                return (
                  <li
                    key={team.id}
                    className="flex flex-wrap items-center gap-3 px-4 py-3"
                    data-testid={`mattermost-team-${team.id}`}
                  >
                    <div
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-indigo-50 text-sm font-semibold uppercase text-indigo-700"
                      aria-hidden="true"
                    >
                      {name.trim().charAt(0) || "#"}
                    </div>
                    {/*
                     * A floor rather than min-w-0, as on the Slack
                     * workspaces card: on a phone the button wraps onto its
                     * own line instead of squeezing the name to nothing.
                     */}
                    <div className="min-w-[8rem] flex-1">
                      <div className="truncate font-medium text-gray-900">
                        {name}
                      </div>
                      {handle && (
                        <div className="truncate text-xs text-gray-500">
                          {handle}
                        </div>
                      )}
                    </div>
                    {team.isDefault ? (
                      <span
                        className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-600/20"
                        data-testid="mattermost-team-default"
                      >
                        {translator.translateText(
                          MATTERMOST_TEAM_DEFAULT_BADGE,
                        ) || MATTERMOST_TEAM_DEFAULT_BADGE}
                      </span>
                    ) : (
                      <Button
                        title={MATTERMOST_TEAM_MAKE_DEFAULT}
                        ariaLabel={translator.translateTemplate(
                          MATTERMOST_TEAM_MAKE_DEFAULT_LABEL,
                          { team: name },
                        )}
                        isAriaLabelTranslated={true}
                        buttonStyle={ButtonStyleType.OUTLINE}
                        buttonSize={ButtonSize.Small}
                        isLoading={makingDefaultId === team.id}
                        disabled={Boolean(makingDefaultId) || isRefreshing}
                        dataTestId={`mattermost-team-make-default-${team.id}`}
                        onClick={() => {
                          makeDefault(team.id).catch((err: Exception) => {
                            setError(API.getFriendlyErrorMessage(err));
                          });
                        }}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <p
            className="text-xs text-gray-500"
            data-testid="mattermost-teams-hint"
          >
            {translator.translateTemplate(MATTERMOST_ADD_BOT_TO_TEAM_HINT, {
              bot: bot,
            })}
          </p>
        </div>
      </Card>
    </div>
  );
};

export default MattermostTeamsCard;
