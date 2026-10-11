import CreateBy from "../Types/Database/CreateBy";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DeleteBy from "../Types/Database/DeleteBy";
import DeleteOneBy from "../Types/Database/DeleteOneBy";
import FindBy from "../Types/Database/FindBy";
import Select from "../Types/Database/Select";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import UpdateOneBy from "../Types/Database/UpdateOneBy";
import ProjectReferencesService from "./ProjectReferencesService";
import NetworkSiteService from "./NetworkSiteService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import NetworkSiteHierarchyLock from "../Utils/NetworkSite/NetworkSiteHierarchyLock";
import NetworkSiteLeafPurge, {
  LeafPurgeShape,
} from "../Utils/NetworkSite/NetworkSiteLeafPurge";
import Model from "../../Models/DatabaseModels/NetworkSiteType";
import NetworkSite from "../../Models/DatabaseModels/NetworkSite";
import NetworkSiteTypeHierarchyUtil from "../../Utils/NetworkSite/TypeHierarchyUtil";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../Types/Exception/BadDataException";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";

const PARENT_NETWORK_SITE_TYPE_KEYS: Array<string> = [
  "parentNetworkSiteTypeId",
  "parentNetworkSiteType",
];

const PROJECT_KEYS: Array<string> = ["projectId", "project"];

const EXISTING_SITES_WOULD_INVERT_MESSAGE: string =
  "This site type's parent cannot be changed because an existing site is already placed under a site that the move would push below it. Move that site first, then change the type.";

const REFERENCE_VALIDATION_BATCH_SIZE: number = 1000;

/*
 * What keeps a deleted site type from the retention purge: a child type that
 * names it as its parent, or a site that names it as its type, deleted or
 * not. Those foreign keys (parentNetworkSiteTypeId and
 * NetworkSite.networkSiteTypeId, NO ACTION) would refuse the DELETE. See
 * NetworkSiteLeafPurge. NetworkSitePurgePostgres holds this list to the
 * migrated foreign keys.
 */
export const SITE_TYPE_PURGE_SHAPE: LeafPurgeShape = {
  rowsName: "network site types",
  parentColumn: "parentNetworkSiteTypeId",
  namedBy: [
    { table: "NetworkSiteType", column: "parentNetworkSiteTypeId" },
    { table: "NetworkSite", column: "networkSiteTypeId" },
  ],
};

const normalizeId: (id: ObjectID | string) => string = (
  id: ObjectID | string,
): string => {
  return id.toString().toLowerCase();
};

const sameId: (left: ObjectID | string, right: ObjectID | string) => boolean = (
  left: ObjectID | string,
  right: ObjectID | string,
): boolean => {
  return normalizeId(left) === normalizeId(right);
};

/*
 * Model instances contain properties initialised to undefined. Those are
 * omissions, not writes: TypeORM drops them before producing INSERT/SET.
 * Null, on the other hand, is an explicit request to make this a root type.
 */
const isAnyKeyWritten: (
  data: Record<string, unknown>,
  keys: Array<string>,
) => boolean = (
  data: Record<string, unknown>,
  keys: Array<string>,
): boolean => {
  return keys.some((key: string) => {
    return key in data && data[key] !== undefined;
  });
};

const assertNoSqlExpression: (
  data: Record<string, unknown>,
  keys: Array<string>,
) => void = (data: Record<string, unknown>, keys: Array<string>): void => {
  for (const key of keys) {
    if (typeof data[key] === "function") {
      throw new BadDataException(
        `${key} cannot be set to a raw SQL expression because the site type hierarchy must be validated against an actual parent ID.`,
      );
    }
  }
};

