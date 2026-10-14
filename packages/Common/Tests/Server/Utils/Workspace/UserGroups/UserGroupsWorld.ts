import { jest } from "@jest/globals";
import OnCallDutyPolicySchedule from "../../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "../../../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import WorkspaceUserGroup from "../../../../../Models/DatabaseModels/WorkspaceUserGroup";
import Semaphore from "../../../../../Server/Infrastructure/Semaphore";
import UserService from "../../../../../Server/Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../../Server/Services/WorkspaceUserAuthTokenService";
import WorkspaceUserGroupService from "../../../../../Server/Services/WorkspaceUserGroupService";
import logger from "../../../../../Server/Utils/Logger";
import MicrosoftTeamsUtil, {
  MicrosoftTeamsRosterMember,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import ProductBrandingText from "../../../../../Server/Utils/ProductBrandingText";
import WorkspaceUserGroupSync from "../../../../../Server/Utils/Workspace/UserGroups/WorkspaceUserGroupSync";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  readWorkspaceUserGroupSyncState,
  WorkspaceUserGroupSyncState,
} from "../../../../../Types/Workspace/WorkspaceUserGroup";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import API from "../../../../../Utils/API";

/*
 * ON-CALL USER GROUPS, BETWEEN ONEUPTIME AND A WORKSPACE.
 *
 * The real sync engine (WorkspaceUserGroupSync), the real providers
 * (SlackUserGroups, MicrosoftTeamsTags) and the real HTTP requests they
 * build; in memory, the rows they read and write (the groups, the
 * schedules' rosters, the people, their connected accounts) and, at the far
 * end, a Slack workspace and a Microsoft Graph that answer as Slack and
 * Graph do and record every request.
 *
 * The clock is the world's own, from 9:00 UTC on 14 October 2026, moved on
 * with minutesPass().
 */

export const PROJECT_ID: ObjectID = new ObjectID(
  "b0000000-0000-4000-8000-000000000001",
);

export const START: string = "2026-10-14T09:00:00.000Z";

export const SLACK_TEAM_ID: string = "T0ACME";
export const SLACK_TOKEN: string = "xoxb-acme-bot-token";
export const TENANT_ID: string = "11111111-2222-4333-8444-555555555555";
export const GRAPH_TOKEN: string = "graph.app.token";
export const TEAM_PAYMENTS: string = "aaaaaaaa-0000-4000-8000-0000000000aa";

// A person in OneUptime, and who they are in each workspace.
export interface WorldPerson {
  id: ObjectID;
  name: string;
  email: string;
}

export interface WorldSchedule {
  id: ObjectID;
  name: string;
  onCall: ObjectID | null;
}

export interface WorldGroupRow {
  id: ObjectID;
  projectId: ObjectID;
  workspaceType: WorkspaceType;
  workspaceGroupId: string;
  workspaceTeamId: string | null;
  name: string;
  handle: string | null;
  scheduleIds: Array<string>;
  syncState: WorkspaceUserGroupSyncState | null;
  syncedAt: Date | null;
  nextSyncAt: Date | null;
}

// ---- Slack, as its Web API answers ----

export interface FakeSlackUser {
  id: string;
  email: string;
  name: string;
  deleted?: boolean | undefined;
  isGuest?: boolean | undefined;
  isBot?: boolean | undefined;
}

export interface FakeSlackGroup {
  id: string;
  name: string;
  handle: string;
  description: string;
  users: Array<string>;
  // Seconds since 1970 when turned off; 0 while on.
  dateDelete: number;
}

export interface SlackRequest {
  method: string;
  body: JSONObject;
  headers: Record<string, string>;
}

const SLACK_METHOD_SCOPES: Record<string, string> = {
  "usergroups.list": "usergroups:read",
  "usergroups.users.list": "usergroups:read",
  "usergroups.users.update": "usergroups:write",
  "usergroups.create": "usergroups:write",
  "usergroups.disable": "usergroups:write",
  "usergroups.enable": "usergroups:write",
  "users.info": "users:read",
  "users.lookupByEmail": "users:read.email",
};

