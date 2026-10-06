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
import logger from "Common/Server/Utils/Logger";

/*
 * Metric data points are now read, created and deleted with the Telemetry
 * Service Metrics permissions. Before, the Metric table was read with Read
 * Telemetry Service Traces and its columns with Read Telemetry Service Log,
 * so a team or an API key read metrics only by holding both; it was created
 * with Create Traces on the table and Create Log on the columns, and
 * deleted with Delete Traces. This gives every grantee the metric
 * permission that does what its existing grants did for metrics, so nobody
 * who read a metric chart yesterday is refused it after the upgrade.
 *
 * COPY, NEVER RENAME: the trace and log permissions still read traces and
 * logs. And nothing beyond what the grants did: a grantee holding only Read
 * Traces read no metric data (every column asked for Read Log), so it gets
 * no metric permission.
 *
 *   - Read Traces (allow) + any Read Log (allow) -> Read Metrics, with the
 *     Read Traces row's scope and labels: that row decided which services'
 *     metrics the grantee read.
 *   - Create Traces (allow) + any Create Log (allow) -> Create Metrics.
 *   - Delete Traces (allow) -> Delete Metrics.
 *   - Read Traces (block) -> Read Metrics (block), with its labels: the AI
 *     metric tools refused a grantee whose Read Traces was blocked, and a
 *     deliberate denial must not turn into access.
 *
 * Edit Traces is not copied: no metric column can be changed by anyone but
 * the server, so it never let a grantee edit a metric.
 *
 * Idempotent: a grantee that already holds the metric permission in that
 * list is skipped (the services refuse a second row of one permission
 * anyway). Every grant is read, page by page, before anything is written,
 * so the rows written cannot shift the pages. Writes go through the
 * services so each member's cached permissions are refreshed
 * (TeamPermissionService.onCreateSuccess).
 */

export interface TelemetryGrant {
  granteeId: string;
  projectId: string;
  permission: Permission;
  isBlockPermission: boolean;
  scope?: PermissionScope | undefined;
  labelIds: Array<string>;
}

interface CopyRule {
  // The grant whose copy is made.
  from: Permission;
  isBlockPermission: boolean;
  to: Permission;
  // Another allow grant the grantee must hold for the copy to be made.
  requires?: Permission | undefined;
}

export const METRIC_PERMISSION_COPY_RULES: Array<CopyRule> = [
  {
    from: Permission.ReadTelemetryServiceTraces,
    isBlockPermission: false,
    to: Permission.ReadTelemetryServiceMetrics,
    requires: Permission.ReadTelemetryServiceLog,
  },
  {
    from: Permission.CreateTelemetryServiceTraces,
    isBlockPermission: false,
    to: Permission.CreateTelemetryServiceMetrics,
    requires: Permission.CreateTelemetryServiceLog,
  },
  {
    from: Permission.DeleteTelemetryServiceTraces,
    isBlockPermission: false,
    to: Permission.DeleteTelemetryServiceMetrics,
  },
  {
    from: Permission.ReadTelemetryServiceTraces,
    isBlockPermission: true,
    to: Permission.ReadTelemetryServiceMetrics,
  },
];

// Every permission the plan reads: the sources, the companions and the targets.
export const METRIC_PERMISSION_COPY_INPUTS: Array<Permission> = Array.from(
  new Set<Permission>(
    METRIC_PERMISSION_COPY_RULES.flatMap(
      (rule: CopyRule): Array<Permission> => {
        return [rule.from, rule.to, ...(rule.requires ? [rule.requires] : [])];
      },
    ),
  ),
);

/*
 * The grants to create, given every grant of the inputs above that the
 * project's teams (or API keys) hold. Pure, so the rules are tested
 * without a database.
 */
export function planMetricPermissionCopies(
  grants: Array<TelemetryGrant>,
): Array<TelemetryGrant> {
  const held: Set<string> = new Set<string>(
    grants.map((grant: TelemetryGrant): string => {
      return heldKey(
        grant.granteeId,
        grant.permission,
        grant.isBlockPermission,
      );
    }),
  );

  const copies: Array<TelemetryGrant> = [];

  for (const rule of METRIC_PERMISSION_COPY_RULES) {
    for (const grant of grants) {
      if (
        grant.permission !== rule.from ||
        grant.isBlockPermission !== rule.isBlockPermission
      ) {
        continue;
      }

      if (
        rule.requires &&
        !held.has(heldKey(grant.granteeId, rule.requires, false))
      ) {
        continue;
      }

      const key: string = heldKey(
        grant.granteeId,
        rule.to,
        rule.isBlockPermission,
      );

      if (held.has(key)) {
        continue;
      }

      held.add(key);

      copies.push({
        granteeId: grant.granteeId,
        projectId: grant.projectId,
        permission: rule.to,
        isBlockPermission: rule.isBlockPermission,
        scope: grant.scope,
        labelIds: [...grant.labelIds],
      });
    }
  }

  return copies;
}

function heldKey(
  granteeId: string,
  permission: Permission,
  isBlockPermission: boolean,
): string {
  return `${granteeId}:${permission}:${isBlockPermission ? "block" : "allow"}`;
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

export default class AddTelemetryServiceMetricsPermissions extends DataMigrationBase {
  public constructor() {
    super("AddTelemetryServiceMetricsPermissions");
  }

  public override async migrate(): Promise<void> {
    const teamCopies: number = await this.copyTeamPermissions();
    const keyCopies: number = await this.copyApiKeyPermissions();

    logger.info(
      `AddTelemetryServiceMetricsPermissions: added ${teamCopies} team and ${keyCopies} API key metric permissions.`,
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

    let created: number = 0;

    for (const copy of planMetricPermissionCopies(grants)) {
      const permission: TeamPermission = new TeamPermission();
      permission.teamId = new ObjectID(copy.granteeId);
      permission.projectId = new ObjectID(copy.projectId);
      permission.permission = copy.permission;
      permission.isBlockPermission = copy.isBlockPermission;
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
          `AddTelemetryServiceMetricsPermissions: could not add ${copy.permission} to team ${copy.granteeId}`,
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

    let created: number = 0;

    for (const copy of planMetricPermissionCopies(grants)) {
      const permission: APIKeyPermission = new APIKeyPermission();
      permission.apiKeyId = new ObjectID(copy.granteeId);
      permission.projectId = new ObjectID(copy.projectId);
      permission.permission = copy.permission;
      permission.isBlockPermission = copy.isBlockPermission;
      permission.labels = labelsOf(copy.labelIds);

      try {
        await ApiKeyPermissionService.create({
          data: permission,
          props: { isRoot: true },
        });
        created++;
      } catch (err) {
        logger.error(
          `AddTelemetryServiceMetricsPermissions: could not add ${copy.permission} to API key ${copy.granteeId}`,
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
