import AlertService from "./AlertService";
import AlertSeverityService from "./AlertSeverityService";
import AlertStateTimelineService from "./AlertStateTimelineService";
import DatabaseService from "./DatabaseService";
import MonitorService from "./MonitorService";
import MonitorStatusService from "./MonitorStatusService";
import NetworkDeviceService from "./NetworkDeviceService";
import NetworkSiteStatusTimelineService from "./NetworkSiteStatusTimelineService";
import NetworkSiteTypeService from "./NetworkSiteTypeService";
import Model from "../../Models/DatabaseModels/NetworkSite";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import AlertStateTimeline from "../../Models/DatabaseModels/AlertStateTimeline";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import NetworkSiteStatusTimeline from "../../Models/DatabaseModels/NetworkSiteStatusTimeline";
import NetworkSiteType from "../../Models/DatabaseModels/NetworkSiteType";
import { DisableAutomaticAlertCreation } from "../EnvironmentConfig";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import DeleteOneBy from "../Types/Database/DeleteOneBy";
import UpdateBy from "../Types/Database/UpdateBy";
import UpdateOneBy from "../Types/Database/UpdateOneBy";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import NetworkDeviceHydrationUtil from "../Utils/Monitor/NetworkDeviceHydrationUtil";
import logger, { LogAttributes } from "../Utils/Logger";
import PartialEntity from "../../Types/Database/PartialEntity";
import { NetworkDeviceMonitoringMethodUtil } from "../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { FindWhereProperty } from "../../Types/BaseDatabase/Query";
import BadDataException from "../../Types/Exception/BadDataException";
import MonitorType from "../../Types/Monitor/MonitorType";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import PositiveNumber from "../../Types/PositiveNumber";
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
import NetworkSiteHierarchyLock from "../Utils/NetworkSite/NetworkSiteHierarchyLock";
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
 * Like parentSite, the site's type can be written either as its FK or as the
 * serialised relation produced by dashboard forms. Hierarchy validation must
 * inspect both spellings because TypeORM has not resolved the relation when
 * the before hooks run.
 */
const NETWORK_SITE_TYPE_KEYS: Array<string> = [
  "networkSiteTypeId",
  "networkSiteType",
];

const PROJECT_KEYS: Array<string> = ["projectId", "project"];

const MATERIALIZED_HIERARCHY_KEYS: Array<string> = [
  "materializedPath",
  "depth",
];

/*
 * Type edits have to inspect every direct child. Keep each read bounded and
 * page until exhaustion so a very wide site cannot hide invalid edges beyond
 * DatabaseService's single-query limit.
 */
const DIRECT_CHILD_TYPE_VALIDATION_PAGE_SIZE: number = 1000;

/*
 * Rebase large subtrees in bounded pages. Each successful rewrite removes the
 * row from the old path prefix, so every page must start at offset zero.
 */
const SUBTREE_REBASE_PAGE_SIZE: number = 1000;

/*
 * Model instances initialise optional fields to undefined. Those properties
 * are omissions, not requests to clear a relation; null is the explicit
 * clear value and must still run validation.
 */
function isRelationWritten(
  data: Record<string, unknown>,
  keys: Array<string>,
): boolean {
  return keys.some((key: string) => {
    return key in data && data[key] !== undefined;
  });
}

function normalizeId(id: ObjectID | string): string {
  return id.toString().toLowerCase();
}

function sameId(left: ObjectID | string, right: ObjectID | string): boolean {
  return normalizeId(left) === normalizeId(right);
}

/*
 * RelationIdUtil intentionally returns null for anything it cannot resolve.
 * In a hierarchy hook, however, an unresolvable NON-null value cannot mean
 * "clear": TypeORM may still interpret a raw expression or relation-shaped
 * object during the eventual write. Require each supplied spelling to be an
 * explicit clear or a concrete ID before checking cross-spelling agreement.
 */
function readStrictRelationId(data: {
  payload: Record<string, unknown>;
  keys: Array<string>;
  relationTitle: string;
}): ObjectID | null {
  for (const key of data.keys) {
    const value: unknown = data.payload[key];

    if (typeof value === "function") {
      throw new BadDataException(
        `${key} cannot be set to a raw SQL expression because the network site hierarchy must be validated against an actual ID.`,
      );
    }

    const isExplicitClear: boolean = value === null || value === "";

    if (
      value !== undefined &&
      !isExplicitClear &&
      !RelationIdUtil.read(data.payload, [key])
    ) {
      throw new BadDataException(
        `${key} must contain a valid ${data.relationTitle} ID.`,
      );
    }
  }

  return RelationIdUtil.readConsistent(
    data.payload,
    data.keys,
    data.relationTitle,
  );
}

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
 * Carried from onBeforeDelete to onDeleteSuccess. The normal path rejects a
 * delete with surviving children, but retaining the pre-delete hierarchy
 * state lets the success hook repair rows created under older SET NULL
 * schemas or by an in-flight legacy write.
 */
