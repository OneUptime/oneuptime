import DataMigrationBase from "./DataMigrationBase";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import Permission from "Common/Types/Permission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import QueryDeepPartialEntity from "Common/Types/Database/PartialEntity";
import ObjectID from "Common/Types/ObjectID";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ApiKeyPermissionService from "Common/Server/Services/ApiKeyPermissionService";
import TeamPermissionService from "Common/Server/Services/TeamPermissionService";
import APIKeyPermission from "Common/Models/DatabaseModels/ApiKeyPermission";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import Label from "Common/Models/DatabaseModels/Label";
import logger, {
  EXTERNAL_FAULT,
  LogAttributes,
} from "Common/Server/Utils/Logger";

/*
 * Metric data points are now read with Read Telemetry Service Metrics.
 * Until now metric reads went through Read Telemetry Service Traces: the
 * Metric table's read list, the /telemetry/metrics/* routes (attribute
 * names and values, a trace's metrics) and the AI metric tools all named
 * it, and the table's columns named Read Telemetry Service Log. Read
 * Metrics itself read only the metric catalogue (MetricType), whose reads
 * apply no scope and no labels. This keeps every team's and API key's
 * metric reads where they were.
 *
 * COPY, NEVER RENAME: Read Telemetry Service Traces still reads traces.
 *
 *   - Read Traces (allow) -> Read Metrics (allow), with the same scope and
 *     labels: that row decided which services' metrics the grantee read.
 *     It is copied on its own, because a member reads with every team's
 *     grants together, so the Read Log the columns asked for can sit on
 *     another of their teams. Read Metrics also reads the metric catalogue,
 *     project-wide whatever its scope and labels, as it always has.
 *   - A grantee that already holds Read Metrics (allow) keeps its row (the
 *     services refuse a second row of one permission), set to the scope and
 *     labels of its Read Traces grant when they reach other services: on
 *     the catalogue that row's scope and labels never narrowed anything, and
 *     on metrics the trace grant's did, so nothing either surface reads
 *     changes.
 *
 * Nothing else is copied, on purpose:
 *
 *   - Blocks. A block on Read Traces refused only the AI metric tools,
 *     which refuse a tool when any permission it asks for is blocked; it
 *     never refused a metric read through the dashboard or the API, as
 *     analytics reads do not apply block rows. Copied onto Read Metrics it
 *     would also refuse the metric catalogue, a Postgres table that does
 *     apply them, to every member of the team.
 *   - Writes. Create and Delete Metrics also create and delete entries of
 *     the metric catalogue, which the trace and log permissions never did,
 *     and a write is not widened. Every grantee holding Create or Delete
 *     Traces without its metric counterpart is named in the log, to be given
 *     it by hand if it still creates or deletes metric data points.
 *   - Edit Traces: no metric column can be changed by anyone but the
 *     server.
 *
 * Every change and every grantee to look at is logged at the level a
 * default install prints (LOG_LEVEL=ERROR), as the project's own settings
 * rather than faults. Idempotent: a second run finds the rows the first
 * one wrote. Every grant is read, page by page, before anything is
 * written, so the rows written cannot shift the pages. Writes go through
 * the services so each member's cached permissions are refreshed; a row
 * that cannot be written is logged and the rest are still written.
 */

export interface TelemetryGrant {
  // The permission row, when the grant is one already stored.
  rowId?: string | undefined;
  granteeId: string;
  projectId: string;
  permission: Permission;
  isBlockPermission: boolean;
  scope?: PermissionScope | undefined;
  labelIds: Array<string>;
}

// Write grants whose metric counterpart is not copied, only named in the log.
export const METRIC_WRITES_NOT_COPIED: Array<{
  from: Permission;
  to: Permission;
}> = [
  {
    from: Permission.CreateTelemetryServiceTraces,
    to: Permission.CreateTelemetryServiceMetrics,
  },
  {
    from: Permission.DeleteTelemetryServiceTraces,
    to: Permission.DeleteTelemetryServiceMetrics,
  },
];

