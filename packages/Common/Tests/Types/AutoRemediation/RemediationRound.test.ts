import {
  clipRoundText,
  EXPLAIN_NO_FIX_TOOL_NAME,
  getRemediationRoundTryAgainRefusal,
  hasRemediationRoundAppliedSteps,
  MAX_EXPLANATION_REASON_LENGTH,
  MAX_ROUND_CHECK_ERROR_LENGTH,
  MAX_ROUND_CHECK_WHY_LENGTH,
  MAX_ROUND_CHECKS,
  MAX_ROUND_COMMAND_LENGTH,
  MAX_RULED_OUT_FIX_COMMANDS,
  MAX_RULED_OUT_FIX_LENGTH,
  MAX_RULED_OUT_FIXES,
  MAX_RULED_OUT_WHY_NOT_LENGTH,
  MAX_ROUND_MCP_NAME_LENGTH,
  parseRemediationRoundAppliedSteps,
  parseRemediationRoundChecks,
  parseRemediationRoundExplanation,
  parseRemediationRoundMcpToolCall,
  REMEDIATION_ROUND_PATH,
  REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED,
  REMEDIATION_ROUND_TRY_AGAIN_PATH,
  REMEDIATION_ROUND_TRY_AGAIN_REFUSALS,
  RemediationRoundCheck,
  RemediationRoundExplanation,
  RemediationRoundTryAgainRefusal,
} from "../../../Types/AutoRemediation/RemediationRound";
import {
  describeMcpToolCallFailure,
  readMcpToolCallFailure,
} from "../../../Types/AI/ExternalMcpServer/ExternalMcpToolNames";
import { describe, expect, test } from "@jest/globals";

/*
 * A ROUND OF AN AI FIX, AS THE SERVER AND THE DASHBOARD SHARE IT (issues
 * #6436, #6487): "Why wasn't the safe fix found? ... What fix wasn't safe?
 * What commands did you run?" What the AI says when it ends without a fix
 * and the checks it ran come off the wire through these parsers - the AI's
 * text and an older or newer build's shapes alike - so nothing but plain,
 * clipped text reaches the step. The refusals of Try again are pinned word
 * for word: the Dashboard says each in the reader's language from these
 * very sentences.
 */

describe("the round's addresses and tool", () => {
  test("are the ones the step, the routes and the runners share", () => {
    expect(REMEDIATION_ROUND_PATH).toBe("/auto-remediation/round");
    expect(REMEDIATION_ROUND_TRY_AGAIN_PATH).toBe(
      "/auto-remediation/round-try-again",
    );
    expect(EXPLAIN_NO_FIX_TOOL_NAME).toBe("explain_no_fix");
  });
});

describe("clipRoundText: one line of the AI's text", () => {
  test("folds whitespace, trims, and keeps short text whole", () => {
    expect(clipRoundText("  restart\n\tthe   pods  ", 100)).toBe(
      "restart the pods",
    );
    expect(clipRoundText("exactly ten", 11)).toBe("exactly ten");
  });

  test("cuts long text at the limit with an ellipsis, never over it", () => {
    const clipped: string = clipRoundText("a".repeat(50), 10);

    expect(clipped).toBe(`${"a".repeat(9)}…`);
    expect(clipped.length).toBe(10);
  });

  test("drops the space before the ellipsis", () => {
    expect(clipRoundText("abcd efgh ijkl", 6)).toBe("abcd…");
  });

  test("anything but a string is no text", () => {
    for (const value of [undefined, null, 3, true, {}, ["a"]]) {
      expect(clipRoundText(value, 10)).toBe("");
    }
  });
});

