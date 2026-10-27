import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import ObjectID from "Common/Types/ObjectID";
import Query from "Common/Types/BaseDatabase/Query";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import logger from "Common/Server/Utils/Logger";
import AlertSeverityService from "Common/Server/Services/AlertSeverityService";
import IncidentSeverityService from "Common/Server/Services/IncidentSeverityService";
import UserEmailService from "Common/Server/Services/UserEmailService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import UserEmail from "Common/Models/DatabaseModels/UserEmail";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";

/*
 * Gap A of Docs/Internal/Roadmap/OnCallNotificationReadiness.md.
 *
 * A responder's default notification rules are written twice in their life:
 * when they join a project, and when they verify a notification method. Both
 * paths iterate the severities that exist AT THAT MOMENT. Nothing ever revisited
 * the question, so a severity created later - the "Sev4" somebody adds a year
 * in - had a notification rule for precisely nobody. Every incident on it
 * counted zero matching rules, wrote "No notification rules found for this user"
 * into an execution log, and paged no one. It is the highest-frequency way a
 * page goes missing.
 *
 * This job closes it. IncidentSeverityService.onCreateSuccess and
 * AlertSeverityService.onCreateSuccess enqueue it by name the moment a severity
 * is created (they duplicate JOB_NAME below verbatim - Common cannot import from
 * App), so in practice it runs within seconds. It ALSO runs on a schedule over
 * severities created in the recent past, which is what makes it safe: the Worker
 * queue dispatches on job name and hands the job function no payload, so the job
 * has to re-derive its own work set anyway, and re-deriving it means a lost
 * enqueue - Redis down, worker mid-deploy - costs minutes of latency instead of
 * a permanently uncovered severity.
 *
 * Every write it makes is guarded by what already exists, so running it twice
 * over the same severity is a pair of reads and nothing else. The guarding is
 * deliberately belt AND braces - a snapshot check, a per-row existence check
 * and a single-flight lock - because a duplicated rule is a duplicated page,
 * and a job that re-derives its own work set every five minutes over an
 * hour-wide window gets many, many chances to duplicate one.
 */

/*
 * Enqueued by name from Common/Server/Services/IncidentSeverityService.ts and
 * Common/Server/Services/AlertSeverityService.ts. Renaming this means renaming
 * it in both.
 */
const JOB_NAME: string =
  "OnCallDutyPolicy:BackfillNotificationRulesForNewSeverities";

/*
 * How far back the scheduled sweep looks. Comfortably longer than the schedule,
 * so a severity created while the worker was down or restarting is still picked
 * up by a later tick. The window is cheap because severity creation is rare:
 * in steady state it selects zero rows and the job ends after two reads.
 */
const BACKFILL_LOOKBACK_IN_MINUTES: number = 60;

/*
 * Single-flight lock for the sweep.
 *
 * The per-row existence check in createRule is a check-then-create, and
 * check-then-create is exactly what two sweeps running at the same instant
 * defeat: both read "no rule for this cell yet", both write one, and the
 * responder is paged twice for one incident. Nothing in the database settles
 * that on its own - UserNotificationRule carries no unique index over
 * (project, user, ruleType, severity, method) - so the sweep is serialised
 * here instead. Both ways this job can start, the five-minute schedule and the
 * by-name enqueue from IncidentSeverityService / AlertSeverityService, run the
 * same function and therefore take the same key, which is what makes "a
 * severity created one second before a tick" safe.
 *
 * acquireAttemptsLimit: 1 - a run that finds the lock held skips instead of
 * queueing behind it. The holder derives its work set from the same lookback
 * query, so it is already covering the same severities; waiting would only
 * repeat work in flight, and anything the holder misses is still inside the
 * window for the next tick.
 *
 * The lock timeout deliberately outlives the job's own five-minute timeout:
 * QueueWorker.runJobWithTimeout races the body rather than stopping it, so an
 * overrunning sweep must keep holding the lock rather than let a second one in
 * behind it. redis-semaphore's Mutex refreshes itself while it is held, so this
 * value only bounds how long a CRASHED worker's lock lingers before another
 * replica may take over.
 */
const SWEEP_LOCK_KEY: string = JOB_NAME;
const SWEEP_LOCK_NAMESPACE: string = "Workers.Cron";
const SWEEP_LOCK_TIMEOUT_MS: number =
  OneUptimeDate.convertMinutesToMilliseconds(6);

