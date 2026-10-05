import DatabaseService from "../../Services/DatabaseService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import ServerException from "../../../Types/Exception/ServerException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";

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
 *
 * What "in this project" means, and what an answer may say:
 *
 *   - A project-scoped record is read pinned to the project (its tenant
 *     column in the query), selecting nothing but its id. Another project's
 *     record is never loaded, so nothing about it - its name above all - can
 *     reach a message. An id from another project and an id that matches
 *     nothing get the same answer, which echoes only the ids the caller sent.
 *   - A user has no project of their own. A user counts as the project's
 *     when they hold a membership in it: a TeamMember row in any of its
 *     teams, an invitation still pending included - exactly the people the
 *     dashboard's pickers offer (PeoplePickerKinds lists the project's
 *     TeamMember rows), so a save never refuses someone the form just
 *     offered. Whoever adds them as an owner later is stricter
 *     (OwnerRuleAssignment.createOwner: the invitation must be accepted by
 *     then).
 *   - A reference allowed to dangle (`mustExist: false`) may name a record
 *     that is gone, never one that belongs elsewhere: the ids the pinned read
 *     did not find are looked up once more by id alone, again selecting only
 *     the id.
 *
 * The lookups go through plain DatabaseServices over the referenced models
 * (getLookupService) wherever a caller does not hand over a service of its
 * own: they carry no hooks and import no other service, so this module can
 * be used from any service without joining an import cycle.
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
   * that already points at something deleted. It never lets in a record of
   * another project, nor a user who is not a member.
   */
  mustExist?: boolean | undefined;
}

/*
 * A many-to-many list on the record being written (an incident's `monitors`,
 * say) and the model its ids point at. Nothing in DatabaseService or the
 * permission layer checks relation ids against the tenant, so each service
 * that accepts such a list names it here and runs it through the same check
 * as its scalar references.
 */
export interface ProjectScopedRelation {
  // Property on the record being written, e.g. "monitors".
  column: string;
  modelName: string;
  service: DatabaseService<DatabaseBaseModel>;
}

/*
 * Per project the update touches (normalized id), per relation column, the
 * normalized ids that every matched record in that project already holds.
 */
export type HeldRelationIds = Map<string, Dictionary<Set<string>>>;

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

// The users table: a person, who has no project of their own.
const USER_TABLE_NAME: string = "User";

// How many users one membership read asks about.
const MEMBERSHIP_LOOKUP_BATCH_SIZE: number = 50;

/*
 * The plain lookup services, one per model, created on first use: a service
 * instantiates its model, and this module is reached through the service
 * import graph before every model decorator has run.
 */
const lookupServices: Map<
  { new (): DatabaseBaseModel },
  DatabaseService<DatabaseBaseModel>
> = new Map();

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

/*
 * The list form of resolveReferenceId, for many-to-many payloads. The list
 * reaches a hook as model instances (API create, workers), `{ _id }` objects,
 * ObjectIDs or bare uuid strings (API update), and an entry with no id cannot
 * link anything, so it is skipped.
 */
export function resolveReferenceIds(value: unknown): Array<ObjectID | string> {
  if (value === undefined || value === null) {
    return [];
  }

  const entries: Array<unknown> = Array.isArray(value) ? value : [value];
  const ids: Array<ObjectID | string> = [];

  for (const entry of entries) {
    const id: ObjectID | string | undefined = resolveReferenceId(entry);

    if (id && id.toString().trim()) {
      ids.push(id);
    }
  }

  return ids;
}

/*
 * Thrown when a payload references records that are not the project's:
 * another project's, ones that do not exist, or users who are not members.
 * A BadDataException, so API callers see a 400 with the message; its own
 * type lets a chat reply say something fixed instead of echoing the ids.
 */
export class ProjectScopedReferenceException extends BadDataException {}

export default class ProjectScopedReferenceValidator {
  public static async validateReferencesBelongToProject(data: {
    projectId: ObjectID | undefined;
    references: Array<ProjectScopedReference>;
    // Used in the error message, e.g. "incident" -> "This incident references…".
    subject?: string | undefined;
  }): Promise<void> {
    const unavailable: Array<ProjectScopedReference> =
      await ProjectScopedReferenceValidator.getUnavailableReferences(data);

    if (unavailable.length === 0) {
      return;
    }

    throw new ProjectScopedReferenceException(
      ProjectScopedReferenceValidator.getRefusalMessage({
        subject: data.subject,
        described:
          ProjectScopedReferenceValidator.describeReferences(unavailable),
      }),
    );
  }