describe("parseRemediationRoundExplanation: why a round ended without a fix", () => {
  test("reads the reason and each ruled-out fix with why not and its commands", () => {
    expect(
      parseRemediationRoundExplanation({
        reason:
          "The pods crash because the config map lacks DATABASE_URL; a person must add it.",
        ruledOutFixes: [
          {
            fix: "Restart the deployment",
            whyNot: "The new pods would read the same config and crash again.",
            commands: ["kubectl rollout restart deployment/api -n shop"],
          },
          {
            fix: "Delete the crashing pods",
            whyNot:
              "Not allowed: deleting pods is outside the rule's commands.",
          },
        ],
      }),
    ).toEqual({
      reason:
        "The pods crash because the config map lacks DATABASE_URL; a person must add it.",
      ruledOutFixes: [
        {
          fix: "Restart the deployment",
          whyNot: "The new pods would read the same config and crash again.",
          commands: ["kubectl rollout restart deployment/api -n shop"],
        },
        {
          fix: "Delete the crashing pods",
          whyNot: "Not allowed: deleting pods is outside the rule's commands.",
          commands: [],
        },
      ],
    });
  });

  test("a fix without a reason, or a reason without a fix, explains nothing and is left out", () => {
    const explanation: RemediationRoundExplanation | null =
      parseRemediationRoundExplanation({
        reason: "Nothing safe applies.",
        ruledOutFixes: [
          { fix: "Scale up", whyNot: "" },
          { fix: "", whyNot: "Would not help." },
          { fix: "  ", whyNot: "  " },
          "Restart it",
          null,
          ["Scale", "No"],
          { fix: "Roll back", whyNot: "The last release is not the cause." },
        ],
      });

    expect(explanation?.ruledOutFixes).toEqual([
      {
        fix: "Roll back",
        whyNot: "The last release is not the cause.",
        commands: [],
      },
    ]);
  });

  test("only a ruled-out fix, with no reason, still explains", () => {
    expect(
      parseRemediationRoundExplanation({
        ruledOutFixes: [{ fix: "Restart", whyNot: "Would not help." }],
      }),
    ).toEqual({
      reason: "",
      ruledOutFixes: [
        { fix: "Restart", whyNot: "Would not help.", commands: [] },
      ],
    });
  });

  test("says nothing - no reason and no fix with a reason - is no explanation", () => {
    for (const value of [
      undefined,
      null,
      "Nothing applies.",
      ["reason"],
      {},
      { reason: "   " },
      { reason: 42, ruledOutFixes: "Restart" },
      { ruledOutFixes: [{ fix: "Restart" }] },
    ]) {
      expect(parseRemediationRoundExplanation(value)).toBeNull();
    }
  });

  test("clips every part and keeps at most the limits", () => {
    const explanation: RemediationRoundExplanation | null =
      parseRemediationRoundExplanation({
        reason: "r".repeat(MAX_EXPLANATION_REASON_LENGTH + 50),
        ruledOutFixes: Array.from(
          { length: MAX_RULED_OUT_FIXES + 3 },
          (_value: unknown, index: number) => {
            return {
              fix: `${index}`.padEnd(MAX_RULED_OUT_FIX_LENGTH + 10, "f"),
              whyNot: "w".repeat(MAX_RULED_OUT_WHY_NOT_LENGTH + 10),
              commands: Array.from(
                { length: MAX_RULED_OUT_FIX_COMMANDS + 4 },
                (_command: unknown, commandIndex: number) => {
                  return `kubectl get pods ${commandIndex} `.padEnd(
                    MAX_ROUND_COMMAND_LENGTH + 20,
                    "x",
                  );
                },
              ),
            };
          },
        ),
      });

    expect(explanation!.reason.length).toBe(MAX_EXPLANATION_REASON_LENGTH);
    expect(explanation!.reason.endsWith("…")).toBe(true);
    expect(explanation!.ruledOutFixes).toHaveLength(MAX_RULED_OUT_FIXES);

    for (const fix of explanation!.ruledOutFixes) {
      expect(fix.fix.length).toBe(MAX_RULED_OUT_FIX_LENGTH);
      expect(fix.whyNot.length).toBe(MAX_RULED_OUT_WHY_NOT_LENGTH);
      expect(fix.commands).toHaveLength(MAX_RULED_OUT_FIX_COMMANDS);

      for (const command of fix.commands) {
        expect(command.length).toBeLessThanOrEqual(MAX_ROUND_COMMAND_LENGTH);
      }
    }
  });

  test("a command written twice is listed once, and blank or non-text commands are dropped", () => {
    expect(
      parseRemediationRoundExplanation({
        ruledOutFixes: [
          {
            fix: "Restart",
            whyNot: "Would not help.",
            commands: [
              "kubectl rollout restart deployment/api",
              "  kubectl   rollout restart deployment/api ",
              "",
              7,
              { command: "rm" },
              "kubectl get pods",
            ],
          },
        ],
      })?.ruledOutFixes[0]?.commands,
    ).toEqual(["kubectl rollout restart deployment/api", "kubectl get pods"]);
  });

  test("HTML in the AI's words stays text: the parser never interprets it", () => {
    expect(
      parseRemediationRoundExplanation({
        reason: "<img src=x onerror=alert(1)> is the reason",
      })?.reason,
    ).toBe("<img src=x onerror=alert(1)> is the reason");
  });
});

