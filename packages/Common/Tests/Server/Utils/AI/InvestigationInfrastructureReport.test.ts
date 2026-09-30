import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import ObservabilityAssistant, {
  ObservabilityAssistantRequest,
  ObservabilityAssistantResult,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIConfidenceSignal from "../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import {
  LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
  RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
} from "../../../../Server/Utils/AI/ResourceAccess/ResourceAccessToolNames";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import { AIChatCitation } from "../../../../Types/AI/AIChatTypes";
import {
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccessToolNames";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  InvestigationEvidenceCheckedEntry,
  ParsedInvestigationReport,
  parseInvestigationReport,
} from "../../../../Utils/AI/InvestigationReport";
import { afterEach, describe, expect, it, test } from "@jest/globals";

/*
 * Contract under test — the posted report and its parser, for commands run
 * on infrastructure resources through their AI agents
 * (run_infrastructure_command, list_infrastructure_access):
 *
 * - such a call is described as what it was ("succeeded", "command
 *   returned an error", "N resource(s)"), never in rows, and never counted
 *   as a query run across the customer's telemetry;
 * - the footer appends "N infrastructure commands run on your
 *   infrastructure" ONLY when the run used those tools, so every report of
 *   a run that did not is byte-for-byte what it was (pinned against the
 *   engine's previous implementation, copied below);
 * - the dashboard's parser reads every new shape back as the server's
 *   block, with the infrastructure count, and still rejects a block the
 *   footer's counts show the model wrote.
 */

const aiRunId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

function citation(
  id: string,
  toolName: string,
  rowCount: number,
  label: string,
): AIChatCitation {
  return { id, toolName, label, rowCount, queryArguments: {} };
}

// A null model name is a run that reported none.
function result(
  citations: Array<AIChatCitation>,
  toolCallCount: number,
  modelName: string | null = "gpt-4.1-mini",
): ObservabilityAssistantResult {
  return {
    contentInMarkdown: "**Summary** — web-1 is restarting [C1].",
    citations,
    totalTokens: 100,
    llmCallCount: 2,
    toolCallCount,
    ...(modelName ? { modelName } : {}),
  };
}

/*
 * The engine's buildBrandedMarkdown before infrastructure tools existed,
 * verbatim but for its helper inlined — every run that uses none of them
 * must still post exactly this.
 */
function legacyBuildBrandedMarkdown(
  res: ObservabilityAssistantResult,
  analysisMarkdown: string,
  clusterToolCallCount: number = 0,
): string {
  const describeClusterCitationOutcome: (
    cited: AIChatCitation,
  ) => string | null = (cited: AIChatCitation): string | null => {
    if (cited.toolName === RUN_KUBECTL_TOOL_NAME) {
      return cited.rowCount > 0 ? "succeeded" : "kubectl returned an error";
    }

    if (cited.toolName === LIST_CLUSTER_ACCESS_TOOL_NAME) {
      return `${cited.rowCount} cluster(s)`;
    }

    return null;
  };

  let markdown: string = `## 🧠 AI — Automated Root Cause Analysis\n\n${analysisMarkdown}`;

  const citations: Array<AIChatCitation> = res.citations || [];

  if (citations.length > 0) {
    markdown += `\n\n**Evidence checked**`;
    for (const cited of citations.slice(0, 15)) {
      const clusterOutcome: string | null =
        describeClusterCitationOutcome(cited);

      if (clusterOutcome !== null) {
        markdown += `\n- **[${cited.id}]** ${cited.label} — ${clusterOutcome}`;
        continue;
      }

      markdown += `\n- **[${cited.id}]** ${cited.label} — ${cited.rowCount} row(s)`;
    }
  }

  if (clusterToolCallCount <= 0) {
    markdown += `\n\n---\n*Investigated automatically by OneUptime AI — read-only, ${res.toolCallCount} quer${
      res.toolCallCount === 1 ? "y" : "ies"
    } run across your own telemetry${
      res.modelName ? ` using ${res.modelName}` : ""
    }. This is an AI-generated first pass; verify before acting.*`;

    return markdown;
  }

  const telemetryQueryCount: number = Math.max(
    0,
    res.toolCallCount - clusterToolCallCount,
  );
  const kubectlCommandCount: number = citations.filter(
    (cited: AIChatCitation): boolean => {
      return cited.toolName === RUN_KUBECTL_TOOL_NAME;
    },
  ).length;
  const counts: Array<string> = [];

  if (telemetryQueryCount > 0) {
    counts.push(
      `${telemetryQueryCount} quer${
        telemetryQueryCount === 1 ? "y" : "ies"
      } run across your own telemetry`,
    );
  }

  if (kubectlCommandCount > 0) {
    counts.push(
      `${kubectlCommandCount} kubectl ${
        kubectlCommandCount === 1 ? "command" : "commands"
      } run on your Kubernetes clusters`,
    );
  }

  if (counts.length === 0) {
    counts.push("no telemetry queries or kubectl commands run");
  }

  markdown += `\n\n---\n*Investigated automatically by OneUptime AI — read-only, ${counts.join(
    " and ",
  )}${
    res.modelName ? ` using ${res.modelName}` : ""
  }. This is an AI-generated first pass; verify before acting.*`;

  return markdown;
}

