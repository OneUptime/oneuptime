import AlertService from "./AlertService";
import AlertSeverityService from "./AlertSeverityService";
import AlertStateTimelineService from "./AlertStateTimelineService";
import DatabaseService from "./DatabaseService";
import MonitorService from "./MonitorService";
import MonitorStatusService from "./MonitorStatusService";
import NetworkDeviceService from "./NetworkDeviceService";
import NetworkSiteStatusTimelineService from "./NetworkSiteStatusTimelineService";
import Model from "../../Models/DatabaseModels/NetworkSite";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import AlertStateTimeline from "../../Models/DatabaseModels/AlertStateTimeline";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import NetworkSiteStatusTimeline from "../../Models/DatabaseModels/NetworkSiteStatusTimeline";
import { DisableAutomaticAlertCreation } from "../EnvironmentConfig";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import NetworkDeviceHydrationUtil from "../Utils/Monitor/NetworkDeviceHydrationUtil";
import logger, { LogAttributes } from "../Utils/Logger";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { FindWhereProperty } from "../../Types/BaseDatabase/Query";
import BadDataException from "../../Types/Exception/BadDataException";
import MonitorType from "../../Types/Monitor/MonitorType";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import Text from "../../Types/Text";
import { Raw } from "typeorm";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import MaterializedPathUtil from "../../Utils/NetworkSite/MaterializedPathUtil";
import SiteStatusRollupUtil, {
  DeviceHealthState,
  RollupStatusOption,
} from "../../Utils/NetworkSite/SiteStatusRollupUtil";
import { parseSiteHealthRollupPolicy } from "../../Types/NetworkSite/SiteHealthRollupPolicy";
import NetworkSiteMaintenanceSuppression from "../Utils/NetworkSite/NetworkSiteMaintenanceSuppression";
import { AggregateRow } from "../Types/Database/AggregateBy";
import AggregateResultUtil from "../Types/Database/AggregateResultUtil";
import {
  DeviceHealthGroup,
  deviceRollupStateForGroup,
} from "../Utils/NetworkDevice/DeviceHealthAggregation";

/**
 * How many sites are stamped with each MonitorStatus. `monitorStatusId` is
 * null for the bucket of sites that have no rollup yet.
 */
export interface SiteStatusCount {
  monitorStatusId: string | null;
  siteCount: number;
}

/*
 * Both spellings of "this site's parent" in a write payload: the dashboard's
 * site form posts the `parentSite` relation while server-side callers write
 * the `parentSiteId` column. Watching only the column let a re-parent done
 * from the UI skip cycle detection, the same-project guard and the subtree
 * path rebase entirely. See RelationIdUtil.
 */
const PARENT_SITE_KEYS: Array<string> = ["parentSiteId", "parentSite"];

/*
 * Carried from onBeforeUpdate to onUpdateSuccess when an update touches
 * parentSiteId, so the subtree rebase knows each site's previous state.
 */
interface ParentChangeCarryForward {
  previousItems: Array<Model>;
  newParentId: ObjectID | null;
  newParentPath: string | null;
}

/*
 * Carried from onBeforeDelete to onDeleteSuccess: the rows are gone by the
 * time the success hook runs, so their pre-delete hierarchy state has to be
 * captured up front to repair the orphaned subtree.
 */
interface DeleteCarryForward {
  sitesToDelete: Array<Model>;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * How many sites sit under each rolled-up MonitorStatus, counted in the
   * database.
   *
   * One row per status the project actually uses (plus one for "no rollup
   * yet"), rather than every site row shipped to a browser to be tallied
   * there. Which of those statuses count as UNHEALTHY is deliberately not
   * decided here: `isOperationalState` lives on MonitorStatus, the caller
   * already holds those rows, and duplicating the flag into this query would
   * be a second place for it to be read wrongly.
   */
  @CaptureSpan()
  public async getStatusCounts(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<SiteStatusCount>> {
    const rows: Array<AggregateRow> = await this.aggregateBy({
      query: {
        projectId: data.projectId,
      },
      groupBy: [
        {
          expression: `"NetworkSite"."currentMonitorStatusId"`,
          alias: "monitorStatusId",
        },
      ],
      select: [
        {
          expression: `COUNT(*)`,
          alias: "siteCount",
        },
      ],
      props: data.props,
    });

    return rows.map((row: AggregateRow): SiteStatusCount => {
      return {
        monitorStatusId: AggregateResultUtil.toStringOrNull(
          row,
          "monitorStatusId",
        ),
        siteCount: AggregateResultUtil.toNumber(row, "siteCount"),
      };
    });
  }

  /*
   * ------------------------------------------------------------------
   * Hierarchy maintenance (materializedPath + depth)
   * ------------------------------------------------------------------
   */

  /*
   * The hierarchy hooks run BEFORE DatabaseService applies tenant scoping to
   * the caller's query (ModelPermission.check*QueryPermissions runs after
   * onBeforeUpdate / onBeforeDelete), so reading the raw client query with
   * props.isRoot would hand the hook rows from other projects - which the
   * success hooks then write. Re-apply the caller's tenant here so a hook can
   * never see, let alone rewrite, a row outside the caller's project.
   */
  private scopeQueryToCallerTenant(
    query: Query<Model>,
    props: DatabaseCommonInteractionProps,
  ): Query<Model> {
    if (props.isRoot || !props.tenantId) {
      return query;
    }

    return {
      ...query,
      projectId: props.tenantId,
    };
  }

  /*
   * Case-sensitive, un-CAST prefix predicate on materializedPath.
   * QueryHelper.startsWith emits `CAST(alias AS TEXT) ILIKE :x`, and both the
   * cast and the case-insensitive match make the btree index on the column
   * unusable, so every rollup would sequentially scan the table. Paths are
   * built from UUIDs only, so there are no LIKE wildcards to escape.
   */
  private pathStartsWith(path: string): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);

    return Raw(
      (alias: string) => {
        return `(${alias} LIKE :${rid})`;
      },
      {
        [rid]: `${path}%`,
      },
    );
  }

