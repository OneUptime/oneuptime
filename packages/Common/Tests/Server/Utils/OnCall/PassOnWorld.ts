import { jest } from "@jest/globals";
import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import User from "../../../../Models/DatabaseModels/User";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import UserOnCallLogTimeline from "../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import IncidentService from "../../../../Server/Services/IncidentService";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyUserOverrideService from "../../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import UserNotificationRuleService from "../../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../../Server/Services/UserOnCallLogTimelineService";
import UserService from "../../../../Server/Services/UserService";
import logger from "../../../../Server/Utils/Logger";
import OnCallEscalationAdvance, {
  OnCallEscalationAdvanceResult,
} from "../../../../Server/Utils/OnCall/OnCallEscalationAdvance";
import OnCallPagePassOn from "../../../../Server/Utils/OnCall/OnCallPagePassOn";
import ProjectMembership from "../../../../Server/Utils/TeamMember/ProjectMembership";
import OnCallPolicyRunMessage from "../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPassOnAnswer } from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import PositiveNumber from "../../../../Types/PositiveNumber";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../../../Types/UserNotification/UserNotificationExecutionStatus";
import { FakeRow, matchesQuery } from "./OnCallResolverTestHarness";

/*
 * AN ON-CALL POLICY'S RUN, IN MEMORY, DRIVEN THROUGH THE REAL CODE.
 *
 * What runs is OneUptime's own: an escalation rule paging its people
 * (OnCallDutyPolicyEscalationRuleService.startRuleExecution and the direct
 * page's twin), the run moving on (OnCallEscalationAdvance), a person
 * passing their page on (OnCallPagePassOn) and a person's notification log
 * carrying its status onto the run's timeline (UserOnCallLogService's own
 * update hook). Only the tables are in memory - the run, its timeline, each
 * person's notification log and deliveries, the policy's rules and who they
 * name - and the reads and writes of them are answered here, as Postgres
 * would answer them: a read hands back a copy, so code that holds a run it
 * read earlier holds what it read, and the claim that moves a run on is one
 * atomic compare-and-set (claimEscalationAdvance).
 *
 * The notifications a person's own On-Call Rules send are not sent: paging
 * somebody writes their notification log, as UserNotificationRuleService
 * does, and `deliver` finishes it as the worker that sends them would.
 */

export const PROJECT_ID: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-000000000001",
);
export const POLICY_ID: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-000000000002",
);
export const INCIDENT_ID: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-000000000003",
);
export const RUN_ID: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-000000000004",
);
export const TEAM_ID: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-000000000005",
);

export const ANA: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-0000000000a1",
);
export const BOB: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-0000000000b1",
);
export const CARL: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-0000000000c1",
);
export const DANA: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-0000000000d1",
);

export const NAMES: Record<string, string> = {
  [ANA.toString()]: "Ana Lopez",
  [BOB.toString()]: "Bob Smith",
  [CARL.toString()]: "Carl Diaz",
  [DANA.toString()]: "Dana Kim",
};

export const START: Date = new Date("2026-10-16T03:00:00.000Z");

const MINUTE_IN_MS: number = 60 * 1000;

export interface RuleSetup {
  order: number;
  name?: string | undefined;
  users?: Array<ObjectID> | undefined;
  teams?: Array<ObjectID> | undefined;
  escalateAfterInMinutes?: number | undefined;
}

// One person paged, as the world saw it.
export interface PageEvent {
  userId: string;
  ruleId: string | null;
  at: Date;
}

let idCounter: number = 0;

// A fresh uuid of the world's own, in the order they are made.
export function nextId(): ObjectID {
  idCounter++;

  return new ObjectID(
    `0f500000-0000-4000-9000-${String(idCounter).padStart(12, "0")}`,
  );
}

function sameKey(a: unknown, b: unknown): boolean {
  return (
    String(a || "")
      .toLowerCase()
      .trim() ===
    String(b || "")
      .toLowerCase()
      .trim()
  );
}

function sameTime(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a && !b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return new Date(a).getTime() === new Date(b).getTime();
}

// A copy of a row: a read hands back what was there when it was read.
function copy<T extends object>(row: T): T {
  return Object.assign(
    Object.create(Object.getPrototypeOf(row)) as T,
    row,
  ) as T;
}

