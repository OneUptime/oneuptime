import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserOnCallLog from "Common/Models/DatabaseModels/UserOnCallLog";
import UserOnCallLogTimeline from "Common/Models/DatabaseModels/UserOnCallLogTimeline";
import UserPush from "Common/Models/DatabaseModels/UserPush";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import OnCallDutyPolicyExecutionLogTimelineService from "Common/Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import PushNotificationService from "Common/Server/Services/PushNotificationService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "Common/Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import UserService from "Common/Server/Services/UserService";
import Project from "Common/Models/DatabaseModels/Project";
import CustomNotificationChannelService from "Common/Server/Services/CustomNotificationChannelService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import IncidentSeverityService from "Common/Server/Services/IncidentSeverityService";
import OnCallNotificationAlertingService from "Common/Server/Services/OnCallNotificationAlertingService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserCallService from "Common/Server/Services/UserCallService";
import UserEmailService from "Common/Server/Services/UserEmailService";
import UserMattermostService from "Common/Server/Services/UserMattermostService";
import UserMicrosoftTeamsService from "Common/Server/Services/UserMicrosoftTeamsService";
import UserPushService from "Common/Server/Services/UserPushService";
import UserSlackService from "Common/Server/Services/UserSlackService";
import UserSmsService from "Common/Server/Services/UserSmsService";
import UserTelegramService from "Common/Server/Services/UserTelegramService";
import UserWhatsAppService from "Common/Server/Services/UserWhatsAppService";
import logger from "Common/Server/Utils/Logger";
import ProjectMembership from "Common/Server/Utils/TeamMember/ProjectMembership";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import PushDeviceType from "Common/Types/PushNotification/PushDeviceType";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import { jest } from "@jest/globals";

/*
 * A PERSON BEING PAGED, IN MEMORY - AND THE DATABASE FAILING UNDER IT AT
 * ANY STEP (issues #8407, #8408).
 *
 * A person's on-call log about an incident, their push rules ("notify at
 * once", "after 5 minutes"...) and their phones, kept here the way the
 * database and Redis keep them, and driven through the real code: the
 * log's start (UserOnCallLogService.onCreateSuccess), the person's-log
 * worker's tick (UserOnCallLog:ExecutePendingExecutions), the stuck-log
 * job's (UserOnCallLog:TimeoutStuckExecutions), each rule's claim and its
 * give-back - the real UPDATEs, answered by this world as Postgres answers
 * them - and the real delivery half (deliverNotificationForRule) as far as
 * the push sender, which is where a page leaves OneUptime.
 *
 * Any step can be made to fail (failAt), as the database or the network
 * fails it. A worker that restarts (crashAt) is a process that stops at a
 * step and never runs another line: from there on nothing it writes
 * reaches the database or Redis - not its catch, not its give-back - until
 * the next tick, a fresh process with what the database and Redis kept.
 */

export enum PersonPageStep {
  // The worker's read of the person's rules.
  ReadRules = "ReadRules",
  // A rule's claim on the log (its atomic UPDATE).
  Claim = "Claim",
  // The send's read of its rule.
  ReadRule = "ReadRule",
  // The send's read of the project's Twilio settings.
  ReadTwilioSettings = "ReadTwilioSettings",
  // The send's read of the incident.
  ReadIncident = "ReadIncident",
  // The write of a notification's row, just before it is handed to its sender.
  WriteNotification = "WriteNotification",
  // The push's message, built after its row is written: its link to the incident.
  BuildMessage = "BuildMessage",
  // The push sender itself (its request fails after it was handed over).
  Push = "Push",
  // A rule's claim given back (its conditional UPDATE).
  GiveBack = "GiveBack",
  // A write of the log's status.
  WriteStatus = "WriteStatus",
  // A read of whether the person is a member of the project (ProjectMembership.isMember).
  ReadMembership = "ReadMembership",
  // The fallback's read of the person's verified push device.
  ReadFallbackMethods = "ReadFallbackMethods",
}

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

interface PlannedFailure {
  times: number;
  when?: ((args: Array<unknown>) => boolean) | undefined;
  error: () => unknown;
  stops: boolean;
}

export interface Push {
  logId: string;
  ruleId: string;
  token: string;
  minute: number;
}

