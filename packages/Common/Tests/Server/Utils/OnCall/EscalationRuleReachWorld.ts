import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyTimeLogService from "../../../../Server/Services/OnCallDutyPolicyTimeLogService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../Server/Services/TeamService";
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
 *
 * Rules belong to a policy (Payments, unless describeRule puts one in
 * another), and every row is its rule's policy's. Each membership has an id
 * and the moment it was made; each schedule a roster as its hand-offs keep
 * it (currentUserIdOnRoster: whoever is on call in it, unless `roster` says
 * otherwise); and policies, rules, teams and schedules have names, for the
 * reads that say who was told of what.
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
// A second policy, and a rule of it.
export const OTHER_POLICY_ID: ObjectID = new ObjectID(
  "10464000-0000-4000-8000-0000000000d2",
);
export const OTHER_POLICY_RULE_ID: ObjectID = new ObjectID(
  "10464000-0000-4000-8000-0000000000e3",
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
  // The policy of the row's rule.
  policyId: ObjectID;
  createdAt: Date;
}

// A rule, as describeRule puts it: its policy, name and order.
export interface WorldRule {
  policyId: ObjectID;
  name: string;
  order: number;
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
  id: ObjectID;
  createdAt: Date;
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
  /*
   * Who each schedule's roster has on call (currentUserIdOnRoster), where
   * it is not who is on call now: a hand-off not stored yet.
   */
  public roster: Map<string, ObjectID | null> = new Map();
  public timeLogs: Array<TimeLogWrite> = [];
  // Set to make every read of the rule's rows fail.
  public failReads: boolean = false;

  public rules: Map<string, WorldRule> = new Map<string, WorldRule>([
    [
      RULE_ID.toString().toLowerCase(),
      { policyId: POLICY_ID, name: "Level 1", order: 1 },
    ],
    [
      OTHER_RULE_ID.toString().toLowerCase(),
      { policyId: POLICY_ID, name: "Level 2", order: 2 },
    ],
    [
      OTHER_POLICY_RULE_ID.toString().toLowerCase(),
      { policyId: OTHER_POLICY_ID, name: "First line", order: 1 },
    ],
  ]);

  public names: Map<string, string> = new Map<string, string>([
    [POLICY_ID.toString().toLowerCase(), "Payments"],
    [OTHER_POLICY_ID.toString().toLowerCase(), "Checkout"],
    [PLATFORM.toString().toLowerCase(), "Platform"],
    [PAYMENTS_TEAM.toString().toLowerCase(), "Payments team"],
    [PRIMARY.toString().toLowerCase(), "Primary"],
    [SECONDARY.toString().toLowerCase(), "Secondary"],
  ]);

  // A rule of a policy, by name and order; a rule never described is Payments'.
  public describeRule(ruleId: ObjectID, rule: WorldRule): void {
    this.rules.set(ruleId.toString().toLowerCase(), rule);
  }

  public ruleOf(ruleId: ObjectID): WorldRule {
    return (
      this.rules.get(ruleId.toString().toLowerCase()) || {
        policyId: POLICY_ID,
        name: "",
        order: 1,
      }
    );
  }

  // What a policy, team or schedule is called.
  public nameOf(id: ObjectID): string {
    return this.names.get(id.toString().toLowerCase()) || "";
  }

  // Who a schedule's roster has on call, as its hand-offs stored it.
  public rosterOf(scheduleId: ObjectID | string): ObjectID | null {
    const key: string = scheduleId.toString();

    return this.roster.has(key)
      ? this.roster.get(key) || null
      : this.onCall.get(key) || null;
  }

  public addMember(
    userId: ObjectID,
    teamId: ObjectID,
    accepted: boolean,
  ): WorldMembership {
    const membership: WorldMembership = {
      ...nextRowAt(),
      userId,
      teamId,
      accepted,
    };
    this.memberships.push(membership);
    return membership;
  }

  // Every invitation of theirs accepted, as accepting one accepts them all.
  public accept(userId: ObjectID): void {
    for (const membership of this.memberships) {
      if (same(membership.userId, userId)) {
        membership.accepted = true;
      }
    }
  }

  public namePerson(
    userId: ObjectID,
    ruleId: ObjectID = RULE_ID,
  ): WorldUserRow {
    const row: WorldUserRow = {
      ...nextRowAt(),
      ruleId,
      policyId: this.ruleOf(ruleId).policyId,
      userId,
    };
    this.userRows.push(row);
    return row;
  }

