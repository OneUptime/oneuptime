import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";
import WorkspaceChannelLinkUtil, {
  WorkspaceChannelRecordType,
} from "./WorkspaceChannelLink";
import WorkspaceType from "./WorkspaceType";

/*
 * WHO IS IN A RECORD'S OWN CHAT CHANNEL, AND ADDING PEOPLE TO IT.
 *
 * A workspace notification rule can create a Slack or Microsoft Teams
 * channel for an incident, an alert, an episode or a scheduled maintenance
 * event, and it invites the record's people as they join the record. People
 * still leave channels, a rule can leave somebody out, and a private Slack
 * channel that everybody has left can only be entered again through an
 * invitation from someone still in it: the OneUptime app, which created it
 * and stays in it. So the record's page shows its channels and who is in
 * them, and lets a member who may edit the record add people through the
 * app - themselves (Join channel) or anybody in the project.
 *
 * What the page and the server say to each other, in one place: the route,
 * the answers' shapes, and how they are read back - only well-formed values,
 * so nothing an answer holds can draw a link to somewhere else.
 *
 * React-free and server-free, so both sides and plain tests can import it.
 */

/*
 * GET <api>/workspace-channel-members/<record type>/<record id>
 * POST <api>/workspace-channel-members/<record type>/<record id>/add
 */
export const WORKSPACE_CHANNEL_MEMBERS_ROUTE: string =
  "/workspace-channel-members";

export const WORKSPACE_CHANNEL_MEMBERS_ADD_PATH: string = "add";

// What OneUptime could tell about a channel.
export enum WorkspaceChannelState {
  // Slack answered: the people in it are listed.
  Members = "members",
  // Slack: archived. Its people are still listed; nobody can join it.
  Archived = "archived",
  /*
   * Slack: OneUptime cannot see the channel any more. It was deleted, or it
   * is private and the OneUptime app was removed from it - Slack answers the
   * two alike.
   */
  Unreachable = "unreachable",
  // The project's Slack connection is gone.
  NotConnected = "not-connected",
  // Slack did not answer (an outage, its rate limit): ask again later.
  Unavailable = "unavailable",
  /*
   * Microsoft Teams: who can open the channel is the team's (a standard
   * channel) or the channel's own members (a private one), managed in
   * Microsoft Teams. OneUptime neither reads nor changes them.
   */
  ManagedInTeams = "managed-in-teams",
}

// Whether the person looking at the page is in the channel.
export enum WorkspaceChannelViewerStatus {
  In = "in",
  NotIn = "not-in",
  /*
   * OneUptime cannot tell who they are in the workspace: their account is
   * not connected, and no account there has their email address.
   */
  NotFound = "not-found",
}

// Somebody in the channel.
export interface WorkspaceChannelPerson {
  // Their account in the workspace: what the page keys the list by.
  key: string;
  name: string;
  // Their OneUptime account, when OneUptime can tell it.
  userId?: string | undefined;
  hasProfilePicture?: boolean | undefined;
  // The person looking at the page.
  isViewer?: boolean | undefined;
}

export interface WorkspaceRecordChannel {
  channelId: string;
  workspaceType: WorkspaceType;
  // As the record stored it: "inc-42".
  name: string;
  // Opens it in the Slack or Teams app, or in the browser (WorkspaceChannelLink).
  url?: string | undefined;
  // Null when OneUptime cannot tell.
  isPrivate: boolean | null;
  state: WorkspaceChannelState;
  // The people in it, the viewer first, then by name; at most a hundred.
  people: Array<WorkspaceChannelPerson>;
  // Everybody in it, apps and bots aside - more than `people` in a big channel.
  peopleCount: number;
  viewer: WorkspaceChannelViewerStatus;
  // Microsoft Teams: the team the channel is in, by its name.
  teamName?: string | undefined;
}

export interface WorkspaceRecordChannels {
  channels: Array<WorkspaceRecordChannel>;
  /*
   * Whether the viewer may add people to the record's channels: they may
   * edit the record.
   */
  canAddPeople: boolean;
}