export const PROJECT_ID: ObjectID = new ObjectID(
  "84080000-0000-4000-8000-000000000001",
);
export const PERSON_ID: ObjectID = new ObjectID(
  "84080000-0000-4000-8000-000000000002",
);
export const INCIDENT_ID: ObjectID = new ObjectID(
  "84080000-0000-4000-8000-000000000003",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "84080000-0000-4000-8000-000000000004",
);
const CREATED_STATE: ObjectID = new ObjectID(
  "84080000-0000-4000-8000-000000000005",
);
const ACKNOWLEDGED_STATE: ObjectID = new ObjectID(
  "84080000-0000-4000-8000-000000000006",
);

export const START: Date = new Date("2026-11-15T03:00:00.000Z");
const MINUTE: number = 60 * 1000;

const USER_LOG_FAILURES_NAMESPACE: string = "on-call-user-log-failures";
const CLAIMS_IN_FLIGHT_NAMESPACE: string = "on-call-rule-claims-in-flight";

function uuid(prefix: string, index: number): ObjectID {
  return new ObjectID(
    `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
}

// The values a FindOperator was made with, in order: In's list, Raw's parameters.
function operatorValues(operator: unknown): Array<unknown> {
  const candidate: {
    objectLiteralParameters?: Record<string, unknown>;
    value?: unknown;
  } = (operator || {}) as {
    objectLiteralParameters?: Record<string, unknown>;
    value?: unknown;
  };

  if (candidate.objectLiteralParameters) {
    return Object.values(candidate.objectLiteralParameters);
  }

  if (Array.isArray(candidate.value)) {
    return candidate.value;
  }

  return [candidate.value ?? operator];
}

export default class PersonPageFailureWorld {
  public clock: Date = new Date(START);
  public logs: Array<UserOnCallLog> = [];
  public rules: Array<UserNotificationRule> = [];
  // Every notification row written, as written.
  public notifications: Array<{
    id: string;
    logId: string;
    ruleId: string;
    createdAt: Date;
  }> = [];
  // Every push handed to the push sender: a page that left OneUptime.
  public pushes: Array<Push> = [];
  // What Redis holds, by namespace and key.
  public cache: Map<string, string> = new Map();
  public isRedisDown: boolean = false;
  public isIncidentAcknowledged: boolean = false;
  /*
   * The person's verified phone the fallback pages when no rule of theirs
   * matches (executeFallbackNotification); none when null.
   */
  public fallbackDevice: UserPush | null = null;
  // Every page the project's admins were told could not reach the person by a rule.
  public undeliverableAlerts: number = 0;
  public errors: Array<string> = [];
  public warnings: Array<string> = [];
  // Every status written to a log, in order.
  public statusWrites: Array<{
    logId: string;
    status: UserNotificationExecutionStatus;
    statusMessage?: string | undefined;
  }> = [];
  // The process stopped this tick: nothing it writes lands.
  public stopped: boolean = false;
  // Each step's calls, counted.
  public calls: Map<PersonPageStep, number> = new Map();

  private planned: Map<PersonPageStep, Array<PlannedFailure>> = new Map();
  private workerTick: (() => Promise<void>) | null = null;
  private stuckJobTick: (() => Promise<void>) | null = null;

  // ---- making the world ------------------------------------------------

  // A push rule of the person's, `notifyAfterMinutes` into the page.
  public rule(index: number, notifyAfterMinutes: number): UserNotificationRule {
    const device: UserPush = new UserPush();
    device.id = uuid("84081111", index);
    device.userId = PERSON_ID;
    device.deviceToken = `ExponentPushToken[phone-${index}]`;
    device.deviceType = PushDeviceType.iOS;
    device.isVerified = true;

    const rule: UserNotificationRule = new UserNotificationRule();
    rule.id = uuid("84082222", index);
    rule.projectId = PROJECT_ID;
    rule.userId = PERSON_ID;
    rule.ruleType = NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;
    rule.notifyAfterMinutes = notifyAfterMinutes;
    rule.userPush = device;
    rule.userPushId = device.id;

    this.rules.push(rule);
    return rule;
  }

  /*
   * A log paging the person about the incident, written `minutesAgo` ago:
   * Executing, as the worker reads it, unless it is still starting.
   */
  public log(
    index: number,
    data: {
      minutesAgo?: number;
      status?: UserNotificationExecutionStatus;
    } = {},
  ): UserOnCallLog {
    const log: UserOnCallLog = new UserOnCallLog();
    log.id = uuid("84083333", index);
    log.projectId = PROJECT_ID;
    log.userId = PERSON_ID;
    log.status = data.status || UserNotificationExecutionStatus.Executing;
    log.createdAt = new Date(
      this.clock.getTime() - (data.minutesAgo ?? 0) * MINUTE,
    );
    log.executedNotificationRules = {};
    log.userNotificationEventType = UserNotificationEventType.IncidentCreated;
    log.triggeredByIncidentId = INCIDENT_ID;
    log.onCallDutyPolicyExecutionLogTimelineId = uuid("84084444", index);

    this.logs.push(log);
    return log;
  }

  public install(): void {
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((() => {
      return new Date(this.clock);
    }) as never);

    jest.spyOn(OneUptimeDate, "getSomeMinutesAgo").mockImplementation(((
      minutes: number | PositiveNumber,
    ) => {
      const value: number =
        minutes instanceof PositiveNumber ? minutes.toNumber() : minutes;
      return new Date(this.clock.getTime() - value * MINUTE);
    }) as never);

    for (const level of ["debug", "info"] as const) {
      jest.spyOn(logger, level).mockImplementation((() => {}) as never);
    }

    jest.spyOn(logger, "warn").mockImplementation(((message: unknown) => {
      this.warnings.push(String(message));
    }) as never);

    jest.spyOn(logger, "error").mockImplementation(((message: unknown) => {
      this.errors.push(
        message instanceof Error ? message.message : String(message),
      );
    }) as never);

    this.installCache();
    this.installLogs();
    this.installRules();
    this.installIncident();
    this.installDelivery();
    this.installFallback();
  }

  // The ticks the jobs registered with RunCron as they were imported.
  public useTicks(data: {
    worker: () => Promise<void>;
    stuckJob: () => Promise<void>;
  }): void {
    this.workerTick = data.worker;
    this.stuckJobTick = data.stuckJob;
  }

  // ---- what happens ------------------------------------------------------

  /*
   * Time passes, then the person's-log worker's tick runs - and a process
   * that stopped in it is a fresh one at the next.
   */
  public async workerTickAfter(minutes: number): Promise<void> {
    this.clock = new Date(this.clock.getTime() + minutes * MINUTE);

    try {
      await this.workerTick!();
    } finally {
      this.stopped = false;
    }
  }

  // Time passes, then the stuck-log job's tick runs.
  public async stuckJobTickAfter(minutes: number): Promise<void> {
    this.clock = new Date(this.clock.getTime() + minutes * MINUTE);

    try {
      await this.stuckJobTick!();
    } finally {
      this.stopped = false;
    }
  }

  // A minute passes, and both jobs run, as they do in production.
  public async minutePasses(): Promise<void> {
    await this.stuckJobTickAfter(1);
    await this.workerTickAfter(0);
  }

  /*
   * The log is written and starts, as the page that wrote it starts it
   * (UserOnCallLogService.onCreateSuccess): Scheduled, then Started, its
   * "notify at once" rules sent, then Executing. What it throws, it throws
   * at the page that wrote it.
   */
  public async startLog(log: UserOnCallLog): Promise<void> {
    log.status = UserNotificationExecutionStatus.Scheduled;

    try {
      await (
        UserOnCallLogService as unknown as {
          onCreateSuccess: (onCreate: unknown, item: UserOnCallLog) => unknown;
        }
      ).onCreateSuccess({}, Object.assign(new UserOnCallLog(), log));
    } finally {
      this.stopped = false;
    }
  }

  // The next `times` calls at `step` (that `when` picks) fail with `error`.
  public failAt(
    step: PersonPageStep,
    options: {
      times?: number | undefined;
      when?: ((args: Array<unknown>) => boolean) | undefined;
      error?: (() => unknown) | undefined;
    } = {},
  ): void {
    this.plan(step, {
      times: options.times ?? 1,
      when: options.when,
      error: options.error || connectionReset,
      stops: false,
    });
  }

  // Every call at `step` fails, from now on.
  public failAlwaysAt(step: PersonPageStep, error?: () => unknown): void {
    this.failAt(step, { times: Number.MAX_SAFE_INTEGER, error: error });
  }

  // The process stops at the next call at `step` that `when` picks.
  public crashAt(
    step: PersonPageStep,
    options: { when?: ((args: Array<unknown>) => boolean) | undefined } = {},
  ): void {
    this.plan(step, {
      times: 1,
      when: options.when,
      error: (): unknown => {
        return new ProcessStopped();
      },
      stops: true,
    });
  }

  public stopFailing(): void {
    this.planned.clear();
  }

  // ---- reading what happened ---------------------------------------------

  // How many pushes a rule sent on a log.
  public timesPushed(log: UserOnCallLog, rule: UserNotificationRule): number {
    return this.pushes.filter((push: Push) => {
      return (
        push.logId === log.id!.toString() && push.ruleId === rule.id!.toString()
      );
    }).length;
  }

  // Every push, as "rule index @ minute": "1 @ 0".
  public pushLine(): Array<string> {
    return this.pushes.map((push: Push): string => {
      const index: number = this.rules.findIndex(
        (rule: UserNotificationRule) => {
          return rule.id!.toString() === push.ruleId;
        },
      );
      return `${index + 1} @ ${push.minute}`;
    });
  }

  public statusOf(log: UserOnCallLog): UserNotificationExecutionStatus {
    return this.logById(log.id)!.status!;
  }

  public statusMessageOf(log: UserOnCallLog): string | undefined {
    return this.logById(log.id)!.statusMessage;
  }

  // The rule keys claimed on the log.
  public claimsOn(log: UserOnCallLog): Array<string> {
    return Object.keys(this.logById(log.id)!.executedNotificationRules || {});
  }

  // The failed tries Redis keeps for the log, if any.
  public keptFailures(log: UserOnCallLog): Record<string, unknown> | null {
    const value: string | undefined = this.cache.get(
      `${USER_LOG_FAILURES_NAMESPACE}-${log.id!.toString()}`,
    );

    return value ? (JSON.parse(value) as Record<string, unknown>) : null;
  }

  // The claim Redis keeps in flight for the log, if any.
  public claimInFlight(log: UserOnCallLog): Record<string, unknown> | null {
    const value: string | undefined = this.cache.get(
      `${CLAIMS_IN_FLIGHT_NAMESPACE}-${log.id!.toString()}`,
    );

    return value ? (JSON.parse(value) as Record<string, unknown>) : null;
  }

  public callsAt(step: PersonPageStep): number {
    return this.calls.get(step) || 0;
  }

  public minutesSinceStart(): number {
    return Math.round((this.clock.getTime() - START.getTime()) / MINUTE);
  }

  // ---- the database and Redis ----------------------------------------------

  private logById(id: unknown): UserOnCallLog | undefined {
    return this.logs.find((candidate: UserOnCallLog) => {
      return candidate.id!.toString() === String(id);
    });
  }

  // Redis, in memory, outside the process: what it holds outlives a restart.
  private installCache(): void {
    const isDown: () => void = (): void => {
      if (this.isRedisDown) {
        throw new Error("Cache is not connected");
      }
    };

    jest.spyOn(GlobalCache, "getStrings").mockImplementation((async (
      namespace: string,
      keys: Array<string>,
    ) => {
      this.throwIfStopped();
      isDown();
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
      isDown();
      this.cache.set(`${namespace}-${key}`, value);
    }) as never);

    jest.spyOn(GlobalCache, "deleteKey").mockImplementation((async (
      namespace: string,
      key: string,
    ) => {
      this.throwIfStopped();
      isDown();
      this.cache.delete(`${namespace}-${key}`);
    }) as never);
  }

  private installLogs(): void {
    // The worker's read: the logs still Executing, in _id order.
    jest
      .spyOn(UserOnCallLogService, "findBy")
      .mockImplementation((async (args: {
        query: Record<string, unknown>;
        limit: number;
      }) => {
        this.throwIfStopped();

        return this.logs
          .filter((log: UserOnCallLog) => {
            return log.status === args.query["status"];
          })
          .sort((a: UserOnCallLog, b: UserOnCallLog) => {
            return a.id!.toString() < b.id!.toString() ? -1 : 1;
          })
          .slice(0, args.limit)
          .map((log: UserOnCallLog) => {
            const copy: UserOnCallLog = Object.assign(new UserOnCallLog(), log);
            copy.executedNotificationRules = {
              ...(log.executedNotificationRules || {}),
            };
            return copy;
          });
      }) as never);

    // The stuck-log job's reads: by status, and when they were written.
    jest
      .spyOn(UserOnCallLogService, "findAllBy")
      .mockImplementation((async (args: { query: Record<string, unknown> }) => {
        this.throwIfStopped();

        const statuses: Array<unknown> =
          typeof args.query["status"] === "string"
            ? [args.query["status"]]
            : operatorValues(args.query["status"]).flat();
        const bounds: Array<Date> = operatorValues(args.query["createdAt"]).map(
          (value: unknown) => {
            return new Date(value as Date);
          },
        );
        const [after, before] =
          bounds.length === 2 ? [bounds[0]!, bounds[1]!] : [null, bounds[0]!];

        return this.logs
          .filter((log: UserOnCallLog) => {
            const at: number = log.createdAt!.getTime();

            return (
              statuses.includes(log.status) &&
              (after ? at >= after.getTime() : true) &&
              (after ? at <= before.getTime() : at < before.getTime())
            );
          })
          .map((log: UserOnCallLog) => {
            return Object.assign(new UserOnCallLog(), log);
          });
      }) as never);

    jest
      .spyOn(UserOnCallLogService, "findOneById")
      .mockImplementation((async (args: { id: ObjectID }) => {
        this.throwIfStopped();
        const log: UserOnCallLog | undefined = this.logById(args.id);
        return log ? Object.assign(new UserOnCallLog(), log) : null;
      }) as never);

    // A write lands on the table, as the database's would.
    jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockImplementation((async (args: {
        id: ObjectID;
        data: {
          status?: UserNotificationExecutionStatus;
          statusMessage?: string;
          executedNotificationRules?: Record<string, unknown>;
        };
      }) => {
        this.throwIfStopped();

        if (args.data.status) {
          this.hit(PersonPageStep.WriteStatus, [args]);
        }

        const log: UserOnCallLog | undefined = this.logById(args.id);

        if (!log) {
          return;
        }

        if (args.data.executedNotificationRules) {
          log.executedNotificationRules = {
            ...args.data.executedNotificationRules,
          } as never;
        }

        if (args.data.status) {
          log.status = args.data.status;

          if (args.data.statusMessage !== undefined) {
            log.statusMessage = args.data.statusMessage;
          }

          this.statusWrites.push({
            logId: args.id.toString(),
            status: args.data.status,
            ...(args.data.statusMessage !== undefined
              ? { statusMessage: args.data.statusMessage }
              : {}),
          });
        }
      }) as never);

    // The claim's and the give-back's own UPDATEs, as Postgres answers them.
    jest.spyOn(UserOnCallLogService, "getRepository").mockReturnValue({
      manager: {
        query: async (
          sql: string,
          parameters: Array<unknown>,
        ): Promise<Array<{ _id: string }>> => {
          this.throwIfStopped();

          const [logId, key, claimedAt] = parameters as [
            string,
            string,
            string,
          ];
          const log: UserOnCallLog | undefined = this.logById(logId);
          const executed: Record<string, unknown> =
            (log?.executedNotificationRules || {}) as Record<string, unknown>;

          if (sql.includes("jsonb_set")) {
            this.hit(PersonPageStep.Claim, [key]);

            if (!log || key in executed) {
              return [];
            }

            log.executedNotificationRules = {
              ...executed,
              [key]: claimedAt,
            } as never;

            return [{ _id: logId }];
          }

          this.hit(PersonPageStep.GiveBack, [key]);

          if (!log || executed[key] !== claimedAt) {
            return [];
          }

          const remaining: Record<string, unknown> = { ...executed };
          delete remaining[key];
          log.executedNotificationRules = remaining as never;

          return [{ _id: logId }];
        },
      },
    } as never);

    // Everybody here is a member of the project.
    jest.spyOn(ProjectMembership, "getMemberKeys").mockImplementation((async (
      pairs: Array<{ projectId: ObjectID; userId: ObjectID }>,
    ) => {
      return new Set(
        pairs.map((pair: { projectId: ObjectID; userId: ObjectID }) => {
          return ProjectMembership.getKey(pair.projectId, pair.userId);
        }),
      );
    }) as never);

    jest.spyOn(ProjectMembership, "isMember").mockImplementation((async () => {
      this.throwIfStopped();
      this.hit(PersonPageStep.ReadMembership, []);
      return true;
    }) as never);

    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "updateOneById")
      .mockImplementation((async () => {
        this.throwIfStopped();
      }) as never);
  }

  private installRules(): void {
    // The person's rules: the worker's read, and the start's read of its "notify at once" ones.
    jest
      .spyOn(UserNotificationRuleService, "findBy")
      .mockImplementation((async (args: { query: Record<string, unknown> }) => {
        this.throwIfStopped();

        const immediateOnly: boolean = args.query["notifyAfterMinutes"] === 0;

        if (!immediateOnly) {
          this.hit(PersonPageStep.ReadRules, [args]);
        }

        return this.rules
          .filter((rule: UserNotificationRule) => {
            return !immediateOnly || rule.notifyAfterMinutes === 0;
          })
          .map((rule: UserNotificationRule) => {
            return Object.assign(new UserNotificationRule(), rule);
          });
      }) as never);

    jest
      .spyOn(UserNotificationRuleService, "countBy")
      .mockImplementation((async () => {
        this.throwIfStopped();
        return new PositiveNumber(this.rules.length);
      }) as never);

    // The send's own read of its rule, by its id, with its phone.
    jest
      .spyOn(UserNotificationRuleService, "findOneById")
      .mockImplementation((async (args: { id: ObjectID }) => {
        this.throwIfStopped();
        this.hit(PersonPageStep.ReadRule, [args.id.toString()]);

        const rule: UserNotificationRule | undefined = this.rules.find(
          (candidate: UserNotificationRule) => {
            return candidate.id!.toString() === args.id.toString();
          },
        );

        return rule ? Object.assign(new UserNotificationRule(), rule) : null;
      }) as never);

    // The person reads English.
    jest.spyOn(UserService, "findOneById").mockResolvedValue(null as never);
  }

  private installIncident(): void {
    // The page's read of where the incident stands.
    jest.spyOn(IncidentService, "findBy").mockImplementation((async () => {
      this.throwIfStopped();

      const incident: Incident = new Incident();
      incident.id = INCIDENT_ID;
      incident.projectId = PROJECT_ID;
      incident.incidentSeverityId = SEVERITY_ID;
      incident.currentIncidentStateId = this.isIncidentAcknowledged
        ? ACKNOWLEDGED_STATE
        : CREATED_STATE;
      return [incident];
    }) as never);

    jest.spyOn(IncidentStateService, "findBy").mockImplementation((async () => {
      return [
        [CREATED_STATE, 1, "isCreatedState"],
        [ACKNOWLEDGED_STATE, 2, "isAcknowledgedState"],
      ].map(([id, order, flag]: Array<unknown>) => {
        const state: IncidentState = new IncidentState();
        state.id = id as ObjectID;
        state.projectId = PROJECT_ID;
        state.order = order as number;
        (state as unknown as Record<string, boolean>)[flag as string] = true;
        return state;
      });
    }) as never);

    // The incident, read by the start (its severity) and by each send.
    jest.spyOn(IncidentService, "findOneById").mockImplementation((async () => {
      this.throwIfStopped();
      this.hit(PersonPageStep.ReadIncident, []);

      return {
        id: INCIDENT_ID,
        projectId: PROJECT_ID,
        title: "Checkout is down",
        incidentNumber: 42,
        incidentNumberWithPrefix: "INC-42",
        incidentSeverityId: SEVERITY_ID,
      } as unknown as Incident;
    }) as never);

    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockImplementation((async () => {
        this.throwIfStopped();
        this.hit(PersonPageStep.BuildMessage, []);
        return URL.fromString("https://oneuptime.example.com/incident");
      }) as never);
  }

  // The delivery half's reads and writes, down to the push sender.
  private installDelivery(): void {
    jest
      .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
      .mockImplementation((async () => {
        this.throwIfStopped();
        this.hit(PersonPageStep.ReadTwilioSettings, []);
        return undefined;
      }) as never);

    jest
      .spyOn(UserOnCallLogTimelineService, "create")
      .mockImplementation((async (args: { data: UserOnCallLogTimeline }) => {
        this.throwIfStopped();
        this.hit(PersonPageStep.WriteNotification, [
          args.data.userNotificationLogId?.toString(),
        ]);

        const id: ObjectID = uuid("84085555", this.notifications.length + 1);

        this.notifications.push({
          id: id.toString(),
          logId: args.data.userNotificationLogId!.toString(),
          // The fallback pages through rules it never saves: no rule of its own.
          ruleId: args.data.userNotificationRuleId?.toString() || "",
          createdAt: new Date(this.clock),
        });

        const row: UserOnCallLogTimeline = new UserOnCallLogTimeline();
        row.id = id;
        return row;
      }) as never);

    // A notification's row, by its log and rule, written since a moment.
    jest
      .spyOn(UserOnCallLogTimelineService, "countBy")
      .mockImplementation((async (args: { query: Record<string, unknown> }) => {
        this.throwIfStopped();

        const since: Date = new Date(
          operatorValues(args.query["createdAt"])[0] as Date,
        );

        return new PositiveNumber(
          this.notifications.filter(
            (row: { logId: string; ruleId: string; createdAt: Date }) => {
              return (
                row.logId === String(args.query["userNotificationLogId"]) &&
                row.ruleId === String(args.query["userNotificationRuleId"]) &&
                row.createdAt.getTime() >= since.getTime()
              );
            },
          ).length,
        );
      }) as never);

    for (const method of ["updateOneById", "updateOneBy"]) {
      jest
        .spyOn(UserOnCallLogTimelineService as never, method as never)
        .mockImplementation((async () => {
          this.throwIfStopped();
        }) as never);
    }

    // The push sender: what reaches it left OneUptime.
    jest
      .spyOn(PushNotificationService, "sendPushNotification")
      .mockImplementation((async (
        request: { devices: Array<{ token: string }> },
        options: { userOnCallLogTimelineId: ObjectID },
      ) => {
        const row: { logId: string; ruleId: string } | undefined =
          this.notifications.find((candidate: { id: string }) => {
            return candidate.id === options.userOnCallLogTimelineId.toString();
          });

        this.pushes.push({
          logId: row!.logId,
          ruleId: row!.ruleId,
          token: request.devices[0]!.token,
          minute: this.minutesSinceStart(),
        });

        this.hit(PersonPageStep.Push, []);
      }) as never);
  }

  /*
   * What the start's no-rule handling and the fallback read: no opt-out, the
   * fallback on, and the person's one verified method - a phone - or none.
   */
  private installFallback(): void {
    jest
      .spyOn(UserNotificationRuleService, "findOneBy")
      .mockResolvedValue(null as never);

    jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
      this.throwIfStopped();
      const project: Project = new Project();
      project.id = PROJECT_ID;
      project.disableOnCallNotificationFallback = false;
      return project;
    }) as never);

    jest
      .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
      .mockResolvedValue(false as never);

    jest.spyOn(UserPushService, "findOneBy").mockImplementation((async () => {
      this.throwIfStopped();
      this.hit(PersonPageStep.ReadFallbackMethods, []);
      return this.fallbackDevice
        ? Object.assign(new UserPush(), this.fallbackDevice)
        : null;
    }) as never);

    for (const service of [
      UserEmailService,
      UserSmsService,
      UserCallService,
      UserWhatsAppService,
      UserTelegramService,
      UserSlackService,
      UserMicrosoftTeamsService,
      UserMattermostService,
    ]) {
      jest
        .spyOn(service as never, "findOneBy" as never)
        .mockResolvedValue(null as never);
    }

    jest
      .spyOn(CustomNotificationChannelService, "getChannelsPagingEveryone")
      .mockResolvedValue([] as never);

    jest
      .spyOn(OnCallNotificationAlertingService, "notifyOfUndeliverablePage")
      .mockImplementation((async () => {
        this.undeliverableAlerts++;
      }) as never);

    jest
      .spyOn(IncidentSeverityService, "findOneById")
      .mockResolvedValue({ name: "Sev1" } as never);
  }

  private plan(step: PersonPageStep, failure: PlannedFailure): void {
    const list: Array<PlannedFailure> = this.planned.get(step) || [];
    list.push(failure);
    this.planned.set(step, list);
  }

  // A call at `step`: counted, and it fails if a failure is planned for it.
  private hit(step: PersonPageStep, args: Array<unknown>): void {
    this.calls.set(step, (this.calls.get(step) || 0) + 1);

    const list: Array<PlannedFailure> = this.planned.get(step) || [];
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
