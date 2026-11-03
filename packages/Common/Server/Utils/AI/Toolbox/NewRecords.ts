import { JSONObject } from "../../../../Types/JSON";
import {
  AI_ACTION_CARD_FACTS,
  AI_ACTION_CARD_LINES,
  AI_ACTION_LINES,
  AIActionCardFact,
  aiActionCardFact,
  AIActionCardWords,
  AIActionList,
  aiActionList,
  aiActionResourceByName,
  AIActionSentence,
  aiActionSentence,
  aiActionTerm,
} from "../../../../Types/AI/AIActionWords";
import { getAiAffectedResourceKindInfo } from "../../../../Types/AI/AiAffectedResources";
import AcknowledgedStateUtil from "../../../../Utils/AcknowledgedState";
import ResolvedStateUtil, {
  ResolvedStateList,
} from "../../../../Utils/ResolvedState";
/*
 * Types only: this module reads no service, so the tools that use it at
 * load time (their inputSchema) never wait on the toolbox's import cycle.
 */
import type { LinkedAffectedResource } from "./AffectedResourceLinks";

// How much of a description the card a new record leaves shows.
const CARD_DESCRIPTION_LENGTH: number = 200;

/*
 * WHAT AN INCIDENT OR ALERT ASK AI CREATES TAKES: ITS SEVERITY, AND WHERE
 * IT STARTS.
 *
 * create_incident and create_alert are twins, and what they share lives
 * here, so the two cannot drift apart.
 *
 * THE SEVERITY. The one the call names, matched without regard to case or
 * the spaces around it, else the project's first, of the severities the
 * person may give a new record (never an archived one). The approval card
 * says which before anyone allows it ("Severity: High."): the argument
 * line under it is cut at two lines, and on a phone the severity, written
 * last, was never seen.
 *
 * WHERE IT STARTS. A record starts where every new one starts - the
 * project's created state - and its create sets off what answers a live
 * problem: its on-call policies page people (Common/Utils/StartingStage).
 * Somebody writing up what already happened ("we had a twenty-minute
 * checkout outage this morning, already fixed - record it") needs it to
 * start later, as the create forms' Initial State lets them, so nobody is
 * paged for a problem that is handled or over. The limits, decided for an
 * AI action:
 *
 *   - Two starts, named by what they mean rather than by a state's name:
 *     acknowledged (somebody is on it) and resolved (it is over) - the
 *     project's acknowledged and resolved states, the ones Acknowledge and
 *     Resolve move a record into, whatever the project calls them. No
 *     other state: the model would have to guess a project's own names,
 *     and no third start pages nobody for a different reason.
 *   - Either takes the permission to change the record's state as well as
 *     the permission to create one - what acknowledge_incident and
 *     resolve_incident take. A record that starts acknowledged or resolved
 *     is a record created and then acknowledged or resolved, and it pages
 *     nobody: a person who may file incidents but not close them must not
 *     be able to file one nobody is paged for. Stricter than the Create
 *     form's Initial State, which asks only for the create, on purpose:
 *     an AI action should never be a quieter way to make a change.
 *   - The approval card says so before anyone allows it: "Starts resolved,
 *     so it pages nobody." The card under the answer says "Started
 *     resolved".
 *   - The model is told to ask for one only on the person's word that the
 *     problem is handled or over - never to keep anybody from being paged
 *     about a live problem.
 *
 * Everything else about such a record is OneUptime's one rule
 * (StartingStage): it pages nobody and its feed says why; one that starts
 * resolved is also not grouped, remediated or investigated, and opens no
 * channel; its owners, rules and feed run as for any record.
 */

// Where a new record starts, when not where every new one does.
export enum NewRecordStart {
  // Somebody is on it already: no on-call policy pages anyone.
  Acknowledged = "acknowledged",
  // It is over: it pages nobody, and nothing answers it as a live problem.
  Resolved = "resolved",
}

export const NEW_RECORD_STARTS: ReadonlyArray<string> =
  Object.values(NewRecordStart);

