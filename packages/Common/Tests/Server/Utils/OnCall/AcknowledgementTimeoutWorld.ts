import { jest } from "@jest/globals";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import URL from "../../../../Types/API/URL";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import UserOnCallLogService from "../../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../../Server/Services/UserOnCallLogTimelineService";
import UserService from "../../../../Server/Services/UserService";
import OnCallAcknowledgementTimeout, {
  OnCallPageAgainResult,
} from "../../../../Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import OnCallEscalationAdvance from "../../../../Server/Utils/OnCall/OnCallEscalationAdvance";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { isOnCallPageAgainRun } from "../../../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import {
  getOnCallPolicyRunRecordHandledMessage,
  getOnCallPolicyRunRecordResolvedMessage,
} from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import { OnCallPassOnAnswer } from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import OnCallPagePassOn from "../../../../Server/Utils/OnCall/OnCallPagePassOn";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../../../Types/UserNotification/UserNotificationExecutionStatus";
import UserNotificationStatus from "../../../../Types/UserNotification/UserNotificationStatus";
import FeedMarkdown from "../../../../Utils/Markdown/FeedMarkdown";
import { FakeRow, matchesQuery } from "./OnCallResolverTestHarness";
import PassOnWorld, {
  INCIDENT_ID,
  NAMES,
  POLICY_ID,
  PROJECT_ID,
  RUN_ID,
  nextId,
} from "./PassOnWorld";

/*
 * THE ACKNOWLEDGEMENT TIMEOUT, IN MEMORY, DRIVEN THROUGH THE REAL CODE.
 *
 * PassOnWorld's on-call policy run - rules paging their people, the run
 * moving on, people escalating - with what the acknowledgement timeout
 * reads and writes on top: the incident and its states (Created,
 * Acknowledged, Investigating after it, Resolved), its state timeline (who
 * acknowledged it), the policy as it is now (its timeout, archived or not),
 * the schedule a rule pages (who is on call in it right now), the record's
 * feed, and the clock on each run with its atomic compare-and-set.
 *
 * What runs is OneUptime's own: OnCallAcknowledgementTimeout (the clock and
 * the worker's page again), OnCallDutyPolicyExecutionLogService
 * .startPageAgain (the run it starts and its feed entry), the escalation
 * rule service paging its people, the escalation worker's move on, and
 * UserOnCallLogTimelineService's acknowledge hook - a person answering a
 * page, as their link, call or text does.
 */

export const CREATED: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-0000000000e1",
);
export const ACKNOWLEDGED: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-0000000000e2",
);
export const INVESTIGATING: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-0000000000e3",
);
export const RESOLVED: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-0000000000e4",
);

export const SCHEDULE_ID: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-000000000006",
);

export const DASHBOARD_URL: string = "https://oneuptime.example.com/dashboard";

const MINUTE_IN_MS: number = 60 * 1000;

type AnyFunction = (...args: Array<any>) => any;

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

