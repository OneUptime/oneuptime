import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import OnCallDutyPolicyEscalationRuleService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  getOnCallPolicyFirstLevel,
  getOnCallRunNextLevel,
} from "Common/Types/OnCallDutyPolicy/OnCallRunLevel";
import EmptyLevelWorld from "Common/Tests/Server/Utils/OnCall/EmptyLevelWorld";
import {
  INCIDENT_ID,
  NAMES,
  PROJECT_ID,
  PageEvent,
} from "Common/Tests/Server/Utils/OnCall/PassOnWorld";
import { jest } from "@jest/globals";

/*
 * AN ON-CALL POLICY'S RUN, IN MEMORY, MOVED ON BY THE REAL WORKER - AND THE
 * DATABASE FAILING UNDER IT AT ANY STEP (issue #8167).
 *
 * EmptyLevelWorld's run - its rules paging their people through the real
 * OnCallDutyPolicyEscalationRuleService.startRuleExecution, moved on by the
 * real OnCallEscalationAdvance, started from waiting by the real
 * OnCallDutyPolicyExecutionLogService.startWaitingRun - driven by the tick
 * OnCallDutyPolicyExecutionLog:ExecutePendingExecutions registers, with
 * what it reads besides (the incident and its states, the runs' failed
 * tries in Redis) kept here too.
 *
 * Any step can be made to fail (failAt): the claim that moves a run on, the
 * read of its next rule, the read and the record of the rule as it starts,
 * the page of a person, a write of the run's status, the claim that starts
 * a run that waited. A failure is thrown as the database or the network
 * throws it, so the worker reads it as it would read the real one.
 *
 * A worker that restarts (crashAt) is a process that stops at a step and
 * never runs another line: from that step on nothing it writes reaches the
 * database or Redis - not its catch, not its try again - until the next
 * tick, which is a fresh process with what the database and Redis kept.
 * The worker keeps nothing of a run in memory between ticks, so that is
 * all a restart is.
 */

// What the database throws as it loses a connection, as pg throws it.
export function connectionReset(): Error {
  return Object.assign(new Error("Connection terminated unexpectedly"), {
    code: "ECONNRESET",
  });
}

// A process that stopped: nothing after it ran.
export class ProcessStopped extends Error {
  public constructor() {
    super("The worker's process stopped here.");
  }
}

export enum FailurePoint {
  // The claim that moves a run on (claimEscalationAdvance).
  ClaimMoveOn = "ClaimMoveOn",
  /*
   * The read of the rule a run starts at or moves on to: EscalationRule
   * findOneBy (a run's first rule, its policy's lowest place), and the read
   * of its policy's levels it picks the next from (findBy).
   */
  ReadNextRule = "ReadNextRule",
  // The read of a rule as it starts (startRuleExecution's findOneById).
  ReadStartingRule = "ReadStartingRule",
  // The record of the rule on the run as it starts (its update of the run).
  RecordRule = "RecordRule",
  // The page of a person (startUserNotificationRulesExecution).
  PagePerson = "PagePerson",
  // A write of the run's status (updateOneById with a status).
  WriteRunStatus = "WriteRunStatus",
  // The write that begins the policy again (its repeat count).
  WriteRepeat = "WriteRepeat",
  // The claim that starts a run that waited (claimWaitingRun).
  ClaimStart = "ClaimStart",
  // The read of the incident's state, for the page of runs.
  ReadRecords = "ReadRecords",
  // A move on's claim given back (giveBackEscalationAdvance).
  GiveBackClaim = "GiveBackClaim",
}

interface PlannedFailure {
  // How many more calls fail.
  times: number;
  // Which calls fail: all of them when left out.
  when?: ((args: Array<unknown>) => boolean) | undefined;
  error: () => unknown;
  // The process stops at it.
  stops: boolean;
}

type AnyFunction = (...args: Array<any>) => any;

// A read of escalation rules, as the services ask for it.
interface RuleRead {
  query?: Record<string, unknown> | undefined;
  sort?: { order?: unknown } | undefined;
}