type AnyFunction = (...args: Array<any>) => any;

/*
 * An update, as Postgres takes it from TypeORM: a value left undefined is
 * not written.
 */
function merge<T extends object>(row: T, data: Partial<T>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      (row as Record<string, unknown>)[key] = value;
    }
  }
}

export default class PassOnWorld {
  public runs: Array<OnCallDutyPolicyExecutionLog> = [];
  public steps: Array<OnCallDutyPolicyExecutionLogTimeline> = [];
  public logs: Array<UserOnCallLog> = [];
  public deliveries: Array<UserOnCallLogTimeline> = [];
  public rules: Array<OnCallDutyPolicyEscalationRule> = [];
  public ruleUsers: Record<string, Array<ObjectID>> = {};
  public ruleTeams: Record<string, Array<ObjectID>> = {};
  public teamMembers: Record<string, Array<ObjectID>> = {};
  public pages: Array<PageEvent> = [];
  public claims: Array<{ previous: Date | null; won: boolean }> = [];
  public runStatuses: Array<OnCallDutyPolicyStatus> = [];
  public errors: Array<string> = [];
  public acknowledgedBy: ObjectID | null = null;
  public isRecordAcknowledged: boolean = false;
  public clock: Date = new Date(START);
  public repeatsAllowed: number = 0;

