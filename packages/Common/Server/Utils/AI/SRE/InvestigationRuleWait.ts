import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import AIRunType from "../../../../Types/AI/AIRunType";
import { InvestigationNotStartedCode } from "../../../../Types/AI/InvestigationNotStartedReason";
import {
  getInvestigationRuleWaitMinutes,
  getInvestigationWaitMinutes,
  getInvestigationWaitUntil,
} from "../../../../Types/AI/InvestigationRuleWait";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import AIRunService from "../../../Services/AIRunService";
import AlertService from "../../../Services/AlertService";
import AlertStateService from "../../../Services/AlertStateService";
import IncidentService from "../../../Services/IncidentService";
import IncidentStateService from "../../../Services/IncidentStateService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIInvestigationEngine from "./AIInvestigationEngine";
import AIAlertInvestigationRunner from "./AlertInvestigationRunner";
import AIIncidentInvestigationRunner from "./IncidentInvestigationRunner";
import InvestigationEligibility from "./InvestigationEligibility";
import AIInvestigationQueue from "./InvestigationQueue";
import InvestigationRules, {
  InvestigationRuleScope,
} from "./InvestigationRules";

/*
 * AI SRE - an investigation rule makes OneUptime AI wait (issue #5074).
 *
 * A rule may say "only if the incident is still open after N minutes"
 * (AIInvestigationRule.onlyIfOpenAfterMinutes). An incident it matches is
 * then not investigated when it is declared: it waits, and is investigated
 * when the wait ends only if it is still open. Most short incidents - a
 * synthetic check that fails once and recovers, a platform blip - resolve
 * within minutes, and their investigation had no reader; an incident that
 * lasts is investigated once, with every signal that arrived meanwhile in
 * its context (LinkedInfrastructureContext lists the alerts that opened
 * since it was declared). Alerts work the same way.
 *
 * Nothing waits by default: a rule with no wait, no rule at all, and every
 * rule saved before rules could wait investigate right away.
 *
 * The wait is written on the incident (aiInvestigationWaitUntil), not as a
 * queued run, so:
 *   - nothing is created for an incident that resolves within it - no
 *     investigation run, no AI Logs row - and its AI card says why
 *     (resolved_before_investigation);
 *   - the gates are decided when the wait ends, with what is true then:
 *     the rules (the incident's severity or the rules may have changed),
 *     the severity floor, the monitor cooldown (a storm's first incident
 *     investigated, the others skipped), AI being on, the limits. A
 *     waiting incident holds no run, so it never makes another one wait out
 *     a cooldown for an investigation that may never happen;
 *   - a worker restart loses nothing: the rule-wait job
 *     (AIChat:InvestigateAfterRuleWait) finds every wait that ended, every
 *     minute, however long the workers were down.
 *
 * Exactly once: the job takes a record off the waiting list with a
 * compare-and-set of the time it read, so two workers never both take it,
 * and the run is created inside the subject lock only while the record has
 * no investigation yet - whoever starts it first, the job, someone's
 * "Investigate now" or Ask AI, the others add nothing.
 *
 * Auto remediation does not wait: a record whose investigation waits is,
 * for remediation, a record whose investigation was not queued, so its
 * rules run when it is created (the create hooks). The run that follows the
 * wait therefore never hands the record to remediation when it settles
 * (AIRun.ruleWaitMinutes), and an incident's follow-up check counts its
 * window from when that run finished (IncidentFollowUpCheck).
 *
 * What changes what the rules read - the severity, labels, monitors, title
 * or description - moves the wait while it runs (onSubjectChanged): a
 * severity raised to one a shorter wait applies to starts the investigation
 * sooner, or at once. Someone may start it at once from the AI card
 * (startNow): a manual start ignores the wait.
 *
 * Every entry point is best-effort and never throws.
 */

export type RuleWaitLane = "Incident" | "Alert";

const LANES: ReadonlyArray<RuleWaitLane> = ["Incident", "Alert"];

// How many waits of one lane a run of the job ends; the rest wait a minute.
export const RULE_WAIT_BATCH_SIZE: number = 50;

export interface RuleWaitSubject {
  lane: RuleWaitLane;
  projectId: ObjectID;
  subjectId: ObjectID;
}

// A record waiting for its investigation, as the AI card shows it.
export interface WaitingInvestigation {
  // When the wait ends: OneUptime AI investigates then, if it is still open.
  waitUntil: Date;
  // The wait, in minutes, from when the record was created.
  waitMinutes: number;
}

