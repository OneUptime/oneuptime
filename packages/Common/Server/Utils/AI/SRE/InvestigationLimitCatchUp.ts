import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import InvestigationNotStartedReason, {
  InvestigationNotStartedCode,
} from "../../../../Types/AI/InvestigationNotStartedReason";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunService from "../../../Services/AIRunService";
import AIService from "../../../Services/AIService";
import AlertService from "../../../Services/AlertService";
import AlertStateService from "../../../Services/AlertStateService";
import IncidentService from "../../../Services/IncidentService";
import IncidentStateService from "../../../Services/IncidentStateService";
import ProjectService from "../../../Services/ProjectService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIAlertInvestigationRunner from "./AlertInvestigationRunner";
import AIIncidentInvestigationRunner from "./IncidentInvestigationRunner";

/*
 * AI SRE - incidents and alerts skipped while the project's own daily AI
 * limit was reached are investigated after the reset.
 *
 * When a project's own daily AI limit (Project Settings → AI Features →
 * More settings) stops OneUptime AI, a new incident or alert is not
 * investigated: its AI card records project_daily_limit_reached. Before
 * this, nothing came back for it - after midnight UTC, when the count
 * starts again, it stayed uninvestigated however long it stayed open.
 *
 * Now a Workers job (AIChat:InvestigateAfterDailyLimitReset) takes such
 * records back once the limit no longer stops AI - the reset, or an owner
 * raising or removing the limit - when they are:
 *   - still open: in a state that does not count as resolved, read with the
 *     state services' own rule (getUnresolvedIncidentStates and its alert
 *     twin). A record resolved meanwhile is never investigated late;
 *   - less than a day old (LIMIT_CATCH_UP_WINDOW_HOURS): every record has a
 *     reset within a day of it, and an analysis later than that is not the
 *     first look it was meant to be;
 *   - not investigated since (someone asked AI to, say): no second run.
 *
 * Each goes through the new-record investigation path again - AI on, the
 * lane's automatic investigation on, a provider and credits, the severity
 * floor, the monitor cooldown, the lane's daily token limit, the project's
 * own limits - so the limits and settings of now decide, as they would for
 * a new record, and whatever stops it is recorded on its card instead.
 * Once each: a record is taken off the waiting list with a compare-and-set
 * of the reason it holds, so two workers can never both take it, and a
 * record investigated (or skipped for another reason) is never taken again.
 * One the limit stops again waits for the following reset, while it is
 * still less than a day old.
 *
 * Gently: a few records per lane per run (LIMIT_CATCH_UP_BATCH_SIZE), the
 * most recent first, only into a lane whose queue is empty - work already
 * waiting for a concurrency slot (new incidents and alerts) goes first, and
 * the queue's own TTL never expires a catch-up run that never had a chance
 * - and the project's limit is checked again before each one, so the
 * catch-up stops the moment the limit is reached again.
 *
 * The projects looked at are those whose limit stopped AI in the last two
 * days: the ...ReachedAt columns the owners' notice writes once a day
 * (ProjectAiDailyLimitOwnerNotice). A record skipped by the limit was
 * skipped by a check that wrote its project's column that same day.
 */

// A record skipped more than this long ago is not investigated late.
export const LIMIT_CATCH_UP_WINDOW_HOURS: number = 24;

// How many records of one lane of one project a run takes on.
export const LIMIT_CATCH_UP_BATCH_SIZE: number = 10;

/*
 * The projects whose limit stopped AI this recently are looked at: a record
 * less than LIMIT_CATCH_UP_WINDOW_HOURS old was skipped yesterday or today.
 */
export const LIMIT_CATCH_UP_PROJECT_LOOKBACK_HOURS: number = 48;

const PROJECT_DAILY_LIMIT_REACHED: InvestigationNotStartedCode =
  "project_daily_limit_reached";

export type LimitCatchUpLane = "Incident" | "Alert";

const LANES: ReadonlyArray<LimitCatchUpLane> = ["Incident", "Alert"];

