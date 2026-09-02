import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import Project from "Common/Models/DatabaseModels/Project";
import NetworkSiteService from "Common/Server/Services/NetworkSiteService";
import NetworkSiteTypeService from "Common/Server/Services/NetworkSiteTypeService";
import ProjectService from "Common/Server/Services/ProjectService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import { Raw } from "typeorm";

interface BackfillOptions {
  /* The historical migration bootstraps the catalog for every old project. */
  seedDefaultsForEveryProject: boolean;
  /* Only that historical bootstrap may reconstruct names absent from the catalog. */
  allowCreateMissingTypes: boolean;
}

interface ProjectSiteTypeIndex {
  // Normalized type name -> the type row's id, for case-insensitive resolution.
  idsByName: Map<string, ObjectID>;
  // Order given to the next type created for this project, so the settings list stays deterministic.
  nextOrder: number;
}

/* Sites are keyset-paged because successful writes remove rows from the query. */
const SITE_BATCH_SIZE: number = LIMIT_MAX;

const afterObjectId: (id: ObjectID) => ReturnType<typeof Raw> = (
  id: ObjectID,
): ReturnType<typeof Raw> => {
  return Raw(
    (alias: string): string => {
      return `(${alias} > :networkSiteTypeBackfillCursor)`;
    },
    { networkSiteTypeBackfillCursor: id.toString() },
  );
};

/*
 * Type names are matched case-insensitively (and whitespace-insensitively) so a
 * legacy "unit" / "Unit " string still lands on the project's "Unit" type
 * instead of creating a near-duplicate next to it.
 */
type NormalizeTypeNameFunction = (name: string) => string;

const normalizeTypeName: NormalizeTypeNameFunction = (name: string): string => {
  return name.trim().toLowerCase();
};

/*
 * Site types moved from a hardcoded enum stored inline on NetworkSite.siteType
 * to the per-project NetworkSiteType lookup table, so projects can rename
 * "Unit" to "Store", connect the hierarchy, or add their own levels.
 *
 * This migration, for every project:
 *   1. seeds the default types (existing projects predate the table and have
 *      none) through ProjectService.addDefaultNetworkSiteTypes, so the defaults
 *      - names, descriptions, order, and the load-bearing isUnitLevel flag on
 *      "Unit" - are defined in exactly one place and cannot drift between
 *      project creation and this backfill, and
 *   2. points every site whose networkSiteTypeId is still NULL at the type row
 *      matching its legacy siteType string, case-insensitively. A legacy string
 *      that matches no configured type gets a type created for it (isUnitLevel
 *      false) so no existing site is left untyped and nothing silently
 *      disappears from the hierarchy.
 *
 * WHY THE DEPRECATED COLUMN IS READ HERE: NetworkSite.siteType is the only
 * record of an existing site's type - there is nowhere else to recover it from.
 * The column is kept nullable and deprecated purely so this migration can read
 * it once; a follow-up PR drops it. This is the last code that may read it, and
 * no new code should.
 *
 * Idempotent and safe to re-run: the seeder guards every create on the existing
 * per-project names, ad-hoc types are guarded by a case-insensitive name lookup,
 * and only sites with networkSiteTypeId IS NULL are touched - so a second run
 * (or a run resumed after a killed pod) is a no-op over everything already
 * backfilled. Operational failures are logged while the remaining sites and
 * projects are attempted, then surfaced so the migration runner does not mark
 * a partial pass complete. A retry is safe because successful rows no longer
 * match the NULL candidate query.
 */
export default class BackfillNetworkSiteTypes extends DataMigrationBase {
  public constructor() {
    super("BackfillNetworkSiteTypes");
  }

  public override async migrate(): Promise<void> {
    await this.migrateProjects({
      seedDefaultsForEveryProject: true,
      allowCreateMissingTypes: true,
    });
  }

  /*
   * A newly named migration calls this repair path on deployments where the
   * historical migration is already recorded as complete. It only reconnects
   * a legacy name to a type that still exists. A missing name (including an
   * empty catalog) is ambiguous: an earlier pass may have missed it, but an
   * administrator may also have renamed or deleted it. Leave those sites
   * untyped and warn instead of reversing an intentional catalog change.
   */
  public async reconcileIncompleteAssignments(): Promise<void> {
    await this.migrateProjects({
      seedDefaultsForEveryProject: false,
      allowCreateMissingTypes: false,
    });
  }