type SeverityKind = "incident" | "alert";

interface NewSeverity {
  id: ObjectID;
  projectId: ObjectID;
  kind: SeverityKind;
  /*
   * When the severity was created. A responder who joined the project at or
   * after this moment got their rules for it when they joined, so the job
   * leaves them alone (hasJoinedSinceSeverity). Unknown, nobody is skipped.
   */
  createdAt?: Date | undefined;
}

/*
 * A responder's verified email in the project: the address the default rule
 * goes to, and when the responder's first verified address there was added -
 * which is when they joined the project, or verified their sign-in email.
 */
interface VerifiedEmail {
  emailId: ObjectID;
  joinedAt?: Date | undefined;
}

/*
 * The two severity-scoped rule types per severity kind. Episode rules are
 * included because they are severity-scoped too - UserOnCallLogService counts
 * them filtered by a concrete severity id exactly like the non-episode ones.
 */
const RULE_TYPES_BY_SEVERITY_KIND: Record<
  SeverityKind,
  Array<NotificationRuleType>
> = {
  incident: [
    NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
  ],
  alert: [
    NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
  ],
};

type NotificationMethodColumn =
  | "userEmailId"
  | "userSmsId"
  | "userCallId"
  | "userPushId"
  | "userWhatsAppId"
  | "userTelegramId"
  | "userSlackId"
  | "userMicrosoftTeamsId"
  | "userWebhookId"
  | "customNotificationChannelId";

const NOTIFICATION_METHOD_COLUMNS: Array<NotificationMethodColumn> = [
  "userEmailId",
  "userSmsId",
  "userCallId",
  "userPushId",
  "userWhatsAppId",
  "userTelegramId",
  "userSlackId",
  "userMicrosoftTeamsId",
  "userWebhookId",
  "customNotificationChannelId",
];

/* One (channel, delay) the responder already asked for, ready to be re-stated. */
interface MirroredRule {
  methodColumn: NotificationMethodColumn;
  methodId: ObjectID;
  notifyAfterMinutes: number;
}

/*
 * What one responder has already said about one rule type, distilled from their
 * existing rows.
 */
interface ResponderIntent {
  hasRuleForNewSeverity: boolean;
  // Keyed on channel + method + delay, which is what "distinct pair" means here.
  mirroredRules: Map<string, MirroredRule>;
  hasOptOut: boolean;
}

RunCron(
  JOB_NAME,
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async () => {
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: SWEEP_LOCK_KEY,
        namespace: SWEEP_LOCK_NAMESPACE,
        lockTimeout: SWEEP_LOCK_TIMEOUT_MS,
        acquireAttemptsLimit: 1,
      });
    } catch (err) {
      /*
       * Either a sweep is already in flight - in which case skipping is the
       * whole point - or Redis is unreachable, in which case no job of any
       * kind is being dispatched anyway and there is nothing for this run to
       * do differently.
       */
      logger.debug(
        `${JOB_NAME}: could not acquire the sweep lock; a sweep is already in flight (or Redis is unavailable). Skipping this run: ${err}`,
      );
      return;
    }

    /*
     * Everything below runs under the lock, released in `finally` so a throw
     * anywhere frees it for the next tick instead of wedging the job until the
     * lock times out.
     */
    try {
      const newSeverities: Array<NewSeverity> =
        await findRecentlyCreatedSeverities();

      if (newSeverities.length === 0) {
        return;
      }

      logger.debug(
        `${JOB_NAME}: backfilling notification rules for ${newSeverities.length} recently created severity/severities`,
        { service: "workers" },
      );

      for (const severity of newSeverities) {
        /*
         * One project's bad data must not stop the others. A severity that
         * throws is logged and skipped; the next sweep will try it again while
         * it is still inside the lookback window.
         */
        try {
          await backfillSeverity(severity);
        } catch (err) {
          logger.error(
            `${JOB_NAME}: failed to backfill notification rules for ${severity.kind} severity ${severity.id.toString()}`,
          );
          logger.error(err);
        }
      }
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        // a release failure only means the lock expires on its own timeout.
        logger.error(`${JOB_NAME}: error releasing the sweep lock: ${err}`);
      }
    }
  },
);