interface DeleteCarryForward {
  sitesToDelete: Array<Model>;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Parent/type validation and the eventual write must observe one serialized
   * project hierarchy. The same distributed lock is used by
   * NetworkSiteTypeService, because changing either table can invalidate the
   * other. It surrounds the whole DatabaseService mutation so success-hook
   * subtree maintenance is protected too and finally always releases it.
   */
  @CaptureSpan()
  public override async create(createBy: CreateBy<Model>): Promise<Model> {
    if (createBy.props.ignoreHooks) {
      return await super.create(createBy);
    }

    const rawData: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;
    const projectId: ObjectID | null =
      createBy.props.tenantId ||
      RelationIdUtil.readConsistent(
        rawData,
        ["projectId", "project"],
        "Project",
      ) ||
      null;

    return await NetworkSiteHierarchyLock.runExclusive({
      projectIds: projectId ? [projectId] : [],
      operation: async (): Promise<Model> => {
        return await super.create(createBy);
      },
    });
  }

  @CaptureSpan()
  public override async updateOneBy(
    updateOneBy: UpdateOneBy<Model>,
  ): Promise<number> {
    if (
      updateOneBy.props.ignoreHooks ||
      !this.updateTouchesHierarchy(updateOneBy.data)
    ) {
      return await super.updateOneBy(updateOneBy);
    }

    const projectIds: Array<ObjectID | string> =
      await this.findMutationProjectIds({
        query: updateOneBy.query,
        props: updateOneBy.props,
        limit: 1,
        skip: 0,
        isDelete: false,
      });

    return await NetworkSiteHierarchyLock.runExclusive({
      projectIds,
      operation: async (): Promise<number> => {
        return await super.updateOneBy(updateOneBy);
      },
    });
  }

  @CaptureSpan()
  public override async updateBy(updateBy: UpdateBy<Model>): Promise<number> {
    if (
      updateBy.props.ignoreHooks ||
      !this.updateTouchesHierarchy(updateBy.data)
    ) {
      return await super.updateBy(updateBy);
    }

    const projectIds: Array<ObjectID | string> =
      await this.findMutationProjectIds({
        query: updateBy.query,
        props: updateBy.props,
        limit: this.positiveNumberValue(updateBy.limit, LIMIT_MAX),
        skip: this.positiveNumberValue(updateBy.skip, 0),
        isDelete: false,
      });

    return await NetworkSiteHierarchyLock.runExclusive({
      projectIds,
      operation: async (): Promise<number> => {
        return await super.updateBy(updateBy);
      },
    });
  }

  @CaptureSpan()
  public override async deleteOneBy(
    deleteOneBy: DeleteOneBy<Model>,
  ): Promise<number> {
    if (deleteOneBy.props.ignoreHooks) {
      return await super.deleteOneBy(deleteOneBy);
    }

    const projectIds: Array<ObjectID | string> =
      await this.findMutationProjectIds({
        query: deleteOneBy.query,
        props: deleteOneBy.props,
        limit: 1,
        skip: 0,
        isDelete: true,
      });

    return await NetworkSiteHierarchyLock.runExclusive({
      projectIds,
      operation: async (): Promise<number> => {
        return await super.deleteOneBy(deleteOneBy);
      },
    });
  }

  @CaptureSpan()
  public override async deleteBy(deleteBy: DeleteBy<Model>): Promise<number> {
    if (deleteBy.props.ignoreHooks) {
      return await super.deleteBy(deleteBy);
    }

    const projectIds: Array<ObjectID | string> =
      await this.findMutationProjectIds({
        query: deleteBy.query,
        props: deleteBy.props,
        limit: this.positiveNumberValue(deleteBy.limit, LIMIT_MAX),
        skip: this.positiveNumberValue(deleteBy.skip, 0),
        isDelete: true,
      });

    return await NetworkSiteHierarchyLock.runExclusive({
      projectIds,
      operation: async (): Promise<number> => {
        return await super.deleteBy(deleteBy);
      },
    });
  }

  @CaptureSpan()
  public override async hardDeleteBy(
    deleteBy: DeleteBy<Model>,
  ): Promise<number> {
    if (deleteBy.props.ignoreHooks) {
      return await super.hardDeleteBy(deleteBy);
    }

    /*
     * The generic retention cron intentionally queries every tenant at once
     * by deletedAt. Resolve that open-ended query to a closed set of leaf IDs
     * before locking and deleting. Deleting leaves only means a limit can
     * never split a parent from a surviving child; the cron's next iteration
     * naturally works upward through the tree.
     */
    if (
      !NetworkSiteHierarchyLock.isSafeRootMutationScope({
        query: deleteBy.query as unknown as Record<string, unknown>,
        props: deleteBy.props,
        tenantScopeIsClosed: true,
      })
    ) {
      return await this.hardDeleteClosedLeafBatch(deleteBy);
    }

    const projectIds: Array<ObjectID | string> =
      await this.findMutationProjectIds({
        query: deleteBy.query,
        props: deleteBy.props,
        limit: this.positiveNumberValue(deleteBy.limit, LIMIT_MAX),
        skip: this.positiveNumberValue(deleteBy.skip, 0),
        isDelete: true,
      });

    return await NetworkSiteHierarchyLock.runExclusive({
      projectIds,
      operation: async (): Promise<number> => {
        return await super.hardDeleteBy(deleteBy);
      },
    });
  }

  private updateTouchesHierarchy(data: UpdateOneBy<Model>["data"]): boolean {
    const record: Record<string, unknown> = data as unknown as Record<
      string,
      unknown
    >;

    return (
      isRelationWritten(record, PARENT_SITE_KEYS) ||
      isRelationWritten(record, NETWORK_SITE_TYPE_KEYS) ||
      isRelationWritten(record, PROJECT_KEYS) ||
      isRelationWritten(record, MATERIALIZED_HIERARCHY_KEYS)
    );
  }