  private async migrateProjects(options: BackfillOptions): Promise<void> {
    const failedProjectIds: Array<string> = [];
    let skip: number = 0;

    while (true) {
      const projects: Array<Project> = await ProjectService.findBy({
        query: {},
        select: {
          _id: true,
        },
        sort: { _id: SortOrder.Ascending },
        skip,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

      for (const project of projects) {
        if (!project.id) {
          continue;
        }

        try {
          await this.backfillProject(project, options);
        } catch (err) {
          failedProjectIds.push(project.id.toString());
          logger.error(
            `Failed to backfill network site types for project ${project.id.toString()}:`,
          );
          logger.error(err);
        }
      }

      if (projects.length < LIMIT_MAX) {
        break;
      }

      skip += projects.length;
    }

    if (failedProjectIds.length > 0) {
      throw new Error(
        `Network Site Type backfill failed for ${failedProjectIds.length} project(s): ${failedProjectIds.join(", ")}.`,
      );
    }
  }

  private async backfillProject(
    project: Project,
    options: BackfillOptions,
  ): Promise<void> {
    const projectId: ObjectID = project.id!;

    if (options.seedDefaultsForEveryProject) {
      /*
       * Seed names without the NEW default parent edges. On an old database
       * the concrete site tree is the source of truth, and the later parent
       * backfill must be allowed to derive its relationships instead of
       * mistaking freshly seeded defaults for an already-migrated hierarchy.
       */
      await ProjectService.addDefaultNetworkSiteTypes(project, {
        setParentRelationships: false,
      });
    }

    const typeIndex: ProjectSiteTypeIndex =
      await this.loadSiteTypeIndex(projectId);

    /*
     * Successful writes remove rows from the NULL candidate query. A numeric
     * offset would consequently skip rows, while repeatedly reading offset 0
     * would be trapped behind a full first page of ambiguous or failed rows.
     * Page by the immutable primary key so every original candidate is tried
     * once and failures can be aggregated after later pages are attempted.
     */
    const failedSiteIds: Array<string> = [];
    let siteCursor: ObjectID | null = null;

    while (true) {
      const query: Query<NetworkSite> = {
        projectId: projectId,
        networkSiteTypeId: QueryHelper.isNull(),
      };

      if (siteCursor) {
        (query as unknown as Record<string, unknown>)["_id"] =
          afterObjectId(siteCursor);
      }

      const sites: Array<NetworkSite> = await NetworkSiteService.findBy({
        query,
        select: {
          _id: true,
          siteType: true,
        },
        sort: { _id: SortOrder.Ascending },
        skip: 0,
        limit: SITE_BATCH_SIZE,
        props: {
          isRoot: true,
        },
      });

      if (sites.length === 0) {
        break;
      }

      let lastSiteId: ObjectID | null = null;

      for (const site of sites) {
        if (!site.id) {
          continue;
        }

        lastSiteId = site.id;

        // Reading the deprecated column - see the note at the top of this file.
        const observedLegacySiteType: string = site.siteType || "";
        const legacySiteType: string = observedLegacySiteType.trim();

        if (!legacySiteType) {
          this.warnSkippedSite({
            projectId,
            siteId: site.id,
            reason: "its legacy site type is empty",
          });
          continue;
        }

        try {
          const siteTypeId: ObjectID | null = await this.resolveSiteTypeId({
            projectId: projectId,
            typeIndex: typeIndex,
            typeName: legacySiteType,
            allowCreateMissingTypes: options.allowCreateMissingTypes,
          });

          if (!siteTypeId) {
            if (!options.allowCreateMissingTypes) {
              this.warnSkippedSite({
                projectId,
                siteId: site.id,
                reason: `legacy site type "${legacySiteType}" does not match any configured Network Site Type`,
              });
              continue;
            }

            throw new Error(
              `No Network Site Type could be resolved for "${legacySiteType}".`,
            );
          }

          /*
           * This migration reconstructs the type assignment that existed
           * before NetworkSiteType rows were introduced. New hierarchy hooks
           * cannot validate the site one row at a time: a child's parent may
           * still be untyped, and the type-parent backfill runs later. Write
           * the recovered FK directly; BackfillNetworkSiteTypeParents then
           * derives only the relationships on which the completed site tree
           * agrees.
           */
          await NetworkSiteService.updateColumnsByIdWithoutHooks({
            id: site.id!,
            data: {
              networkSiteTypeId: siteTypeId,
            },
            /*
             * A live user or an older application pod can assign this site
             * after the migration's candidate read. Compare both source
             * values so this repair never replaces that newer choice (nor
             * derives an ID from a legacy name that changed meanwhile).
             */
            expectedData: {
              networkSiteTypeId: null,
              siteType: observedLegacySiteType,
            },
          });
        } catch (err) {
          failedSiteIds.push(site.id!.toString());
          logger.error(
            `Failed to backfill network site type for site ${site.id!.toString()}:`,
          );
          logger.error(err);
        }
      }

      if (sites.length < SITE_BATCH_SIZE) {
        break;
      }

      if (!lastSiteId) {
        throw new Error(
          `Could not advance Network Site Type backfill pagination for project ${projectId.toString()} because a full page contained no site IDs.`,
        );
      }

      siteCursor = lastSiteId;
    }

    if (failedSiteIds.length > 0) {
      throw new Error(
        `Failed to backfill ${failedSiteIds.length} Network Site(s): ${failedSiteIds.join(", ")}.`,
      );
    }
  }

  private warnSkippedSite(data: {
    projectId: ObjectID;
    siteId: ObjectID;
    reason: string;
  }): void {
    logger.warn(
      `Skipped Network Site Type reconciliation for site ${data.siteId.toString()} in project ${data.projectId.toString()} because ${data.reason}.`,
    );
  }

  /**
   * Indexes the types the project has right now (seeded defaults plus anything
   * the project configured itself) by normalized name.
   */
  private async loadSiteTypeIndex(
    projectId: ObjectID,
  ): Promise<ProjectSiteTypeIndex> {
    const typeIndex: ProjectSiteTypeIndex = {
      idsByName: new Map<string, ObjectID>(),
      nextOrder: 1,
    };
    let skip: number = 0;

    while (true) {
      const existingTypes: Array<NetworkSiteType> =
        await NetworkSiteTypeService.findBy({
          query: {
            projectId: projectId,
          },
          select: {
            _id: true,
            name: true,
            order: true,
          },
          sort: { _id: SortOrder.Ascending },
          skip,
          limit: LIMIT_MAX,
          props: {
            isRoot: true,
          },
        });

      for (const existingType of existingTypes) {
        if (!existingType.id || !existingType.name) {
          continue;
        }

        typeIndex.idsByName.set(
          normalizeTypeName(existingType.name),
          existingType.id,
        );

        if (existingType.order && existingType.order >= typeIndex.nextOrder) {
          typeIndex.nextOrder = existingType.order + 1;
        }
      }

      if (existingTypes.length < LIMIT_MAX) {
        break;
      }

      skip += existingTypes.length;
    }

    return typeIndex;
  }

  /**
   * Resolves a legacy site type string to a type row, creating the type when
   * the historical bootstrap finds nothing matching it. Targeted repair never
   * recreates an absent name because deletion and an incomplete earlier pass
   * are indistinguishable after the fact.
   */
  private async resolveSiteTypeId(data: {
    projectId: ObjectID;
    typeIndex: ProjectSiteTypeIndex;
    typeName: string;
    allowCreateMissingTypes: boolean;
  }): Promise<ObjectID | null> {
    const existingTypeId: ObjectID | undefined = data.typeIndex.idsByName.get(
      normalizeTypeName(data.typeName),
    );

    if (existingTypeId) {
      return existingTypeId;
    }

    if (!data.allowCreateMissingTypes) {
      return null;
    }

    /*
     * isUnitLevel is false for these: only the seeded "Unit" default is the
     * leaf level, and guessing it from an unknown legacy string would silently
     * change which sites the network map drills into device topology for. The
     * type is created at the end of the hierarchy so the seeded levels keep
     * their order on the settings page.
     */
    return this.createSiteType({
      projectId: data.projectId,
      typeIndex: data.typeIndex,
      name: data.typeName,
      order: data.typeIndex.nextOrder,
      isUnitLevel: false,
    });
  }

  private async createSiteType(data: {
    projectId: ObjectID;
    typeIndex: ProjectSiteTypeIndex;
    name: string;
    order: number;
    isUnitLevel: boolean;
  }): Promise<ObjectID | null> {
    const siteType: NetworkSiteType = new NetworkSiteType();
    siteType.projectId = data.projectId;
    siteType.name = data.name;
    siteType.order = data.order;
    siteType.isUnitLevel = data.isUnitLevel;

    try {
      const createdSiteType: NetworkSiteType =
        await NetworkSiteTypeService.create({
          data: siteType,
          props: {
            isRoot: true,
          },
        });

      if (!createdSiteType.id) {
        return null;
      }

      data.typeIndex.idsByName.set(
        normalizeTypeName(data.name),
        createdSiteType.id,
      );

      if (data.order >= data.typeIndex.nextOrder) {
        data.typeIndex.nextOrder = data.order + 1;
      }

      return createdSiteType.id;
    } catch (err) {
      /*
       * The name is unique per project, so a concurrent writer (project
       * creation running the same seeder, or a user adding the type by hand)
       * can win this race. Return null after logging; the caller records the
       * site as failed and the migration exits unsuccessfully, so a retry can
       * pick the winning row up through the name lookup.
       */
      logger.error(
        `Failed to create network site type "${data.name}" for project ${data.projectId.toString()}:`,
      );
      logger.error(err);

      return null;
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