  /*
   * The references (each one given, in the order given) whose id is not the
   * project's - another project's record, one that matches nothing, a user
   * who is not a member - without throwing, for a caller that exempts some
   * of them first (an update saving back ids its record already holds; see
   * ProjectReferenceCheck). See the comment at the top of this file for what
   * counts.
   */
  public static async getUnavailableReferences(data: {
    projectId: ObjectID | undefined;
    references: Array<ProjectScopedReference>;
    subject?: string | undefined;
  }): Promise<Array<ProjectScopedReference>> {
    if (!data.projectId) {
      /*
       * Root/internal writes do not always carry a project. Callers resolve the
       * project themselves where they can; when they cannot there is nothing to
       * compare against and the check is a no-op.
       */
      return [];
    }

    const projectId: ObjectID = data.projectId;

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

      /*
       * The type says a service is always there, but a caller that picks it
       * from a table built at module load can hand over `undefined` when an
       * import cycle leaves that service half initialized (see
       * MonitorStepsProjectValidator). Without this check the lookup below
       * fails with a TypeError, which the API reports as a bare "Server Error"
       * that names nothing. It is still a bug, so it stays a 500, but the
       * message says which reference could not be checked.
       */
      if (!reference.service) {
        throw new ServerException(
          `Unable to check the ${reference.modelName} this ${data.subject || "request"} references because its lookup service is not loaded. Please contact support.`,
        );
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
        modelName: existing?.modelName || reference.modelName,
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
      return [];
    }

    const unavailableByService: Map<
      DatabaseService<DatabaseBaseModel>,
      Set<string>
    > = new Map();

    for (const [service, requestedById] of idsByService) {
      unavailableByService.set(
        service,
        await ProjectScopedReferenceValidator.getUnavailableIds({
          service: service,
          projectId: projectId,
          requested: requestedById,
        }),
      );
    }

    return data.references.filter(
      (reference: ProjectScopedReference): boolean => {
        const id: string = reference.id?.toString().trim() || "";

        return Boolean(
          id &&
            unavailableByService.get(reference.service)?.has(normalizeId(id)),
        );
      },
    );
  }