  private positiveNumberValue(
    value: PositiveNumber | number | undefined,
    fallback: number,
  ): number {
    if (value instanceof PositiveNumber) {
      return value.toNumber();
    }

    return value ?? fallback;
  }

  private async hardDeleteClosedLeafBatch(
    deleteBy: DeleteBy<Model>,
  ): Promise<number> {
    const requestedLimit: number = this.positiveNumberValue(
      deleteBy.limit,
      LIMIT_MAX,
    );

    if (requestedLimit <= 0) {
      return 0;
    }

    const scanPageSize: number = Math.min(
      DIRECT_CHILD_TYPE_VALIDATION_PAGE_SIZE,
      requestedLimit,
    );
    const leafSites: Array<Model> = [];
    let scanSkip: number = this.positiveNumberValue(deleteBy.skip, 0);

    while (leafSites.length < requestedLimit) {
      const candidates: Array<Model> = await this.findBy({
        query: deleteBy.query,
        select: {
          _id: true,
          projectId: true,
        },
        sort: { _id: SortOrder.Ascending },
        limit: scanPageSize,
        skip: scanSkip,
        props: { isRoot: true },
      });

      if (candidates.length === 0) {
        break;
      }

      const candidateIds: Array<ObjectID> = candidates
        .map((candidate: Model): ObjectID | null => {
          return candidate.id || null;
        })
        .filter((id: ObjectID | null): id is ObjectID => {
          return Boolean(id);
        });
      const parentIdsWithChildren: Set<string> = new Set<string>();

      for (
        let parentOffset: number = 0;
        parentOffset < candidateIds.length;
        parentOffset += DIRECT_CHILD_TYPE_VALIDATION_PAGE_SIZE
      ) {
        const parentIdBatch: Array<ObjectID> = candidateIds.slice(
          parentOffset,
          parentOffset + DIRECT_CHILD_TYPE_VALIDATION_PAGE_SIZE,
        );
        let childSkip: number = 0;

        while (parentIdBatch.length > 0) {
          const children: Array<Model> = await this.findBy({
            query: {
              parentSiteId: QueryHelper.any(parentIdBatch),
            },
            select: { parentSiteId: true },
            sort: { _id: SortOrder.Ascending },
            limit: DIRECT_CHILD_TYPE_VALIDATION_PAGE_SIZE,
            skip: childSkip,
            props: { isRoot: true },
          });

          for (const child of children) {
            if (child.parentSiteId) {
              parentIdsWithChildren.add(normalizeId(child.parentSiteId));
            }
          }

          if (children.length < DIRECT_CHILD_TYPE_VALIDATION_PAGE_SIZE) {
            break;
          }

          childSkip += children.length;
        }
      }

      for (const candidate of candidates) {
        if (
          candidate.id &&
          candidate.projectId &&
          !parentIdsWithChildren.has(normalizeId(candidate.id))
        ) {
          leafSites.push(candidate);

          if (leafSites.length === requestedLimit) {
            break;
          }
        }
      }

      scanSkip += candidates.length;

      if (candidates.length < scanPageSize) {
        break;
      }
    }

    if (leafSites.length === 0) {
      return 0;
    }

    const leafIds: Array<ObjectID> = leafSites.map((site: Model): ObjectID => {
      return site.id!;
    });

    return await NetworkSiteHierarchyLock.runExclusive({
      projectIds: leafSites.map((site: Model): ObjectID => {
        return site.projectId!;
      }),
      operation: async (): Promise<number> => {
        return await super.hardDeleteBy({
          ...deleteBy,
          query: {
            ...deleteBy.query,
            _id: QueryHelper.any(leafIds),
          },
          limit: leafIds.length,
          skip: 0,
        });
      },
    });
  }

  private async findMutationProjectIds(data: {
    query: Query<Model>;
    props: DatabaseCommonInteractionProps;
    limit: number;
    skip: number;
    isDelete: boolean;
  }): Promise<Array<ObjectID | string>> {
    NetworkSiteHierarchyLock.assertSafeRootMutationScope({
      query: data.query as unknown as Record<string, unknown>,
      props: data.props,
      tenantScopeIsClosed: data.isDelete,
    });

    const sites: Array<Model> = await this.findBy({
      query: data.isDelete
        ? this.scopeDeleteQueryToCallerTenant(data.query, data.props)
        : this.scopeQueryToCallerTenant(data.query, data.props),
      select: { projectId: true },
      limit: data.limit,
      skip: data.skip,
      props: { isRoot: true },
    });

    const projectIds: Array<ObjectID | string> = sites
      .map((site: Model): ObjectID | undefined => {
        return site.projectId;
      })
      .filter((projectId: ObjectID | undefined): projectId is ObjectID => {
        return Boolean(projectId);
      });

    projectIds.push(
      ...NetworkSiteHierarchyLock.getExplicitProjectIds(
        data.query as unknown as Record<string, unknown>,
      ),
    );

    if (projectIds.length === 0 && data.props.tenantId) {
      projectIds.push(data.props.tenantId);
    }

    const seenProjectIds: Set<string> = new Set<string>();

    return projectIds.filter((projectId: ObjectID | string): boolean => {
      const normalizedProjectId: string = normalizeId(projectId);

      if (seenProjectIds.has(normalizedProjectId)) {
        return false;
      }

      seenProjectIds.add(normalizedProjectId);
      return true;
    });
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
    if (props.isRoot || props.isMasterAdmin || !props.tenantId) {
      return query;
    }

    return {
      ...query,
      projectId: props.tenantId,
    };
  }