// What adding one person came to.
export enum WorkspaceChannelAddOutcome {
  Added = "added",
  AlreadyIn = "already-in",
  // No account in the workspace: not connected, and no account has their email.
  NotFound = "not-found",
  // Not a member of the project: OneUptime adds only its members.
  NotProjectMember = "not-project-member",
  // A guest of the workspace, whom Slack does not let the app add here.
  Guest = "guest",
  // Slack was busy or down: try again.
  TryAgain = "try-again",
  // Slack refused, for a reason of its own.
  Refused = "refused",
}

export interface WorkspaceChannelAddResult {
  userId: string;
  name: string;
  outcome: WorkspaceChannelAddOutcome;
}

export interface WorkspaceChannelAddAnswer {
  /*
   * Set when the channel itself could take nobody (archived, out of
   * OneUptime's sight, the connection gone, Slack down): then nobody was
   * tried, and `results` is empty.
   */
  channelState?: WorkspaceChannelState | undefined;
  results: Array<WorkspaceChannelAddResult>;
}

/*
 * How many people one request may name, before teams are expanded, and how
 * many it may add once they are: a click on a person or on a team, never a
 * whole directory.
 */
export const WORKSPACE_CHANNEL_ADD_MAX_USERS: number = 50;
export const WORKSPACE_CHANNEL_ADD_MAX_TEAMS: number = 10;
export const WORKSPACE_CHANNEL_ADD_MAX_PEOPLE: number = 100;

const isOneOf: <T extends string>(
  values: Record<string, T>,
  value: unknown,
) => value is T = <T extends string>(
  values: Record<string, T>,
  value: unknown,
): value is T => {
  return (
    typeof value === "string" &&
    (Object.values(values) as Array<string>).includes(value)
  );
};

const readString: (value: unknown) => string = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

export default class WorkspaceChannelMembersUtil {
  public static getRoute(data: {
    recordType: WorkspaceChannelRecordType;
    recordId: ObjectID;
  }): string {
    return `${WORKSPACE_CHANNEL_MEMBERS_ROUTE}/${data.recordType}/${data.recordId.toString()}`;
  }

  public static getAddRoute(data: {
    recordType: WorkspaceChannelRecordType;
    recordId: ObjectID;
  }): string {
    return `${WorkspaceChannelMembersUtil.getRoute(data)}/${WORKSPACE_CHANNEL_MEMBERS_ADD_PATH}`;
  }

  public static channelsToJSON(answer: WorkspaceRecordChannels): JSONObject {
    return {
      canAddPeople: answer.canAddPeople,
      channels: answer.channels.map(
        (channel: WorkspaceRecordChannel): JSONObject => {
          const json: JSONObject = {
            channelId: channel.channelId,
            workspaceType: channel.workspaceType,
            name: channel.name,
            isPrivate: channel.isPrivate,
            state: channel.state,
            people: channel.people.map(
              (person: WorkspaceChannelPerson): JSONObject => {
                const personJson: JSONObject = {
                  key: person.key,
                  name: person.name,
                };

                if (person.userId) {
                  personJson["userId"] = person.userId;
                }

                if (person.hasProfilePicture) {
                  personJson["hasProfilePicture"] = true;
                }

                if (person.isViewer) {
                  personJson["isViewer"] = true;
                }

                return personJson;
              },
            ),
            peopleCount: channel.peopleCount,
            viewer: channel.viewer,
          };

          if (channel.url) {
            json["url"] = channel.url;
          }

          if (channel.teamName) {
            json["teamName"] = channel.teamName;
          }

          return json;
        },
      ),
    };
  }

  /*
   * An answer as the page reads it: a channel whose workspace, state or id
   * is not one OneUptime gives is left out, and a link is kept only when it
   * goes where a link to that product's channel goes.
   */
  public static channelsFromJSON(value: unknown): WorkspaceRecordChannels {
    const json: JSONObject =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as JSONObject)
        : {};
    const items: Array<unknown> = Array.isArray(json["channels"])
      ? (json["channels"] as Array<unknown>)
      : [];