export class FakeSlack {
  public users: Map<string, FakeSlackUser> = new Map<string, FakeSlackUser>();
  public groups: Map<string, FakeSlackGroup> = new Map<
    string,
    FakeSlackGroup
  >();
  public scopes: Set<string> = new Set<string>(
    Object.values(SLACK_METHOD_SCOPES),
  );
  // A free Slack plan has no user groups.
  public isPaidPlan: boolean = true;
  // Slack's default: only owners and admins may change user groups.
  public isAdminsOnly: boolean = false;
  // Refusals: method -> Slack error code, every time.
  public refusals: Map<string, string> = new Map<string, string>();
  // Method -> seconds of Retry-After, once (HTTP 429).
  public rateLimitOnce: Map<string, number> = new Map<string, number>();
  // Slack cannot be reached at all.
  public isDown: boolean = false;
  public requests: Array<SlackRequest> = [];
  // Held answers: a test lets a method's answer go when it wants.
  public gates: Map<string, Promise<void>> = new Map<string, Promise<void>>();

  private nextGroup: number = 1;

  public addUser(user: FakeSlackUser): FakeSlackUser {
    this.users.set(user.id, user);
    return user;
  }

  public addGroup(data: {
    name: string;
    handle: string;
    users?: Array<string> | undefined;
    isTurnedOff?: boolean | undefined;
  }): FakeSlackGroup {
    const group: FakeSlackGroup = {
      id: `S0GROUP${this.nextGroup++}`,
      name: data.name,
      handle: data.handle,
      description: "",
      users: data.users || [],
      dateDelete: data.isTurnedOff ? 1760400000 : 0,
    };
    this.groups.set(group.id, group);
    return group;
  }

  // The methods OneUptime called, in order.
  public methods(): Array<string> {
    return this.requests.map((request: SlackRequest): string => {
      return request.method;
    });
  }

  public calls(method: string): Array<JSONObject> {
    return this.requests
      .filter((request: SlackRequest): boolean => {
        return request.method === method;
      })
      .map((request: SlackRequest): JSONObject => {
        return request.body;
      });
  }

