import BadDataExceptionWithDetails from "./BadDataExceptionWithDetails";

/*
 * A CREATE OR A RENAME REFUSED BECAUSE ANOTHER RECORD OF ITS KIND IN THE
 * PROJECT HAS THE NAME (#9855).
 *
 * Teams, labels, on-call policies and on-call schedules each have a name of
 * their own in a project (Types/Database/UniqueName). Their refusal is bad
 * data (400), as it always was. Its message is the refusal's English
 * sentence, which a person reads, the Dashboard says in the reader's
 * language, and a later release may reword. Beside it is a code a program
 * can rely on in every release:
 *
 *   { "error": "There is already a team called Primary in this project. Pick another name.",
 *     "refusalCode": "name_taken" }
 *
 * ("message" in place of "error" where a route answers with
 * Response.sendErrorResponse.) The AI run refusals put their code in the
 * same field (Types/AI/AiRunRefusal), so a client reads one field whatever
 * refused.
 *
 * Nothing was written: the name is checked before the record is saved
 * (UniqueNameInProject, ArchivableValueGuard, LabelService). So a client may
 * ask again once the other record gives the name up. The Terraform provider
 * does, for a rename onto a name another resource of the same apply is
 * giving up, and reads the code, never the sentence: its client is
 * generated with these constants (Scripts/TerraformProvider/Core
 * /ProviderGenerator.ts).
 *
 * React-free and server-safe.
 */

// The field of a refused request's answer that carries its code.
export const REFUSAL_CODE_FIELD: string = "refusalCode";

// The code of a refusal of a name another record of the project has.
export const NAME_TAKEN_REFUSAL_CODE: string = "name_taken";

export default class NameTakenException extends BadDataExceptionWithDetails {
  public constructor(message: string) {
    super(message, { [REFUSAL_CODE_FIELD]: NAME_TAKEN_REFUSAL_CODE });
  }
}
