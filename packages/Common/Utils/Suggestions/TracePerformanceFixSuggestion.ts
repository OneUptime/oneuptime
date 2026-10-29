import {
  ImplicatedSpan,
  PerformanceFinding,
  PerformanceFindingType,
} from "../../Types/AI/CodeFixTaskContext";
import { JSONObject } from "../../Types/JSON";
import {
  FinishedFixOutcome,
  getCodeFixOffer,
  parseFinishedFixOutcome,
} from "./CodeFixSuggestion";
import {
  parseSuggestionBlocker,
  SuggestionBlocker,
  suggestionBlockerToJSON,
} from "./SuggestionBlocker";
import SuggestionOffer, { parseSuggestionOffer } from "./SuggestionOffer";

/*
 * IS THIS TRACE WORTH "FIX PERFORMANCE WITH AI"?
 *
 * The span-tree analysis (Common/Utils/Traces/SpanTreeAnalyzer) finds the
 * known performance patterns in a trace. On its own it is far too eager to
 * drive a button: a 4 ms request whose one 3 ms database call is "most of
 * the request" is a pattern, and so is a single-span health check (its one
 * span is 100% of it). The button showed on every trace for that reason.
 *
 * A finding is worth a fix when the time it costs is real - in absolute
 * terms AND as a share of the request:
 *
 *   - the same call made again and again (N+1, 5+ near-identical calls under
 *     one parent): together at least 100 ms;
 *   - calls made one after another that could run together (3+ calls,
 *     half of their parent or more): together at least 100 ms;
 *   - one call that takes most of the request on its own (60%+ of the trace
 *     in its own work): at least 500 ms - a single 150 ms query or a 300 ms
 *     call to a payment provider is ordinary, so this pattern needs more
 *     time before it is a problem worth a pull request;
 *
 * and in every case at least a tenth of the request.
 *
 * Why absolute floors and not "slower than this operation usually is": an
 * endpoint that ALWAYS runs the same query 40 times is the one most worth
 * fixing, and it never looks slower than its own usual. The floors need no
 * query beyond the trace itself, so the server's create gate and the page's
 * suggestion decide from exactly the same findings. A slow trace with no
 * known pattern is not offered: the AI would have nothing grounded to fix,
 * and the server would refuse it.
 *
 * Both the suggestion route (what the trace page draws) and the create
 * route (what the server accepts) run getFindingsWorthFixing, so the page
 * never offers a fix the server then refuses.
 */

// The least time each pattern must cost, in milliseconds.
export const WORTH_FIXING_MIN_MS: Readonly<
  Record<PerformanceFindingType, number>
> = {
  [PerformanceFindingType.NPlusOneQuery]: 100,
  [PerformanceFindingType.SequentialSiblings]: 100,
  [PerformanceFindingType.DominantSpan]: 500,
};

// The least share of the whole trace a finding must cost, in percent.
export const WORTH_FIXING_MIN_PERCENT_OF_TRACE: number = 10;

/*
 * The server's refusal when nothing in a trace clears the rule, in the same
 * words the docs use. The trace page never offers the button for such a
 * trace, so people only meet this through the API.
 */
export const TRACE_NOT_WORTH_FIXING_MESSAGE: string = `Nothing in this trace is worth an AI performance fix. Fix performance with AI acts on a known pattern that costs the request real time: the same call made 5 or more times (${WORTH_FIXING_MIN_MS[PerformanceFindingType.NPlusOneQuery]} ms or more together), 3 or more calls made one after another that could run together (${WORTH_FIXING_MIN_MS[PerformanceFindingType.SequentialSiblings]} ms or more together), or one call that takes most of the request on its own (${WORTH_FIXING_MIN_MS[PerformanceFindingType.DominantSpan]} ms or more) - in every case at least ${WORTH_FIXING_MIN_PERCENT_OF_TRACE}% of the request.`;

export function isFindingWorthFixing(finding: PerformanceFinding): boolean {
  const minimumMs: number | undefined =
    WORTH_FIXING_MIN_MS[finding.findingType];

  // A pattern this build does not know is never offered.
  if (minimumMs === undefined) {
    return false;
  }

  if (
    !Number.isFinite(finding.combinedDurationMs) ||
    !Number.isFinite(finding.percentOfTrace)
  ) {
    return false;
  }

  return (
    finding.combinedDurationMs >= minimumMs &&
    finding.percentOfTrace >= WORTH_FIXING_MIN_PERCENT_OF_TRACE
  );
}