  public async answer(
    method: string,
    body: JSONObject,
    headers?: Record<string, string> | undefined,
  ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    this.requests.push({
      method: method,
      body: { ...body },
      headers: { ...(headers || {}) },
    });

    const gate: Promise<void> | undefined = this.gates.get(method);

    if (gate) {
      await gate;
    }

    if (this.isDown) {
      throw new Error("getaddrinfo ENOTFOUND slack.com");
    }

    const retryAfter: number | undefined = this.rateLimitOnce.get(method);

    if (retryAfter !== undefined) {
      this.rateLimitOnce.delete(method);
      return new HTTPErrorResponse(
        429,
        { ok: false, error: "ratelimited" },
        { "retry-after": String(retryAfter) },
      );
    }

    const refusal: string | undefined = this.refusals.get(method);

    if (refusal) {
      return this.error(refusal);
    }

    const scope: string | undefined = SLACK_METHOD_SCOPES[method];

    if (!scope) {
      throw new Error(`The fake Slack does not know ${method}.`);
    }

    if (!this.scopes.has(scope)) {
      return this.error("missing_scope");
    }

    if (method.startsWith("usergroups.") && !this.isPaidPlan) {
      return this.error("plan_upgrade_required");
    }

    const isChange: boolean =
      method === "usergroups.users.update" ||
      method === "usergroups.create" ||
      method === "usergroups.disable" ||
      method === "usergroups.enable";

    if (isChange && this.isAdminsOnly) {
      return this.error("permission_denied");
    }

    switch (method) {
      case "usergroups.list":
        return this.ok({
          usergroups: Array.from(this.groups.values()).map(
            (group: FakeSlackGroup): JSONObject => {
              return this.toJson(group);
            },
          ),
        });
      case "usergroups.users.list": {
        const group: FakeSlackGroup | undefined = this.groups.get(
          String(body["usergroup"]),
        );

        if (!group) {
          return this.error("no_such_subteam");
        }

        return this.ok({ users: [...group.users] });
      }
      case "usergroups.users.update": {
        const group: FakeSlackGroup | undefined = this.groups.get(
          String(body["usergroup"]),
        );

        if (!group) {
          return this.error("no_such_subteam");
        }

        const users: Array<string> = String(body["users"] || "")
          .split(",")
          .filter(Boolean);

        if (users.length === 0) {
          return this.error("no_users_provided");
        }

        for (const userId of users) {
          const user: FakeSlackUser | undefined = this.users.get(userId);

          if (!user || user.deleted || user.isBot) {
            return this.error("invalid_users");
          }

          if (user.isGuest) {
            return this.error("invalid_users");
          }
        }

        group.users = users;

        return this.ok({ usergroup: this.toJson(group) });
      }
      case "usergroups.disable":
      case "usergroups.enable": {
        const group: FakeSlackGroup | undefined = this.groups.get(
          String(body["usergroup"]),
        );

        if (!group) {
          return this.error("no_such_subteam");
        }

        group.dateDelete = method === "usergroups.disable" ? 1760436000 : 0;

        return this.ok({ usergroup: this.toJson(group) });
      }
      case "usergroups.create": {
        const handle: string = String(body["handle"] || "");
        const name: string = String(body["name"] || "");

        const handleTaken: boolean =
          Array.from(this.groups.values()).some(
            (group: FakeSlackGroup): boolean => {
              return group.handle === handle;
            },
          ) ||
          Array.from(this.users.values()).some(
            (user: FakeSlackUser): boolean => {
              return user.name === handle;
            },
          );

        if (handleTaken) {
          return this.error("handle_already_exists");
        }

        if (
          Array.from(this.groups.values()).some(
            (group: FakeSlackGroup): boolean => {
              return group.name === name;
            },
          )
        ) {
          return this.error("name_already_exists");
        }

        const group: FakeSlackGroup = this.addGroup({
          name: name,
          handle: handle,
        });
        group.description = String(body["description"] || "");

        return this.ok({ usergroup: this.toJson(group) });
      }
      case "users.info": {
        const user: FakeSlackUser | undefined = this.users.get(
          String(body["user"]),
        );

        return user
          ? this.ok({ user: this.userJson(user) })
          : this.error("user_not_found");
      }
      case "users.lookupByEmail": {
        const email: string = String(body["email"] || "").toLowerCase();
        const user: FakeSlackUser | undefined = Array.from(
          this.users.values(),
        ).find((candidate: FakeSlackUser): boolean => {
          return candidate.email.toLowerCase() === email;
        });

        return user
          ? this.ok({ user: this.userJson(user) })
          : this.error("users_not_found");
      }
      default:
        throw new Error(`The fake Slack does not answer ${method}.`);
    }
  }

  private toJson(group: FakeSlackGroup): JSONObject {
    return {
      id: group.id,
      team_id: SLACK_TEAM_ID,
      is_usergroup: true,
      name: group.name,
      handle: group.handle,
      description: group.description,
      date_delete: group.dateDelete,
      user_count: group.users.length,
      users: [...group.users],
    };
  }

  private userJson(user: FakeSlackUser): JSONObject {
    return {
      id: user.id,
      name: user.name,
      deleted: Boolean(user.deleted),
      is_bot: Boolean(user.isBot),
      is_restricted: Boolean(user.isGuest),
      is_ultra_restricted: false,
      profile: {
        email: user.email,
        real_name: user.name,
      },
    };
  }

  private ok(body: JSONObject): HTTPResponse<JSONObject> {
    return new HTTPResponse<JSONObject>(200, { ok: true, ...body }, {});
  }

  private error(code: string): HTTPResponse<JSONObject> {
    return new HTTPResponse<JSONObject>(200, { ok: false, error: code }, {});
  }
}

// ---- Microsoft Graph's teamwork tags, and the teams' rosters ----

