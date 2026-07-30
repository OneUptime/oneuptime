import DatabaseService from "../../Services/DatabaseService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

/*
 * Incidents, alerts and scheduled maintenance events point at project-scoped
 * records — the current state, the severity, the monitor status to switch to.
 * Nothing checked that those ids belonged to the row's own project, so an id
 * taken from a second project (an API call, a template, a monitor criteria)
 * could be persisted.
 *
 * That is what makes the *referenced* project undeletable: deleting a Project
 * cascades into its IncidentState / IncidentSeverity / MonitorStatus rows, but
 * the Incident row owned by a different project still points at them and those
 * FKs are ON DELETE NO ACTION, so Postgres raises 23503 and the API answers
 * "This item cannot be deleted because Incident records still reference it."
 *
 * The check below is deliberately narrow, for the same reason
 * MonitorStepsProjectValidator is: it only rejects an id that really is
 * another project's record. An id that matches no row at all is left alone —
 * refusing it would block users from saving their way out of a record that
 * already references something deleted, and the not-null/foreign-key checks
 * report that case on their own.
 */

export interface ProjectScopedReference {
  // Human readable name of the referenced model, e.g. "Incident Severity".
  modelName: string;
  id: ObjectID | string | undefined | null;
  // The service that owns the referenced model, e.g. IncidentSeverityService.
  service: DatabaseService<DatabaseBaseModel>;
}

interface ForeignReference {
  modelName: string;
  name: string;
}

/*
 * The same reference reaches a service hook in several shapes: the id column
 * (`incidentSeverityId`), a relation object (`incidentSeverity: { _id }`), an
 * ObjectID in either slot, or — on the update path — a bare uuid string in the
 * relation slot, which DatabaseService.sanitizeCreateOrUpdate only turns into
 * a relation entity *after* onBeforeUpdate has run. Reading `?._id` alone
 * misses the string shape and the guard would silently pass.
 */
export function resolveReferenceId(
  value: unknown,
): ObjectID | string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  if (value instanceof ObjectID) {
    return value;
  }

  const relation: { _id?: string | undefined; id?: ObjectID | undefined } =
    value as { _id?: string | undefined; id?: ObjectID | undefined };

  return relation._id || relation.id || undefined;
}

export default class ProjectScopedReferenceValidator {
  public static async validateReferencesBelongToProject(data: {
    projectId: ObjectID | undefined;
    references: Array<ProjectScopedReference>;
    // Used in the error message, e.g. "incident" -> "This incident references…".
    subject?: string | undefined;
  }): Promise<void> {
    if (!data.projectId) {
      /*
       * Root/internal writes do not always carry a project. Callers resolve the
       * project themselves where they can; when they cannot there is nothing to
       * compare against and the check is a no-op.
       */
      return;
    }

    /*
     * One lookup per referenced model rather than one per id — an incident
     * carries three of these and they are on the create path.
     */
    const idsByService: Map<
      DatabaseService<DatabaseBaseModel>,
      Map<string, string>
    > = new Map();

    for (const reference of data.references) {
      const id: string = reference.id?.toString() || "";

      if (!id) {
        continue;
      }

      if (!idsByService.has(reference.service)) {
        idsByService.set(reference.service, new Map());
      }

      idsByService.get(reference.service)!.set(id, reference.modelName);
    }

    if (idsByService.size === 0) {
      return;
    }

    const foreignReferences: Array<ForeignReference> = [];

    for (const [service, idToModelName] of idsByService) {
      const records: Array<DatabaseBaseModel> = await service.findBy({
        query: {
          _id: QueryHelper.any(Array.from(idToModelName.keys())),
        },
        /*
         * `name` and `projectId` are not on DatabaseBaseModel, but every model
         * passed here is project scoped and named, so the cast is safe.
         */
        select: {
          _id: true,
          name: true,
          projectId: true,
        } as Select<DatabaseBaseModel>,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const record of records) {
        const recordProjectId: ObjectID | undefined =
          record.getValue<ObjectID>("projectId") || undefined;

        if (recordProjectId?.toString() === data.projectId.toString()) {
          continue;
        }

        const id: string = record._id?.toString() || "";

        foreignReferences.push({
          modelName: idToModelName.get(id) || "Record",
          name: record.getValue<string>("name")?.toString() || id,
        });
      }
    }

    if (foreignReferences.length === 0) {
      return;
    }

    const described: string = foreignReferences
      .map((reference: ForeignReference) => {
        return `${reference.modelName} "${reference.name}"`;
      })
      .join(", ");

    throw new BadDataException(
      `This ${
        data.subject || "request"
      } references records that belong to a different project: ${described}. Please pick values from this project and try again.`,
    );
  }

  /*
   * "Can this project actually use this record?" — for callers that must not
   * throw. The probe and telemetry ingest workers build incidents and alerts
   * from monitor criteria, whose stored ids may still point at another
   * project (monitorSteps repair could not always resolve them). Throwing
   * there fails the whole ingest job for that monitor, so those callers ask
   * this instead and fall back to their project's own default.
   *
   * Note the deliberate difference from validateReferencesBelongToProject: an
   * id that matches NO record is unusable here (false), while the write guard
   * lets it pass so a record already pointing at something deleted stays
   * saveable.
   */
  public static async isUsableInProject(data: {
    projectId: ObjectID | undefined;
    id: ObjectID | string | undefined | null;
    service: DatabaseService<DatabaseBaseModel>;
  }): Promise<boolean> {
    const id: string = data.id?.toString() || "";

    if (!id || !data.projectId) {
      return false;
    }

    const record: DatabaseBaseModel | null = await data.service.findOneBy({
      query: {
        _id: id,
        projectId: data.projectId,
      } as Query<DatabaseBaseModel>,
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    return Boolean(record);
  }
}
