import InvestigationReportSummary, {
  InvestigationReportSummaryRun,
} from "../../../../Server/Utils/AI/SRE/InvestigationReportSummary";
import {
  MAX_TLDR_CHARS,
  MIN_TLDR_CHARS,
} from "../../../../Server/Utils/AI/SRE/InvestigationTldr";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AlertFeed, {
  AlertFeedEventType,
} from "../../../../Models/DatabaseModels/AlertFeed";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../../Models/DatabaseModels/IncidentFeed";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Regression: every investigation on a cluster's AI page read "No summary
 * was recorded." The page showed only AIRun.analysisTldr — a separate,
 * best-effort LLM call made after the report is written — and whenever that
 * call fails (or the run predates it) the run keeps its full report but has
 * no TL;DR. The report says what was found too: the persona asks for a
 * **Summary** of one or two sentences. InvestigationReportSummary reads it
 * back, as plain text, capped like a TL;DR, so the AI Logs and AI Insights
 * pages show the finding the run actually published.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const OTHER_INCIDENT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-bbbbbbbbbbbb",
);
const ALERT_ID: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const RUN_A: ObjectID = new ObjectID("cccccccc-cccc-4ccc-8ccc-000000000001");
const RUN_B: ObjectID = new ObjectID("cccccccc-cccc-4ccc-8ccc-000000000002");
const RUN_C: ObjectID = new ObjectID("cccccccc-cccc-4ccc-8ccc-000000000003");

const SUMMARY: string =
  "The checkout deployment has 0 of 2 ready replicas because its image cannot be pulled.";

/*
 * The report exactly as AIInvestigationEngine.buildBrandedMarkdown posts a
 * telemetry-only run's: brand heading, analysis, evidence list, footer.
 */
function brandedReport(analysis: string): string {
  return [
    "## 🧠 AI — Automated Root Cause Analysis",
    "",
    analysis,
    "",
    "**Evidence checked**",
    "- **[C1]** Error logs of checkout — 12 row(s)",
    "- **[C2]** Pod restarts in shop — 3 row(s)",
    "",
    "---",
    "*Investigated automatically by OneUptime AI — read-only, 2 queries run across your own telemetry using gpt-test. This is an AI-generated first pass; verify before acting.*",
  ].join("\n");
}

function structuredAnalysis(summary: string): string {
  return [
    `**Summary** — ${summary}`,
    "",
    "**Most likely root cause** — The image tag v2.4.1 does not exist in the registry [C1].",
    "",
    "**Evidence** — kubectl reports ErrImagePull [C1].",
    "",
    "**Suggested next steps** — Roll the deployment back to v2.4.0.",
  ].join("\n");
}