export interface LimitCatchUpLaneResult {
  lane: LimitCatchUpLane;
  // Open records the limit skipped, less than a day old, read this run.
  waiting: number;
  // Taken off the waiting list and sent down the investigation path.
  retried: number;
  // Of those, the ones an investigation was queued for.
  investigated: number;
  // Already investigated since they were skipped: taken off, not retried.
  alreadyInvestigated: number;
  // Taken by another worker between the read and the claim.
  takenElsewhere: number;
  // The lane's queue had work waiting: nothing added this run.
  isLaneBusy: boolean;
}

export interface LimitCatchUpProjectResult {
  projectId: ObjectID;
  // The project's limit still stops AI (or stopped it again): run ends here.
  limitStillReached: boolean;
  lanes: Array<LimitCatchUpLaneResult>;
}

type CatchUpRecord = Incident | Alert;

export default class InvestigationLimitCatchUp {
  /*
   * One run of the job: every project whose limit stopped AI recently, one
   * at a time. Never throws - a project that fails is logged and the rest
   * still run.
   */
  @CaptureSpan()
  public static async run(): Promise<Array<LimitCatchUpProjectResult>> {
    let projectIds: Array<ObjectID> = [];

    try {
      projectIds = await this.getProjectIds();
    } catch (error) {
      logger.error(
        `AI: could not read the projects whose daily AI limit was reached; skipped investigations are caught up on the next run: ${error}`,
      );
      return [];
    }

    const results: Array<LimitCatchUpProjectResult> = [];

    for (const projectId of projectIds) {
      try {
        results.push(await this.catchUpProject(projectId));
      } catch (error) {
        logger.error(
          `AI: could not catch up the investigations project ${projectId.toString()} skipped at its daily AI limit: ${error}`,
        );
      }
    }

    return results;
  }

  /*
   * The projects whose own daily AI limit stopped OneUptime AI in the last
   * LIMIT_CATCH_UP_PROJECT_LOOKBACK_HOURS: only they can have records
   * waiting. Each project once.
   */
  @CaptureSpan()
  public static async getProjectIds(): Promise<Array<ObjectID>> {
    const since: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.getCurrentDate(),
      -LIMIT_CATCH_UP_PROJECT_LOOKBACK_HOURS,
    );

    const [tokenLimitReached, spendLimitReached]: [
      Array<Project>,
      Array<Project>,
    ] = await Promise.all([
      ProjectService.findBy({
        query: {
          aiDailyTokenLimitReachedAt: QueryHelper.greaterThanEqualTo(since),
        },
        select: { _id: true },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      }),
      ProjectService.findBy({
        query: {
          aiDailySpendLimitReachedAt: QueryHelper.greaterThanEqualTo(since),
        },
        select: { _id: true },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      }),
    ]);

