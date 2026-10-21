import DataMigrationBase from "./DataMigrationBase";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
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
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";

/*
 * Metric data points are now read with Read Telemetry Service Metrics.
 * Until now metric reads went through Read Telemetry Service Traces: the
 * Metric table's read list, the /telemetry/metrics/* routes (attribute
 * names and values, a trace's metrics) and the AI metric tools all named
 * it, and the table's columns named Read Telemetry Service Log. Read
 * Metrics itself read only the metric catalogue (MetricType), whose reads
 * apply no scope and no labels. This keeps the metric reads of every team
 * and API key that held Read Traces where they were.
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
 *   - Labels are left off a row whose scope is All or Owned: those scopes
 *     ignore labels, and labels there could only collide with restriction
 *     labels on the grantee's Read Metrics block list.
 *
 * A grantee that holds Read Metrics without Read Traces now reads metric
 * data points with it: that is what the permission says, and the reason
 * for this change. Each one is named in the log.
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
 * A row the services would refuse - restriction labels while the
 * grantee's Read Metrics block list has some - is not attempted; it is
 * named in the log with what it means. Every change and every grantee to
 * look at is logged at the level a default install prints (LOG_LEVEL=ERROR),
 * as the project's own settings rather than faults; a write that fails
 * anyway is logged as a fault and the rest are still written.
 *
 * Idempotent: a second run finds the rows the first one wrote. Every grant
 * is read, page by page, before anything is written, so the rows written
 * cannot shift the pages. Writes go through the services so each member's
 * cached permissions are refreshed.
 */

export interface TelemetryGrant {
  // The permission row, when the grant is one already stored.
  rowId?: string | undefined;
  granteeId: string;
  projectId: string;
  permission: Permission;
  isBlockPermission: boolean;
  // Absent on an API key's grants, which have no scope: labels decide.
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

export interface MetricReadChange {
  // The grantee's Read Metrics (allow) row, as stored, when it holds one.
  existing?: TelemetryGrant | undefined;
  // What the grantee's Read Metrics is to be: its trace grant's reach.
  to: TelemetryGrant;
}

export interface MetricPermissionPlan {
  // Read Metrics grants to add.
  copies: Array<TelemetryGrant>;
  // Read Metrics grants already held, to set to the trace grant's reach.
  updates: Array<MetricReadChange>;
  /*
   * Copies and updates not attempted: they carry restriction labels and the
   * grantee's Read Metrics block list already has some, which the services
   * refuse.
   */
  conflicts: Array<MetricReadChange>;
  // Read Metrics grants held without Read Traces: they now read metric data.
  newMetricReaders: Array<TelemetryGrant>;
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
  const labelledMetricBlocks: Set<string> = new Set<string>();

  for (const grant of grants) {
    if (!grant.isBlockPermission) {
      allows.set(heldKey(grant.granteeId, grant.permission), grant);
    } else if (
      grant.permission === Permission.ReadTelemetryServiceMetrics &&
      grant.labelIds.length > 0
    ) {
      labelledMetricBlocks.add(grant.granteeId);
    }
  }

  const plan: MetricPermissionPlan = {
    copies: [],
    updates: [],
    conflicts: [],
    newMetricReaders: [],
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
        labelIds: scopeIgnoresLabels(grant.scope) ? [] : [...grant.labelIds],
      };

      const key: string = heldKey(
        grant.granteeId,
        Permission.ReadTelemetryServiceMetrics,
      );
      const existing: TelemetryGrant | undefined = allows.get(key);

      if (existing && getMetricReach(existing) === getMetricReach(to)) {
        continue;
      }

      if (existing && !existing.rowId) {
        // Planned above for another Read Traces row of this grantee.
        continue;
      }

      const change: MetricReadChange = { existing: existing, to: to };

      if (to.labelIds.length > 0 && labelledMetricBlocks.has(grant.granteeId)) {
        plan.conflicts.push(change);
      } else if (existing) {
        plan.updates.push(change);
      } else {
        plan.copies.push(to);
      }

      if (!existing) {
        allows.set(key, to);
      }

      continue;
    }