// A record whose wait ended, as the job read it.
export interface EndedWait extends RuleWaitSubject {
  createdAt: Date;
  // The time the record held - the wait is taken off only while it does.
  waitUntil: Date;
  // The record's state when it was read: open or not is judged on it.
  currentStateId?: ObjectID | undefined;
}

export type RuleWaitOutcome =
  // Another worker took it first, or the wait moved meanwhile.
  | "taken_elsewhere"
  // Someone had it investigated already (Investigate now, Ask AI).
  | "already_investigated"
  // Resolved before the investigation started: recorded on its AI card.
  | "resolved"
  // Its investigation was queued.
  | "queued"
  /*
   * Not queued: what stops it now was recorded on its AI card (a gate, a
   * limit), or it waits again (a rule now asks for a longer wait).
   */
  | "not_queued";

export interface RuleWaitResult extends RuleWaitSubject {
  outcome: RuleWaitOutcome;
}

/*
 * Why someone's "Investigate now" did not start the investigation. Server
 * English, shown as the action's error.
 */
export type StartNowProblem =
  | "not_waiting"
  | "already_investigated"
  | InvestigationNotStartedCode;

export type StartNowResult =
  | { isStarted: true; runId: ObjectID }
  | { isStarted: false; problem: StartNowProblem; message: string };

const START_NOW_MESSAGES: Partial<Record<StartNowProblem, string>> = {
  not_waiting:
    "OneUptime AI is no longer waiting to investigate this. Refresh to see where it stands.",
  already_investigated: "OneUptime AI has already started investigating this.",
  ai_disabled:
    "AI is turned off for this project (Project Settings → AI → AI Features).",
  provider_missing:
    "This project has no AI provider OneUptime AI can use (Project Settings → AI → LLM Providers).",
  insufficient_ai_balance:
    "This project is out of AI credits (Project Settings → AI → AI Credits).",
  project_daily_limit_reached:
    "This project has reached its own daily AI limit. It resets at midnight UTC.",
  daily_budget_exhausted:
    "The daily AI token limit for this kind of record is reached. It resets at midnight UTC.",
};

const START_NOW_FALLBACK_MESSAGE: string =
  "The investigation could not be started. Try again in a moment.";

export default class InvestigationRuleWait {
  /*
   * A new record matched rules that all wait: it waits until `waitUntil`.
   * Written only while the record holds no wait, so a wait being ended
   * elsewhere is never overwritten. True when it was written.
   */
  @CaptureSpan()
  public static async startWaiting(data: {
    lane: RuleWaitLane;
    projectId: ObjectID;
    subjectId: ObjectID;
    waitUntil: Date;
  }): Promise<boolean> {
    try {
      return await InvestigationRuleWait.compareAndSetWait({
        lane: data.lane,
        projectId: data.projectId,
        subjectId: data.subjectId,
        expected: null,
        next: data.waitUntil,
      });
    } catch (error) {
      logger.error(
        `AI: could not record that the investigation of ${describeSubject(data)} waits; investigating it right away instead: ${error}`,
      );
      return false;
    }
  }

  /*
   * One run of the rule-wait job: every record whose wait has ended, the
   * longest-waiting first, at most a batch per lane. Never throws.
   */
  @CaptureSpan()
  public static async run(): Promise<Array<RuleWaitResult>> {
    const results: Array<RuleWaitResult> = [];

    for (const lane of LANES) {
      let ended: Array<EndedWait> = [];

      try {
        ended = await InvestigationRuleWait.getEndedWaits(lane);
      } catch (error) {
        logger.error(
          `AI: could not read the ${lane === "Incident" ? "incidents" : "alerts"} whose investigation wait ended; they are read again on the next run: ${error}`,
        );
        continue;
      }

      for (const wait of ended) {
        results.push({
          lane: wait.lane,
          projectId: wait.projectId,
          subjectId: wait.subjectId,
          outcome: await InvestigationRuleWait.onWaitEnded(wait),
        });
      }
    }

    return results;
  }

