import ObjectID from "../../../../Types/ObjectID";
import { AIChatCitation } from "../../../../Types/AI/AIChatTypes";
import AIService, { AILogResponse } from "../../../Services/AIService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Sentinel — the structured, server-verified confidence signal (G6).
 *
 * The vision's §6 threat model forbids deriving control flow from free-form
 * model prose: adversarial telemetry can steer what the model writes, so a
 * regex over the analysis (the old INCONCLUSIVE_RE) was forgeable by prompt
 * injection. This module replaces it with a two-part signal:
 *
 *   1. Deterministic evidence floor (pure, no LLM): computed from the run's
 *      OWN recorded tool activity. Citations are minted server-side from
 *      validated tool arguments — never by the model — so prose cannot fake
 *      evidence that was never minted. Zero citations AND zero data-bearing
 *      tool calls → INCONCLUSIVE, regardless of anything the analysis says.
 *
 *   2. Constrained classification (only when the floor passes): ONE metered
 *      LLM call (temperature 0, tiny token cap, word-bounded single-token
 *      parse — the InvestigationGrader idiom) asking whether the analysis
 *      asserts a specific, evidenced root cause or is inconclusive. The
 *      classifier sees the analysis as DATA and can only emit one of two
 *      tokens — it cannot be steered into an arbitrary control decision.
 *
 * FAIL DIRECTIONS ARE PER-CONSUMER, and that is the point of the structured
 * result: `{confident, source}` lets each consumer choose its own safe
 * degradation when the classification itself failed (unparseable response or
 * the call errored). As implemented:
 *
 *   | source                | confident | workspace ping | instrumentation PR |
 *   |-----------------------|-----------|----------------|--------------------|
 *   | deterministic-floor   | false     | no (quiet)     | yes (enqueue)      |
 *   | classification        | true      | yes            | no                 |
 *   | classification        | false     | no (quiet)     | yes (enqueue)      |
 *   | classification-failed | false (*) | YES — louder   | NO — no PR         |
 *
 *   - The workspace ping treats classification-failed as CONFIDENT: quiet
 *     mode's fail direction is "louder, not silent" (vision §6) — a broken
 *     classifier must never suppress the on-call ping.
 *   - The instrumentation trigger treats classification-failed as
 *     NOT-inconclusive: autonomous PR creation (G11 posture) requires a
 *     POSITIVE, verified inconclusive verdict — "we don't know" must fail
 *     toward doing nothing.
 *   - (*) When source is "classification-failed" the `confident` boolean is
 *     a placeholder, NOT a verdict — consumers must route decisions through
 *     the helpers below, never through the raw boolean.
 *
 * Budget accounting: the classification call runs AFTER the investigation's
 * agent loop has finished, so it is deliberately OUTSIDE the engine's per-run
 * caps (MAX_LLM_CALLS / MAX_OUTPUT_TOKENS govern the loop, whose counts are
 * persisted at the Completed transition before this call fires). It is still
 * metered per-call in LlmLog and its feature is in AUTONOMOUS_AI_FEATURES, so
 * the G4 daily autonomous token budget covers it — and a budget rejection
 * degrades the signal to "classification-failed", never a run failure.
 */

// LlmLog feature label — a member of AUTONOMOUS_AI_FEATURES (G4 budget).
export const CONFIDENCE_CLASSIFICATION_FEATURE: string =
  "Sentinel Confidence Classification";

// Truncation cap keeps the classification call cheap and inside context limits.
const MAX_ANALYSIS_CHARS: number = 8000;

/*
 * Word-bounded token matchers (hoisted: wrap-regex and prettier disagree
 * inline). Word boundaries mean CONFIDENTLY / INCONCLUSIVELY do not parse.
 */
const CONFIDENT_RE: RegExp = /\bCONFIDENT\b/;
const INCONCLUSIVE_RE: RegExp = /\bINCONCLUSIVE\b/;

export type ConfidenceSource =
  // The evidence floor failed: zero server-minted evidence exists.
  | "deterministic-floor"
  // The constrained classification call returned exactly one valid token.
  | "classification"
  // The classification call errored or its response was unparseable.
  | "classification-failed";

export interface ConfidenceSignal {
  /*
   * Whether the investigation asserted an evidenced root cause. NOT a verdict
   * when source is "classification-failed" — use the decision helpers.
   */
  confident: boolean;
  source: ConfidenceSource;
}

/*
 * The deterministic inputs, derived from the run's own recorded tool activity
 * (server-side state — the model never writes any of these numbers).
 */
export interface EvidenceInput {
  // Citations minted by the engine (one per successful tool call).
  citationCount: number;
  // Successful tool calls whose result carried at least one row of data.
  dataBearingToolCallCount: number;
  // Whether ANY tool returned non-empty data.
  anyToolReturnedData: boolean;
}

export default class SentinelConfidenceSignal {
  /*
   * THE single definition of "data-bearing" (shared with the eval harness in
   * Utils/AI/Eval): a tool result that carried at least one row of data.
   * rowCount 0 is still server-verified evidence — proof of absence ("checked,
   * found nothing") — but it is not data-BEARING. Both the live confidence
   * floor (over minted citations) and the offline corpus derivation (over
   * recorded AIRunEvent resultSummary.rowCount) route through this helper so
   * the two can never drift apart.
   */
  public static isDataBearingRowCount(
    rowCount: number | null | undefined,
  ): boolean {
    return (rowCount || 0) > 0;
  }