export interface FakeTagMember {
  id: string;
  userId: string;
}

export interface FakeTag {
  id: string;
  displayName: string;
  members: Array<FakeTagMember>;
}

export interface GraphRequest {
  method: string;
  path: string;
  body: JSONObject | null;
}

export class FakeGraph {
  // Team id -> its tags.
  public teams: Map<string, Map<string, FakeTag>> = new Map<
    string,
    Map<string, FakeTag>
  >();
  // Team id -> its roster, as the team's bot reads it.
  public rosters: Map<string, Array<MicrosoftTeamsRosterMember>> = new Map<
    string,
    Array<MicrosoftTeamsRosterMember>
  >();
  // The tenant granted TeamworkTag.ReadWrite.All.
  public isTagPermissionGranted: boolean = true;
  // Teams deletes a tag that is left with nobody in it.
  public deletesEmptyTags: boolean = false;
  // Users the tag API refuses to add (HTTP 400).
  public refusedUsers: Set<string> = new Set<string>();
  public rateLimitOnce: boolean = false;
  public requests: Array<GraphRequest> = [];

  private next: number = 1;

  public addTeam(teamId: string, roster: Array<MicrosoftTeamsRosterMember>): void {
    this.teams.set(teamId, new Map<string, FakeTag>());
    this.rosters.set(teamId, roster);
  }

  public addTag(teamId: string, displayName: string, userIds: Array<string>): FakeTag {
    const tag: FakeTag = {
      id: `TAG${this.next++}==`,
      displayName: displayName,
      members: userIds.map((userId: string): FakeTagMember => {
        return { id: `MEMBER${this.next++}==`, userId: userId };
      }),
    };
    this.teams.get(teamId)!.set(tag.id, tag);
    return tag;
  }

  public tag(teamId: string, tagId: string): FakeTag | undefined {
    return this.teams.get(teamId)?.get(tagId);
  }

  public answer(
    method: string,
    url: string,
    body: JSONObject | null,
  ): HTTPResponse<JSONObject> | HTTPErrorResponse {
    const parsed: globalThis.URL = new globalThis.URL(url);
    const path: string = decodeURIComponent(parsed.pathname);
    this.requests.push({ method: method, path: path, body: body });

    if (this.rateLimitOnce) {
      this.rateLimitOnce = false;
      return new HTTPErrorResponse(
        429,
        { error: { code: "TooManyRequests", message: "Slow down" } },
        { "retry-after": "120" },
      );
    }

    if (!this.isTagPermissionGranted) {
      return new HTTPErrorResponse(
        403,
        {
          error: {
            code: "Forbidden",
            message:
              "Missing role permissions on the request. API requires one of 'TeamworkTag.Read.All, TeamworkTag.ReadWrite.All'.",
          },
        },
        {},
      );
    }

    const parts: Array<string> = path
      .replace("/v1.0/teams/", "")
      .split("/")
      .filter(Boolean);
    const teamId: string = parts[0] || "";
    const tags: Map<string, FakeTag> | undefined = this.teams.get(teamId);

    if (!tags) {
      return this.notFound();
    }

    // /teams/{team}/tags
    if (parts.length === 2) {
      if (method === "GET") {
        return this.ok({
          value: Array.from(tags.values()).map((tag: FakeTag): JSONObject => {
            return this.tagJson(teamId, tag);
          }),
        });
      }

      const members: Array<JSONObject> =
        (body?.["members"] as Array<JSONObject>) || [];

      if (members.length === 0 || members.length > 25) {
        return new HTTPErrorResponse(
          400,
          { error: { code: "BadRequest", message: "1 to 25 members." } },
          {},
        );
      }

      const tag: FakeTag = this.addTag(
        teamId,
        String(body?.["displayName"] || ""),
        members.map((member: JSONObject): string => {
          return String(member["userId"]);
        }),
      );

      return new HTTPResponse<JSONObject>(201, this.tagJson(teamId, tag), {});
    }

    const tag: FakeTag | undefined = tags.get(parts[2] || "");

    if (!tag) {
      return this.notFound();
    }

    // /teams/{team}/tags/{tag}/members
    if (parts.length === 4) {
      if (method === "GET") {
        return this.ok({
          value: tag.members.map((member: FakeTagMember): JSONObject => {
            return { id: member.id, userId: member.userId };
          }),
        });
      }

      const userId: string = String(body?.["userId"] || "");

      if (this.refusedUsers.has(userId)) {
        return new HTTPErrorResponse(
          400,
          { error: { code: "BadRequest", message: "Not a team member." } },
          {},
        );
      }

      const member: FakeTagMember = {
        id: `MEMBER${this.next++}==`,
        userId: userId,
      };
      tag.members.push(member);

      return new HTTPResponse<JSONObject>(201, { ...member }, {});
    }

    // DELETE /teams/{team}/tags/{tag}/members/{member}
    const memberId: string = parts[4] || "";
    const before: number = tag.members.length;
    tag.members = tag.members.filter((member: FakeTagMember): boolean => {
      return member.id !== memberId;
    });

    if (tag.members.length === before) {
      return this.notFound();
    }

    if (tag.members.length === 0 && this.deletesEmptyTags) {
      tags.delete(tag.id);
    }

    return new HTTPResponse<JSONObject>(204, {}, {});
  }