const INFRA_CITATIONS: Array<AIChatCitation> = [
  citation("C1", "query_metrics", 5, "Max(restarts)"),
  citation(
    "C2",
    RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    1,
    '`docker ps -a` on Docker host "web-1"',
  ),
  citation(
    "C3",
    RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    0,
    '`docker logs --tail 200 web` on Docker host "web-1"',
  ),
  citation(
    "C4",
    LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
    2,
    "Infrastructure OneUptime AI can inspect",
  ),
];

describe("AIInvestigationEngine.buildBrandedMarkdown and infrastructure commands", () => {
  it("describes each infrastructure citation by its outcome, never in rows", () => {
    const markdown: string = AIInvestigationEngine.buildBrandedMarkdown(
      result(INFRA_CITATIONS, 5),
      "**Summary** — x.",
      0,
      4,
    );

    expect(markdown).toContain(
      '- **[C2]** `docker ps -a` on Docker host "web-1" — succeeded',
    );
    expect(markdown).toContain(
      '- **[C3]** `docker logs --tail 200 web` on Docker host "web-1" — command returned an error',
    );
    expect(markdown).toContain(
      "- **[C4]** Infrastructure OneUptime AI can inspect — 2 resource(s)",
    );
    expect(markdown).toContain("- **[C1]** Max(restarts) — 5 row(s)");
    expect(markdown).not.toMatch(/docker[^\n]*row\(s\)/);
  });

  it("counts telemetry queries and infrastructure commands apart", () => {
    const markdown: string = AIInvestigationEngine.buildBrandedMarkdown(
      result(INFRA_CITATIONS, 5),
      "**Summary** — x.",
      0,
      4,
    );

    expect(markdown).toContain(
      "*Investigated automatically by OneUptime AI — read-only, 1 query run across your own telemetry and 2 infrastructure commands run on your infrastructure using gpt-4.1-mini. This is an AI-generated first pass; verify before acting.*",
    );
  });

  it("joins three counts as A, B and C", () => {
    const markdown: string = AIInvestigationEngine.buildBrandedMarkdown(
      result(
        [
          citation("C1", "search_logs", 3, "Logs"),
          citation("C2", RUN_KUBECTL_TOOL_NAME, 1, "kubectl get pods"),
          citation(
            "C3",
            RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
            1,
            '`uptime` on Host "db"',
          ),
        ],
        4,
      ),
      "**Summary** — x.",
      1,
      1,
    );

    expect(markdown).toContain(
      "— read-only, 2 queries run across your own telemetry, 1 kubectl command run on your Kubernetes clusters and 1 infrastructure command run on your infrastructure using gpt-4.1-mini.",
    );
  });

  it("names only infrastructure when that is all that ran", () => {
    const markdown: string = AIInvestigationEngine.buildBrandedMarkdown(
      result(
        [
          citation(
            "C1",
            RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
            1,
            '`ceph health detail` on Ceph cluster "ceph"',
          ),
        ],
        1,
      ),
      "**Summary** — x.",
      0,
      1,
    );

    expect(markdown).toContain(
      "— read-only, 1 infrastructure command run on your infrastructure using gpt-4.1-mini.",
    );
    expect(markdown).not.toContain("quer");
  });

  it("says nothing ran when the infrastructure calls ran nothing", () => {
    expect(
      AIInvestigationEngine.buildBrandedMarkdown(
        result(
          [citation("C1", LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME, 1, "Infra")],
          2,
        ),
        "**Summary** — x.",
        0,
        2,
      ),
    ).toContain(
      "— read-only, no telemetry queries or infrastructure commands run using gpt-4.1-mini.",
    );

    expect(
      AIInvestigationEngine.buildBrandedMarkdown(
        result([], 3),
        "**Summary** — x.",
        1,
        2,
      ),
    ).toContain(
      "— read-only, no telemetry queries, kubectl commands or infrastructure commands run using gpt-4.1-mini.",
    );
  });

  it("writes no model name when the run has none", () => {
    expect(
      AIInvestigationEngine.buildBrandedMarkdown(
        result(INFRA_CITATIONS, 5, null),
        "**Summary** — x.",
        0,
        4,
      ),
    ).toContain(
      "and 2 infrastructure commands run on your infrastructure. This is an AI-generated first pass; verify before acting.*",
    );
  });

  /*
   * Byte identity: a run that never used an infrastructure tool posts
   * exactly what the engine posted before those tools existed.
   */
  const LEGACY_SHAPES: Array<
    [string, Array<AIChatCitation>, number, number, string | null]
  > = [
    ["telemetry only", [citation("C1", "search_logs", 3, "Logs")], 1, 0, "m"],
    ["telemetry, plural", [citation("C1", "query_metrics", 5, "M")], 7, 0, "m"],
    ["no citations", [], 0, 0, "m"],
    ["no model", [citation("C1", "search_logs", 1, "Logs")], 1, 0, null],
    [
      "kubectl and telemetry",
      [
        citation("C1", "query_metrics", 5, "Max(latency)"),
        citation("C2", RUN_KUBECTL_TOOL_NAME, 0, "kubectl get pods"),
        citation("C3", RUN_KUBECTL_TOOL_NAME, 1, "kubectl describe pod"),
        citation("C4", LIST_CLUSTER_ACCESS_TOOL_NAME, 2, "Clusters"),
      ],
      6,
      4,
      "gpt-4.1-mini",
    ],
    [
      "kubectl only",
      [citation("C1", RUN_KUBECTL_TOOL_NAME, 1, "kubectl get pods")],
      1,
      1,
      "gpt-4.1-mini",
    ],
    [
      "a cluster listing only",
      [citation("C1", LIST_CLUSTER_ACCESS_TOOL_NAME, 1, "Clusters")],
      2,
      2,
      "gpt-4.1-mini",
    ],
    [
      "more than 15 citations",
      Array.from({ length: 20 }, (_value: unknown, index: number) => {
        return citation(`C${index + 1}`, "search_logs", index, `Logs ${index}`);
      }),
      20,
      0,
      "m",
    ],
  ];

  test.each(LEGACY_SHAPES)(
    "posts exactly what it always has for %s",
    (
      _label: string,
      citations: Array<AIChatCitation>,
      toolCallCount: number,
      clusterToolCallCount: number,
      modelName: string | null,
    ) => {
      const res: ObservabilityAssistantResult = result(
        citations,
        toolCallCount,
        modelName,
      );
      const expected: string = legacyBuildBrandedMarkdown(
        res,
        "**Summary** — x.",
        clusterToolCallCount,
      );

      expect(
        AIInvestigationEngine.buildBrandedMarkdown(
          res,
          "**Summary** — x.",
          clusterToolCallCount,
        ),
      ).toBe(expected);
      expect(
        AIInvestigationEngine.buildBrandedMarkdown(
          res,
          "**Summary** — x.",
          clusterToolCallCount,
          0,
        ),
      ).toBe(expected);
    },
  );
});