  // The records of one lane whose wait has ended, the earliest first.
  @CaptureSpan()
  public static async getEndedWaits(
    lane: RuleWaitLane,
  ): Promise<Array<EndedWait>> {
    const now: Date = OneUptimeDate.getCurrentDate();

    if (lane === "Incident") {
      const incidents: Array<Incident> = await IncidentService.findBy({
        query: {
          aiInvestigationWaitUntil: QueryHelper.lessThanEqualTo(now),
        },
        select: {
          _id: true,
          projectId: true,
          createdAt: true,
          aiInvestigationWaitUntil: true,
          currentIncidentStateId: true,
        },
        sort: { aiInvestigationWaitUntil: SortOrder.Ascending },
        limit: RULE_WAIT_BATCH_SIZE,
        skip: 0,
        props: { isRoot: true },
      });

      return incidents
        .map((incident: Incident): EndedWait | null => {
          return toEndedWait({
            lane,
            id: incident.id,
            projectId: incident.projectId,
            createdAt: incident.createdAt,
            waitUntil: incident.aiInvestigationWaitUntil,
            currentStateId: incident.currentIncidentStateId,
          });
        })
        .filter((wait: EndedWait | null): wait is EndedWait => {
          return wait !== null;
        });
    }

    const alerts: Array<Alert> = await AlertService.findBy({
      query: {
        aiInvestigationWaitUntil: QueryHelper.lessThanEqualTo(now),
      },
      select: {
        _id: true,
        projectId: true,
        createdAt: true,
        aiInvestigationWaitUntil: true,
        currentAlertStateId: true,
      },
      sort: { aiInvestigationWaitUntil: SortOrder.Ascending },
      limit: RULE_WAIT_BATCH_SIZE,
      skip: 0,
      props: { isRoot: true },
    });

    return alerts
      .map((alert: Alert): EndedWait | null => {
        return toEndedWait({
          lane,
          id: alert.id,
          projectId: alert.projectId,
          createdAt: alert.createdAt,
          waitUntil: alert.aiInvestigationWaitUntil,
          currentStateId: alert.currentAlertStateId,
        });
      })
      .filter((wait: EndedWait | null): wait is EndedWait => {
        return wait !== null;
      });
  }

  /*
   * A record's wait ended: take it off the waiting list - once, whoever
   * else tries - and then, unless it was investigated meanwhile, skip it if
   * it was resolved, or send it down the new-record path again, gates and
   * all, as decided now. `waitMinutes` is the wait being ended (the time it
   * held, unless a change ended it early). Never throws.
   */
  @CaptureSpan()
  public static async onWaitEnded(
    wait: EndedWait,
    options?: { waitMinutes?: number | undefined } | undefined,
  ): Promise<RuleWaitOutcome> {
    const waitMinutes: number =
      getInvestigationRuleWaitMinutes(options?.waitMinutes) ||
      getInvestigationWaitMinutes(wait.createdAt, wait.waitUntil) ||
      1;

    try {
      if (
        !(await InvestigationRuleWait.takeOffWaitingList({
          lane: wait.lane,
          projectId: wait.projectId,
          subjectId: wait.subjectId,
          waitUntil: wait.waitUntil,
        }))
      ) {
        return "taken_elsewhere";
      }

      if (await InvestigationRuleWait.hasInvestigationRun(wait)) {
        return "already_investigated";
      }

      if (!(await InvestigationRuleWait.isOpen(wait))) {
        await InvestigationEligibility.recordSkipped(
          {
            projectId: wait.projectId,
            ...(wait.lane === "Incident"
              ? { incidentId: wait.subjectId }
              : { alertId: wait.subjectId }),
          },
          "resolved_before_investigation",
          undefined,
          { waitMinutes },
        );
        return "resolved";
      }

      const isQueued: boolean =
        wait.lane === "Incident"
          ? await AIIncidentInvestigationRunner.investigateNewIncident({
              incidentId: wait.subjectId,
              projectId: wait.projectId,
              afterWaitMinutes: waitMinutes,
            })
          : await AIAlertInvestigationRunner.investigateNewAlert({
              alertId: wait.subjectId,
              projectId: wait.projectId,
              afterWaitMinutes: waitMinutes,
            });

      return isQueued ? "queued" : "not_queued";
    } catch (error) {
      logger.error(
        `AI: could not end the investigation wait of ${describeSubject(wait)}: ${error}`,
      );
      return "not_queued";
    }
  }

