import DatabaseService from "../../Services/DatabaseService";
import QueryHelper from "../../Types/Database/QueryHelper";
import { resolveReferenceId } from "../Database/ProjectScopedReferenceValidator";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";

/*
 * Incident.serviceLevelObjectives and Alert.serviceLevelObjectives are
 * client-writable. Their column ACL matches `services`, so any IncidentMember
 * or AlertMember can send them, and nothing in the framework checks that a
 * relation id belongs to the row's project. A caller holding another project's
 * SLO id could link it. The created feed item, the incidents and alerts lists,
 * the AI context and the incident/alert metrics would then show that SLO's
 * name inside the caller's project.
 *
 * Why this file exists instead of ProjectScopedReferenceValidator with
 * ServiceLevelObjectiveService:
 *
 * - IncidentService and AlertService cannot import ServiceLevelObjectiveService.
 *   It imports ServiceLevelObjectiveBurnRateRuleService, which imports both of
 *   them to resolve burn-rate outputs. So the lookup here goes through a plain
 *   DatabaseService over the model, which carries no hooks and imports none of
 *   those services.
 * - ProjectScopedReferenceValidator reads the referenced rows as root and names
 *   a foreign one in its error (`Service Level Objective "<name>"`). That is
 *   fine for a state or a severity. For an SLO, the name is exactly what must
 *   not leak. Here the read is pinned to the record's own project, so another
 *   project's SLO is never loaded. A foreign id and an id that matches nothing
 *   get the same answer, which echoes only the ids the caller sent.
 */

/*
 * Ids are compared lower-cased. Postgres reads a uuid back lower-cased
 * whatever case the payload used (see ProjectScopedReferenceValidator).
 */
function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

let lookupService: DatabaseService<ServiceLevelObjective> | null = null;

export default class SloRecordReferenceValidator {
  /*
   * Created on first use rather than at module load. The service instantiates
   * the model, and this module is reached through the service import graph
   * before every model decorator has run.
   */
  public static getLookupService(): DatabaseService<ServiceLevelObjective> {
    if (!lookupService) {
      lookupService = new DatabaseService<ServiceLevelObjective>(
        ServiceLevelObjective,
      );
    }

    return lookupService;
  }

  /*
   * The SLO ids in a `serviceLevelObjectives` payload, in the order given and
   * each once. The value arrives in several shapes: model instances or `{_id}`
   * objects from the API and the worker, and bare uuid strings or ObjectIDs on
   * an update, which sanitizeCreateOrUpdate only turns into entities after the
   * hooks have run. Entries with no id are skipped: without an id they cannot
   * link anything.
   */
  public static getReferencedIds(value: unknown): Array<string> {
    if (value === undefined || value === null) {
      return [];
    }

    const entries: Array<unknown> = Array.isArray(value) ? value : [value];
    const ids: Array<string> = [];
    const seen: Set<string> = new Set<string>();

    for (const entry of entries) {
      const id: string = resolveReferenceId(entry)?.toString().trim() || "";

      if (!id || seen.has(normalizeId(id))) {
        continue;
      }

      seen.add(normalizeId(id));
      ids.push(id);
    }

    return ids;
  }

  public static async validateServiceLevelObjectivesBelongToProject(data: {
    projectId: ObjectID | undefined;
    serviceLevelObjectives: unknown;
    // Used in the error message, e.g. "incident" -> "This incident references…".
    subject: string;
  }): Promise<void> {
    const ids: Array<string> = SloRecordReferenceValidator.getReferencedIds(
      data.serviceLevelObjectives,
    );

    if (ids.length === 0) {
      return;
    }

    if (!data.projectId) {
      /*
       * Same rule as ProjectScopedReferenceValidator. With no project to
       * compare against, the check is a no-op. The create hooks always resolve
       * one, and the update hooks fall back to the matched rows' projects.
       */
      return;
    }

    /*
     * A malformed id would make Postgres reject the uuid cast and surface as
     * an opaque 500. It cannot name an SLO in this project either, so it gets
     * the same answer as a foreign id, without a query.
     */
    const lookupIds: Array<string> = ids.filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    });

    const foundIds: Set<string> = new Set<string>();

    if (lookupIds.length > 0) {
      const serviceLevelObjectives: Array<ServiceLevelObjective> =
        await SloRecordReferenceValidator.getLookupService().findBy({
          query: {
            _id: QueryHelper.any(lookupIds),
            // Pinned to the record's project: a foreign SLO is never read.
            projectId: data.projectId,
          },
          select: {
            _id: true,
          },
          limit: lookupIds.length,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      for (const serviceLevelObjective of serviceLevelObjectives) {
        const id: string = serviceLevelObjective._id?.toString() || "";

        if (id) {
          foundIds.add(normalizeId(id));
        }
      }
    }

    const unknownIds: Array<string> = ids.filter((id: string): boolean => {
      return !foundIds.has(normalizeId(id));
    });

    if (unknownIds.length === 0) {
      return;
    }

    const described: string = unknownIds
      .map((id: string): string => {
        return `"${id}"`;
      })
      .join(", ");

    throw new BadDataException(
      `This ${data.subject} references Service Level Objectives that do not exist in this project: ${described}. Please pick SLOs from this project and try again.`,
    );
  }
}