  /*
   * Root deletes are also tenant-scoped by DeletePermission when tenantId is
   * present. Mirror that exact rule in the preflight read so limit/skip guard
   * the same rows the eventual delete can select.
   */
  private scopeDeleteQueryToCallerTenant(
    query: Query<Model>,
    props: DatabaseCommonInteractionProps,
  ): Query<Model> {
    if (!props.tenantId || props.isMultiTenantRequest) {
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
   * parent (nothing before it for a root). A legacy delete that nullified
   * parentSiteId, or a half-applied move, leaves the two disagreeing - and a
   * stale path silently corrupts every prefix query built from it, so treat
   * it as missing and let the caller rebuild.
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

  /*
   * Resolve a site type with tenant information and its configured direct
   * parent type. The lookup deliberately runs as root: hook validation occurs
   * before DatabaseService applies the caller's permission-scoped query, so
   * the service must see the referenced row and perform the project check
   * explicitly rather than confuse "foreign" with "missing".
   */
  private async getNetworkSiteTypeForHierarchy(
    networkSiteTypeId: ObjectID,
    cache: Map<string, NetworkSiteType>,
  ): Promise<NetworkSiteType> {
    const key: string = normalizeId(networkSiteTypeId);
    const cached: NetworkSiteType | undefined = cache.get(key);

    if (cached) {
      return cached;
    }

    const networkSiteType: NetworkSiteType | null =
      await NetworkSiteTypeService.findOneById({
        id: networkSiteTypeId,
        select: {
          _id: true,
          projectId: true,
          parentNetworkSiteTypeId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!networkSiteType) {
      throw new BadDataException("Network site type not found.");
    }

    cache.set(key, networkSiteType);
    return networkSiteType;
  }

  /*
   * Assert one proposed site edge against the type hierarchy. Untyped legacy
   * root rows remain readable/editable, but as soon as a site has a type its
   * placement is exact: a root type has no parent, and a non-root type has a
   * parent site whose type is precisely the configured direct parent type.
   */
  private async validateSiteTypeEdge(data: {
    networkSiteTypeId: ObjectID | null;
    parentSite: Model | null;
    projectId: ObjectID | undefined;
    typeCache: Map<string, NetworkSiteType>;
  }): Promise<void> {
    if (!data.networkSiteTypeId) {
      if (data.parentSite) {
        throw new BadDataException(
          "A network site with a parent must have a network site type.",
        );
      }

      return;
    }

    const networkSiteType: NetworkSiteType =
      await this.getNetworkSiteTypeForHierarchy(
        data.networkSiteTypeId,
        data.typeCache,
      );

    if (
      data.projectId &&
      networkSiteType.projectId &&
      !sameId(networkSiteType.projectId, data.projectId)
    ) {
      throw new BadDataException(
        "Network site type must belong to the same project.",
      );
    }

    const requiredParentTypeId: ObjectID | null =
      networkSiteType.parentNetworkSiteTypeId || null;

    if (!requiredParentTypeId) {
      if (data.parentSite) {
        throw new BadDataException(
          "A site with a root network site type cannot have a parent site.",
        );
      }

      return;
    }

    if (!data.parentSite) {
      throw new BadDataException(
        "This network site type requires a parent site.",
      );
    }

    if (
      !data.parentSite.networkSiteTypeId ||
      !sameId(data.parentSite.networkSiteTypeId, requiredParentTypeId)
    ) {
      throw new BadDataException(
        "Parent site must use the configured parent network site type.",
      );
    }
  }

  /*
   * Changing a site's type also changes what every direct child's type must
   * point at. Validate those reverse edges before the update so one edit
   * cannot strand a previously valid subtree.
   */
  private async validateDirectChildrenForTypeChange(data: {
    site: Model;
    proposedNetworkSiteTypeId: ObjectID | null;
    typeCache: Map<string, NetworkSiteType>;
  }): Promise<void> {
    if (!data.site.id || !data.site.projectId) {
      return;
    }

    const proposedParent: Model = {
      id: data.site.id,
      projectId: data.site.projectId,
      networkSiteTypeId: data.proposedNetworkSiteTypeId || undefined,
    } as Model;

    let skip: number = 0;

    while (true) {
      const children: Array<Model> = await this.findBy({
        query: {
          projectId: data.site.projectId,
          parentSiteId: data.site.id,
        },
        select: {
          _id: true,
          projectId: true,
          networkSiteTypeId: true,
        },
        sort: {
          _id: SortOrder.Ascending,
        },
        limit: DIRECT_CHILD_TYPE_VALIDATION_PAGE_SIZE,
        skip: skip,
        props: {
          isRoot: true,
        },
      });

      for (const child of children) {
        await this.validateSiteTypeEdge({
          networkSiteTypeId: child.networkSiteTypeId || null,
          parentSite: proposedParent,
          projectId: child.projectId || data.site.projectId,
          typeCache: data.typeCache,
        });
      }

      if (children.length < DIRECT_CHILD_TYPE_VALIDATION_PAGE_SIZE) {
        break;
      }

      skip += children.length;
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    let parentPath: string | null = null;
    let parentSite: Model | null = null;
    const rawData: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;
    const projectId: ObjectID | undefined =
      createBy.props.tenantId ||
      RelationIdUtil.readConsistent(
        rawData,
        ["projectId", "project"],
        "Project",
      ) ||
      undefined;

    /*
     * Both spellings: the dashboard's site form posts the `parentSite`
     * relation, not the `parentSiteId` column. See RelationIdUtil.
     */
    const parentSiteId: ObjectID | null = readStrictRelationId({
      payload: rawData,
      keys: PARENT_SITE_KEYS,
      relationTitle: "Parent Site",
    });
    const networkSiteTypeId: ObjectID | null = readStrictRelationId({
      payload: rawData,
      keys: NETWORK_SITE_TYPE_KEYS,
      relationTitle: "Network Site Type",
    });

    if (parentSiteId) {
      parentSite = await this.findOneById({
        id: parentSiteId,
        select: {
          _id: true,
          projectId: true,
          networkSiteTypeId: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!parentSite) {
        throw new BadDataException("Parent site not found.");
      }

      if (
        projectId &&
        parentSite.projectId &&
        !sameId(parentSite.projectId, projectId)
      ) {
        throw new BadDataException(
          "Parent site must belong to the same project.",
        );
      }
    }

    await this.validateSiteTypeEdge({
      networkSiteTypeId: networkSiteTypeId,
      parentSite: parentSite,
      projectId: projectId,
      typeCache: new Map<string, NetworkSiteType>(),
    });

    if (parentSiteId) {
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
    const rawData: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;
    const touchesParent: boolean = isRelationWritten(rawData, PARENT_SITE_KEYS);
    const touchesNetworkSiteType: boolean = isRelationWritten(
      rawData,
      NETWORK_SITE_TYPE_KEYS,
    );
    const touchesProject: boolean = isRelationWritten(rawData, PROJECT_KEYS);
    const touchesMaterializedHierarchy: boolean = isRelationWritten(
      rawData,
      MATERIALIZED_HIERARCHY_KEYS,
    );

    if (
      !touchesParent &&
      !touchesNetworkSiteType &&
      !touchesProject &&
      !touchesMaterializedHierarchy
    ) {
      return { updateBy, carryForward: null };
    }

    if (touchesMaterializedHierarchy) {
      throw new BadDataException(
        "materializedPath and depth are managed by the Network Site hierarchy and cannot be updated directly.",
      );
    }

    const proposedProjectId: ObjectID | null = touchesProject
      ? readStrictRelationId({
          payload: rawData,
          keys: PROJECT_KEYS,
          relationTitle: "Project",
        })
      : null;

    if (touchesProject && !proposedProjectId) {
      throw new BadDataException(
        "A Network Site cannot be moved to another project.",
      );
    }

    const newParentId: ObjectID | null = touchesParent
      ? readStrictRelationId({
          payload: rawData,
          keys: PARENT_SITE_KEYS,
          relationTitle: "Parent Site",
        })
      : null;
    const newNetworkSiteTypeId: ObjectID | null = touchesNetworkSiteType
      ? readStrictRelationId({
          payload: rawData,
          keys: NETWORK_SITE_TYPE_KEYS,
          relationTitle: "Network Site Type",
        })
      : null;
    const updateLimit: number =
      updateBy.limit instanceof PositiveNumber
        ? updateBy.limit.toNumber()
        : updateBy.limit || LIMIT_MAX;
    const updateSkip: number =
      updateBy.skip instanceof PositiveNumber
        ? updateBy.skip.toNumber()
        : updateBy.skip || 0;

    const previousItems: Array<Model> = await this.findBy({
      query: this.scopeQueryToCallerTenant(updateBy.query, updateBy.props),
      select: {
        _id: true,
        projectId: true,
        parentSiteId: true,
        networkSiteTypeId: true,
        materializedPath: true,
      },
      limit: updateLimit,
      skip: updateSkip,
      props: {
        isRoot: true,
      },
    });

    if (touchesProject) {
      for (const item of previousItems) {
        if (
          !item.projectId ||
          !proposedProjectId ||
          !sameId(item.projectId, proposedProjectId)
        ) {
          throw new BadDataException(
            "A Network Site cannot be moved to another project.",
          );
        }
      }
    }

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
          !sameId(item.projectId, updateBy.props.tenantId)
        ) {
          throw new BadDataException(
            "Network site must belong to the same project.",
          );
        }
      }
    }

    if (!touchesParent && !touchesNetworkSiteType) {
      return { updateBy, carryForward: null };
    }

    let newParentPath: string | null = null;
    let newParent: Model | null = null;

    if (touchesParent && newParentId) {
      newParent = await this.findOneById({
        id: newParentId,
        select: {
          _id: true,
          projectId: true,
          networkSiteTypeId: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!newParent) {
        throw new BadDataException("Parent site not found.");
      }

      for (const item of previousItems) {
        if (item.id && sameId(item.id, newParentId)) {
          throw new BadDataException("A site cannot be its own parent.");
        }

        if (
          item.projectId &&
          newParent.projectId &&
          !sameId(item.projectId, newParent.projectId)
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

    const typeCache: Map<string, NetworkSiteType> = new Map();
    const existingParents: Map<string, Model> = new Map();

    for (const item of previousItems) {
      let proposedParent: Model | null = null;

      if (touchesParent) {
        proposedParent = newParent;
      } else if (item.parentSiteId) {
        const currentParentId: string = normalizeId(item.parentSiteId);
        proposedParent = existingParents.get(currentParentId) || null;

        if (!proposedParent) {
          proposedParent = await this.findOneById({
            id: item.parentSiteId,
            select: {
              _id: true,
              projectId: true,
              networkSiteTypeId: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (!proposedParent) {
            throw new BadDataException("Parent site not found.");
          }

          existingParents.set(currentParentId, proposedParent);
        }

        if (
          item.projectId &&
          proposedParent.projectId &&
          !sameId(item.projectId, proposedParent.projectId)
        ) {
          throw new BadDataException(
            "Parent site must belong to the same project.",
          );
        }
      }

      const proposedNetworkSiteTypeId: ObjectID | null = touchesNetworkSiteType
        ? newNetworkSiteTypeId
        : item.networkSiteTypeId || null;

      await this.validateSiteTypeEdge({
        networkSiteTypeId: proposedNetworkSiteTypeId,
        parentSite: proposedParent,
        projectId: item.projectId,
        typeCache: typeCache,
      });

      const previousNetworkSiteTypeId: string | null = item.networkSiteTypeId
        ? normalizeId(item.networkSiteTypeId)
        : null;
      const proposedNetworkSiteTypeIdString: string | null =
        proposedNetworkSiteTypeId
          ? normalizeId(proposedNetworkSiteTypeId)
          : null;

      if (
        touchesNetworkSiteType &&
        previousNetworkSiteTypeId !== proposedNetworkSiteTypeIdString
      ) {
        await this.validateDirectChildrenForTypeChange({
          site: item,
          proposedNetworkSiteTypeId: proposedNetworkSiteTypeId,
          typeCache: typeCache,
        });
      }
    }

    if (!touchesParent) {
      return { updateBy, carryForward: null };
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
    /*
     * Editing the rollup POLICY (or its threshold) changes what the site's
     * existing devices add up to, without touching a device or the tree. The
     * five-minute stale sweep would eventually notice, but a settings page
     * that leaves the status it just changed reading the old value for
     * minutes looks broken, so re-roll immediately. Failures are swallowed:
     * the sweep is still the backstop, and a rollup must not fail the save.
     */
    const policyKeys: Array<string> = [
      "healthRollupPolicy",
      "offlineThresholdPercent",
    ];
    const touchesPolicy: boolean = policyKeys.some((key: string): boolean => {
      return (
        (onUpdate.updateBy.data as Record<string, unknown>)[key] !== undefined
      );
    });

    if (touchesPolicy) {
      for (const siteId of updatedItemIds) {
        try {
          await this.recomputeRollupForSite(siteId);
        } catch (error) {
          logger.error(
            `NetworkSiteService.onUpdateSuccess: rollup after a policy change failed for site ${siteId.toString()}: ${error}`,
            {
              siteId: siteId.toString(),
            } as LogAttributes,
          );
        }
      }
    }

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

    /*
     * A bulk update can include both an ancestor and one of its descendants.
     * Move the deepest roots first; otherwise rebasing the ancestor changes
     * the descendant branch away from the latter's old prefix before its own
     * subtree has been processed.
     */
    const previousItemsDeepestFirst: Array<Model> = [
      ...parentChange.previousItems,
    ].sort((left: Model, right: Model): number => {
      return (
        MaterializedPathUtil.segmentsOf(right.materializedPath).length -
        MaterializedPathUtil.segmentsOf(left.materializedPath).length
      );
    });

    for (const previousItem of previousItemsDeepestFirst) {
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
        while (true) {
          const descendants: Array<Model> = await this.findBy({
            query: {
              projectId: previousItem.projectId!,
              materializedPath: this.pathStartsWith(oldPath),
            },
            select: {
              _id: true,
              materializedPath: true,
            },
            sort: {
              _id: SortOrder.Ascending,
            },
            limit: SUBTREE_REBASE_PAGE_SIZE,
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

          if (descendants.length < SUBTREE_REBASE_PAGE_SIZE) {
            break;
          }
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
    const deleteLimit: number =
      deleteBy.limit instanceof PositiveNumber
        ? deleteBy.limit.toNumber()
        : deleteBy.limit || LIMIT_MAX;
    const deleteSkip: number =
      deleteBy.skip instanceof PositiveNumber
        ? deleteBy.skip.toNumber()
        : deleteBy.skip || 0;

    const sitesToDelete: Array<Model> = await this.findBy({
      query: this.scopeDeleteQueryToCallerTenant(
        deleteBy.query,
        deleteBy.props,
      ),
      select: {
        _id: true,
        projectId: true,
        parentSiteId: true,
        materializedPath: true,
      },
      limit: deleteLimit,
      skip: deleteSkip,
      props: {
        isRoot: true,
      },
    });

    const deletingSiteIds: Set<string> = new Set(
      sitesToDelete
        .map((site: Model): string | null => {
          return site.id ? normalizeId(site.id) : null;
        })
        .filter((siteId: string | null): siteId is string => {
          return Boolean(siteId);
        }),
    );

    const deletingSiteIdList: Array<string> = Array.from(deletingSiteIds);
    const deletingProjectIdList: Array<string> = Array.from(
      new Set(
        sitesToDelete
          .map((site: Model): string | null => {
            return site.projectId ? normalizeId(site.projectId) : null;
          })
          .filter((projectId: string | null): projectId is string => {
            return Boolean(projectId);
          }),
      ),
    );

    /*
     * A valid child type explicitly names the deleted site's type as its
     * required direct parent type. Legacy SET NULL/orphan-repair behaviour
     * therefore cannot produce a valid edge: promoting the child to root or
     * attaching it to the grandparent both violate its type. Reject the
     * delete unless every direct child is part of this same bulk delete.
     *
     * Parent ids and result rows are both batched so neither a wide delete nor
     * a wide site is silently truncated at a service query limit.
     */
    for (
      let parentIdOffset: number = 0;
      parentIdOffset < deletingSiteIdList.length;
      parentIdOffset += DIRECT_CHILD_TYPE_VALIDATION_PAGE_SIZE
    ) {
      const parentIdBatch: Array<string> = deletingSiteIdList.slice(
        parentIdOffset,
        parentIdOffset + DIRECT_CHILD_TYPE_VALIDATION_PAGE_SIZE,
      );
      let childSkip: number = 0;

      while (true) {
        const directChildren: Array<Model> = await this.findBy({
          query: {
            projectId: QueryHelper.any(deletingProjectIdList),
            parentSiteId: QueryHelper.any(parentIdBatch),
          },
          select: {
            _id: true,
            parentSiteId: true,
          },
          sort: {
            _id: SortOrder.Ascending,
          },
          limit: DIRECT_CHILD_TYPE_VALIDATION_PAGE_SIZE,
          skip: childSkip,
          props: {
            isRoot: true,
          },
        });

        const hasSurvivingChild: boolean = directChildren.some(
          (child: Model): boolean => {
            return !child.id || !deletingSiteIds.has(normalizeId(child.id));
          },
        );

        if (hasSurvivingChild) {
          throw new BadDataException(
            "A network site with child sites cannot be deleted. Move or delete its child sites first.",
          );
        }

        if (directChildren.length < DIRECT_CHILD_TYPE_VALIDATION_PAGE_SIZE) {
          break;
        }

        childSkip += directChildren.length;
      }
    }

    const carryForward: DeleteCarryForward = {
      sitesToDelete: sitesToDelete,
    };

    return { deleteBy, carryForward };
  }

  /*
   * New schemas use a non-nullifying foreign key and onBeforeDelete rejects
   * surviving children, so this repair is normally a no-op. Keep it as a
   * defensive bridge for a database that has not applied the FK migration
   * yet, or for a legacy write already in flight during an upgrade: reattach
   * any detached children and rebase their subtree paths so parentSiteId and
   * materializedPath agree.
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

    while (true) {
      const descendants: Array<Model> = await this.findBy({
        query: {
          projectId: deletedSite.projectId!,
          materializedPath: this.pathStartsWith(oldPath),
        },
        select: {
          _id: true,
          materializedPath: true,
        },
        sort: {
          _id: SortOrder.Ascending,
        },
        limit: SUBTREE_REBASE_PAGE_SIZE,
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

        const updateData: Record<string, unknown> = {
          materializedPath: rebasedPath!,
          depth: MaterializedPathUtil.depthOf(rebasedPath!),
        };

        // A direct child is the one the FK just detached - give it a parent back.
        if (tailSegments.length === 1) {
          updateData["parentSiteId"] = deletedSite.parentSiteId || null;
        }

        await this.updateColumnsByIdWithoutHooks({
          id: descendant.id,
          data: updateData as any,
        });
      }

      if (descendants.length < SUBTREE_REBASE_PAGE_SIZE) {
        break;
      }
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

    const suppressesDescendants: boolean =
      !isSiteUnderMaintenance && maintainedSiteIds.size > 0;

    const contributingSiteIds: Array<ObjectID> = suppressesDescendants
      ? subtreeSiteIds.filter((id: ObjectID) => {
          return !maintainedSiteIds.has(id.toString());
        })
      : subtreeSiteIds;

    /*
     * The suppressed part of THIS subtree. Their devices do not vote, but
     * they are still counted, because a share needs a denominator that does
     * not move when a window opens - see SiteStatusRollupUtil.
     * deviceHealthShare for what goes wrong otherwise.
     */
    const suppressedSiteIds: Array<ObjectID> = suppressesDescendants
      ? subtreeSiteIds.filter((id: ObjectID) => {
          return maintainedSiteIds.has(id.toString());
        })
      : [];

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

    /*
     * One extra aggregate, and only while a window is actually running: the
     * common path (no ongoing maintenance anywhere in the project) skips it
     * entirely. Classified below, once the status ladder is known.
     */
    const suppressedGroups: Array<DeviceHealthGroup> =
      suppressedSiteIds.length > 0
        ? await NetworkDeviceService.getHealthGroupsForSites({
            projectId: site.projectId,
            siteIds: suppressedSiteIds,
            now: now,
            props: {
              isRoot: true,
            },
          })
        : [];

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

    /*
     * The middle rung has to sit BELOW the offline rung, or the ladder is
     * upside down. A project is free to define a status that is neither
     * operational nor offline and give it a priority ABOVE its offline row
     * ("Critical", say, at priority 4 next to Offline at 3) — and then a
     * sub-threshold outage would stamp the WORSE status while crossing the
     * threshold stamped the milder one. Nothing stops a project doing that,
     * so the rollup has to.
     */
    if (
      degradedStatus &&
      offlineStatus &&
      degradedStatus.priority >= offlineStatus.priority
    ) {
      let milder: RollupStatusOption | null = null;
      for (const status of statuses) {
        if (
          !status.id ||
          typeof status.priority !== "number" ||
          status.isOperationalState ||
          status.isOfflineState ||
          status.priority >= offlineStatus.priority
        ) {
          continue;
        }
        if (!milder || status.priority > milder.priority) {
          milder = {
            monitorStatusId: status.id.toString(),
            priority: status.priority,
          };
        }
      }
      degradedStatus = milder;
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

    /*
     * Sized with SiteStatusRollupUtil's own rule, not by summing
     * `deviceCount`.
     *
     * A suppressed bucket of never-polled devices has a count like any
     * other, but the share deliberately drops never-reported devices from
     * BOTH sides of the fraction. Adding their raw count back as
     * "suppressed" would pad the denominator with devices nothing was ever
     * measuring — a region with 200 undiscovered devices under a window and
     * 6 of 10 real ones dark would read 2.9% and call itself Degraded while
     * more than half of everything that has ever answered is offline.
     */
    const suppressedDeviceCount: number =
      SiteStatusRollupUtil.reportingDeviceCount(
        suppressedGroups.map((group: DeviceHealthGroup) => {
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
        }),
        now,
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
      suppressedDeviceCount: suppressedDeviceCount,
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

    /*
     * Descendants of an attached site change verdict too, which is easy to
     * miss because the attached site itself does not. While the window runs,
     * a descendant D is maintained (coverage is inherited downward), so D
     * suppresses nothing of its own. The moment the window ends D stops
     * being maintained and starts suppressing ITS maintained descendants —
     * a different answer, from the same devices. Nested and overlapping
     * windows are ordinary on a franchise estate, so this is not a corner.
     */
    const subtreeIds: Set<string> = await this.getSubtreeSiteIds({
      siteIds: data.siteIds,
      projectId: data.projectId,
    });

    const roots: Array<ObjectID> = Array.from(subtreeIds).map(
      (id: string): ObjectID => {
        return new ObjectID(id);
      },
    );

    for (const siteId of roots) {
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
   * Called after a monitor's current status persists - from
   * MonitorStatusTimelineService.onCreateSuccess / onDeleteSuccess (the one
   * path every status change, probe-driven or manual, passes through) and
   * from MonitorService.refreshMonitorCurrentStatus when a repair moves the
   * id. Resolves which NetworkDevices these monitors report on, stamps those
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
   *
   * What gets stamped depends on how the device is monitored:
   *
   *   - every device gets currentMonitorStatusId, which the pill, the site
   *     rollup and the topology node read.
   *   - a MONITOR-BACKED device also gets isReachable, derived from the
   *     status row (`!isOfflineState`, the same offline-end reading
   *     DeviceReachabilityUtil uses). Nothing polls such a device, so the
   *     column is NULL forever otherwise - and the device list's summary
   *     tiles and its Status filter count and filter on isReachable in SQL,
   *     which is why a bound ping-only device sat under "Pending" there while
   *     its own pill said Up. The server keeps the two in sync so the list
   *     agrees with itself.
   *   - an SNMP device's isReachable is left alone: the walk owns it
   *     (NetworkInventoryUtil.updateFromWalk), and a Network Device monitor
   *     going Degraded must not overwrite what the probe actually found.
   *
   * The status row is read at most once per call, and only when at least one
   * collected device is monitor-backed, so an all-SNMP estate costs no extra
   * query.
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
              // Decides whether isReachable is stamped alongside the status.
              monitoringMethod: true,
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
            // Decides whether isReachable is stamped alongside the status.
            monitoringMethod: true,
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

      /*
       * Resolve the status row lazily - once, and only if a monitor-backed
       * device is in the set - because it is only needed to derive
       * isReachable, and the SNMP-only case must stay one query cheaper.
       *
       * `undefined` afterwards means "do not touch isReachable": either no
       * device needs it, or the row could not be found in this project (a
       * status deleted between the timeline write and this call, or one
       * from another tenant). The id is still stamped in that case so the
       * pill keeps moving; a stale reachability is the lesser harm next to
       * a device that stops reporting altogether.
       */
      const hasMonitorBackedDevice: boolean = devices.some(
        (device: NetworkDevice) => {
          return NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
            device.monitoringMethod,
          );
        },
      );

      let monitorBackedIsReachable: boolean | undefined = undefined;

      if (hasMonitorBackedDevice) {
        const status: MonitorStatus | null =
          await MonitorStatusService.findOneBy({
            query: {
              _id: data.monitorStatusId,
              projectId: data.projectId,
            },
            select: {
              _id: true,
              isOfflineState: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (status) {
          monitorBackedIsReachable = !status.isOfflineState;
        } else {
          logger.warn(
            `NetworkSiteService.onMonitorStatusChanged: monitor status ${data.monitorStatusId.toString()} was not found in project ${data.projectId.toString()}; stamping the status id on the bound network devices but leaving isReachable unchanged.`,
            {
              projectId: data.projectId.toString(),
              monitorStatusId: data.monitorStatusId.toString(),
            } as LogAttributes,
          );
        }
      }

      for (const device of devices) {
        if (!device.id) {
          continue;
        }

        const stamp: PartialEntity<NetworkDevice> = {
          currentMonitorStatusId: data.monitorStatusId,
        };

        /*
         * Only a monitor-backed device gets isReachable from here. The key
         * is left OUT of the payload for an SNMP device rather than set to
         * undefined, so the walk's verdict is provably untouched.
         */
        if (
          monitorBackedIsReachable !== undefined &&
          NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
            device.monitoringMethod,
          )
        ) {
          stamp.isReachable = monitorBackedIsReachable;
        }

        await NetworkDeviceService.updateColumnsByIdWithoutHooks({
          id: device.id,
          data: stamp,
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