  /*
   * Something the rules read changed on a record: its severity, labels,
   * monitors, title or description (the services' update hooks). While it
   * waits, the wait follows the rules it matches now - longer, shorter, or
   * over at once, when the wait it now gets has already passed. A record
   * that now matches no rule keeps its wait: that is decided when the wait
   * ends, as everything else is. Never throws.
   */
  @CaptureSpan()
  public static async onSubjectChanged(
    subject: RuleWaitSubject,
  ): Promise<void> {
    try {
      const read: {
        record: Incident | Alert;
        scope: InvestigationRuleScope;
      } | null = await InvestigationRuleWait.readWaitingRecordScope(subject);

      if (!read || !read.scope.isInScope) {
        return;
      }

      const createdAt: Date | undefined = read.record.createdAt;
      const waitUntil: Date | undefined = read.record.aiInvestigationWaitUntil;

      if (!createdAt || !waitUntil) {
        return;
      }

      const waitMinutes: number = getInvestigationRuleWaitMinutes(
        read.scope.waitMinutes,
      );
      const newWaitUntil: Date = getInvestigationWaitUntil(
        createdAt,
        waitMinutes,
      );

      if (newWaitUntil.getTime() === waitUntil.getTime()) {
        return;
      }

      // The wait it gets now ends later: it waits on, until then.
      if (newWaitUntil.getTime() > OneUptimeDate.getCurrentDate().getTime()) {
        await InvestigationRuleWait.moveWait({
          ...subject,
          waitUntil,
          newWaitUntil,
        });
        return;
      }

      /*
       * The wait it gets now has already passed - a severity raised to one
       * whose rule investigates right away, or waits less than it has:
       * end it now, under the wait it had if the new one is none.
       */
      await InvestigationRuleWait.onWaitEnded(
        {
          ...subject,
          createdAt,
          waitUntil,
          currentStateId:
            subject.lane === "Incident"
              ? (read.record as Incident).currentIncidentStateId
              : (read.record as Alert).currentAlertStateId,
        },
        {
          waitMinutes:
            waitMinutes || getInvestigationWaitMinutes(createdAt, waitUntil),
        },
      );
    } catch (error) {
      logger.error(
        `AI: could not follow a change of ${describeSubject(subject)} with its investigation wait; the wait ends as it was: ${error}`,
      );
    }
  }

  /*
   * Someone asked OneUptime AI to investigate a waiting record now (the AI
   * card's Investigate now): a manual start ignores the wait - and the
   * rules, the severity floor and the cooldown, as asking for an
   * investigation does - but not what stops OneUptime AI altogether (AI
   * off, no provider, no credits) nor the limits. The caller has checked
   * that the person may change the record. Never throws.
   */
  @CaptureSpan()
  public static async startNow(
    subject: RuleWaitSubject,
  ): Promise<StartNowResult> {
    try {
      const waiting: WaitingInvestigation | null =
        await InvestigationRuleWait.getWaiting(subject);

      if (!waiting) {
        return startNowProblem(
          (await InvestigationRuleWait.hasInvestigationRun(subject))
            ? "already_investigated"
            : "not_waiting",
        );
      }

      /*
       * What stops OneUptime AI altogether. Automatic investigation being
       * switched off since does not: this is someone asking.
       */
      const disabled: InvestigationNotStartedCode | null =
        await AIInvestigationEngine.getDisabledReason(
          subject.projectId,
          subject.lane,
        );

      if (disabled && disabled !== "automatic_investigation_disabled") {
        return startNowProblem(disabled);
      }

      let notEnqueuedCode: InvestigationNotStartedCode | null = null;

      const runId: ObjectID | null = await AIInvestigationQueue.enqueue({
        projectId: subject.projectId,
        ...(subject.lane === "Incident"
          ? { subjectIncidentId: subject.subjectId }
          : { subjectAlertId: subject.subjectId }),
        subjectMonitorId:
          await InvestigationRuleWait.getFirstMonitorId(subject),
        ruleWaitMinutes: waiting.waitMinutes,
        // Told to the person, not recorded: nothing was decided for them.
        onNotEnqueued: async (
          code: InvestigationNotStartedCode,
        ): Promise<void> => {
          notEnqueuedCode = code;
        },
        admitInsideSubjectLock: async (): Promise<boolean> => {
          return !(await InvestigationRuleWait.hasInvestigationRun(subject));
        },
      });

      if (!runId) {
        return startNowProblem(notEnqueuedCode || "already_investigated");
      }

      // No longer waiting; the job finds nothing left to do if it got here first.
      await InvestigationRuleWait.takeOffWaitingList({
        ...subject,
        waitUntil: waiting.waitUntil,
      });

      return { isStarted: true, runId };
    } catch (error) {
      logger.error(
        `AI: could not start the waiting investigation of ${describeSubject(subject)} now: ${error}`,
      );
      return startNowProblem("enqueue_failed");
    }
  }

