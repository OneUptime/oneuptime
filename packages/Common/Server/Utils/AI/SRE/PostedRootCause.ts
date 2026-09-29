import IncidentFeedService from "../../../Services/IncidentFeedService";
import AlertFeedService from "../../../Services/AlertFeedService";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../../Models/DatabaseModels/IncidentFeed";
import AlertFeed, {
  AlertFeedEventType,
} from "../../../../Models/DatabaseModels/AlertFeed";
import ObjectID from "../../../../Types/ObjectID";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import QueryHelper from "../../../Types/Database/QueryHelper";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export const AI_ROOT_CAUSE_HEADING: string =
  "AI — Automated Root Cause Analysis";

export interface PostedRootCauseQueryOptions {
  /* Exact ownership for newly posted AI investigation reports. */
  aiRunId?: ObjectID | undefined;
  /* Upgrade-only lookup for RootCause rows written before aiRunId existed. */
  withoutAIRunId?: boolean | undefined;
  /*
   * A subject can be investigated more than once. When a caller is resolving
   * the analysis for one particular run, it must not accidentally return a
   * RootCause item posted by an older run while the new one is still being
   * finalized.
   */
  createdAtOrAfter?: Date | undefined;
}

/*
 * The analysis an AI investigation posted for a subject.
 *
 * The RootCause feed item is the only persisted copy — the runner's
 * postAnalysis is its sole writer, and the grader, the eval corpus and the
 * fix-from-incident recipe all read it. Anything else that wants the RCA
 * should come through here rather than re-deriving the query, so a change to
 * where the analysis lives moves one place.
 */
export default class PostedRootCause {
  /*
   * Resolve one run's report exactly. A narrow compatibility path keeps
   * reports written before aiRunId was deployed visible. Deployment time is
   * not the migration file's build timestamp, so compatibility cannot use a
   * wall-clock cutover. Instead, only null-associated rows posted after the
   * run completed and carrying the server's branded AI heading qualify.
   */
  @CaptureSpan()
  public static async getForInvestigation(data: {
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    aiRunId: ObjectID;
    runCompletedAt?: Date | undefined;
  }): Promise<string | null> {
    const exactAnalysis: string | null = await this.getForSubject({
      incidentId: data.incidentId,
      alertId: data.alertId,
      aiRunId: data.aiRunId,
    });

    if (exactAnalysis) {
      return exactAnalysis;
    }

    if (!data.runCompletedAt) {
      return null;
    }

    const legacyAnalysis: string | null = await this.getForSubject({
      incidentId: data.incidentId,
      alertId: data.alertId,
      withoutAIRunId: true,
      createdAtOrAfter: data.runCompletedAt,
    });

    return legacyAnalysis?.includes(AI_ROOT_CAUSE_HEADING)
      ? legacyAnalysis
      : null;
  }

  @CaptureSpan()
  public static async getForIncident(
    incidentId: ObjectID,
    options?: PostedRootCauseQueryOptions | undefined,
  ): Promise<string | null> {
    const feedItem: IncidentFeed | null = await IncidentFeedService.findOneBy({
      query: {
        incidentId: incidentId,
        incidentFeedEventType: IncidentFeedEventType.RootCause,
        ...(options?.aiRunId ? { aiRunId: options.aiRunId } : {}),
        ...(options?.withoutAIRunId ? { aiRunId: QueryHelper.isNull() } : {}),
        ...(options?.createdAtOrAfter
          ? {
              createdAt: QueryHelper.greaterThanEqualTo(
                options.createdAtOrAfter,
              ),
            }
          : {}),
      },
      select: {
        feedInfoInMarkdown: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      props: { isRoot: true },
    });

    const analysis: string = (feedItem?.feedInfoInMarkdown || "").trim();

    return analysis || null;
  }

  @CaptureSpan()
  public static async getForAlert(
    alertId: ObjectID,
    options?: PostedRootCauseQueryOptions | undefined,
  ): Promise<string | null> {
    const feedItem: AlertFeed | null = await AlertFeedService.findOneBy({
      query: {
        alertId: alertId,
        alertFeedEventType: AlertFeedEventType.RootCause,
        ...(options?.aiRunId ? { aiRunId: options.aiRunId } : {}),
        ...(options?.withoutAIRunId ? { aiRunId: QueryHelper.isNull() } : {}),
        ...(options?.createdAtOrAfter
          ? {
              createdAt: QueryHelper.greaterThanEqualTo(
                options.createdAtOrAfter,
              ),
            }
          : {}),
      },
      select: {
        feedInfoInMarkdown: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      props: { isRoot: true },
    });

    const analysis: string = (feedItem?.feedInfoInMarkdown || "").trim();

    return analysis || null;
  }

  @CaptureSpan()
  public static async getForSubject(data: {
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    aiRunId?: ObjectID | undefined;
    withoutAIRunId?: boolean | undefined;
    createdAtOrAfter?: Date | undefined;
  }): Promise<string | null> {
    if (data.incidentId) {
      return PostedRootCause.getForIncident(data.incidentId, {
        aiRunId: data.aiRunId,
        withoutAIRunId: data.withoutAIRunId,
        createdAtOrAfter: data.createdAtOrAfter,
      });
    }

    if (data.alertId) {
      return PostedRootCause.getForAlert(data.alertId, {
        aiRunId: data.aiRunId,
        withoutAIRunId: data.withoutAIRunId,
        createdAtOrAfter: data.createdAtOrAfter,
      });
    }

    return null;
  }
}