/*
 * The findings worth a fix, in the order the analysis ranked them (the
 * costliest first), so the first one is what the page names.
 */
export function getFindingsWorthFixing(
  findings: ReadonlyArray<PerformanceFinding>,
): Array<PerformanceFinding> {
  return findings.filter((finding: PerformanceFinding): boolean => {
    return isFindingWorthFixing(finding);
  });
}

export interface TracePerformanceFixOfferInput {
  // Every finding of the trace's span-tree analysis.
  findings: ReadonlyArray<PerformanceFinding>;
  isAiEnabled: boolean;
  // A FixPerformance run for this trace is already queued or running.
  hasActiveFix: boolean;
  /*
   * How the fix for this trace came out, when one already did its work
   * (getFinishedFixOutcome): the trace is not offered a second one.
   */
  finishedFix?: FinishedFixOutcome | null | undefined;
  hasConnectedRepository: boolean;
  /*
   * What Code's gate says for the run the click would queue
   * (CodeFixStartGate), when it says anything.
   */
  blocker?: SuggestionBlocker | null | undefined;
}

export interface TracePerformanceFixOffer {
  offer: SuggestionOffer;
  /*
   * The finding the page names - the costliest one worth fixing. Null when
   * the offer is None.
   */
  finding: PerformanceFinding | null;
  // How many findings are worth fixing (the pull request covers them all).
  findingCount: number;
  // Done: how the fix came out.
  fixOutcome: FinishedFixOutcome | null;
  /*
   * SetUp: what stands in the way, in Code's words. Null while the step is
   * a repository to connect.
   */
  blocker: SuggestionBlocker | null;
}

export function getTracePerformanceFixOffer(
  input: TracePerformanceFixOfferInput,
): TracePerformanceFixOffer {
  const worthFixing: Array<PerformanceFinding> = getFindingsWorthFixing(
    input.findings,
  );

  const offer: SuggestionOffer = getCodeFixOffer({
    isAiEnabled: input.isAiEnabled,
    applies: worthFixing.length > 0,
    hasActiveFix: input.hasActiveFix,
    hasFinishedFix: Boolean(input.finishedFix),
    hasConnectedRepository: input.hasConnectedRepository,
    isBlocked: Boolean(input.blocker),
    // The finding is on screen: worth a quiet "connect a repository" link.
    isBackedByEvidence: true,
  });

  if (offer === SuggestionOffer.None) {
    return {
      offer,
      finding: null,
      findingCount: 0,
      fixOutcome: null,
      blocker: null,
    };
  }

  return {
    offer,
    finding: worthFixing[0] || null,
    findingCount: worthFixing.length,
    fixOutcome:
      offer === SuggestionOffer.Done ? input.finishedFix || null : null,
    // A repository to connect comes first: Code's gate needs one to ask.
    blocker:
      offer === SuggestionOffer.SetUp && input.hasConnectedRepository
        ? input.blocker || null
        : null,
  };
}

/*
 * Database work is named as such ("the same database query"), whatever the
 * span happens to be called.
 */
export function isDatabaseFinding(finding: PerformanceFinding): boolean {
  return Boolean(finding.dbSystem || finding.normalizedDbStatement);
}

/*
 * The operation a finding is about, as a person reads it: the spans' own
 * name when every implicated span carries the same one ("SELECT products
 * WHERE id = $1"), otherwise the normalized name the analysis grouped them
 * under ("GET /inventory/{n}"), whose placeholders show the part that
 * changes from call to call.
 */
export function getFindingOperationName(finding: PerformanceFinding): string {
  const names: Array<string> = finding.implicatedSpans
    .map((span: { name: string }): string => {
      return span.name || "";
    })
    .filter((name: string): boolean => {
      return name.trim().length > 0;
    });

  if (
    names.length > 0 &&
    names.every((name: string): boolean => {
      return name === names[0];
    })
  ) {
    return names[0]!;
  }

  return finding.normalizedSpanName;
}

// A connected repository the person can ask the fix in.
export interface TracePerformanceFixRepository {
  id: string;
  name: string;
}

/*
 * The most repositories the page is offered to pick from: far more than a
 * project connects, and a bound on what one answer carries.
 */
export const MAX_TRACE_PERFORMANCE_FIX_REPOSITORIES: number = 200;

/*
 * The server's refusal of a fix the person did not pick a repository for,
 * when several are connected and none was found to hold the trace's code
 * for certain. The trace page asks for the pick first, so people meet this
 * through the API, or on the page after the second repository was
 * connected since it read the list - after "Could not start the fix:",
 * beside the picker the page then shows.
 */