const CREATED_STATE: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-0000000007a1",
);
const ACKNOWLEDGED_STATE: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-0000000007a2",
);
const RESOLVED_STATE: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-0000000007a3",
);

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

// A TypeORM FindOperator for IS NULL: read by its type, as typeorm is not App's.
function isNullOperator(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "isNull"
  );
}

// A TypeORM FindOperator for IS NOT NULL: Not(IsNull()).
function isNotNullOperator(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "not" &&
    isNullOperator((value as { child?: unknown }).child)
  );
}

export default class PolicyRunFailureWorld extends EmptyLevelWorld {
  // What Redis holds, by namespace and key.
  public cache: Map<string, string> = new Map();
  public warnings: Array<string> = [];
  // The process stopped this tick: nothing it writes lands.
  public stopped: boolean = false;
  // The incident is gone.
  public isIncidentGone: boolean = false;
  // The incident is resolved.
  public isRecordResolved: boolean = false;
  // Every run read by the worker's page reads, as it was read.
  public pageReads: number = 0;

  private planned: Map<FailurePoint, Array<PlannedFailure>> = new Map();
  private workerTick: (() => Promise<void>) | null = null;

  public override install(): void {
    super.install();

    jest.spyOn(logger, "warn").mockImplementation(((message: unknown) => {
      this.warnings.push(String(message));
    }) as never);

    this.installRecords();
    this.installCache();
    this.installRepository();
    this.installFailurePoints();
  }

  // The tick the worker registered with RunCron as it was imported.
  public useWorkerTick(tick: () => Promise<void>): void {
    this.workerTick = tick;
  }

  /*
   * Time passes, then the worker's tick runs - and a process that stopped
   * in it is a fresh one at the next.
   */
  public async workerTickAfter(minutes: number): Promise<void> {
    this.clock = new Date(this.clock.getTime() + minutes * 60 * 1000);
    this.pageReads++;

    try {
      await this.workerTick!();
    } finally {
      this.stopped = false;
    }
  }

  // The next `times` calls at `point` (that `when` picks) fail with `error`.
  public failAt(
    point: FailurePoint,
    options: {
      times?: number | undefined;
      when?: ((args: Array<unknown>) => boolean) | undefined;
      error?: (() => unknown) | undefined;
    } = {},
  ): void {
    this.plan(point, {
      times: options.times ?? 1,
      when: options.when,
      error: options.error || connectionReset,
      stops: false,
    });
  }

  // The process stops at the next call at `point` that `when` picks.
  public crashAt(
    point: FailurePoint,
    options: { when?: ((args: Array<unknown>) => boolean) | undefined } = {},
  ): void {
    this.plan(point, {
      times: 1,
      when: options.when,
      error: (): unknown => {
        return new ProcessStopped();
      },
      stops: true,
    });
  }

  // Every call at `point` fails, from now on.
  public failAlwaysAt(point: FailurePoint, error?: () => unknown): void {
    this.failAt(point, { times: Number.MAX_SAFE_INTEGER, error: error });
  }

  public stopFailing(): void {
    this.planned.clear();
  }

  // ---- reading what happened -------------------------------------------

  // How many times a person was paged by a rule.
  public timesPaged(
    userId: ObjectID,
    rule: OnCallDutyPolicyEscalationRule,
  ): number {
    return this.pages.filter((page: PageEvent) => {
      return (
        sameKey(page.userId, userId) && page.ruleId === rule.id!.toString()
      );
    }).length;
  }

  // Every page, by name, rule order and minute since `since`: "Ana Lopez L1 @ 0".
  public pagesSince(since: Date): Array<string> {
    return this.pages.map((page: PageEvent): string => {
      const rule: OnCallDutyPolicyEscalationRule | undefined = this.rules.find(
        (candidate: OnCallDutyPolicyEscalationRule) => {
          return candidate.id!.toString() === page.ruleId;
        },
      );

      return `${NAMES[page.userId] || page.userId} L${rule?.order} @ ${Math.round(
        (page.at.getTime() - since.getTime()) / 60000,
      )}`;
    });
  }

