import { MicrosoftTeamsTeam } from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE MICROSOFT TEAMS TEAM A SUMMARY POSTS IN, PICKED FROM A LIST (#7118).
 *
 * A Microsoft Teams summary asked for its Team Name as text (placeholder
 * "Engineering Team"), and a name typed wrong was only found out from Send
 * Test Now or the Notification Logs. It is picked from the teams of the
 * project's connection now, as a notification rule's team is, and the
 * team's id is kept in teamName - which the server matches by id as it
 * matches a typed name (WorkspaceNotificationSummaryService
 * .getMicrosoftTeamsTeamOfSummary), so nothing stored has to change:
 *
 *   - a connection with one team needs no pick: the summary posts in that
 *     team, as before, and the field is not shown;
 *   - a summary saved with a typed name keeps it, offered as it was typed
 *     ("Engineering (typed name)") until somebody picks a team - and the
 *     field shows for it whatever the number of teams;
 *   - when the teams cannot be listed (Microsoft Graph refused, the
 *     connection is broken), the form asks for the name as text, as it
 *     always did.
 */

// A team kept as it was typed before the team was picked from a list.
export const MICROSOFT_TEAMS_TYPED_TEAM_OPTION: string = translationKey(
  "{{team}} (typed name)",
);

// The teams of the project's Microsoft Teams connection, or undefined when they cannot be listed.
export type MicrosoftTeamsSummaryTeams = Array<MicrosoftTeamsTeam> | undefined;

/*
 * The connection's teams, as a notification rule lists them (GET
 * /microsoft-teams/teams, which reads them from Graph again). Undefined
 * when they cannot be read - the form then asks for the name as text.
 */
export async function fetchMicrosoftTeamsSummaryTeams(): Promise<MicrosoftTeamsSummaryTeams> {
  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          `/microsoft-teams/teams`,
        ),
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      return undefined;
    }

    return readMicrosoftTeamsTeams(response.data);
  } catch {
    return undefined;
  }
}

// The teams an answer lists, each with an id; undefined for an answer that lists none.
export function readMicrosoftTeamsTeams(
  data: unknown,
): MicrosoftTeamsSummaryTeams {
  const teams: unknown =
    data && typeof data === "object" ? (data as JSONObject)["teams"] : null;

  if (!Array.isArray(teams)) {
    return undefined;
  }

  const read: Array<MicrosoftTeamsTeam> = [];

  for (const team of teams) {
    const id: unknown = (team as JSONObject | null)?.["id"];
    const name: unknown = (team as JSONObject | null)?.["name"];

    if (typeof id !== "string" || !id.trim()) {
      continue;
    }

    if (
      read.some((listed: MicrosoftTeamsTeam): boolean => {
        return listed.id === id;
      })
    ) {
      continue;
    }

    read.push({
      id: id,
      name: typeof name === "string" && name.trim() ? name : id,
    });
  }

  return read;
}

// What a summary holds in teamName, trimmed: a team's id, a typed name, or nothing.
function getHeldTeam(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * Whether a summary holds a team the list has no id for: a name typed
 * before the team was picked from a list, or a team since removed.
 */
export function isMicrosoftTeamsTeamKeptAsTyped(data: {
  teams: Array<MicrosoftTeamsTeam>;
  value: unknown;
}): boolean {
  const held: string = getHeldTeam(data.value);

  return (
    Boolean(held) &&
    !data.teams.some((team: MicrosoftTeamsTeam): boolean => {
      return team.id === held;
    })
  );
}

/*
 * The team a summary held as typed, kept while its form is open: the one
 * seen before (`kept`), else the one it holds now. Kept once seen, so the
 * picker still offers it - and still shows - after another team is picked,
 * until the form closes, as a Mattermost summary keeps a team the bot left.
 */
export function getKeptMicrosoftTeamsTeam(data: {
  teams: Array<MicrosoftTeamsTeam>;
  value: unknown;
  kept: string | undefined;
}): string | undefined {
  if (data.kept) {
    return data.kept;
  }

  return isMicrosoftTeamsTeamKeptAsTyped(data)
    ? (data.value as string)
    : undefined;
}

/*
 * Whether the summary form shows the team picker: for a connection with
 * two or more teams to pick from, or a summary that holds - or held, while
 * the form is open - a team kept as typed, so it can be seen and changed.
 * One team: the summary posts in it, nothing to pick.
 */
export function isMicrosoftTeamsTeamPickerShown(data: {
  teams: Array<MicrosoftTeamsTeam>;
  value: unknown;
  kept: string | undefined;
}): boolean {
  return (
    data.teams.length > 1 ||
    Boolean(data.kept) ||
    isMicrosoftTeamsTeamKeptAsTyped(data)
  );
}

/*
 * The picker's teams, by name, each kept as its id - and a team kept as it
 * was typed, offered as it was typed, so the summary still shows its team
 * until somebody picks one. Names are the teams' own, read as written.
 */
export function getMicrosoftTeamsTeamOptions(data: {
  teams: Array<MicrosoftTeamsTeam>;
  keptTeam: string | undefined;
  translator: Translator;
}): Array<DropdownOption> {
  const options: Array<DropdownOption> = data.teams.map(
    (team: MicrosoftTeamsTeam): DropdownOption => {
      return {
        label: team.name || team.id,
        value: team.id,
        isUserContent: true,
      };
    },
  );

  const kept: string = getHeldTeam(data.keptTeam);

  if (
    kept &&
    !data.teams.some((team: MicrosoftTeamsTeam): boolean => {
      return team.id === kept;
    })
  ) {
    options.push({
      label: data.translator.translateTemplate(
        MICROSOFT_TEAMS_TYPED_TEAM_OPTION,
        { team: kept },
      ),
      // As it is held, so the form keeps it until another team is picked.
      value: data.keptTeam as string,
      isUserContent: true,
    });
  }

  return options;
}