  // Derive the deterministic evidence inputs from the run's minted citations.
  public static evidenceFromCitations(
    citations: Array<AIChatCitation>,
  ): EvidenceInput {
    const dataBearingToolCallCount: number = citations.filter(
      (citation: AIChatCitation) => {
        return this.isDataBearingRowCount(citation.rowCount);
      },
    ).length;

    return {
      citationCount: citations.length,
      dataBearingToolCallCount,
      anyToolReturnedData: dataBearingToolCallCount > 0,
    };
  }

  /*
   * The deterministic floor (pure, exported for tests): zero citations AND
   * zero successful data-bearing tool calls → no server-verified evidence
   * exists, so the run is INCONCLUSIVE no matter what the prose claims.
   * Prose cannot fake evidence that was never minted server-side.
   */
  public static hasVerifiableEvidence(evidence: EvidenceInput): boolean {
    return (
      evidence.citationCount > 0 ||
      evidence.dataBearingToolCallCount > 0 ||
      evidence.anyToolReturnedData
    );
  }

  /*
   * Defensive one-token parse (pure, exported for tests). The prompt demands
   * exactly one token, but models editorialize — accept the verdict when
   * exactly ONE of the two tokens appears, word-bounded. Both found, neither
   * found, or empty → null (classification failed; per-consumer fail
   * directions apply).
   */
  public static parseClassificationToken(
    response: string | null | undefined,
  ): boolean | null {
    if (!response) {
      return null;
    }

    const text: string = response.toUpperCase();

    const isConfident: boolean = CONFIDENT_RE.test(text);
    const isInconclusive: boolean = INCONCLUSIVE_RE.test(text);

    if (isConfident === isInconclusive) {
      // Both or neither → unparseable.
      return null;
    }

    return isConfident;
  }

  /*
   * Consumer decision: should the analysis post ping the workspace/on-call?
   * Fail direction: classification-failed → TRUE. Quiet mode fails LOUDER,
   * not silent — a broken classifier must never suppress the ping (the old
   * regex's fail direction, kept deliberately).
   */
  public static shouldSendWorkspaceNotification(
    signal: ConfidenceSignal,
  ): boolean {
    if (signal.source === "classification-failed") {
      return true;
    }

    return signal.confident;
  }

  /*
   * Consumer decision: should an ImproveInstrumentation fix task be enqueued
   * (opted-in projects only — the trigger has its own gates)? Requires a
   * POSITIVE inconclusive verdict: either the deterministic floor proved no
   * evidence exists, or the classification said INCONCLUSIVE. Fail direction:
   * classification-failed → FALSE — autonomous PR creation fails toward
   * doing nothing (G11 posture).
   */
  public static shouldEnqueueInstrumentationTask(
    signal: ConfidenceSignal,
  ): boolean {
    if (signal.source === "classification-failed") {
      return false;
    }

    return !signal.confident;
  }

  /*
   * Compute the full signal: deterministic floor first (no LLM call when it
   * fails), then one constrained classification call. NEVER throws — an
   * errored or unparseable classification returns "classification-failed"
   * and each consumer applies its own fail direction.
   */
  @CaptureSpan()
  public static async computeConfidenceSignal(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    analysisMarkdown: string;
    evidence: EvidenceInput;
  }): Promise<ConfidenceSignal> {
    if (!this.hasVerifiableEvidence(data.evidence)) {
      /*
       * No server-minted evidence exists — inconclusive by construction,
       * regardless of the prose. No classification call is spent.
       */
      return { confident: false, source: "deterministic-floor" };
    }

    try {
      const response: AILogResponse = await AIService.executeWithLogging({
        projectId: data.projectId,
        feature: CONFIDENCE_CLASSIFICATION_FEATURE,
        aiRunId: data.aiRunId,
        // The verdict drives control flow; no prompt previews in LlmLog.
        storeContentPreviews: false,
        temperature: 0,
        maxTokens: 20,
        messages: [
          {
            role: "system",
            content: [
              "You judge an AI incident investigation's own analysis.",
              "Does this analysis assert a specific root cause with supporting evidence, or is it inconclusive?",
              "Reply with exactly one token and nothing else:",
              "CONFIDENT — the analysis asserts a specific root cause with supporting evidence.",
              "INCONCLUSIVE — the analysis could not determine a cause, or asserts one without supporting evidence.",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              "AI investigation analysis:",
              '"""',
              data.analysisMarkdown.substring(0, MAX_ANALYSIS_CHARS),
              '"""',
              "",
              "One token only: CONFIDENT or INCONCLUSIVE.",
            ].join("\n"),
          },
        ],
      });

      const verdict: boolean | null = this.parseClassificationToken(
        response.content,
      );

      if (verdict === null) {
        logger.warn(
          `Sentinel confidence: unparseable classification response for run ${data.aiRunId.toString()} — per-consumer fail directions apply.`,
        );
        return { confident: false, source: "classification-failed" };
      }

      return { confident: verdict, source: "classification" };
    } catch (error) {
      logger.error(
        `Sentinel confidence: classification call failed for run ${data.aiRunId.toString()} — per-consumer fail directions apply: ${error}`,
      );
      return { confident: false, source: "classification-failed" };
    }
  }
}