    const channels: Array<WorkspaceRecordChannel> = [];

    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }

      const channel: JSONObject = item as JSONObject;
      const workspaceType: unknown = channel["workspaceType"];
      const state: unknown = channel["state"];
      const viewer: unknown = channel["viewer"];
      const channelId: string = readString(channel["channelId"]);

      if (
        !isOneOf(WorkspaceType, workspaceType) ||
        !isOneOf(WorkspaceChannelState, state) ||
        !channelId
      ) {
        continue;
      }

      const url: string = readString(channel["url"]);
      const isPrivate: unknown = channel["isPrivate"];
      const peopleCount: unknown = channel["peopleCount"];
      const people: Array<WorkspaceChannelPerson> = Array.isArray(
        channel["people"],
      )
        ? WorkspaceChannelMembersUtil.peopleFromJSON(
            channel["people"] as Array<unknown>,
          )
        : [];

      const parsed: WorkspaceRecordChannel = {
        channelId: channelId,
        workspaceType: workspaceType,
        name: readString(channel["name"]),
        isPrivate: typeof isPrivate === "boolean" ? isPrivate : null,
        state: state,
        people: people,
        peopleCount:
          typeof peopleCount === "number" &&
          Number.isFinite(peopleCount) &&
          peopleCount >= people.length
            ? Math.floor(peopleCount)
            : people.length,
        viewer: isOneOf(WorkspaceChannelViewerStatus, viewer)
          ? viewer
          : WorkspaceChannelViewerStatus.NotFound,
      };

      if (
        url &&
        WorkspaceChannelLinkUtil.isOnWorkspaceHost({
          workspaceType: workspaceType,
          url: url,
        })
      ) {
        parsed.url = url;
      }

      const teamName: string = readString(channel["teamName"]).trim();

      if (teamName) {
        parsed.teamName = teamName;
      }

      channels.push(parsed);
    }

    return {
      channels: channels,
      canAddPeople: json["canAddPeople"] === true,
    };
  }

  public static addAnswerToJSON(answer: WorkspaceChannelAddAnswer): JSONObject {
    const json: JSONObject = {
      results: answer.results.map(
        (result: WorkspaceChannelAddResult): JSONObject => {
          return {
            userId: result.userId,
            name: result.name,
            outcome: result.outcome,
          };
        },
      ),
    };

    if (answer.channelState) {
      json["channelState"] = answer.channelState;
    }

    return json;
  }

  public static addAnswerFromJSON(value: unknown): WorkspaceChannelAddAnswer {
    const json: JSONObject =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as JSONObject)
        : {};
    const items: Array<unknown> = Array.isArray(json["results"])
      ? (json["results"] as Array<unknown>)
      : [];

    const results: Array<WorkspaceChannelAddResult> = [];

    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }

      const result: JSONObject = item as JSONObject;
      const outcome: unknown = result["outcome"];
      const userId: string = readString(result["userId"]);

      if (!isOneOf(WorkspaceChannelAddOutcome, outcome) || !userId) {
        continue;
      }

      results.push({
        userId: userId,
        name: readString(result["name"]),
        outcome: outcome,
      });
    }

    const answer: WorkspaceChannelAddAnswer = { results: results };

    if (isOneOf(WorkspaceChannelState, json["channelState"])) {
      answer.channelState = json["channelState"] as WorkspaceChannelState;
    }

    return answer;
  }

  private static peopleFromJSON(
    items: Array<unknown>,
  ): Array<WorkspaceChannelPerson> {
    const people: Array<WorkspaceChannelPerson> = [];

    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }

      const person: JSONObject = item as JSONObject;
      const key: string = readString(person["key"]);
      const name: string = readString(person["name"]).trim();

      if (!key || !name) {
        continue;
      }

      const parsed: WorkspaceChannelPerson = { key: key, name: name };
      const userId: string = readString(person["userId"]);

      if (userId && ObjectID.isValidUUID(userId)) {
        parsed.userId = userId;
      }

      if (person["hasProfilePicture"] === true && parsed.userId) {
        parsed.hasProfilePicture = true;
      }

      if (person["isViewer"] === true) {
        parsed.isViewer = true;
      }

      people.push(parsed);
    }

    return people;
  }
}
