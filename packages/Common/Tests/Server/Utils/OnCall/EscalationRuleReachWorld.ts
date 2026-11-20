import OnCallDutyPolicyEscalationRuleSchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyTimeLogService from "../../../../Server/Services/OnCallDutyPolicyTimeLogService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import ProjectMembership, {
  ProjectUserPair,
} from "../../../../Server/Utils/TeamMember/ProjectMembership";
import ObjectID from "../../../../Types/ObjectID";
import { jest } from "@jest/globals";

/*
 * AN ESCALATION RULE, IN MEMORY: its people, teams and schedules (a row
 * each, with when it was made), who is in each team and whether they
 * accepted, who is on call in each schedule and next in its rotation. The
 * reads EscalationRuleReach makes - and the time logs the services and it
 * write - are answered from here, so a test adds and removes rows, calls a
 * service's hooks, and reads who was told and logged.
 */

export const PROJECT_ID: ObjectID = new ObjectID(
  "10464000-0000-4000-8000-000000000001",
);
export const POLICY_ID: ObjectID = new ObjectID(
  "10464000-0000-4000-8000-0000000000d1",
);
export const RULE_ID: ObjectID = new ObjectID(
  "10464000-0000-4000-8000-0000000000e1",
);
export const OTHER_RULE_ID: ObjectID = new ObjectID(
  "10464000-0000-4000-8000-0000000000e2",
);

export const ANA: ObjectID = new ObjectID(
  "10464000-0000-4000-8000-0000000000a1",
);
export const BO: ObjectID = new ObjectID(
  "10464000-0000-4000-8000-0000000000a2",
);
export const CY: ObjectID = new ObjectID(
  "10464000-0000-4000-8000-0000000000a3",
);
// Invited to the project, and not joined yet.
export const IVY: ObjectID = new ObjectID(
  "10464000-0000-4000-8000-0000000000a4",
);

export const PLATFORM: ObjectID = new ObjectID(
  "10464000-0000-4000-8000-0000000000b1",
);
export const PAYMENTS_TEAM: ObjectID = new ObjectID(
  "10464000-0000-4000-8000-0000000000b2",
);

export const PRIMARY: ObjectID = new ObjectID(
  "10464000-0000-4000-8000-0000000000c1",
);
export const SECONDARY: ObjectID = new ObjectID(
  "10464000-0000-4000-8000-0000000000c2",
);

interface WorldRow {
  id: ObjectID;
  ruleId: ObjectID;
  createdAt: Date;
}

export interface WorldUserRow extends WorldRow {
  userId: ObjectID;
}

export interface WorldTeamRow extends WorldRow {
  teamId: ObjectID;
}

export interface WorldScheduleRow extends WorldRow {
  scheduleId: ObjectID;
  pageNextInRotation: boolean;
}

export interface WorldMembership {
  userId: ObjectID;
  teamId: ObjectID;
  accepted: boolean;
}

// One time log written: started or ended, for whom, through what.
export interface TimeLogWrite {
  action: "start" | "end";
  userId: string;
  ruleId: string;
  teamId: string | null;
  scheduleId: string | null;
}

type AnyFunction = (...args: Array<any>) => any;

// The values a QueryHelper.any (a Raw IN) holds, or the value itself.
export function readQueryValues(value: unknown): Array<string> | null {
  if (value === undefined || value === null) {
    return null;
  }

  const parameters: unknown = (value as { objectLiteralParameters?: unknown })
    .objectLiteralParameters;

  if (parameters && typeof parameters === "object") {
    for (const each of Object.values(parameters as Record<string, unknown>)) {
      if (Array.isArray(each)) {
        return each.map((item: unknown): string => {
          return String(item).toLowerCase();
        });
      }
    }
  }

  return [String(value).toLowerCase()];
}

const same: (left: unknown, right: unknown) => boolean = (
  left: unknown,
  right: unknown,
): boolean => {
  return String(left).toLowerCase() === String(right).toLowerCase();
};

let clock: number = Date.parse("2026-11-20T09:00:00.000Z");

// A row id and a moment after every one before it.
export function nextRowAt(): { id: ObjectID; createdAt: Date } {
  clock += 60_000;
  return { id: ObjectID.generate(), createdAt: new Date(clock) };
}