export const PICK_A_REPOSITORY_FOR_THE_FIX_MESSAGE: string =
  "Several repositories are connected, and none could be matched to this trace's service or code. Pick the one that holds this code.";

/*
 * The server's refusal of a pick that is not one of the project's connected
 * repositories AI can work in.
 */
export const PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE: string =
  "That repository is not one of this project's connected repositories OneUptime AI can work in. Pick another, or connect it in Code.";

/*
 * What POST /ai-investigation/performance-fix-suggestion answers, and the
 * trace page reads: the offer, the finding it names, and - when a fix is
 * already on its way, or done - the run to link to.
 */
export interface TracePerformanceFixSuggestion
  extends TracePerformanceFixOffer {
  /*
   * The FixPerformance run to link to: the queued or running one when the
   * offer is InProgress, the one that did its work when it is Done.
   */
  aiRunId: string | null;
  /*
   * Act, when several repositories are connected and none was found to
   * hold the trace's code for certain: the ones the person picks the fix's
   * repository from, by name (the click names the pick). Empty otherwise -
   * the fix then works in the repository the trace's facts resolve to.
   */
  repositories: Array<TracePerformanceFixRepository>;
}

export const NO_TRACE_PERFORMANCE_FIX_SUGGESTION: TracePerformanceFixSuggestion =
  {
    offer: SuggestionOffer.None,
    finding: null,
    findingCount: 0,
    fixOutcome: null,
    blocker: null,
    aiRunId: null,
    repositories: [],
  };