describe("parseRemediationRoundChecks: the commands a round checked with", () => {
  const CHECK: RemediationRoundCheck = {
    command: "kubectl get pods -n shop",
    why: "Find the pods that crash",
    status: "ran",
    at: "2026-11-09T10:00:00.000Z",
    error: "",
  };

  test("reads each check it knows", () => {
    expect(
      parseRemediationRoundChecks([
        CHECK,
        { ...CHECK, status: "failed", error: "Forbidden" },
        { ...CHECK, status: "unknown" },
        { ...CHECK, status: "running" },
        { ...CHECK, status: "stopped" },
      ]).map((check: RemediationRoundCheck) => {
        return [check.status, check.error];
      }),
    ).toEqual([
      ["ran", ""],
      ["failed", "Forbidden"],
      ["unknown", ""],
      ["running", ""],
      ["stopped", ""],
    ]);
  });

  test("leaves out what this build cannot read: no command, or a status it does not know", () => {
    expect(
      parseRemediationRoundChecks([
        { ...CHECK, command: "" },
        { ...CHECK, command: 5 },
        { ...CHECK, status: "skipped" },
        { ...CHECK, status: undefined },
        "kubectl get pods",
        null,
        [CHECK],
        CHECK,
      ]),
    ).toEqual([CHECK]);
  });

  test("anything but a list is no checks", () => {
    for (const value of [undefined, null, "ran", { 0: CHECK }, 3]) {
      expect(parseRemediationRoundChecks(value)).toEqual([]);
    }
  });

  test("clips the command, why and error, keeps a missing time and why empty, and keeps at most the limit", () => {
    const checks: Array<RemediationRoundCheck> = parseRemediationRoundChecks(
      Array.from({ length: MAX_ROUND_CHECKS + 5 }, () => {
        return {
          command: "c".repeat(MAX_ROUND_COMMAND_LENGTH + 5),
          why: "w".repeat(MAX_ROUND_CHECK_WHY_LENGTH + 5),
          error: "e".repeat(MAX_ROUND_CHECK_ERROR_LENGTH + 5),
          status: "failed",
          at: 12,
        };
      }),
    );

    expect(checks).toHaveLength(MAX_ROUND_CHECKS);
    expect(checks[0]!.command.length).toBe(MAX_ROUND_COMMAND_LENGTH);
    expect(checks[0]!.why.length).toBe(MAX_ROUND_CHECK_WHY_LENGTH);
    expect(checks[0]!.error.length).toBe(MAX_ROUND_CHECK_ERROR_LENGTH);
    expect(checks[0]!.at).toBe("");
    expect(
      parseRemediationRoundChecks([
        { command: "kubectl get ns", status: "ran" },
      ]),
    ).toEqual([
      { command: "kubectl get ns", why: "", status: "ran", at: "", error: "" },
    ]);
  });
});

/*
 * A fix through MCP servers' reads (#6526): a check that names the server
 * and the tool it called instead of a command. A build from before reads
 * no command in it and leaves it out, as it leaves out anything it cannot
 * read.
 */
