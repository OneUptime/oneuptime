import DataMigrationBase from "./DataMigrationBase";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Permission from "Common/Types/Permission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import ObjectID from "Common/Types/ObjectID";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ApiKeyPermissionService from "Common/Server/Services/ApiKeyPermissionService";
import TeamPermissionService from "Common/Server/Services/TeamPermissionService";
import APIKeyPermission from "Common/Models/DatabaseModels/ApiKeyPermission";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import Label from "Common/Models/DatabaseModels/Label";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";

/*
 * Metric data points are now read with Read Telemetry Service Metrics.
 * Until now metric reads went through Read Telemetry Service Traces: the
 * Metric table's read list, the /telemetry/metrics/* routes (attribute
 * names and values, a trace's metrics) and the AI metric tools all named
 * it, and the table's columns named Read Telemetry Service Log. This gives
 * every team and API key that holds Read Traces the metric read it stood
 * for, so the metrics a grantee read before the upgrade it still reads
 * after it.
 *
 * COPY, NEVER RENAME: Read Telemetry Service Traces still reads traces.
 *
 *   Read Traces (allow) -> Read Metrics (allow), with the same scope and
 *   labels: that row decided which services' metrics the grantee read. It
 *   is copied on its own, because a member reads with every team's grants
 *   together, so the Read Log the columns asked for can sit on another of
 *   their teams. Read Metrics also reads the metric catalogue (metric
 *   names, descriptions and units), which goes with reading the metrics.
 *
 * Nothing else is copied, on purpose:
 *
 *   - Blocks. A block on Read Traces never refused a metric read through
 *     the dashboard or the API (analytics reads do not apply block rows).
 *     Copied onto Read Metrics it would refuse the metric catalogue, a
 *     Postgres table that does apply them, to every member of the team.
 *   - Writes. Create and Delete Metrics also create and delete entries of
 *     the metric catalogue, which the trace and log permissions never did,
 *     and a write is not widened. Whoever created or deleted metric data
 *     points through the API is given those permissions by hand.
 *   - Edit Traces: no metric column can be changed by anyone but the
 *     server.
 *
 * Idempotent: a grantee that already holds Read Metrics (allow) keeps that
 * row as it is (the services refuse a second row of one permission). When
 * that row reaches other services' metrics than the trace grant would
 * have, it is the project's own setting and is not changed, but the log
 * says so, at the level a default install prints. Every grant is read,
 * page by page, before anything is written, so the rows written cannot
 * shift the pages. Writes go through the services so each member's cached
 * permissions are refreshed (TeamPermissionService.onCreateSuccess); a row
 * that cannot be added is logged and the rest are still added.
 */

export interface TelemetryGrant {
  granteeId: string;
  projectId: string;
  permission: Permission;
  isBlockPermission: boolean;
  scope?: PermissionScope | undefined;
  labelIds: Array<string>;
}

// The grants the plan reads: the copied permission and its target.
export const METRIC_PERMISSION_COPY_INPUTS: Array<Permission> = [
  Permission.ReadTelemetryServiceTraces,
  Permission.ReadTelemetryServiceMetrics,
];

export interface MetricPermissionPlan {
  // The Read Metrics grants to add.
  copies: Array<TelemetryGrant>;
  /*
   * The copies left out because the grantee already holds Read Metrics
   * reaching other services' metrics (another scope, other labels). Logged,
   * not changed.
   */
  differing: Array<TelemetryGrant>;
}

/*
 * The grants to add, given every Read Traces and Read Metrics grant that
 * the teams (or the API keys) hold. Pure, so the rule is tested without a
 * database.
 */