function parseRepository(value: unknown): TracePerformanceFixRepository | null {
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
 * The repositories off the wire: whole entries only, each once, at most
 * MAX_TRACE_PERFORMANCE_FIX_REPOSITORIES, in the order the server sent.
 * One repository is no choice (the fix would work in it anyway), so a list
 * of fewer than two reads as none.
 */
export function parseTracePerformanceFixRepositories(
  value: unknown,
): Array<TracePerformanceFixRepository> {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen: Set<string> = new Set();
  const repositories: Array<TracePerformanceFixRepository> = [];

  for (const entry of value as Array<unknown>) {
    const repository: TracePerformanceFixRepository | null =
      parseRepository(entry);

    if (!repository || seen.has(repository.id.toLowerCase())) {
      continue;
    }

    seen.add(repository.id.toLowerCase());
    repositories.push(repository);

    if (repositories.length >= MAX_TRACE_PERFORMANCE_FIX_REPOSITORIES) {
      break;
    }
  }

  return repositories.length > 1 ? repositories : [];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseImplicatedSpan(value: unknown): ImplicatedSpan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: JSONObject = value as JSONObject;

  if (
    typeof record["spanId"] !== "string" ||
    typeof record["name"] !== "string" ||
    !isFiniteNumber(record["durationMs"])
  ) {
    return null;
  }

  return {
    spanId: record["spanId"],
    name: record["name"],
    durationMs: record["durationMs"],
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/*
 * Reads a finding off the wire, or null when it is not one this build can
 * draw. Only the fields the page draws are required.
 */
export function parsePerformanceFinding(
  value: unknown,
): PerformanceFinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: JSONObject = value as JSONObject;
  const findingType: unknown = record["findingType"];

  if (
    typeof findingType !== "string" ||
    !(Object.values(PerformanceFindingType) as Array<string>).includes(
      findingType,
    ) ||
    !isFiniteNumber(record["spanCount"]) ||
    !isFiniteNumber(record["combinedDurationMs"]) ||
    !isFiniteNumber(record["traceDurationMs"]) ||
    !isFiniteNumber(record["percentOfTrace"]) ||
    typeof record["normalizedSpanName"] !== "string"
  ) {
    return null;
  }

  const implicatedSpans: Array<ImplicatedSpan> = (
    Array.isArray(record["implicatedSpans"])
      ? (record["implicatedSpans"] as Array<unknown>)
      : []
  )
    .map(parseImplicatedSpan)
    .filter((span: ImplicatedSpan | null): span is ImplicatedSpan => {
      return span !== null;
    });

  const finding: PerformanceFinding = {
    findingType: findingType as PerformanceFindingType,
    headline: typeof record["headline"] === "string" ? record["headline"] : "",
    evidence: typeof record["evidence"] === "string" ? record["evidence"] : "",
    spanCount: record["spanCount"] as number,
    combinedDurationMs: record["combinedDurationMs"] as number,
    traceDurationMs: record["traceDurationMs"] as number,
    percentOfTrace: record["percentOfTrace"] as number,
    normalizedSpanName: record["normalizedSpanName"] as string,
    implicatedSpans,
  };

  if (isFiniteNumber(record["percentOfParent"])) {
    finding.percentOfParent = record["percentOfParent"];
  }

  const parentSpanName: string | undefined = optionalString(
    record["parentSpanName"],
  );
  if (parentSpanName) {
    finding.parentSpanName = parentSpanName;
  }

  const normalizedDbStatement: string | undefined = optionalString(
    record["normalizedDbStatement"],
  );
  if (normalizedDbStatement) {
    finding.normalizedDbStatement = normalizedDbStatement;
  }

  const dbSystem: string | undefined = optionalString(record["dbSystem"]);
  if (dbSystem) {
    finding.dbSystem = dbSystem;
  }

  const httpUrl: string | undefined = optionalString(record["httpUrl"]);
  if (httpUrl) {
    finding.httpUrl = httpUrl;
  }

  return finding;
}

/*
 * Reads the suggestion route's answer. Whatever does not hold together - an
 * offer that names no finding, a finding the rule would not offer, an
 * in-progress or done offer with no run, a done offer that does not say how
 * it came out, a set-up step whose blocker this build cannot draw - reads as
 * no suggestion, so the page never draws an action the answer does not
 * fully back. A set-up step with no blocker at all is a repository to
 * connect, as it was before blockers were sent.
 */
export function parseTracePerformanceFixSuggestion(
  value: unknown,
): TracePerformanceFixSuggestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return NO_TRACE_PERFORMANCE_FIX_SUGGESTION;
  }

  const record: JSONObject = value as JSONObject;
  const offer: SuggestionOffer = parseSuggestionOffer(record["offer"]);

  if (offer === SuggestionOffer.None) {
    return NO_TRACE_PERFORMANCE_FIX_SUGGESTION;
  }

  const finding: PerformanceFinding | null = parsePerformanceFinding(
    record["finding"],
  );

  if (!finding || !isFindingWorthFixing(finding)) {
    return NO_TRACE_PERFORMANCE_FIX_SUGGESTION;
  }

  const aiRunId: string | null =
    typeof record["aiRunId"] === "string" && record["aiRunId"].length > 0
      ? record["aiRunId"]
      : null;

  const linksRun: boolean =
    offer === SuggestionOffer.InProgress || offer === SuggestionOffer.Done;

  if (linksRun && !aiRunId) {
    return NO_TRACE_PERFORMANCE_FIX_SUGGESTION;
  }

  const fixOutcome: FinishedFixOutcome | null =
    offer === SuggestionOffer.Done
      ? parseFinishedFixOutcome(record["fixOutcome"])
      : null;

  if (offer === SuggestionOffer.Done && !fixOutcome) {
    return NO_TRACE_PERFORMANCE_FIX_SUGGESTION;
  }

  let blocker: SuggestionBlocker | null = null;

  if (
    offer === SuggestionOffer.SetUp &&
    record["blocker"] !== undefined &&
    record["blocker"] !== null
  ) {
    blocker = parseSuggestionBlocker(record["blocker"]);

    if (!blocker) {
      return NO_TRACE_PERFORMANCE_FIX_SUGGESTION;
    }
  }

  return {
    offer,
    finding,
    findingCount: isFiniteNumber(record["findingCount"])
      ? Math.max(1, Math.floor(record["findingCount"]))
      : 1,
    fixOutcome,
    blocker,
    aiRunId: linksRun ? aiRunId : null,
    // A pick is the fix's own step: only an offer of the fix carries one.
    repositories:
      offer === SuggestionOffer.Act
        ? parseTracePerformanceFixRepositories(record["repositories"])
        : [],
  };
}

// The route's answer as JSON (the server's side of the parser above).
export function tracePerformanceFixSuggestionToJSON(
  suggestion: TracePerformanceFixSuggestion,
): JSONObject {
  return {
    offer: suggestion.offer,
    finding: suggestion.finding
      ? (JSON.parse(JSON.stringify(suggestion.finding)) as JSONObject)
      : null,
    findingCount: suggestion.findingCount,
    fixOutcome: suggestion.fixOutcome,
    blocker: suggestion.blocker
      ? suggestionBlockerToJSON(suggestion.blocker)
      : null,
    aiRunId: suggestion.aiRunId,
    repositories: suggestion.repositories.map(
      (repository: TracePerformanceFixRepository): JSONObject => {
        return { id: repository.id, name: repository.name };
      },
    ),
  };
}
