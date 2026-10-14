import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import {
  WorkspaceUserGroupLeftOut,
  WorkspaceUserGroupLeftOutReason,
  WorkspaceUserGroupMember,
  WorkspaceUserGroupProblem,
} from "../../../../Types/Workspace/WorkspaceUserGroup";
import API from "../../../../Utils/API";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  WorkspaceUserGroupError,
  WorkspaceUserGroupPerson,
  WorkspaceUserGroupProvider,
  WorkspaceUserGroupProviderResult,
  WorkspaceUserGroupSyncRequest,
} from "../UserGroups/WorkspaceUserGroupProvider";

/*
 * SLACK USER GROUPS, KEPT IN STEP WITH WHO IS ON CALL.
 *
 * What OneUptime asks of Slack's Web API to keep a user group equal to the
 * people on call (WorkspaceUserGroupSync decides who they are):
 *
 * - usergroups.list            the workspace's groups: is ours there, is it
 *                              turned off, what is it called now
 * - users.info                 a connected account: still a full member?
 * - users.lookupByEmail        anybody else, by their OneUptime email
 * - usergroups.users.list      who the group holds now
 * - usergroups.users.update    the people on call, when they differ
 * - usergroups.disable/enable  nobody on call: Slack cannot hold an empty
 *                              user group, so it is turned off until somebody
 *                              is on call, and turned back on then
 * - usergroups.create          a new group, from the schedule's Connect form
 *
 * They need the bot scopes usergroups:read and usergroups:write (users:read
 * and users:read.email for the people), user groups need a paid Slack plan,
 * and Slack lets only workspace owners and admins change user groups unless
 * its settings let everyone (Workspace settings > Permissions > User
 * Groups). Each refusal becomes a WorkspaceUserGroupError whose problem the
 * schedule's card puts in plain words.
 */

// A Slack user group, as usergroups.list tells it.
export interface SlackUserGroupInfo {
  id: string;
  name: string;
  handle: string;
  userCount: number | null;
  // Turned off ("disabled"): its handle cannot be mentioned.
  isTurnedOff: boolean;
}

// A Slack account, as users.info and users.lookupByEmail tell it.
interface SlackAccount {
  id: string;
  isDeactivated: boolean;
  isGuest: boolean;
  isBot: boolean;
}

// Who somebody on call is in Slack, or why they cannot be in the group.
type SlackPersonLookup =
  | { workspaceUserId: string }
  | { reason: WorkspaceUserGroupLeftOutReason };

/*
 * What Slack's error codes mean for the card. Codes not here are Refused,
 * with the code itself as the detail.
 */
const PAID_PLAN_ERRORS: ReadonlyArray<string> = [
  "plan_upgrade_required",
  "paid_teams_only",
  "paid_only",
];

const MISSING_SCOPE_ERRORS: ReadonlyArray<string> = [
  "missing_scope",
  "not_allowed_token_type",
];

const ADMINS_ONLY_ERRORS: ReadonlyArray<string> = [
  "permission_denied",
  "no_permission",
];

const NOT_CONNECTED_ERRORS: ReadonlyArray<string> = [
  "invalid_auth",
  "not_authed",
  "account_inactive",
  "token_revoked",
  "token_expired",
  "team_access_not_granted",
];

const GONE_ERRORS: ReadonlyArray<string> = [
  "no_such_subteam",
  "subteam_not_found",
  "usergroup_not_found",
  "invalid_usergroup",
];

const UNAVAILABLE_ERRORS: ReadonlyArray<string> = [
  "ratelimited",
  "rate_limited",
  "service_unavailable",
  "internal_error",
  "fatal_error",
  "request_timeout",
  "team_added_to_org",
  "org_login_required",
];

// What a new group says about itself in Slack.
export const SLACK_USER_GROUP_DESCRIPTION: (productName: string) => string = (
  productName: string,
): string => {
  return `Whoever is on call right now. ${productName} keeps this group up to date.`;
};