  /*
   * The same prefix predicate for SEVERAL paths at once, OR-ed together, so
   * "every site under any of these" is one statement rather than one per
   * root. Each prefix keeps its own bound parameter; an empty list would
   * produce `()`, which is a syntax error, so callers must not reach here
   * with one (getSubtreeSiteIds guards it).
   */
  private pathStartsWithAny(paths: Array<string>): FindWhereProperty<any> {
    const parameters: Record<string, string> = {};
    const names: Array<string> = [];

    for (const path of paths) {
      const rid: string = Text.generateRandomText(10);
      parameters[rid] = `${path}%`;
      names.push(rid);
    }

    return Raw((alias: string) => {
      return `(${names
        .map((name: string) => {
          return `${alias} LIKE :${name}`;
        })
        .join(" OR ")})`;
    }, parameters);
  }

  /*
   * A stored path is trustworthy only when it agrees with parentSiteId: it
   * must end with the site's own id, and the segment before it must be the
   * parent (nothing before it for a root). A delete that nulls parentSiteId,
   * or a half-applied move, leaves the two disagreeing - and a stale path
   * silently corrupts every prefix query built from it, so treat it as
   * missing and let the caller rebuild.
   */
  private isPathConsistent(site: Model): boolean {
    if (!site.id) {
      return false;
    }

    const segments: Array<string> = MaterializedPathUtil.segmentsOf(
      site.materializedPath,
    );

    if (segments.length === 0) {
      return false;
    }

    if (segments[segments.length - 1] !== site.id.toString()) {
      return false;
    }

    const parentSegment: string | null =
      segments.length > 1 ? segments[segments.length - 2]! : null;
    const parentId: string | null = site.parentSiteId
      ? site.parentSiteId.toString()
      : null;

    return parentSegment === parentId;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    let parentPath: string | null = null;

    /*
     * Both spellings: the dashboard's site form posts the `parentSite`
     * relation, not the `parentSiteId` column. See RelationIdUtil.
     */
    const parentSiteId: ObjectID | null = RelationIdUtil.read(
      createBy.data as unknown as Record<string, unknown>,
      PARENT_SITE_KEYS,
    );

    if (parentSiteId) {
      const parent: Model | null = await this.findOneById({
        id: parentSiteId,
        select: {
          _id: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!parent) {
        throw new BadDataException("Parent site not found.");
      }

      if (
        createBy.data.projectId &&
        parent.projectId &&
        parent.projectId.toString() !== createBy.data.projectId.toString()
      ) {
        throw new BadDataException(
          "Parent site must belong to the same project.",
        );
      }

      parentPath = await this.getMaterializedPathForSite(parentSiteId);
    }

    return {
      createBy: createBy,
      carryForward: {
        parentPath: parentPath,
      },
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (!createdItem.id) {
      return createdItem;
    }

    const parentPath: string | null =
      (onCreate.carryForward?.parentPath as string | null) || null;

    const path: string = MaterializedPathUtil.buildPath(
      parentPath,
      createdItem.id.toString(),
    );

    await this.updateColumnsByIdWithoutHooks({
      id: createdItem.id,
      data: {
        materializedPath: path,
        depth: MaterializedPathUtil.depthOf(path),
      },
    });

    createdItem.materializedPath = path;
    createdItem.depth = MaterializedPathUtil.depthOf(path);

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const dataKeys: Array<string> = Object.keys(updateBy.data || {});

    if (!RelationIdUtil.isWritten(dataKeys, PARENT_SITE_KEYS)) {
      return { updateBy, carryForward: null };
    }

    const newParentId: ObjectID | null = RelationIdUtil.read(
      updateBy.data as unknown as Record<string, unknown>,
      PARENT_SITE_KEYS,
    );

    const previousItems: Array<Model> = await this.findBy({
      query: this.scopeQueryToCallerTenant(updateBy.query, updateBy.props),
      select: {
        _id: true,
        projectId: true,
        parentSiteId: true,
        materializedPath: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    /*
     * Same-project assertion for EVERY parentSiteId write, including the
     * detach case (parentSiteId: null) which has no parent to compare
     * against: onUpdateSuccess rewrites each matched site's whole subtree, so
     * a site outside the caller's project must never reach it.
     */
    if (updateBy.props.tenantId) {
      for (const item of previousItems) {
        if (
          item.projectId &&
          item.projectId.toString() !== updateBy.props.tenantId.toString()
        ) {
          throw new BadDataException(
            "Network site must belong to the same project.",
          );
        }
      }
    }

    let newParentPath: string | null = null;

    if (newParentId) {
      const parent: Model | null = await this.findOneById({
        id: newParentId,
        select: {
          _id: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!parent) {
        throw new BadDataException("Parent site not found.");
      }

      for (const item of previousItems) {
        if (item.id && item.id.toString() === newParentId.toString()) {
          throw new BadDataException("A site cannot be its own parent.");
        }

        if (
          item.projectId &&
          parent.projectId &&
          item.projectId.toString() !== parent.projectId.toString()
        ) {
          throw new BadDataException(
            "Parent site must belong to the same project.",
          );
        }
      }

      newParentPath = await this.getMaterializedPathForSite(newParentId);

      for (const item of previousItems) {
        if (
          item.id &&
          MaterializedPathUtil.wouldCreateCycle(
            item.id.toString(),
            newParentPath,
          )
        ) {
          throw new BadDataException(
            "Cannot move a site under itself or one of its own descendants.",
          );
        }
      }
    }

    const carryForward: ParentChangeCarryForward = {
      previousItems: previousItems,
      newParentId: newParentId,
      newParentPath: newParentPath,
    };

    return { updateBy, carryForward };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const parentChange: ParentChangeCarryForward | null =
      (onUpdate.carryForward as ParentChangeCarryForward | null) || null;

    if (!parentChange) {
      return onUpdate;
    }

    /*
     * DatabaseService calls onUpdateSuccess even when the tenant-scoped
     * UPDATE matched zero rows, so the carried previousItems are not proof
     * that anything was written. Only rows the UPDATE actually matched may be
     * rebased here.
     */
    const updatedIds: Set<string> = new Set(
      updatedItemIds.map((id: ObjectID) => {
        return id.toString();
      }),
    );

    for (const previousItem of parentChange.previousItems) {
      if (!previousItem.id || !updatedIds.has(previousItem.id.toString())) {
        continue;
      }

      const oldPath: string | null = previousItem.materializedPath || null;
      const newPath: string = MaterializedPathUtil.buildPath(
        parentChange.newParentPath,
        previousItem.id.toString(),
      );

      if (oldPath === newPath) {
        continue;
      }

      // Rebase the moved site itself...
      await this.updateColumnsByIdWithoutHooks({
        id: previousItem.id,
        data: {
          materializedPath: newPath,
          depth: MaterializedPathUtil.depthOf(newPath),
        },
      });

      // ...then its entire subtree in one prefix query.
      if (oldPath) {
        const descendants: Array<Model> = await this.findBy({
          query: {
            projectId: previousItem.projectId!,
            materializedPath: this.pathStartsWith(oldPath),
          },
          select: {
            _id: true,
            materializedPath: true,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

        for (const descendant of descendants) {
          if (
            !descendant.id ||
            !descendant.materializedPath ||
            descendant.id.toString() === previousItem.id.toString()
          ) {
            continue;
          }

          const rebasedPath: string = MaterializedPathUtil.rebasePaths(
            oldPath,
            newPath,
            [descendant.materializedPath],
          )[0]!;

          await this.updateColumnsByIdWithoutHooks({
            id: descendant.id,
            data: {
              materializedPath: rebasedPath,
              depth: MaterializedPathUtil.depthOf(rebasedPath),
            },
          });
        }
      }

      /*
       * Moving a subtree changes the rollup of both the new ancestor chain
       * (via the moved site) and the old one (via the old parent). Rollup
       * failures must never fail the move itself - the cron backstop
       * reconciles.
       */
      try {
        await this.recomputeRollupForSiteAndAncestors(previousItem.id);
        if (previousItem.parentSiteId) {
          await this.recomputeRollupForSiteAndAncestors(
            previousItem.parentSiteId,
          );
        }
      } catch (error) {
        logger.error(
          `NetworkSiteService.onUpdateSuccess: rollup after site move failed for site ${previousItem.id.toString()}: ${error}`,
          {
            projectId: previousItem.projectId?.toString(),
            siteId: previousItem.id.toString(),
          } as LogAttributes,
        );
      }
    }

    return onUpdate;
  }

  /*
   * Deletes are hard deletes, so the rows' hierarchy state has to be captured
   * before they disappear. Scoped to the caller's tenant for the same reason
   * onBeforeUpdate is: this hook runs before the delete query is permission
   * checked.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const sitesToDelete: Array<Model> = await this.findBy({
      query: this.scopeQueryToCallerTenant(deleteBy.query, deleteBy.props),
      select: {
        _id: true,
        projectId: true,
        parentSiteId: true,
        materializedPath: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const carryForward: DeleteCarryForward = {
      sitesToDelete: sitesToDelete,
    };

    return { deleteBy, carryForward };
  }

  /*
   * parentSiteId is declared onDelete: "SET NULL", so Postgres detaches the
   * deleted site's direct children but leaves their materializedPath - and
   * their whole subtree's - routed through a row that no longer exists. That
   * strands the subtree: the children endpoint (which reads parentSiteId)
   * shows them at the root while the rollup engine (which reads
   * materializedPath) still folds them into the dead ancestor's chain, double
   * counting every outage. Re-attach the orphans to the deleted site's own
   * parent - NULL when it was a root, which is exactly what the FK did - and
   * rebase the subtree paths so both readers agree again.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const carryForward: DeleteCarryForward | null =
      (onDelete.carryForward as DeleteCarryForward | null) || null;

    if (!carryForward) {
      return onDelete;
    }

    // Only rows the permission-checked delete actually removed.
    const deletedIds: Set<string> = new Set(
      itemIdsBeforeDelete.map((id: ObjectID) => {
        return id.toString();
      }),
    );

    for (const deletedSite of carryForward.sitesToDelete) {
      if (
        !deletedSite.id ||
        !deletedSite.projectId ||
        !deletedIds.has(deletedSite.id.toString())
      ) {
        continue;
      }

      /*
       * Repair failures must never fail the delete itself - the row is
       * already gone, and getMaterializedPathForSite self-heals a stranded
       * path on next use.
       */
      try {
        await this.reattachOrphanedSubtree(deletedSite);
      } catch (error) {
        logger.error(
          `NetworkSiteService.onDeleteSuccess: subtree repair after deleting site ${deletedSite.id.toString()} failed: ${error}`,
          {
            projectId: deletedSite.projectId.toString(),
            siteId: deletedSite.id.toString(),
          } as LogAttributes,
        );
      }
    }

    return onDelete;
  }

  /*
   * Rewrites the deleted site's former subtree so the '/deletedId/' segment
   * is dropped from every path, and re-points its direct children at the
   * deleted site's parent.
   */
  private async reattachOrphanedSubtree(deletedSite: Model): Promise<void> {
    const oldPath: string | null = deletedSite.materializedPath || null;

    if (!oldPath || !deletedSite.id) {
      return;
    }

    const parentPath: string | null = deletedSite.parentSiteId
      ? await this.getMaterializedPathForSite(deletedSite.parentSiteId)
      : null;

    const deletedDepth: number =
      MaterializedPathUtil.segmentsOf(oldPath).length;

    const descendants: Array<Model> = await this.findBy({
      query: {
        projectId: deletedSite.projectId!,
        materializedPath: this.pathStartsWith(oldPath),
      },
      select: {
        _id: true,
        materializedPath: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const descendant of descendants) {
      if (
        !descendant.id ||
        !descendant.materializedPath ||
        descendant.id.toString() === deletedSite.id.toString()
      ) {
        continue;
      }

      const tailSegments: Array<string> = MaterializedPathUtil.segmentsOf(
        descendant.materializedPath,
      ).slice(deletedDepth);

      if (tailSegments.length === 0) {
        continue;
      }

      let rebasedPath: string | null = parentPath;
      for (const segment of tailSegments) {
        rebasedPath = MaterializedPathUtil.buildPath(rebasedPath, segment);
      }

      const data: Record<string, unknown> = {
        materializedPath: rebasedPath!,
        depth: MaterializedPathUtil.depthOf(rebasedPath!),
      };

      // A direct child is the one the FK just detached - give it a parent back.
      if (tailSegments.length === 1) {
        data["parentSiteId"] = deletedSite.parentSiteId || null;
      }

      await this.updateColumnsByIdWithoutHooks({
        id: descendant.id,
        data: data as any,
      });
    }

    /*
     * The deleted site's own devices were detached by their FK too, so the
     * surviving ancestor chain's rollup is now stale.
     */
    if (deletedSite.parentSiteId) {
      await this.recomputeRollupForSiteAndAncestors(deletedSite.parentSiteId);
    }
  }

  /*
   * Returns the site's materialized path, rebuilding (and persisting) it by
   * walking up the parent chain when the stored value is missing OR no longer
   * agrees with parentSiteId - a row created before path maintenance existed,
   * one whose maintenance write failed, or one stranded by a deleted
   * ancestor, self-heals on first use.
   */
  @CaptureSpan()
  public async getMaterializedPathForSite(
    siteId: ObjectID,
  ): Promise<string | null> {
    const site: Model | null = await this.findOneById({
      id: siteId,
      select: {
        _id: true,
        parentSiteId: true,
        materializedPath: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!site || !site.id) {
      return null;
    }

    if (site.materializedPath && this.isPathConsistent(site)) {
      return site.materializedPath;
    }

    /*
     * Walk up until a parent with a stored path (or a root) is found. The
     * visited set guards against pre-existing cycles in the data - without
     * it a corrupted parent chain would loop forever.
     */
    const chain: Array<Model> = [site];
    const visited: Set<string> = new Set([site.id.toString()]);
    let prefixPath: string | null = null;

    let cursor: Model = site;
    while (cursor.parentSiteId) {
      if (visited.has(cursor.parentSiteId.toString())) {
        logger.error(
          `NetworkSiteService.getMaterializedPathForSite: cycle detected in parent chain of site ${siteId.toString()}; treating ${cursor.id?.toString()} as a root.`,
        );
        break;
      }

      const parent: Model | null = await this.findOneById({
        id: cursor.parentSiteId,
        select: {
          _id: true,
          parentSiteId: true,
          materializedPath: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!parent || !parent.id) {
        break;
      }

      // A stale ancestor path would poison every path rebuilt from it.
      if (parent.materializedPath && this.isPathConsistent(parent)) {
        prefixPath = parent.materializedPath;
        break;
      }

      visited.add(parent.id.toString());
      chain.push(parent);
      cursor = parent;
    }

    // Fold back down, persisting the healed paths as we go.
    let path: string | null = prefixPath;
    for (let i: number = chain.length - 1; i >= 0; i--) {
      const chainSite: Model = chain[i]!;
      path = MaterializedPathUtil.buildPath(path, chainSite.id!.toString());
      await this.updateColumnsByIdWithoutHooks({
        id: chainSite.id!,
        data: {
          materializedPath: path,
          depth: MaterializedPathUtil.depthOf(path),
        },
      });
    }

    return path;
  }

  // Ancestor IDs from root to direct parent (excludes the site itself).
  @CaptureSpan()
  public async getAncestorIds(siteId: ObjectID): Promise<Array<ObjectID>> {
    const path: string | null = await this.getMaterializedPathForSite(siteId);
    if (!path) {
      return [];
    }

    return MaterializedPathUtil.segmentsOf(path)
      .filter((segment: string) => {
        return segment !== siteId.toString();
      })
      .map((segment: string) => {
        return new ObjectID(segment);
      });
  }

  /*
   * Strict descendant IDs (excludes the site itself), via path prefix query.
   * projectId is required by every production caller: without it the prefix
   * scan has no indexable predicate and reads every tenant's rows.
   */
  @CaptureSpan()
  public async getDescendantSiteIds(
    siteId: ObjectID,
    projectId?: ObjectID | undefined,
  ): Promise<Array<ObjectID>> {
    const path: string | null = await this.getMaterializedPathForSite(siteId);
    if (!path) {
      return [];
    }

    const query: Query<Model> = {
      materializedPath: this.pathStartsWith(path),
    };

    if (projectId) {
      query.projectId = projectId;
    }

    const descendants: Array<Model> = await this.findBy({
      query: query,
      select: {
        _id: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return descendants
      .filter((descendant: Model) => {
        return descendant.id && descendant.id.toString() !== siteId.toString();
      })
      .map((descendant: Model) => {
        return descendant.id!;
      });
  }

  /*
   * Every site id in the subtrees rooted at `siteIds`, INCLUDING the roots
   * themselves.
   *
   * Two statements regardless of how many roots are passed: one to read the
   * roots' materialized paths, one prefix scan OR-ing those paths together.
   * The obvious loop over getDescendantSiteIds is two statements PER root,
   * and the caller that needs this - expanding a maintenance window attached
   * to a Region into the units it covers - can legitimately be handed
   * hundreds of roots.
   *
   * Roots whose row is missing or whose path is unset contribute only
   * themselves: a site with no path has no discoverable subtree, and
   * silently dropping it would quietly un-cover a maintenance window.
   */
  @CaptureSpan()
  public async getSubtreeSiteIds(data: {
    siteIds: Array<ObjectID>;
    projectId: ObjectID;
  }): Promise<Set<string>> {
    const result: Set<string> = new Set<string>();

    for (const siteId of data.siteIds) {
      result.add(siteId.toString());
    }

    if (result.size === 0) {
      return result;
    }

    const roots: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(data.siteIds),
      },
      select: {
        _id: true,
        materializedPath: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const paths: Array<string> = [];

    for (const root of roots) {
      if (root.materializedPath) {
        paths.push(root.materializedPath);
      }
    }

    if (paths.length === 0) {
      return result;
    }

    const descendants: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        materializedPath: this.pathStartsWithAny(paths),
      },
      select: {
        _id: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const descendant of descendants) {
      if (descendant.id) {
        result.add(descendant.id.toString());
      }
    }

    return result;
  }

  /*
   * ------------------------------------------------------------------
   * Persisted rollup engine
   * ------------------------------------------------------------------
   */

  /*
   * Recomputes the rollup for one site from the devices in its subtree,
   * persisting currentMonitorStatusId + lastRollupAt and keeping the
   * NetworkSiteStatusTimeline in sync (close the open row, open a new one)
   * whenever the status actually changes.
   *
   * WHICH rule turns those devices into one status is the site's own
   * healthRollupPolicy - worst-of by default, or a share-of-devices-down
   * threshold. See Types/NetworkSite/SiteHealthRollupPolicy.
   *
   * Descendants inside an ongoing scheduled maintenance window are dropped
   * from the subtree first, so planned work on one unit does not turn its
   * region red. The maintained site's OWN rollup keeps every device,
   * including its own: someone looking at that unit must still see it is
   * down. See NetworkSiteMaintenanceSuppression.
   */
  @CaptureSpan()
  public async recomputeRollupForSite(siteId: ObjectID): Promise<void> {
    const site: Model | null = await this.findOneById({
      id: siteId,
      select: {
        _id: true,
        projectId: true,
        currentMonitorStatusId: true,
        name: true,
        shouldAlertWhenUnhealthy: true,
        alertSeverityId: true,
        currentActiveAlertId: true,
        healthRollupPolicy: true,
        offlineThresholdPercent: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!site || !site.id || !site.projectId) {
      return;
    }

    const subtreeSiteIds: Array<ObjectID> = [
      site.id,
      ...(await this.getDescendantSiteIds(site.id, site.projectId)),
    ];

    /*
     * Sites silenced by an ongoing maintenance window. A site that is itself
     * inside one suppresses nothing - not even its own descendants - because
     * its rollup is supposed to show the planned outage. Only an ancestor
     * looking down past a maintained subtree drops it.
     */
    const maintainedSiteIds: Set<string> =
      await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
        site.projectId,
      );

    const isSiteUnderMaintenance: boolean = maintainedSiteIds.has(
      site.id.toString(),
    );

    const contributingSiteIds: Array<ObjectID> =
      isSiteUnderMaintenance || maintainedSiteIds.size === 0
        ? subtreeSiteIds
        : subtreeSiteIds.filter((id: ObjectID) => {
            return !maintainedSiteIds.has(id.toString());
          });

    const now: Date = OneUptimeDate.getCurrentDate();

    /*
     * The subtree's devices, as health BUCKETS rather than rows.
     *
     * This used to read the devices themselves, capped at LIMIT_MAX. A
     * franchise estate whose root site has more than ten thousand devices
     * under it therefore rolled up from an arbitrary ten-thousand-row sample:
     * the one dark switch in store 12,000 could not turn its region red, and
     * nothing said so. Bucketing runs over the whole subtree however large it
     * is, and returns a handful of rows to classify.
     *
     * Archived devices are decommissioned: they keep their siteId but must
     * not vote in the rollup. An archived, never-monitored device otherwise
     * falls through to the freshness fallback (stale lastSeenAt -> Offline)
     * and pins its whole ancestor chain red forever, with the drill-down
     * showing zero devices because that query excludes archived rows.
     */
    const deviceGroups: Array<DeviceHealthGroup> =
      await NetworkDeviceService.getHealthGroupsForSites({
        projectId: site.projectId,
        siteIds: contributingSiteIds,
        now: now,
        props: {
          isRoot: true,
        },
      });

    const statuses: Array<MonitorStatus> = await MonitorStatusService.findBy({
      query: {
        projectId: site.projectId,
      },
      select: {
        _id: true,
        name: true,
        priority: true,
        isOperationalState: true,
        isOfflineState: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const priorityByStatusId: Map<string, number> = new Map();
    const isOperationalByStatusId: Map<string, boolean> = new Map();
    let operationalStatus: RollupStatusOption | null = null;
    let offlineStatus: RollupStatusOption | null = null;
    /*
     * The rung between the two, for the threshold policy: the WORST status
     * that is neither operational nor offline (highest priority wins, the
     * same direction worst-of reads the ladder). Projects that never created
     * one leave this null and "some devices down" falls through to offline.
     */
    let degradedStatus: RollupStatusOption | null = null;

    for (const status of statuses) {
      if (!status.id || typeof status.priority !== "number") {
        continue;
      }
      priorityByStatusId.set(status.id.toString(), status.priority);
      isOperationalByStatusId.set(
        status.id.toString(),
        Boolean(status.isOperationalState),
      );
      if (status.isOperationalState && !operationalStatus) {
        operationalStatus = {
          monitorStatusId: status.id.toString(),
          priority: status.priority,
        };
      }
      if (status.isOfflineState && !offlineStatus) {
        offlineStatus = {
          monitorStatusId: status.id.toString(),
          priority: status.priority,
        };
      }
      if (
        !status.isOperationalState &&
        !status.isOfflineState &&
        (!degradedStatus || status.priority > degradedStatus.priority)
      ) {
        degradedStatus = {
          monitorStatusId: status.id.toString(),
          priority: status.priority,
        };
      }
    }

    const deviceStates: Array<DeviceHealthState> = deviceGroups.map(
      (group: DeviceHealthGroup) => {
        return deviceRollupStateForGroup({
          group: group,
          monitorStatusPriority: group.monitorStatusId
            ? priorityByStatusId.get(group.monitorStatusId)
            : undefined,
          monitorStatusIsOperational: group.monitorStatusId
            ? isOperationalByStatusId.get(group.monitorStatusId)
            : undefined,
          now: now,
        });
      },
    );

    const rolledUpStatusId: string | null = SiteStatusRollupUtil.rollupStatus({
      policy: parseSiteHealthRollupPolicy(site.healthRollupPolicy),
      deviceStates: deviceStates,
      ladder: {
        operationalStatus: operationalStatus,
        degradedStatus: degradedStatus,
        offlineStatus: offlineStatus,
      },
      offlineThresholdPercent: site.offlineThresholdPercent,
      now: now,
    });
    const currentStatusId: string | null =
      site.currentMonitorStatusId?.toString() || null;

    // No devices contribute -> leave the status alone, just stamp the run.
    if (!rolledUpStatusId || rolledUpStatusId === currentStatusId) {
      await this.updateColumnsByIdWithoutHooks({
        id: site.id,
        data: {
          lastRollupAt: now,
        },
      });
      return;
    }

    await this.updateColumnsByIdWithoutHooks({
      id: site.id,
      data: {
        currentMonitorStatusId: new ObjectID(rolledUpStatusId),
        lastRollupAt: now,
      },
    });

    // Close every open timeline row, then open one for the new status.
    await NetworkSiteStatusTimelineService.updateBy({
      query: {
        siteId: site.id,
        endsAt: QueryHelper.isNull(),
      },
      data: {
        endsAt: now,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const timeline: NetworkSiteStatusTimeline = new NetworkSiteStatusTimeline();
    timeline.projectId = site.projectId;
    timeline.siteId = site.id;
    timeline.monitorStatusId = new ObjectID(rolledUpStatusId);
    timeline.startsAt = now;

    await NetworkSiteStatusTimelineService.create({
      data: timeline,
      props: {
        isRoot: true,
      },
    });

    /*
     * Site alerting rides the same transition the timeline records. Alert
     * bookkeeping must never break the rollup itself.
     */
    try {
      await this.syncSiteAlertForStatusTransition({
        site: site,
        newStatus:
          statuses.find((status: MonitorStatus) => {
            return status.id?.toString() === rolledUpStatusId;
          }) || null,
      });
    } catch (err) {
      logger.error(
        `Network site rollup: error syncing alert for site ${site.id.toString()}:`,
      );
      logger.error(err);
    }
  }

  /*
   * Opens an alert when a site's rollup TRANSITIONS to a non-operational
   * status (and alerting is enabled on the site), and auto-resolves that
   * alert when the site transitions back to operational. Transition-only
   * by design: enabling alerting on an already-unhealthy site arms the
   * next transition instead of retro-alerting, and a manually resolved
   * alert is not reopened until the site recovers and degrades again
   * (a transition clears the tracked id).
   */
  @CaptureSpan()
  private async syncSiteAlertForStatusTransition(data: {
    site: Model;
    newStatus: MonitorStatus | null;
  }): Promise<void> {
    const site: Model = data.site;

    if (!site.id || !site.projectId || !data.newStatus) {
      return;
    }

    const isNowOperational: boolean = Boolean(
      data.newStatus.isOperationalState,
    );

    // Recovery: resolve the open site alert, if one is tracked.
    if (isNowOperational) {
      if (!site.currentActiveAlertId) {
        return;
      }

      await this.resolveSiteAlert({
        projectId: site.projectId,
        alertId: site.currentActiveAlertId,
        rootCause: `**Recovered:** Network site **${site.name || "site"}** rolled back up to ${data.newStatus.name || "an operational status"}.`,
      });

      await this.updateColumnsByIdWithoutHooks({
        id: site.id,
        data: {
          currentActiveAlertId: null,
        },
      });

      return;
    }

    // Degradation between two unhealthy statuses keeps the existing alert.
    if (
      !site.shouldAlertWhenUnhealthy ||
      site.currentActiveAlertId ||
      DisableAutomaticAlertCreation
    ) {
      return;
    }

    let alertSeverityId: ObjectID | undefined = site.alertSeverityId;

    if (!alertSeverityId) {
      // Same default the monitor alert path uses: the most severe first.
      const severity: AlertSeverity | null =
        await AlertSeverityService.findOneBy({
          query: {
            projectId: site.projectId,
          },
          sort: {
            order: SortOrder.Ascending,
          },
          select: {
            _id: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!severity || !severity.id) {
        logger.warn(
          `Network site alerting: project ${site.projectId.toString()} has no alert severity; skipping site alert.`,
        );
        return;
      }

      alertSeverityId = severity.id;
    }

    const statusName: string = data.newStatus.name || "Unhealthy";

    const alert: Alert = new Alert();
    alert.projectId = site.projectId;
    alert.title = `Network site ${site.name || site.id.toString()} is ${statusName}`;
    alert.description = `The health rollup of network site **${
      site.name || site.id.toString()
    }** changed to **${statusName}**, rolled up from the devices at this site and every site below it. This alert auto-resolves when the site rolls back up to an operational status.`;
    alert.alertSeverityId = alertSeverityId;
    alert.rootCause = `Network site **${site.name || site.id.toString()}** rolled up to **${statusName}**.`;

    const createdAlert: Alert = await AlertService.create({
      data: alert,
      props: {
        isRoot: true,
      },
    });

    if (createdAlert.id) {
      await this.updateColumnsByIdWithoutHooks({
        id: site.id,
        data: {
          currentActiveAlertId: createdAlert.id,
        },
      });
    }
  }

  // Moves a site alert to the project's resolved state, if not already there.
  private async resolveSiteAlert(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    rootCause: string;
  }): Promise<void> {
    const alert: Alert | null = await AlertService.findOneById({
      id: data.alertId,
      select: {
        _id: true,
        currentAlertStateId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert || !alert.id) {
      // Deleted by hand — nothing to resolve.
      return;
    }

    const resolvedStateId: ObjectID =
      await AlertStateTimelineService.getResolvedStateIdForProject(
        data.projectId,
      );

    if (alert.currentAlertStateId?.toString() === resolvedStateId.toString()) {
      // Already resolved manually.
      return;
    }

    const alertStateTimeline: AlertStateTimeline = new AlertStateTimeline();
    alertStateTimeline.alertId = alert.id;
    alertStateTimeline.alertStateId = resolvedStateId;
    alertStateTimeline.projectId = data.projectId;
    alertStateTimeline.rootCause = data.rootCause;

    await AlertStateTimelineService.create({
      data: alertStateTimeline,
      props: {
        isRoot: true,
      },
    });
  }

  // Recomputes the site itself, then each ancestor (nearest first).
  @CaptureSpan()
  public async recomputeRollupForSiteAndAncestors(
    siteId: ObjectID,
  ): Promise<void> {
    await this.recomputeRollupForSite(siteId);

    const ancestorIds: Array<ObjectID> = await this.getAncestorIds(siteId);

    // getAncestorIds returns root-first; recompute nearest ancestor first.
    for (let i: number = ancestorIds.length - 1; i >= 0; i--) {
      await this.recomputeRollupForSite(ancestorIds[i]!);
    }
  }

  /*
   * Re-rolls the chains a maintenance window just started or stopped
   * covering.
   *
   * Only the attached sites and their ANCESTORS can have changed verdict:
   * the maintained subtree keeps every one of its own devices either way
   * (see recomputeRollupForSite), so nothing below an attached site needs
   * recomputing. Each chain is deduplicated, because attaching a Region and
   * one of its Markets to the same window would otherwise walk the shared
   * ancestors twice.
   *
   * Errors are swallowed per site: the five-minute stale-rollup sweep is the
   * backstop, and a maintenance event must not fail to start because one
   * site's rollup did.
   */
  @CaptureSpan()
  public async recomputeRollupsAfterMaintenanceChange(data: {
    projectId: ObjectID;
    siteIds: Array<ObjectID>;
  }): Promise<void> {
    if (data.siteIds.length === 0) {
      return;
    }

    /*
     * The suppression set is cached for a few seconds; a window that has
     * just flipped state must not be recomputed against the previous
     * answer.
     */
    NetworkSiteMaintenanceSuppression.invalidateCache(data.projectId);

    const recomputed: Set<string> = new Set<string>();

    for (const siteId of data.siteIds) {
      const chain: Array<ObjectID> = [
        siteId,
        ...(await this.getAncestorIds(siteId)).reverse(),
      ];

      for (const chainSiteId of chain) {
        const key: string = chainSiteId.toString();
        if (recomputed.has(key)) {
          continue;
        }
        recomputed.add(key);

        try {
          await this.recomputeRollupForSite(chainSiteId);
        } catch (error) {
          logger.error(
            `NetworkSiteService.recomputeRollupsAfterMaintenanceChange: rollup failed for site ${key}: ${error}`,
            {
              projectId: data.projectId.toString(),
              siteId: key,
            } as LogAttributes,
          );
        }
      }
    }
  }

  /*
   * ------------------------------------------------------------------
   * Monitor status bridge
   * ------------------------------------------------------------------
   */

  /*
   * Called by MonitorService.changeMonitorStatus after a status persists.
   * Resolves which NetworkDevices these monitors report on, stamps those
   * devices' currentMonitorStatusId, then recomputes the rollup for every
   * affected site chain. Never throws - a rollup failure must never break a
   * monitor status change.
   *
   * A device is reached two ways, and both are checked:
   *
   *   - a Network Device monitor names it inside its step data. This is the
   *     SNMP path: the device is polled by its probe and the monitor exists
   *     to alert on what the walk reports.
   *   - the device points AT a monitor through monitorId. This is the
   *     monitor-backed path (monitoringMethod "Monitor") for gear that does
   *     not speak SNMP, so ANY monitor type qualifies — a Ping monitor on an
   *     access point is the whole point of it.
   */
  @CaptureSpan()
  public async onMonitorStatusChanged(data: {
    projectId: ObjectID;
    monitorIds: Array<ObjectID>;
    monitorStatusId: ObjectID;
  }): Promise<void> {
    try {
      if (data.monitorIds.length === 0) {
        return;
      }

      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          _id: QueryHelper.any(data.monitorIds),
          projectId: data.projectId,
          monitorType: MonitorType.NetworkDevice,
        },
        select: {
          _id: true,
          monitorType: true,
          monitorSteps: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const referencedDeviceIds: Array<string> =
        monitors.length > 0
          ? NetworkDeviceHydrationUtil.getReferencedNetworkDeviceIds(monitors)
          : [];

      /*
       * Deduplicated by id, because a device can legitimately be reached
       * both ways — an SNMP-polled device may also carry a monitorId — and
       * stamping it twice would double every rollup it triggers.
       */
      const devicesById: Map<string, NetworkDevice> = new Map<
        string,
        NetworkDevice
      >();

      const collect: (rows: Array<NetworkDevice>) => void = (
        rows: Array<NetworkDevice>,
      ): void => {
        for (const row of rows) {
          if (row.id) {
            devicesById.set(row.id.toString(), row);
          }
        }
      };

      if (referencedDeviceIds.length > 0) {
        collect(
          await NetworkDeviceService.findBy({
            query: {
              _id: QueryHelper.any(referencedDeviceIds),
              projectId: data.projectId,
            },
            select: {
              _id: true,
              siteId: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
              isRoot: true,
            },
          }),
        );
      }

      collect(
        await NetworkDeviceService.findBy({
          query: {
            monitorId: QueryHelper.any(data.monitorIds),
            projectId: data.projectId,
          },
          select: {
            _id: true,
            siteId: true,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: {
            isRoot: true,
          },
        }),
      );

      const devices: Array<NetworkDevice> = Array.from(devicesById.values());

      if (devices.length === 0) {
        return;
      }

      for (const device of devices) {
        if (!device.id) {
          continue;
        }
        await NetworkDeviceService.updateColumnsByIdWithoutHooks({
          id: device.id,
          data: {
            currentMonitorStatusId: data.monitorStatusId,
          },
        });
      }

      const distinctSiteIds: Map<string, ObjectID> = new Map();
      for (const device of devices) {
        if (device.siteId) {
          distinctSiteIds.set(device.siteId.toString(), device.siteId);
        }
      }

      for (const siteId of distinctSiteIds.values()) {
        await this.recomputeRollupForSiteAndAncestors(siteId);
      }
    } catch (error) {
      logger.error(
        `NetworkSiteService.onMonitorStatusChanged: failed to update network site rollups: ${error}`,
        {
          projectId: data.projectId.toString(),
          monitorStatusId: data.monitorStatusId.toString(),
        } as LogAttributes,
      );
    }
  }
}

export default new Service();