  public nameTeam(teamId: ObjectID, ruleId: ObjectID = RULE_ID): WorldTeamRow {
    const row: WorldTeamRow = {
      ...nextRowAt(),
      ruleId,
      policyId: this.ruleOf(ruleId).policyId,
      teamId,
    };
    this.teamRows.push(row);
    return row;
  }

  public nameSchedule(
    scheduleId: ObjectID,
    options?: { pageNextInRotation?: boolean; ruleId?: ObjectID },
  ): WorldScheduleRow {
    const ruleId: ObjectID = options?.ruleId || RULE_ID;
    const row: WorldScheduleRow = {
      ...nextRowAt(),
      ruleId: ruleId,
      policyId: this.ruleOf(ruleId).policyId,
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
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
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
        const policyIds: Array<string> | null = readQueryValues(
          args.query["onCallDutyPolicyId"],
        );

        return this.userRows
          .filter((row: WorldUserRow): boolean => {
            return (
              (!ruleIds || ruleIds.includes(row.ruleId.toString())) &&
              (!userIds || userIds.includes(row.userId.toString())) &&
              (!policyIds || policyIds.includes(row.policyId.toString()))
            );
          })
          .map((row: WorldUserRow): OnCallDutyPolicyEscalationRuleUser => {
            const model: OnCallDutyPolicyEscalationRuleUser =
              new OnCallDutyPolicyEscalationRuleUser();
            model._id = row.id.toString();
            model.userId = row.userId;
            model.createdAt = row.createdAt;
            model.projectId = PROJECT_ID;
            model.onCallDutyPolicyId = row.policyId;
            model.onCallDutyPolicyEscalationRuleId = row.ruleId;
            return model;
          });
      }) as never);

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
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
        const policyIds: Array<string> | null = readQueryValues(
          args.query["onCallDutyPolicyId"],
        );

        return this.teamRows
          .filter((row: WorldTeamRow): boolean => {
            return (
              (!ruleIds || ruleIds.includes(row.ruleId.toString())) &&
              (!teamIds || teamIds.includes(row.teamId.toString())) &&
              (!policyIds || policyIds.includes(row.policyId.toString()))
            );
          })
          .map((row: WorldTeamRow): OnCallDutyPolicyEscalationRuleTeam => {
            const model: OnCallDutyPolicyEscalationRuleTeam =
              new OnCallDutyPolicyEscalationRuleTeam();
            model._id = row.id.toString();
            model.teamId = row.teamId;
            model.createdAt = row.createdAt;
            model.projectId = PROJECT_ID;
            model.onCallDutyPolicyId = row.policyId;
            model.onCallDutyPolicyEscalationRuleId = row.ruleId;
            return model;
          });
      }) as never);

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
      .mockImplementation((async (args: {
        query: Record<string, unknown>;
      }): Promise<Array<OnCallDutyPolicyEscalationRuleSchedule>> => {
        this.throwIfFailing();
        const ruleIds: Array<string> | null = readQueryValues(
          args.query["onCallDutyPolicyEscalationRuleId"],
        );
        const policyIds: Array<string> | null = readQueryValues(
          args.query["onCallDutyPolicyId"],
        );
        const scheduleIds: Array<string> | null = readQueryValues(
          args.query["onCallDutyPolicyScheduleId"],
        );

        return this.scheduleRows
          .filter((row: WorldScheduleRow): boolean => {
            return (
              (!ruleIds || ruleIds.includes(row.ruleId.toString())) &&
              (!policyIds || policyIds.includes(row.policyId.toString())) &&
              (!scheduleIds || scheduleIds.includes(row.scheduleId.toString()))
            );
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
              model.onCallDutyPolicyId = row.policyId;
              model.onCallDutyPolicyEscalationRuleId = row.ruleId;

              // With its policy, rule and schedule, as a hand-off reads them.
              model.onCallDutyPolicy = this.policyModel(row.policyId);
              model.onCallDutyPolicyEscalationRule = this.ruleModel(row.ruleId);

              const schedule: OnCallDutyPolicySchedule =
                new OnCallDutyPolicySchedule();
              schedule._id = row.scheduleId.toString();
              schedule.name = this.nameOf(row.scheduleId);
              model.onCallDutyPolicySchedule = schedule;
              return model;
            },
          );
      }) as never);

    jest
      .spyOn(TeamMemberService, "findBy")
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
            model._id = membership.id.toString();
            model.createdAt = membership.createdAt;
            model.userId = membership.userId;
            model.teamId = membership.teamId;
            model.projectId = PROJECT_ID;
            model.hasAcceptedInvitation = membership.accepted;
            return model;
          });
      }) as never);

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
    }) as never);

    jest.spyOn(TeamMemberService, "getUsersInTeams").mockImplementation((async (
      teamIds: Array<ObjectID>,
      options?: { acceptedOnly?: boolean },
    ): Promise<Array<User>> => {
      return usersIn(teamIds, Boolean(options?.acceptedOnly));
    }) as never);

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
      }) as never);

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
    }) as never);

    jest
      .spyOn(OnCallDutyPolicyScheduleService, "getCurrentUserIdInSchedule")
      .mockImplementation((async (
        scheduleId: ObjectID,
      ): Promise<ObjectID | null> => {
        return this.onCall.get(scheduleId.toString()) || null;
      }) as never);

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
      }) as never);

    // The schedules whose roster has someone on call, as hand-offs stored it.
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "findBy")
      .mockImplementation((async (args: {
        query: Record<string, unknown>;
      }): Promise<Array<OnCallDutyPolicySchedule>> => {
        this.throwIfFailing();
        const onRosterUserIds: Array<string> | null = readQueryValues(
          args.query["currentUserIdOnRoster"],
        );
        const ids: Array<string> | null = readQueryValues(args.query["_id"]);

        return [PRIMARY, SECONDARY]
          .filter((scheduleId: ObjectID): boolean => {
            const onRoster: ObjectID | null = this.rosterOf(scheduleId);

            return (
              (!ids || ids.includes(scheduleId.toString())) &&
              (!onRosterUserIds ||
                Boolean(
                  onRoster && onRosterUserIds.includes(onRoster.toString()),
                ))
            );
          })
          .map((scheduleId: ObjectID): OnCallDutyPolicySchedule => {
            const model: OnCallDutyPolicySchedule =
              new OnCallDutyPolicySchedule();
            model._id = scheduleId.toString();
            model.name = this.nameOf(scheduleId);
            model.projectId = PROJECT_ID;
            model.currentUserIdOnRoster =
              this.rosterOf(scheduleId) || undefined;
            return model;
          });
      }) as never);

    // The rules, by name and order, with their policy's name.
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findBy")
      .mockImplementation((async (args: {
        query: Record<string, unknown>;
      }): Promise<Array<OnCallDutyPolicyEscalationRule>> => {
        this.throwIfFailing();
        const ids: Array<string> | null = readQueryValues(args.query["_id"]);

        return [...this.rules.keys()]
          .filter((ruleKey: string): boolean => {
            return !ids || ids.includes(ruleKey);
          })
          .map((ruleKey: string): OnCallDutyPolicyEscalationRule => {
            return this.ruleModel(new ObjectID(ruleKey));
          });
      }) as never);

    // A team, by name.
    jest.spyOn(TeamService, "findOneById").mockImplementation((async (args: {
      id: ObjectID;
    }): Promise<Team | null> => {
      const name: string = this.nameOf(args.id);

      if (!name) {
        return null;
      }

      const team: Team = new Team();
      team._id = args.id.toString();
      team.name = name;
      return team;
    }) as never);

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
      }) as never);

    jest
      .spyOn(OnCallDutyPolicyTimeLogService, "endTimeLogForUser")
      .mockImplementation((async (data: never) => {
        record("end", data);
      }) as never);
  }

  // A policy as a row's relation reads it: its id and name.
  public policyModel(policyId: ObjectID): OnCallDutyPolicy {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy._id = policyId.toString();
    policy.name = this.nameOf(policyId);
    return policy;
  }

  // A rule as a read of it answers: its name, order and policy.
  public ruleModel(ruleId: ObjectID): OnCallDutyPolicyEscalationRule {
    const rule: WorldRule = this.ruleOf(ruleId);
    const model: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    model._id = ruleId.toString();
    model.name = rule.name;
    model.order = rule.order;
    model.projectId = PROJECT_ID;
    model.onCallDutyPolicyId = rule.policyId;
    model.onCallDutyPolicy = this.policyModel(rule.policyId);
    return model;
  }

  private throwIfFailing(): void {
    if (this.failReads) {
      throw new Error("The database could not be reached.");
    }
  }
}