const assertIsUnitLevelIsNotSqlExpression: (
  data: Record<string, unknown>,
) => void = (data: Record<string, unknown>): void => {
  if (typeof data["isUnitLevel"] === "function") {
    throw new BadDataException(
      "isUnitLevel cannot be set to a raw SQL expression because unit-level leaf rules must be validated against an actual boolean value.",
    );
  }
};

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * NetworkSite and NetworkSiteType validate one shared graph. Keep the Redis
   * mutex around the complete DatabaseService mutation (before hooks, write,
   * and success hooks), not inside an individual hook, so every error path
   * releases it and a concurrent site/type request cannot validate stale
   * project state.
   */
  @CaptureSpan()
  public override async create(createBy: CreateBy<Model>): Promise<Model> {
    if (createBy.props.ignoreHooks) {
      return await super.create(createBy);
    }

    const projectId: ObjectID | null =
      createBy.props.tenantId ||
      this.readProjectId(createBy.data as unknown as Record<string, unknown>) ||
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
     * The retention cron uses one root deletedAt query across all projects.
     * Convert it to a closed batch of unused types - leaves, or a whole
     * closed cycle - before locking (hardDeleteClosedLeafBatch). A parent and
     * child can therefore never be split by the batch limit; once leaves are
     * removed, the cron's next iteration can work upward.
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
        withDeleted: true,
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
      isAnyKeyWritten(record, PARENT_NETWORK_SITE_TYPE_KEYS) ||
      ("isUnitLevel" in record && record["isUnitLevel"] !== undefined) ||
      isAnyKeyWritten(record, PROJECT_KEYS)
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

  /*
   * The retention cron's purge (HardDeleteItemsInDatabase): the site types
   * deleted more than 30 days ago, in every project. NetworkSiteLeafPurge
   * chooses them - the types no child type and no site row names, deleted or
   * not, or else a cycle of deleted types nothing outside it names - and this
   * deletes exactly the types it chose, by their ids, as the purge's own
   * delete. The cron purges sites first, so a type whose last deleted site
   * goes is purged the same day.
   */
  private async hardDeleteClosedLeafBatch(
    deleteBy: DeleteBy<Model>,
  ): Promise<number> {
    return await NetworkSiteLeafPurge.purgeBatch<Model>({
      shape: SITE_TYPE_PURGE_SHAPE,
      due: deleteBy.query,
      limit: this.positiveNumberValue(deleteBy.limit, LIMIT_MAX),
      skip: this.positiveNumberValue(deleteBy.skip, 0),
      read: async (findBy: FindBy<Model>): Promise<Array<Model>> => {
        return await this.findByWithDeleted(findBy);
      },
      hardDeleteByIds: async (ids: Array<ObjectID>): Promise<number> => {
        return await super.hardDeleteBy({
          ...deleteBy,
          query: {
            ...deleteBy.query,
            _id: QueryHelper.any(ids),
          },
          limit: ids.length,
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
    // A hard delete's read: rows deleted before count too.
    withDeleted?: boolean | undefined;
  }): Promise<Array<ObjectID | string>> {
    NetworkSiteHierarchyLock.assertSafeRootMutationScope({
      query: data.query as unknown as Record<string, unknown>,
      props: data.props,
      tenantScopeIsClosed: data.isDelete,
    });

    const findBy: FindBy<Model> = {
      query: data.isDelete
        ? this.scopeDeleteQueryToCallerTenant(data.query, data.props)
        : this.scopeQueryToCallerTenant(data.query, data.props),
      select: { projectId: true },
      limit: data.limit,
      skip: data.skip,
      props: { isRoot: true },
    };

    /*
     * A hard delete removes rows deleted before too, and its hook reads
     * them (findRowsAndHoldDeleteToThem): the projects it locks are read
     * the same way, so they are the projects of the rows it removes.
     */
    const networkSiteTypes: Array<Model> = data.withDeleted
      ? await this.findByWithDeleted(findBy)
      : await this.findBy(findBy);

    const projectIds: Array<ObjectID | string> = networkSiteTypes
      .map((networkSiteType: Model): ObjectID | undefined => {
        return networkSiteType.projectId;
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
   * DeletePermission retains tenant scoping for root callers that provide a
   * tenantId. The hierarchy preflight must select the identical window.
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

  private readProjectId(data: Record<string, unknown>): ObjectID | null {
    for (const key of PROJECT_KEYS) {
      const value: unknown = data[key];
      const isExplicitClear: boolean = value === null || value === "";

      if (typeof value === "function") {
        throw new BadDataException(
          `${key} cannot be set to a raw SQL expression because the Network Site Type project must be validated against an actual ID.`,
        );
      }

      if (
        value !== undefined &&
        !isExplicitClear &&
        !RelationIdUtil.read(data, [key])
      ) {
        throw new BadDataException(`${key} must contain a valid Project ID.`);
      }
    }

    return RelationIdUtil.readConsistent(data, PROJECT_KEYS, "project");
  }

  /*
   * Dashboard entity pickers submit the relation object; services and
   * migrations usually submit the scalar FK. Validate both, and refuse a
   * contradictory pair rather than relying on ORM precedence for the shared
   * join column.
   */
  private readParentId(data: Record<string, unknown>): ObjectID | null {
    assertNoSqlExpression(data, PARENT_NETWORK_SITE_TYPE_KEYS);

    for (const key of PARENT_NETWORK_SITE_TYPE_KEYS) {
      const value: unknown = data[key];
      const isExplicitClear: boolean = value === null || value === "";

      if (
        value !== undefined &&
        !isExplicitClear &&
        !RelationIdUtil.read(data, [key])
      ) {
        throw new BadDataException(
          `${key} must contain a valid Network Site Type ID.`,
        );
      }
    }

    return RelationIdUtil.readConsistent(
      data,
      PARENT_NETWORK_SITE_TYPE_KEYS,
      "parent Network Site Type",
    );
  }

  private async getNextSiblingOrder(data: {
    projectId: ObjectID;
    parentNetworkSiteTypeId: ObjectID | null;
  }): Promise<number> {
    const siblings: Array<Model> = await this.findAllNetworkSiteTypes({
      query: {
        projectId: data.projectId,
        parentNetworkSiteTypeId: data.parentNetworkSiteTypeId
          ? data.parentNetworkSiteTypeId
          : QueryHelper.isNull(),
      } as Query<Model>,
      select: { order: true },
    });

    const maxOrder: number | null = siblings.reduce<number | null>(
      (currentMax: number | null, sibling: Model) => {
        return typeof sibling.order === "number"
          ? Math.max(currentMax ?? sibling.order, sibling.order)
          : currentMax;
      },
      null,
    );

    return maxOrder === null ? 1 : maxOrder + 1;
  }

  private async findAllNetworkSiteTypes(data: {
    query: Query<Model>;
    select: Select<Model>;
  }): Promise<Array<Model>> {
    const networkSiteTypes: Array<Model> = [];
    let skip: number = 0;

    while (true) {
      const page: Array<Model> = await this.findBy({
        query: data.query,
        select: data.select,
        sort: { _id: SortOrder.Ascending },
        limit: LIMIT_MAX,
        skip,
        props: { isRoot: true },
      });

      networkSiteTypes.push(...page);

      if (page.length < LIMIT_MAX) {
        return networkSiteTypes;
      }

      skip += page.length;
    }
  }

  /*
   * Network estates regularly exceed LIMIT_MAX. Every hierarchy invariant is
   * universal ("all sites match"), so silently validating only the first page
   * would make its result depend on row order. A stable id sort also prevents
   * offset pages from overlapping while these read-only checks run.
   */
  private async findAllNetworkSites(data: {
    query: Query<NetworkSite>;
    select: Select<NetworkSite>;
  }): Promise<Array<NetworkSite>> {
    const sites: Array<NetworkSite> = [];
    let skip: number = 0;

    while (true) {
      const page: Array<NetworkSite> = await NetworkSiteService.findBy({
        query: data.query,
        select: data.select,
        sort: { _id: SortOrder.Ascending },
        limit: LIMIT_MAX,
        skip,
        props: { isRoot: true },
      });

      sites.push(...page);

      if (page.length < LIMIT_MAX) {
        return sites;
      }

      skip += page.length;
    }
  }

  private async assertParentIsValid(data: {
    networkSiteTypeId: ObjectID | null;
    parentNetworkSiteTypeId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    if (
      data.networkSiteTypeId &&
      sameId(data.networkSiteTypeId, data.parentNetworkSiteTypeId)
    ) {
      throw new BadDataException(
        "A Network Site Type cannot be its own parent.",
      );
    }

    const parent: Model | null = await this.findOneById({
      id: data.parentNetworkSiteTypeId,
      select: {
        _id: true,
        projectId: true,
        isUnitLevel: true,
      },
      props: { isRoot: true },
    });

    /*
     * The hook's project check (ProjectReferencesService) has already
     * refused a parent that is not this project's. Should one get here all
     * the same, another project's type reads like one that does not exist.
     */
    if (
      !parent ||
      !parent.projectId ||
      !sameId(parent.projectId, data.projectId)
    ) {
      throw new BadDataException("Parent Network Site Type not found.");
    }

    if (parent.isUnitLevel === true) {
      throw new BadDataException(
        "A unit-level Network Site Type cannot have child types.",
      );
    }

    if (!data.networkSiteTypeId) {
      return;
    }

    const networkSiteTypes: Array<Model> = await this.findAllNetworkSiteTypes({
      query: { projectId: data.projectId },
      select: {
        _id: true,
        parentNetworkSiteTypeId: true,
      },
    });

    const movingType: Model = new Model();
    movingType.id = data.networkSiteTypeId;

    const parentIsDescendant: boolean =
      NetworkSiteTypeHierarchyUtil.getDescendantNetworkSiteTypes({
        networkSiteType: movingType,
        networkSiteTypes,
      }).some((descendant: Model) => {
        return Boolean(
          descendant.id && sameId(descendant.id, data.parentNetworkSiteTypeId),
        );
      });

    if (parentIsDescendant) {
      throw new BadDataException(
        "A Network Site Type cannot be moved under one of its descendants.",
      );
    }
  }

  /*
   * Changing a type's place in the catalog must not retroactively invert the
   * concrete site tree. Site placement itself is permissive — a site may sit
   * under any site whose type is not BELOW its own — so the rows at risk are
   * not the moved type's own sites.
   *
   * Moving type X from its old ancestor chain to a new one adds "sits above"
   * pairs (Z, Y) for exactly Z in newAncestors = chain(newParent) minus
   * chain(oldParent), and Y in movedSubtree = {X} + descendants(X): X keeps
   * its own subtree, so nothing below X changes relative to X. An existing
   * edge breaks only when its CHILD site is typed in newAncestors and its
   * PARENT site is typed in movedSubtree, because that edge would then place a
   * higher-level site beneath a lower-level one.
   *
   * Two corollaries fall straight out and are worth knowing when reading the
   * early returns: clearing a type's parent has an empty newAncestors, so it
   * can never break anything; and moving a type DEEPER along the chain it is
   * already under only adds ancestors the sites already had.
   */
  private async assertExistingSitesWouldNotInvert(data: {
    networkSiteTypeId: ObjectID;
    projectId: ObjectID;
    currentParentNetworkSiteTypeId: ObjectID | string | null;
    proposedParentNetworkSiteTypeId: ObjectID | null;
    networkSiteTypes: Array<Model>;
  }): Promise<void> {
    if (!data.proposedParentNetworkSiteTypeId) {
      return;
    }

    const chainOf: (startId: ObjectID | string | null) => Set<string> = (
      startId: ObjectID | string | null,
    ): Set<string> => {
      const chain: Set<string> = new Set<string>();

      if (!startId) {
        return chain;
      }

      const start: Model | undefined = data.networkSiteTypes.find(
        (networkSiteType: Model) => {
          return Boolean(
            networkSiteType.id && sameId(networkSiteType.id, startId),
          );
        },
      );

      chain.add(normalizeId(startId));

      if (!start) {
        return chain;
      }

      for (const ancestor of NetworkSiteTypeHierarchyUtil.getAncestorNetworkSiteTypes(
        {
          networkSiteType: start,
          networkSiteTypes: data.networkSiteTypes,
        },
      )) {
        if (ancestor.id) {
          chain.add(normalizeId(ancestor.id));
        }
      }

      return chain;
    };

    const oldChain: Set<string> = chainOf(data.currentParentNetworkSiteTypeId);
    const newAncestorIds: Array<string> = [
      ...chainOf(data.proposedParentNetworkSiteTypeId),
    ].filter((typeId: string) => {
      return !oldChain.has(typeId);
    });

    if (newAncestorIds.length === 0) {
      return;
    }

    const movingType: Model = new Model();
    movingType.id = data.networkSiteTypeId;

    const movedSubtreeTypeIds: Set<string> = new Set<string>([
      normalizeId(data.networkSiteTypeId),
    ]);
    for (const descendant of NetworkSiteTypeHierarchyUtil.getDescendantNetworkSiteTypes(
      {
        networkSiteType: movingType,
        networkSiteTypes: data.networkSiteTypes,
      },
    )) {
      if (descendant.id) {
        movedSubtreeTypeIds.add(normalizeId(descendant.id));
      }
    }

    /*
     * Only sites typed in the newly gained ancestor chain can break, and only
     * through the parent they already point at. Reading that narrow slice
     * rather than every site in the project is what keeps a settings save on a
     * large estate proportional to the move.
     */
    const sitesAtRisk: Array<NetworkSite> = [];

    for (
      let offset: number = 0;
      offset < newAncestorIds.length;
      offset += REFERENCE_VALIDATION_BATCH_SIZE
    ) {
      sitesAtRisk.push(
        ...(await this.findAllNetworkSites({
          query: {
            projectId: data.projectId,
            networkSiteTypeId: QueryHelper.any(
              newAncestorIds.slice(
                offset,
                offset + REFERENCE_VALIDATION_BATCH_SIZE,
              ),
            ),
          },
          select: {
            _id: true,
            parentSiteId: true,
          },
        })),
      );
    }

    const parentSiteIds: Array<string> = [
      ...new Set<string>(
        sitesAtRisk
          .map((site: NetworkSite): string | null => {
            return site.parentSiteId ? normalizeId(site.parentSiteId) : null;
          })
          .filter((parentSiteId: string | null): parentSiteId is string => {
            return Boolean(parentSiteId);
          }),
      ),
    ];

    if (parentSiteIds.length === 0) {
      return;
    }

    for (
      let offset: number = 0;
      offset < parentSiteIds.length;
      offset += REFERENCE_VALIDATION_BATCH_SIZE
    ) {
      const parentSites: Array<NetworkSite> = await this.findAllNetworkSites({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.any(
            parentSiteIds.slice(
              offset,
              offset + REFERENCE_VALIDATION_BATCH_SIZE,
            ),
          ),
        },
        select: {
          _id: true,
          networkSiteTypeId: true,
        },
      });

      for (const parentSite of parentSites) {
        if (
          parentSite.networkSiteTypeId &&
          movedSubtreeTypeIds.has(normalizeId(parentSite.networkSiteTypeId))
        ) {
          throw new BadDataException(EXISTING_SITES_WOULD_INVERT_MESSAGE);
        }
      }
    }
  }

  private async assertTypesCanBecomeUnitLevel(
    networkSiteTypes: Array<Model>,
  ): Promise<void> {
    const networkSiteTypeIds: Array<ObjectID> = networkSiteTypes
      .map((networkSiteType: Model) => {
        return networkSiteType.id;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return Boolean(id);
      });

    if (networkSiteTypeIds.length === 0) {
      return;
    }

    const projectIds: Array<string> = [
      ...new Set<string>(
        networkSiteTypes
          .map((networkSiteType: Model) => {
            return networkSiteType.projectId?.toString();
          })
          .filter((projectId: string | undefined): projectId is string => {
            return Boolean(projectId);
          }),
      ),
    ];

    const child: Model | null = await this.findOneBy({
      query: {
        parentNetworkSiteTypeId: QueryHelper.any(
          networkSiteTypeIds.map((id: ObjectID) => {
            return id.toString();
          }),
        ),
        ...(projectIds.length > 0
          ? { projectId: QueryHelper.any(projectIds) }
          : {}),
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (child) {
      throw new BadDataException(
        "A Network Site Type with child types cannot be made unit-level.",
      );
    }

    const sitesOfTypes: Array<NetworkSite> = await this.findAllNetworkSites({
      query: {
        networkSiteTypeId: QueryHelper.any(
          networkSiteTypeIds.map((id: ObjectID) => {
            return id.toString();
          }),
        ),
      },
      select: { _id: true },
    });

    const siteIds: Array<string> = sitesOfTypes
      .map((site: NetworkSite) => {
        return site.id?.toString();
      })
      .filter((id: string | undefined): id is string => {
        return Boolean(id);
      });

    if (siteIds.length === 0) {
      return;
    }

    for (
      let offset: number = 0;
      offset < siteIds.length;
      offset += REFERENCE_VALIDATION_BATCH_SIZE
    ) {
      const childSite: NetworkSite | null = await NetworkSiteService.findOneBy({
        query: {
          parentSiteId: QueryHelper.any(
            siteIds.slice(offset, offset + REFERENCE_VALIDATION_BATCH_SIZE),
          ),
          ...(projectIds.length > 0
            ? { projectId: QueryHelper.any(projectIds) }
            : {}),
        },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (childSite) {
        throw new BadDataException(
          "A Network Site Type whose sites have child sites cannot be made unit-level.",
        );
      }
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;
    assertIsUnitLevelIsNotSqlExpression(data);
    const parentNetworkSiteTypeId: ObjectID | null = this.readParentId(data);
    const projectId: ObjectID | null =
      createBy.props.tenantId || this.readProjectId(data) || null;

    if (!projectId) {
      throw new BadDataException("Project ID is required.");
    }

    if (parentNetworkSiteTypeId) {
      await this.assertParentIsValid({
        networkSiteTypeId: createBy.data.id,
        parentNetworkSiteTypeId,
        projectId,
      });
    }

    if (createBy.data.order === undefined || createBy.data.order === null) {
      createBy.data.order = await this.getNextSiblingOrder({
        projectId,
        parentNetworkSiteTypeId,
      });
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: Record<string, unknown> = (updateBy.data ||
      {}) as unknown as Record<string, unknown>;
    assertIsUnitLevelIsNotSqlExpression(data);
    const isParentWritten: boolean = isAnyKeyWritten(
      data,
      PARENT_NETWORK_SITE_TYPE_KEYS,
    );
    const isBecomingUnitLevel: boolean = data["isUnitLevel"] === true;
    const isProjectWritten: boolean = isAnyKeyWritten(data, PROJECT_KEYS);
    const proposedProjectId: ObjectID | null = isProjectWritten
      ? this.readProjectId(data)
      : null;

    if (!isParentWritten && !isBecomingUnitLevel && !isProjectWritten) {
      return { updateBy, carryForward: null };
    }

    if (isProjectWritten && !proposedProjectId) {
      throw new BadDataException(
        "A Network Site Type cannot be moved to another project.",
      );
    }

    const proposedParentNetworkSiteTypeId: ObjectID | null = isParentWritten
      ? this.readParentId(data)
      : null;

    const networkSiteTypesBeingUpdated: Array<Model> =
      await this.findRowsAndHoldUpdateToThem(updateBy, {
        _id: true,
        projectId: true,
        parentNetworkSiteTypeId: true,
        isUnitLevel: true,
      });

    if (isProjectWritten) {
      for (const networkSiteType of networkSiteTypesBeingUpdated) {
        if (
          !networkSiteType.projectId ||
          !proposedProjectId ||
          !sameId(networkSiteType.projectId, proposedProjectId)
        ) {
          throw new BadDataException(
            "A Network Site Type cannot be moved to another project.",
          );
        }
      }
    }

    if (!isParentWritten && !isBecomingUnitLevel) {
      return { updateBy, carryForward: null };
    }

    if (isBecomingUnitLevel) {
      await this.assertTypesCanBecomeUnitLevel(
        networkSiteTypesBeingUpdated.filter((networkSiteType: Model) => {
          return networkSiteType.isUnitLevel !== true;
        }),
      );
    }

    if (isParentWritten) {
      /*
       * The catalog is read once for the whole update: the inversion check
       * walks ancestors of the proposed parent and descendants of the moving
       * type, and a bulk move would otherwise re-read the same rows per item.
       * Clearing a parent cannot invert anything, so nothing is read for it.
       */
      const networkSiteTypesByProjectId: Map<string, Array<Model>> = new Map<
        string,
        Array<Model>
      >();

      for (const networkSiteType of networkSiteTypesBeingUpdated) {
        if (!networkSiteType.id || !networkSiteType.projectId) {
          continue;
        }

        if (proposedParentNetworkSiteTypeId) {
          await this.assertParentIsValid({
            networkSiteTypeId: networkSiteType.id,
            parentNetworkSiteTypeId: proposedParentNetworkSiteTypeId,
            projectId: networkSiteType.projectId,
          });
        }

        const currentParentId: string | null =
          NetworkSiteTypeHierarchyUtil.getParentId(networkSiteType);
        const parentChanged: boolean = proposedParentNetworkSiteTypeId
          ? !currentParentId ||
            !sameId(currentParentId, proposedParentNetworkSiteTypeId)
          : Boolean(currentParentId);

        if (parentChanged) {
          if (proposedParentNetworkSiteTypeId) {
            const projectKey: string = normalizeId(networkSiteType.projectId);
            let projectNetworkSiteTypes: Array<Model> | undefined =
              networkSiteTypesByProjectId.get(projectKey);

            if (!projectNetworkSiteTypes) {
              projectNetworkSiteTypes = await this.findAllNetworkSiteTypes({
                query: { projectId: networkSiteType.projectId },
                select: {
                  _id: true,
                  parentNetworkSiteTypeId: true,
                },
              });
              networkSiteTypesByProjectId.set(
                projectKey,
                projectNetworkSiteTypes,
              );
            }

            await this.assertExistingSitesWouldNotInvert({
              networkSiteTypeId: networkSiteType.id,
              projectId: networkSiteType.projectId,
              currentParentNetworkSiteTypeId: currentParentId,
              proposedParentNetworkSiteTypeId,
              networkSiteTypes: projectNetworkSiteTypes,
            });
          }

          if (
            networkSiteTypesBeingUpdated.length === 1 &&
            data["order"] === undefined
          ) {
            updateBy.data.order = await this.getNextSiblingOrder({
              projectId: networkSiteType.projectId,
              parentNetworkSiteTypeId: proposedParentNetworkSiteTypeId,
            });
          }
        }
      }
    }

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // The types the delete removes, and the delete held to them.
    const networkSiteTypesBeingDeleted: Array<Model> =
      await this.findRowsAndHoldDeleteToThem(deleteBy, {
        _id: true,
        projectId: true,
      });

    const ids: Array<ObjectID> = networkSiteTypesBeingDeleted
      .map((networkSiteType: Model) => {
        return networkSiteType.id;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return Boolean(id);
      });

    if (ids.length === 0) {
      return { deleteBy, carryForward: null };
    }

    const idStrings: Array<string> = ids.map((id: ObjectID) => {
      return id.toString();
    });

    const deletingIds: Set<string> = new Set<string>(
      idStrings.map((id: string) => {
        return normalizeId(id);
      }),
    );
    const projectIdStrings: Array<string> = [
      ...new Set<string>(
        networkSiteTypesBeingDeleted
          .map((networkSiteType: Model) => {
            return networkSiteType.projectId?.toString();
          })
          .filter((projectId: string | undefined): projectId is string => {
            return Boolean(projectId);
          }),
      ),
    ];

    for (
      let parentOffset: number = 0;
      parentOffset < idStrings.length;
      parentOffset += REFERENCE_VALIDATION_BATCH_SIZE
    ) {
      const parentIdBatch: Array<string> = idStrings.slice(
        parentOffset,
        parentOffset + REFERENCE_VALIDATION_BATCH_SIZE,
      );
      let childSkip: number = 0;

      /*
       * Child types and sites deleted before count too: their rows still
       * name this type, and the foreign keys (NO ACTION) would refuse the
       * DELETE anyway, with the database's generic "records still reference
       * it" message. Refusing here gives the answer a live row gets, and
       * counts the same rows as the retention purge's choice
       * (NetworkSiteLeafPurge). A child type the same delete removes holds
       * nothing, so a closed cycle the purge removes in one delete goes whole.
       */
      while (true) {
        const childTypes: Array<Model> = await this.findByWithDeleted({
          query: {
            parentNetworkSiteTypeId: QueryHelper.any(parentIdBatch),
            ...(projectIdStrings.length > 0
              ? { projectId: QueryHelper.any(projectIdStrings) }
              : {}),
          },
          select: { _id: true },
          sort: { _id: SortOrder.Ascending },
          limit: REFERENCE_VALIDATION_BATCH_SIZE,
          skip: childSkip,
          props: { isRoot: true },
        });

        const hasSurvivingChild: boolean = childTypes.some((child: Model) => {
          return !child.id || !deletingIds.has(normalizeId(child.id));
        });

        if (hasSurvivingChild) {
          throw new BadDataException(
            "A Network Site Type cannot be deleted while child types use it as their parent.",
          );
        }

        if (childTypes.length < REFERENCE_VALIDATION_BATCH_SIZE) {
          break;
        }

        childSkip += childTypes.length;
      }

      const typeIdsNamedBySites: Set<string> =
        await NetworkSiteService.findSiteTypeIdsNamedBySites(parentIdBatch);

      if (typeIdsNamedBySites.size > 0) {
        throw new BadDataException(
          "A Network Site Type cannot be deleted while Network Sites use it.",
        );
      }
    }

    return { deleteBy, carryForward: null };
  }
}

export default new Service();