export default class SlackUserGroups {
  // The words of Slack's error codes, for the card.
  public static getProblem(errorCode: string): WorkspaceUserGroupProblem {
    if (PAID_PLAN_ERRORS.includes(errorCode)) {
      return WorkspaceUserGroupProblem.PaidPlanNeeded;
    }

    if (MISSING_SCOPE_ERRORS.includes(errorCode)) {
      return WorkspaceUserGroupProblem.MissingScope;
    }

    if (ADMINS_ONLY_ERRORS.includes(errorCode)) {
      return WorkspaceUserGroupProblem.AdminsOnly;
    }

    if (NOT_CONNECTED_ERRORS.includes(errorCode)) {
      return WorkspaceUserGroupProblem.NotConnected;
    }

    if (GONE_ERRORS.includes(errorCode)) {
      return WorkspaceUserGroupProblem.Gone;
    }

    if (UNAVAILABLE_ERRORS.includes(errorCode)) {
      return WorkspaceUserGroupProblem.Unavailable;
    }

    return WorkspaceUserGroupProblem.Refused;
  }

  /*
   * One Web API call: its answer when Slack says ok, a WorkspaceUserGroupError
   * otherwise - with how long Slack asked to wait when it limited the rate.
   */
  private static async call(data: {
    authToken: string;
    method: string;
    body: JSONObject;
  }): Promise<JSONObject> {
    let response: HTTPErrorResponse | HTTPResponse<JSONObject>;

    try {
      response = await API.post<JSONObject>({
        url: URL.fromString(`https://slack.com/api/${data.method}`),
        data: data.body,
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
      });
    } catch (err) {
      logger.debug(`Slack did not answer ${data.method}.`);
      logger.debug(err);

      throw new WorkspaceUserGroupError({
        problem: WorkspaceUserGroupProblem.Unavailable,
        detail: data.method,
      });
    }

    if (response instanceof HTTPErrorResponse) {
      const retryAfterSeconds: number | undefined =
        SlackUserGroups.readRetryAfter(response);

      if (response.statusCode === 429 || response.statusCode >= 500) {
        throw new WorkspaceUserGroupError({
          problem: WorkspaceUserGroupProblem.Unavailable,
          detail: data.method,
          retryAfterSeconds: retryAfterSeconds,
        });
      }

      const errorCode: string = SlackUserGroups.readErrorCode(
        (response.jsonData || {}) as JSONObject,
      );

      throw new WorkspaceUserGroupError({
        problem: errorCode
          ? SlackUserGroups.getProblem(errorCode)
          : WorkspaceUserGroupProblem.Refused,
        detail: errorCode || `HTTP ${response.statusCode}`,
        retryAfterSeconds: retryAfterSeconds,
      });
    }

    const body: JSONObject = (response.jsonData || {}) as JSONObject;

    if (body["ok"] !== true) {
      const errorCode: string = SlackUserGroups.readErrorCode(body);

      throw new WorkspaceUserGroupError({
        problem: SlackUserGroups.getProblem(errorCode),
        detail: errorCode || "unknown_error",
        retryAfterSeconds: SlackUserGroups.readRetryAfter(response),
      });
    }

    return body;
  }

  // The workspace's user groups, turned off ones too.
  @CaptureSpan()
  public static async list(data: {
    authToken: string;
    teamId: string;
  }): Promise<Array<SlackUserGroupInfo>> {
    const body: JSONObject = await SlackUserGroups.call({
      authToken: data.authToken,
      method: "usergroups.list",
      body: {
        include_disabled: true,
        include_count: true,
        ...(data.teamId ? { team_id: data.teamId } : {}),
      },
    });

    const groups: Array<unknown> = Array.isArray(body["usergroups"])
      ? (body["usergroups"] as Array<unknown>)
      : [];

    return groups
      .map((group: unknown): SlackUserGroupInfo | null => {
        return SlackUserGroups.readUserGroup(group);
      })
      .filter((group: SlackUserGroupInfo | null): boolean => {
        return group !== null;
      }) as Array<SlackUserGroupInfo>;
  }