type FindRecentlyCreatedSeveritiesFunction = () => Promise<Array<NewSeverity>>;

const findRecentlyCreatedSeverities: FindRecentlyCreatedSeveritiesFunction =
  async (): Promise<Array<NewSeverity>> => {
    const createdAfter: Date = OneUptimeDate.getSomeMinutesAgo(
      BACKFILL_LOOKBACK_IN_MINUTES,
    );

    const incidentSeverities: Array<IncidentSeverity> =
      await IncidentSeverityService.findAllBy({
        query: {
          createdAt: QueryHelper.greaterThanEqualTo(createdAfter),
        },
        select: {
          _id: true,
          projectId: true,
          createdAt: true,
        },
        props: {
          isRoot: true,
        },
      });

    const alertSeverities: Array<AlertSeverity> =
      await AlertSeverityService.findAllBy({
        query: {
          createdAt: QueryHelper.greaterThanEqualTo(createdAfter),
        },
        select: {
          _id: true,
          projectId: true,
          createdAt: true,
        },
        props: {
          isRoot: true,
        },
      });

    const severities: Array<NewSeverity> = [];

    for (const incidentSeverity of incidentSeverities) {
      if (!incidentSeverity.id || !incidentSeverity.projectId) {
        continue;
      }

      severities.push({
        id: incidentSeverity.id,
        projectId: incidentSeverity.projectId,
        kind: "incident",
        createdAt: incidentSeverity.createdAt,
      });
    }

    for (const alertSeverity of alertSeverities) {
      if (!alertSeverity.id || !alertSeverity.projectId) {
        continue;
      }

      severities.push({
        id: alertSeverity.id,
        projectId: alertSeverity.projectId,
        kind: "alert",
        createdAt: alertSeverity.createdAt,
      });
    }

    return severities;
  };

type BackfillSeverityFunction = (severity: NewSeverity) => Promise<void>;

const backfillSeverity: BackfillSeverityFunction = async (
  severity: NewSeverity,
): Promise<void> => {
  /*
   * The rules of each rule type first, then the project's verified emails -
   * in that order, and both before anything is written.
   *
   * A new project's severities are created a moment before its creator's
   * first rules (ProjectService adds them with the creator's email, once the
   * project exists), and each new severity queues this job at once. The job
   * used to race that: both read "no rule for this cell yet" and both wrote
   * one, and the project's creator started with two identical rules for some
   * severities - two rows on their On-Call Rules page, and two pages for one
   * incident. Someone joining the project later raced it the same way.
   *
   * Whoever joined the project at or after the severity was created needs
   * nothing from this job: joining wrote a rule for every severity there was,
   * this one included (hasJoinedSinceSeverity). Their verified email says when
   * they joined - it is added before their rules are written - and reading the
   * emails after the rules means anyone with a rule in a snapshot below has
   * their email, and so their join time, in the email read.
   */
  const rulesByType: Array<{
    ruleType: NotificationRuleType;
    existingRules: Array<UserNotificationRule>;
  }> = [];

  for (const ruleType of RULE_TYPES_BY_SEVERITY_KIND[severity.kind]) {
    rulesByType.push({
      ruleType: ruleType,
      existingRules: await findRulesOfType(severity, ruleType),
    });
  }

  /*
   * Read once per severity, not once per rule type: the same set answers "who in
   * this project can be reached at all?" for both rule types below.
   */
  const verifiedEmailByUserId: Map<string, VerifiedEmail> =
    await findVerifiedEmailsInProject(severity.projectId);

  for (const { ruleType, existingRules } of rulesByType) {
    await backfillSeverityForRuleType({
      severity: severity,
      ruleType: ruleType,
      existingRules: existingRules,
      verifiedEmailByUserId: verifiedEmailByUserId,
    });
  }
};

type HasJoinedSinceSeverityFunction = (data: {
  severity: NewSeverity;
  verifiedEmail: VerifiedEmail | undefined;
}) => boolean;

/*
 * Whether a responder joined the project at or after the severity was
 * created, so that joining already gave them a rule for it. Joining writes a
 * rule for every severity there is, read after the responder's email is
 * added: a severity created before that email is one their rules cover.
 * When either time is unknown the answer is no, and the job does what it
 * always did.
 */
