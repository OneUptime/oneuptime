/*
 * WHAT ONEUPTIME AI IS ASKED WHEN AN ACTION ITEM BECOMES A PULL REQUEST OR
 * A TEST (issue #6801).
 *
 * A postmortem's action item that is a change to code - "Retry the payment
 * call with backoff", "Add a regression test for the auth leak" - is a
 * request in Code: OneUptime AI works in the repository and opens a pull
 * request for review. The request says what the action item is and which
 * incident it comes from; the incident itself (its description, root
 * cause, state and monitors) and its postmortem go with it as context, as
 * a person's own request in Code would carry them.
 *
 *   - Pull request: the change the action item asks for.
 *   - Test: a test that would have caught the incident - it fails on the
 *     code as it was, and passes once the problem is fixed - in the
 *     repository's own framework.
 *
 * A person can add words of their own (instructions), which go after
 * OneUptime's. Written in English, as every request OneUptime makes of the
 * AI is: the request is the AI's to read, not a sentence on a page.
 *
 * Pure: the server builds the request with it, and the tests pin it.
 */

// What a person asked OneUptime AI to write for an action item.
export enum ActionItemCodeTaskKind {
  PullRequest = "PullRequest",
  Test = "Test",
}

export const ALL_ACTION_ITEM_CODE_TASK_KINDS: ReadonlyArray<ActionItemCodeTaskKind> =
  [ActionItemCodeTaskKind.PullRequest, ActionItemCodeTaskKind.Test];

// The longest request a code task takes (CODE_TASK_LIMITS.maxMessageLength).
export const MAX_ACTION_ITEM_REQUEST_LENGTH: number = 10000;

// The most of an action item's description, and of a person's instructions, a request carries.
export const MAX_ACTION_ITEM_DESCRIPTION_IN_REQUEST: number = 3000;
export const MAX_ACTION_ITEM_INSTRUCTIONS_LENGTH: number = 3000;

// The most of the postmortem's note the request's context carries (CODE_TASK_LIMITS.maxNoteLength).
export const MAX_POSTMORTEM_IN_CONTEXT: number = 4000;

export interface ActionItemCodeTaskRequestInput {
  kind: ActionItemCodeTaskKind;
  // The action item's title and description.
  title: string;
  description?: string | null | undefined;
  // The incident, as people name it: "#42" or "INC-42", and its title.
  incidentNumber?: string | null | undefined;
  incidentTitle?: string | null | undefined;
  /*
   * A private incident (#9186): everyone with access to the repository
   * reads the pull request, which quotes the request, so the request names
   * the incident by its number alone and asks the AI to leave the incident
   * out of what it writes there, as a fix pull request about a private
   * record does (#9165). The AI still reads the incident and its
   * postmortem, which go with the request as context.
   */
  incidentIsPrivate?: boolean | undefined;
  // What the person asking added, if anything.
  instructions?: string | null | undefined;
}

/*
 * What the request asks of the pull request for a private incident: the
 * repository's readers are not the incident's.
 */
export const PRIVATE_INCIDENT_PULL_REQUEST_INSTRUCTION: string =
  "The incident is private, and everyone with access to this repository reads the pull request: leave the incident and its postmortem out of the pull request, its commit messages and the code's comments, and name the incident only by its number.";

// Reads a kind off the wire: anything else is null.
export function parseActionItemCodeTaskKind(
  value: unknown,
): ActionItemCodeTaskKind | null {
  if (
    typeof value === "string" &&
    (ALL_ACTION_ITEM_CODE_TASK_KINDS as ReadonlyArray<string>).includes(value)
  ) {
    return value as ActionItemCodeTaskKind;
  }

  return null;
}

function cut(text: string, maxLength: number): string {
  const trimmed: string = text.trim();

  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength - 1).trimEnd()}…`
    : trimmed;
}

/*
 * "incident #42: Checkout returns 503s", or as much of it as is known - a
 * private incident by its number alone.
 */
function describeIncident(input: ActionItemCodeTaskRequestInput): string {
  const number: string = (input.incidentNumber || "").trim();
  const title: string = input.incidentIsPrivate
    ? ""
    : (input.incidentTitle || "").trim();

  if (number && title) {
    return `incident ${number}: ${title}`;
  }

  if (number) {
    return `incident ${number}`;
  }

  if (title) {
    return `the incident "${title}"`;
  }

  return "an incident";
}

// The request OneUptime AI is sent for an action item.
export function buildActionItemCodeTaskRequest(
  input: ActionItemCodeTaskRequestInput,
): string {
  const lines: Array<string> = [
    `This is an action item from the postmortem of ${describeIncident(input)}. The incident and its postmortem are attached.`,
    "",
    `Action item: ${input.title.trim()}`,
  ];

  const description: string = cut(
    input.description || "",
    MAX_ACTION_ITEM_DESCRIPTION_IN_REQUEST,
  );

  if (description) {
    lines.push("", description);
  }

  lines.push("");

  if (input.kind === ActionItemCodeTaskKind.Test) {
    lines.push(
      "Write an automated test that would have caught this incident before it reached production: it should fail on the code as it was when the incident happened, and pass once the problem is fixed. If the code is already fixed, the test should pass now and guard against the problem coming back.",
      "Use the repository's own test framework and conventions, put the test where the repository keeps its tests, and change no code besides the test unless the test cannot run without it.",
      input.incidentIsPrivate
        ? "Open a pull request with the test."
        : "Open a pull request with the test, and say in it which incident it guards against.",
    );
  } else {
    lines.push(
      "Make the change this action item asks for in this repository, and open a pull request with it for review.",
      input.incidentIsPrivate
        ? "Keep the change to what the action item needs, and add or update tests that cover it."
        : "Keep the change to what the action item needs, add or update tests that cover it, and say in the pull request which incident it is for.",
    );
  }

  if (input.incidentIsPrivate) {
    lines.push(PRIVATE_INCIDENT_PULL_REQUEST_INSTRUCTION);
  }

  const instructions: string = cut(
    input.instructions || "",
    MAX_ACTION_ITEM_INSTRUCTIONS_LENGTH,
  );

  if (instructions) {
    lines.push("", `From the person who asked: ${instructions}`);
  }

  return cut(lines.join("\n"), MAX_ACTION_ITEM_REQUEST_LENGTH);
}

/*
 * The postmortem as a note of the request's context, when it has one: what
 * the team wrote about the incident, cut to what a note holds.
 */
export function getPostmortemContextNote(
  postmortemNote: string | null | undefined,
): string | null {
  const note: string = (postmortemNote || "").trim();

  if (!note) {
    return null;
  }

  return cut(
    `The incident's postmortem:\n\n${note}`,
    MAX_POSTMORTEM_IN_CONTEXT,
  );
}