// The argument's name in create_incident and create_alert.
export const INITIAL_STATE_ARGUMENT_NAME: string = "initialState";

// The argument's JSON schema, worded for an incident or an alert.
export function getInitialStateArgumentSchema(noun: string): JSONObject {
  return {
    type: "string",
    enum: [NewRecordStart.Acknowledged, NewRecordStart.Resolved],
    description: `Leave it out for a new ${noun}: it starts where every new ${noun} starts, and its on-call policies page people. Only to write up a problem that already happened, on the user's word: "${NewRecordStart.Acknowledged}" when somebody is already on it, "${NewRecordStart.Resolved}" when it is over. Either way it pages nobody, and a resolved ${noun} is also not grouped, remediated or investigated. Never use it to keep people from being paged about a live problem.`,
  };
}

// What a call asks for.
export interface RequestedStart {
  // The start it names; null when it names none, or one that is neither.
  start: NewRecordStart | null;
  // It names a start that is neither: running it refuses, and says so.
  isInvalid: boolean;
}

export function readRequestedStart(args: JSONObject): RequestedStart {
  const value: unknown = args[INITIAL_STATE_ARGUMENT_NAME];

  if (
    value === undefined ||
    value === null ||
    (typeof value === "string" && !value.trim())
  ) {
    return { start: null, isInvalid: false };
  }

  const named: string =
    typeof value === "string" ? value.trim().toLowerCase() : "";

  if (named === NewRecordStart.Acknowledged) {
    return { start: NewRecordStart.Acknowledged, isInvalid: false };
  }

  if (named === NewRecordStart.Resolved) {
    return { start: NewRecordStart.Resolved, isInvalid: false };
  }

  return { start: null, isInvalid: true };
}

/*
 * Whether the call asks for a start of its own - one it names, or one that
 * is neither: either way it takes the permission to change the record's
 * state, so a value the tool would refuse is never a way past that check.
 */
export function asksForStart(args: JSONObject): boolean {
  const requested: RequestedStart = readRequestedStart(args);

  return requested.start !== null || requested.isInvalid;
}

/*
 * The arguments the person approves, with the start the call names written
 * the one way ("Resolved" -> "resolved"); left as the call wrote them
 * otherwise.
 */
export function withStartWrittenOut(args: JSONObject): JSONObject {
  const requested: RequestedStart = readRequestedStart(args);

  if (!requested.start) {
    return args;
  }

  return { ...args, [INITIAL_STATE_ARGUMENT_NAME]: requested.start };
}

// What running a call that names neither start answers with.
export function getInvalidStartMessage(noun: string): string {
  return `${INITIAL_STATE_ARGUMENT_NAME} must be "${NewRecordStart.Acknowledged}" or "${NewRecordStart.Resolved}". Leave it out for a new ${noun} that pages its on-call policies.`;
}

/*
 * The project's state a record starts in: its acknowledged state - the
 * first from the top flagged acknowledged, where Acknowledge moves a
 * record - or its resolved state. Null when the project has none, which
 * StateOrderGuard never lets happen.
 */
export function pickStartState<T>(data: {
  start: NewRecordStart;
  list: ResolvedStateList;
  states: Array<T>;
}): T | null {
  return data.start === NewRecordStart.Acknowledged
    ? AcknowledgedStateUtil.getAcknowledgedState({
        list: data.list,
        states: data.states,
      })
    : ResolvedStateUtil.getResolvedState({
        list: data.list,
        states: data.states,
      });
}

/*
 * The prepared arguments the approval card's line says in words - the
 * severity it takes ("Severity: High."), and where it starts - which its
 * argument line then leaves out (PreparedMutation.describedArguments).
 */
export function getDescribedNewRecordArguments(
  prepared: JSONObject,
): Array<string> {
  return [
    ...(typeof prepared["severityName"] === "string" &&
    prepared["severityName"].trim()
      ? ["severityName"]
      : []),
    ...(readRequestedStart(prepared).start
      ? [INITIAL_STATE_ARGUMENT_NAME]
      : []),
  ];
}

