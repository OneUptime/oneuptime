import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import {
  EXPLAIN_NO_FIX_TOOL_NAME,
  MAX_EXPLANATION_REASON_LENGTH,
  MAX_RULED_OUT_FIXES,
  MAX_RULED_OUT_FIX_COMMANDS,
  parseRemediationRoundExplanation,
  RemediationRoundExplanation,
} from "../../../../Types/AutoRemediation/RemediationRound";
import type { ObservabilityAssistantExtraTool } from "../Chat/ObservabilityAssistant";
import type { ToolCallOutcome } from "../Toolbox/Index";

/*
 * What every run of an AI fix shares about its round (issues #6436, #6487):
 * whose run it is, and the tool it explains a round without a fix with.
 * Imported by the runners, so it imports none of them.
 */

/*
 * Whether a run is not the round's own: a round tried again
 * (RemediationRound.tryAgain) names its new run before the run exists, so
 * an older run of it - or a second press's - finds another run named and
 * never acts on the round. A round whose run is not linked yet (created,
 * then queued, then linked) is still the run's own.
 */
export function isAnotherRunsRound(data: {
  suggestion: { aiRunId?: ObjectID | null | undefined };
  aiRunId: ObjectID;
}): boolean {
  return Boolean(
    data.suggestion.aiRunId &&
      data.suggestion.aiRunId.toString() !== data.aiRunId.toString(),
  );
}

/*
 * What a round's persona says about ending without a fix: call the tool,
 * then answer. The Remediation step shows what it says - why, and each fix
 * ruled out with why not - under "Found no safe fix".
 */
export const EXPLAIN_NO_FIX_RULE: string = `- When you end without proposing or making any change - you could not tell the cause, no fix is safe, or the fix that would work is not allowed here - call ${EXPLAIN_NO_FIX_TOOL_NAME} once, right before your final answer. Say why in one or two sentences a responder understands without the rest of your answer, and list each fix you considered and ruled out: what it would do, the commands it would run, and why you did not propose it (not safe, not allowed here, refused when you tried it, or would not fix the cause). A responder reads it on the incident to see what you weighed, so name real objects and never put a secret in it.`;

/*
 * The runbook pick's version of it: the fixes it weighs are the candidate
 * runbooks.
 */
export const EXPLAIN_NO_RUNBOOK_RULE: string = `- When you pick none, call ${EXPLAIN_NO_FIX_TOOL_NAME} once, right before your final answer: say in one or two sentences why no runbook applies, and list each candidate runbook you ruled out (its name as the fix) with why it does not fit. A responder reads it on the incident, so it must make sense without the rest of your answer.`;

/*
 * The tool itself. It changes nothing and only records what it is told:
 * its arguments travel with the run's own event, which the round's read
 * parses (parseRemediationRoundExplanation) - nothing else stores them.
 */
export function buildExplainNoFixTool(): ObservabilityAssistantExtraTool {
  return {
    definition: {
      name: EXPLAIN_NO_FIX_TOOL_NAME,
      description: `Explain to the responders why this round ends without a fix. Call it once, right before your final answer, only when you propose or make no change. It changes nothing. At most ${MAX_RULED_OUT_FIXES} ruled-out fixes; the reason is cut at ${MAX_EXPLANATION_REASON_LENGTH} characters.`,
      inputSchema: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description:
              "Why there is no fix, in one or two plain sentences: what you found and what stops a fix (e.g. 'The pods are OOM-killed because their 512Mi limit is below their steady usage; raising the limit changes the Deployment, which only a person may approve on this cluster.').",
          },
          ruledOutFixes: {
            type: "array",
            description:
              "Each fix you considered and did not propose or make. Leave it empty when you considered none.",
            items: {
              type: "object",
              properties: {
                fix: {
                  type: "string",
                  description:
                    "What the fix would do, in a few words (e.g. 'Raise the memory limit of deployment web to 1Gi').",
                },
                commands: {
                  type: "array",
                  items: { type: "string" },
                  description: `The commands it would run, at most ${MAX_RULED_OUT_FIX_COMMANDS}, exactly as you would write them.`,
                },
                whyNot: {
                  type: "string",
                  description:
                    "Why you did not propose it: not safe, not allowed here, refused when you tried it, or it would not fix the cause.",
                },
              },
              required: ["fix", "whyNot"],
            },
          },
        },
        required: ["reason"],
      },
    },
    execute: async (args: JSONObject): Promise<ToolCallOutcome> => {
      const explanation: RemediationRoundExplanation | null =
        parseRemediationRoundExplanation(args);

      if (!explanation || !explanation.reason) {
        return {
          success: false,
          textForLlm: `${EXPLAIN_NO_FIX_TOOL_NAME} needs a reason: say in one or two sentences why this round ends without a fix, then call it again.`,
          errorMessage: "The explanation had no reason.",
        };
      }

      const fixCount: number = explanation.ruledOutFixes.length;

      return {
        success: true,
        textForLlm: `Recorded. The responders will read why there is no fix${
          fixCount > 0
            ? ` and the ${fixCount} ${fixCount === 1 ? "fix" : "fixes"} you ruled out`
            : ""
        }. Now write your final answer.`,
        result: {
          dataForLlm: "Recorded the explanation.",
          rowCount: fixCount,
          citationLabel: "Why there is no fix",
          redactionCount: 0,
          isTruncated: false,
        },
      };
    },
  };
}