const hasJoinedSinceSeverity: HasJoinedSinceSeverityFunction = (data: {
  severity: NewSeverity;
  verifiedEmail: VerifiedEmail | undefined;
}): boolean => {
  const severityCreatedAt: Date | undefined = data.severity.createdAt;
  const joinedAt: Date | undefined = data.verifiedEmail?.joinedAt;

  if (!severityCreatedAt || !joinedAt) {
    return false;
  }

  return (
    OneUptimeDate.fromString(joinedAt).getTime() >=
    OneUptimeDate.fromString(severityCreatedAt).getTime()
  );
};

type FindVerifiedEmailsInProjectFunction = (
  projectId: ObjectID,
) => Promise<Map<string, VerifiedEmail>>;

const findVerifiedEmailsInProject: FindVerifiedEmailsInProjectFunction = async (
  projectId: ObjectID,
): Promise<Map<string, VerifiedEmail>> => {
  const userEmails: Array<UserEmail> = await UserEmailService.findAllBy({
    query: {
      projectId: projectId,
      isVerified: true,
    },
    select: {
      _id: true,
      userId: true,
      createdAt: true,
    },
    props: {
      isRoot: true,
    },
  });

  const verifiedEmailByUserId: Map<string, VerifiedEmail> = new Map<
    string,
    VerifiedEmail
  >();

  for (const userEmail of userEmails) {
    if (!userEmail.id || !userEmail.userId) {
      continue;
    }

    const userId: string = userEmail.userId.toString();
    const known: VerifiedEmail | undefined = verifiedEmailByUserId.get(userId);

    // A responder with several verified addresses gets a rule for the first.
    if (!known) {
      verifiedEmailByUserId.set(userId, {
        emailId: userEmail.id,
        joinedAt: userEmail.createdAt,
      });
      continue;
    }

    /*
     * Joined when the first of their addresses was added: an address added
     * later does not make them newer to the project.
     */
    if (
      userEmail.createdAt &&
      (!known.joinedAt ||
        OneUptimeDate.fromString(userEmail.createdAt).getTime() <
          OneUptimeDate.fromString(known.joinedAt).getTime())
    ) {
      known.joinedAt = userEmail.createdAt;
    }
  }

  return verifiedEmailByUserId;
};

type FindRulesOfTypeFunction = (
  severity: NewSeverity,
  ruleType: NotificationRuleType,
) => Promise<Array<UserNotificationRule>>;

/*
 * Every rule of this type in the project, in ONE read, grouped in memory
 * afterwards. The obvious shape - loop the project's users, ask the database
 * once per user per severity - is what TeamComplianceService does and why it
 * is an N+1; a project with a thousand responders would issue a thousand
 * queries per severity here.
 */
const findRulesOfType: FindRulesOfTypeFunction = async (
  severity: NewSeverity,
  ruleType: NotificationRuleType,
): Promise<Array<UserNotificationRule>> => {
  return await UserNotificationRuleService.findAllBy({
    query: {
      projectId: severity.projectId,
      ruleType: ruleType,
    },
    select: {
      _id: true,
      userId: true,
      notifyAfterMinutes: true,
      isOptOut: true,
      incidentSeverityId: true,
      alertSeverityId: true,
      userEmailId: true,
      userSmsId: true,
      userCallId: true,
      userPushId: true,
      userWhatsAppId: true,
      userTelegramId: true,
      userSlackId: true,
      userMicrosoftTeamsId: true,
      userWebhookId: true,
      customNotificationChannelId: true,
    },
    props: {
      isRoot: true,
    },
  });
};

type BackfillSeverityForRuleTypeFunction = (data: {
  severity: NewSeverity;
  ruleType: NotificationRuleType;
  existingRules: Array<UserNotificationRule>;
  verifiedEmailByUserId: Map<string, VerifiedEmail>;
}) => Promise<void>;

