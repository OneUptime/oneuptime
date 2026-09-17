import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { JSONObject } from "Common/Types/JSON";
import {
  InvestigationEvidence,
  InvestigationFinding,
  buildInvestigationFindings,
  buildInvestigationNoteMarkdown,
  buildInvestigationPrompt,
  computeErrorHalves,
} from "../../FeatureSet/Dashboard/src/Utils/InvestigationFindings";

/*
 * The deterministic "explain this spike" engine: every rule pinned, so a
 * finding can always be traced back to its evidence.
 */

const WINDOW_START_MS: number = new Date("2026-08-20T10:00:00.000Z").getTime();
const WINDOW_END_MS: number = new Date("2026-08-20T10:30:00.000Z").getTime();

function bucket(
  minuteOffset: number,
  severity: string,
  count: number,
): JSONObject {
  return {
    time: new Date(WINDOW_START_MS + minuteOffset * 60000).toISOString(),
    severity,
    count,
  };
}

function evidence(
  overrides: Partial<InvestigationEvidence> = {},
): InvestigationEvidence {
  return {
    windowStartMs: WINDOW_START_MS,
    windowEndMs: WINDOW_END_MS,
    scopeChips: ["host.name = web-01"],
    logVolume: {
      total: 1000,
      errorCount: 20,
      warnCount: 0,
      errorRatePercent: 2,
      severities: [],
      series: [],
    },
    errorPatterns: [],
    logBuckets: [],
    markers: [],
    ...overrides,
  } as InvestigationEvidence;
}

describe("computeErrorHalves", () => {
  test("splits error-severity counts at the window midpoint by timestamp", () => {
    const halves: ReturnType<typeof computeErrorHalves> = computeErrorHalves(
      [
        bucket(2, "Error", 3),
        bucket(5, "Information", 100),
        bucket(20, "Error", 12),
        bucket(25, "Fatal", 5),
      ],
      WINDOW_START_MS,
      WINDOW_END_MS,
    );

    expect(halves).toEqual({ firstHalf: 3, secondHalf: 17 });
  });
});