describe("parseRemediationRoundChecks: the MCP servers' tools a round read with", () => {
  const READ: RemediationRoundCheck = {
    command: "",
    mcpTool: { server: "AWS", tool: "describe_services" },
    why: "See how many tasks checkout-api runs.",
    status: "ran",
    at: "2026-11-19T06:00:00.000Z",
    error: "",
  };

  test("reads a check that names a server's tool, with no command", () => {
    expect(parseRemediationRoundChecks([READ])).toEqual([READ]);
    expect(
      parseRemediationRoundChecks([
        { ...READ, status: "failed", error: "ThrottlingException" },
      ])[0],
    ).toMatchObject({ status: "failed", error: "ThrottlingException" });
  });

  test("a tool call names no command, even when one was sent beside it", () => {
    expect(
      parseRemediationRoundChecks([{ ...READ, command: "kubectl get ns" }]),
    ).toEqual([READ]);
  });

  test("a tool call with no server or no tool falls back to its command, or is left out", () => {
    expect(
      parseRemediationRoundChecks([
        { ...READ, mcpTool: { server: "AWS" } },
        { ...READ, mcpTool: { tool: "describe_services" } },
        { ...READ, mcpTool: { server: " ", tool: "describe_services" } },
        { ...READ, mcpTool: "AWS · describe_services" },
        { ...READ, mcpTool: ["AWS", "describe_services"] },
      ]),
    ).toEqual([]);
    expect(
      parseRemediationRoundChecks([
        { ...READ, mcpTool: { server: 4 }, command: "kubectl get ns" },
      ]),
    ).toEqual([
      {
        command: "kubectl get ns",
        why: READ.why,
        status: "ran",
        at: READ.at,
        error: "",
      },
    ]);
  });

  test("clips the server's and the tool's names", () => {
    const parsed: Array<RemediationRoundCheck> = parseRemediationRoundChecks([
      {
        ...READ,
        mcpTool: {
          server: "s".repeat(MAX_ROUND_MCP_NAME_LENGTH + 10),
          tool: `describe\n  ${"t".repeat(MAX_ROUND_MCP_NAME_LENGTH)}`,
        },
      },
    ]);

    expect(parsed[0]!.mcpTool!.server.length).toBe(MAX_ROUND_MCP_NAME_LENGTH);
    expect(parsed[0]!.mcpTool!.tool.startsWith("describe t")).toBe(true);
    expect(parsed[0]!.mcpTool!.tool.length).toBe(MAX_ROUND_MCP_NAME_LENGTH);
  });

  test("parseRemediationRoundMcpToolCall reads both names or nothing", () => {
    expect(
      parseRemediationRoundMcpToolCall({ server: " AWS ", tool: "x" }),
    ).toEqual({ server: "AWS", tool: "x" });

    for (const value of [
      null,
      undefined,
      "AWS",
      [],
      { server: "AWS" },
      { server: "", tool: "x" },
      { server: "AWS", tool: 7 },
    ]) {
      expect(parseRemediationRoundMcpToolCall(value)).toBeNull();
    }
  });
});

/*
 * How call_mcp_tool words a call the server failed, and how a round reads
 * the server's words back: one pair, so the two never drift (#6526).
 */
