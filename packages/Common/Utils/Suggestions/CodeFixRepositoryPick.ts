import { JSONObject } from "../../Types/JSON";

/*
 * WHO MAY START A FIX WITH AI, AND IN WHICH REPOSITORY (#11075, #11209).
 *
 * Every Fix with AI a person asks for outside Code starts a code task on
 * their behalf: a trace's Fix performance with AI, an incident's or alert's
 * Open fix pull request (Fix the Cause), a service's Improve Logging and
 * Improve Tracing. Each is held to the rule Code holds a request to: the
 * person may use the repository the fix works in, in Code - read it, and
 * ask OneUptime AI to work in it (Code's own rule, CodeTaskAccess) - and it
 * is connected. The create routes enforce it whatever the page offered, in
 * these words (CodeFixPersonRepository, on the server), and the pages offer
 * the fix by the same rule:
 *
 *   - a person who may use none of the connected repositories is offered
 *     nothing - unless the bill or the plan stops everyone first, which the
 *     page says as Code would;
 *   - when no repository was found to hold the code for certain and several
 *     are the person's to use, the page asks which (the choices below), and
 *     its picker searches only those.
 */

// A connected repository the person may have the fix made in.
export interface CodeFixRepositoryChoice {
  id: string;
  name: string;
}

/*
 * The most repositories one suggestion lists: a bound on what one answer
 * carries. The list says a pick is asked for (more than one); the page's
 * picker searches, on the server, every connected repository the person
 * may ask OneUptime AI to work in, and the server takes a pick past these
 * too (#10921).
 */
export const MAX_CODE_FIX_REPOSITORY_CHOICES: number = 200;

/*
 * The server's refusal of a pick that is not one of the project's connected
 * repositories AI can work in.
 */
export const PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE: string =
  "That repository is not one of this project's connected repositories OneUptime AI can work in. Pick another, or connect it in Code.";

// A pick the person may not read: not found, or not theirs to see.
export const PICKED_REPOSITORY_NOT_FOUND_MESSAGE: string =
  "That repository was not found, or you do not have access to it in Code. Pick another.";

// A pick the person may read, but may not ask OneUptime AI to work in.
export const PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE: string =
  "You can read that repository, but asking OneUptime AI to work in it takes permission to edit it in Code. Pick another, or ask a Project Admin for that permission.";

/*
 * Repositories are connected, but none the person may use in Code: no
 * repository the fix could work in is theirs to ask in.
 */
export const NO_REPOSITORY_YOU_MAY_USE_MESSAGE: string =
  "None of this project's connected repositories is one you may ask OneUptime AI to work in. Asking it to work in a repository takes permission to edit that repository in Code - ask a Project Admin for it.";

/*
 * The refusals that leave a pick the person cannot make again: the page
 * clears the pick, and its search - held to the repositories the person
 * may use - no longer offers it.
 */
export const PICK_REFUSAL_MESSAGES: ReadonlyArray<string> = [
  PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE,
  PICKED_REPOSITORY_NOT_FOUND_MESSAGE,
  PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE,
];

// Whether a refusal the server sent says the pick cannot be made again.
export function isPickRefusal(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }

  return PICK_REFUSAL_MESSAGES.some((refusal: string): boolean => {
    return message.includes(refusal);
  });
}

function parseChoice(value: unknown): CodeFixRepositoryChoice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: JSONObject = value as JSONObject;
  const id: unknown = record["id"];
  const name: unknown = record["name"];

  if (
    typeof id !== "string" ||
    !id.trim() ||
    typeof name !== "string" ||
    !name.trim()
  ) {
    return null;
  }

  return { id: id.trim(), name: name.trim() };
}

/*
 * The choices off the wire: whole entries only, each once, at most
 * MAX_CODE_FIX_REPOSITORY_CHOICES, in the order the server sent. One
 * repository is no choice (the fix would work in it anyway), so a list of
 * fewer than two reads as none.
 */
export function parseCodeFixRepositoryChoices(
  value: unknown,
): Array<CodeFixRepositoryChoice> {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen: Set<string> = new Set();
  const choices: Array<CodeFixRepositoryChoice> = [];

  for (const entry of value as Array<unknown>) {
    const choice: CodeFixRepositoryChoice | null = parseChoice(entry);

    if (!choice || seen.has(choice.id.toLowerCase())) {
      continue;
    }

    seen.add(choice.id.toLowerCase());
    choices.push(choice);

    if (choices.length >= MAX_CODE_FIX_REPOSITORY_CHOICES) {
      break;
    }
  }

  return choices.length > 1 ? choices : [];
}

// The choices as JSON (the server's side of the parser above).
export function codeFixRepositoryChoicesToJSON(
  choices: ReadonlyArray<CodeFixRepositoryChoice>,
): Array<JSONObject> {
  return choices.map((choice: CodeFixRepositoryChoice): JSONObject => {
    return { id: choice.id, name: choice.name };
  });
}