describe("buildInvestigationFindings", () => {
  test("a change event leads the findings, as critical, with its lead time", () => {
    const findings: Array<InvestigationFinding> = buildInvestigationFindings(
      evidence({
        markers: [
          {
            kind: "change",
            label: "Deploy: v2.31.0",
            timeMs: WINDOW_END_MS - 3 * 60000,
          },
          {
            kind: "incident",
            label: "Incident: API down",
            timeMs: WINDOW_END_MS - 60000,
          },
        ],
      }),
    );

    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.text).toContain("Deploy: v2.31.0");
    expect(findings[0]?.text).toContain("3 minutes before");
    // The concurrent incident trails as info.
    expect(
      findings.find((finding: InvestigationFinding) => {
        return finding.text.includes("Incident: API down");
      })?.severity,
    ).toBe("info");
  });

  test("a rising error trend is a warning with the halves spelled out", () => {
    const findings: Array<InvestigationFinding> = buildInvestigationFindings(
      evidence({
        logBuckets: [bucket(5, "Error", 4), bucket(25, "Error", 40)],
      }),
    );

    const trend: InvestigationFinding | undefined = findings.find(
      (finding: InvestigationFinding) => {
        return finding.text.includes("rose");
      },
    );
    expect(trend?.severity).toBe("warning");
    expect(trend?.text).toContain("10.0×");
    expect(trend?.text).toContain("(4 → 40)");
  });

  test("a dominant error pattern is called out with its share", () => {
    const findings: Array<InvestigationFinding> = buildInvestigationFindings(
      evidence({
        errorPatterns: [
          {
            pattern: "conn refused <IP>",
            sampleBody: "conn refused 10.0.0.5",
            count: 15,
          } as never,
        ],
      }),
    );

    const dominant: InvestigationFinding | undefined = findings.find(
      (finding: InvestigationFinding) => {
        return finding.text.includes("accounts for");
      },
    );
    expect(dominant?.severity).toBe("warning");
    expect(dominant?.text).toContain("~75%");
    expect(dominant?.text).toContain("conn refused 10.0.0.5");
  });

  test("a quiet window yields honest guidance, never silence", () => {
    const findings: Array<InvestigationFinding> = buildInvestigationFindings(
      evidence({
        logVolume: {
          total: 100,
          errorCount: 0,
          warnCount: 0,
          errorRatePercent: 0,
          severities: [],
          series: [],
        },
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
    expect(findings[0]?.text).toContain("widening the window");
  });

  test("a high absolute error rate stands alone as a warning", () => {
    const findings: Array<InvestigationFinding> = buildInvestigationFindings(
      evidence({
        logVolume: {
          total: 200,
          errorCount: 30,
          warnCount: 0,
          errorRatePercent: 15,
          severities: [],
          series: [],
        },
      }),
    );

    expect(
      findings.some((finding: InvestigationFinding) => {
        return finding.severity === "warning" && finding.text.includes("15.0%");
      }),
    ).toBe(true);
  });
});

describe("prompt and note builders", () => {
  const sampleEvidence: InvestigationEvidence = evidence({
    errorPatterns: [
      {
        pattern: "timeout <N>",
        sampleBody: "timeout 30000ms",
        count: 12,
      } as never,
    ],
    markers: [
      { kind: "change", label: "Deploy: v9", timeMs: WINDOW_END_MS - 60000 },
    ],
  });
  const sampleFindings: Array<InvestigationFinding> =
    buildInvestigationFindings(sampleEvidence);

  test("the AI prompt restates the evidence and ends with the question", () => {
    const prompt: string = buildInvestigationPrompt(
      sampleEvidence,
      sampleFindings,
    );

    expect(prompt).toContain("host.name = web-01");
    expect(prompt).toContain("1,000 lines");
    expect(prompt).toContain("timeout 30000ms");
    expect(prompt).toContain("Deploy: v9");
    expect(prompt.trim().endsWith("check next?")).toBe(true);
  });

  test("the incident note is markdown with findings, patterns, and the explorer link", () => {
    const note: string = buildInvestigationNoteMarkdown({
      evidence: sampleEvidence,
      findings: sampleFindings,
      explorerUrl: "https://oneuptime.example/metrics/view?x=1",
    });

    expect(note).toContain("### Investigation snapshot");
    expect(note).toContain("**Scope:** host.name = web-01");
    expect(note).toContain("🔴");
    expect(note).toContain("`timeout 30000ms` — 12×");
    expect(note).toContain(
      "[Open these charts in the Metric Explorer](https://oneuptime.example/metrics/view?x=1)",
    );
  });
});

describe("explain/pin wiring", () => {
  function readSquashed(relative: string): string {
    return fs
      .readFileSync(
        path.join(__dirname, "../../FeatureSet/Dashboard/src", relative),
        "utf8",
      )
      .replace(/\s+/g, " ");
  }

  test("the drawer builds findings from its own evidence and offers both actions", () => {
    const drawer: string = readSquashed(
      "Components/Telemetry/InvestigationDrawer.tsx",
    );
    expect(drawer).toContain("buildInvestigationFindings");
    expect(drawer).toContain("Explain with AI");
    expect(drawer).toContain("Save to incident");
    expect(drawer).toContain("buildInvestigationNoteMarkdown");
    // The AI dispatch carries the prompt, never auto-sends.
    expect(drawer).toContain(
      "GlobalEvents.dispatchEvent(EventName.AI_CHAT_TOGGLE, { prompt:",
    );
  });

  test("the AI chat panel opens and pre-fills on a prompt dispatch", () => {
    const panel: string = readSquashed("Components/AIChat/AIChatPanel.tsx");
    expect(panel).toContain("setIsOpen(true)");
    expect(panel).toContain("chatRef.current?.setInputValue(prompt)");
  });
});