function sameTime(a: unknown, b: unknown): boolean {
  if (!a && !b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return new Date(a as Date).getTime() === new Date(b as Date).getTime();
}

function copy<T extends Record<string, any>>(row: T): T {
  return Object.assign(
    Object.create(Object.getPrototypeOf(row)) as T,
    row,
  ) as T;
}

function state(
  id: ObjectID,
  order: number,
  name: string,
  flags: { acknowledged?: boolean; resolved?: boolean; created?: boolean },
): IncidentState {
  const row: IncidentState = new IncidentState();
  row.id = id;
  row.order = order;
  row.name = name;
  row.isCreatedState = Boolean(flags.created);
  row.isAcknowledgedState = Boolean(flags.acknowledged);
  row.isResolvedState = Boolean(flags.resolved);
  return row;
}

// A row of the incident's state timeline, as the world keeps it.
export interface WorldStateRow {
  incidentStateId: ObjectID;
  startsAt: Date;
  createdByUserId: ObjectID | null;
}

// An entry of the incident's feed, as the world saw it written.
export interface WorldFeedEntry {
  markdown: string;
  at: Date;
}

export default class AcknowledgementTimeoutWorld extends PassOnWorld {
  // The policy as it is now: every read of a run reads it again.
  public policy: {
    name: string;
    acknowledgementTimeoutInMinutes: number | null;
    isArchived: boolean;
  } = {
    name: "Payments",
    acknowledgementTimeoutInMinutes: 30,
    isArchived: false,
  };

  public states: Array<IncidentState> = [
    state(CREATED, 1, "Created", { created: true }),
    state(ACKNOWLEDGED, 2, "Acknowledged", { acknowledged: true }),
    state(INVESTIGATING, 3, "Investigating", {}),
    state(RESOLVED, 4, "Resolved", { resolved: true }),
  ];

  // The incident; null once it is deleted.
  public incident: { stateId: ObjectID } | null = { stateId: CREATED };
  public stateRows: Array<WorldStateRow> = [];
  public feed: Array<WorldFeedEntry> = [];
  // Who is on call in the schedule right now: a rotation hands over.
  public onCallInSchedule: ObjectID | null = null;
  // The rules that page the schedule's on-call person.
  public ruleSchedules: Record<string, Array<ObjectID>> = {};
  public clockWrites: Array<{ runId: string; startedAt: Date | null }> = [];

  public override install(): void {
    super.install();
    this.installClock();
    this.installIncident();
    this.installPolicy();
    this.installSchedules();
    this.installAcknowledgeHook();
  }

  private spyOn(
    target: unknown,
    method: string,
    implementation: AnyFunction,
  ): void {
    jest.spyOn(target as any, method as any).mockImplementation(implementation);
  }

  private findRun(id: unknown): OnCallDutyPolicyExecutionLog | undefined {
    return this.runs.find((row: OnCallDutyPolicyExecutionLog) => {
      return sameKey(row._id, id);
    });
  }

  /*
   * A run as the database holds it: its policy is read with it, as it is
   * NOW - a timeout changed or an archive since the run started shows.
   */
  public addRunRow(run: OnCallDutyPolicyExecutionLog): void {
    const getPolicy: () => OnCallDutyPolicy = (): OnCallDutyPolicy => {
      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy.id = POLICY_ID;
      policy.name = this.policy.name;
      policy.isArchived = this.policy.isArchived;
      (policy as unknown as Record<string, unknown>)[
        "acknowledgementTimeoutInMinutes"
      ] = this.policy.acknowledgementTimeoutInMinutes;
      policy.repeatPolicyIfNoOneAcknowledges = this.repeatsAllowed > 0;
      policy.repeatPolicyIfNoOneAcknowledgesNoOfTimes = this.repeatsAllowed;
      return policy;
    };

    Object.defineProperty(run, "onCallDutyPolicy", {
      enumerable: true,
      configurable: true,
      get: getPolicy,
      set: (): void => {
        // The policy is the world's; a run never changes it.
      },
    });

    this.runs.push(run);
  }

  private installClock(): void {
    this.spyOn(
      OnCallDutyPolicyExecutionLogService,
      "findAllBy",
      async (data: { query: Record<string, unknown> }) => {
        return this.runs
          .filter((row: OnCallDutyPolicyExecutionLog) => {
            return matchesQuery(data.query, row as unknown as FakeRow);
          })
          .map(copy);
      },
    );

    // The run's own findBy reads with a sort: the latest first, here too.
    this.spyOn(
      OnCallDutyPolicyExecutionLogService,
      "findBy",
      async (data: {
        query: Record<string, unknown>;
        sort?: Record<string, unknown>;
      }) => {
        const rows: Array<OnCallDutyPolicyExecutionLog> = this.runs
          .filter((row: OnCallDutyPolicyExecutionLog) => {
            return matchesQuery(data.query, row as unknown as FakeRow);
          })
          .map(copy);

        if (data.sort && data.sort["createdAt"]) {
          rows.sort(
            (
              a: OnCallDutyPolicyExecutionLog,
              b: OnCallDutyPolicyExecutionLog,
            ) => {
              return (
                new Date(b.createdAt!).getTime() -
                new Date(a.createdAt!).getTime()
              );
            },
          );
        }

        return rows;
      },
    );

    this.spyOn(
      OnCallDutyPolicyExecutionLogService,
      "updateColumnsByIdWithoutHooks",
      async (data: { id: ObjectID; data: Record<string, unknown> }) => {
        const run: OnCallDutyPolicyExecutionLog | undefined = this.findRun(
          data.id,
        );

        if (!run) {
          return;
        }

        Object.assign(run, data.data);
        this.clockWrites.push({
          runId: data.id.toString(),
          startedAt:
            (data.data["acknowledgementTimeoutStartedAt"] as Date | null) ??
            null,
        });
      },
    );

    // One atomic compare-and-set, as the real UPDATE ... WHERE is.
    this.spyOn(
      OnCallDutyPolicyExecutionLogService,
      "compareAndSetColumnsByIdWithoutHooks",
      async (data: {
        id: ObjectID;
        data: Record<string, unknown>;
        expectedData: Record<string, unknown>;
      }) => {
        const run: OnCallDutyPolicyExecutionLog | undefined = this.findRun(
          data.id,
        );

        if (!run) {
          return false;
        }

        for (const [key, value] of Object.entries(data.expectedData)) {
          const now: unknown = (run as unknown as Record<string, unknown>)[key];

          const matches: boolean =
            value instanceof Date || now instanceof Date
              ? sameTime(now, value)
              : sameKey(now, value);

          if (!matches) {
            return false;
          }
        }

        Object.assign(run, data.data);
        this.clockWrites.push({
          runId: data.id.toString(),
          startedAt:
            (data.data["acknowledgementTimeoutStartedAt"] as Date | null) ??
            null,
        });

        return true;
      },
    );

    // A page again is created as a run of its own.
    this.spyOn(
      OnCallDutyPolicyExecutionLogService,
      "create",
      async (data: { data: OnCallDutyPolicyExecutionLog }) => {
        const run: OnCallDutyPolicyExecutionLog = data.data;
        run.id = nextId();
        run.createdAt = new Date(this.clock);
        run.onCallPolicyExecutionRepeatCount = 1;

        if (this.policy.isArchived) {
          run.status = OnCallDutyPolicyStatus.Error;
        }

        this.addRunRow(run);

        return copy(run);
      },
    );
  }

  private installIncident(): void {
    this.spyOn(IncidentService, "findOneById", async () => {
      if (!this.incident) {
        return null;
      }

      const incident: Incident = new Incident();
      incident.id = INCIDENT_ID;
      incident.projectId = PROJECT_ID;
      incident.currentIncidentStateId = this.incident.stateId;
      return incident;
    });

    this.spyOn(IncidentStateService, "getAllIncidentStates", async () => {
      return this.states;
    });

    this.spyOn(IncidentStateTimelineService, "findBy", async () => {
      return [...this.stateRows]
        .sort((a: WorldStateRow, b: WorldStateRow) => {
          return b.startsAt.getTime() - a.startsAt.getTime();
        })
        .map((row: WorldStateRow) => {
          return {
            incidentStateId: row.incidentStateId,
            startsAt: row.startsAt,
            createdByUserId: row.createdByUserId,
          };
        });
    });

    this.spyOn(IncidentService, "isIncidentAcknowledged", async () => {
      return this.isIncidentInState(["acknowledged", "resolved"]);
    });

    // An answered page acknowledges the incident through its state timeline.
    this.spyOn(
      IncidentService,
      "acknowledgeIncident",
      async (data: { acknowledgedByUserId: ObjectID }) => {
        this.acknowledgedBy = data.acknowledgedByUserId;
        await this.changeState(ACKNOWLEDGED, data.acknowledgedByUserId);
      },
    );

    this.spyOn(
      IncidentFeedService,
      "createIncidentFeedItem",
      async (data: { feedInfoInMarkdown: string }) => {
        this.feed.push({
          markdown: data.feedInfoInMarkdown,
          at: new Date(this.clock),
        });
      },
    );
  }

  private installPolicy(): void {
    this.spyOn(OnCallDutyPolicyService, "findOneById", async () => {
      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy.id = POLICY_ID;
      policy.projectId = PROJECT_ID;
      policy.name = this.policy.name;
      return policy;
    });

    this.spyOn(
      OnCallDutyPolicyService,
      "getOnCallDutyPolicyLinkInDashboard",
      async () => {
        return URL.fromString(
          `${DASHBOARD_URL}/${PROJECT_ID.toString()}/on-call-duty/policies/${POLICY_ID.toString()}`,
        );
      },
    );

    this.spyOn(
      UserService,
      "getUserMarkdownString",
      async (data: { userId: ObjectID }) => {
        // Markdown already, as the real service hands it back.
        return FeedMarkdown.link(
          NAMES[data.userId.toString()] || "Someone",
          `${DASHBOARD_URL}/users/${data.userId.toString()}`,
        );
      },
    );
  }

  private installSchedules(): void {
    this.spyOn(
      OnCallDutyPolicyEscalationRuleScheduleService,
      "findBy",
      async (data: { query: Record<string, unknown> }) => {
        const ruleId: string = String(
          data.query["onCallDutyPolicyEscalationRuleId"],
        );

        return (this.ruleSchedules[ruleId] || []).map(
          (scheduleId: ObjectID) => {
            return {
              onCallDutyPolicyScheduleId: scheduleId,
              pageNextInRotation: false,
            };
          },
        );
      },
    );

    this.spyOn(
      OnCallDutyPolicyScheduleService,
      "getCurrentOnCallInSchedule",
      async () => {
        return this.onCallInSchedule
          ? { userId: this.onCallInSchedule, coveredUserId: null }
          : null;
      },
    );
  }

  /*
   * The real acknowledge hook reads the delivery it is told about; here a
   * delivery is any log of the run's, answered by its person.
   */
  private installAcknowledgeHook(): void {
    /*
     * A person's pages, read with their run - as the Dashboard's Acknowledge
     * of a page again reads them (acknowledgePagesAgainForRecord).
     */
    this.spyOn(
      UserOnCallLogService,
      "findBy",
      async (data: { query: Record<string, unknown> }) => {
        return this.logs
          .filter((row: UserOnCallLog) => {
            return matchesQuery(data.query, row as unknown as FakeRow);
          })
          .map((row: UserOnCallLog) => {
            const log: UserOnCallLog = copy(row);
            const run: OnCallDutyPolicyExecutionLog | undefined = this.findRun(
              row.onCallDutyPolicyExecutionLogId,
            );

            if (run) {
              log.onCallDutyPolicyExecutionLog = copy(run);
            }

            // And the run's line for them, as PassOnWorld reads it.
            const step: OnCallDutyPolicyExecutionLogTimeline | undefined =
              this.steps.find(
                (candidate: OnCallDutyPolicyExecutionLogTimeline) => {
                  return sameKey(
                    candidate._id,
                    row.onCallDutyPolicyExecutionLogTimelineId,
                  );
                },
              );

            if (step) {
              log.onCallDutyPolicyExecutionLogTimeline = copy(step);
            }

            return log;
          });
      },
    );

    this.spyOn(
      UserOnCallLogTimelineService,
      "findBy",
      async (data: { query: Record<string, unknown> }) => {
        const log: UserOnCallLog | undefined = this.logs.find(
          (row: UserOnCallLog) => {
            return sameKey(`delivery-of-${row._id}`, data.query["_id"]);
          },
        );

        if (!log) {
          return [];
        }

        return [
          {
            _id: `delivery-of-${log._id}`,
            id: new ObjectID(log._id!),
            projectId: PROJECT_ID,
            userId: log.userId,
            userNotificationLogId: log.id,
            onCallDutyPolicyExecutionLogId: log.onCallDutyPolicyExecutionLogId,
            onCallDutyPolicyExecutionLogTimelineId:
              log.onCallDutyPolicyExecutionLogTimelineId,
            triggeredByIncidentId: log.triggeredByIncidentId,
          },
        ];
      },
    );
  }

  // ---- the incident ------------------------------------------------------

  private isIncidentInState(kinds: Array<"acknowledged" | "resolved">): boolean {
    if (!this.incident) {
      return false;
    }

    const order: number =
      this.states.find((row: IncidentState) => {
        return sameKey(row.id, this.incident!.stateId);
      })?.order || 0;

    const acknowledgedOrder: number = 2;
    const resolvedOrder: number = 4;

    return (
      (kinds.includes("acknowledged") && order >= acknowledgedOrder) ||
      (kinds.includes("resolved") && order >= resolvedOrder)
    );
  }

  /*
   * The incident moves to a state - from the Dashboard, the mobile app,
   * Slack, the API - and its state timeline asks the clock, as
   * IncidentStateTimelineService does once the change is saved.
   */
  public async changeState(
    stateId: ObjectID,
    byUserId: ObjectID | null,
  ): Promise<void> {
    const previous: ObjectID | null = this.incident?.stateId || null;

    this.incident = { stateId: stateId };
    this.stateRows.push({
      incidentStateId: stateId,
      startsAt: new Date(this.clock),
      createdByUserId: byUserId,
    });

    await OnCallAcknowledgementTimeout.onRecordStateChanged({
      kind: "incident",
      recordId: INCIDENT_ID,
      projectId: PROJECT_ID,
      stateId: stateId,
      previousStateId: previous,
    });
  }

  public async acknowledgeInDashboard(userId: ObjectID): Promise<void> {
    await this.changeState(ACKNOWLEDGED, userId);
  }

  public async resolve(userId: ObjectID): Promise<void> {
    await this.changeState(RESOLVED, userId);
  }

  // ---- the policy's runs -------------------------------------------------

  // The first run, paging the policy's first rule, as PassOnWorld starts it.
  public override async startRun(): Promise<void> {
    const run: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    run.id = RUN_ID;
    run.projectId = PROJECT_ID;
    run.onCallDutyPolicyId = POLICY_ID;
    run.triggeredByIncidentId = INCIDENT_ID;
    run.userNotificationEventType = UserNotificationEventType.IncidentCreated;
    run.status = OnCallDutyPolicyStatus.Executing;
    run.onCallPolicyExecutionRepeatCount = 1;
    run.createdAt = new Date(this.clock);
    this.addRunRow(run);

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

  public runById(id: ObjectID | string): OnCallDutyPolicyExecutionLog {
    return this.findRun(id)!;
  }

  // Every page again, in the order they started.
  public pagesAgain(): Array<OnCallDutyPolicyExecutionLog> {
    return this.runs.filter((run: OnCallDutyPolicyExecutionLog) => {
      return Number(run.pageAgainNumber || 0) > 0;
    });
  }

  public latestRun(): OnCallDutyPolicyExecutionLog {
    return this.runs[this.runs.length - 1]!;
  }

  // The runs whose clock runs now.
  public runningClocks(): Array<{ runId: string; startedAt: Date }> {
    return this.runs
      .filter((run: OnCallDutyPolicyExecutionLog) => {
        return Boolean(run.acknowledgementTimeoutStartedAt);
      })
      .map((run: OnCallDutyPolicyExecutionLog) => {
        return {
          runId: run._id!.toString(),
          startedAt: new Date(run.acknowledgementTimeoutStartedAt!),
        };
      });
  }

  // ---- time passing ------------------------------------------------------

  public advance(minutes: number, seconds: number = 0): void {
    this.clock = new Date(
      this.clock.getTime() + minutes * MINUTE_IN_MS + seconds * 1000,
    );
  }

  // The page-again worker's tick, at the world's now.
  public async pageAgainTick(): Promise<Array<OnCallPageAgainResult>> {
    return await OnCallAcknowledgementTimeout.run(new Date(this.clock));
  }

  /*
   * The escalation worker's tick, for every run still paging, as
   * ExecutePendingExecutions runs it: a run whose record is handled ends -
   * acknowledged or resolved, or for a page again, resolved - and a run
   * whose rule's wait is over moves on.
   */
  public async escalationTick(): Promise<void> {
    for (const row of [...this.runs]) {
      const run: OnCallDutyPolicyExecutionLog = copy(row);

      if (run.status !== OnCallDutyPolicyStatus.Executing) {
        continue;
      }

      const isOver: boolean = isOnCallPageAgainRun(run)
        ? this.isIncidentInState(["resolved"])
        : this.isIncidentInState(["acknowledged", "resolved"]);

      if (isOver) {
        await OnCallDutyPolicyExecutionLogService.updateOneById({
          id: run.id!,
          data: {
            status: OnCallDutyPolicyStatus.Completed,
            statusMessage: isOnCallPageAgainRun(run)
              ? getOnCallPolicyRunRecordResolvedMessage("incident")
              : getOnCallPolicyRunRecordHandledMessage("incident"),
          },
          props: { isRoot: true },
        });

        continue;
      }

      const waited: number = OneUptimeDate.getDifferenceInMinutes(
        run.lastEscalationRuleExecutedAt || run.createdAt!,
        this.clock,
      );

      if (waited < (run.executeNextEscalationRuleInMinutes || 0)) {
        continue;
      }

      await OnCallEscalationAdvance.advance({
        run: run,
        now: new Date(this.clock),
      });
    }
  }

  // ---- people answering --------------------------------------------------

  /*
   * A person answers their page of a run - its link, a call's 1, a text -
   * through the real acknowledge hook.
   */
  public async answerPage(
    userId: ObjectID,
    runId: ObjectID | string,
  ): Promise<void> {
    const log: UserOnCallLog | undefined = [...this.logs]
      .reverse()
      .find((row: UserOnCallLog) => {
        return (
          sameKey(row.userId, userId) &&
          sameKey(row.onCallDutyPolicyExecutionLogId, runId)
        );
      });

    if (!log) {
      throw new Error(
        `${NAMES[userId.toString()] || userId.toString()} has no page in run ${runId.toString()}`,
      );
    }

    const acknowledgedAt: Date = new Date(this.clock);

    await (
      UserOnCallLogTimelineService as unknown as Record<string, AnyFunction>
    )["onUpdateSuccess"]!.call(
      UserOnCallLogTimelineService,
      {
        updateBy: {
          query: { _id: `delivery-of-${log._id}` },
          data: {
            acknowledgedAt: acknowledgedAt,
            isAcknowledged: true,
            status: UserNotificationStatus.Acknowledged,
            statusMessage: "Notification Acknowledged",
          },
          props: { isRoot: true },
        },
        carryForward: null,
      },
      [],
    );
  }

  public async escalate(
    userId: ObjectID,
    runId: ObjectID | string,
  ): Promise<OnCallPassOnAnswer> {
    return await OnCallPagePassOn.passOn({
      userId: userId,
      executionLogId: new ObjectID(runId.toString()),
    });
  }

  // The people a run paged, by name, in order.
  public pagedIn(runId: ObjectID | string): Array<string> {
    return this.logs
      .filter((log: UserOnCallLog) => {
        return sameKey(log.onCallDutyPolicyExecutionLogId, runId);
      })
      .map((log: UserOnCallLog) => {
        return NAMES[log.userId!.toString()] || log.userId!.toString();
      });
  }

  // Whether a person's page of a run is still going out to them.
  public isStillPaging(userId: ObjectID, runId: ObjectID | string): boolean {
    return this.logs.some((log: UserOnCallLog) => {
      return (
        sameKey(log.userId, userId) &&
        sameKey(log.onCallDutyPolicyExecutionLogId, runId) &&
        log.status === UserNotificationExecutionStatus.Executing
      );
    });
  }
}