    const projectIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const project of [...tokenLimitReached, ...spendLimitReached]) {
      const id: ObjectID | null = project.id;

      if (id && !projectIds.has(id.toString())) {
        projectIds.set(id.toString(), id);
      }
    }

    return Array.from(projectIds.values());
  }

  /*
   * Catch up one project: its incidents, then its alerts, until the limit
   * stops AI again.
   */
  @CaptureSpan()
  public static async catchUpProject(
    projectId: ObjectID,
  ): Promise<LimitCatchUpProjectResult> {
    const result: LimitCatchUpProjectResult = {
      projectId,
      limitStillReached: false,
      lanes: [],
    };

    for (const lane of LANES) {
      const laneResult: {
        lane: LimitCatchUpLaneResult;
        isStoppedByLimit: boolean;
      } = await this.catchUpLane({ projectId, lane });

      result.lanes.push(laneResult.lane);

      if (laneResult.isStoppedByLimit) {
        result.limitStillReached = true;
        break;
      }
    }

    return result;
  }

  /*
   * The records of one lane waiting for the limit: open, skipped with
   * project_daily_limit_reached, less than a day old - the most recent
   * first, at most a batch. The reason is read with them: taking a record
   * off the list compares it whole.
   */
  @CaptureSpan()
  public static async getWaitingRecords(data: {
    projectId: ObjectID;
    lane: LimitCatchUpLane;
  }): Promise<Array<CatchUpRecord>> {
    const createdSince: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.getCurrentDate(),
      -LIMIT_CATCH_UP_WINDOW_HOURS,
    );

    const skippedByTheLimit: ReturnType<typeof QueryHelper.jsonContains> =
      QueryHelper.jsonContains({ code: PROJECT_DAILY_LIMIT_REACHED });

    if (data.lane === "Incident") {
      const openStateIds: Array<ObjectID> = this.toIds(
        await IncidentStateService.getUnresolvedIncidentStates(data.projectId, {
          isRoot: true,
        }),
      );

      if (openStateIds.length === 0) {
        return [];
      }

      return await IncidentService.findBy({
        query: {
          projectId: data.projectId,
          currentIncidentStateId: QueryHelper.any(openStateIds),
          aiInvestigationDecision: skippedByTheLimit,
          createdAt: QueryHelper.greaterThanEqualTo(createdSince),
        },
        select: { _id: true, aiInvestigationDecision: true },
        sort: { createdAt: SortOrder.Descending },
        limit: LIMIT_CATCH_UP_BATCH_SIZE,
        skip: 0,
        props: { isRoot: true },
      });
    }

    const openStateIds: Array<ObjectID> = this.toIds(
      await AlertStateService.getUnresolvedAlertStates(data.projectId, {
        isRoot: true,
      }),
    );

    if (openStateIds.length === 0) {
      return [];
    }

    return await AlertService.findBy({
      query: {
        projectId: data.projectId,
        currentAlertStateId: QueryHelper.any(openStateIds),
        aiInvestigationDecision: skippedByTheLimit,
        createdAt: QueryHelper.greaterThanEqualTo(createdSince),
      },
      select: { _id: true, aiInvestigationDecision: true },
      sort: { createdAt: SortOrder.Descending },
      limit: LIMIT_CATCH_UP_BATCH_SIZE,
      skip: 0,
      props: { isRoot: true },
    });
  }

  private static async catchUpLane(data: {
    projectId: ObjectID;
    lane: LimitCatchUpLane;
  }): Promise<{ lane: LimitCatchUpLaneResult; isStoppedByLimit: boolean }> {
    const result: LimitCatchUpLaneResult = {
      lane: data.lane,
      waiting: 0,
      retried: 0,
      investigated: 0,
      alreadyInvestigated: 0,
      takenElsewhere: 0,
      isLaneBusy: false,
    };

    const waiting: Array<CatchUpRecord> = await this.getWaitingRecords(data);

    result.waiting = waiting.length;

    // Nothing waiting costs nothing more: no limit read, no queue count.
    if (waiting.length === 0) {
      return { lane: result, isStoppedByLimit: false };
    }

    if (await this.isLaneBusy(data)) {
      result.isLaneBusy = true;
      return { lane: result, isStoppedByLimit: false };
    }

    for (const record of waiting) {
      const recordId: ObjectID | null = record.id;

      if (!recordId) {
        continue;
      }

      /*
       * Before each one: the limit may still stop AI (it has not reset yet,
       * or the work just caught up reached it again). Then the record keeps
       * waiting, untouched, and so does the rest of the project.
       */
      if (
        await AIService.getReachedProjectDailyLimit({
          projectId: data.projectId,
        })
      ) {
        return { lane: result, isStoppedByLimit: true };
      }

      const decision: InvestigationNotStartedReason | undefined =
        record.aiInvestigationDecision;

      if (
        await this.hasBeenInvestigated({
          projectId: data.projectId,
          lane: data.lane,
          recordId,
        })
      ) {
        await this.takeOffWaitingList({
          lane: data.lane,
          recordId,
          decision,
        });
        result.alreadyInvestigated++;
        continue;
      }

      if (
        !(await this.takeOffWaitingList({
          lane: data.lane,
          recordId,
          decision,
        }))
      ) {
        result.takenElsewhere++;
        continue;
      }

      result.retried++;

      /*
       * The new-record path, gates and all: it queues an investigation, or
       * records on the card why not (on the column just cleared).
       */
      const isInvestigationQueued: boolean =
        data.lane === "Incident"
          ? await AIIncidentInvestigationRunner.investigateNewIncident({
              incidentId: recordId,
              projectId: data.projectId,
            })
          : await AIAlertInvestigationRunner.investigateNewAlert({
              alertId: recordId,
              projectId: data.projectId,
            });

      if (isInvestigationQueued) {
        result.investigated++;
      }
    }

    return { lane: result, isStoppedByLimit: false };
  }

  /*
   * Whether the lane has work waiting in the investigation queue - runs
   * held by a concurrency cap the project set. The catch-up adds nothing
   * then: what is already waiting goes first, and a catch-up run queued
   * behind it could expire before it starts.
   */
  private static async isLaneBusy(data: {
    projectId: ObjectID;
    lane: LimitCatchUpLane;
  }): Promise<boolean> {
    /*
     * The lane as the queue counts it (InvestigationQueue's
     * getSubjectLaneQuery): investigations and remediation runs of the
     * project's incidents - or alerts - share its cap.
     */
    const queued: number = (
      await AIRunService.countBy({
        query: {
          projectId: data.projectId,
          runType: QueryHelper.any([
            AIRunType.Investigation,
            AIRunType.RemediationPlan,
            AIRunType.RemediationExecution,
          ]),
          status: AIRunStatus.Queued,
          ...(data.lane === "Incident"
            ? {
                triggeredByIncidentId: QueryHelper.notNull(),
                triggeredByAlertId: QueryHelper.isNull(),
              }
            : {
                triggeredByIncidentId: QueryHelper.isNull(),
                triggeredByAlertId: QueryHelper.notNull(),
              }),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    return queued > 0;
  }

  /*
   * Whether the record has had an investigation since it was skipped -
   * someone asked OneUptime AI to investigate it, say. A record skipped at
   * creation had none then, so any is a later one.
   */
  private static async hasBeenInvestigated(data: {
    projectId: ObjectID;
    lane: LimitCatchUpLane;
    recordId: ObjectID;
  }): Promise<boolean> {
    const runs: number = (
      await AIRunService.countBy({
        query: {
          projectId: data.projectId,
          runType: AIRunType.Investigation,
          ...(data.lane === "Incident"
            ? { triggeredByIncidentId: data.recordId }
            : { triggeredByAlertId: data.recordId }),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    return runs > 0;
  }

  /*
   * Clear the record's recorded reason, only while it still holds exactly
   * the one read: true for the one caller that does, false for every other
   * (another worker took it, or it was re-recorded meanwhile). Once it is
   * clear the record is no longer waiting, and the investigation path may
   * record a new reason on it.
   */
  private static async takeOffWaitingList(data: {
    lane: LimitCatchUpLane;
    recordId: ObjectID;
    decision: InvestigationNotStartedReason | undefined;
  }): Promise<boolean> {
    if (!data.decision) {
      return false;
    }

    if (data.lane === "Incident") {
      return await IncidentService.compareAndSetColumnsByIdWithoutHooks({
        id: data.recordId,
        data: { aiInvestigationDecision: null },
        expectedData: { aiInvestigationDecision: data.decision },
        skipUpdateDateColumn: true,
      });
    }

    return await AlertService.compareAndSetColumnsByIdWithoutHooks({
      id: data.recordId,
      data: { aiInvestigationDecision: null },
      expectedData: { aiInvestigationDecision: data.decision },
      skipUpdateDateColumn: true,
    });
  }

  private static toIds(
    states: Array<IncidentState | AlertState>,
  ): Array<ObjectID> {
    return states
      .map((state: IncidentState | AlertState): ObjectID | null => {
        return state.id;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return Boolean(id);
      });
  }
}