const backfillSeverityForRuleType: BackfillSeverityForRuleTypeFunction =
  async (data: {
    severity: NewSeverity;
    ruleType: NotificationRuleType;
    existingRules: Array<UserNotificationRule>;
    verifiedEmailByUserId: Map<string, VerifiedEmail>;
  }): Promise<void> => {
    const severity: NewSeverity = data.severity;
    const ruleType: NotificationRuleType = data.ruleType;

    const intentByUserId: Map<string, ResponderIntent> = buildResponderIntents(
      data.existingRules,
      severity,
    );

    type JoinedSinceFunction = (userId: string) => boolean;

    const joinedSince: JoinedSinceFunction = (userId: string): boolean => {
      return hasJoinedSinceSeverity({
        severity: severity,
        verifiedEmail: data.verifiedEmailByUserId.get(userId),
      });
    };

    /*
     * Responders who have already said something about this rule type. Mirror what
     * they said onto the new severity.
     */
    for (const [userId, intent] of intentByUserId) {
      if (intent.hasRuleForNewSeverity) {
        // Already covered - by an earlier run of this job, or by hand.
        continue;
      }

      if (joinedSince(userId)) {
        // Joining covered it, maybe at this very moment (backfillSeverity).
        continue;
      }

      if (intent.mirroredRules.size > 0) {
        for (const mirroredRule of intent.mirroredRules.values()) {
          await createRule({
            severity: severity,
            ruleType: ruleType,
            userId: new ObjectID(userId),
            mirroredRule: mirroredRule,
          });
        }

        continue;
      }

      /*
       * They have rules of this type and every one of them is an opt-out: they
       * have deliberately muted this rule type for every severity they have an
       * opinion about. Mirroring the opt-out is the only answer that respects
       * that - leaving the cell empty would hand them straight to the
       * verified-method fallback, which is to say it would page someone who asked
       * not to be paged.
       */
      if (intent.hasOptOut) {
        await createRule({
          severity: severity,
          ruleType: ruleType,
          userId: new ObjectID(userId),
          mirroredRule: null,
        });
      }
    }

    /*
     * Responders who have said nothing at all about this rule type get today's
     * default: their verified email, immediately. That is exactly what
     * addDefaultNotificationRuleForUser would have written for them had this
     * severity existed when they joined.
     */
    for (const [userId, verifiedEmail] of data.verifiedEmailByUserId) {
      if (intentByUserId.has(userId) || joinedSince(userId)) {
        continue;
      }

      await createRule({
        severity: severity,
        ruleType: ruleType,
        userId: new ObjectID(userId),
        mirroredRule: {
          methodColumn: "userEmailId",
          methodId: verifiedEmail.emailId,
          notifyAfterMinutes: 0,
        },
      });
    }
  };

type BuildResponderIntentsFunction = (
  existingRules: Array<UserNotificationRule>,
  severity: NewSeverity,
) => Map<string, ResponderIntent>;

/**
 * Distils each responder's existing rows for one rule type into "what would this
 * person want for a new severity?".
 *
 * The answer is: the same channels, at the same delays, that they already chose
 * for this rule type on the severities they did configure. Someone who set "Sev1
 * -> call me immediately, Sev3 -> email me after 15 minutes" gets a Sev4 rule
 * built out of those same choices, rather than a hardcoded default. That
 * distinction is the whole point: a default would ring the phone of a responder
 * who only ever uses email, and would page immediately someone who deliberately
 * built a delay into every rule they own. Mirroring can only ever hand a
 * responder a channel they already opted into.
 *
 * Rows for the new severity itself are the idempotency guard, not input: seeing
 * one means an earlier run (or the responder) already covered this cell.
 *
 * Rows with no severity at all still count as intent. Episode default rules were
 * written without a severity id for a long time (Gap G), and those rows are just
 * as much a statement of "this is how I want to be told" as a severity-scoped
 * one.
 */
