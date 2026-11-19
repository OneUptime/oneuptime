import ProjectMilestoneService from "../../Services/ProjectMilestoneService";
import ActivationMilestone, {
  ACTIVATION_MILESTONE_OF_TELEMETRY_KIND,
  ActivationTelemetryKind,
} from "../../../Types/Analytics/ActivationMilestone";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import { JSONObject, JSONValue } from "../../../Types/JSON";

/*
 * The first telemetry of each kind a project sent (issue #6830; the
 * per-kind marks issue #6534 reads too): FirstLogsReceived,
 * FirstTracesReceived, FirstMetricsReceived, FirstExceptionsReceived and
 * FirstProfilesReceived.
 *
 * Marked by the fan-in writer (TelemetryFanInWriter.submit), the door
 * nearly every telemetry ingest path - OpenTelemetry over HTTP and gRPC,
 * Fluent, syslog, the cloud and Vercel log drains - hands its rows to
 * ClickHouse through: collect() reads which projects a submission's rows
 * belong to when it is handed over, and markReached() keeps the milestone
 * once ClickHouse has accepted them, so a batch that is refused or fails
 * sets nothing. The two writers that insert a network device's logs
 * themselves - its syslog, forwarded by a probe (ProbeSyslogIngestService),
 * and its SNMP traps (SnmpTrapLogWriter) - call markInserted() once their
 * insert has succeeded (#6897): the Logs explorer shows those lines as it
 * shows any other, so they are the project's first logs as much as an
 * app's.
 *
 * The ingest path is the busiest in the product, so collect() costs one
 * string comparison a row (a submission's rows are nearly always one
 * project's) and a memo lookup per project, and returns null - with no
 * promise, no allocation - once every project in the rows is known to have
 * the kind. Each process then writes a project's milestone at most once.
 */

export const TELEMETRY_KIND_OF_TABLE: Readonly<
  Record<string, ActivationTelemetryKind>
> = {
  [AnalyticsTableName.Log]: ActivationTelemetryKind.Logs,
  [AnalyticsTableName.Span]: ActivationTelemetryKind.Traces,
  [AnalyticsTableName.Metric]: ActivationTelemetryKind.Metrics,
  [AnalyticsTableName.ExceptionInstance]: ActivationTelemetryKind.Exceptions,
  // A profile is stored as its profile row and its samples.
  [AnalyticsTableName.Profile]: ActivationTelemetryKind.Profiles,
  [AnalyticsTableName.ProfileSample]: ActivationTelemetryKind.Profiles,
};

export interface PendingTelemetryMilestones {
  milestone: ActivationMilestone;
  projectIds: Array<string>;
}

export default class TelemetryMilestones {
  public static getMilestoneOfTable(
    tableName: string,
  ): ActivationMilestone | null {
    const kind: ActivationTelemetryKind | undefined =
      TELEMETRY_KIND_OF_TABLE[tableName];

    return kind ? ACTIVATION_MILESTONE_OF_TELEMETRY_KIND[kind] : null;
  }

  /*
   * The projects in these rows that may not have this table's milestone
   * yet, or null when there are none - a table that is no telemetry kind,
   * or projects this process knows have it. Never throws.
   */
  public static collect(
    tableName: string,
    rows: Array<JSONObject>,
  ): PendingTelemetryMilestones | null {
    try {
      const milestone: ActivationMilestone | null =
        this.getMilestoneOfTable(tableName);

      if (!milestone || !rows || rows.length === 0) {
        return null;
      }

      let lastProjectId: string | null = null;
      let projectIds: Array<string> | null = null;

      for (const row of rows) {
        const projectId: JSONValue | undefined = row?.["projectId"];

        if (typeof projectId !== "string" || projectId === lastProjectId) {
          continue;
        }

        lastProjectId = projectId;

        if (ProjectMilestoneService.isKnownReached(projectId, milestone)) {
          continue;
        }

        if (!projectIds) {
          projectIds = [projectId];
        } else if (!projectIds.includes(projectId)) {
          projectIds.push(projectId);
        }
      }

      return projectIds ? { milestone, projectIds } : null;
    } catch {
      return null;
    }
  }

  /*
   * The projects in these spans whose first AI call they may be
   * (FirstLlmCallsReceived, #7325): a span the ingest marked as a GenAI call
   * (isLlmSpan), of a project this process does not know has the mark. Null
   * for any other table, and for spans that hold no AI call - one property
   * read a span, so the busiest path pays nothing for a project that sends
   * none. Never throws.
   */
  public static collectLlmCalls(
    tableName: string,
    rows: Array<JSONObject>,
  ): PendingTelemetryMilestones | null {
    try {
      if (tableName !== AnalyticsTableName.Span || !rows || rows.length === 0) {
        return null;
      }

      const milestone: ActivationMilestone =
        ActivationMilestone.FirstLlmCallsReceived;
      let projectIds: Array<string> | null = null;

      for (const row of rows) {
        if (row?.["isLlmSpan"] !== true) {
          continue;
        }

        const projectId: JSONValue | undefined = row["projectId"];

        if (
          typeof projectId !== "string" ||
          projectIds?.includes(projectId) ||
          ProjectMilestoneService.isKnownReached(projectId, milestone)
        ) {
          continue;
        }

        if (!projectIds) {
          projectIds = [projectId];
        } else {
          projectIds.push(projectId);
        }
      }

      return projectIds ? { milestone, projectIds } : null;
    } catch {
      return null;
    }
  }

  /*
   * Rows a writer inserted itself, outside the fan-in writer: called once
   * ClickHouse has accepted them, so a failed insert - which throws before
   * this is reached - keeps nothing. Never throws.
   */
  public static markInserted(tableName: string, rows: Array<JSONObject>): void {
    try {
      this.markReached(this.collect(tableName, rows));
    } catch {
      // A milestone is never worth failing the insert that went in.
    }
  }

  // Keeps the collected milestones: called once ClickHouse accepted the rows.
  public static markReached(pending: PendingTelemetryMilestones | null): void {
    if (!pending) {
      return;
    }

    for (const projectId of pending.projectIds) {
      ProjectMilestoneService.reachInBackground({
        projectId: projectId,
        milestone: pending.milestone,
      });
    }
  }
}
