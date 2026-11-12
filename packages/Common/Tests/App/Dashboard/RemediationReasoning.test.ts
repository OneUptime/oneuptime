import { describe, expect, test } from "@jest/globals";
import {
  getRemediationReasoningMarkdown,
  getRemediationReasoningPreview,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationReasoning";
import { getRemediationFixSteps } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationFixSteps";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * A fix's reasoning, without the report around it (issue #6860).
 *
 * A round of an AI fix posts its answer the way an investigation posts its
 * report: a brand heading, the answer, an "Evidence checked" list and a
 * footer that calls the run read-only. Under the fix, the line that
 * previews why read the heading and the footer - "🧠 AI — Automated Root
 * Cause Analysis I'll verify the current state of the pod ... ---
 * Investigated automatically by OneUptime AI — read-only, 0 ..." - and a
 * runbook pick's answer ended with "SelectedRunbook: none".
 */

// A round's answer as the engine posts it (buildBrandedMarkdown).
function branded(analysis: string, evidence: boolean = true): string {
  return [
    "## 🧠 AI — Automated Root Cause Analysis",
    "",
    analysis,
    ...(evidence
      ? [
          "",
          "**Evidence checked**",
          "- **[C1]** kubectl get pods -n clickhouse — succeeded",
          "- **[C2]** Logs of clickhouse-0 — 42 row(s)",
        ]
      : []),
    "",
    "---",
    evidence
      ? "*Investigated automatically by OneUptime AI — read-only, 1 query run across your own telemetry and 1 kubectl command run on your Kubernetes clusters using gpt-test. This is an AI-generated first pass; verify before acting.*"
      : "*Investigated automatically by OneUptime AI — read-only, 0 queries run across your own telemetry using gpt-test. This is an AI-generated first pass; verify before acting.*",
  ].join("\n");
}

// The cluster round of the issue's screenshot: thinking aloud, then sections.
const CLUSTER_ROUND_ANSWER: string = branded(
  [
    "I'll verify the current state of the pod before deciding on a fix.",
    "",
    "**Summary** — The ClickHouse pod restarted after it ran out of memory [C1]. Restarting it again would not help, and raising its memory limit is a change to review by hand.",
    "",
    "**Most likely root cause** — The merge of a large part used more memory than the pod's limit [C2].",
  ].join("\n"),
);

// The runbook pick of the screenshot: a summary first, and the pick line.
const RUNBOOK_PICK_ANSWER: string = branded(
  [
    "**Summary** — Alert #410 is a ClickHouse pod in CrashLoopBackOff; none of the project's runbooks addresses an out-of-memory restart.",
    "",
    "**Suggested next steps**",
    "- Raise the memory limit of the clickhouse StatefulSet.",
    "",
    "SelectedRunbook: none",
  ].join("\n"),
);

describe("the line that previews a fix's reasoning", () => {
  test("is the answer's Summary, without the report's heading or footer", () => {
    expect(getRemediationReasoningPreview(CLUSTER_ROUND_ANSWER)).toBe(
      "The ClickHouse pod restarted after it ran out of memory. Restarting it again would not help, and raising its memory limit is a change to review by hand.",
    );
    expect(getRemediationReasoningPreview(RUNBOOK_PICK_ANSWER)).toBe(
      "Alert #410 is a ClickHouse pod in CrashLoopBackOff; none of the project's runbooks addresses an out-of-memory restart.",
    );
  });

  test("never reads the brand heading, the footer, citation marks or the pick line", () => {
    for (const answer of [CLUSTER_ROUND_ANSWER, RUNBOOK_PICK_ANSWER]) {
      const preview: string = getRemediationReasoningPreview(answer) || "";

      expect(preview).not.toContain("Automated Root Cause Analysis");
      expect(preview).not.toContain("🧠");
      expect(preview).not.toContain("Investigated automatically");
      expect(preview).not.toContain("read-only");
      expect(preview).not.toContain("---");
      expect(preview).not.toContain("[C1]");
      expect(preview).not.toContain("SelectedRunbook");
      expect(preview).not.toContain("Evidence checked");
    }
  });

  test("an answer with no Summary previews its first words", () => {
    expect(
      getRemediationReasoningPreview(
        branded(
          "Restarting the **checkout** deployment clears the stuck connections [C1].\n\nSelectedRunbook: 0193c0de-1111-4aaa-8bbb-000000000001",
        ),
      ),
    ).toBe("Restarting the checkout deployment clears the stuck connections.");
  });

  test("an answer that is not a report reads as it was written", () => {
    expect(
      getRemediationReasoningPreview(
        "The pod is **OOMKilled**; restart it with more memory.",
      ),
    ).toBe("The pod is OOMKilled; restart it with more memory.");
  });

  test("nothing to preview is null, never an empty line", () => {
    expect(getRemediationReasoningPreview(undefined)).toBeNull();
    expect(getRemediationReasoningPreview(null)).toBeNull();
    expect(getRemediationReasoningPreview("")).toBeNull();
    expect(getRemediationReasoningPreview("  \n ")).toBeNull();
    // A report with nothing in it but its frame.
    expect(getRemediationReasoningPreview(branded("", false))).toBeNull();
    expect(getRemediationReasoningPreview("SelectedRunbook: none")).toBeNull();
  });
});

describe("what a fix's reasoning opens to", () => {
  test("is the whole answer, without the frame around it", () => {
    const opened: string =
      getRemediationReasoningMarkdown(CLUSTER_ROUND_ANSWER);

    expect(opened).toContain(
      "I'll verify the current state of the pod before deciding on a fix.",
    );
    expect(opened).toContain(
      "**Summary** — The ClickHouse pod restarted after it ran out of memory. Restarting",
    );
    expect(opened).toContain(
      "**Most likely root cause** — The merge of a large part used more memory than the pod's limit.",
    );
    expect(opened).not.toContain("Automated Root Cause Analysis");
    expect(opened).not.toContain("Evidence checked");
    expect(opened).not.toContain("Investigated automatically");
    expect(opened).not.toContain("[C1]");
    expect(opened).not.toContain("[C2]");
  });

  test("leaves the runbook pick's line out, and keeps what came before it", () => {
    const opened: string = getRemediationReasoningMarkdown(RUNBOOK_PICK_ANSWER);

    expect(opened).toContain("Raise the memory limit");
    expect(opened).not.toMatch(/SelectedRunbook/i);
    expect(
      getRemediationReasoningMarkdown(
        "Restart it.\n\n**SelectedRunbook:** none",
      ),
    ).toBe("Restart it.");
    expect(
      getRemediationReasoningMarkdown("Restart it.\nselectedrunbook = none"),
    ).toBe("Restart it.");
  });

  test("a pick proposed instead of started keeps its note, not the heading after it", () => {
    const opened: string = getRemediationReasoningMarkdown(
      `The runbook could not be started (it may be turned off or have no steps), so it was proposed instead.\n\n${RUNBOOK_PICK_ANSWER}`,
    );

    expect(opened.startsWith("The runbook could not be started")).toBe(true);
    expect(opened).not.toContain("Automated Root Cause Analysis");
    expect(opened).toContain("Alert #410 is a ClickHouse pod");
  });

  test("a run a limit stopped keeps its stop note under the answer", () => {
    const opened: string = getRemediationReasoningMarkdown(
      branded(
        "The pod restarted after an out-of-memory kill.\n\n_This run stopped at the incident investigation time limit of 20 minutes. Change it in [Incidents → AI → Investigation limits](/dashboard/settings)._",
      ),
    );

    expect(opened).toContain("The pod restarted after an out-of-memory kill.");
    expect(opened).toContain("This run stopped at");
  });

  test("an empty or missing answer opens to nothing", () => {
    expect(getRemediationReasoningMarkdown(undefined)).toBe("");
    expect(getRemediationReasoningMarkdown("")).toBe("");
    expect(getRemediationReasoningMarkdown(branded("", false))).toBe("");
  });

  test("a heading the AI wrote itself stays", () => {
    expect(
      getRemediationReasoningMarkdown(
        branded("## What I checked\n\nThe pod's events.", false),
      ),
    ).toBe("## What I checked\n\nThe pod's events.");
  });

  test("a long run of spaces and stars is read at once (outside text)", () => {
    const random: SeededRandom = seededRandom(6860);
    const runs: Array<string> = Array.from({ length: 20 }, (): string => {
      return Array.from({ length: 20000 }, (): string => {
        const pick: number = random();
        return pick < 0.4 ? " " : pick < 0.8 ? "*" : "\t";
      }).join("");
    });

    /*
     * Timed through FastestRun: up to three runs, the fastest counting, and
     * leeway for a runner slower than usual (OneAttemptTimingGuard). The
     * texts are drawn once, before the clock starts; nothing is kept from
     * one reading to the next, so every run reads them all again.
     */
    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        let read: number = 0;

        for (const run of runs) {
          read += getRemediationReasoningMarkdown(
            `#${run}\n${run}SelectedRunbook${run}x`,
          ).length;
          read += (getRemediationReasoningPreview(`${run}\n## ${run}`) || "")
            .length;
        }

        return read;
      },
      limitInMs: 5000,
    });

    /*
     * Read, not skipped: the second line has no ":" after its label, so it
     * is no runbook pick, and its words stay.
     */
    expect(timed.result).toBeGreaterThan(0);
    expect(timed.inMs).toBeLessThan(5000);
  });
});