  // A new user group, empty: its members are the next sync's.
  @CaptureSpan()
  public static async create(data: {
    authToken: string;
    teamId: string;
    name: string;
    handle: string;
    description: string;
  }): Promise<SlackUserGroupInfo> {
    const body: JSONObject = await SlackUserGroups.call({
      authToken: data.authToken,
      method: "usergroups.create",
      body: {
        name: data.name,
        handle: data.handle,
        description: data.description,
        include_count: true,
        ...(data.teamId ? { team_id: data.teamId } : {}),
      },
    });

    const group: SlackUserGroupInfo | null = SlackUserGroups.readUserGroup(
      body["usergroup"],
    );

    if (!group) {
      throw new WorkspaceUserGroupError({
        problem: WorkspaceUserGroupProblem.Refused,
        detail: "no_usergroup_returned",
      });
    }

    return group;
  }

  // Who a group holds now.
  @CaptureSpan()
  public static async getMemberIds(data: {
    authToken: string;
    teamId: string;
    groupId: string;
  }): Promise<Array<string>> {
    const body: JSONObject = await SlackUserGroups.call({
      authToken: data.authToken,
      method: "usergroups.users.list",
      body: {
        usergroup: data.groupId,
        include_disabled: true,
        ...(data.teamId ? { team_id: data.teamId } : {}),
      },
    });

    return (
      Array.isArray(body["users"]) ? (body["users"] as Array<unknown>) : []
    )
      .filter((userId: unknown): userId is string => {
        return typeof userId === "string" && userId.length > 0;
      })
      .map((userId: string): string => {
        return userId;
      });
  }

  // Makes a group hold exactly these people (one at least: Slack's rule).
  @CaptureSpan()
  public static async setMembers(data: {
    authToken: string;
    teamId: string;
    groupId: string;
    userIds: Array<string>;
  }): Promise<SlackUserGroupInfo | null> {
    const body: JSONObject = await SlackUserGroups.call({
      authToken: data.authToken,
      method: "usergroups.users.update",
      body: {
        usergroup: data.groupId,
        users: data.userIds.join(","),
        include_count: true,
        ...(data.teamId ? { team_id: data.teamId } : {}),
      },
    });

    return SlackUserGroups.readUserGroup(body["usergroup"]);
  }

  // Turns a group off: nobody can mention it, and it keeps its members.
  @CaptureSpan()
  public static async turnOff(data: {
    authToken: string;
    teamId: string;
    groupId: string;
  }): Promise<void> {
    await SlackUserGroups.call({
      authToken: data.authToken,
      method: "usergroups.disable",
      body: {
        usergroup: data.groupId,
        ...(data.teamId ? { team_id: data.teamId } : {}),
      },
    });
  }

  // Turns a group back on.
  @CaptureSpan()
  public static async turnOn(data: {
    authToken: string;
    teamId: string;
    groupId: string;
  }): Promise<void> {
    await SlackUserGroups.call({
      authToken: data.authToken,
      method: "usergroups.enable",
      body: {
        usergroup: data.groupId,
        ...(data.teamId ? { team_id: data.teamId } : {}),
      },
    });
  }

  /*
   * Who somebody on call is in Slack: the account they connected to
   * OneUptime when it is still a member of the workspace, or else the one
   * with their OneUptime email address. A guest or a deactivated account
   * cannot be in a user group, and says why.
   */
  @CaptureSpan()
  public static async findPerson(data: {
    authToken: string;
    person: WorkspaceUserGroupPerson;
  }): Promise<SlackPersonLookup> {
    let seen: SlackAccount | null = null;

    if (data.person.connectedWorkspaceUserId) {
      seen = await SlackUserGroups.readAccount({
        authToken: data.authToken,
        method: "users.info",
        body: { user: data.person.connectedWorkspaceUserId },
        notFoundErrors: ["user_not_found", "users_not_found"],
      });
    }

    if ((!seen || seen.isDeactivated) && data.person.email) {
      const byEmail: SlackAccount | null = await SlackUserGroups.readAccount({
        authToken: data.authToken,
        method: "users.lookupByEmail",
        body: { email: data.person.email },
        /*
         * An app installed before it asked for users:read.email cannot look
         * people up by email: they are found by a connected account only.
         */
        notFoundErrors: ["users_not_found", "user_not_found", "missing_scope"],
      });

      if (byEmail && (!seen || !byEmail.isDeactivated)) {
        seen = byEmail;
      }
    }

    if (!seen || seen.isBot) {
      return { reason: WorkspaceUserGroupLeftOutReason.NotFound };
    }

    if (seen.isDeactivated) {
      return { reason: WorkspaceUserGroupLeftOutReason.Deactivated };
    }

    if (seen.isGuest) {
      return { reason: WorkspaceUserGroupLeftOutReason.Guest };
    }

    return { workspaceUserId: seen.id };
  }