describe("an MCP tool call that failed at the server", () => {
  test("is worded with the tool and the server, and read back to the server's own words", () => {
    const failure: string = describeMcpToolCallFailure({
      tool: "filter_log_events",
      server: "AWS",
      message: "ThrottlingException: Rate exceeded",
    });

    expect(failure).toBe(
      "Error calling filter_log_events on AWS: ThrottlingException: Rate exceeded",
    );
    expect(
      readMcpToolCallFailure({
        errorMessage: failure,
        tool: "filter_log_events",
        server: "AWS",
      }),
    ).toBe("ThrottlingException: Rate exceeded");
  });

  test("the server as the model named it, whatever its case, or by its id", () => {
    const failure: string = describeMcpToolCallFailure({
      tool: "get_object",
      server: "AWS: Prod",
      message: "timed out after 30 s",
    });

    expect(
      readMcpToolCallFailure({
        errorMessage: failure,
        tool: "get_object",
        server: "aws: prod",
      }),
    ).toBe("timed out after 30 s");
    // Named by its id: the first ": " after the server's label.
    expect(
      readMcpToolCallFailure({
        errorMessage: describeMcpToolCallFailure({
          tool: "get_object",
          server: "AWS",
          message: "timed out",
        }),
        tool: "get_object",
        server: "3e000000-0000-4000-8000-0000000000a1",
      }),
    ).toBe("timed out");
  });

  test("a call refused before any server was called is none of these", () => {
    for (const errorMessage of [
      'Error: there is no MCP server named "Azure" in this run. The servers are: AWS.',
      'Error: AWS has no tool named "x". Call list_mcp_tools to see its tools.',
      "Error: arguments must be a JSON object. Adjust them and call again.",
      "Refused: restart on AWS may change something, and an investigation only reads.",
      "Tool excluded for this run: call_mcp_tool",
      // Another tool's failure.
      "Error calling describe_services on AWS: timed out",
      "",
    ]) {
      expect(
        readMcpToolCallFailure({
          errorMessage,
          tool: "get_object",
          server: "AWS",
        }),
      ).toBeNull();
    }

    expect(
      readMcpToolCallFailure({
        errorMessage: "Error calling  on AWS: x",
        tool: "",
        server: "AWS",
      }),
    ).toBeNull();
  });
});

describe("what a round already did outside OneUptime", () => {
  test("parses the counts and the runbook, and anything unreadable counts as none", () => {
    expect(
      parseRemediationRoundAppliedSteps({
        commandCount: 2,
        changeCount: 1,
        isRunbookStarted: true,
      }),
    ).toEqual({ commandCount: 2, changeCount: 1, isRunbookStarted: true });

    expect(
      parseRemediationRoundAppliedSteps({
        commandCount: -4,
        changeCount: 2.7,
        isRunbookStarted: "yes",
      }),
    ).toEqual({ commandCount: 0, changeCount: 2, isRunbookStarted: false });

    for (const value of [undefined, null, "2", [1, 2], { commandCount: "2" }]) {
      expect(parseRemediationRoundAppliedSteps(value)).toEqual({
        commandCount: 0,
        changeCount: 0,
        isRunbookStarted: false,
      });
    }

    expect(
      parseRemediationRoundAppliedSteps({
        commandCount: Number.POSITIVE_INFINITY,
        changeCount: Number.NaN,
      }),
    ).toEqual({ commandCount: 0, changeCount: 0, isRunbookStarted: false });
  });

  test("any command, change or runbook it recorded means it may have changed something", () => {
    const none: {
      commandCount: number;
      changeCount: number;
      isRunbookStarted: boolean;
    } = { commandCount: 0, changeCount: 0, isRunbookStarted: false };

    expect(hasRemediationRoundAppliedSteps(none)).toBe(false);
    expect(hasRemediationRoundAppliedSteps({ ...none, commandCount: 1 })).toBe(
      true,
    );
    expect(hasRemediationRoundAppliedSteps({ ...none, changeCount: 1 })).toBe(
      true,
    );
    expect(
      hasRemediationRoundAppliedSteps({ ...none, isRunbookStarted: true }),
    ).toBe(true);
  });
});

