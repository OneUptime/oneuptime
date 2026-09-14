import DataMigrationBase from "./DataMigrationBase";
import BackfillNetworkSiteTypes from "./BackfillNetworkSiteTypes";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import Project from "Common/Models/DatabaseModels/Project";
import NetworkSiteService from "Common/Server/Services/NetworkSiteService";
import NetworkSiteTypeService from "Common/Server/Services/NetworkSiteTypeService";
import ProjectService from "Common/Server/Services/ProjectService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import DefaultNetworkSiteType from "Common/Types/NetworkSite/DefaultNetworkSiteType";
import BadDataException from "Common/Types/Exception/BadDataException";
import {
  DefaultNetworkSiteTypeCreationOrder,
  DefaultNetworkSiteTypeParent,
} from "Common/Types/NetworkSite/DefaultNetworkSiteTypeHierarchy";
import ObjectID from "Common/Types/ObjectID";

interface SiteTypeObservation {
  parentTypeIds: Set<string>;
  sawRootSite: boolean;
  sawUnresolvedParent: boolean;
}

const normalize: (value: string) => string = (value: string): string => {
  return value.trim().toLowerCase();
};

const emptyObservation: () => SiteTypeObservation = (): SiteTypeObservation => {
  return {
    parentTypeIds: new Set<string>(),
    sawRootSite: false,
    sawUnresolvedParent: false,
  };
};

/*
 * NetworkSiteType originally represented hierarchy position with a numeric
 * `order`, while each concrete NetworkSite already stored its actual parent.
 * A number cannot faithfully describe branches, so the new model stores an
 * explicit parent type instead.
 *
 * For existing projects, the concrete site tree is the safest source of
 * truth. A type is linked only when every observed site agrees on one parent
 * type and none of those sites is a root. Conflicting legacy arrangements are
 * logged and left as top-level types for an administrator to resolve; silently
 * choosing one branch would make the other sites invalid. Unused seeded
 * defaults have no concrete evidence, so they receive the shared default
 * hierarchy used for new projects. Custom unused types remain top-level rather
 * than being guessed from their former display order.
 *
 * The migration is restartable: types that already have a parent are never
 * touched, and writing the same inferred/default edge twice has no effect.
 */
export default class BackfillNetworkSiteTypeParents extends DataMigrationBase {
  public constructor() {
    super("BackfillNetworkSiteTypeParents");
  }

