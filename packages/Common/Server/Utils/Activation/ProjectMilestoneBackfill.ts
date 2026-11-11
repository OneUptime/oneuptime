import ProjectMilestoneService from "../../Services/ProjectMilestoneService";
import ActivationMilestone, {
  DELIVERED_NOTIFICATION_STATUSES,
} from "../../../Types/Analytics/ActivationMilestone";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import { ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";

/*
 * Fills the activation milestones of the projects that existed before
 * milestones were kept (issue #6830), from the data they already have, so
 * an old project does not look new: to the Admin Dashboard's project list,
 * to the Welcome checklist (#6803) and to the funnel's baseline
 * (Docs/analytics/activation.md).
 *
 * Every row it writes says wasBackfilled, and it sends no event. Its time
 * is the best the data has:
 *
 *   - first monitor, status page with a monitor, on-call policy run, on-call
 *     page delivered, acknowledgement, subscriber: when that record was
 *     created - exact, unless the record has since been deleted;
 *   - second person: when the second person to accept did (their
 *     invitationAcceptedAt, or their membership's creation);
 *   - check result: when the first monitor a probe has checked was handed
 *     to it, or when the first monitor that has received a heartbeat, an
 *     incoming request, an email or a server report was created - a stored
 *     result is kept in ClickHouse for only a day or so;
 *   - telemetry of each kind: the first day it was metered
 *     (TelemetryUsageBilling), which only an installation with billing on
 *     keeps - OneUptime Cloud. Elsewhere a project's first batch after the
 *     upgrade keeps it, at that time;
 *   - a test page acknowledged: nothing to fill it from (#6811 is new).
 *
 * Walks the projects in primary key order, a batch at a time, so each
 * statement reads one batch's rows through the projectId indexes and none
 * runs into the statement timeout. Idempotent and safe to run twice at
 * once: every INSERT is ON CONFLICT DO NOTHING, so a milestone kept since
 * the upgrade - live, with its event - is never overwritten.
 */

export const PROJECT_MILESTONE_BACKFILL_BATCH_SIZE: number = 200;

export interface MilestoneBackfillSource {
  milestone: ActivationMilestone;
  /*
   * One row per project of the batch ($1, a uuid[]) that reached the
   * milestone: "projectId" and "reachedAt".
   */
  sql: string;
  parameters?: Array<unknown> | undefined;
}

const telemetryUsageSource: (
  milestone: ActivationMilestone,
  productType: ProductType,
) => MilestoneBackfillSource = (
  milestone: ActivationMilestone,
  productType: ProductType,
): MilestoneBackfillSource => {
  return {
    milestone: milestone,
    sql: `SELECT "projectId", MIN("createdAt") AS "reachedAt" FROM "TelemetryUsageBilling" WHERE "projectId" = ANY($1::uuid[]) AND "productType" = $2 GROUP BY "projectId"`,
    parameters: [productType],
  };
};

export const MILESTONE_BACKFILL_SOURCES: ReadonlyArray<MilestoneBackfillSource> =
  [
    {
      milestone: ActivationMilestone.FirstMonitorCreated,
      sql: `SELECT "projectId", MIN("createdAt") AS "reachedAt" FROM "Monitor" WHERE "projectId" = ANY($1::uuid[]) GROUP BY "projectId"`,
    },
    {
      milestone: ActivationMilestone.FirstCheckResultReceived,
      sql: `SELECT "projectId", MIN("reachedAt") AS "reachedAt" FROM (SELECT "projectId", "createdAt" AS "reachedAt" FROM "MonitorProbe" WHERE "projectId" = ANY($1::uuid[]) AND "lastPingAt" IS NOT NULL UNION ALL SELECT "projectId", "createdAt" AS "reachedAt" FROM "Monitor" WHERE "projectId" = ANY($1::uuid[]) AND ("serverMonitorRequestReceivedAt" IS NOT NULL OR "incomingEmailMonitorLastEmailReceivedAt" IS NOT NULL OR "incomingMonitorRequest" IS NOT NULL)) AS "results" GROUP BY "projectId"`,
    },
    {
      milestone: ActivationMilestone.FirstNotificationDelivered,
      sql: `SELECT "projectId", MIN("createdAt") AS "reachedAt" FROM "UserOnCallLogTimeline" WHERE "projectId" = ANY($1::uuid[]) AND "status" = ANY($2::text[]) GROUP BY "projectId"`,
      parameters: [[...DELIVERED_NOTIFICATION_STATUSES]],
    },
    {
      /*
       * Acknowledged or resolved - what the product's one rule counts
       * (AcknowledgedState) - on a row a person made.
       */
      milestone: ActivationMilestone.FirstIncidentOrAlertAcknowledged,
      sql: `SELECT "projectId", MIN("reachedAt") AS "reachedAt" FROM (SELECT "timeline"."projectId", "timeline"."createdAt" AS "reachedAt" FROM "IncidentStateTimeline" AS "timeline" JOIN "IncidentState" AS "state" ON "state"."_id" = "timeline"."incidentStateId" WHERE "timeline"."projectId" = ANY($1::uuid[]) AND "timeline"."createdByUserId" IS NOT NULL AND ("state"."isAcknowledgedState" = true OR "state"."isResolvedState" = true) UNION ALL SELECT "timeline"."projectId", "timeline"."createdAt" AS "reachedAt" FROM "AlertStateTimeline" AS "timeline" JOIN "AlertState" AS "state" ON "state"."_id" = "timeline"."alertStateId" WHERE "timeline"."projectId" = ANY($1::uuid[]) AND "timeline"."createdByUserId" IS NOT NULL AND ("state"."isAcknowledgedState" = true OR "state"."isResolvedState" = true)) AS "acknowledgements" GROUP BY "projectId"`,
    },
    {
      milestone: ActivationMilestone.SecondMemberJoined,
      sql: `SELECT "projectId", "joinedAt" AS "reachedAt" FROM (SELECT "projectId", "joinedAt", ROW_NUMBER() OVER (PARTITION BY "projectId" ORDER BY "joinedAt", "userId") AS "position" FROM (SELECT "projectId", "userId", MIN(COALESCE("invitationAcceptedAt", "createdAt")) AS "joinedAt" FROM "TeamMember" WHERE "projectId" = ANY($1::uuid[]) AND "hasAcceptedInvitation" = true AND "userId" IS NOT NULL GROUP BY "projectId", "userId") AS "members") AS "ranked" WHERE "position" = 2`,
    },
    {
      milestone: ActivationMilestone.FirstStatusPageMonitorAdded,
      sql: `SELECT "projectId", MIN("createdAt") AS "reachedAt" FROM "StatusPageResource" WHERE "projectId" = ANY($1::uuid[]) AND ("monitorId" IS NOT NULL OR "monitorGroupId" IS NOT NULL) GROUP BY "projectId"`,
    },
    {
      milestone: ActivationMilestone.FirstStatusPageSubscriberAdded,
      sql: `SELECT "projectId", MIN("createdAt") AS "reachedAt" FROM "StatusPageSubscriber" WHERE "projectId" = ANY($1::uuid[]) AND "isSubscriptionConfirmed" = true GROUP BY "projectId"`,
    },
    {
      // A policy's run - not a direct page (no policy), nor an archived policy's.
      milestone: ActivationMilestone.FirstOnCallPolicyExecuted,
      sql: `SELECT "projectId", MIN("createdAt") AS "reachedAt" FROM "OnCallDutyPolicyExecutionLog" WHERE "projectId" = ANY($1::uuid[]) AND "onCallDutyPolicyId" IS NOT NULL AND "statusMessage" IS DISTINCT FROM $2 GROUP BY "projectId"`,
      parameters: [ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE],
    },
    telemetryUsageSource(ActivationMilestone.FirstLogsReceived, ProductType.Logs),
    telemetryUsageSource(
      ActivationMilestone.FirstTracesReceived,
      ProductType.Traces,
    ),
    telemetryUsageSource(
      ActivationMilestone.FirstMetricsReceived,
      ProductType.Metrics,
    ),
    {
      // Exceptions are metered with the traces and logs they came in.
      milestone: ActivationMilestone.FirstExceptionsReceived,
      sql: `SELECT "projectId", MIN("createdAt") AS "reachedAt" FROM "TelemetryUsageBilling" WHERE "projectId" = ANY($1::uuid[]) AND "exceptionDataIngestedInGB" > 0 GROUP BY "projectId"`,
    },
    telemetryUsageSource(
      ActivationMilestone.FirstProfilesReceived,
      ProductType.Profiles,
    ),
  ];

export interface ProjectMilestoneBackfillResult {
  projects: number;
  keptByMilestone: Partial<Record<ActivationMilestone, number>>;
}

type QueryFunction = (
  sql: string,
  parameters: Array<unknown>,
) => Promise<unknown>;

const readRows: (result: unknown) => Array<Record<string, unknown>> = (
  result: unknown,
): Array<Record<string, unknown>> => {
  return Array.isArray(result) ? (result as Array<Record<string, unknown>>) : [];
};

export default class ProjectMilestoneBackfill {
  public static async backfill(options?: {
    batchSize?: number | undefined;
    query?: QueryFunction | undefined;
  }): Promise<ProjectMilestoneBackfillResult> {
    const batchSize: number = Math.max(
      1,
      Math.floor(options?.batchSize || PROJECT_MILESTONE_BACKFILL_BATCH_SIZE),
    );

    const query: QueryFunction =
      options?.query ||
      (async (sql: string, parameters: Array<unknown>): Promise<unknown> => {
        return await ProjectMilestoneService.getRepository().manager.query(
          sql,
          parameters,
        );
      });

    const result: ProjectMilestoneBackfillResult = {
      projects: 0,
      keptByMilestone: {},
    };

    let lastProjectId: string | null = null;

    for (;;) {
      const projectIds: Array<string> = readRows(
        await query(
          `SELECT "_id"::text AS "_id" FROM "Project" WHERE ($2::uuid IS NULL OR "_id" > $2::uuid) ORDER BY "_id" ASC LIMIT $1`,
          [batchSize, lastProjectId],
        ),
      ).map((row: Record<string, unknown>): string => {
        return String(row["_id"]);
      });

      if (projectIds.length === 0) {
        break;
      }

      result.projects += projectIds.length;

      for (const source of MILESTONE_BACKFILL_SOURCES) {
        const parameters: Array<unknown> = [
          projectIds,
          ...(source.parameters || []),
        ];

        // The milestone goes in as the statement's last parameter.
        parameters.push(source.milestone);

        const kept: number = readRows(
          await query(
            `WITH "reached" AS (${source.sql}) INSERT INTO "ProjectMilestone" ("projectId", "milestone", "reachedAt", "wasBackfilled", "version") SELECT "projectId", $${parameters.length}::varchar, "reachedAt", true, 1 FROM "reached" WHERE "projectId" IS NOT NULL AND "reachedAt" IS NOT NULL ON CONFLICT ("projectId", "milestone") DO NOTHING RETURNING "_id"`,
            parameters,
          ),
        ).length;

        result.keptByMilestone[source.milestone] =
          (result.keptByMilestone[source.milestone] || 0) + kept;
      }

      lastProjectId = projectIds[projectIds.length - 1]!;

      if (projectIds.length < batchSize) {
        break;
      }
    }

    return result;
  }
}