  /*
   * How a refusal lists references: by the field the caller filled in and
   * the id they sent - never by what the id resolved to - each id once per
   * field, in the order given, so an id written to two fields is named in
   * both. Whether an id belongs to another project, matches nothing, or
   * names someone who is not a member is not this project's business to
   * say, so all of them read the same; and everything wrong is listed in one
   * go, so a caller fixing a payload with several bad ids does not discover
   * them one round-trip at a time.
   */
  public static describeReferences(
    references: Array<ProjectScopedReference>,
  ): Array<string> {
    const described: Array<string> = [];
    const seen: Set<string> = new Set<string>();

    for (const reference of references) {
      const id: string = reference.id?.toString().trim() || "";

      if (!id) {
        continue;
      }

      const key: string = `${reference.modelName}\u0000${normalizeId(id)}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      // Echo the id as the caller wrote it, not the normalized key.
      described.push(`${reference.modelName} "${id}"`);
    }

    return described;
  }

  // The one refusal every reference check answers with.
  public static getRefusalMessage(data: {
    subject?: string | undefined;
    // `Label "<id>"`, as describeReferences describes each.
    described: Array<string>;
  }): string {
    return `This ${data.subject || "request"} references records that are not in this project: ${data.described.join(", ")}. Please pick values from this project and try again.`;
  }

  /*
   * The requested ids (normalized) that are not the project's: see the
   * comment at the top of this file for what counts.
   */
  private static async getUnavailableIds(data: {
    service: DatabaseService<DatabaseBaseModel>;
    projectId: ObjectID;
    requested: Map<string, RequestedReference>;
  }): Promise<Set<string>> {
    const keys: Array<string> = Array.from(data.requested.keys());

    /*
     * A malformed id would fail Postgres' uuid cast and surface as an opaque
     * 500. It cannot name a record of this project either, so it is answered
     * like any other id that is not the project's, without a query.
     */
    const unavailable: Set<string> = new Set<string>(
      keys.filter((key: string): boolean => {
        return !ObjectID.isValidUUID(key);
      }),
    );

    const lookupKeys: Array<string> = keys.filter((key: string): boolean => {
      return ObjectID.isValidUUID(key);
    });

    if (lookupKeys.length === 0) {
      return unavailable;
    }

    const referencedModel: DatabaseBaseModel = data.service.getModel();

    if (ProjectScopedReferenceValidator.isUserModel(referencedModel)) {
      const memberIds: Set<string> =
        await ProjectScopedReferenceValidator.findProjectMemberIds({
          projectId: data.projectId,
          userIds: lookupKeys,
        });

      for (const key of lookupKeys) {
        if (!memberIds.has(key)) {
          unavailable.add(key);
        }
      }

      return unavailable;
    }

    if (!referencedModel.getTenantColumn()) {
      /*
       * A model with no project of its own, and not a person: there is no
       * project to compare against, so it only has to exist.
       */
      const existingIds: Set<string> =
        await ProjectScopedReferenceValidator.findExistingIds({
          service: data.service,
          ids: lookupKeys,
        });

      for (const key of lookupKeys) {
        if (!existingIds.has(key) && data.requested.get(key)!.mustExist) {
          unavailable.add(key);
        }
      }

      return unavailable;
    }

    const idsInProject: Set<string> =
      await ProjectScopedReferenceValidator.findIdsInProject({
        service: data.service,
        projectId: data.projectId,
        ids: lookupKeys,
      });

    const notInProject: Array<string> = lookupKeys.filter(
      (key: string): boolean => {
        return !idsInProject.has(key);
      },
    );

    // Allowed to be gone, but not to be someone else's.
    const mayDangle: Array<string> = notInProject.filter(
      (key: string): boolean => {
        return !data.requested.get(key)!.mustExist;
      },
    );

    const existingElsewhere: Set<string> =
      mayDangle.length > 0
        ? await ProjectScopedReferenceValidator.findExistingIds({
            service: data.service,
            ids: mayDangle,
          })
        : new Set<string>();

    for (const key of notInProject) {
      if (data.requested.get(key)!.mustExist || existingElsewhere.has(key)) {
        unavailable.add(key);
      }
    }

    return unavailable;
  }

  /*
   * One reference per id in the write's many-to-many lists, to pass to
   * validateReferencesBelongToProject alongside the scalar ones so a payload
   * with several bad ids gets one answer.
   *
   * On an update, `heldIds` (from getHeldRelationIds) exempts the ids the
   * matched records already hold in `projectId`. Records written before these
   * lists were checked — or by a monitor whose criteria still carried a stale
   * id — can hold another project's record, and refusing to save back the
   * list they already have would lock the user out of editing it. Only ids
   * the update adds are checked.
   */
  public static getRelationReferences(data: {
    payload: unknown;
    relations: Array<ProjectScopedRelation>;
    projectId?: ObjectID | undefined;
    heldIds?: HeldRelationIds | undefined;
  }): Array<ProjectScopedReference> {
    const payload: Dictionary<unknown> =
      (data.payload as Dictionary<unknown>) || {};

    const heldInProject: Dictionary<Set<string>> | undefined =
      data.projectId && data.heldIds
        ? data.heldIds.get(normalizeId(data.projectId.toString()))
        : undefined;

    const references: Array<ProjectScopedReference> = [];

    for (const relation of data.relations) {
      const held: Set<string> | undefined = heldInProject?.[relation.column];

      for (const id of resolveReferenceIds(payload[relation.column])) {
        if (held?.has(normalizeId(id.toString()))) {
          continue;
        }

        references.push({
          modelName: relation.modelName,
          id: id,
          service: relation.service,
        });
      }
    }

    return references;
  }

  /*
   * What the records an update matches already hold in each of `columns`,
   * grouped by project. Within a project an id counts as held only when
   * EVERY matched record holds it: a bulk update writes the same list onto
   * all of them, and a foreign id one record picked up long ago must not
   * become a way to attach it to the rest.
   *
   * Read as root, like the services' own project fallback for updates, so the
   * result is keyed by each record's project and a caller only ever gets the
   * exemption for the project being checked.
   *
   * One read per column. A find that selects several many-to-many relations
   * joins them all and returns a row for every combination of their ids, and
   * an alert or incident can save sixteen lists in one update (the dashboard
   * sends every affected-resource list back on each edit).
   */
  public static async getHeldRelationIds(data: {
    service: DatabaseService<DatabaseBaseModel>;
    query: Query<DatabaseBaseModel>;
    columns: Array<string>;
  }): Promise<HeldRelationIds> {
    const heldIds: HeldRelationIds = new Map();

    const tenantColumnName: string | null = data.service
      .getModel()
      .getTenantColumn();

    if (!tenantColumnName || data.columns.length === 0) {
      return heldIds;
    }

    for (const column of data.columns) {
      const records: Array<DatabaseBaseModel> = await data.service.findBy({
        query: data.query,
        select: {
          _id: true,
          [tenantColumnName]: true,
          [column]: {
            _id: true,
          },
        } as Select<DatabaseBaseModel>,
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      // Per project, the ids every record read so far holds in this column.
      const heldInColumn: Map<string, Set<string>> = new Map();

      for (const record of records) {
        const projectId: string = normalizeId(
          record.getValue<ObjectID>(tenantColumnName)?.toString() || "",
        );

        if (!projectId) {
          continue;
        }

        const heldByRecord: Set<string> = new Set(
          resolveReferenceIds(record.getValue(column)).map(
            (id: ObjectID | string) => {
              return normalizeId(id.toString());
            },
          ),
        );

        const heldSoFar: Set<string> | undefined = heldInColumn.get(projectId);

        heldInColumn.set(
          projectId,
          heldSoFar
            ? new Set(
                Array.from(heldSoFar).filter((id: string) => {
                  return heldByRecord.has(id);
                }),
              )
            : heldByRecord,
        );
      }

      for (const [projectId, held] of heldInColumn) {
        if (!heldIds.has(projectId)) {
          heldIds.set(projectId, {});
        }

        heldIds.get(projectId)![column] = held;
      }
    }

    return heldIds;
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

  /*
   * isUsableInProject over a list, for workers that copy stored id lists
   * (monitor criteria, templates, rules) onto a new record. The service hooks
   * refuse a record from another project — or one that no longer exists — in
   * those lists, and a worker has nobody to show that error to: it would fail
   * the whole job, every time it ran. So the worker keeps the usable ids and
   * drops the rest, and says which it dropped so the log can name them.
   *
   * A value that is not a uuid is dropped without a lookup: Postgres would
   * reject the cast and fail the job just the same.
   */
  public static async filterUsableInProject(data: {
    projectId: ObjectID | undefined;
    ids: Array<ObjectID | string>;
    service: DatabaseService<DatabaseBaseModel>;
  }): Promise<{
    usableIds: Array<ObjectID | string>;
    droppedIds: Array<ObjectID | string>;
  }> {
    const usableIds: Array<ObjectID | string> = [];
    const droppedIds: Array<ObjectID | string> = [];
    const seen: Set<string> = new Set();

    for (const id of data.ids) {
      const key: string = normalizeId(id?.toString() || "");

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);

      const isUsable: boolean =
        ObjectID.isValidUUID(key) &&
        (await ProjectScopedReferenceValidator.isUsableInProject({
          projectId: data.projectId,
          id: id,
          service: data.service,
        }));

      if (isUsable) {
        usableIds.push(id);
      } else {
        droppedIds.push(id);
      }
    }

    return {
      usableIds: usableIds,
      droppedIds: droppedIds,
    };
  }

  /*
   * A plain DatabaseService over `modelType` for reading ids: no hooks, no
   * other service imported. The same instance every time for a model, so a
   * check that names one model from several lists (a rule's label lists)
   * reads it once.
   */
  public static getLookupService<TModel extends DatabaseBaseModel>(modelType: {
    new (): TModel;
  }): DatabaseService<TModel> {
    const type: { new (): DatabaseBaseModel } = modelType as unknown as {
      new (): DatabaseBaseModel;
    };

    if (!lookupServices.has(type)) {
      lookupServices.set(type, new DatabaseService<DatabaseBaseModel>(type));
    }

    return lookupServices.get(type) as unknown as DatabaseService<TModel>;
  }

  /*
   * Whether a referenced model is a person, checked by membership. Known by
   * its table as well as its class: a second copy of the model class (a
   * module loaded twice) must not turn the membership check into none.
   */
  public static isUserModel(model: DatabaseBaseModel): boolean {
    return (
      model instanceof User ||
      (Boolean(model.tableName) && model.tableName === USER_TABLE_NAME)
    );
  }

  /*
   * The ids among `ids` (valid uuids) that name records of the project,
   * normalized. One read, pinned to the project and selecting nothing but
   * the id and the tenant column, so another project's record is never
   * loaded. A row that comes back from another project anyway is not
   * counted.
   */
  public static async findIdsInProject(data: {
    service: DatabaseService<DatabaseBaseModel>;
    projectId: ObjectID;
    ids: Array<string>;
  }): Promise<Set<string>> {
    const found: Set<string> = new Set<string>();
    const tenantColumnName: string | null = data.service
      .getModel()
      .getTenantColumn();

    if (!tenantColumnName || data.ids.length === 0) {
      return found;
    }

    const records: Array<DatabaseBaseModel> = await data.service.findBy({
      query: {
        _id: QueryHelper.any(data.ids),
        [tenantColumnName]: data.projectId,
      } as Query<DatabaseBaseModel>,
      select: {
        _id: true,
        [tenantColumnName]: true,
      } as Select<DatabaseBaseModel>,
      limit: data.ids.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const projectId: string = normalizeId(data.projectId.toString());

    for (const record of records) {
      const recordProjectId: string = normalizeId(
        record.getValue<ObjectID>(tenantColumnName)?.toString() || "",
      );

      if (recordProjectId !== projectId) {
        continue;
      }

      found.add(normalizeId(record._id?.toString() || ""));
    }

    return found;
  }

  /*
   * The ids among `ids` that name records of `modelType` in the project, as
   * given and in the order given - for engines that act, as root, on ids a
   * rule saved long ago and must leave out whatever is not the project's
   * rather than fail. One read pinned to the project (findIdsInProject); an
   * id that is not a uuid is never sent to the database.
   */
  public static async keepIdsInProject<TModel extends DatabaseBaseModel>(data: {
    modelType: { new (): TModel };
    projectId: ObjectID;
    ids: Array<string>;
  }): Promise<Array<string>> {
    const lookupIds: Array<string> = Array.from(
      new Set<string>(
        data.ids
          .map((id: string): string => {
            return normalizeId(id);
          })
          .filter((id: string): boolean => {
            return ObjectID.isValidUUID(id);
          }),
      ),
    );

    if (lookupIds.length === 0) {
      return [];
    }

    const found: Set<string> =
      await ProjectScopedReferenceValidator.findIdsInProject({
        service: ProjectScopedReferenceValidator.getLookupService(
          data.modelType,
        ) as unknown as DatabaseService<DatabaseBaseModel>,
        projectId: data.projectId,
        ids: lookupIds,
      });

    return data.ids.filter((id: string): boolean => {
      return found.has(normalizeId(id));
    });
  }

  /*
   * The ids among `ids` (valid uuids) that match a record at all, wherever it
   * lives, normalized. Reads nothing but the ids.
   */
  public static async findExistingIds(data: {
    service: DatabaseService<DatabaseBaseModel>;
    ids: Array<string>;
  }): Promise<Set<string>> {
    const found: Set<string> = new Set<string>();

    if (data.ids.length === 0) {
      return found;
    }

    const records: Array<DatabaseBaseModel> = await data.service.findBy({
      query: {
        _id: QueryHelper.any(data.ids),
      },
      select: {
        _id: true,
      } as Select<DatabaseBaseModel>,
      limit: data.ids.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const record of records) {
      found.add(normalizeId(record._id?.toString() || ""));
    }

    return found;
  }

  /*
   * The users among `userIds` (valid uuids) who hold a membership in the
   * project, normalized: a TeamMember row in any of its teams, an invitation
   * still pending included (see the comment at the top of this file). Read
   * pinned to the project, so a membership elsewhere is never loaded.
   *
   * There is one row per team a user is in, so the users are read a few at
   * a time, and a read that comes back full - the rows past it unread - is
   * finished by asking for each user it did not find on their own.
   */
  public static async findProjectMemberIds(data: {
    projectId: ObjectID;
    userIds: Array<string>;
  }): Promise<Set<string>> {
    const found: Set<string> = new Set<string>();
    const lookup: DatabaseService<TeamMember> =
      ProjectScopedReferenceValidator.getLookupService(TeamMember);
    const projectId: string = normalizeId(data.projectId.toString());

    for (
      let start: number = 0;
      start < data.userIds.length;
      start += MEMBERSHIP_LOOKUP_BATCH_SIZE
    ) {
      const userIds: Array<string> = data.userIds.slice(
        start,
        start + MEMBERSHIP_LOOKUP_BATCH_SIZE,
      );

      const memberships: Array<TeamMember> = await lookup.findBy({
        query: {
          projectId: data.projectId,
          userId: QueryHelper.any(userIds),
        },
        select: {
          userId: true,
          projectId: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const membership of memberships) {
        if (normalizeId(membership.projectId?.toString() || "") !== projectId) {
          continue;
        }

        const userId: string = normalizeId(membership.userId?.toString() || "");

        if (userId) {
          found.add(userId);
        }
      }

      if (memberships.length < LIMIT_PER_PROJECT) {
        continue;
      }

      for (const userId of userIds) {
        if (found.has(normalizeId(userId))) {
          continue;
        }

        const count: PositiveNumber = await lookup.countBy({
          query: {
            projectId: data.projectId,
            userId: userId,
          },
          props: {
            isRoot: true,
          },
        });

        if (count.toNumber() > 0) {
          found.add(normalizeId(userId));
        }
      }
    }

    return found;
  }
}