// Every grant the plan reads.
export const METRIC_PERMISSION_COPY_INPUTS: Array<Permission> = [
  Permission.ReadTelemetryServiceTraces,
  Permission.ReadTelemetryServiceMetrics,
  ...METRIC_WRITES_NOT_COPIED.flatMap(
    (write: { from: Permission; to: Permission }): Array<Permission> => {
      return [write.from, write.to];
    },
  ),
];

export interface MetricReadUpdate {
  // The grantee's Read Metrics (allow) row, as stored.
  existing: TelemetryGrant;
  // The scope and labels of its Read Traces grant, which it is set to.
  to: TelemetryGrant;
}

export interface MetricPermissionPlan {
  // Read Metrics grants to add.
  copies: Array<TelemetryGrant>;
  // Read Metrics grants already held, to set to the trace grant's reach.
  updates: Array<MetricReadUpdate>;
  // Create / Delete Traces grants whose metric counterpart is not held.
  writesNotCopied: Array<TelemetryGrant>;
}

/*
 * What to write, given every grant of the inputs above that the teams (or
 * the API keys) hold. Pure, so the rules are tested without a database.
 */
export function planMetricPermissionCopies(
  grants: Array<TelemetryGrant>,
): MetricPermissionPlan {
  const allows: Map<string, TelemetryGrant> = new Map<string, TelemetryGrant>();

  for (const grant of grants) {
    if (!grant.isBlockPermission) {
      allows.set(heldKey(grant.granteeId, grant.permission), grant);
    }
  }

  const plan: MetricPermissionPlan = {
    copies: [],
    updates: [],
    writesNotCopied: [],
  };

  for (const grant of grants) {
    if (grant.isBlockPermission) {
      continue;
    }

    if (grant.permission === Permission.ReadTelemetryServiceTraces) {
      const to: TelemetryGrant = {
        granteeId: grant.granteeId,
        projectId: grant.projectId,
        permission: Permission.ReadTelemetryServiceMetrics,
        isBlockPermission: false,
        scope: grant.scope,
        labelIds: [...grant.labelIds],
      };

      const key: string = heldKey(
        grant.granteeId,
        Permission.ReadTelemetryServiceMetrics,
      );
      const existing: TelemetryGrant | undefined = allows.get(key);

      if (!existing) {
        allows.set(key, to);
        plan.copies.push(to);
        continue;
      }

      if (existing.rowId && getMetricReach(existing) !== getMetricReach(to)) {
        plan.updates.push({ existing: existing, to: to });
      }

      continue;
    }

    for (const write of METRIC_WRITES_NOT_COPIED) {
      if (
        grant.permission === write.from &&
        !allows.has(heldKey(grant.granteeId, write.to))
      ) {
        plan.writesNotCopied.push(grant);
      }
    }
  }

  return plan;
}

