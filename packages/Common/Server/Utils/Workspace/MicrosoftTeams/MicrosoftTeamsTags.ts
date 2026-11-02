import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import {
  MICROSOFT_TEAMS_TAG_MAX_MEMBERS,
  MICROSOFT_TEAMS_TAG_MAX_MEMBERS_ON_CREATE,
  MICROSOFT_TEAMS_TAG_NAME_MAX_LENGTH,
  WorkspaceUserGroupLeftOut,
  WorkspaceUserGroupLeftOutReason,
  WorkspaceUserGroupMember,
  WorkspaceUserGroupProblem,
} from "../../../../Types/Workspace/WorkspaceUserGroup";
import API from "../../../../Utils/API";
import logger from "../../Logger";
import ProductBrandingText from "../../ProductBrandingText";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import MicrosoftTeamsHosts from "./MicrosoftTeamsHosts";
import {
  WorkspaceUserGroupError,
  WorkspaceUserGroupPerson,
  WorkspaceUserGroupProvider,
  WorkspaceUserGroupProviderResult,
  WorkspaceUserGroupSyncRequest,
} from "../UserGroups/WorkspaceUserGroupProvider";
import MicrosoftTeamsUtil, {
  MicrosoftTeamsRosterMember,
} from "./MicrosoftTeams";

/*
 * MICROSOFT TEAMS TAGS, KEPT IN STEP WITH WHO IS ON CALL.
 *
 * Teams' answer to a Slack user group is a tag: a name in a team (@Payments
 * on-call) that notifies everybody it holds. What OneUptime asks:
 *
 * - the team's roster, from its bot (MicrosoftTeamsUtil.getTeamRoster): a
 *   tag holds only the team's members, and the roster says who they are and
 *   their email addresses, so the people on call are found without a Graph
 *   permission to read people
 * - Microsoft Graph's teamwork tags: GET/POST /teams/{team}/tags,
 *   GET/POST /teams/{team}/tags/{tag}/members and DELETE
 *   /teams/{team}/tags/{tag}/members/{member}
 *
 * The tags need the TeamworkTag.ReadWrite.All application permission, which
 * a Microsoft 365 admin grants with admin consent; until then Graph answers
 * 403, and the card says what to do.
 *
 * A tag has no "turned off": with nobody on call, OneUptime takes everybody
 * out of it. Should Teams delete a tag left empty, OneUptime makes it again,
 * under the same name, when somebody is on call again.
 */

/*
 * A team's address on Microsoft Graph, on the Graph of this server's
 * Microsoft cloud (MicrosoftTeamsHosts).
 */
const getTeamUrl: (teamId: string) => string = (teamId: string): string => {
  return MicrosoftTeamsHosts.getGraphUrl(
    `/teams/${encodeURIComponent(teamId)}`,
  );
};

// The most pages of tags or members read for one answer.
const MAX_PAGES: number = 20;

// What a new tag says about itself in Microsoft Teams.
export const MICROSOFT_TEAMS_TAG_DESCRIPTION: (
  productName: string,
) => string = (productName: string): string => {
  return `Whoever is on call right now. ${productName} keeps this tag up to date.`;
};

// A tag, as Graph tells it.
export interface MicrosoftTeamsTagInfo {
  id: string;
  name: string;
  memberCount: number | null;
}

// Somebody in a tag: the tag member's own id, and who they are.
interface MicrosoftTeamsTagMember {
  memberId: string;
  aadObjectId: string;
}

enum GraphMethod {
  Get = "GET",
  Post = "POST",
  Delete = "DELETE",
}

