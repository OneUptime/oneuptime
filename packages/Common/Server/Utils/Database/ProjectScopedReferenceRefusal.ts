import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";

/*
 * What every reference check shares, apart from the reads it makes: how a
 * payload names a record, and how a reference that cannot be used is
 * refused. The checks themselves (ProjectScopedReferenceValidator, which
 * reads through DatabaseService) and the create check of the permission
 * layer (CreatePermission.checkParentPermission, which DatabaseService loads)
 * both use it, so it depends on neither.
 */

/*
 * Thrown when a payload references records that are not the project's:
 * another project's, ones that do not exist, or users who are not members.
 * A BadDataException, so API callers see a 400 with the message; its own
 * type lets a chat reply say something fixed instead of echoing the ids.
 */
export class ProjectScopedReferenceException extends BadDataException {}

/*
 * Thrown when a record is created under a parent its creator may not read
 * (CreatePermission.checkParentPermission). Worded and answered like every
 * other reference refusal, so such a parent reads like one that does not
 * exist; its own type lets code that writes under many parents at once (a
 * status change across monitors) leave out the ones its caller may not read
 * and go on with the others.
 */
export class UnreadableParentException extends ProjectScopedReferenceException {}

// The one refusal every reference check answers with.
export function getReferenceRefusalMessage(data: {
  subject?: string | undefined;
  // `Label "<id>"`, as describeReferences describes each.
  described: Array<string>;
}): string {
  return `This ${data.subject || "request"} references records that are not in this project: ${data.described.join(", ")}. Please pick values from this project and try again.`;
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