function heldKey(granteeId: string, permission: Permission): string {
  return `${granteeId}:${permission}`;
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
 * A line about the project's own settings: printed at the level a default
 * install keeps, never raised as an issue.
 */
function logSetting(message: string): void {
  logger.error(
    `AddTelemetryServiceMetricsPermissions: ${message}`,
    EXTERNAL_FAULT,
  );
}

/*
 * A write the services refused. A refusal of the project's own settings (a
 * locked team, restriction labels already on the block list) is reported
 * like one; anything else stays a fault.
 */
function logRefused(message: string, err: unknown): void {
  const attributes: LogAttributes | undefined =
    err instanceof BadDataException || err instanceof NotAuthorizedException
      ? EXTERNAL_FAULT
      : undefined;

  logger.error(
    `AddTelemetryServiceMetricsPermissions: ${message} (${err instanceof Error ? err.message : String(err)}); set it by hand.`,
    attributes,
  );
}

function logWritesNotCopied(
  granteeKind: string,
  writes: Array<TelemetryGrant>,
): void {
  for (const write of writes) {
    const counterpart: Permission | undefined = METRIC_WRITES_NOT_COPIED.find(
      (each: { from: Permission; to: Permission }): boolean => {
        return each.from === write.permission;
      },
    )?.to;

    logSetting(
      `${granteeKind} ${write.granteeId} holds ${write.permission}, which (with ${Permission.CreateTelemetryServiceLog} for a create) wrote metric data points through the API; it is not given ${counterpart}, which also writes the metric catalogue. Add it by hand if it still should.`,
    );
  }
}

export default class AddTelemetryServiceMetricsPermissions extends DataMigrationBase {
  public constructor() {
    super("AddTelemetryServiceMetricsPermissions");
  }

  public override async migrate(): Promise<void> {
    await this.migrateTeamPermissions();
    await this.migrateApiKeyPermissions();
  }

  private async migrateTeamPermissions(): Promise<void> {
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
        rowId: row.id?.toString(),
        granteeId: row.teamId.toString(),
        projectId: row.projectId.toString(),
        permission: row.permission,
        isBlockPermission: Boolean(row.isBlockPermission),
        scope: row.scope,
        labelIds: labelIdsOf(row.labels),
      });
    }

    const plan: MetricPermissionPlan = planMetricPermissionCopies(grants);
    let written: number = 0;

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
        written++;
      } catch (err) {
        logRefused(
          `could not add ${copy.permission} to team ${copy.granteeId}`,
          err,
        );
      }
    }

    for (const update of plan.updates) {
      try {
        await TeamPermissionService.updateOneById({
          id: new ObjectID(update.existing.rowId!),
          // Cast past the deep partial type: labels are whole Label models.
          data: {
            scope: update.to.scope || PermissionScope.All,
            labels: labelsOf(update.to.labelIds),
          } as unknown as QueryDeepPartialEntity<TeamPermission>,
          props: { isRoot: true },
        });
        written++;
        logSetting(
          `set the scope and labels of team ${update.existing.granteeId}'s ${update.existing.permission} to its ${Permission.ReadTelemetryServiceTraces} grant's, which decided its metric reads before.`,
        );
      } catch (err) {
        logRefused(
          `could not set team ${update.existing.granteeId}'s ${update.existing.permission} to its ${Permission.ReadTelemetryServiceTraces} grant's scope and labels`,
          err,
        );
      }
    }

    logWritesNotCopied("team", plan.writesNotCopied);

    logger.info(
      `AddTelemetryServiceMetricsPermissions: wrote ${written} team metric read permissions.`,
    );
  }

  private async migrateApiKeyPermissions(): Promise<void> {
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
        rowId: row.id?.toString(),
        granteeId: row.apiKeyId.toString(),
        projectId: row.projectId.toString(),
        permission: row.permission,
        isBlockPermission: Boolean(row.isBlockPermission),
        labelIds: labelIdsOf(row.labels),
      });
    }

    const plan: MetricPermissionPlan = planMetricPermissionCopies(grants);
    let written: number = 0;

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
        written++;
      } catch (err) {
        logRefused(
          `could not add ${copy.permission} to API key ${copy.granteeId}`,
          err,
        );
      }
    }

    for (const update of plan.updates) {
      try {
        // An API key's grant has no scope: its labels alone decide.
        await ApiKeyPermissionService.updateOneById({
          id: new ObjectID(update.existing.rowId!),
          data: {
            labels: labelsOf(update.to.labelIds),
          } as unknown as QueryDeepPartialEntity<APIKeyPermission>,
          props: { isRoot: true },
        });
        written++;
        logSetting(
          `set the labels of API key ${update.existing.granteeId}'s ${update.existing.permission} to its ${Permission.ReadTelemetryServiceTraces} grant's, which decided its metric reads before.`,
        );
      } catch (err) {
        logRefused(
          `could not set API key ${update.existing.granteeId}'s ${update.existing.permission} to its ${Permission.ReadTelemetryServiceTraces} grant's labels`,
          err,
        );
      }
    }

    logWritesNotCopied("API key", plan.writesNotCopied);

    logger.info(
      `AddTelemetryServiceMetricsPermissions: wrote ${written} API key metric read permissions.`,
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