export function planMetricPermissionCopies(
  grants: Array<TelemetryGrant>,
): MetricPermissionPlan {
  const heldMetricReads: Map<string, TelemetryGrant> = new Map<
    string,
    TelemetryGrant
  >();

  for (const grant of grants) {
    if (
      grant.permission === Permission.ReadTelemetryServiceMetrics &&
      !grant.isBlockPermission
    ) {
      heldMetricReads.set(grant.granteeId, grant);
    }
  }

  const plan: MetricPermissionPlan = { copies: [], differing: [] };

  for (const grant of grants) {
    if (
      grant.permission !== Permission.ReadTelemetryServiceTraces ||
      grant.isBlockPermission
    ) {
      continue;
    }

    const copy: TelemetryGrant = {
      granteeId: grant.granteeId,
      projectId: grant.projectId,
      permission: Permission.ReadTelemetryServiceMetrics,
      isBlockPermission: false,
      scope: grant.scope,
      labelIds: [...grant.labelIds],
    };

    const existing: TelemetryGrant | undefined = heldMetricReads.get(
      grant.granteeId,
    );

    if (existing) {
      if (getMetricReach(existing) !== getMetricReach(copy)) {
        plan.differing.push(copy);
      }

      continue;
    }

    heldMetricReads.set(grant.granteeId, copy);
    plan.copies.push(copy);
  }

  return plan;
}

/*
 * Which services' metrics a grant reaches, as the analytics read applies it
 * (ModelPermission.resolveOwnedScope): All reaches every service whatever
 * its labels, Owned the grantee's own services, and Labels - or no scope,
 * as on an API key - the labelled services, or every service when it has
 * no labels.
 */
export function getMetricReach(grant: TelemetryGrant): string {
  if (grant.scope === PermissionScope.All) {
    return "all";
  }

  if (grant.scope === PermissionScope.Owned) {
    return "owned";
  }

  if (grant.labelIds.length === 0) {
    return "all";
  }

  return `labels:${[...grant.labelIds].sort().join(",")}`;
}

function labelIdsOf(labels: Array<Label> | undefined): Array<string> {
  return (labels || [])
    .map((label: Label): string => {
      return label.id?.toString() || "";
    })
    .filter((id: string): boolean => {
      return Boolean(id);
    });
}

// Every row, a page at a time: an installation can hold more than a page.
async function readAllPages<T>(
  readPage: (skip: number) => Promise<Array<T>>,
): Promise<Array<T>> {
  const rows: Array<T> = [];
  let skip: number = 0;

  for (;;) {
    const page: Array<T> = await readPage(skip);
    rows.push(...page);

    if (page.length < LIMIT_MAX) {
      return rows;
    }

    skip += page.length;
  }
}

function labelsOf(labelIds: Array<string>): Array<Label> {
  return labelIds.map((labelId: string): Label => {
    const label: Label = new Label();
    label.id = new ObjectID(labelId);
    return label;
  });
}

/*
 * The project's own setting, not a fault: printed at the level a default
 * install keeps (LOG_LEVEL=ERROR), never raised as an issue.
 */
function logDiffering(
  granteeKind: string,
  differing: Array<TelemetryGrant>,
): void {
  for (const grant of differing) {
    logger.error(
      `AddTelemetryServiceMetricsPermissions: ${granteeKind} ${grant.granteeId} already holds ${Permission.ReadTelemetryServiceMetrics}, reaching other services' metrics than its ${Permission.ReadTelemetryServiceTraces} grant; left as it is.`,
      EXTERNAL_FAULT,
    );
  }
}

export default class AddTelemetryServiceMetricsPermissions extends DataMigrationBase {
  public constructor() {
    super("AddTelemetryServiceMetricsPermissions");
  }

  public override async migrate(): Promise<void> {
    const teamCopies: number = await this.copyTeamPermissions();
    const keyCopies: number = await this.copyApiKeyPermissions();

    logger.info(
      `AddTelemetryServiceMetricsPermissions: added ${teamCopies} team and ${keyCopies} API key metric read permissions.`,
    );
  }