describe("parseInvestigationReport reads the infrastructure footer and evidence", () => {
  function parse(
    citations: Array<AIChatCitation>,
    toolCallCount: number,
    clusterToolCallCount: number,
    infrastructureToolCallCount: number,
  ): ParsedInvestigationReport {
    return parseInvestigationReport(
      AIInvestigationEngine.buildBrandedMarkdown(
        result(citations, toolCallCount),
        "**Summary** — web-1 is restarting.\n\n**Most likely root cause** — x.",
        clusterToolCallCount,
        infrastructureToolCallCount,
      ),
    );
  }

  function ids(report: ParsedInvestigationReport): Array<string> {
    return report.evidenceChecked.map(
      (entry: InvestigationEvidenceCheckedEntry): string => {
        return entry.citationId;
      },
    );
  }

  test.each<[string, Array<AIChatCitation>, number, number, number]>([
    ["telemetry and infrastructure", INFRA_CITATIONS, 5, 0, 4],
    [
      "infrastructure only",
      [
        citation(
          "C1",
          RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
          1,
          '`a` on Host "h"',
        ),
        citation(
          "C2",
          RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
          0,
          '`b` on Host "h"',
        ),
      ],
      2,
      0,
      2,
    ],
    [
      "a resource listing only",
      [citation("C1", LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME, 1, "Infra")],
      1,
      0,
      1,
    ],
    [
      "all three",
      [
        citation("C1", "search_logs", 3, "Logs"),
        citation("C2", RUN_KUBECTL_TOOL_NAME, 1, "kubectl get pods"),
        citation("C3", RUN_KUBECTL_TOOL_NAME, 0, "kubectl get nodes"),
        citation(
          "C4",
          RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
          1,
          '`uptime` on Host "h"',
        ),
        citation("C5", LIST_CLUSTER_ACCESS_TOOL_NAME, 1, "Clusters"),
        citation("C6", LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME, 1, "Infra"),
      ],
      7,
      3,
      2,
    ],
  ])(
    "keeps the %s evidence block the server's",
    (
      _label: string,
      citations: Array<AIChatCitation>,
      toolCallCount: number,
      clusterToolCallCount: number,
      infrastructureToolCallCount: number,
    ) => {
      const report: ParsedInvestigationReport = parse(
        citations,
        toolCallCount,
        clusterToolCallCount,
        infrastructureToolCallCount,
      );

      expect(report.bodyMarkdown).not.toContain("Evidence checked");
      expect(report.footer?.modelName).toBe("gpt-4.1-mini");
      expect(ids(report)).toEqual(
        citations.map((cited: AIChatCitation): string => {
          return cited.id;
        }),
      );
    },
  );

  it("reads the footer's counts", () => {
    const report: ParsedInvestigationReport = parse(INFRA_CITATIONS, 5, 0, 4);

    expect(report.footer?.queryCount).toBe(1);
    expect(report.footer?.infrastructureCommandCount).toBe(2);
    expect(report.footer?.kubectlCommandCount).toBeUndefined();
  });

  it("reads the three-part footer", () => {
    const report: ParsedInvestigationReport = parse(
      [
        citation("C1", "search_logs", 3, "Logs"),
        citation("C2", RUN_KUBECTL_TOOL_NAME, 1, "kubectl get pods"),
        citation(
          "C3",
          RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
          1,
          '`uptime` on Host "h"',
        ),
      ],
      4,
      1,
      1,
    );

    expect(report.footer?.queryCount).toBe(2);
    expect(report.footer?.kubectlCommandCount).toBe(1);
    expect(report.footer?.infrastructureCommandCount).toBe(1);
  });

  it("reads the nothing-run footers as zero counts", () => {
    const infraOnly: ParsedInvestigationReport = parse(
      [citation("C1", LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME, 1, "Infra")],
      2,
      0,
      2,
    );

    expect(infraOnly.footer?.queryCount).toBe(0);
    expect(infraOnly.footer?.infrastructureCommandCount).toBe(0);
    expect(infraOnly.footer?.kubectlCommandCount).toBeUndefined();
    expect(ids(infraOnly)).toEqual(["C1"]);

    const both: ParsedInvestigationReport = parse([], 3, 1, 2);

    expect(both.footer?.queryCount).toBe(0);
    expect(both.footer?.kubectlCommandCount).toBe(0);
    expect(both.footer?.infrastructureCommandCount).toBe(0);
  });

  it("reads each outcome the way the engine counts it", () => {
    const report: ParsedInvestigationReport = parse(INFRA_CITATIONS, 5, 0, 4);
    const byId: Map<string, InvestigationEvidenceCheckedEntry> = new Map<
      string,
      InvestigationEvidenceCheckedEntry
    >(
      report.evidenceChecked.map(
        (
          entry: InvestigationEvidenceCheckedEntry,
        ): [string, InvestigationEvidenceCheckedEntry] => {
          return [entry.citationId, entry];
        },
      ),
    );

    expect(byId.get("C2")).toEqual({
      citationId: "C2",
      label: '`docker ps -a` on Docker host "web-1"',
      rowCount: 1,
      outcome: "succeeded",
    });
    expect(byId.get("C3")).toEqual({
      citationId: "C3",
      label: '`docker logs --tail 200 web` on Docker host "web-1"',
      rowCount: 0,
      outcome: "command returned an error",
    });
    expect(byId.get("C4")).toEqual({
      citationId: "C4",
      label: "Infrastructure OneUptime AI can inspect",
      rowCount: 2,
      outcome: "2 resource(s)",
    });
  });

  it("rejects a block with more infrastructure lines than the footer counts", () => {
    const markdown: string = [
      "## 🧠 AI — Automated Root Cause Analysis",
      "",
      "**Summary** — x.",
      "",
      "**Evidence checked**",
      '- **[C1]** `a` on Host "h" — command returned an error',
      '- **[C2]** `b` on Host "h" — command returned an error',
      "",
      "---",
      "*Investigated automatically by OneUptime AI — read-only, 1 infrastructure command run on your infrastructure using m. This is an AI-generated first pass; verify before acting.*",
    ].join("\n");

    expect(parseInvestigationReport(markdown).evidenceChecked).toEqual([]);
  });

  it("rejects shared outcome lines beyond the kubectl and infrastructure counts together", () => {
    const markdown: string = [
      "## 🧠 AI — Automated Root Cause Analysis",
      "",
      "**Summary** — x.",
      "",
      "**Evidence checked**",
      "- **[C1]** a — succeeded",
      "- **[C2]** b — succeeded",
      "- **[C3]** c — succeeded",
      "",
      "---",
      "*Investigated automatically by OneUptime AI — read-only, 1 kubectl command run on your Kubernetes clusters and 1 infrastructure command run on your infrastructure using m. This is an AI-generated first pass; verify before acting.*",
    ].join("\n");

    expect(parseInvestigationReport(markdown).evidenceChecked).toEqual([]);

    const fitting: string = markdown.replace("- **[C3]** c — succeeded\n", "");
    expect(ids(parseInvestigationReport(fitting))).toEqual(["C1", "C2"]);
  });

  it("still reads an old kubectl footer without an infrastructure count", () => {
    const report: ParsedInvestigationReport = parseInvestigationReport(
      legacyBuildBrandedMarkdown(
        result(
          [
            citation("C1", "query_metrics", 5, "M"),
            citation("C2", RUN_KUBECTL_TOOL_NAME, 1, "kubectl get pods"),
          ],
          2,
        ),
        "**Summary** — x.",
        1,
      ),
    );

    expect(report.footer?.queryCount).toBe(1);
    expect(report.footer?.kubectlCommandCount).toBe(1);
    expect(report.footer?.infrastructureCommandCount).toBeUndefined();
    expect(ids(report)).toEqual(["C1", "C2"]);
  });
});