// The approval card's sentence about where it starts; none for a new record.
export function describeStartForPerson(
  start: NewRecordStart | null,
): AIActionSentence | null {
  if (start === NewRecordStart.Acknowledged) {
    return aiActionSentence(AI_ACTION_LINES.startsAcknowledged);
  }

  if (start === NewRecordStart.Resolved) {
    return aiActionSentence(AI_ACTION_LINES.startsResolved);
  }

  return null;
}

// The line of the card it leaves: "Started resolved"; none for a new record.
export function describeStartOnCard(
  start: NewRecordStart | null,
): AIActionSentence | null {
  if (start === NewRecordStart.Acknowledged) {
    return aiActionSentence(AI_ACTION_CARD_LINES.startedAcknowledged);
  }

  if (start === NewRecordStart.Resolved) {
    return aiActionSentence(AI_ACTION_CARD_LINES.startedResolved);
  }

  return null;
}

// What the model is told the record set off, for one that started later.
export function describeStartForModel(
  start: NewRecordStart | null,
  noun: string,
): string {
  if (start === NewRecordStart.Acknowledged) {
    return `It started in the project's acknowledged state, so no on-call policy paged anyone; its feed says why. Its rules, owners and feed ran as for any new ${noun}.`;
  }

  if (start === NewRecordStart.Resolved) {
    return `It started in the project's resolved state: no on-call policy paged anyone, and it is not grouped into an episode, remediated or investigated, and no Slack or Microsoft Teams channel is opened for it. Its rules, owners and feed ran as for any new ${noun}.`;
  }

  return "";
}

/*
 * The approval card's line under "Create incident: <title>": the severity
 * it takes, where it starts when it starts later, then what it is linked
 * to - 'Severity: High. Starts resolved, so it pages nobody. Linked to
 * host "test01".' Each a sentence of Types/AI/AIActionWords, the
 * severity's name as the project wrote it; none when there is nothing to
 * say.
 */
export function describeNewRecordForPerson(data: {
  severityName: string | null;
  start?: NewRecordStart | null | undefined;
  linked: Array<AIActionSentence>;
}): Array<AIActionSentence> {
  const start: AIActionSentence | null = describeStartForPerson(
    data.start || null,
  );

  return [
    ...(data.severityName
      ? [
          aiActionSentence(AI_ACTION_LINES.severity, {
            severity: data.severityName,
          }),
        ]
      : []),
    ...(start ? [start] : []),
    ...data.linked,
  ];
}

/*
 * Resources, for a card's words: 'host "test01"', the kind in the reader's
 * words, listed the way the reader's language lists them.
 */
export function describeResourcesForCard(
  linked: Array<LinkedAffectedResource>,
): AIActionList {
  return aiActionList(
    linked.map((resource: LinkedAffectedResource): AIActionSentence => {
      return aiActionResourceByName({
        noun: getAiAffectedResourceKindInfo(resource.kind).noun,
        name: resource.name,
      });
    }),
  );
}

/*
 * The card a new incident or alert leaves under the answer
 * (WidgetBuilder.actionCard): its kind, the severity it took and where it
 * started, then what it is linked to and the start of its description -
 * "INCIDENT", "Severity: High · Started resolved", "Affected resources:
 * host "test01"". Its number and title are the card's heading.
 */