  public paths(method: string): Array<string> {
    return this.requests
      .filter((request: GraphRequest): boolean => {
        return request.method === method;
      })
      .map((request: GraphRequest): string => {
        return request.path;
      });
  }

  private tagJson(teamId: string, tag: FakeTag): JSONObject {
    return {
      id: tag.id,
      teamId: teamId,
      displayName: tag.displayName,
      memberCount: tag.members.length,
      tagType: "standard",
    };
  }

  private ok(body: JSONObject): HTTPResponse<JSONObject> {
    return new HTTPResponse<JSONObject>(200, body, {});
  }

  private notFound(): HTTPErrorResponse {
    return new HTTPErrorResponse(
      404,
      { error: { code: "NotFound", message: "Not found." } },
      {},
    );
  }
}

// ---- OneUptime's side, in memory ----

export default class UserGroupsWorld {
  public people: Map<string, WorldPerson> = new Map<string, WorldPerson>();
  public schedules: Map<string, WorldSchedule> = new Map<
    string,
    WorldSchedule
  >();
  public groups: Map<string, WorldGroupRow> = new Map<string, WorldGroupRow>();
  // userId -> workspace -> the account they connected.
  public connections: Array<{
    userId: ObjectID;
    workspaceType: WorkspaceType;
    workspaceUserId: string;
  }> = [];
  public isSlackConnected: boolean = true;
  public isTeamsConnected: boolean = true;
  // Valkey cannot be reached: the lock throws.
  public isLockUnavailable: boolean = false;
  public slack: FakeSlack = new FakeSlack();
  public graph: FakeGraph = new FakeGraph();
  // Teams the app is not installed in: no roster.
  public teamsWithoutApp: Set<string> = new Set<string>();
  public errors: Array<string> = [];
  public clockOffsetInMinutes: number = 0;

  private nextId: number = 1;

  public now(): Date {
    return OneUptimeDate.addRemoveMinutes(
      new Date(START),
      this.clockOffsetInMinutes,
    );
  }

  public minutesPass(minutes: number): void {
    this.clockOffsetInMinutes += minutes;
  }

  public addPerson(name: string, email: string): WorldPerson {
    const person: WorldPerson = {
      id: this.newId(),
      name: name,
      email: email,
    };
    this.people.set(person.id.toString(), person);
    return person;
  }

  public connect(
    person: WorldPerson,
    workspaceType: WorkspaceType,
    workspaceUserId: string,
  ): void {
    this.connections.push({
      userId: person.id,
      workspaceType: workspaceType,
      workspaceUserId: workspaceUserId,
    });
  }