  private async copyTeamPermissions(): Promise<number> {
    const rows: Array<TeamPermission> = await readAllPages(
      (skip: number): Promise<Array<TeamPermission>> => {
        return TeamPermissionService.findBy({
          query: {
            permission: QueryHelper.any(METRIC_PERMISSION_COPY_INPUTS),
          },
          select: {
            _id: true,
            teamId: true,
            projectId: true,
            permission: true,
            isBlockPermission: true,
            scope: true,
            labels: {
              _id: true,
            },
          },
          sort: { _id: SortOrder.Ascending },
          skip: skip,
          limit: LIMIT_MAX,
          props: {
            isRoot: true,
          },
        });
      },
    );

    const grants: Array<TelemetryGrant> = [];

    for (const row of rows) {
      if (!row.teamId || !row.projectId || !row.permission) {
        continue;
      }

      grants.push({
        granteeId: row.teamId.toString(),
        projectId: row.projectId.toString(),
        permission: row.permission,
        isBlockPermission: Boolean(row.isBlockPermission),
        scope: row.scope,
        labelIds: labelIdsOf(row.labels),
      });
    }

    const plan: MetricPermissionPlan = planMetricPermissionCopies(grants);
    logDiffering("team", plan.differing);

    let created: number = 0;

    for (const copy of plan.copies) {
      const permission: TeamPermission = new TeamPermission();
      permission.teamId = new ObjectID(copy.granteeId);
      permission.projectId = new ObjectID(copy.projectId);
      permission.permission = copy.permission;
      permission.isBlockPermission = false;
      // A team row always carries a scope (the column defaults to All).
      permission.scope = copy.scope || PermissionScope.All;
      permission.labels = labelsOf(copy.labelIds);

      try {
        await TeamPermissionService.create({
          data: permission,
          props: { isRoot: true },
        });
        created++;
      } catch (err) {
        /*
         * A locked team (its permissions are not editable) refuses new
         * rows; those teams hold roles, not these granular grants. Log and
         * go on rather than halt every migration queued after this one.
         */
        logger.error(
          `AddTelemetryServiceMetricsPermissions: could not add ${copy.permission} to team ${copy.granteeId}; add it by hand.`,
        );
        logger.error(err);
      }
    }

    return created;
  }

  private async copyApiKeyPermissions(): Promise<number> {
    const rows: Array<APIKeyPermission> = await readAllPages(
      (skip: number): Promise<Array<APIKeyPermission>> => {
        return ApiKeyPermissionService.findBy({
          query: {
            permission: QueryHelper.any(METRIC_PERMISSION_COPY_INPUTS),
          },
          select: {
            _id: true,
            apiKeyId: true,
            projectId: true,
            permission: true,
            isBlockPermission: true,
            labels: {
              _id: true,
            },
          },
          sort: { _id: SortOrder.Ascending },
          skip: skip,
          limit: LIMIT_MAX,
          props: {
            isRoot: true,
          },
        });
      },
    );

    const grants: Array<TelemetryGrant> = [];

    for (const row of rows) {
      if (!row.apiKeyId || !row.projectId || !row.permission) {
        continue;
      }

      grants.push({
        granteeId: row.apiKeyId.toString(),
        projectId: row.projectId.toString(),
        permission: row.permission,
        isBlockPermission: Boolean(row.isBlockPermission),
        labelIds: labelIdsOf(row.labels),
      });
    }

    const plan: MetricPermissionPlan = planMetricPermissionCopies(grants);
    logDiffering("API key", plan.differing);

    let created: number = 0;

    for (const copy of plan.copies) {
      const permission: APIKeyPermission = new APIKeyPermission();
      permission.apiKeyId = new ObjectID(copy.granteeId);
      permission.projectId = new ObjectID(copy.projectId);
      permission.permission = copy.permission;
      permission.isBlockPermission = false;
      permission.labels = labelsOf(copy.labelIds);

      try {
        await ApiKeyPermissionService.create({
          data: permission,
          props: { isRoot: true },
        });
        created++;
      } catch (err) {
        logger.error(
          `AddTelemetryServiceMetricsPermissions: could not add ${copy.permission} to API key ${copy.granteeId}; add it by hand.`,
        );
        logger.error(err);
      }
    }

    return created;
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