// The ids a QueryHelper.any(...) filter asks for.
function idsIn(filter: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    (filter as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters || {};
  const values: unknown = Object.values(parameters)[0];

  return Array.isArray(values)
    ? values.map((value: unknown) => {
        return String(value);
      })
    : [];
}

describe("InvestigationReportSummary.fromReport", () => {
  test("reads the Summary section of a posted report as plain text", () => {
    expect(
      InvestigationReportSummary.fromReport(
        brandedReport(structuredAnalysis(SUMMARY)),
      ),
    ).toBe(SUMMARY);
  });

  test("drops citation markers and the space they leave before punctuation", () => {
    expect(
      InvestigationReportSummary.fromReport(
        brandedReport(
          structuredAnalysis(
            "The checkout deployment has 0 of 2 ready replicas [C1][C2], because its image cannot be pulled [C3].",
          ),
        ),
      ),
    ).toBe(
      "The checkout deployment has 0 of 2 ready replicas, because its image cannot be pulled.",
    );
  });

  test("flattens markdown the way a TL;DR is flattened", () => {
    expect(
      InvestigationReportSummary.fromReport(
        structuredAnalysis(
          "The **checkout** deployment's `ImagePullBackOff` comes from [the registry](https://registry.example.com) rejecting\nthe v2.4.1 tag.",
        ),
      ),
    ).toBe(
      "The checkout deployment's ImagePullBackOff comes from the registry rejecting the v2.4.1 tag.",
    );
  });

  test("keeps identifiers with underscores and an approximate tilde intact", () => {
    expect(
      InvestigationReportSummary.fromReport(
        structuredAnalysis(
          "http_request_duration_seconds rose ~40% after the node_exporter upgrade.",
        ),
      ),
    ).toBe(
      "http_request_duration_seconds rose ~40% after the node_exporter upgrade.",
    );
  });

  test("falls back to the root cause section when there is no Summary", () => {
    expect(
      InvestigationReportSummary.fromReport(
        brandedReport(
          [
            "**Most likely root cause** — The image tag v2.4.1 does not exist in the registry [C1].",
            "",
            "**Evidence** — kubectl reports ErrImagePull [C1].",
          ].join("\n"),
        ),
      ),
    ).toBe("The image tag v2.4.1 does not exist in the registry.");
  });

  test("reads a report that follows no section format at all from its body, without the brand, evidence list or footer", () => {
    const summary: string | null = InvestigationReportSummary.fromReport(
      brandedReport(
        "The pods are OOMKilled because the memory limit is 256Mi while the JVM heap is 512Mi.",
      ),
    );

    expect(summary).toBe(
      "The pods are OOMKilled because the memory limit is 256Mi while the JVM heap is 512Mi.",
    );
    expect(summary).not.toContain("Automated Root Cause Analysis");
    expect(summary).not.toContain("Evidence checked");
    expect(summary).not.toContain("Investigated automatically");
  });

  test("a report with only an Evidence section is read from its body, without the server's evidence list", () => {
    const summary: string | null = InvestigationReportSummary.fromReport(
      brandedReport(
        "**Evidence** — the checkout pods restart every 4 minutes with exit code 137 [C2].",
      ),
    );

    expect(summary).toContain(
      "the checkout pods restart every 4 minutes with exit code 137.",
    );
    expect(summary).not.toContain("Evidence checked");
    expect(summary).not.toContain("row(s)");
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty report", ""],
    ["a blank report", "   \n\t "],
  ])(
    "%s has no summary",
    (_label: string, value: string | null | undefined) => {
      expect(InvestigationReportSummary.fromReport(value)).toBeNull();
    },
  );

  test(`a summary shorter than ${MIN_TLDR_CHARS} characters is not worth showing`, () => {
    expect(
      InvestigationReportSummary.fromReport(structuredAnalysis("Unknown.")),
    ).toBeNull();
  });

  test(`a long summary is capped at ${MAX_TLDR_CHARS} characters on a word boundary`, () => {
    const long: string = Array.from({ length: 80 }, (_: unknown, i: number) => {
      return `word${i}`;
    }).join(" ");

    const summary: string = InvestigationReportSummary.fromReport(
      structuredAnalysis(long),
    )!;

    expect(summary.length).toBeLessThanOrEqual(MAX_TLDR_CHARS);
    expect(summary.endsWith("…")).toBe(true);
    expect(long.startsWith(summary.slice(0, -1))).toBe(true);
    expect(summary.slice(0, -1).endsWith(" ")).toBe(false);
  });

  test("text that looks like markup stays text: nothing is turned into HTML", () => {
    expect(
      InvestigationReportSummary.fromReport(
        structuredAnalysis(
          "The <script>alert(1)</script> payload in the pod logs is just a log line.",
        ),
      ),
    ).toBe(
      "The <script>alert(1)</script> payload in the pod logs is just a log line.",
    );
  });
});

describe("InvestigationReportSummary.getRunsWithoutTldr", () => {
  function run(overrides: Partial<Record<keyof AIRun, unknown>>): AIRun {
    return {
      id: RUN_A,
      status: AIRunStatus.Completed,
      triggeredByIncidentId: INCIDENT_ID,
      ...overrides,
    } as unknown as AIRun;
  }

  test("takes completed runs with a subject and no TL;DR", () => {
    expect(
      InvestigationReportSummary.getRunsWithoutTldr([
        run({}),
        run({
          id: RUN_B,
          triggeredByIncidentId: undefined,
          triggeredByAlertId: ALERT_ID,
          analysisTldr: "   ",
        }),
      ]),
    ).toEqual([
      { aiRunId: RUN_A, incidentId: INCIDENT_ID, alertId: undefined },
      { aiRunId: RUN_B, incidentId: undefined, alertId: ALERT_ID },
    ]);
  });

  test("leaves out a run with a TL;DR, one still running or one that failed", () => {
    expect(
      InvestigationReportSummary.getRunsWithoutTldr([
        run({ analysisTldr: SUMMARY }),
        run({ status: AIRunStatus.Running }),
        run({ status: AIRunStatus.Queued }),
        run({ status: AIRunStatus.Error }),
        run({ status: AIRunStatus.Stale }),
        run({ status: AIRunStatus.Cancelled }),
      ]),
    ).toEqual([]);
  });

  test("leaves out a run with no incident or alert: it posted no report", () => {
    expect(
      InvestigationReportSummary.getRunsWithoutTldr([
        run({ triggeredByIncidentId: undefined }),
        run({ id: undefined }),
      ]),
    ).toEqual([]);
  });
});

describe("InvestigationReportSummary.getForRuns", () => {
  let incidentFeedFind: jest.SpyInstance;
  let alertFeedFind: jest.SpyInstance;

  beforeEach(() => {
    incidentFeedFind = jest
      .spyOn(IncidentFeedService, "findBy")
      .mockResolvedValue([]);
    alertFeedFind = jest
      .spyOn(AlertFeedService, "findBy")
      .mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function incidentReport(
    aiRunId: ObjectID | undefined,
    incidentId: ObjectID | undefined,
    markdown: string,
  ): IncidentFeed {
    return {
      aiRunId,
      incidentId,
      feedInfoInMarkdown: markdown,
    } as unknown as IncidentFeed;
  }

  function alertReport(
    aiRunId: ObjectID | undefined,
    alertId: ObjectID | undefined,
    markdown: string,
  ): AlertFeed {
    return {
      aiRunId,
      alertId,
      feedInfoInMarkdown: markdown,
    } as unknown as AlertFeed;
  }

  test("asks nothing when no run needs a summary", async () => {
    const summaries: Map<string, string> =
      await InvestigationReportSummary.getForRuns({
        projectId: PROJECT_ID,
        runs: [],
      });

    expect(summaries.size).toBe(0);
    expect(incidentFeedFind).not.toHaveBeenCalled();
    expect(alertFeedFind).not.toHaveBeenCalled();
  });

  test("reads each run's own RootCause item, on its own subject, in this project, as root", async () => {
    const runs: Array<InvestigationReportSummaryRun> = [
      { aiRunId: RUN_A, incidentId: INCIDENT_ID },
      { aiRunId: RUN_B, alertId: ALERT_ID },
    ];

    await InvestigationReportSummary.getForRuns({
      projectId: PROJECT_ID,
      runs,
    });

    const incidentArgs: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = incidentFeedFind.mock.calls[0]![0] as never;
    expect(incidentArgs.query["projectId"]).toBe(PROJECT_ID);
    expect(incidentArgs.query["incidentFeedEventType"]).toBe(
      IncidentFeedEventType.RootCause,
    );
    expect(idsIn(incidentArgs.query["aiRunId"])).toEqual([RUN_A.toString()]);
    expect(idsIn(incidentArgs.query["incidentId"])).toEqual([
      INCIDENT_ID.toString(),
    ]);
    expect(incidentArgs.select).toEqual({
      aiRunId: true,
      incidentId: true,
      feedInfoInMarkdown: true,
    });
    expect(incidentArgs.props).toEqual({ isRoot: true });

    const alertArgs: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = alertFeedFind.mock.calls[0]![0] as never;
    expect(alertArgs.query["projectId"]).toBe(PROJECT_ID);
    expect(alertArgs.query["alertFeedEventType"]).toBe(
      AlertFeedEventType.RootCause,
    );
    expect(idsIn(alertArgs.query["aiRunId"])).toEqual([RUN_B.toString()]);
    expect(idsIn(alertArgs.query["alertId"])).toEqual([ALERT_ID.toString()]);
    expect(alertArgs.props).toEqual({ isRoot: true });
  });

  test("only incident runs ask the incident feed, only alert runs the alert feed", async () => {
    await InvestigationReportSummary.getForRuns({
      projectId: PROJECT_ID,
      runs: [{ aiRunId: RUN_A, incidentId: INCIDENT_ID }],
    });

    expect(incidentFeedFind).toHaveBeenCalledTimes(1);
    expect(alertFeedFind).not.toHaveBeenCalled();
  });

  test("summarises each report by the run that posted it", async () => {
    incidentFeedFind.mockResolvedValue([
      incidentReport(
        RUN_A,
        INCIDENT_ID,
        brandedReport(structuredAnalysis(SUMMARY)),
      ),
    ]);
    alertFeedFind.mockResolvedValue([
      alertReport(
        RUN_B,
        ALERT_ID,
        brandedReport(
          structuredAnalysis(
            "The node ran out of disk because its logs were never rotated.",
          ),
        ),
      ),
    ]);

    const summaries: Map<string, string> =
      await InvestigationReportSummary.getForRuns({
        projectId: PROJECT_ID,
        runs: [
          { aiRunId: RUN_A, incidentId: INCIDENT_ID },
          { aiRunId: RUN_B, alertId: ALERT_ID },
          { aiRunId: RUN_C, incidentId: INCIDENT_ID },
        ],
      });

    expect(Array.from(summaries.entries())).toEqual([
      [RUN_A.toString(), SUMMARY],
      [
        RUN_B.toString(),
        "The node ran out of disk because its logs were never rotated.",
      ],
    ]);
  });

  test("ignores a report on another subject than the run's, or with no run at all", async () => {
    incidentFeedFind.mockResolvedValue([
      incidentReport(
        RUN_A,
        OTHER_INCIDENT_ID,
        brandedReport(structuredAnalysis(SUMMARY)),
      ),
      incidentReport(
        undefined,
        INCIDENT_ID,
        brandedReport(structuredAnalysis(SUMMARY)),
      ),
    ]);

    const summaries: Map<string, string> =
      await InvestigationReportSummary.getForRuns({
        projectId: PROJECT_ID,
        runs: [{ aiRunId: RUN_A, incidentId: INCIDENT_ID }],
      });

    expect(summaries.size).toBe(0);
  });

  test("a report with nothing usable in it gives no summary, and the first usable one wins", async () => {
    incidentFeedFind.mockResolvedValue([
      incidentReport(RUN_A, INCIDENT_ID, "   "),
      incidentReport(
        RUN_B,
        INCIDENT_ID,
        brandedReport(structuredAnalysis(SUMMARY)),
      ),
      incidentReport(
        RUN_B,
        INCIDENT_ID,
        brandedReport(
          structuredAnalysis(
            "A second report for the same run never replaces the first.",
          ),
        ),
      ),
    ]);

    const summaries: Map<string, string> =
      await InvestigationReportSummary.getForRuns({
        projectId: PROJECT_ID,
        runs: [
          { aiRunId: RUN_A, incidentId: INCIDENT_ID },
          { aiRunId: RUN_B, incidentId: INCIDENT_ID },
        ],
      });

    expect(summaries.has(RUN_A.toString())).toBe(false);
    expect(summaries.get(RUN_B.toString())).toBe(SUMMARY);
  });

  test("a run with both an incident and an alert is read from its incident", async () => {
    incidentFeedFind.mockResolvedValue([
      incidentReport(
        RUN_A,
        INCIDENT_ID,
        brandedReport(structuredAnalysis(SUMMARY)),
      ),
    ]);

    const summaries: Map<string, string> =
      await InvestigationReportSummary.getForRuns({
        projectId: PROJECT_ID,
        runs: [{ aiRunId: RUN_A, incidentId: INCIDENT_ID, alertId: ALERT_ID }],
      });

    expect(alertFeedFind).not.toHaveBeenCalled();
    expect(summaries.get(RUN_A.toString())).toBe(SUMMARY);
  });

  test("asks for each id once, however many runs share a subject", async () => {
    await InvestigationReportSummary.getForRuns({
      projectId: PROJECT_ID,
      runs: [
        { aiRunId: RUN_A, incidentId: INCIDENT_ID },
        { aiRunId: RUN_B, incidentId: INCIDENT_ID },
        { aiRunId: RUN_B, incidentId: INCIDENT_ID },
      ],
    });

    const query: Record<string, unknown> = (
      incidentFeedFind.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(idsIn(query["incidentId"])).toEqual([INCIDENT_ID.toString()]);
    expect(idsIn(query["aiRunId"])).toEqual([
      RUN_A.toString(),
      RUN_B.toString(),
    ]);
  });
});

/*
 * What OneUptime AI would do about a problem that keeps coming back: the
 * first step its report's Suggested next steps section names. The AI
 * Insights page leads a recurring problem with it, as plain text.
 */
describe("InvestigationReportSummary.getFirstStep", () => {
  test.each([
    [
      "- Roll back to v2.4.0.\n- Then check the registry.",
      "Roll back to v2.4.0.",
    ],
    ["* Roll back to v2.4.0.\n* Then check.", "Roll back to v2.4.0."],
    ["+ Roll back to v2.4.0.", "Roll back to v2.4.0."],
    ["1. Roll back to v2.4.0.\n2. Then check.", "Roll back to v2.4.0."],
    ["1) Roll back to v2.4.0.\n2) Then check.", "Roll back to v2.4.0."],
  ])("the first item of %j", (markdown: string, expected: string) => {
    expect(InvestigationReportSummary.getFirstStep(markdown)).toBe(expected);
  });

  test("keeps the lines that continue the first item, up to the next item", () => {
    expect(
      InvestigationReportSummary.getFirstStep(
        [
          "- Raise the memory limit of deployment api",
          "  to 1Gi, then watch its heap.",
          "- Then look at the release.",
        ].join("\n"),
      ),
    ).toBe(
      "Raise the memory limit of deployment api to 1Gi, then watch its heap.",
    );
  });

  test("stops at a blank line after the first item", () => {
    expect(
      InvestigationReportSummary.getFirstStep(
        ["- Raise the limit.", "", "A paragraph after the list."].join("\n"),
      ),
    ).toBe("Raise the limit.");
  });

  test("a section written as prose is its first paragraph", () => {
    expect(
      InvestigationReportSummary.getFirstStep(
        [
          "",
          "Roll the deployment back to v2.4.0,",
          "then pin the image tag.",
          "",
          "Afterwards, add an alert on ErrImagePull.",
        ].join("\n"),
      ),
    ).toBe("Roll the deployment back to v2.4.0, then pin the image tag.");
  });

  test("reads Windows line endings like any other", () => {
    expect(
      InvestigationReportSummary.getFirstStep(
        "- Raise the limit.\r\n- Then check.",
      ),
    ).toBe("Raise the limit.");
  });

  test("a list after an introduction is still read from its first item", () => {
    expect(
      InvestigationReportSummary.getFirstStep(
        ["In order:", "- Raise the limit.", "- Then check."].join("\n"),
      ),
    ).toBe("Raise the limit.");
  });
});

describe("InvestigationReportSummary.nextStepFromReport", () => {
  function reportWithSteps(steps: string): string {
    return brandedReport(
      [
        `**Summary** — ${SUMMARY}`,
        "",
        "**Most likely root cause** — The image tag does not exist [C1].",
        "",
        "**Suggested next steps**",
        steps,
      ].join("\n"),
    );
  }

  test("reads the first suggested step of a posted report, without the server's evidence list or footer", () => {
    expect(
      InvestigationReportSummary.nextStepFromReport(
        brandedReport(structuredAnalysis(SUMMARY)),
      ),
    ).toBe("Roll the deployment back to v2.4.0.");
  });

  test("drops citation markers and the space they leave, and flattens markdown", () => {
    expect(
      InvestigationReportSummary.nextStepFromReport(
        reportWithSteps(
          "- Roll **checkout** back to `v2.4.0` [C1].\n- Pin the tag [C2].",
        ),
      ),
    ).toBe("Roll checkout back to v2.4.0.");
  });

  test("nothing for a report without the section, or nothing usable in it", () => {
    expect(
      InvestigationReportSummary.nextStepFromReport(
        brandedReport(`**Summary** — ${SUMMARY}`),
      ),
    ).toBeNull();
    expect(InvestigationReportSummary.nextStepFromReport("")).toBeNull();
    expect(InvestigationReportSummary.nextStepFromReport("   ")).toBeNull();
    expect(InvestigationReportSummary.nextStepFromReport(undefined)).toBeNull();
    expect(InvestigationReportSummary.nextStepFromReport(null)).toBeNull();
  });

  test(`a step shorter than ${MIN_TLDR_CHARS} characters is not worth showing`, () => {
    expect(
      InvestigationReportSummary.nextStepFromReport(reportWithSteps("- Wait.")),
    ).toBeNull();
  });

  test(`a long step is capped at ${MAX_TLDR_CHARS} characters on a word boundary`, () => {
    const step: string | null = InvestigationReportSummary.nextStepFromReport(
      reportWithSteps(`- ${"Raise the memory limit again ".repeat(30)}`),
    );

    expect(step!.length).toBeLessThanOrEqual(MAX_TLDR_CHARS);
    expect(step!.endsWith("…")).toBe(true);
  });

  test("text that looks like markup stays text: nothing is turned into HTML", () => {
    expect(
      InvestigationReportSummary.nextStepFromReport(
        reportWithSteps(
          "- Remove the <script>alert(1)</script> from the page.",
        ),
      ),
    ).toBe("Remove the <script>alert(1)</script> from the page.");
  });
});

describe("InvestigationReportSummary.getConclusionsForRuns", () => {
  let incidentFeedFind: jest.SpyInstance;
  let alertFeedFind: jest.SpyInstance;

  beforeEach(() => {
    incidentFeedFind = jest
      .spyOn(IncidentFeedService, "findBy")
      .mockResolvedValue([]);
    alertFeedFind = jest
      .spyOn(AlertFeedService, "findBy")
      .mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function report(
    aiRunId: ObjectID,
    incidentId: ObjectID,
    markdown: string,
  ): IncidentFeed {
    return {
      aiRunId,
      incidentId,
      feedInfoInMarkdown: markdown,
    } as unknown as IncidentFeed;
  }

  test("what each run's report concluded: its Summary and its first suggested step", async () => {
    incidentFeedFind.mockResolvedValue([
      report(RUN_A, INCIDENT_ID, brandedReport(structuredAnalysis(SUMMARY))),
    ]);

    const conclusions: Map<
      string,
      { summary?: string | undefined; nextStep?: string | undefined }
    > = await InvestigationReportSummary.getConclusionsForRuns({
      projectId: PROJECT_ID,
      runs: [{ aiRunId: RUN_A, incidentId: INCIDENT_ID }],
    });

    expect(conclusions.get(RUN_A.toString())).toEqual({
      summary: SUMMARY,
      nextStep: "Roll the deployment back to v2.4.0.",
    });
  });

  test("is read the way summaries are: the run's own RootCause item on its own subject, in this project, as root", async () => {
    await InvestigationReportSummary.getConclusionsForRuns({
      projectId: PROJECT_ID,
      runs: [
        { aiRunId: RUN_A, incidentId: INCIDENT_ID },
        { aiRunId: RUN_B, alertId: ALERT_ID },
      ],
    });

    const incidentCall: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = incidentFeedFind.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    };
    expect(incidentCall.query["projectId"]).toBe(PROJECT_ID);
    expect(incidentCall.query["incidentFeedEventType"]).toBe(
      IncidentFeedEventType.RootCause,
    );
    expect(idsIn(incidentCall.query["aiRunId"])).toEqual([RUN_A.toString()]);
    expect(incidentCall.props).toEqual({ isRoot: true });

    const alertCall: { query: Record<string, unknown> } = alertFeedFind.mock
      .calls[0]![0] as { query: Record<string, unknown> };
    expect(alertCall.query["alertFeedEventType"]).toBe(
      AlertFeedEventType.RootCause,
    );
    expect(idsIn(alertCall.query["aiRunId"])).toEqual([RUN_B.toString()]);
  });

  test("a report that says only one of them gives that one; one that says neither leaves the run out", async () => {
    incidentFeedFind.mockResolvedValue([
      report(RUN_A, INCIDENT_ID, brandedReport(`**Summary** — ${SUMMARY}`)),
      report(RUN_B, INCIDENT_ID, "   "),
    ]);

    const conclusions: Map<
      string,
      { summary?: string | undefined; nextStep?: string | undefined }
    > = await InvestigationReportSummary.getConclusionsForRuns({
      projectId: PROJECT_ID,
      runs: [
        { aiRunId: RUN_A, incidentId: INCIDENT_ID },
        { aiRunId: RUN_B, incidentId: INCIDENT_ID },
      ],
    });

    expect(conclusions.get(RUN_A.toString())).toEqual({ summary: SUMMARY });
    expect(conclusions.has(RUN_B.toString())).toBe(false);
  });

  test("each part comes from the first report that says it", async () => {
    incidentFeedFind.mockResolvedValue([
      report(RUN_A, INCIDENT_ID, brandedReport(`**Summary** — ${SUMMARY}`)),
      report(
        RUN_A,
        INCIDENT_ID,
        brandedReport(
          structuredAnalysis(
            "A second summary for the same run never replaces the first one.",
          ),
        ),
      ),
    ]);

    const conclusions: Map<
      string,
      { summary?: string | undefined; nextStep?: string | undefined }
    > = await InvestigationReportSummary.getConclusionsForRuns({
      projectId: PROJECT_ID,
      runs: [{ aiRunId: RUN_A, incidentId: INCIDENT_ID }],
    });

    expect(conclusions.get(RUN_A.toString())).toEqual({
      summary: SUMMARY,
      nextStep: "Roll the deployment back to v2.4.0.",
    });
  });

  test("a report on another subject than the run's is never read as the run's", async () => {
    incidentFeedFind.mockResolvedValue([
      report(
        RUN_A,
        OTHER_INCIDENT_ID,
        brandedReport(structuredAnalysis(SUMMARY)),
      ),
    ]);

    const conclusions: Map<
      string,
      { summary?: string | undefined; nextStep?: string | undefined }
    > = await InvestigationReportSummary.getConclusionsForRuns({
      projectId: PROJECT_ID,
      runs: [{ aiRunId: RUN_A, incidentId: INCIDENT_ID }],
    });

    expect(conclusions.size).toBe(0);
  });

  test("asks nothing for no runs", async () => {
    expect(
      (
        await InvestigationReportSummary.getConclusionsForRuns({
          projectId: PROJECT_ID,
          runs: [],
        })
      ).size,
    ).toBe(0);
    expect(incidentFeedFind).not.toHaveBeenCalled();
    expect(alertFeedFind).not.toHaveBeenCalled();
  });
});
