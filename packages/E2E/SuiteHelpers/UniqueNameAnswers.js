/*
 * WHETHER ANOTHER RECORD HAS A NAME, AS AN OFFLINE FIXTURE'S SERVER ANSWERS
 * IT (#10761).
 *
 * Every model form of a kind with a name of its own in a project - a
 * monitor, a template, a key, a hunt, a budget and the rest - asks
 * GET /unique-names/check?tableName=<kind>&name=<name> (and &exceptId=<id>
 * on an edit) a moment after its name field stops changing, and warns under
 * the field when another record of the kind has the name
 * (Common/UI/Components/Forms/DuplicateNameNotice). Project Settings >
 * Project's Unique Names card reads GET /unique-names/duplicates, the names
 * the project holds more than once (Types/Database/RequiredUniqueNames).
 *
 * A fixture answers both with answerUniqueNames, beside the other routes it
 * models:
 *
 *   const names = answerUniqueNames({ url });
 *   if (names) {
 *     return ok(names);
 *   }
 *
 * A fixture's project does not require unique names and holds no name
 * twice, and a name a spec types is one no other record has: so the check
 * names no record and says nothing would be refused, and the duplicates are
 * none - the answers the server gives such a project, written by the
 * server's own JSON writers. A fixture that holds a record a spec's name
 * should be found taken by passes `takenBy`: (tableName, name, exceptId) =>
 * { id, name, isArchived } or null.
 */
import {
  toDuplicateNamesAnswerJSON,
  toUniqueNameCheckAnswerJSON,
  UNIQUE_NAME_CHECK_PARAMS,
  UNIQUE_NAME_CHECK_ROUTE,
  UNIQUE_NAME_DUPLICATES_ROUTE,
} from "Common/Types/Database/RequiredUniqueNames";

/*
 * The answer to GET <url> - a URL, or text, absolute or a path - as JSON, or
 * null when <url> is neither route.
 */
export function answerUniqueNames(data) {
  const url = new URL(String(data.url), "http://fixture.invalid");
  const route = url.pathname.replace(/^\/api(?=\/)/, "");

  if (route === UNIQUE_NAME_CHECK_ROUTE) {
    const takenBy = data.takenBy
      ? data.takenBy(
          url.searchParams.get(UNIQUE_NAME_CHECK_PARAMS.tableName) || "",
          url.searchParams.get(UNIQUE_NAME_CHECK_PARAMS.name) || "",
          url.searchParams.get(UNIQUE_NAME_CHECK_PARAMS.exceptId),
        )
      : null;

    return toUniqueNameCheckAnswerJSON({
      isRequired: false,
      takenBy: takenBy || null,
      isTakenByUnreadable: false,
    });
  }

  if (route === UNIQUE_NAME_DUPLICATES_ROUTE) {
    return toDuplicateNamesAnswerJSON({ requireUniqueNames: false, kinds: [] });
  }

  return null;
}