    if (
      grant.permission === Permission.ReadTelemetryServiceMetrics &&
      !allows.has(
        heldKey(grant.granteeId, Permission.ReadTelemetryServiceTraces),
      )
    ) {
      plan.newMetricReaders.push(grant);
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

// All and Owned reach what they reach whatever labels the row carries.
function scopeIgnoresLabels(scope: PermissionScope | undefined): boolean {
  return scope === PermissionScope.All || scope === PermissionScope.Owned;
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

function labelsOf(labelIds: Array<string>): Array<Label> {
  return labelIds.map((labelId: string): Label => {
    const label: Label = new Label();
    label.id = new ObjectID(labelId);
    return label;
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

function describeReach(grant: TelemetryGrant): string {
  const reach: string = getMetricReach(grant);

  if (reach === "all") {
    return "every service";
  }

  if (reach === "owned") {
    return "the services it owns";
  }

  return `the services labelled ${grant.labelIds.join(", ")}`;
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

// A write that failed for a reason the plan did not foresee: a fault.
function logFailure(message: string, err: unknown): void {
  logger.error(`AddTelemetryServiceMetricsPermissions: ${message}`);
  logger.error(err);
}

// What the migration needs from teams and from API keys, which differ only here.
interface GranteeKind {
  noun: string;
  readGrants: () => Promise<Array<TelemetryGrant>>;
  create: (grant: TelemetryGrant) => Promise<void>;
  // Resolves to the number of rows written.
  update: (rowId: string, to: TelemetryGrant) => Promise<number>;
}

const TEAMS: GranteeKind = {
  noun: "team",
  readGrants: async (): Promise<Array<TelemetryGrant>> => {
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

    return grants;
  },
  create: async (grant: TelemetryGrant): Promise<void> => {
    const permission: TeamPermission = new TeamPermission();
    permission.teamId = new ObjectID(grant.granteeId);
    permission.projectId = new ObjectID(grant.projectId);
    permission.permission = grant.permission;
    permission.isBlockPermission = false;
    // A team row always carries a scope (the column defaults to All).
    permission.scope = grant.scope || PermissionScope.All;
    permission.labels = labelsOf(grant.labelIds);

    await TeamPermissionService.create({
      data: permission,
      props: { isRoot: true },
    });
  },
  update: (rowId: string, to: TelemetryGrant): Promise<number> => {
    return TeamPermissionService.updateOneById({
      id: new ObjectID(rowId),
      // Cast past the deep partial type: labels are whole Label models.
      data: {
        scope: to.scope || PermissionScope.All,
        labels: labelsOf(to.labelIds),
      } as unknown as QueryDeepPartialEntity<TeamPermission>,
      props: { isRoot: true },
    });
  },
};

const API_KEYS: GranteeKind = {
  noun: "API key",
  readGrants: async (): Promise<Array<TelemetryGrant>> => {
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

    return grants;
  },
  create: async (grant: TelemetryGrant): Promise<void> => {
    const permission: APIKeyPermission = new APIKeyPermission();
    permission.apiKeyId = new ObjectID(grant.granteeId);
    permission.projectId = new ObjectID(grant.projectId);
    permission.permission = grant.permission;
    permission.isBlockPermission = false;
    permission.labels = labelsOf(grant.labelIds);

    await ApiKeyPermissionService.create({
      data: permission,
      props: { isRoot: true },
    });
  },
  update: (rowId: string, to: TelemetryGrant): Promise<number> => {
    // An API key's grant has no scope: its labels alone decide.
    return ApiKeyPermissionService.updateOneById({
      id: new ObjectID(rowId),
      data: {
        labels: labelsOf(to.labelIds),
      } as unknown as QueryDeepPartialEntity<APIKeyPermission>,
      props: { isRoot: true },
    });
  },
};

export default class AddTelemetryServiceMetricsPermissions extends DataMigrationBase {
  public constructor() {
    super("AddTelemetryServiceMetricsPermissions");
  }

  public override async migrate(): Promise<void> {
    await this.migrateGrantees(TEAMS);
    await this.migrateGrantees(API_KEYS);
  }

  private async migrateGrantees(kind: GranteeKind): Promise<void> {
    const plan: MetricPermissionPlan = planMetricPermissionCopies(
      await kind.readGrants(),
    );
    const readMetrics: Permission = Permission.ReadTelemetryServiceMetrics;
    const readTraces: Permission = Permission.ReadTelemetryServiceTraces;
    let written: number = 0;

    for (const copy of plan.copies) {
      try {
        await kind.create(copy);
        written++;
      } catch (err) {
        logFailure(
          `could not add ${readMetrics} to ${kind.noun} ${copy.granteeId}; it reads no metrics until it is given it by hand.`,
          err,
        );
      }
    }

    for (const update of plan.updates) {
      const granteeId: string = update.to.granteeId;

      try {
        const updated: number = await kind.update(
          update.existing!.rowId!,
          update.to,
        );

        if (updated === 0) {
          // Removed between the read and the write: nothing to keep in line.
          continue;
        }

        written++;
        logSetting(
          `set ${kind.noun} ${granteeId}'s ${readMetrics} to reach ${describeReach(update.to)}, as its ${readTraces} grant did, which decided its metric reads before; it reached ${describeReach(update.existing!)}.`,
        );
      } catch (err) {
        logFailure(
          `could not set ${kind.noun} ${granteeId}'s ${readMetrics} to reach ${describeReach(update.to)}, as its ${readTraces} grant did; it reads the metrics of ${describeReach(update.existing!)} until that is set by hand.`,
          err,
        );
      }
    }

    for (const conflict of plan.conflicts) {
      logSetting(
        conflict.existing
          ? `${kind.noun} ${conflict.to.granteeId}'s ${readMetrics} was not set to reach ${describeReach(conflict.to)}, as its ${readTraces} grant did: its ${readMetrics} block list has restriction labels, so the grant cannot have any. It reads the metrics of ${describeReach(conflict.existing)} until its block list is changed and the grant set by hand.`
          : `${kind.noun} ${conflict.to.granteeId} was not given ${readMetrics} for ${describeReach(conflict.to)}, as its ${readTraces} grant read: its ${readMetrics} block list has restriction labels, so the grant cannot have any. It reads no metrics until its block list is changed and the grant given by hand.`,
      );
    }

    for (const reader of plan.newMetricReaders) {
      logSetting(
        `${kind.noun} ${reader.granteeId} holds ${readMetrics} without ${readTraces}: from now on it also reads metric data points, of ${describeReach(reader)}.`,
      );
    }

    for (const write of plan.writesNotCopied) {
      const counterpart: Permission | undefined = METRIC_WRITES_NOT_COPIED.find(
        (each: { from: Permission; to: Permission }): boolean => {
          return each.from === write.permission;
        },
      )?.to;

      logSetting(
        `${kind.noun} ${write.granteeId} holds ${write.permission}, which (with ${Permission.CreateTelemetryServiceLog} for a create) wrote metric data points through the API; it is not given ${counterpart}, which also writes the metric catalogue. Add it by hand if it still should.`,
      );
    }

    logger.info(
      `AddTelemetryServiceMetricsPermissions: wrote ${written} ${kind.noun} metric read permissions.`,
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
