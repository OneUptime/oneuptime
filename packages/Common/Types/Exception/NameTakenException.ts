import BadDataExceptionWithDetails from "./BadDataExceptionWithDetails";

/*
 * A CREATE OR A RENAME REFUSED BECAUSE ANOTHER RECORD OF ITS KIND HAS THE
 * NAME (#9855, #10065).
 *
 * Many kinds hold a name one of its kind in a project: teams, labels,
 * on-call policies and on-call schedules (Types/Database/UniqueName), the
 * kinds whose model marks its name @UniqueColumnBy (incident severities,
 * monitor statuses, status pages, dashboards, workflows and some sixty
 * more), the resources telemetry is matched to by name, custom roles,
 * variables and the rest. Their refusal is bad data (400), as it always
 * was. Its message is the refusal's English sentence, which a person
 * reads, the Dashboard says in the reader's language, and a later release
 * may reword. Beside it is a code a program can rely on in every release:
 *
 *   { "error": "There is already a team called Primary in this project. Pick another name.",
 *     "refusalCode": "name_taken" }
 *
 * ("message" in place of "error" where a route answers with
 * Response.sendErrorResponse.) The AI run refusals put their code in the
 * same field (Types/AI/AiRunRefusal), so a client reads one field whatever
 * refused.
 *
 * THE CODE SAYS WHAT HOLDS THE NAME, so a client knows whether asking again
 * can help:
 *
 *   - "name_taken": a record in service. Another resource of the same
 *     Terraform apply may be renaming it away, or deleting it, at this
 *     moment, so the provider asks again for a while (Scripts/
 *     TerraformProvider/Core/ProviderGenerator.ts) and a chain of renames,
 *     or a create onto a name a deleted resource gives up, converges in
 *     one apply.
 *   - "name_taken_by_archived": an archived record. Somebody retired it:
 *     its name stays taken, unarchived it would be a twin, and nothing an
 *     apply does to the records in service gives the name up. The provider
 *     answers at once, with the server's sentence, which says to unarchive
 *     it or pick another name, rather than wait for nothing.
 *
 * Nothing was written: the name is checked before the record is saved, or
 * the database refused the write. So a client may ask again once the other
 * record gives the name up. A refusal of one update that would give several
 * records one name carries no code: asking it again changes nothing.
 *
 * A value that is not a name, but that a record holds alone - a domain, a
 * host's identifier, an SSO provider's sign-on URL - is refused the same
 * way with codes of its own, "value_taken" and "value_taken_by_archived"
 * (ValueTakenException, #10319).
 *
 * React-free and server-safe.
 */

// The field of a refused request's answer that carries its code.
export const REFUSAL_CODE_FIELD: string = "refusalCode";

// A record in service of the kind has the name: it may be given up.
export const NAME_TAKEN_REFUSAL_CODE: string = "name_taken";

// An archived record of the kind has the name: unarchive it, or pick another.
export const NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE: string =
  "name_taken_by_archived";

// Both, for a client that tells any taken name from every other refusal.
export const NAME_TAKEN_REFUSAL_CODES: ReadonlyArray<string> = [
  NAME_TAKEN_REFUSAL_CODE,
  NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
];

// What a refusal knows of the record that has the name.
export interface NameHolder {
  // It is archived (Utils/ArchivableValues, or a resource's own archive).
  isArchived?: boolean | undefined;
}

// The code of a refusal of a name the given record has.
export const getNameTakenRefusalCode: (holder?: NameHolder) => string = (
  holder?: NameHolder,
): string => {
  return holder?.isArchived
    ? NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE
    : NAME_TAKEN_REFUSAL_CODE;
};

export default class NameTakenException extends BadDataExceptionWithDetails {
  // Whether the record that has the name is archived.
  public readonly isTakenByArchived: boolean;

  public constructor(message: string, holder?: NameHolder) {
    super(message, { [REFUSAL_CODE_FIELD]: getNameTakenRefusalCode(holder) });
    this.isTakenByArchived = Boolean(holder?.isArchived);
  }
}
