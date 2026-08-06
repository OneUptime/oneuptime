import DatabaseService from "../../Services/DatabaseService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
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
 * An id that matches NO row is rejected too (issue #3039). The REST API used to
 * take any uuid for these columns; the write then either blew up deep inside
 * Postgres as a raw 23503 (an opaque 500 rather than "you picked a bad id"), or
 * — for ids that live in a JSON blob with no foreign key behind it, like
 * monitorSteps — saved happily and only failed much later, inside the probe
 * worker, as
 *   insert or update on table "MonitorStatusTimeline" violates foreign key
 *   constraint
 * with nothing surfaced to the caller who typed the bad id.
 *
 * Rejecting a missing id is safe for the columns validated here because every
 * one of them is a real foreign key and deletes in this codebase are hard
 * deletes (DatabaseService._deleteBy), so a *stored* id can never dangle: the
 * ON DELETE NO ACTION constraint blocks the delete while a row still points at
 * it. A missing id therefore only ever comes from the payload being validated.
 * Callers whose reference is NOT foreign-key backed (monitorSteps ids, say) can
 * opt a single reference out with `mustExist: false`.
 */

export interface ProjectScopedReference {
  // Human readable name of the referenced model, e.g. "Incident Severity".
  modelName: string;
  id: ObjectID | string | undefined | null;
  // The service that owns the referenced model, e.g. IncidentSeverityService.
  service: DatabaseService<DatabaseBaseModel>;
  /*
   * Defaults to true: an id that matches no record is rejected. Set false for a
   * reference that is allowed to dangle — one with no foreign key behind it,
   * where refusing would block a user from saving their way out of a record
   * that already points at something deleted.
   */
  mustExist?: boolean | undefined;
}

interface ForeignReference {
  modelName: string;
  name: string;
}

interface MissingReference {
  modelName: string;
  id: string;
}

// What the caller asked about, keyed by id inside one service's lookup.
interface RequestedReference {
  modelName: string;
  mustExist: boolean;
  // The id exactly as the caller wrote it, so the message echoes their input.
  id: string;
}

/*
 * Ids are matched case-insensitively.
 *
 * ObjectID keeps whatever case it was handed (its validation regex is
 * case-insensitive) and Postgres compares `uuid` values by parsed value, so a
 * payload carrying an UPPERCASE uuid selects the row fine — but reads the id
 * back lower-cased, because that is how Postgres renders `uuid`. Comparing the
 * two verbatim would find no match and report a record that plainly exists as
 * missing.
 */
function normalizeId(id: string): string {
  return id.trim().toLowerCase();
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
      Map<string, RequestedReference>
    > = new Map();

    for (const reference of data.references) {
      const id: string = reference.id?.toString().trim() || "";

      if (!id) {
        continue;
      }

      if (!idsByService.has(reference.service)) {
        idsByService.set(reference.service, new Map());
      }

      const requested: Map<string, RequestedReference> = idsByService.get(
        reference.service,
      )!;

      const key: string = normalizeId(id);

      const existing: RequestedReference | undefined = requested.get(key);

      requested.set(key, {
        modelName: reference.modelName,
        id: existing?.id || id,
        /*
         * The same id can arrive twice for one service (e.g. two monitor
         * criteria pointing at the same status). If ANY of them requires the
         * record to exist, the strictest wins.
         */
        mustExist:
          (existing?.mustExist ?? false) || (reference.mustExist ?? true),
      });
    }

    if (idsByService.size === 0) {
      return;
    }

    const foreignReferences: Array<ForeignReference> = [];
    const missingReferences: Array<MissingReference> = [];

    for (const [service, requestedById] of idsByService) {
      /*
       * Read the tenant and name columns off the model rather than assuming
       * `projectId` / `name`. Not every referenced model is project scoped —
       * a monitor criteria can name owner *users*, and User has no tenant
       * column at all. Selecting a column a model does not have throws, and
       * comparing an absent projectId against the write's project would
       * report every such record as belonging to "a different project".
       */
      const referencedModel: DatabaseBaseModel = service.getModel();
      const tenantColumnName: string | null = referencedModel.getTenantColumn();
      const hasNameColumn: boolean = referencedModel.hasColumn("name");

      const select: Select<DatabaseBaseModel> = {
        _id: true,
      } as Select<DatabaseBaseModel>;

      if (hasNameColumn) {
        (select as Dictionary<boolean>)["name"] = true;
      }

      if (tenantColumnName) {
        (select as Dictionary<boolean>)[tenantColumnName] = true;
      }

      const records: Array<DatabaseBaseModel> = await service.findBy({
        query: {
          _id: QueryHelper.any(Array.from(requestedById.keys())),
        },
        select: select,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const foundIds: Set<string> = new Set();

      for (const record of records) {
        const id: string = normalizeId(record._id?.toString() || "");

        foundIds.add(id);

        if (!tenantColumnName) {
          // Global record (e.g. User) — there is no project to compare against.
          continue;
        }

        const recordProjectId: ObjectID | undefined =
          record.getValue<ObjectID>(tenantColumnName) || undefined;

        if (recordProjectId?.toString() === data.projectId.toString()) {
          continue;
        }

        foreignReferences.push({
          modelName: requestedById.get(id)?.modelName || "Record",
          name:
            (hasNameColumn && record.getValue<string>("name")?.toString()) ||
            id,
        });
      }

      for (const [id, requested] of requestedById) {
        if (foundIds.has(id) || !requested.mustExist) {
          continue;
        }

        missingReferences.push({
          modelName: requested.modelName,
          // Echo the id as the caller wrote it, not the normalized key.
          id: requested.id,
        });
      }
    }

    /*
     * Both problems are reported in one go so a caller fixing a payload with
     * several bad ids does not have to discover them one round-trip at a time.
     * The wording of each clause is kept verbatim from when they were separate
     * messages — support runbooks and tests match on it.
     */
    const clauses: Array<string> = [];

    if (foreignReferences.length > 0) {
      const described: string = foreignReferences
        .map((reference: ForeignReference) => {
          return `${reference.modelName} "${reference.name}"`;
        })
        .join(", ");

      clauses.push(
        `references records that belong to a different project: ${described}. Please pick values from this project and try again.`,
      );
    }

    if (missingReferences.length > 0) {
      const described: string = missingReferences
        .map((reference: MissingReference) => {
          return `${reference.modelName} "${reference.id}"`;
        })
        .join(", ");

      clauses.push(
        `references records that do not exist: ${described}. Please pick values that exist in this project and try again.`,
      );
    }

    if (clauses.length === 0) {
      return;
    }

    throw new BadDataException(
      `This ${data.subject || "request"} ${clauses.join(" It also ")}`,
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
   * Note the deliberate difference from validateReferencesBelongToProject:
   * that one refuses the write and names what is wrong, which is right when
   * someone is typing an id in. This one answers a question and never throws,
   * which is right when a worker is reading an id that was typed in long ago —
   * an id monitorSteps is allowed to keep holding (the write guard exempts what
   * a record already stores, since none of those ids has a foreign key behind
   * it and there is no migration to clean them up).
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