  public install(): void {
    idCounter = 0;

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(this.clock);
    });

    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation((() => {
        return undefined;
      }) as never);
    }

    jest.spyOn(logger, "error").mockImplementation(((message: unknown) => {
      this.errors.push(String(message));
    }) as never);

    // Slack and Microsoft Teams are not connected here.
    jest.spyOn(OnCallPolicyRunMessage, "refresh").mockImplementation((() => {
      return undefined;
    }) as never);

    this.installRuns();
    this.installSteps();
    this.installLogs();
    this.installRules();
    this.installPeople();
  }

  private spy(target: object, method: string, implementation: AnyFunction): void {
    jest
      .spyOn(target as Record<string, AnyFunction>, method as never)
      .mockImplementation(implementation as never);
  }

  private installRuns(): void {
    const world: PassOnWorld = this;

    this.spy(
      OnCallDutyPolicyExecutionLogService,
      "findOneById",
      async (data: { id: ObjectID }) => {
        const run: OnCallDutyPolicyExecutionLog | undefined = world.runs.find(
          (row: OnCallDutyPolicyExecutionLog) => {
            return sameKey(row._id, data.id);
          },
        );

        return run ? copy(run) : null;
      },
    );

    this.spy(
      OnCallDutyPolicyExecutionLogService,
      "findBy",
      async (data: { query: Record<string, unknown> }) => {
        return world.runs
          .filter((row: OnCallDutyPolicyExecutionLog) => {
            return matchesQuery(data.query, row as unknown as FakeRow);
          })
          .map(copy);
      },
    );

    this.spy(
      OnCallDutyPolicyExecutionLogService,
      "updateOneById",
      async (data: {
        id: ObjectID;
        data: Partial<OnCallDutyPolicyExecutionLog>;
      }) => {
        const run: OnCallDutyPolicyExecutionLog | undefined = world.runs.find(
          (row: OnCallDutyPolicyExecutionLog) => {
            return sameKey(row._id, data.id);
          },
        );

        if (!run) {
          return;
        }

        merge(run, data.data);

        if (data.data.status) {
          world.runStatuses.push(data.data.status);
        }
      },
    );

    // One atomic compare-and-set, as the real UPDATE ... WHERE is.
    this.spy(
      OnCallDutyPolicyExecutionLogService,
      "claimEscalationAdvance",
      async (data: {
        executionLogId: ObjectID;
        previousLastEscalationRuleExecutedAt: Date | null;
        newLastEscalationRuleExecutedAt: Date;
      }) => {
        const run: OnCallDutyPolicyExecutionLog | undefined = world.runs.find(
          (row: OnCallDutyPolicyExecutionLog) => {
            return sameKey(row._id, data.executionLogId);
          },
        );

        const won: boolean = Boolean(
          run &&
            run.status === OnCallDutyPolicyStatus.Executing &&
            sameTime(
              run.lastEscalationRuleExecutedAt,
              data.previousLastEscalationRuleExecutedAt,
            ),
        );

        world.claims.push({
          previous: data.previousLastEscalationRuleExecutedAt,
          won: won,
        });

        if (won) {
          run!.lastEscalationRuleExecutedAt = data.newLastEscalationRuleExecutedAt;
        }

        return won;
      },
    );
  }

  private installSteps(): void {
    const world: PassOnWorld = this;

    this.spy(
      OnCallDutyPolicyExecutionLogTimelineService,
      "create",
      async (data: { data: OnCallDutyPolicyExecutionLogTimeline }) => {
        const step: OnCallDutyPolicyExecutionLogTimeline = data.data;
        step.id = nextId();
        step.createdAt = new Date(world.clock);
        world.steps.push(step);

        return step;
      },
    );

    this.spy(
      OnCallDutyPolicyExecutionLogTimelineService,
      "findBy",
      async (data: { query: Record<string, unknown> }) => {
        return world.steps
          .filter((row: OnCallDutyPolicyExecutionLogTimeline) => {
            return matchesQuery(data.query, row as unknown as FakeRow);
          })
          .map((row: OnCallDutyPolicyExecutionLogTimeline) => {
            const step: OnCallDutyPolicyExecutionLogTimeline = copy(row);

            if (row.alertSentToUserId) {
              const user: User = new User();
              user.name = NAMES[row.alertSentToUserId.toString()] as never;
              step.alertSentToUser = user;
            }

            return step;
          });
      },
    );

    this.spy(
      OnCallDutyPolicyExecutionLogTimelineService,
      "countBy",
      async (data: { query: Record<string, unknown> }) => {
        return new PositiveNumber(
          world.steps.filter((row: OnCallDutyPolicyExecutionLogTimeline) => {
            return matchesQuery(data.query, row as unknown as FakeRow);
          }).length,
        );
      },
    );

    this.spy(
      OnCallDutyPolicyExecutionLogTimelineService,
      "updateOneById",
      async (data: {
        id: ObjectID;
        data: Partial<OnCallDutyPolicyExecutionLogTimeline>;
      }) => {
        const step: OnCallDutyPolicyExecutionLogTimeline | undefined =
          world.steps.find((row: OnCallDutyPolicyExecutionLogTimeline) => {
            return sameKey(row._id, data.id);
          });

        if (step) {
          merge(step, data.data);
        }
      },
    );
  }

  private installLogs(): void {
    const world: PassOnWorld = this;

    // What paging somebody writes: their notification log, as it starts.
    this.spy(
      UserNotificationRuleService,
      "startUserNotificationRulesExecution",
      async (
        userId: ObjectID,
        options: {
          onCallPolicyExecutionLogId: ObjectID;
          onCallPolicyEscalationRuleId?: ObjectID | undefined;
          onCallDutyPolicyExecutionLogTimelineId: ObjectID;
          triggeredByIncidentId?: ObjectID | undefined;
          onCallPolicyId?: ObjectID | undefined;
        },
      ) => {
        const log: UserOnCallLog = new UserOnCallLog();
        log.id = nextId();
        log.projectId = PROJECT_ID;
        log.userId = userId;
        log.onCallDutyPolicyExecutionLogId = options.onCallPolicyExecutionLogId;
        log.onCallDutyPolicyExecutionLogTimelineId =
          options.onCallDutyPolicyExecutionLogTimelineId;

        if (options.onCallPolicyEscalationRuleId) {
          log.onCallDutyPolicyEscalationRuleId =
            options.onCallPolicyEscalationRuleId;
        }

        if (options.onCallPolicyId) {
          log.onCallDutyPolicyId = options.onCallPolicyId;
        }

        if (options.triggeredByIncidentId) {
          log.triggeredByIncidentId = options.triggeredByIncidentId;
        }

        log.userNotificationEventType = UserNotificationEventType.IncidentCreated;
        log.status = UserNotificationExecutionStatus.Executing;
        log.createdAt = new Date(world.clock);
        world.logs.push(log);

        world.pages.push({
          userId: userId.toString(),
          ruleId: options.onCallPolicyEscalationRuleId?.toString() || null,
          at: new Date(world.clock),
        });
      },
    );

    this.spy(
      UserOnCallLogService,
      "findBy",
      async (data: { query: Record<string, unknown> }) => {
        return world.logs
          .filter((row: UserOnCallLog) => {
            return matchesQuery(data.query, row as unknown as FakeRow);
          })
          .map((row: UserOnCallLog) => {
            const log: UserOnCallLog = copy(row);

            const step: OnCallDutyPolicyExecutionLogTimeline | undefined =
              world.steps.find((candidate: OnCallDutyPolicyExecutionLogTimeline) => {
                return sameKey(
                  candidate._id,
                  row.onCallDutyPolicyExecutionLogTimelineId,
                );
              });

            if (step) {
              log.onCallDutyPolicyExecutionLogTimeline = copy(step);
            }

            return log;
          });
      },
    );

    /*
     * A person's log, written - then its own update hook, the real one,
     * which carries the log's status onto the run's timeline.
     */
    this.spy(
      UserOnCallLogService,
      "updateOneById",
      async (data: {
        id: ObjectID;
        data: Partial<UserOnCallLog>;
        props: { isRoot: boolean };
      }) => {
        const log: UserOnCallLog | undefined = world.logs.find(
          (row: UserOnCallLog) => {
            return sameKey(row._id, data.id);
          },
        );

        if (!log) {
          return;
        }

        merge(log, data.data);

        await (
          UserOnCallLogService as unknown as Record<string, AnyFunction>
        )["onUpdateSuccess"]!.call(
          UserOnCallLogService,
          {
            updateBy: {
              query: { _id: data.id.toString() },
              data: data.data,
              props: data.props,
            },
            carryForward: null,
          },
          [data.id],
        );
      },
    );

    this.spy(
      UserOnCallLogTimelineService,
      "updateOneById",
      async (data: { id: ObjectID; data: Partial<UserOnCallLogTimeline> }) => {
        const delivery: UserOnCallLogTimeline | undefined =
          world.deliveries.find((row: UserOnCallLogTimeline) => {
            return sameKey(row._id, data.id);
          });

        if (delivery) {
          merge(delivery, data.data);
        }
      },
    );
  }

  private installRules(): void {
    const world: PassOnWorld = this;

    const ruleById: (id: unknown) => OnCallDutyPolicyEscalationRule | undefined =
      (id: unknown): OnCallDutyPolicyEscalationRule | undefined => {
        return world.rules.find((rule: OnCallDutyPolicyEscalationRule) => {
          return sameKey(rule._id, id);
        });
      };

    this.spy(
      OnCallDutyPolicyEscalationRuleService,
      "findOneById",
      async (data: { id: ObjectID }) => {
        const rule: OnCallDutyPolicyEscalationRule | undefined = ruleById(
          data.id,
        );

        return rule ? copy(rule) : null;
      },
    );

    this.spy(
      OnCallDutyPolicyEscalationRuleService,
      "findOneBy",
      async (data: { query: Record<string, unknown> }) => {
        const rule: OnCallDutyPolicyEscalationRule | undefined =
          world.rules.find((row: OnCallDutyPolicyEscalationRule) => {
            return matchesQuery(data.query, row as unknown as FakeRow);
          });

        return rule ? copy(rule) : null;
      },
    );

    this.spy(
      OnCallDutyPolicyEscalationRuleService,
      "findBy",
      async (data: { query: Record<string, unknown> }) => {
        return world.rules
          .filter((row: OnCallDutyPolicyEscalationRule) => {
            return matchesQuery(data.query, row as unknown as FakeRow);
          })
          .sort(
            (
              a: OnCallDutyPolicyEscalationRule,
              b: OnCallDutyPolicyEscalationRule,
            ) => {
              return (a.order || 0) - (b.order || 0);
            },
          )
          .map(copy);
      },
    );

    this.spy(
      OnCallDutyPolicyEscalationRuleUserService,
      "findBy",
      async (data: { query: Record<string, unknown> }) => {
        const ruleId: string = String(
          data.query["onCallDutyPolicyEscalationRuleId"],
        );

        return (world.ruleUsers[ruleId] || []).map((userId: ObjectID) => {
          return { userId: userId };
        });
      },
    );

    this.spy(
      OnCallDutyPolicyEscalationRuleTeamService,
      "findBy",
      async (data: { query: Record<string, unknown> }) => {
        const ruleId: string = String(
          data.query["onCallDutyPolicyEscalationRuleId"],
        );

        return (world.ruleTeams[ruleId] || []).map((teamId: ObjectID) => {
          return { teamId: teamId };
        });
      },
    );

    this.spy(OnCallDutyPolicyEscalationRuleScheduleService, "findBy", async () => {
      return [];
    });

    // Nobody is away.
    this.spy(OnCallDutyPolicyUserOverrideService, "findBy", async () => {
      return [];
    });

    this.spy(
      TeamMemberService,
      "getUsersInTeams",
      async (teamIds: Array<ObjectID>) => {
        return (world.teamMembers[teamIds[0]?.toString() || ""] || []).map(
          (userId: ObjectID) => {
            const user: User = new User();
            user.id = userId;
            return user;
          },
        );
      },
    );
  }

  private installPeople(): void {
    const world: PassOnWorld = this;

    // Everybody here is a member of the project.
    this.spy(ProjectMembership, "getMemberUserIds", async (data: {
      userIds: Array<ObjectID>;
    }) => {
      return new Set<string>(
        data.userIds.map((userId: ObjectID) => {
          return userId.toString().toLowerCase();
        }),
      );
    });

    this.spy(UserService, "findBy", async () => {
      return Object.keys(NAMES).map((id: string) => {
        const user: User = new User();
        user.id = new ObjectID(id);
        user.name = NAMES[id] as never;
        return user;
      });
    });

    this.spy(UserService, "findOneById", async (data: { id: ObjectID }) => {
      const user: User = new User();
      user.id = data.id;
      user.name = (NAMES[data.id.toString()] || "Someone") as never;
      user.email = "someone@example.com" as never;
      return user;
    });

    this.spy(IncidentService, "isIncidentAcknowledged", async () => {
      return world.isRecordAcknowledged;
    });

    this.spy(
      IncidentService,
      "acknowledgeIncident",
      async (data: { acknowledgedByUserId: ObjectID }) => {
        world.isRecordAcknowledged = true;
        world.acknowledgedBy = data.acknowledgedByUserId;
      },
    );
  }

  // ---- building the policy --------------------------------------------

  public addRule(setup: RuleSetup): OnCallDutyPolicyEscalationRule {
    const rule: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    rule.id = nextId();
    rule.projectId = PROJECT_ID;
    rule.onCallDutyPolicyId = POLICY_ID;
    rule.order = setup.order;
    rule.name = setup.name || `Level ${setup.order}`;
    rule.escalateAfterInMinutes = setup.escalateAfterInMinutes ?? 30;

    this.rules.push(rule);
    this.ruleUsers[rule.id!.toString()] = setup.users || [];
    this.ruleTeams[rule.id!.toString()] = setup.teams || [];

    return rule;
  }

  // ---- running it --------------------------------------------------------

  public get run(): OnCallDutyPolicyExecutionLog {
    return this.runs[0]!;
  }

  // A run of the policy, started as OneUptime starts one: its first rule pages.
  public async startRun(): Promise<void> {
    const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
    run.id = RUN_ID;
    run.projectId = PROJECT_ID;
    run.onCallDutyPolicyId = POLICY_ID;
    run.triggeredByIncidentId = INCIDENT_ID;
    run.userNotificationEventType = UserNotificationEventType.IncidentCreated;
    run.status = OnCallDutyPolicyStatus.Executing;
    run.onCallPolicyExecutionRepeatCount = 1;
    run.createdAt = new Date(this.clock);
    run.onCallDutyPolicy = {
      name: "Payments",
      repeatPolicyIfNoOneAcknowledges: this.repeatsAllowed > 0,
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: this.repeatsAllowed,
    } as never;

    this.runs.push(run);

    const first: OnCallDutyPolicyEscalationRule = this.rules.find(
      (rule: OnCallDutyPolicyEscalationRule) => {
        return rule.order === 1;
      },
    )!;

    await OnCallDutyPolicyEscalationRuleService.startRuleExecution(first.id!, {
      projectId: PROJECT_ID,
      triggeredByIncidentId: INCIDENT_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      onCallPolicyExecutionLogId: RUN_ID,
      onCallPolicyId: POLICY_ID,
    });
  }

  /*
   * A direct page: everybody named paged at once, with no policy and no
   * escalation rules.
   */
  public async startDirectPage(userIds: Array<ObjectID>): Promise<void> {
    const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
    run.id = RUN_ID;
    run.projectId = PROJECT_ID;
    run.triggeredByIncidentId = INCIDENT_ID;
    run.userNotificationEventType = UserNotificationEventType.IncidentCreated;
    run.status = OnCallDutyPolicyStatus.Executing;
    run.createdAt = new Date(this.clock);

    this.runs.push(run);

    await OnCallDutyPolicyEscalationRuleService.startDirectPage({
      projectId: PROJECT_ID,
      triggeredByIncidentId: INCIDENT_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      onCallPolicyExecutionLogId: RUN_ID,
      targets: {
        userIds: userIds,
        teamIds: [],
        onCallScheduleIds: [],
      },
    });
  }

  /*
   * The worker that sends a person's notifications finishes their log: all
   * their On-Call Rules have sent what they had to.
   */
  public async deliver(userId?: ObjectID | undefined): Promise<void> {
    for (const log of this.logs) {
      if (
        log.status !== UserNotificationExecutionStatus.Executing ||
        (userId && !sameKey(log.userId, userId))
      ) {
        continue;
      }

      await UserOnCallLogService.updateOneById({
        id: log.id!,
        data: {
          status: UserNotificationExecutionStatus.Completed,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  // Time passes; then the worker's tick moves the run on if its wait is over.
  public async tick(minutes: number): Promise<OnCallEscalationAdvanceResult | null> {
    this.clock = new Date(this.clock.getTime() + minutes * MINUTE_IN_MS);

    const run: OnCallDutyPolicyExecutionLog = copy(this.run);

    if (run.status !== OnCallDutyPolicyStatus.Executing) {
      return null;
    }

    const waited: number = OneUptimeDate.getDifferenceInMinutes(
      run.lastEscalationRuleExecutedAt || run.createdAt!,
      this.clock,
    );

    if (waited < (run.executeNextEscalationRuleInMinutes || 0)) {
      return null;
    }

    return await OnCallEscalationAdvance.advance({
      run: run,
      now: new Date(this.clock),
    });
  }

  public async passOn(
    userId: ObjectID,
    via?: ObjectID | undefined,
  ): Promise<OnCallPassOnAnswer> {
    return await OnCallPagePassOn.passOn({
      userId: userId,
      executionLogId: RUN_ID,
      viaUserOnCallLogTimelineId: via,
    });
  }

  public async preview(userId: ObjectID): Promise<OnCallPassOnAnswer> {
    return await OnCallPagePassOn.getPreview({
      userId: userId,
      executionLogId: RUN_ID,
    });
  }

  // ---- reading what happened -------------------------------------------

  // Who a rule paged, in order; every page, so a second page shows twice.
  public pagedBy(rule: OnCallDutyPolicyEscalationRule): Array<string> {
    return this.pages
      .filter((page: PageEvent) => {
        return page.ruleId === rule.id!.toString();
      })
      .map((page: PageEvent) => {
        return NAMES[page.userId] || page.userId;
      });
  }

  // Everybody paged, in order, by name.
  public pagedNames(): Array<string> {
    return this.pages.map((page: PageEvent) => {
      return NAMES[page.userId] || page.userId;
    });
  }

  // A person's lines on the run's timeline: status and message.
  public stepsOf(userId: ObjectID): Array<{ status: string; message: string }> {
    return this.steps
      .filter((step: OnCallDutyPolicyExecutionLogTimeline) => {
        return sameKey(step.alertSentToUserId, userId);
      })
      .map((step: OnCallDutyPolicyExecutionLogTimeline) => {
        return {
          status: String(step.status),
          message: step.statusMessage || "",
        };
      });
  }

  public logsOf(userId: ObjectID): Array<UserOnCallLog> {
    return this.logs.filter((log: UserOnCallLog) => {
      return sameKey(log.userId, userId);
    });
  }

  // The rule the run is on now, by order.
  public currentOrder(): number {
    return this.run.lastExecutedEscalationRuleOrder || 0;
  }

  public lineStatuses(): Array<OnCallDutyExecutionLogTimelineStatus> {
    return this.steps.map((step: OnCallDutyPolicyExecutionLogTimeline) => {
      return step.status as OnCallDutyExecutionLogTimelineStatus;
    });
  }
}