export default class ReachWorld {
  public userRows: Array<WorldUserRow> = [];
  public teamRows: Array<WorldTeamRow> = [];
  public scheduleRows: Array<WorldScheduleRow> = [];
  public memberships: Array<WorldMembership> = [];
  // Who is on call in each schedule now, and next in its rotation.
  public onCall: Map<string, ObjectID | null> = new Map();
  public next: Map<string, ObjectID | null> = new Map();
  public timeLogs: Array<TimeLogWrite> = [];
  // Set to make every read of the rule's rows fail.
  public failReads: boolean = false;

  public addMember(
    userId: ObjectID,
    teamId: ObjectID,
    accepted: boolean,
  ): void {
    this.memberships.push({ userId, teamId, accepted });
  }

  public namePerson(
    userId: ObjectID,
    ruleId: ObjectID = RULE_ID,
  ): WorldUserRow {
    const row: WorldUserRow = { ...nextRowAt(), ruleId, userId };
    this.userRows.push(row);
    return row;
  }

  public nameTeam(teamId: ObjectID, ruleId: ObjectID = RULE_ID): WorldTeamRow {
    const row: WorldTeamRow = { ...nextRowAt(), ruleId, teamId };
    this.teamRows.push(row);
    return row;
  }

  public nameSchedule(
    scheduleId: ObjectID,
    options?: { pageNextInRotation?: boolean; ruleId?: ObjectID },
  ): WorldScheduleRow {
    const row: WorldScheduleRow = {
      ...nextRowAt(),
      ruleId: options?.ruleId || RULE_ID,
      scheduleId,
      pageNextInRotation: Boolean(options?.pageNextInRotation),
    };
    this.scheduleRows.push(row);
    return row;
  }

  public remove(row: WorldRow): void {
    const isNot: (each: WorldRow) => boolean = (each: WorldRow): boolean => {
      return !same(each.id, row.id);
    };

    this.userRows = this.userRows.filter(isNot) as Array<WorldUserRow>;
    this.teamRows = this.teamRows.filter(isNot) as Array<WorldTeamRow>;
    this.scheduleRows = this.scheduleRows.filter(
      isNot,
    ) as Array<WorldScheduleRow>;
  }

  // Whether `userId` holds an accepted membership of the project.
  public isMember(userId: ObjectID | string): boolean {
    return this.memberships.some((membership: WorldMembership): boolean => {
      return membership.accepted && same(membership.userId, userId);
    });
  }

  // The time logs written for `userId`, as "start Team b1" and the like.
  public logsOf(userId: ObjectID): Array<string> {
    return this.timeLogs
      .filter((log: TimeLogWrite): boolean => {
        return same(log.userId, userId);
      })
      .map((log: TimeLogWrite): string => {
        const through: string = log.teamId
          ? `team ${log.teamId}`
          : log.scheduleId
            ? `schedule ${log.scheduleId}`
            : "named";
        return `${log.action} ${through}`;
      });
  }