  // Whether a person was paged more than once by one rule in one pass.
  public hasAnybodyBeenPagedTwiceByARuleInAPass(): boolean {
    const seen: Set<string> = new Set();

    for (const page of this.pages) {
      const key: string = `${page.userId}|${page.ruleId}|${this.passOf(page)}`;

      if (seen.has(key)) {
        return true;
      }

      seen.add(key);
    }

    return false;
  }

  // The failed tries Redis keeps for the run, if any.
  public keptFailures(): Record<string, unknown> | null {
    const value: string | undefined = this.cache.get(
      `on-call-policy-run-failures-${this.run.id!.toString()}`,
    );

    return value ? (JSON.parse(value) as Record<string, unknown>) : null;
  }

  // ---- what the worker reads besides the runs --------------------------

  /*
   * The pass a page was in: repeats of the policy page the same rules again,
   * once per pass, and that is no page twice.
   */
  private passOf(page: PageEvent): number {
    const passStarts: Array<Date> = this.passStartedAt;
    let pass: number = 0;

    for (const startedAt of passStarts) {
      if (page.at.getTime() >= startedAt.getTime()) {
        pass++;
      }
    }

    return pass;
  }

  // When each pass of the policy began, as the repeat count was written.
  private passStartedAt: Array<Date> = [];

  private installRecords(): void {
    jest.spyOn(IncidentService, "findBy").mockImplementation((async (args: {
      query: Record<string, unknown>;
    }) => {
      this.hit(FailurePoint.ReadRecords, [args]);

      if (this.isIncidentGone) {
        return [];
      }

      const incident: Incident = new Incident();
      incident.id = INCIDENT_ID;
      incident.projectId = PROJECT_ID;
      incident.currentIncidentStateId = this.isRecordResolved
        ? RESOLVED_STATE
        : this.isRecordAcknowledged
          ? ACKNOWLEDGED_STATE
          : CREATED_STATE;
      return [incident];
    }) as never);

    jest.spyOn(IncidentStateService, "findBy").mockImplementation((async () => {
      return [
        [CREATED_STATE, 1, "isCreatedState"],
        [ACKNOWLEDGED_STATE, 2, "isAcknowledgedState"],
        [RESOLVED_STATE, 3, "isResolvedState"],
      ].map(([id, order, flag]: Array<unknown>) => {
        const state: IncidentState = new IncidentState();
        state.id = id as ObjectID;
        state.projectId = PROJECT_ID;
        state.order = order as number;
        (state as unknown as Record<string, boolean>)[flag as string] = true;
        return state;
      });
    }) as never);
  }

  // Redis, in memory, outside the process: what it holds outlives a restart.
  private installCache(): void {
    jest.spyOn(GlobalCache, "getString").mockImplementation((async (
      namespace: string,
      key: string,
    ) => {
      return this.cache.get(`${namespace}-${key}`) || null;
    }) as never);

    jest.spyOn(GlobalCache, "getStrings").mockImplementation((async (
      namespace: string,
      keys: Array<string>,
    ) => {
      return keys.map((key: string) => {
        return this.cache.get(`${namespace}-${key}`) || null;
      });
    }) as never);

    jest.spyOn(GlobalCache, "setString").mockImplementation((async (
      namespace: string,
      key: string,
      value: string,
    ) => {
      this.throwIfStopped();
      this.cache.set(`${namespace}-${key}`, value);
    }) as never);

    jest.spyOn(GlobalCache, "deleteKey").mockImplementation((async (
      namespace: string,
      key: string,
    ) => {
      this.throwIfStopped();
      this.cache.delete(`${namespace}-${key}`);
    }) as never);
  }