const buildResponderIntents: BuildResponderIntentsFunction = (
  existingRules: Array<UserNotificationRule>,
  severity: NewSeverity,
): Map<string, ResponderIntent> => {
  const intentByUserId: Map<string, ResponderIntent> = new Map<
    string,
    ResponderIntent
  >();

  const newSeverityId: string = severity.id.toString();

  for (const rule of existingRules) {
    if (!rule.userId) {
      continue;
    }

    const userId: string = rule.userId.toString();

    let intent: ResponderIntent | undefined = intentByUserId.get(userId);

    if (!intent) {
      intent = {
        hasRuleForNewSeverity: false,
        mirroredRules: new Map<string, MirroredRule>(),
        hasOptOut: false,
      };
      intentByUserId.set(userId, intent);
    }

    const severityIdOnRule: ObjectID | undefined =
      severity.kind === "incident"
        ? rule.incidentSeverityId
        : rule.alertSeverityId;

    if (severityIdOnRule && severityIdOnRule.toString() === newSeverityId) {
      intent.hasRuleForNewSeverity = true;
      continue;
    }

    if (rule.isOptOut) {
      intent.hasOptOut = true;
      continue;
    }

    const notifyAfterMinutes: number = rule.notifyAfterMinutes || 0;

    for (const methodColumn of NOTIFICATION_METHOD_COLUMNS) {
      const methodId: ObjectID | undefined = rule[methodColumn];

      if (!methodId) {
        continue;
      }

      intent.mirroredRules.set(
        `${methodColumn}:${methodId.toString()}:${notifyAfterMinutes}`,
        {
          methodColumn: methodColumn,
          methodId: methodId,
          notifyAfterMinutes: notifyAfterMinutes,
        },
      );
    }
  }

  return intentByUserId;
};

type CreateRuleFunction = (data: {
  severity: NewSeverity;
  ruleType: NotificationRuleType;
  userId: ObjectID;
  // null writes the opt-out form: no method, isOptOut true.
  mirroredRule: MirroredRule | null;
}) => Promise<void>;

