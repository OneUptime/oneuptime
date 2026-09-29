import NotImplementedException from "../../../../Types/Exception/NotImplementedException";
import { AIChatCitation } from "../../../../Types/AI/AIChatTypes";
import { GoldenCase } from "./EvalCorpus";

/*
 * AI eval harness — OFFLINE REPLAY (not implemented; this file is the
 * explicit extension point, so the gap is documented instead of pretended
 * away).
 *
 * WHAT REPLAY MEANS HERE: re-run the investigation agent loop against the
 * RECORDED tool results of a golden case, so a prompt/persona/model change can
 * be scored on the exact same evidence the original run saw — deterministic
 * inputs, no live telemetry, no flakiness from data that has since expired.
 *
 * WHY IT CANNOT BE BUILT FROM TODAY'S RECORDED TRAILS (verified against
 * AIInvestigationEngine.emitEvent + ChatAgentRunner.emitEvent):
 * AIRunEvent persists the validated tool ARGUMENTS (`toolArguments`) and a
 * result SUMMARY only — `resultSummary` carries rowCount, durationInMs,
 * isTruncated, bytesSentToLlm and errorMessage (AIRunEventResultSummary). The
 * actual result payload the LLM read (the serialized, redacted, truncated
 * tool output) is never persisted anywhere: not on the event, not on the run,
 * not in LlmLog (investigations set storeContentPreviews: false by design —
 * G8). We know HOW MANY bytes each tool sent to the LLM, but not WHICH bytes.
 *
 * CONSEQUENCE: a "replay" today could only re-EXECUTE the recorded
 * `toolArguments` against live telemetry (they are replayable by construction
 * — citations carry them for exactly that reason). That is a re-query, not a
 * replay: ClickHouse retention windows (metrics default to days, not months)
 * mean the data behind a weeks-old golden case is usually gone, and even
 * fresh data may have changed. Scoring a model change on re-queried data is
 * NOT scoring it on the golden corpus.
 *
 * WHAT FULL REPLAY NEEDS (in dependency order):
 *
 *   1. RECORD TOOL RESULTS: persist the serialized (redacted + truncated —
 *      the exact text handed to the LLM, AFTER Toolbox/Serializer.ts ran)
 *      result payload per ToolCallCompleted event. Design constraints: G8
 *      applies (these payloads embed telemetry with narrower ACLs than the
 *      event table's project-member read — they need the same access-tiering
 *      review as LlmLog previews, plus a retention policy); size is bounded
 *      by the serializer's existing truncation caps, so a JSON/text column on
 *      AIRunEvent or a side table both work.
 *
 *   2. A RECORDED-RESULT TOOL TRANSPORT: a Toolbox-shaped shim the agent loop
 *      can run against, serving recorded results keyed by (toolName,
 *      canonicalized arguments) and falling to an explicit "not recorded"
 *      tool error when the replayed model asks something the original never
 *      asked. That divergence is itself signal — count it, don't hide it.
 *
 *   3. PINNED MODEL CONFIG + SCORING HOOKUP: replay with an explicit
 *      provider/model/temperature (otherwise scores measure provider drift,
 *      not the change under test), then feed the replayed analyses through
 *      the same labels/scores as the recorded runs (EvalScores.ts) so
 *      before/after is apples-to-apples.
 *
 * Until (1) exists for newly recorded runs, no historical run can ever be
 * replayed — recording tool results is the prerequisite that only pays off
 * for runs recorded AFTER it ships. That is why the corpus/scoring bootstrap
 * shipped first: labels make recorded runs scorable today, replay makes
 * FUTURE changes testable against them tomorrow.
 */

// What a completed replay would produce for scoring.
export interface ReplayResult {
  runId: string;
  // The replayed agent's analysis, ready for grading against the case labels.
  analysisMarkdown: string;
  // Citations minted during the replay (server-side, as in live runs).
  citations: Array<AIChatCitation>;
  /*
   * Tool calls the replayed model made that the original run never recorded —
   * replay cannot answer them; a high count means the replayed prompt/model
   * diverged too far from the recording for scores to be comparable.
   */
  unrecordedToolCallCount: number;
}

export default class ReplayInvestigation {
  /*
   * NOT IMPLEMENTED — see the module doc block for exactly what is missing
   * (recorded tool RESULT payloads; today's AIRunEvent trail carries argument
   * + summary only).
   */
  public static async replay(_goldenCase: GoldenCase): Promise<ReplayResult> {
    throw new NotImplementedException();
  }
}