  public addSchedule(name: string, onCall: WorldPerson | null): WorldSchedule {
    const schedule: WorldSchedule = {
      id: this.newId(),
      name: name,
      onCall: onCall ? onCall.id : null,
    };
    this.schedules.set(schedule.id.toString(), schedule);
    return schedule;
  }

  // A hand-off: somebody else on call in the schedule (or nobody).
  public handOff(schedule: WorldSchedule, onCall: WorldPerson | null): void {
    schedule.onCall = onCall ? onCall.id : null;
  }

  public addGroup(data: {
    workspaceType: WorkspaceType;
    workspaceGroupId: string;
    schedules: Array<WorldSchedule>;
    name?: string | undefined;
    handle?: string | null | undefined;
    workspaceTeamId?: string | undefined;
    syncState?: WorkspaceUserGroupSyncState | undefined;
  }): WorldGroupRow {
    const row: WorldGroupRow = {
      id: this.newId(),
      projectId: PROJECT_ID,
      workspaceType: data.workspaceType,
      workspaceGroupId: data.workspaceGroupId,
      workspaceTeamId: data.workspaceTeamId || null,
      name: data.name || "",
      handle: data.handle === undefined ? null : data.handle,
      scheduleIds: data.schedules.map((schedule: WorldSchedule): string => {
        return schedule.id.toString();
      }),
      syncState: data.syncState || null,
      syncedAt: null,
      nextSyncAt: null,
    };
    this.groups.set(row.id.toString(), row);
    return row;
  }

  public state(row: WorldGroupRow): WorkspaceUserGroupSyncState {
    const state: WorkspaceUserGroupSyncState | null =
      readWorkspaceUserGroupSyncState(this.groups.get(row.id.toString())?.syncState);

    if (!state) {
      throw new Error("The group was never synced.");
    }

    return state;
  }

  public async sync(row: WorldGroupRow): Promise<WorkspaceUserGroupSyncState> {
    await WorkspaceUserGroupSync.requestSync([row.id]);
    return this.state(row);
  }