export function describeNewRecordCard(data: {
  // One of AI_ACTION_CARD_KINDS.
  kind: string;
  severityName: string | undefined;
  start: NewRecordStart | null;
  linked: Array<LinkedAffectedResource>;
  description: string;
}): AIActionCardWords {
  const started: AIActionSentence | null = describeStartOnCard(data.start);
  const line: Array<AIActionSentence> = [
    ...(data.severityName
      ? [
          aiActionSentence(AI_ACTION_CARD_LINES.severity, {
            severity: data.severityName,
          }),
        ]
      : []),
    ...(started ? [started] : []),
  ];
  const facts: Array<AIActionCardFact> = [
    ...(data.linked.length > 0
      ? [
          aiActionCardFact(
            AI_ACTION_CARD_FACTS.affectedResources,
            describeResourcesForCard(data.linked),
          ),
        ]
      : []),
    ...(data.description
      ? [
          aiActionCardFact(
            AI_ACTION_CARD_FACTS.description,
            data.description.length > CARD_DESCRIPTION_LENGTH
              ? `${data.description.substring(0, CARD_DESCRIPTION_LENGTH)}…`
              : data.description,
          ),
        ]
      : []),
  ];

  return {
    kind: aiActionTerm(data.kind),
    ...(line.length > 0 ? { line } : {}),
    ...(facts.length > 0 ? { facts } : {}),
  };
}

/*
 * The card linking an existing incident or alert leaves: what it added -
 * 'Linked to host "test01"' - and what it listed already; when it added
 * nothing, what it was linked to already.
 */
export function describeLinkingCard(data: {
  // One of AI_ACTION_CARD_KINDS.
  kind: string;
  added: Array<LinkedAffectedResource>;
  alreadyLinked: Array<LinkedAffectedResource>;
}): AIActionCardWords {
  const line: Array<AIActionSentence> =
    data.added.length > 0
      ? [
          aiActionSentence(AI_ACTION_CARD_LINES.linkedTo, {
            resources: describeResourcesForCard(data.added),
          }),
        ]
      : data.alreadyLinked.length > 0
        ? [
            aiActionSentence(AI_ACTION_CARD_LINES.alreadyLinkedTo, {
              resources: describeResourcesForCard(data.alreadyLinked),
            }),
          ]
        : [];
  const facts: Array<AIActionCardFact> =
    data.added.length > 0 && data.alreadyLinked.length > 0
      ? [
          aiActionCardFact(
            AI_ACTION_CARD_FACTS.alreadyLinked,
            describeResourcesForCard(data.alreadyLinked),
          ),
        ]
      : [];

  return {
    kind: aiActionTerm(data.kind),
    ...(line.length > 0 ? { line } : {}),
    ...(facts.length > 0 ? { facts } : {}),
  };
}

// A severity of the project, as the severity services read it.
export interface NamedSeverity {
  name?: string | undefined;
}

// The severity a new record takes, and whether it is the one the call named.
export interface SeverityChoice<T extends NamedSeverity> {
  severity: T;
  // False when the call named none, or one the project does not have.
  isNamed: boolean;
}

/*
 * The severity a new record takes: the one the call names, matched without
 * regard to case or the spaces around it, else the project's first of
 * `severities` (in the project's order). Null when the project has none.
 */
export function pickNamedSeverity<T extends NamedSeverity>(data: {
  severities: Array<T>;
  severityName: string | undefined;
}): SeverityChoice<T> | null {
  const first: T | undefined = data.severities[0];

  if (!first) {
    return null;
  }

  const wanted: string = (data.severityName || "").trim().toLowerCase();

  if (wanted) {
    const named: T | undefined = data.severities.find(
      (severity: T): boolean => {
        return (severity.name || "").trim().toLowerCase() === wanted;
      },
    );

    if (named) {
      return { severity: named, isNamed: true };
    }
  }

  return { severity: first, isNamed: false };
}

/*
 * What the model is told when the severity it named is not the project's:
 * the one the record took, and the ones there are.
 */
export function describeSeverityNotFound(data: {
  noun: string;
  severityName: string;
  taken: string;
  severities: Array<NamedSeverity>;
}): string {
  return `No ${data.noun} severity of this project is named ${JSON.stringify(data.severityName)}, so it took the first, ${data.taken}. The project's ${data.noun} severities: ${data.severities
    .map((item: NamedSeverity): string => {
      return item.name || "";
    })
    .filter((name: string): boolean => {
      return Boolean(name);
    })
    .join(", ")}.`;
}