  /*
   * Whether the record waits for its investigation, and until when. Null
   * when it does not, or cannot be read. The caller has checked the reader
   * may see the record.
   */
  @CaptureSpan()
  public static async getWaiting(
    subject: RuleWaitSubject,
  ): Promise<WaitingInvestigation | null> {
    try {
      const record: Incident | Alert | null =
        subject.lane === "Incident"
          ? await IncidentService.findOneBy({
              query: {
                _id: subject.subjectId.toString(),
                projectId: subject.projectId,
              },
              select: {
                _id: true,
                createdAt: true,
                aiInvestigationWaitUntil: true,
              },
              props: { isRoot: true },
            })
          : await AlertService.findOneBy({
              query: {
                _id: subject.subjectId.toString(),
                projectId: subject.projectId,
              },
              select: {
                _id: true,
                createdAt: true,
                aiInvestigationWaitUntil: true,
              },
              props: { isRoot: true },
            });

      if (!record?.aiInvestigationWaitUntil || !record.createdAt) {
        return null;
      }

      return {
        waitUntil: record.aiInvestigationWaitUntil,
        waitMinutes:
          getInvestigationWaitMinutes(
            record.createdAt,
            record.aiInvestigationWaitUntil,
          ) || 1,
      };
    } catch (error) {
      logger.error(
        `AI: could not read whether the investigation of ${describeSubject(subject)} waits: ${error}`,
      );
      return null;
    }
  }

