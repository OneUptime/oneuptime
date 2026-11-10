import {
  buildExplainNoFixTool,
  EXPLAIN_NO_FIX_RULE,
  EXPLAIN_NO_RUNBOOK_RULE,
  isAnotherRunsRound,
} from "../../../../Server/Utils/AI/Remediation/RemediationRoundRun";
import { ObservabilityAssistantExtraTool } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import {
  EXPLAIN_NO_FIX_TOOL_NAME,
  MAX_EXPLANATION_REASON_LENGTH,
  MAX_RULED_OUT_FIXES,
  parseRemediationRoundExplanation,
} from "../../../../Types/AutoRemediation/RemediationRound";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

/*
 * What every run of an AI fix shares about its round (issues #6436,
 * #6487): whose run it is - a round tried again names its new run before
 * the run exists, so an older run never acts on it - and the tool a round
 * explains an end without a fix with, which changes nothing and only
 * records what the AI says.
 */

const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const OTHER_RUN_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999990",
);

describe("isAnotherRunsRound", () => {
  it("a round whose run is not linked yet is the run's own", () => {
    for (const aiRunId of [undefined, null]) {
      expect(
        isAnotherRunsRound({ suggestion: { aiRunId }, aiRunId: RUN_ID }),
      ).toBe(false);
    }
  });

  it("a round that names this run is its own, whatever the id's case or instance", () => {
    expect(
      isAnotherRunsRound({
        suggestion: { aiRunId: new ObjectID(RUN_ID.toString()) },
        aiRunId: RUN_ID,
      }),
    ).toBe(false);
  });

  it("a round that names another run - a newer one, tried again - is not", () => {
    expect(
      isAnotherRunsRound({
        suggestion: { aiRunId: OTHER_RUN_ID },
        aiRunId: RUN_ID,
      }),
    ).toBe(true);
  });
});

describe("the rules that tell a round to explain itself", () => {
  it("a fix's rule names the tool, says when, and what to say", () => {
    expect(EXPLAIN_NO_FIX_RULE).toContain(
      `call ${EXPLAIN_NO_FIX_TOOL_NAME} once, right before your final answer`,
    );
    expect(EXPLAIN_NO_FIX_RULE).toContain(
      "When you end without proposing or making any change",
    );
    expect(EXPLAIN_NO_FIX_RULE).toContain(
      "list each fix you considered and ruled out",
    );
    expect(EXPLAIN_NO_FIX_RULE).toContain("never put a secret in it");
    // A rule line, like the rules it sits among.
    expect(EXPLAIN_NO_FIX_RULE.startsWith("- ")).toBe(true);
    expect(EXPLAIN_NO_FIX_RULE).not.toContain("\n");
  });

  it("a runbook pick's rule names the tool and the candidate runbooks", () => {
    expect(EXPLAIN_NO_RUNBOOK_RULE).toContain(
      `call ${EXPLAIN_NO_FIX_TOOL_NAME} once, right before your final answer`,
    );
    expect(EXPLAIN_NO_RUNBOOK_RULE).toContain("When you pick none");
    expect(EXPLAIN_NO_RUNBOOK_RULE).toContain("candidate runbook");
    expect(EXPLAIN_NO_RUNBOOK_RULE.startsWith("- ")).toBe(true);
    expect(EXPLAIN_NO_RUNBOOK_RULE).not.toContain("\n");
  });
});

describe("buildExplainNoFixTool", () => {
  const tool: ObservabilityAssistantExtraTool = buildExplainNoFixTool();

  it("is offered by its shared name, and asks for a reason", () => {
    expect(tool.definition.name).toBe(EXPLAIN_NO_FIX_TOOL_NAME);
    expect(tool.definition.name).toBe("explain_no_fix");

    const schema: JSONObject = tool.definition.inputSchema as JSONObject;
    expect(schema["required"]).toEqual(["reason"]);

    const properties: JSONObject = schema["properties"] as JSONObject;
    expect(Object.keys(properties).sort()).toEqual(["reason", "ruledOutFixes"]);

    const fixItems: JSONObject = (properties["ruledOutFixes"] as JSONObject)[
      "items"
    ] as JSONObject;
    expect(fixItems["required"]).toEqual(["fix", "whyNot"]);
    expect(Object.keys(fixItems["properties"] as JSONObject).sort()).toEqual([
      "commands",
      "fix",
      "whyNot",
    ]);
    expect(tool.definition.description).toContain(
      `At most ${MAX_RULED_OUT_FIXES} ruled-out fixes`,
    );
    expect(tool.definition.description).toContain(
      `cut at ${MAX_EXPLANATION_REASON_LENGTH} characters`,
    );
    expect(tool.definition.description).toContain("It changes nothing.");
  });

  it("records an explanation with its ruled-out fixes, saying how many", async () => {
    const args: JSONObject = {
      reason:
        "The pods are OOM-killed; raising the limit changes the Deployment, which only a person may approve here.",
      ruledOutFixes: [
        {
          fix: "Raise the memory limit of deployment web to 1Gi",
          commands: [
            "kubectl set resources deployment web --limits=memory=1Gi",
          ],
          whyNot: "Not allowed here: it changes the Deployment.",
        },
        {
          fix: "Restart the pods",
          whyNot: "Would not fix the cause: they run out of memory again.",
        },
      ],
    };

    const outcome: ToolCallOutcome = await tool.execute(args);

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toBe(
      "Recorded. The responders will read why there is no fix and the 2 fixes you ruled out. Now write your final answer.",
    );
    expect(outcome.result).toEqual({
      dataForLlm: "Recorded the explanation.",
      rowCount: 2,
      citationLabel: "Why there is no fix",
      redactionCount: 0,
      isTruncated: false,
    });
    // What the round's read will show is what the arguments say.
    expect(parseRemediationRoundExplanation(args)?.ruledOutFixes).toHaveLength(
      2,
    );
  });

  it("one ruled-out fix is one fix; none says only why", async () => {
    const one: ToolCallOutcome = await tool.execute({
      reason: "No runbook fits a full disk.",
      ruledOutFixes: [{ fix: "Restart pods", whyNot: "The disk stays full." }],
    });
    const none: ToolCallOutcome = await tool.execute({
      reason: "No runbook fits a full disk.",
    });

    expect(one.textForLlm).toContain("and the 1 fix you ruled out");
    expect(none.textForLlm).toBe(
      "Recorded. The responders will read why there is no fix. Now write your final answer.",
    );
    expect(none.result?.rowCount).toBe(0);
  });

  it.each([
    ["no reason", {}],
    ["an empty reason", { reason: "   " }],
    [
      "ruled-out fixes but no reason",
      { ruledOutFixes: [{ fix: "Restart pods", whyNot: "Not safe." }] },
    ],
    ["a reason that is no text", { reason: 42 }],
  ])(
    "asks again for %s, and records nothing",
    async (_label: string, args: JSONObject) => {
      const outcome: ToolCallOutcome = await tool.execute(args);

      expect(outcome.success).toBe(false);
      expect(outcome.result).toBeUndefined();
      expect(outcome.textForLlm).toBe(
        "explain_no_fix needs a reason: say in one or two sentences why this round ends without a fix, then call it again.",
      );
      expect(outcome.errorMessage).toBe("The explanation had no reason.");
    },
  );
});