export default class MicrosoftTeamsTags {
  /*
   * One Graph request: its answer, or a WorkspaceUserGroupError saying what
   * the refusal means for the card. `notFound` is the problem a 404 is.
   */
  private static async request(data: {
    method: GraphMethod;
    url: string;
    accessToken: string;
    body?: JSONObject | undefined;
    notFound: WorkspaceUserGroupProblem;
  }): Promise<JSONObject> {
    let response: HTTPErrorResponse | HTTPResponse<JSONObject>;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${data.accessToken}`,
      "Content-Type": "application/json",
    };

    try {
      if (data.method === GraphMethod.Get) {
        response = await API.get<JSONObject>({
          url: URL.fromString(data.url),
          headers: headers,
        });
      } else if (data.method === GraphMethod.Delete) {
        response = await API.delete<JSONObject>({
          url: URL.fromString(data.url),
          headers: headers,
        });
      } else {
        response = await API.post<JSONObject>({
          url: URL.fromString(data.url),
          headers: headers,
          data: data.body || {},
        });
      }
    } catch (err) {
      logger.debug("Microsoft Graph did not answer a tag request.");
      logger.debug(err);

      throw new WorkspaceUserGroupError({
        problem: WorkspaceUserGroupProblem.Unavailable,
        detail: "graph",
      });
    }

    if (response instanceof HTTPErrorResponse) {
      throw MicrosoftTeamsTags.readError(response, data.notFound);
    }

    return (response.jsonData || {}) as JSONObject;
  }

  // What a refusal from Graph means for the card.
  public static readError(
    response: HTTPErrorResponse,
    notFound: WorkspaceUserGroupProblem,
  ): WorkspaceUserGroupError {
    const status: number = response.statusCode;
    const error: JSONObject =
      ((response.jsonData as JSONObject | undefined)?.["error"] as
        | JSONObject
        | undefined) || {};
    const code: string =
      typeof error["code"] === "string" ? (error["code"] as string) : "";

    const headers: Record<string, unknown> = (response.headers || {}) as Record<
      string,
      unknown
    >;
    const retryAfter: number = Number(
      headers["retry-after"] ?? headers["Retry-After"],
    );

    if (status === 429 || status >= 500) {
      return new WorkspaceUserGroupError({
        problem: WorkspaceUserGroupProblem.Unavailable,
        detail: code || `HTTP ${status}`,
        retryAfterSeconds:
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter
            : undefined,
      });
    }

    if (status === 401) {
      return new WorkspaceUserGroupError({
        problem: WorkspaceUserGroupProblem.NotConnected,
        detail: code || "HTTP 401",
      });
    }

    if (status === 403) {
      return new WorkspaceUserGroupError({
        problem: WorkspaceUserGroupProblem.MissingPermission,
        detail: code || "HTTP 403",
      });
    }

    if (status === 404) {
      return new WorkspaceUserGroupError({
        problem: notFound,
        detail: code || "HTTP 404",
      });
    }

    return new WorkspaceUserGroupError({
      problem: WorkspaceUserGroupProblem.Refused,
      detail: code ? `${code} (HTTP ${status})` : `HTTP ${status}`,
    });
  }

  // Every tag of a team.
  @CaptureSpan()
  public static async list(data: {
    accessToken: string;
    teamId: string;
  }): Promise<Array<MicrosoftTeamsTagInfo>> {
    const tags: Array<MicrosoftTeamsTagInfo> = [];
    let url: string | null = `${getTeamUrl(data.teamId)}/tags`;
    let pages: number = 0;

    while (url && pages < MAX_PAGES) {
      pages++;

      const body: JSONObject = await MicrosoftTeamsTags.request({
        method: GraphMethod.Get,
        url: url,
        accessToken: data.accessToken,
        notFound: WorkspaceUserGroupProblem.TeamGone,
      });

      for (const value of MicrosoftTeamsTags.readValues(body)) {
        const tag: MicrosoftTeamsTagInfo | null =
          MicrosoftTeamsTags.readTag(value);

        if (tag) {
          tags.push(tag);
        }
      }

      url = MicrosoftTeamsTags.readNextLink(body);
    }

    return tags;
  }

  // The people a tag holds.
  @CaptureSpan()
  public static async getMembers(data: {
    accessToken: string;
    teamId: string;
    tagId: string;
  }): Promise<Array<MicrosoftTeamsTagMember>> {
    const members: Array<MicrosoftTeamsTagMember> = [];
    let url: string | null = `${MicrosoftTeamsTags.getTagUrl(data)}/members`;
    let pages: number = 0;

    while (url && pages < MAX_PAGES) {
      pages++;

      const body: JSONObject = await MicrosoftTeamsTags.request({
        method: GraphMethod.Get,
        url: url,
        accessToken: data.accessToken,
        notFound: WorkspaceUserGroupProblem.Gone,
      });

      for (const value of MicrosoftTeamsTags.readValues(body)) {
        const member: JSONObject = value as JSONObject;

        if (
          typeof member["id"] === "string" &&
          typeof member["userId"] === "string"
        ) {
          members.push({
            memberId: member["id"] as string,
            aadObjectId: member["userId"] as string,
          });
        }
      }

      url = MicrosoftTeamsTags.readNextLink(body);
    }

    return members;
  }

  /*
   * A new tag with its first people - Teams makes no empty tag, and takes
   * at most 25 people with a new one; the rest are added after.
   */
  @CaptureSpan()
  public static async create(data: {
    accessToken: string;
    teamId: string;
    name: string;
    aadObjectIds: Array<string>;
  }): Promise<MicrosoftTeamsTagInfo> {
    const first: Array<string> = data.aadObjectIds.slice(
      0,
      MICROSOFT_TEAMS_TAG_MAX_MEMBERS_ON_CREATE,
    );

    const body: JSONObject = await MicrosoftTeamsTags.request({
      method: GraphMethod.Post,
      url: `${getTeamUrl(data.teamId)}/tags`,
      accessToken: data.accessToken,
      body: {
        displayName: data.name.substring(
          0,
          MICROSOFT_TEAMS_TAG_NAME_MAX_LENGTH,
        ),
        /*
         * What the tag says about itself in Teams' tag list, as a Slack user
         * group OneUptime makes does (SLACK_USER_GROUP_DESCRIPTION): who it
         * holds, and that it is kept for them - so nobody edits it by hand.
         */
        description: MICROSOFT_TEAMS_TAG_DESCRIPTION(
          ProductBrandingText.getProductName(),
        ),
        members: first.map((aadObjectId: string): JSONObject => {
          return { userId: aadObjectId };
        }),
      },
      notFound: WorkspaceUserGroupProblem.TeamGone,
    });

    const tag: MicrosoftTeamsTagInfo | null = MicrosoftTeamsTags.readTag(body);

    if (!tag) {
      throw new WorkspaceUserGroupError({
        problem: WorkspaceUserGroupProblem.Refused,
        detail: "no_tag_returned",
      });
    }

    for (const aadObjectId of data.aadObjectIds.slice(first.length)) {
      await MicrosoftTeamsTags.addMember({
        accessToken: data.accessToken,
        teamId: data.teamId,
        tagId: tag.id,
        aadObjectId: aadObjectId,
      });
    }

    return tag;
  }

  @CaptureSpan()
  public static async addMember(data: {
    accessToken: string;
    teamId: string;
    tagId: string;
    aadObjectId: string;
  }): Promise<void> {
    await MicrosoftTeamsTags.request({
      method: GraphMethod.Post,
      url: `${MicrosoftTeamsTags.getTagUrl(data)}/members`,
      accessToken: data.accessToken,
      body: {
        userId: data.aadObjectId,
      },
      notFound: WorkspaceUserGroupProblem.Gone,
    });
  }

  @CaptureSpan()
  public static async removeMember(data: {
    accessToken: string;
    teamId: string;
    tagId: string;
    memberId: string;
  }): Promise<void> {
    try {
      await MicrosoftTeamsTags.request({
        method: GraphMethod.Delete,
        url: `${MicrosoftTeamsTags.getTagUrl(data)}/members/${encodeURIComponent(
          data.memberId,
        )}`,
        accessToken: data.accessToken,
        notFound: WorkspaceUserGroupProblem.Gone,
      });
    } catch (err) {
      // Somebody took them out already.
      if (
        WorkspaceUserGroupError.read(err)?.problem ===
        WorkspaceUserGroupProblem.Gone
      ) {
        return;
      }

      throw err;
    }
  }

  /*
   * Who somebody on call is in a team: the account they connected to
   * OneUptime, or else the member with their OneUptime email address (or
   * sign-in name). Nobody else can be in the team's tag.
   */
  public static findPerson(data: {
    roster: Array<MicrosoftTeamsRosterMember>;
    person: WorkspaceUserGroupPerson;
  }): MicrosoftTeamsRosterMember | null {
    const connected: string = (
      data.person.connectedWorkspaceUserId || ""
    ).toLowerCase();

    if (connected) {
      const byAccount: MicrosoftTeamsRosterMember | undefined =
        data.roster.find((member: MicrosoftTeamsRosterMember): boolean => {
          return member.aadObjectId.toLowerCase() === connected;
        });

      if (byAccount) {
        return byAccount;
      }
    }

    const email: string = (data.person.email || "").trim().toLowerCase();

    if (!email) {
      return null;
    }

    return (
      data.roster.find((member: MicrosoftTeamsRosterMember): boolean => {
        return (
          member.email.toLowerCase() === email ||
          member.userPrincipalName.toLowerCase() === email
        );
      }) || null
    );
  }

  /*
   * KEEPING ONE TAG IN STEP.
   *
   * The team's roster says who of the people on call can be in the tag.
   * The tag then gets whoever it lacks and loses whoever it should not
   * hold - everybody, while nobody is on call. A tag that is gone is made
   * again under its name only when OneUptime emptied it; one somebody
   * deleted stays gone, and the card says so.
   */
  @CaptureSpan()
  public static async sync(
    request: WorkspaceUserGroupSyncRequest,
  ): Promise<WorkspaceUserGroupProviderResult> {
    const { target, previous, cache } = request;
    const teamId: string = target.workspaceTeamId || "";

    if (!teamId) {
      throw new WorkspaceUserGroupError({
        problem: WorkspaceUserGroupProblem.TeamGone,
      });
    }

    let accessToken: string;

    try {
      accessToken = await MicrosoftTeamsUtil.getValidAccessToken({
        authToken: target.authToken,
        projectId: target.projectId,
      });
    } catch (err) {
      logger.debug("No Microsoft Graph token for a tag sync.");
      logger.debug(err);

      throw new WorkspaceUserGroupError({
        problem: WorkspaceUserGroupProblem.NotConnected,
      });
    }

    const rosterKey: string = `teams-roster:${teamId}`;
    let roster: Array<MicrosoftTeamsRosterMember> | null | undefined =
      cache.get(rosterKey) as Array<MicrosoftTeamsRosterMember> | undefined;

    if (!roster) {
      try {
        roster = await MicrosoftTeamsUtil.getTeamRoster({
          projectId: target.projectId,
          teamId: teamId,
        });
      } catch (err) {
        logger.debug("The Bot Connector did not give a team's roster.");
        logger.debug(err);

        const status: number = Number(
          (err as { statusCode?: unknown } | null)?.statusCode,
        );

        throw new WorkspaceUserGroupError({
          problem:
            status === 403 || status === 404
              ? WorkspaceUserGroupProblem.TeamGone
              : WorkspaceUserGroupProblem.Unavailable,
          detail: Number.isFinite(status) ? `roster HTTP ${status}` : "roster",
        });
      }

      if (!roster) {
        throw new WorkspaceUserGroupError({
          problem: WorkspaceUserGroupProblem.TeamGone,
        });
      }

      cache.set(rosterKey, roster);
    }

    const tagsKey: string = `teams-tags:${teamId}`;
    let tags: Array<MicrosoftTeamsTagInfo> | undefined = cache.get(tagsKey) as
      | Array<MicrosoftTeamsTagInfo>
      | undefined;

    if (!tags) {
      tags = await MicrosoftTeamsTags.list({
        accessToken: accessToken,
        teamId: teamId,
      });
      cache.set(tagsKey, tags);
    }

    const members: Array<WorkspaceUserGroupMember> = [];
    const leftOut: Array<WorkspaceUserGroupLeftOut> = [];

    for (const person of request.people) {
      const found: MicrosoftTeamsRosterMember | null =
        MicrosoftTeamsTags.findPerson({
          roster: roster,
          person: person,
        });

      if (!found) {
        leftOut.push({
          userId: person.userId.toString(),
          reason: WorkspaceUserGroupLeftOutReason.NotInTeam,
        });
        continue;
      }

      const isThereAlready: boolean = members.some(
        (member: WorkspaceUserGroupMember): boolean => {
          return (
            member.workspaceUserId.toLowerCase() ===
            found.aadObjectId.toLowerCase()
          );
        },
      );

      if (!isThereAlready && members.length < MICROSOFT_TEAMS_TAG_MAX_MEMBERS) {
        members.push({
          userId: person.userId.toString(),
          workspaceUserId: found.aadObjectId,
        });
      }
    }

    const tag: MicrosoftTeamsTagInfo | undefined = tags.find(
      (candidate: MicrosoftTeamsTagInfo): boolean => {
        return candidate.id === target.workspaceGroupId;
      },
    );

    const wanted: Array<string> = members.map(
      (member: WorkspaceUserGroupMember): string => {
        return member.workspaceUserId;
      },
    );

    if (!tag) {
      if (!previous?.isTurnedOff) {
        throw new WorkspaceUserGroupError({
          problem: WorkspaceUserGroupProblem.Gone,
        });
      }

      // Teams deleted the tag OneUptime emptied.
      if (wanted.length === 0) {
        return {
          members: [],
          leftOut: leftOut,
          isTurnedOff: true,
          problem: null,
        };
      }

      const made: MicrosoftTeamsTagInfo = await MicrosoftTeamsTags.create({
        accessToken: accessToken,
        teamId: teamId,
        name: target.name,
        aadObjectIds: wanted,
      });

      tags.push(made);

      return {
        members: members,
        leftOut: leftOut,
        isTurnedOff: false,
        problem: null,
        name: made.name,
        workspaceGroupId: made.id,
      };
    }

    const current: Array<MicrosoftTeamsTagMember> =
      await MicrosoftTeamsTags.getMembers({
        accessToken: accessToken,
        teamId: teamId,
        tagId: tag.id,
      });

    const wantedSet: Set<string> = new Set<string>(
      wanted.map((id: string): string => {
        return id.toLowerCase();
      }),
    );
    const currentSet: Set<string> = new Set<string>(
      current.map((member: MicrosoftTeamsTagMember): string => {
        return member.aadObjectId.toLowerCase();
      }),
    );

    for (const member of [...members]) {
      if (currentSet.has(member.workspaceUserId.toLowerCase())) {
        continue;
      }

      try {
        await MicrosoftTeamsTags.addMember({
          accessToken: accessToken,
          teamId: teamId,
          tagId: tag.id,
          aadObjectId: member.workspaceUserId,
        });
      } catch (err) {
        const error: WorkspaceUserGroupError | null =
          WorkspaceUserGroupError.read(err);

        // Refused for this person alone: not someone the team's tag can hold.
        if (error?.problem === WorkspaceUserGroupProblem.Refused) {
          members.splice(members.indexOf(member), 1);
          leftOut.push({
            userId: member.userId,
            reason: WorkspaceUserGroupLeftOutReason.NotInTeam,
          });
          continue;
        }

        throw err;
      }
    }

    for (const member of current) {
      if (wantedSet.has(member.aadObjectId.toLowerCase())) {
        continue;
      }

      await MicrosoftTeamsTags.removeMember({
        accessToken: accessToken,
        teamId: teamId,
        tagId: tag.id,
        memberId: member.memberId,
      });
    }

    return {
      members: members,
      leftOut: leftOut,
      isTurnedOff: members.length === 0,
      problem: null,
      name: tag.name,
    };
  }

  private static getTagUrl(data: { teamId: string; tagId: string }): string {
    return `${getTeamUrl(data.teamId)}/tags/${encodeURIComponent(data.tagId)}`;
  }

  private static readValues(body: JSONObject): Array<unknown> {
    return Array.isArray(body["value"])
      ? (body["value"] as Array<unknown>)
      : [];
  }

  /*
   * The next page of a Graph answer: only this cloud's Graph is followed,
   * so an answer cannot send the token elsewhere.
   */
  private static readNextLink(body: JSONObject): string | null {
    const next: string | null = MicrosoftTeamsHosts.readGraphNextLink(body);

    return next ? new globalThis.URL(next).toString() : null;
  }

  private static readTag(value: unknown): MicrosoftTeamsTagInfo | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const tag: JSONObject = value as JSONObject;

    if (typeof tag["id"] !== "string" || !tag["id"]) {
      return null;
    }

    return {
      id: tag["id"] as string,
      name:
        typeof tag["displayName"] === "string"
          ? (tag["displayName"] as string)
          : "",
      memberCount:
        typeof tag["memberCount"] === "number"
          ? (tag["memberCount"] as number)
          : null,
    };
  }
}

export const MicrosoftTeamsTagProvider: WorkspaceUserGroupProvider = {
  sync: (
    request: WorkspaceUserGroupSyncRequest,
  ): Promise<WorkspaceUserGroupProviderResult> => {
    return MicrosoftTeamsTags.sync(request);
  },
};
