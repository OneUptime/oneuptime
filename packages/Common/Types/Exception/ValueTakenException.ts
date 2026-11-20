import BadDataExceptionWithDetails from "./BadDataExceptionWithDetails";
import { NameHolder, REFUSAL_CODE_FIELD } from "./NameTakenException";
import { JSONObject } from "../JSON";

/*
 * A CREATE OR A CHANGE REFUSED BECAUSE ANOTHER RECORD HAS A VALUE THAT IS
 * NOT A NAME, BUT THAT A RECORD MUST HOLD ALONE (#10319).
 *
 * A name another record of its kind has is refused with "name_taken"
 * (NameTakenException). So are the other values a record holds alone, in
 * their own code: a status page's, a dashboard's or a form's domain, a
 * project domain, a host's, a Docker or Podman host's or a Kubernetes
 * cluster's identifier, an SSO provider's sign-on URL, an API key's
 * permission, a network address's name, and every value a unique index or
 * @UniqueColumnsTogether holds. Still bad data (400), with the refusal's
 * sentence as its message, and beside it the code, and the field whose
 * value is taken when one field is:
 *
 *   { "error": "Status Page Domain with the same fullDomain already exists.",
 *     "refusalCode": "value_taken", "field": "fullDomain" }
 *
 * ("message" in place of "error" where a route answers with
 * Response.sendErrorResponse.) As with a name, the code says what holds the
 * value, so a client knows whether asking again can help:
 *
 *   - "value_taken": a record in service. Another resource of the same
 *     Terraform apply may be giving it up at this moment - a status page
 *     domain moved from one resource to another is one deleted and one
 *     created, side by side - so the provider asks again for a while
 *     (Scripts/TerraformProvider/Core/ProviderGenerator.ts), and the move
 *     converges in one apply.
 *   - "value_taken_by_archived": only an archived record. Nothing an apply
 *     does to the records in service gives it up: the provider answers at
 *     once, with the server's sentence, which says to unarchive the record
 *     or pick another value.
 *
 * Nothing was written: the value is checked before the record is saved, or
 * the database refused the write. A refusal of one update that would give
 * several records one value carries no code: asking it again changes
 * nothing.
 *
 * React-free and server-safe.
 */

// A record in service has the value: it may be given up.
export const VALUE_TAKEN_REFUSAL_CODE: string = "value_taken";

// An archived record has the value: unarchive it, or pick another.
export const VALUE_TAKEN_BY_ARCHIVED_REFUSAL_CODE: string =
  "value_taken_by_archived";

// Both, for a client that tells any taken value from every other refusal.
export const VALUE_TAKEN_REFUSAL_CODES: ReadonlyArray<string> = [
  VALUE_TAKEN_REFUSAL_CODE,
  VALUE_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
];

// The field of the answer that names the field whose value is taken.
export const TAKEN_FIELD_DETAIL: string = "field";

// What a refusal knows of the value and the record that has it.
export interface TakenValue extends NameHolder {
  /*
   * The field whose value is taken, as the API names it: "fullDomain".
   * Left out when the value is several fields' together.
   */
  field?: string | undefined;
}

// The code of a refusal of a value the given record has.
export const getValueTakenRefusalCode: (holder?: NameHolder) => string = (
  holder?: NameHolder,
): string => {
  return holder?.isArchived
    ? VALUE_TAKEN_BY_ARCHIVED_REFUSAL_CODE
    : VALUE_TAKEN_REFUSAL_CODE;
};

export default class ValueTakenException extends BadDataExceptionWithDetails {
  // Whether the record that has the value is archived.
  public readonly isTakenByArchived: boolean;

  // The field whose value is taken, or null when several fields' together are.
  public readonly field: string | null;

  public constructor(message: string, taken?: TakenValue) {
    const details: JSONObject = {
      [REFUSAL_CODE_FIELD]: getValueTakenRefusalCode(taken),
    };

    if (taken?.field) {
      details[TAKEN_FIELD_DETAIL] = taken.field;
    }

    super(message, details);
    this.isTakenByArchived = Boolean(taken?.isArchived);
    this.field = taken?.field || null;
  }
}
