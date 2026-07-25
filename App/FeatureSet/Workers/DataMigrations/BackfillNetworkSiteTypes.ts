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

interface ProjectSiteTypeIndex {
  // Normalized type name -> the type row's id, for case-insensitive resolution.
  idsByName: Map<string, ObjectID>;
  // Order given to the next type created for this project, so the settings list stays deterministic.
  nextOrder: number;
}

/*
 * Sites are backfilled a batch at a time, and each batch is re-queried rather
 * than paginated with an offset: backfilled sites drop straight out of the
 * "networkSiteTypeId IS NULL" result set, so a moving offset would step over
 * rows. A project with more untyped sites than this simply takes another round.
 */
const SITE_BATCH_SIZE: number = LIMIT_MAX;

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
 * "Unit" to "Store", reorder the hierarchy, or add their own levels.
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
 * backfilled. Failures are logged per project / per site rather than thrown: the
 * migration runner halts the entire chain on the first throw, and one unmappable
 * site must not freeze every later migration.
 */
export default class BackfillNetworkSiteTypes extends DataMigrationBase {
  public constructor() {
    super("BackfillNetworkSiteTypes");
  }

  public override async migrate(): Promise<void> {
    const projects: Array<Project> = await ProjectService.findBy({
      query: {},
      select: {
        _id: true,
      },
      skip: 0,
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
        await this.backfillProject(project);
      } catch (err) {
        logger.error(
          `Failed to backfill network site types for project ${project.id.toString()}:`,
        );
        logger.error(err);
      }
    }
  }

  private async backfillProject(project: Project): Promise<void> {
    const projectId: ObjectID = project.id!;

    // Seed the defaults first so most legacy strings have something to resolve to.
    await ProjectService.addDefaultNetworkSiteTypes(project);

    const typeIndex: ProjectSiteTypeIndex =
      await this.loadSiteTypeIndex(projectId);

    /*
     * The candidate query (networkSiteTypeId IS NULL) shrinks as sites are
     * backfilled, so every batch is read from offset 0 rather than paginated -
     * skipping ahead would step over rows that moved up as earlier ones were
     * resolved. Sites that cannot be backfilled (no legacy string, or a failed
     * write) stay in the result set forever, so attempted ids are tracked and
     * the loop stops as soon as a batch contains nothing new to try.
     */
    const attemptedSiteIds: Set<string> = new Set<string>();

    while (true) {
      const sites: Array<NetworkSite> = await NetworkSiteService.findBy({
        query: {
          projectId: projectId,
          networkSiteTypeId: QueryHelper.isNull(),
        },
        select: {
          _id: true,
          siteType: true,
        },
        skip: 0,
        limit: SITE_BATCH_SIZE,
        props: {
          isRoot: true,
        },
      });

      const sitesToBackfill: Array<NetworkSite> = sites.filter(
        (site: NetworkSite): boolean => {
          return Boolean(site.id) && !attemptedSiteIds.has(site.id!.toString());
        },
      );

      if (sitesToBackfill.length === 0) {
        return;
      }

      for (const site of sitesToBackfill) {
        attemptedSiteIds.add(site.id!.toString());

        // Reading the deprecated column - see the note at the top of this file.
        const legacySiteType: string = (site.siteType || "").trim();

        if (!legacySiteType) {
          continue;
        }

        try {
          const siteTypeId: ObjectID | null = await this.resolveSiteTypeId({
            projectId: projectId,
            typeIndex: typeIndex,
            typeName: legacySiteType,
          });

          if (!siteTypeId) {
            continue;
          }

          await NetworkSiteService.updateOneById({
            id: site.id!,
            data: {
              networkSiteTypeId: siteTypeId,
            },
            props: {
              isRoot: true,
            },
          });
        } catch (err) {
          logger.error(
            `Failed to backfill network site type for site ${site.id!.toString()}:`,
          );
          logger.error(err);
        }
      }
    }
  }

  /**
   * Indexes the types the project has right now (seeded defaults plus anything
   * the project configured itself) by normalized name.
   */
  private async loadSiteTypeIndex(
    projectId: ObjectID,
  ): Promise<ProjectSiteTypeIndex> {
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
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    const typeIndex: ProjectSiteTypeIndex = {
      idsByName: new Map<string, ObjectID>(),
      nextOrder: 1,
    };

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

    return typeIndex;
  }

  /**
   * Resolves a legacy site type string to a type row, creating the type when
   * the project has nothing matching it (a name that was edited away, or a
   * value written before this project was seeded).
   */
  private async resolveSiteTypeId(data: {
    projectId: ObjectID;
    typeIndex: ProjectSiteTypeIndex;
    typeName: string;
  }): Promise<ObjectID | null> {
    const existingTypeId: ObjectID | undefined = data.typeIndex.idsByName.get(
      normalizeTypeName(data.typeName),
    );

    if (existingTypeId) {
      return existingTypeId;
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
       * can win this race. Logged and skipped rather than thrown - the site
       * stays untyped and a re-run picks the row up through the name lookup.
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
