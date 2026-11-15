import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import InfrastructureInvestigationToolkit from "../../../../Server/Utils/AI/ResourceAccess/InfrastructureInvestigationToolkit";
import { describeResourceWords } from "../../../../Server/Utils/AI/ResourceAccess/ResourceAccessContext";
import { ISSUE_STATUS_WORDS } from "../../../../Server/Utils/AI/Toolbox/DataSecurityTools";
import {
  citationSentence,
  countFigure,
  termCells,
  ToolCitation,
} from "../../../../Server/Utils/AI/Toolbox/ReadTableWords";
import WidgetBuilder from "../../../../Server/Utils/AI/Toolbox/WidgetBuilder";
import { getDrawnTableCell } from "../../../../../App/FeatureSet/Dashboard/src/Components/AIChat/TableWords";
import {
  AIActionTableCell,
  AIActionTableWords,
  aiActionSentence,
  describeAIActionSentence,
  describeAIActionTableCell,
  isKnownAIActionSentence,
  isKnownAIActionTableWords,
} from "../../../../Types/AI/AIActionWords";
import {
  AI_READ_OPEN_STATUS_TERM,
  AI_READ_RECORD_TABLE_TITLES,
  AI_TOOLKIT_CITATIONS,
} from "../../../../Types/AI/AIReadTableWords";
import { AIChatWidget } from "../../../../Types/AI/AIChatTypes";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import { MEANING_KEYS } from "../../../../Types/MeaningKeys";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { JSONObject } from "../../../../Types/JSON";
import { Translator } from "../../../../Types/Translator";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";

/*
 * THE CHIPS OF THE TOOLS ASK AI GETS FROM OUTSIDE THE TOOLBOX, AND AN OPEN
 * ISSUE'S STATUS, IN THE READER'S LANGUAGE (issues #8511, #8512).
 *
 * A connected cluster's kubectl, a resource's AI agent, the external MCP
 * servers and an investigation's remediation named what they read in
 * English under Sources ("Clusters OneUptime AI can inspect", "`kubectl get
 * pods` on cluster "prod""); and the Data Security issues table said
 * "Open" in English beside "Akzeptiert", since "Open" alone is every Open
 * button's verb in every locale. The chips are words now, their English
 * what the tools always wrote; the open status is its meaning key, "Open"
 * in English and the stored row, the status's own word in the reader's.
 */

const LANGUAGES: Array<string> = ["de", "fa", "ar"];