  public override async migrate(): Promise<void> {
    /*
     * Existing installations may already have recorded the historical
     * BackfillNetworkSiteTypes migration even if its old one-page scan or
     * swallowed per-row failures left projects or sites incomplete. Invoke
     * its now-idempotent reconciliation explicitly under this NEW migration
     * name before deriving parent relationships. Fresh installations simply
     * perform a no-op second pass.
     */
    await new BackfillNetworkSiteTypes().reconcileIncompleteAssignments();

    let skip: number = 0;
    const failedProjectIds: Array<string> = [];

    while (true) {
      const projects: Array<Project> = await ProjectService.findBy({
        query: {},
        select: { _id: true },
        sort: { _id: SortOrder.Ascending },
        skip,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

      for (const project of projects) {
        if (!project.id) {
          continue;
        }

        try {
          await this.backfillProject(project.id);
        } catch (err) {
          failedProjectIds.push(project.id.toString());
          logger.error(
            `Failed to backfill Network Site Type parents for project ${project.id.toString()}:`,
          );
          logger.error(err);
        }
      }

      if (projects.length < LIMIT_MAX) {
        break;
      }

      skip += projects.length;
    }

    /*
     * The migration runner records success when migrate() returns. Transient
     * database/service failures therefore have to escape after the remaining
     * projects have been attempted; a retry is idempotent and skips the edges
     * already written. Deliberately ambiguous legacy layouts are not failures
     * and are handled by warnSkipped instead.
     */
    if (failedProjectIds.length > 0) {
      throw new Error(
        `Network Site Type parent backfill failed for ${failedProjectIds.length} project(s): ${failedProjectIds.join(", ")}.`,
      );
    }
  }

  private async backfillProject(projectId: ObjectID): Promise<void> {
    const networkSiteTypes: Array<NetworkSiteType> =
      await this.findAllNetworkSiteTypes(projectId);

    if (networkSiteTypes.length === 0) {
      return;
    }

    const typeById: Map<string, NetworkSiteType> = new Map<
      string,
      NetworkSiteType
    >();
    const typeByName: Map<string, NetworkSiteType> = new Map<
      string,
      NetworkSiteType
    >();

    for (const networkSiteType of networkSiteTypes) {
      if (!networkSiteType.id) {
        continue;
      }

      typeById.set(normalize(networkSiteType.id.toString()), networkSiteType);
      if (networkSiteType.name) {
        typeByName.set(normalize(networkSiteType.name), networkSiteType);
      }
    }

    const observations: Map<string, SiteTypeObservation> =
      await this.observeConcreteSiteHierarchy(projectId);

    for (const networkSiteType of this.typesInSafeUpdateOrder({
      networkSiteTypes,
      typeByName,
    })) {
      if (!networkSiteType.id || networkSiteType.parentNetworkSiteTypeId) {
        continue;
      }

      const childTypeId: string = normalize(networkSiteType.id.toString());
      const observation: SiteTypeObservation | undefined =
        observations.get(childTypeId);
      const parentTypeId: string | null = this.chooseParentTypeId({
        projectId,
        networkSiteType,
        observation,
        typeByName,
      });

      if (!parentTypeId) {
        continue;
      }

      const parentNetworkSiteType: NetworkSiteType | undefined =
        typeById.get(parentTypeId);

      if (!parentNetworkSiteType?.id) {
        this.warnSkipped({
          projectId,
          networkSiteType,
          reason: "the observed parent type no longer exists",
        });
        continue;
      }

      if (parentTypeId === childTypeId) {
        this.warnSkipped({
          projectId,
          networkSiteType,
          reason: "its concrete sites use the same type for parent and child",
        });
        continue;
      }

      if (parentNetworkSiteType.isUnitLevel === true) {
        this.warnSkipped({
          projectId,
          networkSiteType,
          reason: "its inferred parent is a unit-level type",
        });
        continue;
      }

      try {
        const updatedCount: number = await NetworkSiteTypeService.updateOneBy({
          query: {
            _id: networkSiteType.id,
            projectId,
            parentNetworkSiteTypeId: QueryHelper.isNull(),
          },
          data: {
            parentNetworkSiteTypeId: parentNetworkSiteType.id,
          },
          props: { isRoot: true },
        });

        /*
         * The catalog remains live while this migration runs. A parent chosen
         * after the initial read wins the compare-and-set above; only carry a
         * successful migration write into later in-memory validations.
         */
        if (updatedCount > 0) {
          networkSiteType.parentNetworkSiteTypeId = parentNetworkSiteType.id;
        }
      } catch (err) {
        if (err instanceof BadDataException) {
          this.warnSkipped({
            projectId,
            networkSiteType,
            reason: err.message,
          });
          continue;
        }

        logger.error(
          `Failed to set the parent for Network Site Type ${networkSiteType.id.toString()} in project ${projectId.toString()}:`,
        );
        logger.error(err);
        throw err;
      }
    }
  }

  private async findAllNetworkSiteTypes(
    projectId: ObjectID,
  ): Promise<Array<NetworkSiteType>> {
    const networkSiteTypes: Array<NetworkSiteType> = [];
    let skip: number = 0;

    while (true) {
      const page: Array<NetworkSiteType> = await NetworkSiteTypeService.findBy({
        query: { projectId },
        select: {
          _id: true,
          name: true,
          order: true,
          isUnitLevel: true,
          parentNetworkSiteTypeId: true,
        },
        sort: { _id: SortOrder.Ascending },
        skip,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

      networkSiteTypes.push(...page);

      if (page.length < LIMIT_MAX) {
        return networkSiteTypes;
      }

      skip += page.length;
    }
  }

  private async observeConcreteSiteHierarchy(
    projectId: ObjectID,
  ): Promise<Map<string, SiteTypeObservation>> {
    const observations: Map<string, SiteTypeObservation> = new Map<
      string,
      SiteTypeObservation
    >();
    let skip: number = 0;

    while (true) {
      const sites: Array<NetworkSite> = await NetworkSiteService.findBy({
        query: { projectId },
        select: {
          _id: true,
          networkSiteTypeId: true,
          parentSiteId: true,
        },
        sort: { _id: SortOrder.Ascending },
        skip,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

      const parentSiteIds: Array<string> = [
        ...new Set<string>(
          sites
            .map((site: NetworkSite): string | null => {
              return site.parentSiteId
                ? normalize(site.parentSiteId.toString())
                : null;
            })
            .filter((id: string | null): id is string => {
              return Boolean(id);
            }),
        ),
      ];
      const parentTypeBySiteId: Map<string, string> = new Map<string, string>();

      if (parentSiteIds.length > 0) {
        const parentSites: Array<NetworkSite> = await NetworkSiteService.findBy(
          {
            query: {
              projectId,
              _id: QueryHelper.any(parentSiteIds),
            },
            select: {
              _id: true,
              networkSiteTypeId: true,
            },
            limit: parentSiteIds.length,
            skip: 0,
            props: { isRoot: true },
          },
        );

        for (const parentSite of parentSites) {
          if (parentSite.id && parentSite.networkSiteTypeId) {
            parentTypeBySiteId.set(
              normalize(parentSite.id.toString()),
              normalize(parentSite.networkSiteTypeId.toString()),
            );
          }
        }
      }

      for (const site of sites) {
        if (!site.networkSiteTypeId) {
          continue;
        }

        const childTypeId: string = normalize(
          site.networkSiteTypeId.toString(),
        );
        const observation: SiteTypeObservation =
          observations.get(childTypeId) || emptyObservation();
        observations.set(childTypeId, observation);

        if (!site.parentSiteId) {
          observation.sawRootSite = true;
          continue;
        }

        const parentTypeId: string | undefined = parentTypeBySiteId.get(
          normalize(site.parentSiteId.toString()),
        );

        if (!parentTypeId) {
          observation.sawUnresolvedParent = true;
          continue;
        }

        observation.parentTypeIds.add(parentTypeId);
      }

      if (sites.length < LIMIT_MAX) {
        return observations;
      }

      skip += sites.length;
    }
  }

  private chooseParentTypeId(data: {
    projectId: ObjectID;
    networkSiteType: NetworkSiteType;
    observation: SiteTypeObservation | undefined;
    typeByName: Map<string, NetworkSiteType>;
  }): string | null {
    if (data.observation) {
      if (
        data.observation.sawRootSite ||
        data.observation.sawUnresolvedParent ||
        data.observation.parentTypeIds.size !== 1
      ) {
        if (
          data.observation.sawUnresolvedParent ||
          data.observation.parentTypeIds.size > 1 ||
          (data.observation.sawRootSite &&
            data.observation.parentTypeIds.size > 0)
        ) {
          this.warnSkipped({
            projectId: data.projectId,
            networkSiteType: data.networkSiteType,
            reason:
              "its existing sites do not agree on one resolvable parent type",
          });
        }

        return null;
      }

      return [...data.observation.parentTypeIds][0] || null;
    }

    if (!data.networkSiteType.name) {
      return null;
    }

    const defaultName: DefaultNetworkSiteType | undefined =
      DefaultNetworkSiteTypeCreationOrder.find(
        (name: DefaultNetworkSiteType): boolean => {
          return normalize(name) === normalize(data.networkSiteType.name!);
        },
      );

    if (!defaultName) {
      return null;
    }

    const defaultParentName: DefaultNetworkSiteType | null =
      DefaultNetworkSiteTypeParent[defaultName];
    if (!defaultParentName) {
      return null;
    }

    const defaultParent: NetworkSiteType | undefined = data.typeByName.get(
      normalize(defaultParentName),
    );
    return defaultParent?.id ? normalize(defaultParent.id.toString()) : null;
  }

  private typesInSafeUpdateOrder(data: {
    networkSiteTypes: Array<NetworkSiteType>;
    typeByName: Map<string, NetworkSiteType>;
  }): Array<NetworkSiteType> {
    const ordered: Array<NetworkSiteType> = [];
    const includedIds: Set<string> = new Set<string>();

    for (const name of DefaultNetworkSiteTypeCreationOrder) {
      const networkSiteType: NetworkSiteType | undefined = data.typeByName.get(
        normalize(name),
      );
      if (networkSiteType?.id) {
        ordered.push(networkSiteType);
        includedIds.add(normalize(networkSiteType.id.toString()));
      }
    }

    ordered.push(
      ...data.networkSiteTypes
        .filter((networkSiteType: NetworkSiteType): boolean => {
          return Boolean(
            networkSiteType.id &&
              !includedIds.has(normalize(networkSiteType.id.toString())),
          );
        })
        .sort((left: NetworkSiteType, right: NetworkSiteType): number => {
          const leftOrder: number = left.order ?? Number.MAX_SAFE_INTEGER;
          const rightOrder: number = right.order ?? Number.MAX_SAFE_INTEGER;
          return (
            leftOrder - rightOrder ||
            (left.name || "").localeCompare(right.name || "")
          );
        }),
    );

    return ordered;
  }

  private warnSkipped(data: {
    projectId: ObjectID;
    networkSiteType: NetworkSiteType;
    reason: string;
  }): void {
    logger.warn(
      `Skipped Network Site Type parent backfill for ${data.networkSiteType.id?.toString() || data.networkSiteType.name || "unknown type"} in project ${data.projectId.toString()}: ${data.reason}.`,
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