  public install(): void {
    WorkspaceUserGroupSync.reset();

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
      return this.now();
    });

    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("OneUptime");

    jest.spyOn(logger, "error").mockImplementation(((line: unknown) => {
      this.errors.push(String(line));
    }) as never);
    jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);

    jest.spyOn(Semaphore, "lock").mockImplementation((async () => {
      if (this.isLockUnavailable) {
        throw new Error("Valkey is not reachable.");
      }

      return { release: async (): Promise<void> => {} };
    }) as never);
    jest.spyOn(Semaphore, "release").mockImplementation((async () => {
      return;
    }) as never);

    jest
      .spyOn(WorkspaceUserGroupService, "findOneById")
      .mockImplementation((async (options: { id: ObjectID }) => {
        const row: WorldGroupRow | undefined = this.groups.get(
          options.id.toString(),
        );
        return row ? this.toModel(row) : null;
      }) as never);

    jest
      .spyOn(WorkspaceUserGroupService, "findBy")
      .mockImplementation((async () => {
        // The worker job's round: the groups whose next look is due.
        return Array.from(this.groups.values())
          .filter((row: WorldGroupRow): boolean => {
            return (
              !row.nextSyncAt ||
              row.nextSyncAt.getTime() <= this.now().getTime()
            );
          })
          .sort((a: WorldGroupRow, b: WorldGroupRow): number => {
            return (
              (a.nextSyncAt?.getTime() || 0) - (b.nextSyncAt?.getTime() || 0)
            );
          })
          .map((row: WorldGroupRow): WorkspaceUserGroup => {
            return this.toModel(row);
          });
      }) as never);

    jest
      .spyOn(WorkspaceUserGroupService, "findIdsFollowingSchedules")
      .mockImplementation((async (scheduleIds: Array<ObjectID>) => {
        const wanted: Set<string> = new Set<string>(
          scheduleIds.map((id: ObjectID): string => {
            return id.toString();
          }),
        );

        return Array.from(this.groups.values())
          .filter((row: WorldGroupRow): boolean => {
            return row.scheduleIds.some((id: string): boolean => {
              return wanted.has(id);
            });
          })
          .map((row: WorldGroupRow): ObjectID => {
            return row.id;
          });
      }) as never);

    jest
      .spyOn(WorkspaceUserGroupService, "updateOneById")
      .mockImplementation((async (options: {
        id: ObjectID;
        data: Record<string, unknown>;
      }) => {
        const row: WorldGroupRow | undefined = this.groups.get(
          options.id.toString(),
        );

        if (!row) {
          return;
        }

        const data: Record<string, unknown> = options.data;

        if (data["syncState"] !== undefined) {
          row.syncState = JSON.parse(
            JSON.stringify(data["syncState"]),
          ) as WorkspaceUserGroupSyncState;
        }

        if (data["syncedAt"] !== undefined) {
          row.syncedAt = data["syncedAt"] as Date;
        }

        if (data["nextSyncAt"] !== undefined) {
          row.nextSyncAt = data["nextSyncAt"] as Date;
        }

        if (data["name"] !== undefined) {
          row.name = data["name"] as string;
        }

        if (data["handle"] !== undefined) {
          row.handle = data["handle"] as string | null;
        }

        if (data["workspaceGroupId"] !== undefined) {
          row.workspaceGroupId = data["workspaceGroupId"] as string;
        }
      }) as never);

    jest
      .spyOn(WorkspaceUserGroupService, "deleteOneById")
      .mockImplementation((async (options: { id: ObjectID }) => {
        this.groups.delete(options.id.toString());
        return 1;
      }) as never);

    jest.spyOn(UserService, "findBy").mockImplementation((async () => {
      return Array.from(this.people.values()).map(
        (person: WorldPerson): User => {
          const user: User = new User();
          user.id = person.id;
          user.name = person.name as never;
          user.email = person.email as never;
          return user;
        },
      );
    }) as never);

    jest
      .spyOn(WorkspaceUserAuthTokenService, "findBy")
      .mockImplementation((async (options: {
        query: { workspaceType: WorkspaceType };
      }) => {
        return this.connections
          .filter(
            (connection: {
              workspaceType: WorkspaceType;
            }): boolean => {
              return connection.workspaceType === options.query.workspaceType;
            },
          )
          .map(
            (connection: {
              userId: ObjectID;
              workspaceUserId: string;
            }): WorkspaceUserAuthToken => {
              const token: WorkspaceUserAuthToken =
                new WorkspaceUserAuthToken();
              token.userId = connection.userId;
              token.workspaceUserId = connection.workspaceUserId;
              return token;
            },
          );
      }) as never);

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockImplementation((async (options: { workspaceType: WorkspaceType }) => {
        const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
        auth.projectId = PROJECT_ID;

        if (options.workspaceType === WorkspaceType.Slack) {
          if (!this.isSlackConnected) {
            return null;
          }

          auth.workspaceType = WorkspaceType.Slack;
          auth.authToken = SLACK_TOKEN;
          auth.workspaceProjectId = SLACK_TEAM_ID;
          auth.miscData = {
            teamId: SLACK_TEAM_ID,
            teamName: "Acme",
            botUserId: "U0BOT",
          } as never;
          return auth;
        }

        if (!this.isTeamsConnected) {
          return null;
        }

        auth.workspaceType = WorkspaceType.MicrosoftTeams;
        auth.authToken = GRAPH_TOKEN;
        auth.workspaceProjectId = TENANT_ID;
        auth.miscData = {
          tenantId: TENANT_ID,
          teamId: "",
          teamName: "",
          botId: "bot",
          installedTeams: Object.fromEntries(
            Array.from(this.graph.teams.keys())
              .filter((teamId: string): boolean => {
                return !this.teamsWithoutApp.has(teamId);
              })
              .map((teamId: string) => {
                return [
                  `19:${teamId}@thread.tacv2`,
                  {
                    id: `19:${teamId}@thread.tacv2`,
                    graphTeamId: teamId,
                    teamsThreadId: `19:${teamId}@thread.tacv2`,
                    name: teamId === TEAM_PAYMENTS ? "Payments" : "Another team",
                  },
                ];
              }),
          ),
        } as never;
        return auth;
      }) as never);

    // Slack's Web API.
    jest.spyOn(API, "post").mockImplementation((async (options: {
      url: URL;
      data: JSONObject;
      headers?: Record<string, string> | undefined;
    }) => {
      const url: string = options.url.toString();

      if (url.startsWith("https://slack.com/api/")) {
        return await this.slack.answer(
          url.substring("https://slack.com/api/".length),
          options.data || {},
          options.headers,
        );
      }

      if (url.startsWith("https://graph.microsoft.com/")) {
        return this.graph.answer("POST", url, options.data || {});
      }

      throw new Error(`Unexpected POST ${url}`);
    }) as never);

    // Microsoft Graph.
    jest.spyOn(API, "get").mockImplementation((async (options: { url: URL }) => {
      const url: string = options.url.toString();

      if (url.startsWith("https://graph.microsoft.com/")) {
        return this.graph.answer("GET", url, null);
      }

      throw new Error(`Unexpected GET ${url}`);
    }) as never);

    jest.spyOn(API, "delete").mockImplementation((async (options: {
      url: URL;
    }) => {
      const url: string = options.url.toString();

      if (url.startsWith("https://graph.microsoft.com/")) {
        return this.graph.answer("DELETE", url, null);
      }

      throw new Error(`Unexpected DELETE ${url}`);
    }) as never);

    jest
      .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
      .mockImplementation((async () => {
        if (!this.isTeamsConnected) {
          throw new Error("Microsoft Teams integration not found");
        }

        return GRAPH_TOKEN;
      }) as never);

    jest
      .spyOn(MicrosoftTeamsUtil, "getTeamRoster")
      .mockImplementation((async (options: { teamId: string }) => {
        if (this.teamsWithoutApp.has(options.teamId)) {
          return null;
        }

        return this.graph.rosters.get(options.teamId) || null;
      }) as never);
  }

  private toModel(row: WorldGroupRow): WorkspaceUserGroup {
    const model: WorkspaceUserGroup = new WorkspaceUserGroup();
    model.id = row.id;
    model.projectId = row.projectId;
    model.workspaceType = row.workspaceType;
    model.workspaceGroupId = row.workspaceGroupId;

    if (row.workspaceTeamId) {
      model.workspaceTeamId = row.workspaceTeamId;
    }

    model.name = row.name;

    if (row.handle) {
      model.handle = row.handle;
    }

    if (row.syncState) {
      model.syncState = JSON.parse(
        JSON.stringify(row.syncState),
      ) as WorkspaceUserGroupSyncState;
    }

    if (row.syncedAt) {
      model.syncedAt = row.syncedAt;
    }

    if (row.nextSyncAt) {
      model.nextSyncAt = row.nextSyncAt;
    }

    model.onCallDutyPolicySchedules = row.scheduleIds
      .map((id: string): WorldSchedule | undefined => {
        return this.schedules.get(id);
      })
      .filter((schedule: WorldSchedule | undefined): boolean => {
        return Boolean(schedule);
      })
      .map((schedule: WorldSchedule | undefined): OnCallDutyPolicySchedule => {
        const model: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
        model.id = schedule!.id;
        model.name = schedule!.name;

        if (schedule!.onCall) {
          model.currentUserIdOnRoster = schedule!.onCall;
        }

        return model;
      });

    return model;
  }

  private newId(): ObjectID {
    const id: string = String(this.nextId++).padStart(12, "0");
    return new ObjectID(`c0000000-0000-4000-8000-${id}`);
  }
}

// Waits, a turn of the event loop at a time, until `isDone` holds.
export async function until(
  isDone: () => boolean,
  turns: number = 1000,
): Promise<void> {
  for (let turn: number = 0; turn < turns; turn++) {
    if (isDone()) {
      return;
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }

  throw new Error("Waited too long.");
}