function readyResource(
  resourceType: AiResourceType,
  resourceName: string,
): ResourceAiAccessStatus {
  return {
    resourceType,
    resourceId: "0193c0de-eeee-4aaa-8bbb-000000000001",
    resourceName,
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Automatic,
    aiCommandAllowlist: [],
    agent: {
      agentId: "0193c0de-eeee-4aaa-8bbb-000000000002",
      connectionStatus: "connected",
      isOnline: true,
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
  } as unknown as ResourceAiAccessStatus;
}

describe("the toolkits' chips say what they always said (#8511)", () => {
  test.each<[ToolCitation, string]>([
    [
      citationSentence(AI_TOOLKIT_CITATIONS.clustersAvailable),
      "Clusters OneUptime AI can inspect",
    ],
    [
      citationSentence(AI_TOOLKIT_CITATIONS.commandOnCluster, {
        command: "kubectl get pods",
        cluster: "prod",
      }),
      'kubectl get pods on cluster "prod"',
    ],
    [
      citationSentence(AI_TOOLKIT_CITATIONS.infrastructureAvailable),
      "Infrastructure OneUptime AI can inspect",
    ],
    [
      citationSentence(AI_TOOLKIT_CITATIONS.mcpServerTools, {
        server: "Linear",
      }),
      "Tools of MCP server Linear",
    ],
    [
      citationSentence(AI_TOOLKIT_CITATIONS.mcpServersTools),
      "Tools of the external MCP servers",
    ],
    [
      citationSentence(AI_TOOLKIT_CITATIONS.mcpToolResult, {
        server: "Linear",
        tool: "list_issues",
      }),
      "Linear · list_issues",
    ],
    [
      citationSentence(AI_TOOLKIT_CITATIONS.mcpToolNotRun, {
        server: "Linear",
        tool: "create_issue",
      }),
      "Linear · create_issue (not run)",
    ],
    [citationSentence(AI_TOOLKIT_CITATIONS.noFixReason), "Why there is no fix"],
    [
      citationSentence(AI_TOOLKIT_CITATIONS.proposedRollback, {
        deployment: "prod/api",
      }),
      "Proposed rolling back prod/api",
    ],
    [
      citationSentence(AI_TOOLKIT_CITATIONS.commandTargets),
      "Available command targets",
    ],
    [
      citationSentence(AI_TOOLKIT_CITATIONS.sentToCluster, {
        cluster: "prod",
        command: "kubectl rollout restart",
      }),
      'Sent to cluster "prod", result unknown: kubectl rollout restart',
    ],
    [
      citationSentence(AI_TOOLKIT_CITATIONS.executedOnCluster, {
        cluster: "prod",
        command: "kubectl get pods",
      }),
      'Executed on cluster "prod": kubectl get pods',
    ],
    [
      citationSentence(AI_TOOLKIT_CITATIONS.executedOnResource, {
        resource: describeResourceWords({ noun: "Docker host", name: "web-1" }),
        command: "docker ps",
      }),
      'Executed on Docker host "web-1": docker ps',
    ],
    [
      citationSentence(AI_TOOLKIT_CITATIONS.sentToResource, {
        resource: describeResourceWords({ noun: "host", name: "db" }),
        command: "uptime",
      }),
      'Sent to host "db", result unknown: uptime',
    ],
    [
      citationSentence(AI_TOOLKIT_CITATIONS.executedOnRunner, {
        runner: "runner-1",
        command: "bash fix.sh",
      }),
      'Executed on Runner "runner-1": bash fix.sh',
    ],
    [
      citationSentence(AI_TOOLKIT_CITATIONS.proposedPlan, {
        count: countFigure(3),
      }),
      "Proposed a 3-command remediation plan",
    ],
  ])("%j", (citation: ToolCitation, english: string) => {
    expect(citation.citationLabel).toBe(english);
    expect(isKnownAIActionSentence(citation.citationWords)).toBe(true);
  });

  test.each<[AiResourceType, string, string]>([
    [AiResourceType.Host, "uptime", "db"],
    [AiResourceType.DockerHost, "docker ps -a", "web-1"],
    [AiResourceType.DatabaseServer, "db status", "orders"],
    [AiResourceType.ProxmoxCluster, "pvesh get /nodes", "lab"],
  ])(
    "an infrastructure command's chip on a %s: its words say getCitationLabel's English",
    (type: AiResourceType, command: string, name: string) => {
      const resource: ResourceAiAccessStatus = readyResource(type, name);
      const citation: ToolCitation =
        InfrastructureInvestigationToolkit.getCitation({
          displayCommand: command,
          resource,
        });

      expect(citation.citationLabel).toBe(
        InfrastructureInvestigationToolkit.getCitationLabel({
          displayCommand: command,
          resource,
        }),
      );
      expect(isKnownAIActionSentence(citation.citationWords)).toBe(true);
    },
  );

  test("a resource's kind is a word when it is one of a resource's nouns, else data", () => {
    expect(describeResourceWords({ noun: "host", name: "db" })).toEqual({
      list: [expect.objectContaining({ template: "{{kind}} {{name}}" })],
    });
    expect(describeResourceWords({ noun: "AWS account", name: "prod" })).toBe(
      'AWS account "prod"',
    );
  });

  test.each(LANGUAGES)(
    "%s: the chips are the language's; commands and names as named",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const chips: Array<[ToolCitation, string]> = [
        [citationSentence(AI_TOOLKIT_CITATIONS.clustersAvailable), ""],
        [
          citationSentence(AI_TOOLKIT_CITATIONS.commandOnCluster, {
            command: "kubectl get pods",
            cluster: "prod",
          }),
          "kubectl get pods",
        ],
        [
          citationSentence(AI_TOOLKIT_CITATIONS.executedOnResource, {
            resource: describeResourceWords({ noun: "host", name: "db" }),
            command: "uptime",
          }),
          "uptime",
        ],
        [
          citationSentence(AI_TOOLKIT_CITATIONS.mcpServerTools, {
            server: "Linear",
          }),
          "Linear",
        ],
      ];

      for (const [citation, data] of chips) {
        const worded: string = withoutIsolateMarks(
          describeAIActionSentence(citation.citationWords, translator),
        );

        expect({
          language,
          worded,
          same: worded === citation.citationLabel,
        }).toEqual({ language, worded, same: false });
        expect(worded).toContain(data);
      }
    },
  );

  test("no toolkit writes a chip's label in place", () => {
    const AI_DIR: string = path.resolve(
      __dirname,
      "../../../../Server/Utils/AI",
    );

    for (const file of [
      "ClusterAccess/KubectlInvestigationToolkit.ts",
      "ResourceAccess/InfrastructureInvestigationToolkit.ts",
      "Mcp/McpRunToolkit.ts",
      "Remediation/RemediationCommandTools.ts",
      "Remediation/RemediationRoundRun.ts",
    ]) {
      const source: string = fs.readFileSync(path.join(AI_DIR, file), "utf8");
      const written: Array<string> = Array.from(
        source.matchAll(/(?<!citation\.)\bcitationLabel\b[^\n]*/g),
      ).map((match: RegExpMatchArray): string => {
        return match[0];
      });

      expect({ file, written }).toEqual({ file, written: [] });
      expect(source).toMatch(/citationSentence\(|\.getCitation\(/);
    }
  });
});

describe("an open data security issue's status (#8512)", () => {
  const rows: Array<JSONObject> = [
    { title: "Public bucket", status: DataSecurityIssueStatus.Open },
    { title: "Old key", status: DataSecurityIssueStatus.Accepted },
    { title: "Leak", status: DataSecurityIssueStatus.Resolved },
  ];

  const table: () => AIChatWidget = (): AIChatWidget => {
    return WidgetBuilder.table({
      words: {
        title: aiActionSentence(
          AI_READ_RECORD_TABLE_TITLES.dataSecurityIssues,
          {
            count: countFigure(3),
          },
        ),
        cells: termCells(rows, { status: ISSUE_STATUS_WORDS }),
      },
      columns: [{ key: "status", title: "Status", type: "text" }],
      rows,
    });
  };

  test("is its meaning key, whose English - stored, exported, read by the model - is Open", () => {
    expect(MEANING_KEYS).toContain(AI_READ_OPEN_STATUS_TERM);

    const cells: Array<Record<string, AIActionTableCell>> = termCells(rows, {
      status: ISSUE_STATUS_WORDS,
    });

    expect(cells[0]).toEqual({ status: { term: "Open (status)" } });
    expect(describeAIActionTableCell(cells[0]!["status"]!)).toBe("Open");
    expect(
      table().data.rows!.map((row: JSONObject) => {
        return row["status"];
      }),
    ).toEqual(["Open", "Accepted", "Resolved"]);
    expect(isKnownAIActionTableWords(table().data.tableWords)).toBe(true);
  });

  test.each(LANGUAGES)(
    "%s: the status's own word, never the Open buttons' verb",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const widget: AIChatWidget = table();
      const tableWords: AIActionTableWords = widget.data.tableWords!;
      const drawn: Array<string | undefined> = widget.data.rows!.map(
        (row: JSONObject, rowIndex: number): string | undefined => {
          return getDrawnTableCell({
            words: tableWords,
            rowIndex,
            columnKey: "status",
            stored: row["status"],
            translator: dashboardTranslator(language),
          })?.text;
        },
      );

      expect(drawn[0]).toBe(words["Open (status)"]);
      expect(drawn[0]).not.toBe(words["Open"]);
      expect(drawn[0]).not.toBe("Open");
      expect(drawn[1]).toBe(words["Accepted"]);
      expect(drawn[2]).toBe(words["Resolved"]);
    },
  );

  test("English: Open", () => {
    const widget: AIChatWidget = table();

    expect(
      getDrawnTableCell({
        words: widget.data.tableWords!,
        rowIndex: 0,
        columnKey: "status",
        stored: "Open",
        translator: dashboardTranslator("en"),
      })?.text,
    ).toBe("Open");
  });
});