describe("the fix's first step reads the clean preview", () => {
  test("a cluster round that found no safe fix", () => {
    const suggestion: AutoRemediationSuggestion = Object.assign(
      new AutoRemediationSuggestion(),
      {
        status: AutoRemediationSuggestionStatus.NoneApplicable,
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        rationaleMarkdown: CLUSTER_ROUND_ANSWER,
        createdAt: new Date("2026-11-06T04:39:00Z"),
      },
    );

    const [plan] = getRemediationFixSteps({ suggestion });

    expect(plan?.title).toBe("Found no safe fix");
    expect(plan?.summary).toBe(
      "The ClickHouse pod restarted after it ran out of memory. Restarting it again would not help, and raising its memory limit is a change to review by hand.",
    );
  });

  test("a runbook pick that found none", () => {
    const suggestion: AutoRemediationSuggestion = Object.assign(
      new AutoRemediationSuggestion(),
      {
        status: AutoRemediationSuggestionStatus.NoneApplicable,
        rationaleMarkdown: RUNBOOK_PICK_ANSWER,
        createdAt: new Date("2026-11-06T04:39:00Z"),
      },
    );

    const [plan] = getRemediationFixSteps({ suggestion });

    expect(plan?.title).toBe("Found no runbook that applies");
    expect(plan?.summary).toBe(
      "Alert #410 is a ClickHouse pod in CrashLoopBackOff; none of the project's runbooks addresses an out-of-memory restart.",
    );
  });
});