describe("Try again's refusals", () => {
  test("every refusal has one whole sentence", () => {
    expect(Object.keys(REMEDIATION_ROUND_TRY_AGAIN_REFUSALS).sort()).toEqual(
      Object.values(RemediationRoundTryAgainRefusal).sort(),
    );

    for (const refusal of Object.values(RemediationRoundTryAgainRefusal)) {
      expect({
        refusal,
        sentence: getRemediationRoundTryAgainRefusal(refusal),
      }).toEqual({
        refusal,
        sentence: expect.stringMatching(/^[A-Z].*\.$/),
      });
    }
  });

  test("the sentences, word for word", () => {
    expect(REMEDIATION_ROUND_TRY_AGAIN_REFUSALS).toEqual({
      NoRound:
        "OneUptime AI did not work this fix out, so there is nothing to try again.",
      StillWorking: "OneUptime AI is still working on this fix.",
      Finished:
        "OneUptime AI finished working on this fix, so there is nothing to try again.",
      PartlyApplied:
        "OneUptime AI made a change for this fix before it stopped, so it does not start the fix again: that could make the same change twice. Check what it changed, then finish the fix yourself.",
      IncidentResolved:
        "This incident is resolved, so OneUptime AI does not try to fix it.",
      AlertResolved:
        "This alert is resolved, so OneUptime AI does not try to fix it.",
      AlreadyStarted: "Someone has just started this fix again.",
      AiOff:
        "OneUptime AI is switched off for this project. A Project Owner or someone with Manage Billing can turn it on in Project Settings > AI > AI Features.",
      NoProvider:
        "This project has no LLM provider to work out a fix with. Add one in Project Settings > AI > LLM Providers, then try again.",
      CreditsUsedUp:
        "This project's AI credits are used up. A Project Owner or someone with Manage Billing can add AI credits in Project Settings > AI > AI Credits.",
      LimitReached:
        "The project reached its daily AI limit. OneUptime AI starts again at midnight UTC.",
      IncidentTokenLimitPaused:
        "The Daily Incident AI Token Limit is set to 0, which pauses automatic AI work for incidents. Raise it above 0 under Incidents → AI → Settings → More settings, or clear it, then try again.",
      IncidentTokenLimitUsedUp:
        "Automatic AI work for incidents used up today's Daily Incident AI Token Limit. Raise or clear it under Incidents → AI → Settings → More settings, or wait until midnight UTC, when it resets. Then try again.",
      AlertTokenLimitPaused:
        "The Daily Alert AI Token Limit is set to 0, which pauses automatic AI work for alerts. Raise it above 0 under Alerts → AI → Settings → More settings, or clear it, then try again.",
      AlertTokenLimitUsedUp:
        "Automatic AI work for alerts used up today's Daily Alert AI Token Limit. Raise or clear it under Alerts → AI → Settings → More settings, or wait until midnight UTC, when it resets. Then try again.",
      NotStarted: "The fix could not start again. Try again in a few minutes.",
      // #6525: pressed more often than AutoRemediationRoundRateLimit allows.
      TooManyTries:
        "You have asked OneUptime AI to try again too many times in the last few minutes. Wait a few minutes, then try again.",
    });
  });

  /*
   * #7157: the incident's (alert's) own daily AI token limit is not the
   * project's daily AI limit, and a limit of 0 is a pause that midnight
   * does not lift: only the used-up refusals say midnight.
   */
  test("only the used-up and the project's limits say midnight, and each record names its own limit", () => {
    const sayMidnight: Array<string> = Object.entries(
      REMEDIATION_ROUND_TRY_AGAIN_REFUSALS,
    )
      .filter(([, sentence]: [string, string]): boolean => {
        return sentence.includes("midnight");
      })
      .map(([refusal]: [string, string]): string => {
        return refusal;
      })
      .sort();

    expect(sayMidnight).toEqual([
      "AlertTokenLimitUsedUp",
      "IncidentTokenLimitUsedUp",
      "LimitReached",
    ]);
    expect(
      REMEDIATION_ROUND_TRY_AGAIN_REFUSALS.AlertTokenLimitPaused,
    ).not.toMatch(/incident/i);
    expect(
      REMEDIATION_ROUND_TRY_AGAIN_REFUSALS.AlertTokenLimitUsedUp,
    ).not.toMatch(/incident/i);
    expect(
      REMEDIATION_ROUND_TRY_AGAIN_REFUSALS.IncidentTokenLimitPaused,
    ).not.toMatch(/alert/i);
    expect(
      REMEDIATION_ROUND_TRY_AGAIN_REFUSALS.IncidentTokenLimitUsedUp,
    ).not.toMatch(/alert/i);
  });

  test("a person who may not change the record is told so, worded as the investigation's Try again", () => {
    expect(REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED).toEqual({
      incident:
        "You do not have permission to change this incident, so you cannot ask OneUptime AI to try this fix again.",
      alert:
        "You do not have permission to change this alert, so you cannot ask OneUptime AI to try this fix again.",
    });
  });
});