  /*
   * The run table's own atomic UPDATE ... WHERE, as the handing over of a
   * run whose start failed and the giving back of a claim write it.
   */
  private installRepository(): void {
    const repository: {
      update: (
        where: Record<string, unknown>,
        values: Record<string, unknown>,
      ) => Promise<{ affected: number }>;
    } = {
      update: async (
        where: Record<string, unknown>,
        values: Record<string, unknown>,
      ): Promise<{ affected: number }> => {
        this.throwIfStopped();

        const matches: Array<OnCallDutyPolicyExecutionLog> = this.runs.filter(
          (run: OnCallDutyPolicyExecutionLog) => {
            return Object.entries(where).every(
              ([column, expected]: [string, unknown]): boolean => {
                const actual: unknown = (
                  run as unknown as Record<string, unknown>
                )[column === "_id" ? "_id" : column];

                if (isNullOperator(expected)) {
                  return actual === null || actual === undefined;
                }

                if (isNotNullOperator(expected)) {
                  return actual !== null && actual !== undefined;
                }

                if (expected instanceof Date) {
                  return (
                    actual !== null &&
                    actual !== undefined &&
                    new Date(actual as Date).getTime() === expected.getTime()
                  );
                }

                return sameKey(actual, expected);
              },
            );
          },
        );

        for (const run of matches) {
          Object.assign(run, values);

          if (typeof values["status"] === "string") {
            this.runStatuses.push(values["status"] as OnCallDutyPolicyStatus);
          }
        }

        return { affected: matches.length };
      },
    };

    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "getRepository")
      .mockReturnValue(repository as never);
  }

  /*
   * Each step that can fail, wrapping what the world answers it with: a
   * planned failure is thrown first; a process that stopped writes nothing.
   */
  private installFailurePoints(): void {
    this.wrap(
      OnCallDutyPolicyExecutionLogService,
      "claimEscalationAdvance",
      (args: Array<unknown>) => {
        this.throwIfStopped();
        this.hit(FailurePoint.ClaimMoveOn, args);
      },
    );

    /*
     * A run starts at its policy's first rule, read as its lowest place
     * (findFirstOfPolicy, #9369): a read that asks for no order, the rules
     * sorted by it. A failure planned for one level's read - by its order -
     * is told the order of the rule that read picks, as a read of the
     * policy's levels is told the level the run moves on to (below).
     */
    this.wrap(
      OnCallDutyPolicyEscalationRuleService,
      "findOneBy",
      (args: Array<unknown>) => {
        this.hit(FailurePoint.ReadNextRule, this.withOrderItPicks(args));
      },
    );

    /*
     * A run moves on by reading its policy's levels, and picking the next
     * among them (OnCallRunLevel, issue #9036): that read is the read of the
     * rule it moves on to. A failure planned for one level's read - by its
     * order - is told the order of the level the run would move on to: the
     * next, or the first again for a policy that repeats.
     */
    this.wrap(
      OnCallDutyPolicyEscalationRuleService,
      "findBy",
      (args: Array<unknown>) => {
        const query: Record<string, unknown> =
          (args[0] as { query?: Record<string, unknown> } | undefined)?.query ||
          {};

        this.hit(FailurePoint.ReadNextRule, [
          {
            ...(args[0] as Record<string, unknown>),
            query: { ...query, order: this.nextOrder() },
          },
          ...args.slice(1),
        ]);
      },
    );

    this.wrap(
      OnCallDutyPolicyEscalationRuleService,
      "findOneById",
      (args: Array<unknown>) => {
        this.hit(FailurePoint.ReadStartingRule, args);
      },
    );

    this.wrap(
      OnCallDutyPolicyExecutionLogService,
      "updateOneById",
      (args: Array<unknown>) => {
        this.throwIfStopped();

        const data: Record<string, unknown> =
          ((args[0] as { data?: Record<string, unknown> }).data as Record<
            string,
            unknown
          >) || {};

        if (data["lastExecutedEscalationRuleId"] !== undefined) {
          this.hit(FailurePoint.RecordRule, args);
        }

        if (data["onCallPolicyExecutionRepeatCount"] !== undefined) {
          this.hit(FailurePoint.WriteRepeat, args);
          this.passStartedAt.push(new Date(this.clock));
        }

        if (data["status"] !== undefined) {
          this.hit(FailurePoint.WriteRunStatus, args);
        }
      },
    );

    this.wrap(
      UserNotificationRuleService,
      "startUserNotificationRulesExecution",
      (args: Array<unknown>) => {
        this.throwIfStopped();
        this.hit(FailurePoint.PagePerson, args);
      },
    );

    this.wrap(
      OnCallDutyPolicyExecutionLogService,
      "claimWaitingRun",
      (args: Array<unknown>) => {
        this.throwIfStopped();
        this.hit(FailurePoint.ClaimStart, args);
      },
    );

    /*
     * The real give-back, over the run table's own UPDATE: a planned
     * failure is the database's, thrown to a caller that asks for it and
     * swallowed otherwise, as the real one does.
     */
    const realGiveBack: AnyFunction =
      OnCallDutyPolicyExecutionLogService.giveBackEscalationAdvance.bind(
        OnCallDutyPolicyExecutionLogService,
      );

    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "giveBackEscalationAdvance")
      .mockImplementation((async (data: { throwOnError?: boolean }) => {
        try {
          this.throwIfStopped();
          this.hit(FailurePoint.GiveBackClaim, [data]);
        } catch (err) {
          if (data.throwOnError) {
            throw err;
          }

          return false;
        }

        return await realGiveBack(data);
      }) as never);
  }

  private wrap(
    target: unknown,
    method: string,
    before: (args: Array<unknown>) => void,
  ): void {
    const base: AnyFunction | undefined = (
      (target as Record<string, unknown>)[method] as unknown as {
        getMockImplementation: () => AnyFunction | undefined;
      }
    ).getMockImplementation();

    jest.spyOn(target as never, method as never).mockImplementation((async (
      ...args: Array<unknown>
    ) => {
      before(args);
      return await base!.apply(target, args);
    }) as never);
  }

  /*
   * The order of the level the run paging now would move on to: the next
   * of its policy's levels, or its first for a new pass.
   */
  private nextOrder(): number | undefined {
    const run: OnCallDutyPolicyExecutionLog | undefined = this.runs.find(
      (candidate: OnCallDutyPolicyExecutionLog) => {
        return candidate.status === OnCallDutyPolicyStatus.Executing;
      },
    );

    if (!run) {
      return undefined;
    }

    return (
      getOnCallRunNextLevel({ run: run, levels: this.rules }) ||
      getOnCallPolicyFirstLevel(this.rules)
    )?.order;
  }

  /*
   * A read of one rule, its query naming the order of the rule it picks:
   * the order it asks for, or - a read of the policy's first rule, which
   * asks for none and sorts by it (findFirstOfPolicy) - the lowest place.
   */
  private withOrderItPicks(args: Array<unknown>): Array<unknown> {
    const read: RuleRead = (args[0] as RuleRead | undefined) || {};
    const query: Record<string, unknown> = read.query || {};

    if (
      query["order"] !== undefined ||
      read.sort?.order !== SortOrder.Ascending
    ) {
      return args;
    }

    return [
      {
        ...read,
        query: {
          ...query,
          order: getOnCallPolicyFirstLevel(this.rules)?.order,
        },
      },
      ...args.slice(1),
    ];
  }

  private plan(point: FailurePoint, failure: PlannedFailure): void {
    const list: Array<PlannedFailure> = this.planned.get(point) || [];
    list.push(failure);
    this.planned.set(point, list);
  }

  // A call at `point`: it fails if a failure is planned for it.
  private hit(point: FailurePoint, args: Array<unknown>): void {
    const list: Array<PlannedFailure> = this.planned.get(point) || [];
    const failure: PlannedFailure | undefined = list.find(
      (candidate: PlannedFailure) => {
        return candidate.times > 0 && (!candidate.when || candidate.when(args));
      },
    );

    if (!failure) {
      return;
    }

    failure.times--;

    if (failure.stops) {
      this.stopped = true;
    }

    throw failure.error();
  }

  private throwIfStopped(): void {
    if (this.stopped) {
      throw new ProcessStopped();
    }
  }
}

export { CREATED_STATE, ACKNOWLEDGED_STATE };