  // Answers every read EscalationRuleReach and the services' hooks make here.
  public install(): void {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy" as never)
      .mockImplementation((async (args: {
        query: Record<string, unknown>;
      }): Promise<Array<OnCallDutyPolicyEscalationRuleUser>> => {
        this.throwIfFailing();
        const ruleIds: Array<string> | null = readQueryValues(
          args.query["onCallDutyPolicyEscalationRuleId"],
        );
        const userIds: Array<string> | null = readQueryValues(
          args.query["userId"],
        );

        return this.userRows
          .filter((row: WorldUserRow): boolean => {
            return (
              (!ruleIds || ruleIds.includes(row.ruleId.toString())) &&
              (!userIds || userIds.includes(row.userId.toString()))
            );
          })
          .map((row: WorldUserRow): OnCallDutyPolicyEscalationRuleUser => {
            const model: OnCallDutyPolicyEscalationRuleUser =
              new OnCallDutyPolicyEscalationRuleUser();
            model._id = row.id.toString();
            model.userId = row.userId;
            model.createdAt = row.createdAt;
            model.projectId = PROJECT_ID;
            model.onCallDutyPolicyId = POLICY_ID;
            model.onCallDutyPolicyEscalationRuleId = row.ruleId;
            return model;
          });
      }) as AnyFunction);

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy" as never)
      .mockImplementation((async (args: {
        query: Record<string, unknown>;
      }): Promise<Array<OnCallDutyPolicyEscalationRuleTeam>> => {
        this.throwIfFailing();
        const ruleIds: Array<string> | null = readQueryValues(
          args.query["onCallDutyPolicyEscalationRuleId"],
        );
        const teamIds: Array<string> | null = readQueryValues(
          args.query["teamId"],
        );

        return this.teamRows
          .filter((row: WorldTeamRow): boolean => {
            return (
              (!ruleIds || ruleIds.includes(row.ruleId.toString())) &&
              (!teamIds || teamIds.includes(row.teamId.toString()))
            );
          })
          .map((row: WorldTeamRow): OnCallDutyPolicyEscalationRuleTeam => {
            const model: OnCallDutyPolicyEscalationRuleTeam =
              new OnCallDutyPolicyEscalationRuleTeam();
            model._id = row.id.toString();
            model.teamId = row.teamId;
            model.createdAt = row.createdAt;
            model.projectId = PROJECT_ID;
            model.onCallDutyPolicyId = POLICY_ID;
            model.onCallDutyPolicyEscalationRuleId = row.ruleId;
            return model;
          });
      }) as AnyFunction);

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy" as never)
      .mockImplementation((async (args: {
        query: Record<string, unknown>;
      }): Promise<Array<OnCallDutyPolicyEscalationRuleSchedule>> => {
        this.throwIfFailing();
        const ruleIds: Array<string> | null = readQueryValues(
          args.query["onCallDutyPolicyEscalationRuleId"],
        );

        return this.scheduleRows
          .filter((row: WorldScheduleRow): boolean => {
            return !ruleIds || ruleIds.includes(row.ruleId.toString());
          })
          .map(
            (row: WorldScheduleRow): OnCallDutyPolicyEscalationRuleSchedule => {
              const model: OnCallDutyPolicyEscalationRuleSchedule =
                new OnCallDutyPolicyEscalationRuleSchedule();
              model._id = row.id.toString();
              model.onCallDutyPolicyScheduleId = row.scheduleId;
              model.pageNextInRotation = row.pageNextInRotation;
              model.createdAt = row.createdAt;
              model.projectId = PROJECT_ID;
              model.onCallDutyPolicyId = POLICY_ID;
              model.onCallDutyPolicyEscalationRuleId = row.ruleId;
              return model;
            },
          );
      }) as AnyFunction);

    jest
      .spyOn(TeamMemberService, "findBy" as never)
      .mockImplementation((async (args: {
        query: Record<string, unknown>;
      }): Promise<Array<TeamMember>> => {
        const teamIds: Array<string> | null = readQueryValues(
          args.query["teamId"],
        );
        const userIds: Array<string> | null = readQueryValues(
          args.query["userId"],
        );
        const acceptedOnly: boolean =
          args.query["hasAcceptedInvitation"] === true;

        return this.memberships
          .filter((membership: WorldMembership): boolean => {
            return (
              (!teamIds || teamIds.includes(membership.teamId.toString())) &&
              (!userIds || userIds.includes(membership.userId.toString())) &&
              (!acceptedOnly || membership.accepted)
            );
          })
          .map((membership: WorldMembership): TeamMember => {
            const model: TeamMember = new TeamMember();
            model.userId = membership.userId;
            model.teamId = membership.teamId;
            model.projectId = PROJECT_ID;
            model.hasAcceptedInvitation = membership.accepted;
            return model;
          });
      }) as AnyFunction);

    const usersIn: (
      teamIds: Array<ObjectID>,
      acceptedOnly: boolean,
    ) => Array<User> = (
      teamIds: Array<ObjectID>,
      acceptedOnly: boolean,
    ): Array<User> => {
      const seen: Set<string> = new Set<string>();

      return this.memberships
        .filter((membership: WorldMembership): boolean => {
          return (
            teamIds.some((teamId: ObjectID): boolean => {
              return same(teamId, membership.teamId);
            }) &&
            (!acceptedOnly || membership.accepted)
          );
        })
        .filter((membership: WorldMembership): boolean => {
          const key: string = membership.userId.toString();

          if (seen.has(key)) {
            return false;
          }

          seen.add(key);
          return true;
        })
        .map((membership: WorldMembership): User => {
          const user: User = new User();
          user._id = membership.userId.toString();
          return user;
        });
    };

    jest.spyOn(TeamMemberService, "getUsersInTeam").mockImplementation((async (
      teamId: ObjectID,
    ): Promise<Array<User>> => {
      return usersIn([teamId], false);
    }) as AnyFunction);

    jest.spyOn(TeamMemberService, "getUsersInTeams").mockImplementation((async (
      teamIds: Array<ObjectID>,
      options?: { acceptedOnly?: boolean },
    ): Promise<Array<User>> => {
      return usersIn(teamIds, Boolean(options?.acceptedOnly));
    }) as AnyFunction);

    jest
      .spyOn(ProjectMembership, "getMemberUserIds")
      .mockImplementation((async (data: {
        userIds: Array<ObjectID | string>;
      }): Promise<Set<string>> => {
        return new Set<string>(
          data.userIds
            .filter((userId: ObjectID | string): boolean => {
              return this.isMember(userId);
            })
            .map((userId: ObjectID | string): string => {
              return userId.toString().toLowerCase();
            }),
        );
      }) as AnyFunction);

    jest.spyOn(ProjectMembership, "getMemberKeys").mockImplementation((async (
      pairs: Array<ProjectUserPair>,
    ): Promise<Set<string>> => {
      return new Set<string>(
        pairs
          .filter((pair: ProjectUserPair): boolean => {
            return this.isMember(pair.userId);
          })
          .map((pair: ProjectUserPair): string => {
            return ProjectMembership.getKey(pair.projectId, pair.userId);
          }),
      );
    }) as AnyFunction);

    jest
      .spyOn(OnCallDutyPolicyScheduleService, "getCurrentUserIdInSchedule")
      .mockImplementation((async (
        scheduleId: ObjectID,
      ): Promise<ObjectID | null> => {
        return this.onCall.get(scheduleId.toString()) || null;
      }) as AnyFunction);

    jest
      .spyOn(OnCallDutyPolicyScheduleService, "getNextInRotationInSchedule")
      .mockImplementation((async (scheduleId: ObjectID) => {
        const onCallUserId: ObjectID | null | undefined = this.onCall.get(
          scheduleId.toString(),
        );

        if (!onCallUserId) {
          return null;
        }

        return {
          onCallUserId: onCallUserId,
          nextUserId: this.next.get(scheduleId.toString()) || null,
          layerName: null,
        };
      }) as AnyFunction);

    const record: (
      action: "start" | "end",
      data: {
        userId: ObjectID;
        onCallDutyPolicyEscalationRuleId: ObjectID;
        teamId?: ObjectID | undefined;
        onCallDutyPolicyScheduleId?: ObjectID | undefined;
      },
    ) => void = (
      action: "start" | "end",
      data: {
        userId: ObjectID;
        onCallDutyPolicyEscalationRuleId: ObjectID;
        teamId?: ObjectID | undefined;
        onCallDutyPolicyScheduleId?: ObjectID | undefined;
      },
    ): void => {
      this.timeLogs.push({
        action: action,
        userId: data.userId.toString(),
        ruleId: data.onCallDutyPolicyEscalationRuleId.toString(),
        teamId: data.teamId?.toString() || null,
        scheduleId: data.onCallDutyPolicyScheduleId?.toString() || null,
      });
    };

    jest
      .spyOn(OnCallDutyPolicyTimeLogService, "startTimeLogForUser")
      .mockImplementation((async (data: never) => {
        record("start", data);
        return {};
      }) as AnyFunction);

    jest
      .spyOn(OnCallDutyPolicyTimeLogService, "endTimeLogForUser")
      .mockImplementation((async (data: never) => {
        record("end", data);
      }) as AnyFunction);
  }

  private throwIfFailing(): void {
    if (this.failReads) {
      throw new Error("The database could not be reached.");
    }
  }
}