  /*
   * KEEPING ONE GROUP IN STEP.
   *
   * The group must still be in the workspace. The people on call are found
   * in Slack; whoever is not, is left out with the reason. Then:
   *
   * - nobody to put in it: it is turned off (Slack cannot hold an empty
   *   user group) - unless it is off already;
   * - somebody: a group OneUptime turned off is turned back on, and its
   *   members are set when they are not exactly those people. A group
   *   somebody else turned off keeps its members up to date but stays off,
   *   and says so.
   */
  @CaptureSpan()
  public static async sync(
    request: WorkspaceUserGroupSyncRequest,
  ): Promise<WorkspaceUserGroupProviderResult> {
    const { target, previous, cache } = request;
    const teamId: string = target.workspaceProjectId;

    const cacheKey: string = `slack-usergroups:${teamId}`;
    let groups: Array<SlackUserGroupInfo> | undefined = cache.get(cacheKey) as
      | Array<SlackUserGroupInfo>
      | undefined;

    if (!groups) {
      groups = await SlackUserGroups.list({
        authToken: target.authToken,
        teamId: teamId,
      });
      cache.set(cacheKey, groups);
    }

    const group: SlackUserGroupInfo | undefined = groups.find(
      (candidate: SlackUserGroupInfo): boolean => {
        return candidate.id === target.workspaceGroupId;
      },
    );

    if (!group) {
      throw new WorkspaceUserGroupError({
        problem: WorkspaceUserGroupProblem.Gone,
      });
    }

    const members: Array<WorkspaceUserGroupMember> = [];
    const leftOut: Array<WorkspaceUserGroupLeftOut> = [];

    for (const person of request.people) {
      const lookup: SlackPersonLookup = await SlackUserGroups.findPerson({
        authToken: target.authToken,
        person: person,
      });

      if ("reason" in lookup) {
        leftOut.push({
          userId: person.userId.toString(),
          reason: lookup.reason,
        });
        continue;
      }

      const isThereAlready: boolean = members.some(
        (member: WorkspaceUserGroupMember): boolean => {
          return member.workspaceUserId === lookup.workspaceUserId;
        },
      );

      if (!isThereAlready) {
        members.push({
          userId: person.userId.toString(),
          workspaceUserId: lookup.workspaceUserId,
        });
      }
    }

    const names: { name: string; handle: string } = {
      name: group.name,
      handle: group.handle,
    };

    const wasTurnedOffByOneUptime: boolean = Boolean(previous?.isTurnedOff);

    // Nobody to put in it.
    if (members.length === 0) {
      if (!group.isTurnedOff) {
        await SlackUserGroups.turnOff({
          authToken: target.authToken,
          teamId: teamId,
          groupId: group.id,
        });
        group.isTurnedOff = true;

        return {
          members: [],
          leftOut: leftOut,
          isTurnedOff: true,
          problem: null,
          ...names,
        };
      }

      // Off already: by OneUptime, or by somebody - either way, nobody to reach.
      return {
        members: [],
        leftOut: leftOut,
        isTurnedOff: wasTurnedOffByOneUptime,
        problem: null,
        ...names,
      };
    }

    let isOff: boolean = group.isTurnedOff;

    if (isOff && wasTurnedOffByOneUptime) {
      await SlackUserGroups.turnOn({
        authToken: target.authToken,
        teamId: teamId,
        groupId: group.id,
      });
      group.isTurnedOff = false;
      isOff = false;
    }

    const wanted: Array<string> = members.map(
      (member: WorkspaceUserGroupMember): string => {
        return member.workspaceUserId;
      },
    );

    const current: Array<string> = await SlackUserGroups.getMemberIds({
      authToken: target.authToken,
      teamId: teamId,
      groupId: group.id,
    });

    if (!SlackUserGroups.isSameSet(current, wanted)) {
      const updated: SlackUserGroupInfo | null =
        await SlackUserGroups.setMembers({
          authToken: target.authToken,
          teamId: teamId,
          groupId: group.id,
          userIds: wanted,
        });

      if (updated) {
        isOff = updated.isTurnedOff;
        group.isTurnedOff = updated.isTurnedOff;
        group.userCount = updated.userCount;
      }
    }

    return {
      members: members,
      leftOut: leftOut,
      isTurnedOff: false,
      problem: isOff ? WorkspaceUserGroupProblem.TurnedOffInWorkspace : null,
      ...names,
    };
  }

