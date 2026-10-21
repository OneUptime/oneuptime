/*
 * The evaluator's import chain pulls the native isolated-vm addon
 * (MonitorCriteriaEvaluator → VMAPI → VMRunner). Nothing under test here
 * touches the sandbox, and the prebuilt binary cannot always dlopen in the
 * test environment — so stub the module out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import { JSONObject } from "../../../../Types/JSON";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import MetricCriteriaContext from "../../../../Types/Monitor/MetricMonitor/MetricCriteriaContext";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";
import { MarkdownText } from "../../../../Utils/Markdown/FeedMarkdown";
import { describe, expect, jest, test } from "@jest/globals";
import { Lexer, Token, Tokens, marked } from "marked";

/*
 * THE NAMES A PERSON GAVE A METRIC, IN A ROOT CAUSE.
 *
 * A metric query's or formula's legend ("Node Memory Utilization (%)") is
 * what a person typed on the monitor, and the root cause names the metric
 * by it: the "- Metric:" line of a platform's or a telemetry resource's
 * details, and the note on an affected row valued by another filter. Each
 * reads as typed and is no link, image, HTML, emphasis or mention - in the
 * dashboard, the emails and the Slack and Teams posts the root cause goes
 * to.
 */

const HOSTILE_LEGEND: string =
  "CPU *busy* [Reset](https://evil.example/login) ![p](https://t.example/p.png) <img src=x> <!channel>";

interface PlatformTarget {
  alias: string;
  isFormula: boolean;
  comparisonUnit: string | undefined;
  metricName: string | undefined;
  displayName: string | undefined;
  formulaExpression: string | undefined;
  components: Array<{ alias: string; metricName: string | undefined }>;
}

interface AffectedRow {
  identity: JSONObject;
  value: number | null;
  formattedValue: string;
  valueNote?: MarkdownText | undefined;
}

type EvaluatorPrivate = {
  describeCriteriaMetric: (input: {
    platform: string;
    target: PlatformTarget | null;
  }) => Array<MarkdownText>;
  describeCriteriaMetricLine: (input: {
    ctx: MetricCriteriaContext | undefined;
    metricViewConfig: MetricsViewConfig | undefined;
  }) => MarkdownText | null;
  buildSeriesAffectedRows: (input: {
    perSeriesMatches: Array<PerSeriesCriteriaMatch>;
    worstIsLowest: boolean;
    toIdentity: (attributes: JSONObject) => JSONObject;
    withContext: (series: JSONObject, context: JSONObject) => JSONObject;
    seriesContextAttributes: (fingerprint: string) => Array<JSONObject>;
    targetAlias?: string | undefined;
    namesObject: (identity: JSONObject) => boolean;
  }) => Array<AffectedRow>;
  renderAffectedRowValue: (row: AffectedRow) => MarkdownText;
};

const Evaluator: EvaluatorPrivate =
  MonitorCriteriaEvaluator as unknown as EvaluatorPrivate;

function context(
  overrides: Partial<MetricCriteriaContext>,
): MetricCriteriaContext {
  return {
    metricName: "k8s.node.memory.usage",
    alias: "a",
    unit: null,
    aggregationType: null,
    isFormula: false,
    filterAttributes: {},
    groupBy: [],
    breachingSamples: [
      {
        value: 91,
        timestamp: new Date("2026-08-14T10:30:00.000Z"),
        attributes: {},
      },
    ],
    ...overrides,
  };
}

/*
 * Nothing in the line is read as Markdown, HTML or a mention, and the
 * legend is still there, word for word.
 */
function expectLegendAsText(line: string): void {
  const tokens: Array<Token> = [];

  marked.walkTokens(
    new Lexer({ gfm: true }).lex(line),
    (token: Token): void => {
      tokens.push(token);
    },
  );

  expect(
    tokens
      .filter((token: Token): boolean => {
        if (token.type === "link") {
          // A bare address shows where it goes.
          return (token as Tokens.Link).text !== (token as Tokens.Link).href;
        }

        // The "- Metric:" line is a list item of the details block itself.
        return ![
          "paragraph",
          "text",
          "escape",
          "space",
          "strong",
          "codespan",
          "list",
          "list_item",
        ].includes(token.type);
      })
      .map((token: Token): string => {
        return `${token.type}: ${token.raw}`;
      }),
  ).toEqual([]);
  expect(SlackUtil.convertMarkdownToSlackRichText(line)).not.toMatch(
    /<[!@#][A-Za-z]/,
  );
  expect(
    line
      .replace(/\\([!-/:-@[-`{-~])/g, "$1")
      .split("⁠")
      .join(""),
  ).toContain(HOSTILE_LEGEND);
}

describe("a metric's legend in a root cause", () => {
  test("names a platform formula's metric as text", () => {
    const lines: Array<MarkdownText> = Evaluator.describeCriteriaMetric({
      platform: "kubernetes",
      target: {
        alias: "a",
        isFormula: true,
        comparisonUnit: "%",
        metricName: undefined,
        displayName: HOSTILE_LEGEND,
        formulaExpression: "(used / allocatable) * 100",
        components: [],
      },
    });

    const metricLine: string = lines[0]!.toString();

    expect(metricLine.startsWith("- Metric: ")).toBe(true);
    expectLegendAsText(metricLine);
  });

  test("an ordinary legend reads exactly as typed", () => {
    const lines: Array<MarkdownText> = Evaluator.describeCriteriaMetric({
      platform: "kubernetes",
      target: {
        alias: "a",
        isFormula: true,
        comparisonUnit: "%",
        metricName: undefined,
        displayName: "Node Memory Utilization (%)",
        formulaExpression: "(used / allocatable) * 100",
        components: [],
      },
    });

    expect(lines[0]!.toString()).toBe("- Metric: Node Memory Utilization (%)");
  });

  test("names a telemetry resource's formula by its legend, as text", () => {
    const line: MarkdownText | null = Evaluator.describeCriteriaMetricLine({
      ctx: context({ alias: "busy", isFormula: true, metricName: "busy" }),
      metricViewConfig: {
        queryConfigs: [],
        formulaConfigs: [
          {
            metricAliasData: {
              metricVariable: "busy",
              legend: HOSTILE_LEGEND,
              title: undefined,
              description: undefined,
              legendUnit: undefined,
            },
            metricFormulaData: { metricFormula: "user + system" },
          },
        ],
      } as unknown as MetricsViewConfig,
    });

    expect(line).not.toBeNull();
    expectLegendAsText(line!.toString());
  });

  test("notes a row valued by another filter with that filter's legend, as text", () => {
    const rows: Array<AffectedRow> = Evaluator.buildSeriesAffectedRows({
      perSeriesMatches: [
        {
          criteriaMetId: "criteria-1",
          fingerprint: "series-1",
          labels: { "resource.k8s.node.name": "node-a" },
          rootCause: "",
          metricContexts: [
            context({ alias: "other", displayName: HOSTILE_LEGEND }),
          ],
        },
      ],
      worstIsLowest: false,
      toIdentity: (attributes: JSONObject): JSONObject => {
        return attributes;
      },
      withContext: (series: JSONObject): JSONObject => {
        return series;
      },
      seriesContextAttributes: (): Array<JSONObject> => {
        return [];
      },
      targetAlias: "cpu",
      namesObject: (): boolean => {
        return true;
      },
    });

    expect(rows).toHaveLength(1);

    const valueCell: string = Evaluator.renderAffectedRowValue(
      rows[0]!,
    ).toString();

    expect(valueCell.startsWith("**91**")).toBe(true);
    expectLegendAsText(valueCell);
  });
});