describe("AIInvestigationEngine counts the infrastructure calls a run started", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("posts the report with the infrastructure calls apart from telemetry", async () => {
    jest
      .spyOn(AIRunEventService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(AIRunEventService, "create")
      .mockResolvedValue({} as unknown as AIRunEvent);
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    jest
      .spyOn(AIConfidenceSignal, "computeConfidenceSignal")
      .mockResolvedValue({
        confident: true,
        codeFixRecommended: false,
        source: "classification",
      });
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockImplementation(
        async (
          data: ObservabilityAssistantRequest,
        ): Promise<ObservabilityAssistantResult> => {
          for (const toolName of [
            "query_metrics",
            LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
            RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
            RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
            RUN_KUBECTL_TOOL_NAME,
          ]) {
            await data.onStep!({ type: "tool_started", toolName });
          }
          return result(
            [
              citation("C1", "query_metrics", 5, "Max(restarts)"),
              citation(
                "C2",
                RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
                1,
                '`docker ps -a` on Docker host "web-1"',
              ),
              citation("C3", RUN_KUBECTL_TOOL_NAME, 1, "kubectl get pods"),
            ],
            5,
          );
        },
      );
    const postAnalysis: jest.Mock = jest.fn(async (): Promise<void> => {});

    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId,
      attemptCount: 1,
      request: {
        feature: "Test Investigation",
        contextSummary: "# Subject",
        postAnalysis:
          postAnalysis as unknown as InvestigationRequest["postAnalysis"],
      },
    });

    expect(postAnalysis).toHaveBeenCalledTimes(1);
    const posted: string = (
      postAnalysis.mock.calls[0]![0] as { analysisMarkdown: string }
    ).analysisMarkdown;

    expect(posted).toContain(
      "read-only, 1 query run across your own telemetry, 1 kubectl command run on your Kubernetes clusters and 1 infrastructure command run on your infrastructure",
    );
    expect(posted).toContain(
      '- **[C2]** `docker ps -a` on Docker host "web-1" — succeeded',
    );
  });
});