  /*
   * Whether the record has an investigation run of its own: its rule's
   * waited run, or one someone asked for. A record that waited had none
   * before the wait (it waited from the moment it was created), so any is
   * the one investigation it gets.
   */
  public static async hasInvestigationRun(
    subject: RuleWaitSubject,
  ): Promise<boolean> {
    const runs: number = (
      await AIRunService.countBy({
        query: {
          projectId: subject.projectId,
          runType: AIRunType.Investigation,
          ...(subject.lane === "Incident"
            ? { triggeredByIncidentId: subject.subjectId }
            : { triggeredByAlertId: subject.subjectId }),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    return runs > 0;
  }

  /*
   * Clear the record's wait, only while it still holds the time read: true
   * for the one caller that does, false for every other.
   */
  private static async takeOffWaitingList(data: {
    lane: RuleWaitLane;
    projectId: ObjectID;
    subjectId: ObjectID;
    waitUntil: Date;
  }): Promise<boolean> {
    return await InvestigationRuleWait.compareAndSetWait({
      lane: data.lane,
      projectId: data.projectId,
      subjectId: data.subjectId,
      expected: data.waitUntil,
      next: null,
    });
  }

  // Move a wait's end, only while it still holds the time read.
  private static async moveWait(data: {
    lane: RuleWaitLane;
    projectId: ObjectID;
    subjectId: ObjectID;
    waitUntil: Date;
    newWaitUntil: Date;
  }): Promise<boolean> {
    return await InvestigationRuleWait.compareAndSetWait({
      lane: data.lane,
      projectId: data.projectId,
      subjectId: data.subjectId,
      expected: data.waitUntil,
      next: data.newWaitUntil,
    });
  }

  /*
   * The one write of a record's wait: `next` (null clears it), only while
   * the record is the project's and holds `expected` (null: holds none).
   * Bookkeeping, not an edit of the record: no hooks, no updatedAt.
   */
  private static async compareAndSetWait(data: {
    lane: RuleWaitLane;
    projectId: ObjectID;
    subjectId: ObjectID;
    expected: Date | null;
    next: Date | null;
  }): Promise<boolean> {
    if (data.lane === "Incident") {
      return await IncidentService.compareAndSetColumnsByIdWithoutHooks({
        id: data.subjectId,
        data: { aiInvestigationWaitUntil: data.next },
        expectedData: {
          projectId: data.projectId,
          aiInvestigationWaitUntil: data.expected,
        },
        skipUpdateDateColumn: true,
      });
    }

    return await AlertService.compareAndSetColumnsByIdWithoutHooks({
      id: data.subjectId,
      data: { aiInvestigationWaitUntil: data.next },
      expectedData: {
        projectId: data.projectId,
        aiInvestigationWaitUntil: data.expected,
      },
      skipUpdateDateColumn: true,
    });
  }

  /*
   * Whether the record is still open: in a state that does not count as
   * resolved, by the one rule for resolved (Common/Utils/ResolvedState) - a
   * state the project placed after Resolved counts as resolved too. A
   * record whose state cannot be told counts as open: it is investigated
   * rather than skipped, as everything else here fails.
   */
  private static async isOpen(wait: EndedWait): Promise<boolean> {
    if (!wait.currentStateId) {
      return true;
    }

    const openStateIds: Array<ObjectID> =
      wait.lane === "Incident"
        ? await IncidentStateService.getUnresolvedIncidentStateIds(
            wait.projectId,
          )
        : await AlertStateService.getUnresolvedAlertStateIds(wait.projectId);

    return openStateIds.some((id: ObjectID): boolean => {
      return id.toString() === wait.currentStateId?.toString();
    });
  }

  /*
   * A waiting record, with what the rules read, and the rules it matches
   * now. Null when it does not wait (or cannot be read).
   */
  private static async readWaitingRecordScope(
    subject: RuleWaitSubject,
  ): Promise<{
    record: Incident | Alert;
    scope: InvestigationRuleScope;
  } | null> {
    if (subject.lane === "Incident") {
      const incident: Incident | null = await IncidentService.findOneBy({
        query: {
          _id: subject.subjectId.toString(),
          projectId: subject.projectId,
        },
        select: {
          _id: true,
          createdAt: true,
          aiInvestigationWaitUntil: true,
          currentIncidentStateId: true,
          // What an investigation rule matches on.
          title: true,
          description: true,
          incidentSeverityId: true,
          labels: { _id: true },
          monitors: { _id: true },
        },
        props: { isRoot: true },
      });

      if (!incident?.aiInvestigationWaitUntil) {
        return null;
      }

      return {
        record: incident,
        scope: await InvestigationRules.getIncidentScope({
          projectId: subject.projectId,
          incident,
        }),
      };
    }

    const alert: Alert | null = await AlertService.findOneBy({
      query: {
        _id: subject.subjectId.toString(),
        projectId: subject.projectId,
      },
      select: {
        _id: true,
        createdAt: true,
        aiInvestigationWaitUntil: true,
        currentAlertStateId: true,
        // What an investigation rule matches on.
        title: true,
        description: true,
        alertSeverityId: true,
        labels: { _id: true },
        monitorId: true,
      },
      props: { isRoot: true },
    });

    if (!alert?.aiInvestigationWaitUntil) {
      return null;
    }

    return {
      record: alert,
      scope: await InvestigationRules.getAlertScope({
        projectId: subject.projectId,
        alert,
      }),
    };
  }

  /*
   * The record's first monitor: the run's dedupe key for the monitor
   * cooldown, as a run queued when the record was created would carry.
   */
  private static async getFirstMonitorId(
    subject: RuleWaitSubject,
  ): Promise<ObjectID | undefined> {
    if (subject.lane === "Alert") {
      const alert: Alert | null = await AlertService.findOneBy({
        query: {
          _id: subject.subjectId.toString(),
          projectId: subject.projectId,
        },
        select: { _id: true, monitorId: true },
        props: { isRoot: true },
      });

      return alert?.monitorId || undefined;
    }

    const incident: Incident | null = await IncidentService.findOneBy({
      query: {
        _id: subject.subjectId.toString(),
        projectId: subject.projectId,
      },
      select: { _id: true, monitors: { _id: true } },
      props: { isRoot: true },
    });
    const firstMonitorId: string | undefined = incident?.monitors?.[0]?._id;

    return firstMonitorId ? new ObjectID(firstMonitorId) : undefined;
  }
}

function startNowProblem(problem: StartNowProblem): StartNowResult {
  return {
    isStarted: false,
    problem,
    message: START_NOW_MESSAGES[problem] || START_NOW_FALLBACK_MESSAGE,
  };
}

function describeSubject(subject: RuleWaitSubject): string {
  return `${subject.lane === "Incident" ? "incident" : "alert"} ${subject.subjectId.toString()}`;
}

function toEndedWait(data: {
  lane: RuleWaitLane;
  id: ObjectID | null;
  projectId: ObjectID | undefined;
  createdAt: Date | undefined;
  waitUntil: Date | undefined;
  currentStateId: ObjectID | undefined;
}): EndedWait | null {
  if (!data.id || !data.projectId || !data.createdAt || !data.waitUntil) {
    return null;
  }

  return {
    lane: data.lane,
    projectId: data.projectId,
    subjectId: data.id,
    createdAt: data.createdAt,
    waitUntil: data.waitUntil,
    currentStateId: data.currentStateId,
  };
}
