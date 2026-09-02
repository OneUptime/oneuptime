import CreateBy from "../Types/Database/CreateBy";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DeleteBy from "../Types/Database/DeleteBy";
import DeleteOneBy from "../Types/Database/DeleteOneBy";
import Select from "../Types/Database/Select";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import UpdateOneBy from "../Types/Database/UpdateOneBy";
import DatabaseService from "./DatabaseService";
import NetworkSiteService from "./NetworkSiteService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import NetworkSiteHierarchyLock from "../Utils/NetworkSite/NetworkSiteHierarchyLock";
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

const EXISTING_SITES_DO_NOT_MATCH_MESSAGE: string =
  "This site type's parent cannot be changed because existing sites do not match the proposed hierarchy. Create a new site type under the desired parent, then move and reassign the sites to it.";

const REFERENCE_VALIDATION_BATCH_SIZE: number = 1000;

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

export class Service extends DatabaseService<Model> {
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
     * Convert it to a closed batch of unused leaf types before locking. A
     * parent and child can therefore never be split by the batch limit; once
     * leaves are removed, the cron's next iteration can work upward.
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
      REFERENCE_VALIDATION_BATCH_SIZE,
      requestedLimit,
    );
    const leafTypes: Array<Model> = [];
    let scanSkip: number = this.positiveNumberValue(deleteBy.skip, 0);

    while (leafTypes.length < requestedLimit) {
      const candidates: Array<Model> = await this.findBy({
        query: deleteBy.query,
        select: { _id: true, projectId: true },
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
      const referencedTypeIds: Set<string> = new Set<string>();

      for (
        let candidateOffset: number = 0;
        candidateOffset < candidateIds.length;
        candidateOffset += REFERENCE_VALIDATION_BATCH_SIZE
      ) {
        const candidateIdBatch: Array<ObjectID> = candidateIds.slice(
          candidateOffset,
          candidateOffset + REFERENCE_VALIDATION_BATCH_SIZE,
        );
        let childSkip: number = 0;

        while (candidateIdBatch.length > 0) {
          const childTypes: Array<Model> = await this.findBy({
            query: {
              parentNetworkSiteTypeId: QueryHelper.any(candidateIdBatch),
            },
            select: { parentNetworkSiteTypeId: true },
            sort: { _id: SortOrder.Ascending },
            limit: REFERENCE_VALIDATION_BATCH_SIZE,
            skip: childSkip,
            props: { isRoot: true },
          });

          for (const childType of childTypes) {
            if (childType.parentNetworkSiteTypeId) {
              referencedTypeIds.add(
                normalizeId(childType.parentNetworkSiteTypeId),
              );
            }
          }

          if (childTypes.length < REFERENCE_VALIDATION_BATCH_SIZE) {
            break;
          }

          childSkip += childTypes.length;
        }

        let siteSkip: number = 0;

        while (candidateIdBatch.length > 0) {
          const sites: Array<NetworkSite> = await NetworkSiteService.findBy({
            query: {
              networkSiteTypeId: QueryHelper.any(candidateIdBatch),
            },
            select: { networkSiteTypeId: true },
            sort: { _id: SortOrder.Ascending },
            limit: REFERENCE_VALIDATION_BATCH_SIZE,
            skip: siteSkip,
            props: { isRoot: true },
          });

          for (const site of sites) {
            if (site.networkSiteTypeId) {
              referencedTypeIds.add(normalizeId(site.networkSiteTypeId));
            }
          }

          if (sites.length < REFERENCE_VALIDATION_BATCH_SIZE) {
            break;
          }

          siteSkip += sites.length;
        }
      }

      for (const candidate of candidates) {
        if (
          candidate.id &&
          candidate.projectId &&
          !referencedTypeIds.has(normalizeId(candidate.id))
        ) {
          leafTypes.push(candidate);

          if (leafTypes.length === requestedLimit) {
            break;
          }
        }
      }

      scanSkip += candidates.length;

      if (candidates.length < scanPageSize) {
        break;
      }
    }

    if (leafTypes.length === 0) {
      return 0;
    }

    const leafTypeIds: Array<ObjectID> = leafTypes.map(
      (networkSiteType: Model): ObjectID => {
        return networkSiteType.id!;
      },
    );

    return await NetworkSiteHierarchyLock.runExclusive({
      projectIds: leafTypes.map((networkSiteType: Model): ObjectID => {
        return networkSiteType.projectId!;
      }),
      operation: async (): Promise<number> => {
        return await super.hardDeleteBy({
          ...deleteBy,
          query: {
            ...deleteBy.query,
            _id: QueryHelper.any(leafTypeIds),
          },
          limit: leafTypeIds.length,
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

    const networkSiteTypes: Array<Model> = await this.findBy({
      query: data.isDelete
        ? this.scopeDeleteQueryToCallerTenant(data.query, data.props)
        : this.scopeQueryToCallerTenant(data.query, data.props),
      select: { projectId: true },
      limit: data.limit,
      skip: data.skip,
      props: { isRoot: true },
    });

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

    if (!parent) {
      throw new BadDataException("Parent Network Site Type not found.");
    }

    if (!parent.projectId || !sameId(parent.projectId, data.projectId)) {
      throw new BadDataException(
        "Parent Network Site Type must belong to the same project.",
      );
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
   * Changing a type definition must not retroactively make the concrete site
   * tree invalid. A root type may only describe root sites; a child type may
   * only describe sites whose actual parent has the declared parent type.
   */
  private async assertExistingSitesMatchProposedParent(data: {
    networkSiteTypeId: ObjectID;
    proposedParentNetworkSiteTypeId: ObjectID | null;
  }): Promise<void> {
    const sites: Array<NetworkSite> = await this.findAllNetworkSites({
      query: { networkSiteTypeId: data.networkSiteTypeId },
      select: {
        _id: true,
        parentSiteId: true,
      },
    });

    if (sites.length === 0) {
      return;
    }

    if (!data.proposedParentNetworkSiteTypeId) {
      if (
        sites.some((site: NetworkSite) => {
          return Boolean(site.parentSiteId);
        })
      ) {
        throw new BadDataException(EXISTING_SITES_DO_NOT_MATCH_MESSAGE);
      }

      return;
    }

    const parentSiteIds: Array<ObjectID> = [];
    const distinctParentSiteIds: Set<string> = new Set<string>();

    for (const site of sites) {
      if (!site.parentSiteId) {
        throw new BadDataException(EXISTING_SITES_DO_NOT_MATCH_MESSAGE);
      }

      const normalizedParentSiteId: string = normalizeId(site.parentSiteId);
      if (!distinctParentSiteIds.has(normalizedParentSiteId)) {
        distinctParentSiteIds.add(normalizedParentSiteId);
        parentSiteIds.push(site.parentSiteId);
      }
    }

    const parentSites: Array<NetworkSite> = [];

    for (
      let offset: number = 0;
      offset < parentSiteIds.length;
      offset += LIMIT_MAX
    ) {
      const parentSiteIdBatch: Array<ObjectID> = parentSiteIds.slice(
        offset,
        offset + LIMIT_MAX,
      );

      parentSites.push(
        ...(await this.findAllNetworkSites({
          query: {
            _id: QueryHelper.any(
              parentSiteIdBatch.map((parentSiteId: ObjectID) => {
                return parentSiteId.toString();
              }),
            ),
          },
          select: {
            _id: true,
            networkSiteTypeId: true,
          },
        })),
      );
    }

    const parentTypeBySiteId: Map<string, ObjectID> = new Map<
      string,
      ObjectID
    >();

    for (const parentSite of parentSites) {
      if (parentSite.id && parentSite.networkSiteTypeId) {
        parentTypeBySiteId.set(
          normalizeId(parentSite.id),
          parentSite.networkSiteTypeId,
        );
      }
    }

    const hasMismatch: boolean = parentSiteIds.some(
      (parentSiteId: ObjectID) => {
        const actualParentTypeId: ObjectID | undefined = parentTypeBySiteId.get(
          normalizeId(parentSiteId),
        );

        return (
          !actualParentTypeId ||
          !sameId(actualParentTypeId, data.proposedParentNetworkSiteTypeId!)
        );
      },
    );

    if (hasMismatch) {
      throw new BadDataException(EXISTING_SITES_DO_NOT_MATCH_MESSAGE);
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

    const updateLimit: number =
      updateBy.limit instanceof PositiveNumber
        ? updateBy.limit.toNumber()
        : updateBy.limit || LIMIT_MAX;
    const updateSkip: number =
      updateBy.skip instanceof PositiveNumber
        ? updateBy.skip.toNumber()
        : updateBy.skip || 0;

    const networkSiteTypesBeingUpdated: Array<Model> = await this.findBy({
      query: this.scopeQueryToCallerTenant(updateBy.query, updateBy.props),
      select: {
        _id: true,
        projectId: true,
        parentNetworkSiteTypeId: true,
        isUnitLevel: true,
      },
      limit: updateLimit,
      skip: updateSkip,
      props: { isRoot: true },
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
          await this.assertExistingSitesMatchProposedParent({
            networkSiteTypeId: networkSiteType.id,
            proposedParentNetworkSiteTypeId,
          });

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
    const deleteLimit: number =
      deleteBy.limit instanceof PositiveNumber
        ? deleteBy.limit.toNumber()
        : deleteBy.limit || LIMIT_MAX;
    const deleteSkip: number =
      deleteBy.skip instanceof PositiveNumber
        ? deleteBy.skip.toNumber()
        : deleteBy.skip || 0;

    const networkSiteTypesBeingDeleted: Array<Model> = await this.findBy({
      query: this.scopeDeleteQueryToCallerTenant(
        deleteBy.query,
        deleteBy.props,
      ),
      select: { _id: true, projectId: true },
      limit: deleteLimit,
      skip: deleteSkip,
      props: { isRoot: true },
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

      while (true) {
        const childTypes: Array<Model> = await this.findBy({
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

      const site: NetworkSite | null = await NetworkSiteService.findOneBy({
        query: {
          networkSiteTypeId: QueryHelper.any(parentIdBatch),
        },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (site) {
        throw new BadDataException(
          "A Network Site Type cannot be deleted while Network Sites use it.",
        );
      }
    }

    return { deleteBy, carryForward: null };
  }
}

export default new Service();