const createRule: CreateRuleFunction = async (data: {
  severity: NewSeverity;
  ruleType: NotificationRuleType;
  userId: ObjectID;
  mirroredRule: MirroredRule | null;
}): Promise<void> => {
  /*
   * Idempotence, mirroring UserNotificationRuleService.createSeverityScopedRules:
   * ask for the exact row that is about to be written, and skip if it is
   * already there.
   *
   * Sequential ticks were already covered - buildResponderIntents re-reads
   * every rule of this type at the top of each run, so a later tick sees the
   * rows an earlier one wrote and sets hasRuleForNewSeverity. What that cannot
   * cover is two runs that OVERLAP: both take their snapshot before either
   * writes, both conclude the cell is empty, and the responder ends up with two
   * identical rules and therefore two pages for one incident. That overlap is
   * likeliest at exactly the worst moment, because a new severity arrives by
   * two routes at once - the by-name enqueue fires seconds after creation, and
   * a scheduled sweep may already be part-way through the same severity.
   * claimNotificationRuleExecution cannot save this: it de-duplicates per rule
   * id, and these are genuinely distinct rows.
   *
   * So the snapshot is backed by a read of the row itself, taken immediately
   * before the write instead of once per rule type. The key is the whole row
   * minus its own id: project, user, rule type, severity, method - plus
   * notifyAfterMinutes, which createSeverityScopedRules has no need of because
   * it only ever writes zero. Here it is load-bearing: a responder who asked
   * for "email me now" AND "email me in fifteen minutes" must get both rows on
   * the new severity, and a key that ignored the delay would drop the second
   * one during the same pass that wrote the first.
   *
   * This narrows the race from a whole sweep to the microseconds between the
   * read and the write; the single-flight SWEEP_LOCK_KEY closes what is left,
   * since only a lock (or a unique index, which this table does not have) can
   * make check-then-create genuinely atomic.
   */
  const existingRuleQuery: Query<UserNotificationRule> = {
    projectId: data.severity.projectId,
    userId: data.userId,
    ruleType: data.ruleType,
    ...(data.severity.kind === "incident"
      ? { incidentSeverityId: data.severity.id }
      : { alertSeverityId: data.severity.id }),
    ...(data.mirroredRule
      ? {
          ...buildNotificationMethodQuery(
            data.mirroredRule.methodColumn,
            data.mirroredRule.methodId,
          ),
          notifyAfterMinutes: data.mirroredRule.notifyAfterMinutes,
        }
      : { isOptOut: true }),
  };

  const existingRule: UserNotificationRule | null =
    await UserNotificationRuleService.findOneBy({
      query: existingRuleQuery,
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

  if (existingRule) {
    return;
  }

  const rule: UserNotificationRule = new UserNotificationRule();
  rule.projectId = data.severity.projectId;
  rule.userId = data.userId;
  rule.ruleType = data.ruleType;

  if (data.severity.kind === "incident") {
    rule.incidentSeverityId = data.severity.id;
  } else {
    rule.alertSeverityId = data.severity.id;
  }

  if (data.mirroredRule) {
    rule.notifyAfterMinutes = data.mirroredRule.notifyAfterMinutes;
    applyNotificationMethod(
      rule,
      data.mirroredRule.methodColumn,
      data.mirroredRule.methodId,
    );
  } else {
    rule.notifyAfterMinutes = 0;
    rule.isOptOut = true;
  }

  /*
   * One responder's failure must not abort the rest of the project. The most
   * likely cause is a method row deleted between the read above and this write,
   * which cascades the FK away - a rule that could not be written for one person
   * is worth a log line, not an aborted backfill for everybody else.
   */
  try {
    await UserNotificationRuleService.create({
      data: rule,
      props: {
        isRoot: true,
      },
    });
  } catch (err) {
    logger.error(
      `${JOB_NAME}: could not create a ${data.ruleType} rule for user ${data.userId.toString()} on ${data.severity.kind} severity ${data.severity.id.toString()}`,
    );
    logger.error(err);
  }
};

type BuildNotificationMethodQueryFunction = (
  methodColumn: NotificationMethodColumn,
  methodId: ObjectID,
) => Query<UserNotificationRule>;

/*
 * The method half of the "does this row already exist?" query.
 *
 * Written as a switch for the same reason applyNotificationMethod below is: the
 * existence check and the write have to name the same column, and a switch
 * turns a renamed foreign key into a compile error rather than a query that
 * quietly matches nothing and lets the duplicate through.
 */
const buildNotificationMethodQuery: BuildNotificationMethodQueryFunction = (
  methodColumn: NotificationMethodColumn,
  methodId: ObjectID,
): Query<UserNotificationRule> => {
  switch (methodColumn) {
    case "userEmailId":
      return { userEmailId: methodId };
    case "userSmsId":
      return { userSmsId: methodId };
    case "userCallId":
      return { userCallId: methodId };
    case "userPushId":
      return { userPushId: methodId };
    case "userWhatsAppId":
      return { userWhatsAppId: methodId };
    case "userTelegramId":
      return { userTelegramId: methodId };
    case "userSlackId":
      return { userSlackId: methodId };
    case "userMicrosoftTeamsId":
      return { userMicrosoftTeamsId: methodId };
    case "userWebhookId":
      return { userWebhookId: methodId };
    case "customNotificationChannelId":
      return { customNotificationChannelId: methodId };
    default:
      return {};
  }
};

type ApplyNotificationMethodFunction = (
  rule: UserNotificationRule,
  methodColumn: NotificationMethodColumn,
  methodId: ObjectID,
) => void;

/*
 * Written as a switch rather than `rule[methodColumn] = methodId` so the column
 * name and the model stay checked against each other: renaming a foreign key on
 * UserNotificationRule fails here at compile time instead of silently writing a
 * rule with no method, which onBeforeCreate would then reject at runtime.
 */
const applyNotificationMethod: ApplyNotificationMethodFunction = (
  rule: UserNotificationRule,
  methodColumn: NotificationMethodColumn,
  methodId: ObjectID,
): void => {
  switch (methodColumn) {
    case "userEmailId":
      rule.userEmailId = methodId;
      break;
    case "userSmsId":
      rule.userSmsId = methodId;
      break;
    case "userCallId":
      rule.userCallId = methodId;
      break;
    case "userPushId":
      rule.userPushId = methodId;
      break;
    case "userWhatsAppId":
      rule.userWhatsAppId = methodId;
      break;
    case "userTelegramId":
      rule.userTelegramId = methodId;
      break;
    case "userSlackId":
      rule.userSlackId = methodId;
      break;
    case "userMicrosoftTeamsId":
      rule.userMicrosoftTeamsId = methodId;
      break;
    case "userWebhookId":
      rule.userWebhookId = methodId;
      break;
    case "customNotificationChannelId":
      rule.customNotificationChannelId = methodId;
      break;
    default:
      break;
  }
};

export {
  JOB_NAME,
  backfillSeverity,
  buildResponderIntents,
  findRecentlyCreatedSeverities,
  hasJoinedSinceSeverity,
};
export type { MirroredRule, NewSeverity, ResponderIntent, VerifiedEmail };