  // A user group from Slack's answer; null for anything that is not one.
  public static readUserGroup(value: unknown): SlackUserGroupInfo | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const group: JSONObject = value as JSONObject;
    const id: unknown = group["id"];

    if (typeof id !== "string" || !id) {
      return null;
    }

    const userCount: unknown = group["user_count"];
    const dateDelete: unknown = group["date_delete"];

    return {
      id: id,
      name: typeof group["name"] === "string" ? (group["name"] as string) : "",
      handle:
        typeof group["handle"] === "string" ? (group["handle"] as string) : "",
      userCount:
        typeof userCount === "number"
          ? userCount
          : typeof userCount === "string" && userCount.trim() !== ""
            ? Number(userCount) || 0
            : null,
      isTurnedOff:
        (typeof dateDelete === "number" && dateDelete > 0) ||
        (typeof dateDelete === "string" && Number(dateDelete) > 0),
    };
  }

  // A Slack account by its id or its email; null when Slack knows none.
  private static async readAccount(data: {
    authToken: string;
    method: string;
    body: JSONObject;
    notFoundErrors: Array<string>;
  }): Promise<SlackAccount | null> {
    let body: JSONObject;

    try {
      body = await SlackUserGroups.call({
        authToken: data.authToken,
        method: data.method,
        body: data.body,
      });
    } catch (err) {
      const error: WorkspaceUserGroupError | null =
        WorkspaceUserGroupError.read(err);

      if (error?.detail && data.notFoundErrors.includes(error.detail)) {
        return null;
      }

      throw err;
    }

    const user: JSONObject | null =
      body["user"] && typeof body["user"] === "object"
        ? (body["user"] as JSONObject)
        : null;

    if (!user || typeof user["id"] !== "string" || !user["id"]) {
      return null;
    }

    return {
      id: user["id"] as string,
      isDeactivated: user["deleted"] === true,
      isGuest:
        user["is_restricted"] === true || user["is_ultra_restricted"] === true,
      isBot: user["is_bot"] === true || user["is_app_user"] === true,
    };
  }

  private static readErrorCode(body: JSONObject): string {
    const error: unknown = body["error"];
    return typeof error === "string" ? error : "";
  }

  private static readRetryAfter(
    response: HTTPErrorResponse | HTTPResponse<JSONObject>,
  ): number | undefined {
    const headers: Record<string, unknown> = (response.headers || {}) as Record<
      string,
      unknown
    >;
    const value: unknown = headers["retry-after"] ?? headers["Retry-After"];
    const seconds: number = Number(value);

    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
  }

  private static isSameSet(a: Array<string>, b: Array<string>): boolean {
    const left: Set<string> = new Set<string>(a);
    const right: Set<string> = new Set<string>(b);

    if (left.size !== right.size) {
      return false;
    }

    for (const value of left) {
      if (!right.has(value)) {
        return false;
      }
    }

    return true;
  }
}

export const SlackUserGroupProvider: WorkspaceUserGroupProvider = {
  sync: (
    request: WorkspaceUserGroupSyncRequest,
  ): Promise<WorkspaceUserGroupProviderResult> => {
    return SlackUserGroups.sync(request);
  },
};
