/*
 * The Alerting tests read a counter the way the queue page does
 * (MessageQueueTelemetryQueries). That module imports the aggregate API
 * client, which reads the browser's configuration when loaded; nothing here
 * queries anything, so it is replaced with an empty stand-in.
 */
jest.mock("Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return { __esModule: true, default: {} };
});

import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  getMessageQueueMetricReadPlan,
  MessageQueueMetricReadPlan,
} from "../../../FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";
import { counterResultToRatePerSecond } from "../../../FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries";
import {
  getMessagingBrokerMetricsReceivers,
  getMessagingSystemDescriptor,
  getMessagingSystemDisplayName,
  getMoreSpecificMessagingSystem,
  isExcludedMessagingSystem,
  MESSAGING_SYSTEMS,
  MessagingBrokerMetricsSource,
  MessagingSystemDescriptor,
  normalizeMessagingSystem,
} from "Common/Types/MessageQueue/MessagingSystem";
import {
  AZURE_SERVICE_BUS_HOST_SUFFIXES,
  canonicalizeMessageQueueBrokerScope,
  MessageQueueIdentity,
  toMessageQueueIdentity,
} from "Common/Types/MessageQueue/MessageQueueIdentity";
import {
  MESSAGE_QUEUE_DESTINATION_MAX_LENGTH,
  MESSAGING_BROKER_SCOPE_ADDRESS_ATTRIBUTES,
  MESSAGING_DESTINATION_ATTRIBUTES,
  MESSAGING_DIRECTION_ATTRIBUTES,
  MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
  MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
  MESSAGING_TEMPORARY_FLAG_ATTRIBUTES,
  MESSAGING_TRIGGER_ATTRIBUTES,
  RABBITMQ_ROUTING_KEY_ATTRIBUTES,
  ResolvedMessagingDestination,
  resolveMessagingMetricDatapoint,
  resolveMessagingSpan,
  SNS_TOPIC_ARN_ATTRIBUTES,
  SQS_QUEUE_URL_ATTRIBUTES,
} from "Common/Types/MessageQueue/MessagingTelemetryResolver";
import {
  getMessageQueueMetricsForSystem,
  MESSAGE_QUEUE_BROKER_METRIC_NAMES,
  MESSAGE_QUEUE_METRICS,
  MessageQueueMetricDescriptor,
  MessageQueueSignal,
  MESSAGING_CLIENT_METRIC_NAMES,
} from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import {
  buildMessageQueueMetricMonitorQuery,
  buildMessageQueueMetricMonitorViewConfig,
  getMessageQueueAlertTemplateForMetric,
  isMessageQueueMetricMonitorable,
  MESSAGE_QUEUE_SOURCE_WINDOW_FLOORS,
  MESSAGE_QUEUE_THRESHOLDABLE_SIGNALS,
  MessageQueueMetricMonitorQuery,
  MessageQueueMetricMonitorViewConfig,
  MessageQueueSeriesTotal,
  MessageQueueSourceWindowFloor,
  UNTEMPLATED_MESSAGE_QUEUE_GAUGES,
} from "Common/Types/Monitor/MessageQueueAlertTemplates";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import { keyForMessageQueue } from "Common/Utils/Telemetry/EntityKey";
import {
  buildMessagingMetricDiscoverySql,
  DEFAULT_MESSAGE_QUEUE_MIN_SPANS,
  DiscoveredMessageQueue,
  getMessagingDiscoveryColumn,
  isMessageQueueAutoCreateCandidate,
  MESSAGE_QUEUE_DISCOVERY_METRIC_NAMES,
  MESSAGE_QUEUE_LATE_METRIC_MINUTES,
  MESSAGE_QUEUE_LATE_METRIC_NAMES,
  MESSAGE_QUEUE_MIN_SPANS_ENV,
  MessagingMetricDiscoveryRow,
  resolveMessagingMetricDiscoveryRows,
} from "Common/Server/Utils/Telemetry/MessageQueueDiscovery";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { normalizeObiReceivingSideMessagingSpanKind } from "../../../FeatureSet/Telemetry/Utils/ObiReceivingSideMessagingSpan";
import { SpanKind } from "Common/Models/AnalyticsModels/Span";
import { EPHEMERAL_PORT_RANGE_START } from "Common/Types/DatabaseServer/DatabaseEndpoint";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Queues docs page against the product it describes.
 *
 * Markdown is not compiled, so nothing else notices when the messaging
 * catalog (Common/Types/MessageQueue) learns a system the supported-systems
 * table does not list, a display name changes and the in-app guidance card
 * links to an anchor that no longer exists, a curated broker metric is
 * added that no system section mentions, or a collector config on the page
 * stops naming the receiver the catalog says that system's metrics come
 * from. Each test reads the source of truth — the catalog, the resolver the
 * ingest stamper and the discovery cron both run, the nav — and checks the
 * page still tells the same story. Where the page gives an example of how
 * telemetry resolves (a queue URL reduced to its name, a placeholder that is
 * ignored), the example is fed through the real resolver.
 *
 * The collector configs are parsed with a real YAML parser and checked as
 * configuration. `otelcol validate` of the pinned
 * otel/opentelemetry-collector-contrib:0.161.0 image passes every one of
 * them; a docs test cannot run a container, so the structure it can check
 * without one is pinned here.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const PACKAGES_DIR: string = path.join(REPO_ROOT, "packages");
const CONTENT_DIR: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Docs/Content",
);

const PAGE: string = "telemetry/queues";
const PAGE_URL: string = `/docs/${PAGE}`;
const PAGE_TITLE: string = "Queues";

const BROKER_METRICS_HEADING: string = "## Broker health metrics";
const SUPPORTED_SYSTEMS_HEADING: string = "## Supported messaging systems";

/* What every collector config on the page exports to, and how. */
const EXPORTER_ID: string = "otlphttp";
const ONEUPTIME_OTLP_ENDPOINT: string = "https://oneuptime.com/otlp";
const TOKEN_HEADER: string = "x-oneuptime-token";

/*
 * The component types the page's configs may use, each checked against
 * `otelcol-contrib components` of otel/opentelemetry-collector-contrib:
 * 0.161.0 — the image the OneUptime agents pin (otlphttp is core's
 * deprecated but working alias of otlp_http, which the rest of the docs
 * use). A new type needs the same check before it goes on the page.
 * cumulative_to_delta is the name 0.161.0 lists: it logs its old name,
 * cumulativetodelta, as a deprecated alias.
 */
const PINNED_COMPONENT_TYPES: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    receivers: [
      "aws_cloudwatch",
      "awsfirehose",
      "azure_monitor",
      "googlecloudmonitoring",
      "kafka_metrics",
      "otlp",
      "prometheus",
      "rabbitmq",
    ],
    processors: ["batch", "cumulative_to_delta", "transform"],
    exporters: ["otlphttp"],
    extensions: ["awscloudwatchmetricstreams_encoding", "azure_auth"],
  };

const CONFIG_SECTIONS: ReadonlyArray<string> = [
  "extensions",
  "receivers",
  "processors",
  "exporters",
  "service",
];

/*
 * The CloudWatch namespace each AWS system's `aws_cloudwatch` receiver
 * must discover: the receiver takes one namespace per instance.
 */
const CLOUDWATCH_NAMESPACES: Readonly<Record<string, string>> = {
  aws_sqs: "AWS/SQS",
  "aws.sns": "AWS/SNS",
};

const FENCE_LINE: RegExp = /^\s*```/;
const OPENING_FENCE: RegExp = /^\s*```\s*([A-Za-z]*)/;
const TABLE_ROW: RegExp = /^\|.*\|\s*$/;
const TABLE_SEPARATOR_CELL: RegExp = /^:?-+:?$/;
const NUMBER_LITERAL: RegExp = /^\d+$/;
const AZURE_METRIC_NAME: RegExp =
  /^azure_(.+)_(average|total|maximum|minimum|count)$/;
/*
 * A MessageQueue column that would keep one of the parts that never split a
 * queue — a dead-letter flag, a consumer group or subscription, a
 * partition — which the page promises no queue keeps.
 */
const UNSPLITTING_PART_COLUMN: RegExp =
  /deadletter|consumergroup|subscription|partition/i;

/*
 * js-yaml from Common/node_modules, as OpenTelemetryCollectorExampleDocs
 * .test.ts loads it and for the same reason: Common declares js-yaml 4, App
 * declares no YAML parser. js-yaml 4's `load` uses the safe schema and
 * rejects duplicated keys, as the collector's own reader does.
 */
interface JsYamlModule {
  load: (text: string) => unknown;
}

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const jsYaml: JsYamlModule = require(
  path.join(PACKAGES_DIR, "Common", "node_modules", "js-yaml"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

type YamlMap = { [key: string]: unknown };

interface FencedBlock {
  // Lower-cased language tag: "yaml", "bash", or "" when there is none.
  info: string;
  body: string;
}

interface SpanFixture {
  attributes: Readonly<Record<string, unknown>>;
  kind: string;
}

interface DatapointFixture {
  metricName: string;
  attributes: Readonly<Record<string, unknown>>;
}

function isMapping(value: unknown): value is YamlMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pageFile(relative: string): string {
  return path.join(CONTENT_DIR, "en", `${relative}.md`);
}

function readPage(relative: string = PAGE): string {
  return fs.readFileSync(pageFile(relative), "utf8");
}

/* The page's lines outside fenced code blocks. */
function proseLines(markdown: string): Array<string> {
  const lines: Array<string> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (!inFence) {
      lines.push(line);
    }
  }

  return lines;
}

/* The body of one heading's section, up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim() === heading;
  });

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const level: number = (heading.match(/^#+/) as RegExpMatchArray)[0].length;
  const body: Array<string> = [];
  let inFence: boolean = false;

  for (const line of lines.slice(start + 1)) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
    }

    const match: RegExpMatchArray | null = inFence
      ? null
      : line.match(/^(#{1,6})\s/);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

/* Fenced code blocks, in page order, with their language tag. */
function fencedBlocks(markdown: string): Array<FencedBlock> {
  const blocks: Array<FencedBlock> = [];
  let current: Array<string> | null = null;
  let info: string = "";

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      if (current) {
        blocks.push({ info, body: current.join("\n") });
        current = null;
      } else {
        current = [];
        info = ((line.match(OPENING_FENCE) as RegExpMatchArray)[1] || "")
          .trim()
          .toLowerCase();
      }
      continue;
    }

    if (current) {
      current.push(line);
    }
  }

  return blocks;
}

function yamlBlocks(markdown: string): Array<string> {
  return fencedBlocks(markdown)
    .filter((block: FencedBlock): boolean => {
      return block.info === "yaml";
    })
    .map((block: FencedBlock): string => {
      return block.body;
    });
}

function parseYaml(body: string): YamlMap {
  const parsed: unknown = jsYaml.load(body);

  expect(isMapping(parsed)).toBe(true);

  return parsed as YamlMap;
}

/* Heading text of a page, outside code blocks, with its level. */
function headings(markdown: string): Array<{ level: number; text: string }> {
  const found: Array<{ level: number; text: string }> = [];

  for (const line of proseLines(markdown)) {
    const heading: RegExpMatchArray | null = line.match(/^(#{1,6})\s+(.*)$/);

    if (heading && heading[1] && heading[2]) {
      found.push({ level: heading[1].length, text: heading[2].trim() });
    }
  }

  return found;
}

/* Heading ids of a page, computed the way the renderer computes them. */
function headingSlugs(markdown: string): Set<string> {
  return new Set<string>(
    headings(markdown).map(
      (heading: { level: number; text: string }): string => {
        return slugify(heading.text);
      },
    ),
  );
}

/* Backticked tokens outside code blocks. */
function backtickedTokens(markdown: string): Array<string> {
  return proseLines(markdown).flatMap((line: string): Array<string> => {
    return Array.from(line.matchAll(/`([^`\n]+)`/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    );
  });
}

/* The cells of every table row in some markdown, header rows included, separators not. */
function tableRows(markdown: string): Array<Array<string>> {
  const rows: Array<Array<string>> = [];

  for (const line of proseLines(markdown)) {
    if (!TABLE_ROW.test(line)) {
      continue;
    }

    const cells: Array<string> = line
      .trim()
      .split("|")
      .slice(1, -1)
      .map((cell: string): string => {
        return cell.trim();
      });

    if (
      cells.every((cell: string): boolean => {
        return TABLE_SEPARATOR_CELL.test(cell);
      })
    ) {
      continue;
    }

    rows.push(cells);
  }

  return rows;
}

/* The first backticked value of a table cell. */
function firstToken(cell: string): string {
  const match: RegExpMatchArray | null = cell.match(/`([^`]+)`/);

  expect({ cell, token: Boolean(match) }).toEqual({ cell, token: true });

  return (match as RegExpMatchArray)[1] as string;
}

/* The paragraph (blank-line separated block) of some markdown that contains a phrase. */
function paragraphWith(markdown: string, phrase: string): string {
  const paragraph: string | undefined = markdown
    .split(/\n\s*\n/)
    .find((block: string): boolean => {
      return block.includes(phrase);
    });

  expect({ phrase, found: Boolean(paragraph) }).toEqual({
    phrase,
    found: true,
  });

  return paragraph as string;
}

/* The one line of some markdown (a list item, say) that contains a phrase. */
function lineWith(markdown: string, phrase: string): string {
  const line: string | undefined = markdown
    .split("\n")
    .find((text: string): boolean => {
      return text.includes(phrase);
    });

  expect({ phrase, found: Boolean(line) }).toEqual({ phrase, found: true });

  return line as string;
}

function expectInOrder(text: string, tokens: ReadonlyArray<string>): void {
  const positions: Array<number> = tokens.map((token: string): number => {
    const position: number = text.indexOf(`\`${token}\``);

    expect({ token, named: position >= 0 }).toEqual({ token, named: true });

    return position;
  });

  expect(positions).toEqual(
    [...positions].sort((a: number, b: number): number => {
      return a - b;
    }),
  );
}

function descriptorsBySystem(): Array<MessagingSystemDescriptor> {
  return [...MESSAGING_SYSTEMS].sort(
    (a: MessagingSystemDescriptor, b: MessagingSystemDescriptor): number => {
      return a.displayName.localeCompare(b.displayName);
    },
  );
}

/* One system's section under "Broker health metrics", headed by its display name. */
function systemSection(descriptor: MessagingSystemDescriptor): string {
  return section(
    section(readPage(), BROKER_METRICS_HEADING),
    `### ${descriptor.displayName}`,
  );
}

function resolveSpan(
  fixture: SpanFixture,
): ResolvedMessagingDestination | null {
  return resolveMessagingSpan({
    getAttribute: (key: string): unknown => {
      return fixture.attributes[key];
    },
    kind: fixture.kind,
  });
}

function resolveDatapoint(
  fixture: DatapointFixture,
): ResolvedMessagingDestination | null {
  return resolveMessagingMetricDatapoint({
    metricName: fixture.metricName,
    getAttribute: (key: string): unknown => {
      return fixture.attributes[key];
    },
  });
}

/* The identity a resolved destination is keyed on, as ingest builds it. */
function identityOf(
  resolved: ResolvedMessagingDestination | null,
): MessageQueueIdentity | null {
  if (!resolved) {
    return null;
  }

  return toMessageQueueIdentity({
    system: resolved.system,
    brokerScope: resolved.brokerScope,
    destination: resolved.destination,
  });
}

/*
 * The queue the discovery run reads from one metric datapoint: a row as the
 * metric query returns it (every attribute the resolver reads in its
 * column, '' when absent), resolved the way the run resolves it.
 */
function discoveredFromMetric(
  metricName: string,
  attributes: Readonly<Record<string, string>>,
): DiscoveredMessageQueue {
  for (const key of Object.keys(attributes)) {
    expect(MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES).toContain(key);
  }

  const row: MessagingMetricDiscoveryRow = {
    name: metricName,
    pointCount: "1",
    lastSeenUnixMs: "1790000000000",
  };

  MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES.forEach(
    (key: string, index: number): void => {
      row[getMessagingDiscoveryColumn(index)] = attributes[key] ?? "";
    },
  );

  const discovered: Array<DiscoveredMessageQueue> =
    resolveMessagingMetricDiscoveryRows([row]);

  expect(discovered).toHaveLength(1);

  return discovered[0] as DiscoveredMessageQueue;
}

function spanOf(
  system: string,
  destination: string,
  kind: string = "SPAN_KIND_PRODUCER",
  extra: Readonly<Record<string, unknown>> = {},
): SpanFixture {
  return {
    attributes: {
      "messaging.system": system,
      "messaging.destination.name": destination,
      ...extra,
    },
    kind,
  };
}

/* The collector receiver types (the part of a component id before "/") a config defines. */
function componentIds(config: YamlMap, kind: string): Array<string> {
  const components: unknown = config[kind];

  return isMapping(components) ? Object.keys(components) : [];
}

function componentType(id: string): string {
  return id.split("/")[0] as string;
}

function receiverConfigs(
  config: YamlMap,
  type: string,
): Array<{ id: string; config: YamlMap }> {
  const receivers: YamlMap = (config["receivers"] as YamlMap) || {};

  return Object.keys(receivers)
    .filter((id: string): boolean => {
      return componentType(id) === type;
    })
    .map((id: string): { id: string; config: YamlMap } => {
      const value: unknown = receivers[id];

      return { id, config: isMapping(value) ? value : {} };
    });
}

/* Every key, at any depth, of a YAML value. */
function keysAtAnyDepth(value: unknown): Array<string> {
  if (Array.isArray(value)) {
    return value.flatMap(keysAtAnyDepth);
  }

  if (!isMapping(value)) {
    return [];
  }

  return Object.entries(value).flatMap(
    ([key, child]: [string, unknown]): Array<string> => {
      return [key, ...keysAtAnyDepth(child)];
    },
  );
}

/*
 * The collector receivers a system's configs may name: the catalog's own
 * (getMessagingBrokerMetricsReceivers — the receiver, `prometheus`, the
 * cloud receivers) for a system the collector scrapes, and `otlp` for one
 * whose metrics are pushed to it (the JMX Scraper) or reported by the
 * applications themselves.
 */
function allowedReceivers(source: MessagingBrokerMetricsSource): Array<string> {
  if (source.kind === "external-scraper" || source.kind === "none") {
    return ["otlp"];
  }

  return [...getMessagingBrokerMetricsReceivers(source)];
}

/* The "Broker metrics" cell of the supported-systems table, from the catalog. */
function expectedBrokerMetricsCell(
  source: MessagingBrokerMetricsSource,
): string {
  switch (source.kind) {
    case "receiver":
      return `\`${source.receiver}\` receiver`;
    case "prometheus":
      return `Prometheus (${source.exporter}), \`:${source.port}${source.path}\``;
    case "cloud-monitoring":
      return `${[source.receiver, ...source.alternativeReceivers]
        .map((receiver: string): string => {
          return `\`${receiver}\``;
        })
        .join(" or ")} receiver (cloud monitoring)`;
    case "external-scraper":
      return `${source.scraper} (pushes OTLP)`;
    default:
      return "None built in";
  }
}

/* The catalog's note (or, with no source, reason) for a system, word for word. */
function catalogNote(source: MessagingBrokerMetricsSource): string {
  return source.kind === "none" ? source.reason : source.note;
}

/*
 * A curated metric's rows as the page lists them: one row per metric, but
 * the two shapes of one CloudWatch metric — `amazonaws.com/aws/sqs/<name>`
 * and a JSON Metric Stream's bare `<name>` — share a row. Grouped by the
 * name after its last "/", in catalog order.
 */
function expectedMetricRows(
  system: string,
): Array<{ names: Array<string>; title: string; type: string }> {
  const rows: Array<{ names: Array<string>; title: string; type: string }> = [];
  const bySegment: Map<
    string,
    { names: Array<string>; title: string; type: string }
  > = new Map<string, { names: Array<string>; title: string; type: string }>();

  for (const descriptor of getMessageQueueMetricsForSystem(system)) {
    const segment: string = descriptor.metricName.substring(
      descriptor.metricName.lastIndexOf("/") + 1,
    );
    const existing:
      | { names: Array<string>; title: string; type: string }
      | undefined = bySegment.get(segment);

    if (existing) {
      existing.names.push(descriptor.metricName);
      continue;
    }

    const row: { names: Array<string>; title: string; type: string } = {
      names: [descriptor.metricName],
      title: descriptor.title,
      type: expectedTypeCell(descriptor),
    };
    bySegment.set(segment, row);
    rows.push(row);
  }

  return rows;
}

/* How the queue page draws a curated metric (MessageQueueMetricCatalog's `kind` doc). */
function expectedTypeCell(descriptor: MessageQueueMetricDescriptor): string {
  if (descriptor.kind === "counter") {
    return "Counter, charted per second";
  }

  return descriptor.aggregation === "Sum" ? "Count per period" : "Gauge";
}

function metricTableRows(markdown: string): Array<Array<string>> {
  return tableRows(markdown).filter((cells: Array<string>): boolean => {
    return cells[0] !== "Metric";
  });
}

function navGroup(title: string): NavGroup {
  const group: NavGroup | undefined = DocsNav.find(
    (item: NavGroup): boolean => {
      return item.title === title;
    },
  );

  expect(group).toBeDefined();

  return group as NavGroup;
}

describe("Queues docs", (): void => {
  describe("page", (): void => {
    it("ships in English and opens with the nav's title", (): void => {
      expect(fs.existsSync(pageFile(PAGE))).toBe(true);
      expect(readPage().split("\n")[0]).toBe(`# ${PAGE_TITLE}`);
    });

    it("keeps every code fence closed", (): void => {
      const fences: number = readPage()
        .split("\n")
        .filter((line: string): boolean => {
          return FENCE_LINE.test(line);
        }).length;

      expect(fences % 2).toBe(0);
    });

    it("only links to /docs/ pages that exist, and to headings those pages have", (): void => {
      const links: Array<RegExpMatchArray> = Array.from(
        proseLines(readPage())
          .join("\n")
          .matchAll(/\]\((\/docs\/[^)#]+)(?:#([^)]*))?\)/g),
      );

      expect(links.length).toBeGreaterThan(0);

      for (const link of links) {
        const target: string = (link[1] as string).replace("/docs/", "");
        const anchor: string | undefined = link[2];

        expect({ target, exists: fs.existsSync(pageFile(target)) }).toEqual({
          target,
          exists: true,
        });

        if (anchor) {
          expect({
            target,
            anchor,
            resolves: headingSlugs(readPage(target)).has(anchor),
          }).toEqual({ target, anchor, resolves: true });
        }
      }
    });

    it("only uses in-page anchors that a heading on the page produces", (): void => {
      const markdown: string = readPage();
      const slugs: Set<string> = headingSlugs(markdown);
      const anchors: Array<string> = Array.from(
        proseLines(markdown)
          .join("\n")
          .matchAll(/\]\(#([^)]*)\)/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect(anchors.length).toBeGreaterThan(0);

      for (const anchor of anchors) {
        expect({ anchor, resolves: slugs.has(anchor) }).toEqual({
          anchor,
          resolves: true,
        });
      }
    });

    /*
     * The renderer gives a heading the id of its slug and does not number
     * repeats, so a second heading with the same slug is unreachable — and
     * the in-app guidance links straight to each system's anchor.
     */
    it("gives every heading its own anchor", (): void => {
      const slugs: Array<string> = headings(readPage()).map(
        (heading: { level: number; text: string }): string => {
          return slugify(heading.text);
        },
      );

      expect(slugs.length).toBeGreaterThan(20);
      expect(
        slugs.filter((slug: string, index: number): boolean => {
          return slugs.indexOf(slug) !== index;
        }),
      ).toEqual([]);
    });

    /*
     * Docs/Utils/Placeholders.ts replaces an allow-listed set of
     * {{UPPER_SNAKE}} tokens at render time; this page uses none, so any
     * such token outside code would reach the reader as literal braces.
     */
    it("leaves no placeholder-shaped token outside code", (): void => {
      const withoutCode: string = readPage()
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`[^`\n]*`/g, "");

      expect(withoutCode.match(/\{\{[A-Z][A-Z0-9_]*\}\}/g)).toBeNull();
    });

    it("covers what the product needs explained", (): void => {
      const markdown: string = readPage();

      for (const heading of [
        "## Overview",
        SUPPORTED_SYSTEMS_HEADING,
        "## How queues are discovered",
        "### From application traces",
        "### From broker metrics",
        "### From messaging client metrics",
        "### What makes two sightings one queue",
        "### How destination names are read",
        "### What is ignored",
        "### The auto-create budget",
        "### Lifecycle and archiving",
        "## Instrumenting applications",
        BROKER_METRICS_HEADING,
        "## Alerting",
        "## Limitations",
        "## Self-hosted tuning",
        "## Troubleshooting",
      ]) {
        expect({
          heading,
          present: markdown.includes(`\n${heading}\n`),
        }).toEqual({ heading, present: true });
      }

      const lifecycle: string = section(
        markdown,
        "### Lifecycle and archiving",
      );

      expect(lifecycle).toContain("**Archive to dismiss.**");
      expect(lifecycle).toContain("**Automatic archiving.**");
      expect(section(markdown, "## Overview")).toContain(
        "**Queues → Create Queue**",
      );
    });

    /*
     * Traces cannot say how full a queue is. That comes from the broker or
     * its cloud's monitoring API — except for a system the catalog says has
     * no broker to ask, whose depth the application reports itself (BullMQ:
     * its jobs live in Redis). The overview must not deny that path.
     */
    it("says where a queue's fullness comes from, the application's own gauge included", (): void => {
      const paragraph: string = paragraphWith(
        section(readPage(), "## Overview"),
        "but not how full it is",
      );
      const applicationReported: Array<MessagingSystemDescriptor> =
        MESSAGING_SYSTEMS.filter(
          (descriptor: MessagingSystemDescriptor): boolean => {
            return (
              descriptor.brokerMetrics.kind === "none" &&
              catalogNote(descriptor.brokerMetrics).includes(
                "from the application",
              )
            );
          },
        );

      expect(applicationReported.length).toBeGreaterThan(0);
      expect(paragraph).not.toContain("only ever");
      expect(paragraph).toContain("from a gauge the application reports");

      for (const descriptor of applicationReported) {
        expect(paragraph).toContain(
          `[${descriptor.displayName}](#${descriptor.docsAnchor})`,
        );
        // Its broker health has nothing curated: the gauge is all there is.
        expect(getMessageQueueMetricsForSystem(descriptor.system)).toEqual([]);
      }
    });
  });

  describe("navigation", (): void => {
    it("lists the page in the Infrastructure Agents group, right after Databases", (): void => {
      const links: Array<NavLink> = navGroup("Infrastructure Agents").links;
      const index: number = links.findIndex((link: NavLink): boolean => {
        return link.url === PAGE_URL;
      });

      expect(index).toBeGreaterThan(0);
      expect(links[index]?.title).toBe(PAGE_TITLE);
      expect(links[index - 1]?.url).toBe("/docs/telemetry/databases");
    });

    /*
     * Docs/Index.ts resolves a request to the FIRST nav link whose URL
     * contains the requested path, so an earlier link containing this
     * page's path would steal it, and this link would steal any page whose
     * path is a substring of its URL.
     */
    it("is the link the docs router resolves the page to, and steals no other page", (): void => {
      const all: Array<NavLink> = DocsNav.flatMap(
        (group: NavGroup): Array<NavLink> => {
          return group.links;
        },
      );
      const resolve: (docsPath: string) => NavLink | undefined = (
        docsPath: string,
      ): NavLink | undefined => {
        return all.find((link: NavLink): boolean => {
          return link.url.toLocaleLowerCase().includes(docsPath);
        });
      };

      expect(resolve(PAGE)?.url).toBe(PAGE_URL);

      for (const link of all) {
        if (!link.url.startsWith("/docs/") || link.url === PAGE_URL) {
          continue;
        }

        const docsPath: string = link.url.replace("/docs/", "").toLowerCase();

        expect({
          url: link.url,
          resolvedToQueues: resolve(docsPath)?.url === PAGE_URL,
        }).toEqual({ url: link.url, resolvedToQueues: false });
      }
    });
  });

  /*
   * The table is the page's promise about every system OneUptime knows:
   * what it normalises spans to, which spellings it folds, and where the
   * broker's metrics come from. The in-app guidance card and each queue's
   * Documentation tab are built from the same catalog, so a row that drifts
   * from it contradicts the product.
   */
  describe("the supported messaging systems table", (): void => {
    function tableRowsBySystem(): Map<string, Array<string>> {
      const rows: Map<string, Array<string>> = new Map<string, Array<string>>();

      for (const cells of tableRows(
        section(readPage(), SUPPORTED_SYSTEMS_HEADING),
      )) {
        const system: RegExpMatchArray | null = (cells[1] || "").match(
          /^`([^`]+)`$/,
        );

        // Four cells and a backticked system: a data row, not the header.
        if (cells.length === 4 && system && cells[0] !== "System") {
          expect({
            system: system[1],
            duplicate: rows.has(system[1] as string),
          }).toEqual({ system: system[1], duplicate: false });
          rows.set(system[1] as string, cells);
        }
      }

      return rows;
    }

    it("has one row per catalog system and nothing else", (): void => {
      expect([...tableRowsBySystem().keys()].sort()).toEqual(
        MESSAGING_SYSTEMS.map(
          (descriptor: MessagingSystemDescriptor): string => {
            return descriptor.system;
          },
        ).sort(),
      );
    });

    it("states each system's name, section, value, other spellings and broker metrics source as the catalog has them", (): void => {
      const rows: Map<string, Array<string>> = tableRowsBySystem();

      for (const descriptor of MESSAGING_SYSTEMS) {
        expect({
          system: descriptor.system,
          cells: rows.get(descriptor.system) || [],
        }).toEqual({
          system: descriptor.system,
          cells: [
            `[${descriptor.displayName}](#${descriptor.docsAnchor})`,
            `\`${descriptor.system}\``,
            descriptor.aliases.length > 0
              ? descriptor.aliases
                  .map((alias: string): string => {
                    return `\`${alias}\``;
                  })
                  .join(", ")
              : "—",
            expectedBrokerMetricsCell(descriptor.brokerMetrics),
          ],
        });
      }
    });

    it("is sorted by display name, so a reader can find a row", (): void => {
      expect(
        [...tableRowsBySystem().values()].map(
          (cells: Array<string>): string => {
            return (cells[0] as string).replace(/^\[([^\]]+)\].*$/, "$1");
          },
        ),
      ).toEqual(
        descriptorsBySystem().map(
          (descriptor: MessagingSystemDescriptor): string => {
            return descriptor.displayName;
          },
        ),
      );
    });

    it("folds every spelling it lists, whatever the case", (): void => {
      for (const descriptor of MESSAGING_SYSTEMS) {
        for (const spelling of [descriptor.system, ...descriptor.aliases]) {
          expect({
            spelling,
            normalized: normalizeMessagingSystem(` ${spelling.toUpperCase()} `),
          }).toEqual({ spelling, normalized: descriptor.system });
        }
      }

      // The example the intro gives.
      expect(section(readPage(), SUPPORTED_SYSTEMS_HEADING)).toContain(
        "`AmazonSQS`, `aws.sqs` and `aws_sqs` are one system",
      );
      expect(
        ["AmazonSQS", "aws.sqs", "aws_sqs"].map(
          (raw: string): string | null => {
            return normalizeMessagingSystem(raw);
          },
        ),
      ).toEqual(["aws_sqs", "aws_sqs", "aws_sqs"]);
    });

    it("names exactly the systems that are not OpenTelemetry well-known values", (): void => {
      const phrase: string = "are not OpenTelemetry well-known values";
      const line: string = lineWith(
        section(readPage(), SUPPORTED_SYSTEMS_HEADING),
        phrase,
      );
      // The sentence's subject: from the end of the previous sentence to the phrase.
      const upToPhrase: string = line.substring(0, line.indexOf(phrase));
      const subject: string = upToPhrase.substring(
        upToPhrase.lastIndexOf(". ") + 1,
      );
      const named: Array<string> = Array.from(
        subject.matchAll(/`([^`]+)`/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect(named.sort()).toEqual(
        MESSAGING_SYSTEMS.filter(
          (descriptor: MessagingSystemDescriptor): boolean => {
            return !descriptor.isSemconvValue;
          },
        )
          .map((descriptor: MessagingSystemDescriptor): string => {
            return descriptor.system;
          })
          .sort(),
      );
    });

    it("keeps an unknown system as it came, and ignores spring_integration, as it says", (): void => {
      const text: string = section(readPage(), SUPPORTED_SYSTEMS_HEADING);

      for (const unknown of ["ibmmq", "solace", "mqtt"]) {
        expect(text).toContain(`\`${unknown}\``);
        expect(getMessagingSystemDescriptor(unknown)).toBeNull();
        expect(normalizeMessagingSystem(unknown)).toBe(unknown);
        expect(identityOf(resolveSpan(spanOf(unknown, "ORDERS")))?.system).toBe(
          unknown,
        );
      }

      expect(text).toContain("up to 64 characters");
      expect(normalizeMessagingSystem("a".repeat(64))).toBe("a".repeat(64));
      expect(normalizeMessagingSystem("a".repeat(65))).toBeNull();

      expect(text).toContain("`spring_integration` is ignored");
      expect(isExcludedMessagingSystem("spring_integration")).toBe(true);
      expect(resolveSpan(spanOf("spring_integration", "orders"))).toBeNull();
    });

    it("names the namespace-scoped systems and the identity families under the table", (): void => {
      const paragraph: string = paragraphWith(
        section(readPage(), SUPPORTED_SYSTEMS_HEADING),
        "A queue is one destination of one system.",
      );

      for (const descriptor of MESSAGING_SYSTEMS) {
        if (descriptor.brokerScope === "azure-namespace") {
          expect(paragraph).toContain(`**${descriptor.displayName}**`);
        }

        if (descriptor.identityFamily) {
          expect(paragraph).toContain(`**${descriptor.displayName}**`);
          expect(paragraph).toContain(
            `**${getMessagingSystemDisplayName(descriptor.identityFamily)}**`,
          );
        }
      }
    });
  });

  describe("the broker health sections", (): void => {
    it("has one section per catalog system, headed by its display name, in the table's order", (): void => {
      const markdown: string = section(readPage(), BROKER_METRICS_HEADING);

      expect(
        headings(markdown)
          .filter((heading: { level: number; text: string }): boolean => {
            return heading.level === 3;
          })
          .map((heading: { level: number; text: string }): string => {
            return heading.text;
          }),
      ).toEqual(
        descriptorsBySystem().map(
          (descriptor: MessagingSystemDescriptor): string => {
            return descriptor.displayName;
          },
        ),
      );
    });

    /*
     * The in-app guidance card links to /docs/telemetry/queues#<docsAnchor>
     * for a queue whose broker metrics have not arrived.
     */
    it("puts every system's section at the catalog's docsAnchor", (): void => {
      const slugs: Set<string> = headingSlugs(readPage());

      for (const descriptor of MESSAGING_SYSTEMS) {
        expect({
          system: descriptor.system,
          anchor: slugify(descriptor.displayName),
        }).toEqual({
          system: descriptor.system,
          anchor: descriptor.docsAnchor,
        });
        expect({
          system: descriptor.system,
          resolves: slugs.has(descriptor.docsAnchor),
        }).toEqual({ system: descriptor.system, resolves: true });
      }
    });

    it("opens each section with the catalog's note, word for word", (): void => {
      for (const descriptor of MESSAGING_SYSTEMS) {
        const firstParagraph: string = (
          systemSection(descriptor)
            .trim()
            .split(/\n\s*\n/)[0] as string
        ).trim();

        expect({ system: descriptor.system, firstParagraph }).toEqual({
          system: descriptor.system,
          firstParagraph: catalogNote(descriptor.brokerMetrics),
        });
      }
    });

    /*
     * Every config sits in a system's section, where the per-system checks
     * below read it — except the one Alerting's counter copy adds to the
     * RabbitMQ config, which "converts a copy of a counter" checks against
     * that section's config.
     */
    it("keeps every collector config on the page inside a system's section, but Alerting's counter copy", (): void => {
      const all: number = yamlBlocks(readPage()).length;

      expect(all).toBeGreaterThanOrEqual(12);
      expect(yamlBlocks(section(readPage(), "## Alerting"))).toHaveLength(1);
      expect(
        MESSAGING_SYSTEMS.reduce(
          (count: number, descriptor: MessagingSystemDescriptor): number => {
            return count + yamlBlocks(systemSection(descriptor)).length;
          },
          0,
        ) + 1,
      ).toBe(all);
    });

    it("gives every collector config the OneUptime exporter, and only components it defines", (): void => {
      for (const body of yamlBlocks(readPage())) {
        const config: YamlMap = parseYaml(body);

        expect(
          Object.keys(config).filter((key: string): boolean => {
            return !CONFIG_SECTIONS.includes(key);
          }),
        ).toEqual([]);

        // Only pinned component types.
        for (const kind of Object.keys(PINNED_COMPONENT_TYPES)) {
          for (const id of componentIds(config, kind)) {
            expect({ kind, id, pinned: true }).toEqual({
              kind,
              id,
              pinned: (PINNED_COMPONENT_TYPES[kind] || []).includes(
                componentType(id),
              ),
            });
          }
        }

        // The exporter every OneUptime doc uses: default protobuf, the token header.
        const exporters: YamlMap = config["exporters"] as YamlMap;

        expect(Object.keys(exporters)).toEqual([EXPORTER_ID]);

        const exporter: YamlMap = exporters[EXPORTER_ID] as YamlMap;

        expect(exporter["endpoint"]).toBe(ONEUPTIME_OTLP_ENDPOINT);
        expect(exporter["encoding"]).toBeUndefined();
        expect(Object.keys(exporter["headers"] as YamlMap)).toEqual([
          TOKEN_HEADER,
        ]);
        expect(
          String((exporter["headers"] as YamlMap)[TOKEN_HEADER]).length,
        ).toBeGreaterThan(0);

        // Every pipeline names defined components, and exports to OneUptime.
        const service: YamlMap = config["service"] as YamlMap;
        const pipelines: YamlMap = service["pipelines"] as YamlMap;
        const used: Set<string> = new Set<string>();

        expect(Object.keys(pipelines).length).toBeGreaterThan(0);

        for (const [name, pipeline] of Object.entries(pipelines)) {
          expect(["metrics", "traces"]).toContain(name.split("/")[0]);

          for (const kind of ["receivers", "processors", "exporters"]) {
            const ids: Array<string> =
              ((pipeline as YamlMap)[kind] as Array<string> | undefined) || [];

            for (const id of ids) {
              expect({ pipeline: name, kind, id, defined: true }).toEqual({
                pipeline: name,
                kind,
                id,
                defined: componentIds(config, kind).includes(id),
              });
              used.add(`${kind}:${id}`);
            }
          }

          expect((pipeline as YamlMap)["exporters"]).toEqual([EXPORTER_ID]);
          expect(
            ((pipeline as YamlMap)["receivers"] as Array<string>).length,
          ).toBeGreaterThan(0);
        }

        // Nothing defined and left unused.
        for (const kind of ["receivers", "processors", "exporters"]) {
          for (const id of componentIds(config, kind)) {
            expect({ kind, id, used: used.has(`${kind}:${id}`) }).toEqual({
              kind,
              id,
              used: true,
            });
          }
        }

        /*
         * Extensions: every one defined is enabled (defining one does not
         * start it), and every one a receiver references — an Azure
         * authenticator, a Firehose encoding — is both. `otelcol validate`
         * resolves neither reference; the collector only fails at start.
         */
        const extensions: Array<string> = componentIds(config, "extensions");
        const enabled: Array<string> =
          (service["extensions"] as Array<string> | undefined) || [];

        expect([...enabled].sort()).toEqual([...extensions].sort());

        for (const [id, receiver] of Object.entries(
          (config["receivers"] as YamlMap) || {},
        )) {
          const references: Array<string> = [];
          const auth: unknown = isMapping(receiver)
            ? receiver["auth"]
            : undefined;

          if (isMapping(auth) && typeof auth["authenticator"] === "string") {
            references.push(auth["authenticator"]);
          }

          if (isMapping(receiver) && typeof receiver["encoding"] === "string") {
            references.push(receiver["encoding"]);
          }

          for (const reference of references) {
            expect({ receiver: id, reference, enabled: true }).toEqual({
              receiver: id,
              reference,
              enabled: enabled.includes(reference),
            });
          }
        }
      }
    });

    it("names only the catalog's receivers in each system's configs", (): void => {
      for (const descriptor of MESSAGING_SYSTEMS) {
        const allowed: Array<string> = allowedReceivers(
          descriptor.brokerMetrics,
        );

        for (const body of yamlBlocks(systemSection(descriptor))) {
          for (const id of componentIds(parseYaml(body), "receivers")) {
            expect({
              system: descriptor.system,
              receiver: id,
              allowed: true,
            }).toEqual({
              system: descriptor.system,
              receiver: id,
              allowed: allowed.includes(componentType(id)),
            });
          }
        }
      }
    });

    it("configures every collector-read system with the catalog's receiver, and every alternative somewhere", (): void => {
      const pageReceivers: Set<string> = new Set<string>(
        yamlBlocks(readPage()).flatMap((body: string): Array<string> => {
          return componentIds(parseYaml(body), "receivers").map(componentType);
        }),
      );

      for (const descriptor of MESSAGING_SYSTEMS) {
        const source: MessagingBrokerMetricsSource = descriptor.brokerMetrics;

        if (
          source.kind !== "receiver" &&
          source.kind !== "prometheus" &&
          source.kind !== "cloud-monitoring"
        ) {
          continue;
        }

        const primary: string =
          source.kind === "prometheus" ? "prometheus" : source.receiver;
        const own: Array<string> = yamlBlocks(
          systemSection(descriptor),
        ).flatMap((body: string): Array<string> => {
          return componentIds(parseYaml(body), "receivers").map(componentType);
        });

        expect({
          system: descriptor.system,
          primary: own.includes(primary),
        }).toEqual({ system: descriptor.system, primary: true });

        for (const receiver of getMessagingBrokerMetricsReceivers(source)) {
          expect({ system: descriptor.system, receiver, onPage: true }).toEqual(
            {
              system: descriptor.system,
              receiver,
              onPage: pageReceivers.has(receiver),
            },
          );
        }
      }
    });

    it("scrapes each Prometheus system on the port and path the catalog names", (): void => {
      for (const descriptor of MESSAGING_SYSTEMS) {
        const source: MessagingBrokerMetricsSource = descriptor.brokerMetrics;

        if (source.kind !== "prometheus") {
          continue;
        }

        const scrapeConfigs: Array<YamlMap> = yamlBlocks(
          systemSection(descriptor),
        ).flatMap((body: string): Array<YamlMap> => {
          return receiverConfigs(parseYaml(body), "prometheus").flatMap(
            (receiver: { id: string; config: YamlMap }): Array<YamlMap> => {
              return ((receiver.config["config"] as YamlMap)[
                "scrape_configs"
              ] || []) as Array<YamlMap>;
            },
          );
        });

        expect(scrapeConfigs.length).toBeGreaterThan(0);

        for (const scrape of scrapeConfigs) {
          // The Prometheus default path is /metrics.
          expect({
            system: descriptor.system,
            path: scrape["metrics_path"] || "/metrics",
          }).toEqual({ system: descriptor.system, path: source.path });

          const targets: Array<string> = (
            (scrape["static_configs"] || []) as Array<YamlMap>
          ).flatMap((staticConfig: YamlMap): Array<string> => {
            return (staticConfig["targets"] || []) as Array<string>;
          });

          expect(targets.length).toBeGreaterThan(0);

          for (const target of targets) {
            expect({ system: descriptor.system, target, port: true }).toEqual({
              system: descriptor.system,
              target,
              port: target.endsWith(`:${source.port}`),
            });
          }
        }
      }
    });

    it("keeps the Pulsar scrape's keep filter wide enough for every metric the queue page charts", (): void => {
      const descriptor: MessagingSystemDescriptor =
        getMessagingSystemDescriptor("pulsar") as MessagingSystemDescriptor;
      const keeps: Array<RegExp> = [];

      for (const body of yamlBlocks(systemSection(descriptor))) {
        for (const receiver of receiverConfigs(parseYaml(body), "prometheus")) {
          for (const scrape of ((receiver.config["config"] as YamlMap)[
            "scrape_configs"
          ] || []) as Array<YamlMap>) {
            for (const relabel of (scrape["metric_relabel_configs"] ||
              []) as Array<YamlMap>) {
              if (relabel["action"] === "keep") {
                expect(relabel["source_labels"]).toEqual(["__name__"]);
                // Prometheus anchors a relabel regex at both ends.
                keeps.push(new RegExp(`^(?:${String(relabel["regex"])})$`));
              }
            }
          }
        }
      }

      expect(keeps.length).toBeGreaterThan(0);

      for (const metric of getMessageQueueMetricsForSystem("pulsar")) {
        for (const keep of keeps) {
          expect({ metric: metric.metricName, kept: true }).toEqual({
            metric: metric.metricName,
            kept: keep.test(metric.metricName),
          });
        }
      }
    });

    it("asks kafka_metrics for the topics and consumers scrapers the note names", (): void => {
      const descriptor: MessagingSystemDescriptor =
        getMessagingSystemDescriptor("kafka") as MessagingSystemDescriptor;
      const receivers: Array<{ id: string; config: YamlMap }> = yamlBlocks(
        systemSection(descriptor),
      ).flatMap((body: string): Array<{ id: string; config: YamlMap }> => {
        return receiverConfigs(parseYaml(body), "kafka_metrics");
      });

      expect(receivers.length).toBeGreaterThan(0);
      expect(catalogNote(descriptor.brokerMetrics)).toContain(
        "enable its `topics` and `consumers` scrapers",
      );

      for (const receiver of receivers) {
        expect(receiver.config["scrapers"]).toEqual(
          expect.arrayContaining(["topics", "consumers"]),
        );
      }
    });

    /*
     * Without `stats` the receiver sends each metric as one Summary per
     * period, which the catalog's aggregations read; with it, one Gauge per
     * statistic under a `stat` attribute the catalog does not split by, so
     * the charts would mix Sum, Maximum and SampleCount.
     */
    it("keeps aws_cloudwatch on the default summary, one namespace per receiver", (): void => {
      for (const system of Object.keys(CLOUDWATCH_NAMESPACES)) {
        const descriptor: MessagingSystemDescriptor =
          getMessagingSystemDescriptor(system) as MessagingSystemDescriptor;
        const text: string = systemSection(descriptor);
        const receivers: Array<{ id: string; config: YamlMap }> = yamlBlocks(
          text,
        ).flatMap((body: string): Array<{ id: string; config: YamlMap }> => {
          return receiverConfigs(parseYaml(body), "aws_cloudwatch");
        });

        expect(receivers.length).toBeGreaterThan(0);

        for (const receiver of receivers) {
          const metrics: YamlMap = receiver.config["metrics"] as YamlMap;
          const discovery: YamlMap = metrics["discovery"] as YamlMap;

          expect(keysAtAnyDepth(receiver.config)).not.toContain("stats");
          expect((discovery["filters"] as YamlMap)["namespace"]).toBe(
            CLOUDWATCH_NAMESPACES[system],
          );
          // Config validation rejects a missing or non-positive limit.
          expect(discovery["limit"]).toBeGreaterThan(0);
        }
      }

      expect(
        systemSection(
          getMessagingSystemDescriptor("aws_sqs") as MessagingSystemDescriptor,
        ),
      ).toContain("**Leave `stats` unset.**");
      expect(
        systemSection(
          getMessagingSystemDescriptor("aws.sns") as MessagingSystemDescriptor,
        ),
      ).toContain("Leave `stats` unset");
    });

    it("lists exactly the Pub/Sub metric types the catalog charts under metrics_list", (): void => {
      const descriptor: MessagingSystemDescriptor =
        getMessagingSystemDescriptor("gcp_pubsub") as MessagingSystemDescriptor;
      const receivers: Array<{ id: string; config: YamlMap }> = yamlBlocks(
        systemSection(descriptor),
      ).flatMap((body: string): Array<{ id: string; config: YamlMap }> => {
        return receiverConfigs(parseYaml(body), "googlecloudmonitoring");
      });

      expect(receivers.length).toBeGreaterThan(0);

      for (const receiver of receivers) {
        const listed: Array<string> = (
          receiver.config["metrics_list"] as Array<YamlMap>
        ).map((entry: YamlMap): string => {
          return String(entry["metric_name"]);
        });

        expect([...listed].sort()).toEqual(
          getMessageQueueMetricsForSystem("gcp_pubsub")
            .map((metric: MessageQueueMetricDescriptor): string => {
              return metric.metricName;
            })
            .sort(),
        );
      }
    });

    /*
     * Azure Monitor names a metric azure_<name>_<aggregation>. Once a
     * `metrics` filter lists a namespace, the receiver drops that
     * namespace's unlisted metrics and aggregations, so the filter must
     * hold every metric the catalog charts, with the aggregation it charts.
     */
    it("collects every Azure metric the catalog charts, with its aggregation, from the right resource type", (): void => {
      for (const descriptor of MESSAGING_SYSTEMS) {
        const curated: ReadonlyArray<MessageQueueMetricDescriptor> =
          getMessageQueueMetricsForSystem(descriptor.system).filter(
            (metric: MessageQueueMetricDescriptor): boolean => {
              return metric.receiver === "azure_monitor";
            },
          );

        if (curated.length === 0) {
          continue;
        }

        const receivers: Array<{ id: string; config: YamlMap }> = yamlBlocks(
          systemSection(descriptor),
        ).flatMap((body: string): Array<{ id: string; config: YamlMap }> => {
          return receiverConfigs(parseYaml(body), "azure_monitor");
        });

        expect(receivers.length).toBeGreaterThan(0);

        for (const receiver of receivers) {
          // Azure's default of 10 series per metric would drop queues.
          expect(
            receiver.config["maximum_number_of_records_per_resource"],
          ).toBeGreaterThan(10);

          const services: Array<string> = (
            receiver.config["services"] as Array<string>
          ).map((service: string): string => {
            return service.toLowerCase();
          });
          const filters: YamlMap = receiver.config["metrics"] as YamlMap;

          for (const metric of curated) {
            const name: RegExpMatchArray | null =
              metric.metricName.match(AZURE_METRIC_NAME);
            const resourceType: string = ((metric.requiredAttributes || {})[
              "type"
            ] || [])[0] as string;

            expect({
              metric: metric.metricName,
              parsed: Boolean(name),
            }).toEqual({
              metric: metric.metricName,
              parsed: true,
            });
            expect(services).toContain(resourceType);

            const namespaceKey: string | undefined = Object.keys(filters).find(
              (key: string): boolean => {
                return key.toLowerCase() === resourceType;
              },
            );

            expect({ metric: metric.metricName, namespaceKey }).toEqual({
              metric: metric.metricName,
              namespaceKey: expect.any(String),
            });

            const namespaceFilters: YamlMap = filters[
              namespaceKey as string
            ] as YamlMap;
            const metricKey: string | undefined = Object.keys(
              namespaceFilters,
            ).find((key: string): boolean => {
              return key.toLowerCase() === (name as RegExpMatchArray)[1];
            });

            expect({ metric: metric.metricName, metricKey }).toEqual({
              metric: metric.metricName,
              metricKey: expect.any(String),
            });

            const aggregations: Array<string> = namespaceFilters[
              metricKey as string
            ] as Array<string>;

            expect({
              metric: metric.metricName,
              aggregation:
                aggregations.length === 0 ||
                aggregations.some((aggregation: string): boolean => {
                  return (
                    aggregation.toLowerCase() === (name as RegExpMatchArray)[2]
                  );
                }),
            }).toEqual({ metric: metric.metricName, aggregation: true });
          }
        }
      }
    });

    it("lists each system's charted metrics, titles and types as the catalog has them", (): void => {
      for (const descriptor of MESSAGING_SYSTEMS) {
        const rows: Array<Array<string>> = metricTableRows(
          systemSection(descriptor),
        );
        const expected: Array<{
          names: Array<string>;
          title: string;
          type: string;
        }> = expectedMetricRows(descriptor.system);

        expect({
          system: descriptor.system,
          rows: rows.map(
            (
              cells: Array<string>,
            ): { names: Array<string>; title: string; type: string } => {
              return {
                names: Array.from(
                  (cells[0] as string).matchAll(/`([^`]+)`/g),
                ).map((match: RegExpMatchArray): string => {
                  return match[1] as string;
                }),
                title: cells[1] as string,
                type: cells[2] as string,
              };
            },
          ),
        }).toEqual({ system: descriptor.system, rows: expected });
      }
    });

    it("says where the metrics go for a system the queue page charts nothing of", (): void => {
      for (const descriptor of MESSAGING_SYSTEMS) {
        if (getMessageQueueMetricsForSystem(descriptor.system).length > 0) {
          continue;
        }

        expect({
          system: descriptor.system,
          pointsToMetrics: systemSection(descriptor).includes("**Metrics**"),
        }).toEqual({ system: descriptor.system, pointsToMetrics: true });
      }

      const uncharted: string = lineWith(
        section(readPage(), "### Broker health stays empty"),
        "The system has no charted metrics",
      );

      for (const descriptor of MESSAGING_SYSTEMS) {
        const charted: boolean =
          getMessageQueueMetricsForSystem(descriptor.system).length > 0;

        expect({
          system: descriptor.system,
          listedAsUncharted: uncharted.includes(descriptor.displayName),
        }).toEqual({ system: descriptor.system, listedAsUncharted: !charted });
      }
    });

    /*
     * The management API lists a user only the queues of the virtual hosts
     * it has access to, and the `monitoring` tag does not widen that.
     * Checked live against RabbitMQ 4.3.6 with the collector-contrib 0.161.0
     * `rabbitmq` receiver configured as on the page: with the tag alone,
     * /api/queues returns [] and the receiver sends no datapoint and logs no
     * error; after `set_permissions -p <vhost> otel "" "" ""` in each virtual
     * host, every queue's rabbitmq.message.current arrives, while consuming
     * (read) and publishing (write) stay refused.
     */
    it("gives the RabbitMQ receiver's user access to each virtual host, which the monitoring tag alone does not", (): void => {
      const text: string = systemSection(
        getMessagingSystemDescriptor("rabbitmq") as MessagingSystemDescriptor,
      );
      const script: string | undefined = fencedBlocks(text)
        .filter((block: FencedBlock): boolean => {
          return block.info === "bash";
        })
        .map((block: FencedBlock): string => {
          return block.body;
        })
        .find((body: string): boolean => {
          return body.includes("rabbitmqctl add_user");
        });

      expect(script).toBeDefined();

      const user: string = (
        (script as string).match(
          /rabbitmqctl add_user (\S+) /,
        ) as RegExpMatchArray
      )[1] as string;

      expect(script).toContain(`rabbitmqctl set_user_tags ${user} monitoring`);
      // Access to a virtual host, with no right to configure, write or read.
      expect(script).toMatch(
        new RegExp(`rabbitmqctl set_permissions -p \\S+ ${user} "" "" ""`),
      );
      expect(text).toContain("The `monitoring` tag alone shows it no queue");
      expect(text).not.toContain(
        "lets it read the queues of every virtual host",
      );

      // The receiver logs nothing when it sees no queue, so troubleshooting says why.
      expect(
        lineWith(
          section(readPage(), "### Broker health stays empty"),
          "- The receiver does not report it.",
        ),
      ).toContain("virtual hosts its user has access to");
    });

    it("points the JMX Scraper straight at OneUptime, with the target system the note names", (): void => {
      const descriptor: MessagingSystemDescriptor =
        getMessagingSystemDescriptor("activemq") as MessagingSystemDescriptor;
      const text: string = systemSection(descriptor);
      const script: string | undefined = fencedBlocks(text)
        .map((block: FencedBlock): string => {
          return block.body;
        })
        .find((body: string): boolean => {
          return body.includes("opentelemetry-jmx-scraper.jar");
        });

      expect(descriptor.brokerMetrics.kind).toBe("external-scraper");
      expect(script).toBeDefined();

      for (const setting of [
        "OTEL_JMX_TARGET_SYSTEM=activemq",
        "OTEL_JMX_TARGET_SOURCE=instrumentation",
        "OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf",
        `OTEL_EXPORTER_OTLP_ENDPOINT=${ONEUPTIME_OTLP_ENDPOINT}`,
        `OTEL_EXPORTER_OTLP_HEADERS=${TOKEN_HEADER}=`,
      ]) {
        expect(script).toContain(setting);
      }

      expect(catalogNote(descriptor.brokerMetrics)).toContain(
        "`OTEL_JMX_TARGET_SYSTEM=activemq`",
      );

      // Both naming generations the prose names are ones the catalog reads.
      const names: Array<string> = MESSAGE_QUEUE_METRICS.filter(
        (metric: MessageQueueMetricDescriptor): boolean => {
          return metric.system === "activemq";
        },
      ).map((metric: MessageQueueMetricDescriptor): string => {
        return metric.metricName;
      });

      for (const generation of [
        "`activemq.message.queue.size`, with the destination in `messaging.destination.name`",
        "`activemq.message.current`, with the destination in `destination`",
      ]) {
        expect(text).toContain(generation);
      }

      expect(names).toEqual(
        expect.arrayContaining([
          "activemq.message.queue.size",
          "activemq.message.current",
        ]),
      );
    });
  });

  describe("discovery, as the resolver does it", (): void => {
    const JOB: string = fs.readFileSync(
      path.join(
        PACKAGES_DIR,
        "App/FeatureSet/Workers/Jobs/TelemetryEntity/ComputeServiceDependencies.ts",
      ),
      "utf8",
    );

    function traces(): string {
      return section(readPage(), "### From application traces");
    }

    it("names the window and the schedule of the job that discovers queues", (): void => {
      const windowMinutes: string = (
        JOB.match(
          /export const WINDOW_MINUTES: number = (\d+);/,
        ) as RegExpMatchArray | null
      )?.[1] as string;
      const schedule: string = (
        JOB.match(
          /const EVERY_TEN_MINUTES: string = "\*\/(\d+) \* \* \* \*";/,
        ) as RegExpMatchArray | null
      )?.[1] as string;

      expect(windowMinutes).toBeDefined();
      expect(schedule).toBeDefined();
      expect(traces()).toContain(
        `Every ${schedule} minutes OneUptime summarises the spans your applications sent in the last ${windowMinutes} minutes`,
      );
      expect(section(readPage(), "## Self-hosted tuning")).toContain(
        `within the ${windowMinutes}-minute window each ${schedule}-minute run looks at`,
      );
    });

    it("names exactly the attributes that make a span a messaging span", (): void => {
      const sentence: string = lineWith(traces(), "that carry any of");
      const named: Array<string> = Array.from(
        sentence.matchAll(/`([^`]+)`/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect([...named].sort()).toEqual(
        [...MESSAGING_TRIGGER_ATTRIBUTES].sort(),
      );
      expect(sentence).toContain("a SERVER span never names a queue");
      expect(
        resolveSpan(spanOf("kafka", "orders", "SPAN_KIND_SERVER")),
      ).toBeNull();

      for (const kind of ["PRODUCER", "CONSUMER", "CLIENT", "INTERNAL"]) {
        expect(sentence).toContain(kind);
        expect(
          resolveSpan(spanOf("kafka", "orders", `SPAN_KIND_${kind}`))
            ?.destination,
        ).toBe("orders");
      }
    });

    /*
     * The Kubernetes agent's eBPF tracer (OBI) sends a broker's own Kafka,
     * MQTT and NATS spans as PRODUCER / CONSUMER, and ingest stores them as
     * SERVER (ObiReceivingSideMessagingSpan). An MQTT broker's PUBLISH to a
     * subscriber is told from a client's by the port of the far end; the
     * page states the port the rule starts at, and what it costs on either
     * side of it — without promising more than the rule does.
     */
    it("says a broker's own eBPF spans are SERVER, and states the port rule for MQTT and NATS publishes where the ingest rule starts, with its costs", (): void => {
      const paragraph: string = paragraphWith(
        traces(),
        "A broker's own spans are SERVER spans as well.",
      );
      const start: number = EPHEMERAL_PORT_RANGE_START;
      const storedKind: (port: number, system?: string) => SpanKind = (
        port: number,
        system: string = "mqtt",
      ): SpanKind => {
        return normalizeObiReceivingSideMessagingSpanKind({
          kind: SpanKind.Producer,
          attributes: {
            "resource.telemetry.distro.name":
              "opentelemetry-ebpf-instrumentation",
            "resource.service.name": "mosquitto",
            "messaging.system": system,
            "messaging.operation.type": "send",
            "messaging.destination.name": "sensors/temp",
            "server.address": "mqtt-subscriber",
            "server.port": String(port),
            "network.peer.port": String(port),
          },
        });
      };

      expect(paragraph).toContain("Kafka, MQTT or NATS");
      expect(paragraph).toContain(
        "so a broker is not listed among the producers or consumers of the topics it carries",
      );
      // Not every broker span is caught: see the low-port sentence below.
      expect(paragraph).not.toMatch(/\bnever\b/);
      expect(paragraph).toContain(`from port ${start} up`);
      expect(paragraph).toContain("49152–65535");
      // Above the start: an application's own publish reads as the broker's.
      expect(paragraph).toContain(
        `listens on a port from ${start} up, such as a Docker port published at random, is therefore not listed as a producer of its topics, and a topic that only such applications use may not be discovered from the tracer's spans at all.`,
      );
      // Below it: the broker's publish to that subscriber stays PRODUCER.
      expect(paragraph).toContain(
        `A subscriber that connects to a broker from a port below ${start} (a narrowed port range, or a port a NAT rewrote) still has the broker listed as a producer of the topics delivered to it.`,
      );
      for (const system of ["mqtt", "nats"]) {
        expect({ system, below: storedKind(start - 1, system) }).toEqual({
          system,
          below: SpanKind.Producer,
        });
        expect({ system, at: storedKind(start, system) }).toEqual({
          system,
          at: SpanKind.Server,
        });
        expect({ system, top: storedKind(65535, system) }).toEqual({
          system,
          top: SpanKind.Server,
        });
      }
      // Only MQTT and NATS publishes: the paragraph names no other system.
      expect(storedKind(start, "kafka")).toBe(SpanKind.Producer);
      expect(paragraph).toContain("for MQTT and NATS publishes");
    });

    it("reads the destination keys in the resolver's order, then each system's own", (): void => {
      const bullet: string = lineWith(traces(), "- **The destination**");

      expectInOrder(bullet, MESSAGING_DESTINATION_ATTRIBUTES);

      for (const key of [
        ...SQS_QUEUE_URL_ATTRIBUTES,
        ...SNS_TOPIC_ARN_ATTRIBUTES,
        ...RABBITMQ_ROUTING_KEY_ATTRIBUTES,
      ]) {
        expect(bullet).toContain(`\`${key}\``);
      }

      // A queue URL in any of the keys the bullet names for it is the queue.
      for (const key of ["messaging.url", "server.address", "net.peer.name"]) {
        expect(bullet).toContain(`\`${key}\``);
        expect(
          resolveSpan({
            attributes: {
              "messaging.system": "aws_sqs",
              [key]: "https://sqs.eu-west-1.amazonaws.com/123456789012/orders",
            },
            kind: "SPAN_KIND_PRODUCER",
          })?.destination,
        ).toBe("orders");
      }
    });

    it("reads the direction in the resolver's order, with the span kind second", (): void => {
      const bullet: string = lineWith(traces(), "- **The direction**");

      expectInOrder(bullet, MESSAGING_DIRECTION_ATTRIBUTES);

      const kind: number = bullet.indexOf("the span kind");

      expect(kind).toBeGreaterThan(
        bullet.indexOf(`\`${MESSAGING_DIRECTION_ATTRIBUTES[0]}\``),
      );
      expect(kind).toBeLessThan(
        bullet.indexOf(`\`${MESSAGING_DIRECTION_ATTRIBUTES[1]}\``),
      );

      // confluent-kafka for Python: "receive" on a PRODUCER span still publishes.
      expect(bullet).toContain("confluent-kafka for Python wrote `receive`");
      expect(
        resolveSpan(
          spanOf("kafka", "orders", "SPAN_KIND_PRODUCER", {
            "messaging.operation": "receive",
          }),
        )?.direction,
      ).toBe("publish");
    });

    it("finds a system from the keys it says it reads when messaging.system is missing", (): void => {
      const bullet: string = lineWith(traces(), "- **The system**");

      const fixtures: Array<{ fixture: SpanFixture; system: string }> = [
        {
          fixture: {
            attributes: {
              "az.namespace": "Microsoft.ServiceBus",
              "messaging.destination.name": "orders",
            },
            kind: "SPAN_KIND_PRODUCER",
          },
          system: "servicebus",
        },
        {
          fixture: {
            attributes: {
              "azure.resource_provider.namespace": "Microsoft.EventHub",
              "messaging.destination.name": "telemetry",
            },
            kind: "SPAN_KIND_PRODUCER",
          },
          system: "eventhubs",
        },
        {
          // The Java agent's SNS spans: an AWS SDK call, no messaging.system.
          fixture: {
            attributes: {
              "rpc.system": "aws-api",
              "rpc.service": "SNS",
              "aws.sns.topic.arn":
                "arn:aws:sns:us-east-1:123456789012:order-events",
            },
            kind: "SPAN_KIND_PRODUCER",
          },
          system: "aws.sns",
        },
        {
          fixture: {
            attributes: {
              "aws.queue_url":
                "https://sqs.us-east-1.amazonaws.com/123456789012/orders",
            },
            kind: "SPAN_KIND_CLIENT",
          },
          system: "aws_sqs",
        },
      ];

      for (const key of [
        "az.namespace",
        "azure.resource_provider.namespace",
        "component",
        "rpc.system",
      ]) {
        expect(bullet).toContain(`\`${key}\``);
      }

      for (const entry of fixtures) {
        expect(resolveSpan(entry.fixture)?.system).toBe(entry.system);
      }
    });

    it("names the Azure namespace hosts and address keys the identity reads, in order", (): void => {
      const identity: string = section(
        readPage(),
        "### What makes two sightings one queue",
      );
      const tokens: Array<string> = backtickedTokens(identity);

      for (const suffix of AZURE_SERVICE_BUS_HOST_SUFFIXES) {
        expect({
          suffix,
          named: tokens.some((token: string): boolean => {
            return token.endsWith(suffix);
          }),
        }).toEqual({ suffix, named: true });

        // A span to that host carries the namespace.
        expect(
          resolveSpan(
            spanOf("servicebus", "orders", "SPAN_KIND_PRODUCER", {
              "server.address": `shop-prod${suffix}`,
            }),
          )?.brokerScope,
        ).toBe("shop-prod");
      }

      expectInOrder(
        lineWith(identity, "the first DNS label of the host"),
        MESSAGING_BROKER_SCOPE_ADDRESS_ATTRIBUTES,
      );
    });

    it("compares destinations without regard to case, and keeps the namespace only for Service Bus and Event Hubs", (): void => {
      const identity: string = section(
        readPage(),
        "### What makes two sightings one queue",
      );

      expect(identity).toContain("`Orders` and `orders` are one queue");
      expect(
        toMessageQueueIdentity({ system: "kafka", destination: "Orders" }),
      ).toEqual(
        toMessageQueueIdentity({ system: "kafka", destination: "orders" }),
      );

      for (const descriptor of MESSAGING_SYSTEMS) {
        const first: MessageQueueIdentity | null = toMessageQueueIdentity({
          system: descriptor.system,
          brokerScope: "shop-prod",
          destination: "orders",
        });
        const second: MessageQueueIdentity | null = toMessageQueueIdentity({
          system: descriptor.system,
          brokerScope: "shop-test",
          destination: "orders",
        });

        expect({
          system: descriptor.system,
          namespaceSplits: JSON.stringify(first) !== JSON.stringify(second),
        }).toEqual({
          system: descriptor.system,
          namespaceSplits: descriptor.brokerScope === "azure-namespace",
        });
      }

      // The broker address, the consumer group and the partition never split one.
      const plain: MessageQueueIdentity | null = identityOf(
        resolveSpan(spanOf("kafka", "orders", "SPAN_KIND_CONSUMER")),
      );

      expect(
        identityOf(
          resolveSpan(
            spanOf("kafka", "orders", "SPAN_KIND_CONSUMER", {
              "server.address": "kafka-2.example.com",
              "server.port": 9092,
              "messaging.consumer.group.name": "billing",
              "messaging.destination.partition.id": "3",
            }),
          ),
        ),
      ).toEqual(plain);
    });

    /*
     * The resolver reads a span's consumer group and dead-letter sub-queue,
     * but a MessageQueue row stores neither, nor a partition: of what never
     * splits a queue, it keeps only the broker's address, for display. A
     * page that promised to show or mark the rest would promise something
     * no code ever fills in — so the page's promise is tied to the model's
     * columns, and a column added for them would fail here until the page
     * says so.
     */
    it("promises to keep only what a queue row stores", (): void => {
      const model: string = fs.readFileSync(
        path.join(PACKAGES_DIR, "Common/Models/DatabaseModels/MessageQueue.ts"),
        "utf8",
      );
      const columns: Array<string> = Array.from(
        model.matchAll(/^\s*public (\w+)\?:/gm),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect(columns).toContain("brokerAddress");

      for (const column of columns) {
        expect({
          column,
          stored: UNSPLITTING_PART_COLUMN.test(column),
        }).toEqual({ column, stored: false });
      }

      expect(
        section(readPage(), "### What makes two sightings one queue"),
      ).toContain(
        "Of these, a queue keeps only the broker's address, for display.",
      );

      const page: string = readPage();

      for (const promise of [
        "shows them where they are known",
        "marked as a dead-letter queue",
        "marked as dead-letter queues",
      ]) {
        expect({ promise, made: page.includes(promise) }).toEqual({
          promise,
          made: false,
        });
      }

      // A dead-letter queue a broker reports is simply a queue of its own.
      expect(
        systemSection(
          getMessagingSystemDescriptor("activemq") as MessagingSystemDescriptor,
        ),
      ).toContain(
        "dead-letter queues (`ActiveMQ.DLQ`, or `DLQ.<destination>` with an individual dead-letter strategy) are queues of their own.",
      );

      for (const destination of ["ActiveMQ.DLQ", "DLQ.orders"]) {
        expect(
          resolveDatapoint({
            metricName: "activemq.message.queue.size",
            attributes: {
              "messaging.destination.name": destination,
              "activemq.destination.type": "queue",
            },
          })?.destination,
        ).toBe(destination);
      }

      expect(
        resolveSpan(spanOf("rocketmq", "%DLQ%billing", "SPAN_KIND_CONSUMER"))
          ?.destination,
      ).toBe("%DLQ%billing");
      expect(
        systemSection(
          getMessagingSystemDescriptor("rocketmq") as MessagingSystemDescriptor,
        ),
      ).toContain(
        "A consumer group's dead-letter topic (`%DLQ%<group>`) is a queue of its own.",
      );
    });

    it("keys JMS and ActiveMQ as one family, and refines only towards ActiveMQ", (): void => {
      const identity: string = section(
        readPage(),
        "### What makes two sightings one queue",
      );

      expect(identity).toContain("**JMS and ActiveMQ are one family.**");
      expect(identity).toContain(
        "It shows as JMS until the broker's metrics arrive, and as Apache ActiveMQ from then on — never the other way round.",
      );

      const jms: MessageQueueIdentity | null = toMessageQueueIdentity({
        system: "jms",
        destination: "orders",
      });
      const activemq: MessageQueueIdentity | null = toMessageQueueIdentity({
        system: "activemq",
        destination: "orders",
      });

      expect(activemq).toEqual(jms);
      expect(
        keyForMessageQueue("project-1", activemq as MessageQueueIdentity),
      ).toBe(keyForMessageQueue("project-1", jms as MessageQueueIdentity));

      // A JMS span and the JMX Scraper's metric of one queue build one identity.
      expect(
        identityOf(
          resolveDatapoint({
            metricName: "activemq.message.queue.size",
            attributes: {
              "messaging.destination.name": "orders",
              "activemq.destination.type": "queue",
            },
          }),
        ),
      ).toEqual(identityOf(resolveSpan(spanOf("jms", "orders"))));

      expect(getMoreSpecificMessagingSystem("jms", "activemq")).toBe(
        "activemq",
      );
      expect(getMoreSpecificMessagingSystem("activemq", "jms")).toBe(
        "activemq",
      );
    });

    /*
     * What an instrumentation sends with each value the destination table
     * quotes, keyed by that value (the first backticked token of the row's
     * "Reported as" cell). Every row needs a fixture and every fixture a
     * row, so an example cannot be added without being run.
     */
    const DESTINATION_EXAMPLES: Readonly<
      Record<string, ReadonlyArray<SpanFixture>>
    > = {
      "https://sqs.us-east-1.amazonaws.com/123456789012/orders": [
        {
          attributes: {
            "messaging.system": "aws_sqs",
            "aws.sqs.queue.url":
              "https://sqs.us-east-1.amazonaws.com/123456789012/orders",
          },
          kind: "SPAN_KIND_PRODUCER",
        },
        // Go otelaws: the URL in server.address, no destination key.
        {
          attributes: {
            "messaging.system": "aws_sqs",
            "server.address":
              "https://sqs.us-east-1.amazonaws.com/123456789012/orders",
            "rpc.method": "SQS/SendMessage",
          },
          kind: "SPAN_KIND_CLIENT",
        },
      ],
      "arn:aws:sns:us-east-1:123456789012:order-events": [
        spanOf("aws.sns", "arn:aws:sns:us-east-1:123456789012:order-events"),
      ],
      "projects/shop/topics/orders": [
        spanOf("gcp_pubsub", "projects/shop/topics/orders"),
      ],
      "orders/Subscriptions/billing": [
        spanOf(
          "servicebus",
          "orders/Subscriptions/billing",
          "SPAN_KIND_CONSUMER",
          {
            "server.address": "shop-prod.servicebus.windows.net",
          },
        ),
      ],
      "orders/$DeadLetterQueue": [
        spanOf("servicebus", "orders/$DeadLetterQueue", "SPAN_KIND_CONSUMER", {
          "server.address": "shop-prod.servicebus.windows.net",
        }),
      ],
      "telemetry/ConsumerGroups/$Default/Partitions/3": [
        spanOf(
          "eventhubs",
          "telemetry/ConsumerGroups/$Default/Partitions/3",
          "SPAN_KIND_CONSUMER",
          { "server.address": "shop-prod.servicebus.windows.net" },
        ),
      ],
      "orders-partition-3": [spanOf("pulsar", "orders-partition-3")],
      "acme/shop/orders": [spanOf("pulsar", "acme/shop/orders")],
      "queue://orders": [spanOf("jms", "queue://orders")],
      "shop:new-order:orders": [
        spanOf("rabbitmq", "shop:new-order:orders", "SPAN_KIND_CONSUMER", {
          "messaging.rabbitmq.destination.routing_key": "new-order",
          "messaging.operation.type": "process",
        }),
      ],
      "amq.default": [
        spanOf("rabbitmq", "amq.default", "SPAN_KIND_PRODUCER", {
          "messaging.rabbitmq.destination.routing_key": "orders",
        }),
        // The Java agent's legacy name for the default exchange.
        spanOf("rabbitmq", "<default>", "SPAN_KIND_PRODUCER", {
          "messaging.rabbitmq.destination.routing_key": "orders",
        }),
        // amqplib: an empty exchange (absent once stored) and the pre-1.17 key.
        {
          attributes: {
            "messaging.system": "rabbitmq",
            "messaging.rabbitmq.routing_key": "orders",
          },
          kind: "SPAN_KIND_PRODUCER",
        },
      ],
      // aio-pika sets the untrusted temp_destination flag on every publish.
      ",orders": [
        {
          attributes: {
            "messaging.system": "rabbitmq",
            "messaging.destination": ",orders",
            "messaging.temp_destination": true,
          },
          kind: "SPAN_KIND_PRODUCER",
        },
      ],
      "shop,new-order": [
        {
          attributes: {
            "messaging.system": "rabbitmq",
            "messaging.destination": "shop,new-order",
            "messaging.temp_destination": true,
          },
          kind: "SPAN_KIND_PRODUCER",
        },
      ],
    };

    it("reduces every name the destination table quotes to the queue it names", (): void => {
      const rows: Array<Array<string>> = tableRows(
        section(readPage(), "### How destination names are read"),
      ).filter((cells: Array<string>): boolean => {
        return cells[0] !== "System";
      });
      const quoted: Array<string> = [];

      expect(rows.length).toBeGreaterThan(10);

      for (const cells of rows) {
        const [systemCell, reportedCell, queueCell] = cells as [
          string,
          string,
          string,
        ];
        const reported: string = firstToken(reportedCell);
        const queue: string = firstToken(queueCell);
        const fixtures: ReadonlyArray<SpanFixture> | undefined =
          DESTINATION_EXAMPLES[reported];

        quoted.push(reported);

        expect({ reported, fixtures: Boolean(fixtures) }).toEqual({
          reported,
          fixtures: true,
        });

        /*
         * The Queue cell is the queue and nothing more: a queue keeps no
         * subscription, consumer group or dead-letter flag (see "promises
         * to keep only what a queue row stores"), so the parts of an entity
         * path are described where the path is reported.
         */
        expect({ reported, queueCell }).toEqual({
          reported,
          queueCell: `\`${queue}\``,
        });

        for (const fixture of fixtures || []) {
          const resolved: ResolvedMessagingDestination | null =
            resolveSpan(fixture);
          const group: RegExpMatchArray | null = reportedCell.match(
            /(?:subscription|consumer group) `([^`]+)`/,
          );

          expect({
            reported,
            system: getMessagingSystemDisplayName(resolved?.system),
            destination: resolved?.destination,
            consumerGroup: group ? resolved?.consumerGroup : null,
            isDeadLetter: resolved?.isDeadLetter,
          }).toEqual({
            reported,
            system: systemCell,
            destination: queue,
            consumerGroup: group ? group[1] : null,
            isDeadLetter: reportedCell.includes("dead-letter sub-queue"),
          });
        }
      }

      expect(quoted.sort()).toEqual(Object.keys(DESTINATION_EXAMPLES).sort());
    });

    /*
     * The examples of "What is ignored", each with what an instrumentation
     * sends: `documented` is the backticked token on the page (with its
     * "…" where the page shows a family of names), `fixture` a concrete
     * member of it.
     */
    const IGNORED_EXAMPLES: ReadonlyArray<{
      documented: string;
      fixture: SpanFixture | DatapointFixture;
    }> = [
      {
        documented: "spring_integration",
        fixture: spanOf("spring_integration", "orders"),
      },
      ...MESSAGING_TEMPORARY_FLAG_ATTRIBUTES.map(
        (
          flag: string,
        ): { documented: string; fixture: SpanFixture | DatapointFixture } => {
          return {
            documented: flag,
            fixture: spanOf("kafka", "replies", "SPAN_KIND_PRODUCER", {
              [flag]: true,
            }),
          };
        },
      ),
      { documented: "(temporary)", fixture: spanOf("jms", "(temporary)") },
      { documented: "(anonymous)", fixture: spanOf("rabbitmq", "(anonymous)") },
      { documented: "<generated>", fixture: spanOf("rabbitmq", "<generated>") },
      {
        documented: "unknown",
        fixture: spanOf("kafka", "unknown", "SPAN_KIND_CONSUMER"),
      },
      {
        documented: "aws:sqs",
        fixture: spanOf("aws_sqs", "aws:sqs", "SPAN_KIND_CONSUMER"),
      },
      {
        documented: "-NamespaceOnlyMetric-",
        fixture: {
          metricName: "azure_activemessages_average",
          attributes: {
            type: "Microsoft.ServiceBus/Namespaces",
            name: "shop-prod",
            metadata_entityname: "-NamespaceOnlyMetric-",
          },
        },
      },
      { documented: "[REDACTED]", fixture: spanOf("kafka", "[REDACTED]") },
      {
        documented: "amq.gen-JzTY20BRgKO-HjmUJj0wLg",
        fixture: spanOf(
          "rabbitmq",
          "amq.gen-JzTY20BRgKO-HjmUJj0wLg",
          "SPAN_KIND_CONSUMER",
        ),
      },
      {
        documented: "spring.gen-…",
        fixture: spanOf("rabbitmq", "spring.gen-4f1c2b", "SPAN_KIND_CONSUMER"),
      },
      {
        documented: "<destination>.anonymous.<id>",
        fixture: spanOf(
          "rabbitmq",
          "orders.anonymous.Kx7yWq2bRZa9cLmN3pQv1A",
          "SPAN_KIND_CONSUMER",
        ),
      },
      {
        documented: "amq.rabbitmq.reply-to…",
        fixture: spanOf("rabbitmq", "amq.default", "SPAN_KIND_PRODUCER", {
          "messaging.rabbitmq.destination.routing_key":
            "amq.rabbitmq.reply-to.g1h2AA5yZXBseQ",
        }),
      },
      {
        documented: "temp-queue://…",
        fixture: spanOf("jms", "temp-queue://ID:host-1234-1:1:1"),
      },
      {
        documented: "temp-topic://…",
        fixture: spanOf("jms", "temp-topic://ID:host-1234-1:1:2"),
      },
      { documented: "$TMP$…", fixture: spanOf("jms", "$TMP$.EMS-SERVER.1234") },
      {
        documented: "ActiveMQ.Advisory.…",
        fixture: spanOf("activemq", "ActiveMQ.Advisory.Connection"),
      },
      {
        documented: "_INBOX.…",
        fixture: spanOf("nats", "_INBOX.abc123", "SPAN_KIND_CONSUMER"),
      },
      {
        documented: "$JS.ACK.…",
        fixture: spanOf("nats", "$JS.ACK.ORDERS.billing.1.2.3"),
      },
      {
        documented: "__change_events",
        fixture: spanOf(
          "pulsar",
          "persistent://public/default/__change_events",
        ),
      },
      {
        documented: "__transaction_…",
        fixture: spanOf("pulsar", "__transaction_log_1"),
      },
      {
        documented: "/__",
        fixture: spanOf("pulsar", "persistent://acme/shop/__compaction"),
      },
      {
        documented: "+15555550123",
        fixture: spanOf("aws.sns", "+15555550123"),
      },
      {
        documented: "phone_number:**",
        fixture: {
          attributes: {
            "messaging.system": "aws.sns",
            "messaging.destination": "phone_number:**",
          },
          kind: "SPAN_KIND_PRODUCER",
        },
      },
      {
        documented:
          "arn:aws:sns:us-east-1:123456789012:endpoint/GCM/shop-app/1234",
        fixture: spanOf(
          "aws.sns",
          "arn:aws:sns:us-east-1:123456789012:endpoint/GCM/shop-app/1234",
        ),
      },
      {
        documented: '["orders","payments"]',
        fixture: spanOf("kafka", '["orders","payments"]', "SPAN_KIND_CONSUMER"),
      },
    ];

    it("never makes a queue of what it says it ignores", (): void => {
      const ignored: string = section(readPage(), "### What is ignored");
      const tokens: Array<string> = backtickedTokens(ignored);

      for (const example of IGNORED_EXAMPLES) {
        const resolved: ResolvedMessagingDestination | null =
          "kind" in example.fixture
            ? resolveSpan(example.fixture)
            : resolveDatapoint(example.fixture);

        expect({
          documented: example.documented,
          onPage: tokens.includes(example.documented),
          resolved,
        }).toEqual({
          documented: example.documented,
          onPage: true,
          resolved: null,
        });
      }

      /*
       * And every example the list bullets give is one of those: an example
       * added to the page without a fixture here would never be run.
       */
      const documented: Set<string> = new Set<string>(
        IGNORED_EXAMPLES.map(
          (example: {
            documented: string;
            fixture: SpanFixture | DatapointFixture;
          }): string => {
            return example.documented;
          },
        ),
      );

      for (const lead of [
        "- **Placeholders instrumentations report instead of a name**",
        "- **Generated and reply destinations**",
        "- **SNS text messages and mobile push**",
        "- **Names that cannot be one queue**",
      ]) {
        const bullet: string = lineWith(ignored, lead);

        expect(backtickedTokens(bullet).length).toBeGreaterThan(0);

        for (const token of backtickedTokens(bullet)) {
          expect({ lead, token, run: documented.has(token) }).toEqual({
            lead,
            token,
            run: true,
          });
        }
      }

      // Every temporary flag the resolver reads is named.
      for (const flag of MESSAGING_TEMPORARY_FLAG_ATTRIBUTES) {
        expect(tokens).toContain(flag);
      }

      // SERVER spans, a bare UUID and a control character, which have no token.
      expect(ignored).toContain("**SERVER spans**");
      expect(
        resolveSpan(spanOf("kafka", "orders", "SPAN_KIND_SERVER")),
      ).toBeNull();
      expect(ignored).toContain("a destination that is nothing but a UUID");
      expect(
        resolveSpan(spanOf("kafka", "7f1c2a9e-4b1d-4c3e-9f1a-2b3c4d5e6f70")),
      ).toBeNull();
      expect(ignored).toContain("a name holding a control character");
      expect(resolveSpan(spanOf("kafka", "ord\u0001ers"))).toBeNull();
    });

    it("does not trust messaging.temp_destination, as it says", (): void => {
      const ignored: string = section(readPage(), "### What is ignored");

      expect(ignored).toContain(
        "The older `messaging.temp_destination` is not trusted",
      );
      expect(
        resolveSpan({
          attributes: {
            "messaging.system": "rabbitmq",
            "messaging.destination": "orders",
            "messaging.temp_destination": true,
          },
          kind: "SPAN_KIND_PRODUCER",
        })?.destination,
      ).toBe("orders");
    });

    /*
     * Spring Cloud Stream names a consumer's queue `<destination>.<group>`
     * and, for a consumer without a group, `<destination>.anonymous.<id>`:
     * RabbitExchangeQueueProvisioner.doProvisionConsumerDestination calls
     * groupedName(name, anonymousGroup) with the destination as `name`, and
     * the anonymous group is the prefix "anonymous." plus a 22-character
     * base64url id (Base64UrlNamingStrategy). Only the anonymous queue is
     * generated; a group's queue is a real, shared one.
     */
    it("ignores Spring Cloud Stream's anonymous queues, named after the destination, and keeps its group queues", (): void => {
      expect(
        lineWith(
          section(readPage(), "### What is ignored"),
          "- **Generated and reply destinations**",
        ),
      ).toContain(
        "Spring Cloud Stream's `<destination>.anonymous.<id>` queues of consumers without a group",
      );
      expect(
        resolveSpan(
          spanOf(
            "rabbitmq",
            "orders.anonymous.Kx7yWq2bRZa9cLmN3pQv1A",
            "SPAN_KIND_CONSUMER",
          ),
        ),
      ).toBeNull();
      expect(
        resolveSpan(spanOf("rabbitmq", "orders.billing", "SPAN_KIND_CONSUMER"))
          ?.destination,
      ).toBe("orders.billing");
    });

    it("drops names past the length it states, and templates UUIDs the way it shows", (): void => {
      const ignored: string = section(readPage(), "### What is ignored");

      expect(ignored).toContain(
        `longer than ${MESSAGE_QUEUE_DESTINATION_MAX_LENGTH} characters`,
      );
      expect(
        resolveSpan(
          spanOf("kafka", "a".repeat(MESSAGE_QUEUE_DESTINATION_MAX_LENGTH)),
        )?.destination.length,
      ).toBe(MESSAGE_QUEUE_DESTINATION_MAX_LENGTH);
      expect(
        resolveSpan(
          spanOf("kafka", "a".repeat(MESSAGE_QUEUE_DESTINATION_MAX_LENGTH + 1)),
        ),
      ).toBeNull();

      const example: RegExpMatchArray | null = ignored.match(
        /such as `([^`]+)` become one queue, `([^`]+)`/,
      );

      expect(example).not.toBeNull();
      expect(
        resolveSpan(
          spanOf(
            "rabbitmq",
            (example as RegExpMatchArray)[1] as string,
            "SPAN_KIND_CONSUMER",
          ),
        )?.destination,
      ).toBe((example as RegExpMatchArray)[2]);
    });

    it("lists exactly the messaging client metrics ingest matches to queues", (): void => {
      const clientMetrics: string = section(
        readPage(),
        "### From messaging client metrics",
      );
      const attributeKeys: Set<string> = new Set<string>(
        MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
      );
      const named: Array<string> = backtickedTokens(clientMetrics).filter(
        (token: string): boolean => {
          return token.startsWith("messaging.") && !attributeKeys.has(token);
        },
      );

      expect([...new Set<string>(named)].sort()).toEqual(
        [...MESSAGING_CLIENT_METRIC_NAMES].sort(),
      );

      /*
       * A metric of one's own attaches by its DATAPOINT attributes: ingest
       * stores a resource attribute as `resource.<key>`, which the resolver
       * never reads.
       */
      expect(clientMetrics).toContain(
        "on each datapoint — not on the resource, where they are not read",
      );
      expect(
        resolveDatapoint({
          metricName: "queue.size",
          attributes: {
            "messaging.system": "bullmq",
            "messaging.destination.name": "orders",
          },
        })?.destination,
      ).toBe("orders");
      expect(
        resolveDatapoint({
          metricName: "queue.size",
          attributes: {
            "resource.messaging.system": "bullmq",
            "resource.messaging.destination.name": "orders",
          },
        }),
      ).toBeNull();

      // Each resolves like a span, the Service Bus ones without a system.
      for (const metricName of MESSAGING_CLIENT_METRIC_NAMES) {
        const attributes: Record<string, unknown> = metricName.startsWith(
          "messaging.servicebus.",
        )
          ? { "messaging.destination.name": "orders" }
          : {
              "messaging.system": "kafka",
              "messaging.destination.name": "orders",
            };

        expect({
          metricName,
          destination: resolveDatapoint({ metricName, attributes })
            ?.destination,
        }).toEqual({ metricName, destination: "orders" });
      }
    });

    /*
     * The run reads client metrics as evidence that a queue is in use, not
     * that it exists: they sight a queue that has a row — a traces
     * sighting, which sets Last seen — and the create policy refuses them.
     * A metric of one's own is not read by the run at all: it only
     * attaches, at ingest.
     */
    it("lets client metrics keep a queue's Last seen current but never create one, and a metric of your own do neither", (): void => {
      const clientMetrics: string = section(
        readPage(),
        "### From messaging client metrics",
      );

      expect(clientMetrics).toContain(
        "Messaging client metrics never create a queue",
      );
      expect(clientMetrics).toContain(
        "keeps its **Last seen** current, as its spans do",
      );
      expect(clientMetrics).toContain("A metric of your own does neither");

      // Client evidence alone is refused, whatever its count ...
      const client: DiscoveredMessageQueue = discoveredFromMetric(
        "messaging.client.sent.messages",
        {
          "messaging.system": "kafka",
          "messaging.destination.name": "orders",
        },
      );

      expect(client.clientMetrics).not.toBeNull();
      expect(client.brokerMetrics).toBeNull();
      expect(client.spans).toBeNull();
      expect(
        isMessageQueueAutoCreateCandidate({ discovered: client, minSpans: 1 }),
      ).toBe(false);

      // ... while one curated broker datapoint creates the queue.
      expect(
        isMessageQueueAutoCreateCandidate({
          discovered: discoveredFromMetric("kafka.consumer_group.lag_sum", {
            topic: "orders",
          }),
          minSpans: DEFAULT_MESSAGE_QUEUE_MIN_SPANS,
        }),
      ).toBe(true);

      // An existing queue named by client metrics gets a traces sighting ...
      expect(JOB).toMatch(
        /if \(discovered\.spans \|\| discovered\.clientMetrics\) \{\s*await recordMessageQueueSighting\(\{[^}]*source: "traces",/,
      );
      // ... and every sighting sets Last seen to the time of the run.
      expect(
        fs.readFileSync(
          path.join(
            PACKAGES_DIR,
            "Common/Server/Services/MessageQueueService.ts",
          ),
          "utf8",
        ),
      ).toMatch(
        /public async recordSighting\([\s\S]*?const liveness: PartialEntity<Model> = \{\s*lastSeenAt: now,/,
      );

      // The run reads curated broker and client metric names, nothing else.
      expect([...MESSAGE_QUEUE_DISCOVERY_METRIC_NAMES].sort()).toEqual(
        [
          ...new Set<string>([
            ...MESSAGE_QUEUE_BROKER_METRIC_NAMES,
            ...MESSAGING_CLIENT_METRIC_NAMES,
          ]),
        ].sort(),
      );

      // So the gauge the BullMQ section builds is never read by it.
      const gauge: RegExpMatchArray | null = fencedBlocks(
        systemSection(
          getMessagingSystemDescriptor("bullmq") as MessagingSystemDescriptor,
        ),
      )
        .map((block: FencedBlock): string => {
          return block.body;
        })
        .join("\n")
        .match(/createObservableGauge\("([^"]+)"/);

      expect(gauge).not.toBeNull();
      expect(MESSAGE_QUEUE_DISCOVERY_METRIC_NAMES).not.toContain(
        (gauge as RegExpMatchArray)[1],
      );
    });

    it("attaches a broker metric to a queue by the broker's own attribute, as it says", (): void => {
      const brokerMetrics: string = section(
        readPage(),
        "### From broker metrics",
      );

      for (const [metricName, attributes] of [
        ["kafka.consumer_group.lag_sum", { topic: "orders", group: "billing" }],
        [
          "rabbitmq.message.current",
          { "resource.rabbitmq.queue.name": "orders", state: "ready" },
        ],
        [
          "azure_activemessages_average",
          {
            type: "Microsoft.ServiceBus/Namespaces",
            name: "shop-prod",
            metadata_entityname: "orders",
          },
        ],
        [
          "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
          { "Dimensions.QueueName": "orders" },
        ],
      ] as Array<[string, Record<string, unknown>]>) {
        expect({
          metricName,
          destination: resolveDatapoint({ metricName, attributes })
            ?.destination,
        }).toEqual({ metricName, destination: "orders" });
      }

      for (const key of [
        "topic",
        "rabbitmq.queue.name",
        "EntityName",
        "QueueName",
      ]) {
        expect(brokerMetrics).toContain(`\`${key}\``);
      }

      // Service Bus and Event Hubs share names, told apart by resource type.
      expect(brokerMetrics).toContain(
        "Azure Monitor names Service Bus's and Event Hubs' metrics alike",
      );
      expect(
        resolveDatapoint({
          metricName: "azure_incomingmessages_total",
          attributes: {
            type: "Microsoft.EventHub/Namespaces",
            name: "shop-prod",
            metadata_entityname: "telemetry",
          },
        })?.system,
      ).toBe("eventhubs");
    });

    /*
     * Cloud monitoring APIs publish a number minutes after the time it
     * measures, and it is stored under that time: read over the span
     * window alone, most CloudWatch datapoints would already lie behind the
     * window of the first run after they arrive. The metric query reads
     * those metrics MESSAGE_QUEUE_LATE_METRIC_MINUTES further back, and
     * only those.
     */
    it("reads cloud-monitoring metrics as far back as it says, so a late datapoint still sights or creates its queue", (): void => {
      const windowMinutes: number = Number(
        (
          JOB.match(
            /export const WINDOW_MINUTES: number = (\d+);/,
          ) as RegExpMatchArray
        )[1],
      );
      const paragraph: string = paragraphWith(
        section(readPage(), "### From broker metrics"),
        "minutes after the time it measures",
      );

      // "The last hour": the span window and the late reach before it.
      expect(windowMinutes + MESSAGE_QUEUE_LATE_METRIC_MINUTES).toBe(60);
      expect(paragraph).toContain(
        "each run reads their metrics from the last hour",
      );
      expect(paragraph).toContain(
        `rather than from the last ${windowMinutes} minutes it reads spans and other metrics from`,
      );
      expect(paragraph).toContain(
        "a datapoint that arrives late still sights its queue, or creates it",
      );

      // The query reaches that far back for the late names alone.
      const sql: string = buildMessagingMetricDiscoverySql({
        projectId: "project",
        startSql: "WINDOW_START",
        endSql: "WINDOW_END",
        maxRows: 10,
      });

      expect(sql).toContain(
        `time >= WINDOW_START - INTERVAL ${MESSAGE_QUEUE_LATE_METRIC_MINUTES} MINUTE`,
      );
      expect(sql).toContain(
        `(time >= WINDOW_START OR name IN (${MESSAGE_QUEUE_LATE_METRIC_NAMES.map(
          (name: string): string => {
            return `'${name}'`;
          },
        ).join(", ")}))`,
      );

      /*
       * The late names are exactly the curated metrics of the systems whose
       * broker metrics come from a cloud provider's monitoring API, and the
       * paragraph names each of those APIs.
       */
      const API_BY_RECEIVER: Readonly<Record<string, string>> = {
        aws_cloudwatch: "CloudWatch",
        azure_monitor: "Azure Monitor",
        googlecloudmonitoring: "Cloud Monitoring",
      };
      const cloudMetrics: Array<MessageQueueMetricDescriptor> =
        MESSAGE_QUEUE_METRICS.filter(
          (descriptor: MessageQueueMetricDescriptor): boolean => {
            return (
              getMessagingSystemDescriptor(descriptor.system)?.brokerMetrics
                .kind === "cloud-monitoring"
            );
          },
        );

      expect([...MESSAGE_QUEUE_LATE_METRIC_NAMES].sort()).toEqual(
        [
          ...new Set<string>(
            cloudMetrics.map(
              (descriptor: MessageQueueMetricDescriptor): string => {
                return descriptor.metricName;
              },
            ),
          ),
        ].sort(),
      );

      for (const descriptor of cloudMetrics) {
        const source: MessagingBrokerMetricsSource = (
          getMessagingSystemDescriptor(
            descriptor.system,
          ) as MessagingSystemDescriptor
        ).brokerMetrics;
        const api: string | undefined =
          source.kind === "cloud-monitoring"
            ? API_BY_RECEIVER[source.receiver]
            : undefined;

        expect({
          metric: descriptor.metricName,
          api,
          named: Boolean(api) && paragraph.includes(api as string),
        }).toEqual({ metric: descriptor.metricName, api, named: true });
      }

      // A curated broker datapoint: it creates its queue, late or not.
      const late: DiscoveredMessageQueue = discoveredFromMetric(
        "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
        { "Dimensions.QueueName": "orders" },
      );

      expect(MESSAGE_QUEUE_LATE_METRIC_NAMES).toContain(
        "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
      );
      expect(late.brokerMetrics).not.toBeNull();
      expect(
        isMessageQueueAutoCreateCandidate({
          discovered: late,
          minSpans: DEFAULT_MESSAGE_QUEUE_MIN_SPANS,
        }),
      ).toBe(true);
    });

    it("attaches a JMS broker's own metrics and the BullMQ gauge the way their sections say", (): void => {
      const jms: string = systemSection(
        getMessagingSystemDescriptor("jms") as MessagingSystemDescriptor,
      );

      expect(jms).toContain(
        "send its metrics with `messaging.system` set to `jms` and `messaging.destination.name` set to the queue's name",
      );
      expect(
        identityOf(
          resolveDatapoint({
            metricName: "ibmmq.queue.depth",
            attributes: {
              "messaging.system": "jms",
              "messaging.destination.name": "ORDERS",
            },
          }),
        ),
      ).toEqual(identityOf(resolveSpan(spanOf("jms", "ORDERS"))));

      const bullmq: string = systemSection(
        getMessagingSystemDescriptor("bullmq") as MessagingSystemDescriptor,
      );
      const code: string | undefined = fencedBlocks(bullmq)
        .filter((block: FencedBlock): boolean => {
          return block.info === "ts";
        })
        .map((block: FencedBlock): string => {
          return block.body;
        })[0];
      const gauge: RegExpMatchArray | null = (code || "").match(
        /createObservableGauge\("([^"]+)"/,
      );

      expect(gauge).not.toBeNull();
      expect(code).toContain('"messaging.system": "bullmq"');
      expect(code).toContain('"messaging.destination.name": queue.name');
      expect(
        resolveDatapoint({
          metricName: (gauge as RegExpMatchArray)[1] as string,
          attributes: {
            "messaging.system": "bullmq",
            "messaging.destination.name": "orders",
            state: "waiting",
          },
        }),
      ).toEqual(
        expect.objectContaining({ system: "bullmq", destination: "orders" }),
      );

      // BullMQ's own spans create no queue until the transform adds the keys.
      expect(bullmq).toContain("on its own it creates no queue");
      expect(
        resolveSpan({
          attributes: { "bullmq.queue.name": "orders" },
          kind: "SPAN_KIND_PRODUCER",
        }),
      ).toBeNull();
      expect(
        resolveSpan({
          attributes: {
            "bullmq.queue.name": "orders",
            "messaging.system": "bullmq",
            "messaging.destination.name": "orders",
          },
          kind: "SPAN_KIND_PRODUCER",
        })?.destination,
      ).toBe("orders");
    });
  });

  describe("alerting", (): void => {
    /*
     * The hand-built monitors: each must be a curated GAUGE (a monitor has
     * no rate function, so a counter's raw total would fire once and never
     * clear), filtered on the attributes that name the queue in it, read
     * with the aggregation the queue page reads it with.
     */
    it("builds every example monitor on a curated gauge, by the keys that name its queue", (): void => {
      const alerting: string = section(readPage(), "## Alerting");
      const rows: Array<Array<string>> = tableRows(alerting).filter(
        (cells: Array<string>): boolean => {
          return cells[0] !== "Alert when";
        },
      );

      expect(rows.length).toBeGreaterThanOrEqual(4);

      for (const cells of rows) {
        const metricName: string = firstToken(cells[1] as string);
        const filters: Array<[string, string]> = Array.from(
          (cells[2] as string).matchAll(/`([^`]+)` = `([^`]+)`/g),
        ).map((match: RegExpMatchArray): [string, string] => {
          return [match[1] as string, match[2] as string];
        });
        const descriptor: MessageQueueMetricDescriptor | undefined =
          MESSAGE_QUEUE_METRICS.find(
            (metric: MessageQueueMetricDescriptor): boolean => {
              return metric.metricName === metricName;
            },
          );

        expect({ metricName, curated: Boolean(descriptor) }).toEqual({
          metricName,
          curated: true,
        });
        expect(filters.length).toBeGreaterThan(0);

        const keys: Array<string> = [
          ...(descriptor as MessageQueueMetricDescriptor).destinationAttributes,
          ...((descriptor as MessageQueueMetricDescriptor).scopeAttributes ||
            []),
        ];

        expect({
          metricName,
          kind: (descriptor as MessageQueueMetricDescriptor).kind,
          aggregation: cells[3],
          filterKeys: filters.map((filter: [string, string]): boolean => {
            return keys.includes(filter[0]);
          }),
        }).toEqual({
          metricName,
          kind: "gauge",
          aggregation: (descriptor as MessageQueueMetricDescriptor).aggregation,
          filterKeys: filters.map((): boolean => {
            return true;
          }),
        });

        // The filtered values name one queue of that system.
        const attributes: Record<string, unknown> = {
          ...Object.fromEntries(filters),
          ...((descriptor as MessageQueueMetricDescriptor).requiredAttributes
            ? {
                type: ((descriptor as MessageQueueMetricDescriptor)
                  .requiredAttributes?.["type"] || [])[0],
              }
            : {}),
        };

        expect(resolveDatapoint({ metricName, attributes })?.system).toBe(
          (descriptor as MessageQueueMetricDescriptor).system,
        );
      }

      expect(alerting).toContain("Counters get no monitor");
      expect(alerting).toContain("`cumulative_to_delta`");
    });

    /*
     * What Create monitor covers on a queue's Broker health: every catalog
     * entry of kind "gauge" (MessageQueueBrokerHealthSection renders the
     * link for those and never for a counter) — a level, and a per-period
     * count (aggregation Sum), which the metric tables print as "Gauge" and
     * "Count per period". Its starting threshold is its alert template's
     * (buildMessageQueueMetricMonitorLink seeds it from
     * getMessageQueueAlertTemplateForMetric, and none without one), so the
     * page's promise — a threshold where the signal has a bad direction —
     * and its list of exceptions are held to the templates.
     */
    it("names what Create monitor covers, and the metrics of a bad direction it starts without a threshold", (): void => {
      const paragraph: string = paragraphWith(
        section(readPage(), "## Alerting"),
        "**From the queue's page.**",
      );
      const gauges: Array<MessageQueueMetricDescriptor> =
        MESSAGE_QUEUE_METRICS.filter(
          (metric: MessageQueueMetricDescriptor): boolean => {
            return metric.kind === "gauge";
          },
        );
      const typesOf: (
        metrics: Array<MessageQueueMetricDescriptor>,
      ) => Array<string> = (
        metrics: Array<MessageQueueMetricDescriptor>,
      ): Array<string> => {
        return Array.from(
          new Set<string>(metrics.map(expectedTypeCell)),
        ).sort();
      };

      // Both kinds of gauge get the link, and a monitor can read each one.
      expect(typesOf(gauges)).toEqual(["Count per period", "Gauge"]);
      expect(
        typesOf(
          MESSAGE_QUEUE_METRICS.filter(
            (metric: MessageQueueMetricDescriptor): boolean => {
              return metric.kind !== "gauge";
            },
          ),
        ),
      ).toEqual(["Counter, charted per second"]);
      expect(paragraph).toContain(
        "Each gauge and each count per period in **Broker health** has **Create monitor**",
      );
      expect(paragraph).toContain("Counters get no monitor");

      for (const metric of MESSAGE_QUEUE_METRICS) {
        expect({
          metric: metric.metricName,
          monitorable: isMessageQueueMetricMonitorable(metric),
        }).toEqual({
          metric: metric.metricName,
          monitorable: metric.kind === "gauge",
        });
      }

      // The signals the page calls a bad direction are the thresholdable ones.
      const SIGNAL_WORDS: Readonly<Record<MessageQueueSignal, string>> = {
        backlog: "backlog",
        deadLetter: "dead letters",
        consumerLag: "consumer lag",
        oldestMessageAge: "oldest message age",
        throttled: "throttling",
        errors: "errors",
        published: "published",
        consumed: "consumed",
        consumers: "consumers",
      };
      const listed: RegExpMatchArray | null = paragraph.match(
        /obvious bad direction — ([^.]+)\./,
      );

      expect(listed).not.toBeNull();
      expect(
        (listed as RegExpMatchArray)[1]!
          .split(/, | or /)
          .map((word: string): string => {
            return word.trim();
          })
          .sort(),
      ).toEqual(
        MESSAGE_QUEUE_THRESHOLDABLE_SIGNALS.map(
          (signal: MessageQueueSignal): string => {
            return SIGNAL_WORDS[signal];
          },
        ).sort(),
      );

      /*
       * The exceptions: every gauge of such a signal without a template —
       * exactly the deliberate UNTEMPLATED_MESSAGE_QUEUE_GAUGES — each
       * named, and nothing else named. A gauge of any other signal has no
       * template either.
       */
      const exceptions: Array<string> = gauges
        .filter((metric: MessageQueueMetricDescriptor): boolean => {
          return (
            MESSAGE_QUEUE_THRESHOLDABLE_SIGNALS.includes(metric.signal) &&
            !getMessageQueueAlertTemplateForMetric(metric)
          );
        })
        .map((metric: MessageQueueMetricDescriptor): string => {
          return metric.metricName;
        })
        .sort();

      expect(exceptions).toEqual(
        UNTEMPLATED_MESSAGE_QUEUE_GAUGES.map(
          (gauge: { metricName: string }): string => {
            return gauge.metricName;
          },
        ).sort(),
      );

      const sentence: string =
        paragraph
          .split(/(?<=\.)\s+(?=[A-Z*])/)
          .find((text: string): boolean => {
            return text.includes("start without one");
          }) || "";
      const NUMBER_WORDS: ReadonlyArray<string> = [
        "None",
        "One",
        "Two",
        "Three",
        "Four",
        "Five",
        "Six",
      ];

      expect(sentence).toContain(
        `${NUMBER_WORDS[exceptions.length]} of those start without one`,
      );
      expect(
        Array.from(sentence.matchAll(/`([^`]+)`/g))
          .map((match: RegExpMatchArray): string => {
            return match[1] as string;
          })
          .filter((token: string): boolean => {
            return MESSAGE_QUEUE_BROKER_METRIC_NAMES.has(token);
          })
          .sort(),
      ).toEqual(exceptions);

      for (const metric of gauges) {
        if (!MESSAGE_QUEUE_THRESHOLDABLE_SIGNALS.includes(metric.signal)) {
          expect({
            metric: metric.metricName,
            template: Boolean(getMessageQueueAlertTemplateForMetric(metric)),
          }).toEqual({ metric: metric.metricName, template: false });
        }
      }
    });

    /*
     * A RabbitMQ queue's depth is a series total: the queue page's Create
     * monitor link builds its monitor with
     * buildMessageQueueMetricMonitorViewConfig under the link's variable
     * (MESSAGE_QUEUE_METRIC_MONITOR_VARIABLE), puts the starting threshold
     * on the formula, and Monitor Create turns it into a criteria on the
     * formula's alias (MessageQueueMonitorLinkMonitorCreate.test renders
     * that). The page names the aliases the link really builds.
     */
    it("names the queries, the formula and the alias Create monitor builds for a RabbitMQ queue's depth", (): void => {
      const paragraph: string = paragraphWith(
        section(readPage(), "## Alerting"),
        "arrives as two series",
      );
      const link: string = fs.readFileSync(
        path.join(
          PACKAGES_DIR,
          "App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueMetricMonitorLink.ts",
        ),
        "utf8",
      );
      const variable: string | undefined = (
        link.match(
          /export const MESSAGE_QUEUE_METRIC_MONITOR_VARIABLE: string = "([^"]+)";/,
        ) as RegExpMatchArray | null
      )?.[1];

      expect(variable).toBeDefined();

      const depth: MessageQueueMetricDescriptor =
        getMessageQueueMetricsForSystem("rabbitmq").find(
          (descriptor: MessageQueueMetricDescriptor): boolean => {
            return descriptor.metricName === "rabbitmq.message.current";
          },
        ) as MessageQueueMetricDescriptor;
      const query: MessageQueueMetricMonitorQuery | null =
        buildMessageQueueMetricMonitorQuery({
          descriptor: depth,
          observedSeries: [{ "resource.rabbitmq.queue.name": "orders" }],
          identity: toMessageQueueIdentity({
            system: "rabbitmq",
            brokerScope: "",
            destination: "orders",
          }),
        });

      expect(query).not.toBeNull();

      const view: MessageQueueMetricMonitorViewConfig =
        buildMessageQueueMetricMonitorViewConfig({
          query: query as MessageQueueMetricMonitorQuery,
          metricVariable: variable as string,
          title: "orders: Queue depth",
        });
      const formulas: Array<MetricFormulaConfigData> =
        view.metricViewConfig.formulaConfigs;

      expect(formulas).toHaveLength(1);

      // The two series it names are the ones the formula adds up ...
      const total: MessageQueueSeriesTotal = (
        query as MessageQueueMetricMonitorQuery
      ).seriesTotal as MessageQueueSeriesTotal;

      expect(total.values.length).toBe(2);

      for (const value of total.values) {
        expect(paragraph).toContain(`\`${total.key}\` = \`${value}\``);
      }

      // ... one query per state, then the formula, as the link builds them ...
      expectInOrder(paragraph, [
        ...view.metricViewConfig.queryConfigs.map(
          (config: MetricQueryConfigData): string => {
            return config.metricAliasData?.metricVariable || "";
          },
        ),
        (formulas[0] as MetricFormulaConfigData).metricFormulaData
          .metricFormula,
      ]);

      // ... and the threshold on the formula's alias, the one criteria compare.
      expect(view.criteriaAlias).toBe(
        (formulas[0] as MetricFormulaConfigData).metricAliasData.metricVariable,
      );
      expect(paragraph).toContain(
        `whose alias \`${view.criteriaAlias}\` its starting threshold applies to`,
      );
    });

    /*
     * The catalog counters that do NOT reach the collector as monotonic
     * sums. `cumulative_to_delta` converts only monotonic sums and
     * (exponential) histograms (processor/cumulativetodeltaprocessor
     * processor.go @v0.161.0) and passes gauges through unchanged:
     * kafka_metrics declares both offsets as gauges (metadata.yaml
     * @v0.161.0), and Pulsar declares `# TYPE pulsar_in_messages_total
     * gauge` (and out), which the prometheus receiver keeps as gauges. The
     * other catalog counters are monotonic cumulative sums: the rabbitmq
     * receiver's, the JMX Scraper's ActiveMQ counters and RocketMQ's
     * Prometheus counters.
     */
    const COUNTERS_REPORTED_AS_GAUGES: ReadonlyArray<string> = [
      "kafka.consumer_group.offset_sum",
      "kafka.partition.current_offset",
      "pulsar_in_messages_total",
      "pulsar_out_messages_total",
    ];

    it("offers cumulative_to_delta only for the counters that reach the collector as sums", (): void => {
      const paragraph: string = paragraphWith(
        section(readPage(), "## Alerting"),
        "**Counters.**",
      );
      const sentences: Array<string> = paragraph.split(/(?<=\.)\s+(?=[A-Z])/);
      const sums: string =
        sentences.find((sentence: string): boolean => {
          return sentence.includes("reach the collector as cumulative sums");
        }) || "";
      const gauges: string =
        sentences.find((sentence: string): boolean => {
          return sentence.includes("arrive as gauges");
        }) || "";
      const counters: Array<MessageQueueMetricDescriptor> =
        MESSAGE_QUEUE_METRICS.filter(
          (metric: MessageQueueMetricDescriptor): boolean => {
            return metric.kind === "counter";
          },
        );

      expect(sums).toContain(
        "`cumulative_to_delta` processor (`cumulativetodelta` in older collectors)",
      );
      expect(gauges).toContain("`cumulative_to_delta` leaves alone");

      // The list above names catalog counters only, so it cannot go stale.
      for (const metricName of COUNTERS_REPORTED_AS_GAUGES) {
        expect({
          metricName,
          counter: counters.some(
            (metric: MessageQueueMetricDescriptor): boolean => {
              return metric.metricName === metricName;
            },
          ),
        }).toEqual({ metricName, counter: true });
      }

      /*
       * A convertible counter's system is named where the processor is
       * offered; a gauge-typed one is named where the page says the
       * processor leaves it alone — and its system is not offered it.
       */
      for (const metric of counters) {
        const reportedAsGauge: boolean = COUNTERS_REPORTED_AS_GAUGES.includes(
          metric.metricName,
        );

        expect({
          metric: metric.metricName,
          systemOfferedDeltas: sums.includes(
            getMessagingSystemDisplayName(metric.system),
          ),
          namedAsGauge: gauges.includes(`\`${metric.metricName}\``),
        }).toEqual({
          metric: metric.metricName,
          systemOfferedDeltas: !reportedAsGauge,
          namedAsGauge: reportedAsGauge,
        });
      }
    });

    /*
     * Alerting's counter copy. The queue page reads every catalog counter
     * as a running total, whatever temporality it was stored with: the Max
     * of each series per interval, differenced into a per-second rate
     * (getMessageQueueMetricReadPlan's "rate" mode, then
     * counterResultToRatePerSecond) under Broker health, on the Metrics tab
     * and in its chart. A counter the collector turned into deltas in place
     * charts the change between successive deltas there: 0 for steady
     * traffic. So the page converts a COPY under a name of its own, and the
     * counter the queue page charts reaches OneUptime unchanged. The config
     * is the RabbitMQ section's with the two processors added; `otelcol
     * validate` of 0.161.0 passes it as printed, and a live run of it
     * against RabbitMQ 4 kept `rabbitmq.message.published` a cumulative sum
     * while its copy arrived as deltas adding up to the original's growth.
     */
    it("converts a copy of a counter for alerting, never a counter the queue page charts", (): void => {
      const alerting: string = section(readPage(), "## Alerting");
      const counters: Array<MessageQueueMetricDescriptor> =
        MESSAGE_QUEUE_METRICS.filter(
          (metric: MessageQueueMetricDescriptor): boolean => {
            return metric.kind === "counter";
          },
        );

      // Why: the page reads each counter as a running total ...
      for (const counter of counters) {
        const plan: MessageQueueMetricReadPlan =
          getMessageQueueMetricReadPlan(counter);

        expect({
          metric: counter.metricName,
          mode: plan.mode,
          aggregation: plan.aggregationType,
        }).toEqual({
          metric: counter.metricName,
          mode: "rate",
          aggregation: AggregationType.Max,
        });
      }

      /*
       * ... so 10 messages a second as deltas (a minute's Max of 30-second
       * deltas) reads 0, where the running total reads 10.
       */
      const start: number = Date.UTC(2026, 0, 1, 12, 0, 0);
      const ratesOf: (values: Array<number>) => Array<number> = (
        values: Array<number>,
      ): Array<number> => {
        const result: AggregatedResult = {
          data: values.map((value: number, index: number): AggregatedModel => {
            return {
              timestamp: new Date(start + index * 60 * 1000),
              value: value,
              attributes: { "resource.rabbitmq.queue.name": "orders" },
            };
          }),
        };

        return counterResultToRatePerSecond(result).map(
          (point: { y: number }): number => {
            return point.y;
          },
        );
      };

      expect(ratesOf([0, 600, 1200, 1800, 2400])).toEqual([10, 10, 10, 10]);
      expect(ratesOf([300, 300, 300, 300, 300])).toEqual([0, 0, 0, 0]);

      const counterParagraph: string = paragraphWith(alerting, "**Counters.**");

      expect(counterParagraph).toContain(
        "Convert a copy under a name of its own, never the counter itself",
      );
      expect(counterParagraph).toContain(
        "steady traffic reads as 0 messages per second",
      );

      // How: the RabbitMQ section's config, with a copy made and converted.
      const own: YamlMap = parseYaml(
        yamlBlocks(
          systemSection(
            getMessagingSystemDescriptor(
              "rabbitmq",
            ) as MessagingSystemDescriptor,
          ),
        )[0] as string,
      );
      const config: YamlMap = parseYaml(yamlBlocks(alerting)[0] as string);
      const metricsPipeline: (of: YamlMap) => YamlMap = (
        of: YamlMap,
      ): YamlMap => {
        return ((of["service"] as YamlMap)["pipelines"] as YamlMap)[
          "metrics"
        ] as YamlMap;
      };
      const ownPipeline: YamlMap = metricsPipeline(own);
      const pipeline: YamlMap = metricsPipeline(config);

      expect(config["receivers"]).toEqual(own["receivers"]);
      expect(config["exporters"]).toEqual(own["exporters"]);
      expect(
        Object.keys((config["service"] as YamlMap)["pipelines"] as YamlMap),
      ).toEqual(
        Object.keys((own["service"] as YamlMap)["pipelines"] as YamlMap),
      );
      expect(pipeline["receivers"]).toEqual(ownPipeline["receivers"]);
      expect(pipeline["exporters"]).toEqual(ownPipeline["exporters"]);

      // The section's own processors stay, unchanged and last ...
      const ownProcessors: Array<string> = ownPipeline[
        "processors"
      ] as Array<string>;
      const processors: Array<string> = pipeline["processors"] as Array<string>;

      expect(processors.slice(-ownProcessors.length)).toEqual(ownProcessors);

      for (const id of ownProcessors) {
        expect((config["processors"] as YamlMap)[id]).toEqual(
          (own["processors"] as YamlMap)[id],
        );
      }

      // ... after the copy, then its conversion.
      const added: Array<string> = processors.slice(
        0,
        processors.length - ownProcessors.length,
      );

      expect(added.map(componentType)).toEqual([
        "transform",
        "cumulative_to_delta",
      ]);

      const copies: Map<string, string> = new Map<string, string>();

      for (const statement of (
        (config["processors"] as YamlMap)[added[0] as string] as YamlMap
      )["metric_statements"] as Array<string>) {
        const match: RegExpMatchArray | null = statement.match(
          /^copy_metric\(name="([^"]+)"\) where metric\.name == "([^"]+)"$/,
        );

        expect({ statement, copies: Boolean(match) }).toEqual({
          statement,
          copies: true,
        });
        copies.set(
          (match as RegExpMatchArray)[1] as string,
          (match as RegExpMatchArray)[2] as string,
        );
      }

      expect(copies.size).toBeGreaterThan(0);

      for (const [copy, original] of Array.from(copies.entries())) {
        const counter: MessageQueueMetricDescriptor | undefined = counters.find(
          (metric: MessageQueueMetricDescriptor): boolean => {
            return (
              metric.system === "rabbitmq" && metric.metricName === original
            );
          },
        );

        // A RabbitMQ counter the processor converts ...
        expect({ original, counter: Boolean(counter) }).toEqual({
          original,
          counter: true,
        });
        expect(COUNTERS_REPORTED_AS_GAUGES).not.toContain(original);

        // ... copied under a name nothing on the queue page reads ...
        expect({
          copy,
          curated: MESSAGE_QUEUE_BROKER_METRIC_NAMES.has(copy.toLowerCase()),
          client: MESSAGING_CLIENT_METRIC_NAMES.has(copy.toLowerCase()),
        }).toEqual({ copy, curated: false, client: false });

        // ... and alerted on by the key that names the queue in it.
        expect(paragraphWith(alerting, `Each point of \`${copy}\``)).toContain(
          `filtered on \`${(counter as MessageQueueMetricDescriptor).destinationAttributes[0]}\` and summed over its window`,
        );
      }

      // Only the copies are converted, by their exact names.
      const conversion: YamlMap = (config["processors"] as YamlMap)[
        added[1] as string
      ] as YamlMap;

      expect(conversion["exclude"]).toBeUndefined();
      expect((conversion["include"] as YamlMap)["match_type"]).toBe("strict");
      expect(
        [
          ...((conversion["include"] as YamlMap)["metrics"] as Array<string>),
        ].sort(),
      ).toEqual(Array.from(copies.keys()).sort());
    });

    /*
     * A converted counter's first point. `cumulative_to_delta` has nothing
     * to subtract a series' first point from, and `initial_value` says what
     * it does with it (processor/cumulativetodeltaprocessor
     * internal/tracking/tracker.go @v0.161.0). The default, `auto`, drops
     * it only when the point's start time is older than the processor, and
     * the `rabbitmq` receiver stamps its points with the time the receiver
     * was built (NewMetricsBuilder in newScraper, rabbitmqreceiver
     * scraper.go @v0.161.0), which the collector does after it builds its
     * processors. So after every collector start `auto` sends each queue's
     * first point as it is — the counter's whole running total, which a Sum
     * over the monitor's window reads as that many messages in one scrape.
     * `drop` keeps it back. A live run of the page's config on 0.161.0
     * (exporter swapped for a file) against RabbitMQ 4, with 50 messages
     * published to the queue before the collector started and 7 during the
     * run: without `initial_value` the copy's points were 50, 0, 7, 0; with
     * `drop` they were 0, 7, 0; `rabbitmq.message.published` stayed a
     * cumulative sum in both. `otelcol validate` passes the config with
     * `drop` (RABBITMQ_USERNAME and RABBITMQ_PASSWORD set, as every
     * RabbitMQ config on the page needs) and refuses an unknown value.
     */
    it("keeps back a converted counter's first point, which is the counter's whole running total", (): void => {
      const page: string = readPage();
      const conversions: Array<{ id: string; initialValue: unknown }> =
        yamlBlocks(page).flatMap(
          (body: string): Array<{ id: string; initialValue: unknown }> => {
            const processors: unknown = parseYaml(body)["processors"];

            if (!isMapping(processors)) {
              return [];
            }

            return Object.keys(processors)
              .filter((id: string): boolean => {
                // The current type and its deprecated alias.
                return ["cumulative_to_delta", "cumulativetodelta"].includes(
                  componentType(id),
                );
              })
              .map((id: string): { id: string; initialValue: unknown } => {
                const processor: unknown = processors[id];

                return {
                  id,
                  initialValue: isMapping(processor)
                    ? processor["initial_value"]
                    : undefined,
                };
              });
          },
        );

      // Every conversion on the page, the counter copy's included ...
      expect(conversions.length).toBeGreaterThan(0);

      for (const conversion of conversions) {
        expect(conversion).toEqual({
          id: conversion.id,
          initialValue: "drop",
        });
      }

      // ... and the page says why, where it explains the copy's points.
      const paragraph: string = paragraphWith(
        section(page, "## Alerting"),
        "`initial_value: drop`",
      );

      expect(paragraph).toContain("Each point of `");
      expect(paragraph).toContain(
        "by default it sends that point as it is: the counter's whole running total",
      );
      expect(paragraph).toContain(
        "`initial_value: drop` keeps that point back, so a queue's copy starts with the second scrape that reports its counter",
      );
    });

    /*
     * How late the `aws_cloudwatch` receiver's points arrive. It asks
     * CloudWatch, once per `collection_interval`, for the whole periods
     * that ended by now - `delay`, each point stamped with its period's
     * start (receiver/awscloudwatchreceiver metrics.go @v0.161.0): right
     * after a scrape the newest point is delay + period old, just before
     * the next one delay + 2 × period + collection_interval. The page says
     * so for its own configuration and for the receiver's default period
     * (config.go @v0.161.0: period 5m, delay 10m, collection_interval 5m),
     * and the window Create monitor starts such a monitor at
     * (MESSAGE_QUEUE_SOURCE_WINDOW_FLOORS) states the same lateness and
     * outlasts both.
     */
    it("states how late CloudWatch's metrics arrive with the page's configuration, as Create monitor's window assumes", (): void => {
      const page: string = readPage();
      const minutesOf: (value: unknown) => number = (
        value: unknown,
      ): number => {
        const match: RegExpMatchArray | null =
          String(value).match(/^(\d+)(s|m)$/);

        expect({ value, duration: Boolean(match) }).toEqual({
          value,
          duration: true,
        });

        const amount: number = Number((match as RegExpMatchArray)[1]);

        return (match as RegExpMatchArray)[2] === "m" ? amount : amount / 60;
      };

      // Every aws_cloudwatch receiver on the page polls the same way.
      const settings: Array<{
        period: number;
        delay: number;
        interval: number;
      }> = yamlBlocks(page)
        .flatMap((body: string): Array<{ id: string; config: YamlMap }> => {
          return receiverConfigs(parseYaml(body), "aws_cloudwatch");
        })
        .map(
          (receiver: {
            id: string;
            config: YamlMap;
          }): { period: number; delay: number; interval: number } => {
            const metrics: YamlMap = receiver.config["metrics"] as YamlMap;

            return {
              period: minutesOf(metrics["period"]),
              delay: minutesOf(metrics["delay"]),
              interval: minutesOf(metrics["collection_interval"]),
            };
          },
        );

      expect(settings.length).toBeGreaterThanOrEqual(2);

      for (const setting of settings) {
        expect(setting).toEqual(settings[0]);
      }

      const { period, delay, interval } = settings[0] as {
        period: number;
        delay: number;
        interval: number;
      };
      const newest: number = delay + period;
      const oldest: number = delay + 2 * period + interval;
      const oldestWithDefaultPeriod: number = delay + 2 * 5 + interval;
      const late: string = `${newest} to ${oldest} minutes late`;

      // The SQS setup, Late metrics and troubleshooting all say it.
      const sqs: string = systemSection(
        getMessagingSystemDescriptor("aws_sqs") as MessagingSystemDescriptor,
      );
      const lateMetrics: string = paragraphWith(
        section(page, "## Alerting"),
        "**Late metrics.**",
      );

      expect(lineWith(sqs, "`delay` waits for CloudWatch")).toContain(
        `so with this configuration a queue's broker metrics arrive ${late}`,
      );
      expect(lateMetrics).toContain(
        `the \`aws_cloudwatch\` receiver's newest point is ${newest} to ${oldest} minutes old with the configuration on this page, and up to ${oldestWithDefaultPeriod} with the receiver's default five-minute \`period\``,
      );
      expect(
        lineWith(section(page, "## Troubleshooting"), "It is late."),
      ).toContain(
        `waits \`delay\` (${delay} minutes) for CloudWatch to publish, so its points arrive ${late}`,
      );
      expect(page).not.toContain("about 10 minutes behind");

      // Create monitor's windows: the lateness the code states, outlasted.
      const windowMinutes: (receiver: string) => {
        floor: MessageQueueSourceWindowFloor;
        minutes: number;
      } = (
        receiver: string,
      ): { floor: MessageQueueSourceWindowFloor; minutes: number } => {
        const floor: MessageQueueSourceWindowFloor | undefined =
          MESSAGE_QUEUE_SOURCE_WINDOW_FLOORS.find(
            (candidate: MessageQueueSourceWindowFloor): boolean => {
              return candidate.receiver === receiver;
            },
          );

        expect({ receiver, floor: Boolean(floor) }).toEqual({
          receiver,
          floor: true,
        });

        const window: InBetween<Date> =
          RollingTimeUtil.convertToStartAndEndDate(
            (floor as MessageQueueSourceWindowFloor).minimumRollingTime,
          );

        return {
          floor: floor as MessageQueueSourceWindowFloor,
          minutes: Math.round(
            (window.endValue.getTime() - window.startValue.getTime()) /
              (60 * 1000),
          ),
        };
      };
      const cloudWatch: {
        floor: MessageQueueSourceWindowFloor;
        minutes: number;
      } = windowMinutes("aws_cloudwatch");
      const pubSub: { floor: MessageQueueSourceWindowFloor; minutes: number } =
        windowMinutes("googlecloudmonitoring");

      expect(cloudWatch.floor.reason).toContain(late);
      expect(cloudWatch.floor.reason).toContain(
        `up to ${oldestWithDefaultPeriod} minutes late`,
      );
      expect(cloudWatch.minutes).toBeGreaterThan(oldestWithDefaultPeriod);
      expect(lateMetrics).toContain(
        `**Create monitor** starts those monitors at ${cloudWatch.minutes} and ${pubSub.minutes} minutes`,
      );
    });
  });

  describe("limitations", (): void => {
    function limitations(): string {
      return section(readPage(), "## Limitations");
    }

    it("states every limitation of the product's identity rules", (): void => {
      for (const lead of [
        "**Same-named destinations on two clusters or accounts are one queue.**",
        "**Kafka clients on Event Hubs are Kafka.**",
        "**Service Bus spans without a namespace host key apart.**",
        "**RabbitMQ spans usually name exchanges; the broker's metrics name queues.**",
        "**Pub/Sub publishers name topics; subscribers name subscriptions.**",
        "**Pulsar's per-consumer series are left out of charts**",
        "**Azure Storage Queues have no per-queue metrics.**",
        "**RocketMQ's retry and system topics are not filtered out of broker metrics.**",
      ]) {
        expect(limitations()).toContain(lead);
      }
    });

    it("merges same-named Kafka topics of two clusters, as it says", (): void => {
      expect(
        identityOf(
          resolveSpan(
            spanOf("kafka", "orders", "SPAN_KIND_PRODUCER", {
              "server.address": "kafka.eu.example.com",
            }),
          ),
        ),
      ).toEqual(
        identityOf(
          resolveSpan(
            spanOf("kafka", "orders", "SPAN_KIND_PRODUCER", {
              "server.address": "kafka.us.example.com",
            }),
          ),
        ),
      );
    });

    it("keeps a Kafka client on Event Hubs apart from the event hub", (): void => {
      expect(
        identityOf(
          resolveSpan(
            spanOf("kafka", "telemetry", "SPAN_KIND_PRODUCER", {
              "server.address": "shop-prod.servicebus.windows.net",
              "server.port": 9093,
            }),
          ),
        ),
      ).not.toEqual(
        identityOf(
          resolveSpan(
            spanOf("eventhubs", "telemetry", "SPAN_KIND_PRODUCER", {
              "server.address": "shop-prod.servicebus.windows.net",
            }),
          ),
        ),
      );
    });

    it("keys a Service Bus span without a namespace host apart from Azure Monitor's metrics", (): void => {
      const metric: MessageQueueIdentity | null = identityOf(
        resolveDatapoint({
          metricName: "azure_activemessages_average",
          attributes: {
            type: "Microsoft.ServiceBus/Namespaces",
            name: "shop-prod",
            metadata_entityname: "orders",
          },
        }),
      );

      expect(
        identityOf(
          resolveSpan(
            spanOf("servicebus", "orders", "SPAN_KIND_PRODUCER", {
              "server.address": "shop-prod.servicebus.windows.net",
            }),
          ),
        ),
      ).toEqual(metric);
      // The emulator, and a custom domain.
      for (const host of ["localhost", "bus.shop.example.com"]) {
        expect(
          identityOf(
            resolveSpan(
              spanOf("servicebus", "orders", "SPAN_KIND_PRODUCER", {
                "server.address": host,
              }),
            ),
          ),
        ).not.toEqual(metric);
      }
    });

    /*
     * The Overview's advice for a queue added by hand: the namespace may be
     * left empty, which keys the queue where emulator and custom-domain
     * spans land, and where no Azure Monitor datapoint does — those always
     * name their namespace.
     */
    it("lets a hand-made Service Bus or Event Hubs queue leave its namespace empty only for what Azure Monitor never reaches", (): void => {
      const byHand: string = paragraphWith(
        section(readPage(), "## Overview"),
        "**Queues → Create Queue**",
      );

      expect(byHand).toContain(
        "Leave the namespace empty only for a queue your applications reach through an emulator or a custom domain name",
      );
      expect(byHand).toContain(
        "Azure Monitor's metrics never reach such a queue",
      );

      const AZURE_MONITOR_DATAPOINTS: Readonly<
        Record<string, DatapointFixture>
      > = {
        servicebus: {
          metricName: "azure_activemessages_average",
          attributes: {
            type: "Microsoft.ServiceBus/Namespaces",
            name: "shop-prod",
            metadata_entityname: "orders",
          },
        },
        eventhubs: {
          metricName: "azure_incomingmessages_total",
          attributes: {
            type: "Microsoft.EventHub/Namespaces",
            name: "shop-prod",
            metadata_entityname: "orders",
          },
        },
      };
      const namespaced: Array<MessagingSystemDescriptor> =
        MESSAGING_SYSTEMS.filter(
          (descriptor: MessagingSystemDescriptor): boolean => {
            return descriptor.brokerScope === "azure-namespace";
          },
        );

      expect(
        namespaced
          .map((descriptor: MessagingSystemDescriptor): string => {
            return descriptor.system;
          })
          .sort(),
      ).toEqual(Object.keys(AZURE_MONITOR_DATAPOINTS).sort());

      for (const descriptor of namespaced) {
        // An empty namespace is accepted, as "no namespace".
        expect(canonicalizeMessageQueueBrokerScope(descriptor.system, "")).toBe(
          "",
        );

        const byHandIdentity: MessageQueueIdentity | null =
          toMessageQueueIdentity({
            system: descriptor.system,
            brokerScope: "",
            destination: "orders",
          });

        expect(byHandIdentity).not.toBeNull();

        // Where the emulator's and a custom domain's spans land ...
        for (const host of ["localhost", "bus.shop.example.com"]) {
          expect(
            identityOf(
              resolveSpan(
                spanOf(descriptor.system, "orders", "SPAN_KIND_PRODUCER", {
                  "server.address": host,
                }),
              ),
            ),
          ).toEqual(byHandIdentity);
        }

        // ... and never Azure Monitor's metrics, which name their namespace.
        const monitored: MessageQueueIdentity | null = identityOf(
          resolveDatapoint(
            AZURE_MONITOR_DATAPOINTS[descriptor.system] as DatapointFixture,
          ),
        );

        expect(monitored?.system).toBe(byHandIdentity?.system);
        expect(monitored?.brokerScope).toBe("shop-prod");
        expect(monitored).not.toEqual(byHandIdentity);
      }
    });

    /*
     * One message, published to the exchange `shop` with the routing key
     * `new-order` and delivered from the queue `orders` bound to it, as each
     * instrumentation the limitation names reports it — attribute sets from
     * their sources: the Java agent's rabbitmq-2.7 getters (default mode),
     * amqplib's utils.ts, pika's utils.py and aio-pika's span_builder.py
     * (`exchange or routing_key` on both sides), RabbitMQActivitySource.cs
     * (.NET v7). Every one names the exchange, publishing and consuming.
     */
    const RABBITMQ_EXCHANGE_NAMED_SPANS: ReadonlyArray<{
      instrumentation: string;
      fixture: SpanFixture;
    }> = [
      {
        instrumentation: "Java agent (default) publish",
        fixture: spanOf("rabbitmq", "shop", "SPAN_KIND_PRODUCER", {
          "messaging.rabbitmq.destination.routing_key": "new-order",
          "messaging.operation": "publish",
          "network.peer.address": "10.0.0.7",
          "network.peer.port": 5672,
        }),
      },
      {
        instrumentation: "Java agent (default) process",
        fixture: spanOf("rabbitmq", "shop", "SPAN_KIND_CONSUMER", {
          "messaging.rabbitmq.destination.routing_key": "new-order",
          "messaging.operation": "process",
        }),
      },
      {
        instrumentation: "amqplib publish",
        fixture: {
          attributes: {
            "messaging.system": "rabbitmq",
            "messaging.destination": "shop",
            "messaging.destination_kind": "topic",
            "messaging.rabbitmq.routing_key": "new-order",
            "messaging.protocol": "AMQP",
          },
          kind: "SPAN_KIND_PRODUCER",
        },
      },
      {
        instrumentation: "amqplib consume",
        fixture: {
          attributes: {
            "messaging.system": "rabbitmq",
            "messaging.destination": "shop",
            "messaging.rabbitmq.routing_key": "new-order",
            "messaging.operation": "process",
          },
          kind: "SPAN_KIND_CONSUMER",
        },
      },
      {
        instrumentation: "pika publish",
        fixture: {
          attributes: {
            "messaging.system": "rabbitmq",
            "messaging.destination": "shop",
            "messaging.temp_destination": true,
            "net.peer.name": "rabbit.prod",
          },
          kind: "SPAN_KIND_PRODUCER",
        },
      },
      {
        instrumentation: "pika consume",
        fixture: {
          attributes: {
            "messaging.system": "rabbitmq",
            "messaging.destination": "shop",
            "messaging.operation": "receive",
          },
          kind: "SPAN_KIND_CONSUMER",
        },
      },
      {
        instrumentation: "aio-pika publish",
        fixture: {
          attributes: {
            "messaging.system": "rabbitmq",
            "messaging.destination": "shop,new-order",
            "messaging.temp_destination": true,
          },
          kind: "SPAN_KIND_PRODUCER",
        },
      },
      {
        instrumentation: "aio-pika consume",
        fixture: {
          attributes: {
            "messaging.system": "rabbitmq",
            "messaging.destination": "shop",
            "messaging.operation": "receive",
            "net.peer.name": "rabbit.prod",
            "net.peer.port": 5672,
          },
          kind: "SPAN_KIND_CONSUMER",
        },
      },
      {
        instrumentation: ".NET RabbitMQ.Client v7 publish",
        fixture: spanOf("rabbitmq", "shop", "SPAN_KIND_PRODUCER", {
          "messaging.rabbitmq.destination.routing_key": "new-order",
          "messaging.operation.type": "send",
          "network.protocol.name": "amqp",
        }),
      },
      {
        instrumentation: ".NET RabbitMQ.Client v7 deliver",
        fixture: spanOf("rabbitmq", "shop", "SPAN_KIND_CONSUMER", {
          "messaging.rabbitmq.destination.routing_key": "new-order",
          "messaging.operation.type": "process",
          "messaging.operation.name": "deliver",
          "network.protocol.name": "amqp",
        }),
      },
    ];

    it("keys RabbitMQ spans on the exchange and the broker's metrics on the queue, as it says", (): void => {
      const bullet: string = lineWith(
        limitations(),
        "**RabbitMQ spans usually name exchanges; the broker's metrics name queues.**",
      );
      const exchange: MessageQueueIdentity | null = toMessageQueueIdentity({
        system: "rabbitmq",
        destination: "shop",
      });
      // The rabbitmq receiver's queue depth, one resource per queue.
      const metric: MessageQueueIdentity | null = identityOf(
        resolveDatapoint({
          metricName: "rabbitmq.message.current",
          attributes: {
            "resource.rabbitmq.queue.name": "orders",
            "resource.rabbitmq.vhost.name": "/",
            state: "ready",
          },
        }),
      );

      expect(metric).toEqual(
        toMessageQueueIdentity({ system: "rabbitmq", destination: "orders" }),
      );

      for (const span of RABBITMQ_EXCHANGE_NAMED_SPANS) {
        expect({
          instrumentation: span.instrumentation,
          identity: identityOf(resolveSpan(span.fixture)),
        }).toEqual({
          instrumentation: span.instrumentation,
          identity: exchange,
        });
      }

      // Where spans and metrics meet: default-exchange deliveries, and the Java agent's opt-in consumer names.
      const meeting: Array<{ instrumentation: string; fixture: SpanFixture }> =
        [
          {
            instrumentation: "Java agent (default), default exchange",
            fixture: spanOf("rabbitmq", "<default>", "SPAN_KIND_CONSUMER", {
              "messaging.rabbitmq.destination.routing_key": "orders",
              "messaging.operation": "process",
            }),
          },
          {
            // amqplib: an empty exchange, absent once stored.
            instrumentation: "amqplib, default exchange",
            fixture: {
              attributes: {
                "messaging.system": "rabbitmq",
                "messaging.rabbitmq.routing_key": "orders",
                "messaging.operation": "process",
              },
              kind: "SPAN_KIND_CONSUMER",
            },
          },
          {
            instrumentation: "pika, default exchange (the routing key)",
            fixture: {
              attributes: {
                "messaging.system": "rabbitmq",
                "messaging.destination": "orders",
                "messaging.operation": "receive",
              },
              kind: "SPAN_KIND_CONSUMER",
            },
          },
          {
            instrumentation: ".NET RabbitMQ.Client v7, default exchange",
            fixture: spanOf("rabbitmq", "amq.default", "SPAN_KIND_CONSUMER", {
              "messaging.rabbitmq.destination.routing_key": "orders",
              "messaging.operation.type": "process",
              "network.protocol.name": "amqp",
            }),
          },
          {
            instrumentation: "Java agent (opt-in) process",
            fixture: spanOf(
              "rabbitmq",
              "shop:new-order:orders",
              "SPAN_KIND_CONSUMER",
              {
                "messaging.rabbitmq.destination.routing_key": "new-order",
                "messaging.operation.type": "process",
              },
            ),
          },
        ];

      for (const span of meeting) {
        expect({
          instrumentation: span.instrumentation,
          identity: identityOf(resolveSpan(span.fixture)),
        }).toEqual({ instrumentation: span.instrumentation, identity: metric });
      }

      for (const named of [
        "the Java agent by default",
        "amqplib for Node.js",
        "pika and aio-pika for Python",
        "RabbitMQ.Client for .NET",
        "on the publishing and the consuming side alike",
        "messages sent through the default exchange",
        "`OTEL_SEMCONV_STABILITY_OPT_IN=messaging`",
        "`shop:new-order:orders`",
      ]) {
        expect(bullet).toContain(named);
      }

      // Nowhere does the page still say that consumers name the queue.
      const page: string = readPage();

      for (const claim of [
        "consumers name queues",
        "the name consumers' spans report",
        "and its consumer the queue",
        "A RabbitMQ publisher names the exchange it publishes to",
      ]) {
        expect({ claim, made: page.includes(claim) }).toEqual({
          claim,
          made: false,
        });
      }
    });

    it("keeps MassTransit's exchanges whole and skips its receive spans, as it says", (): void => {
      expect(limitations()).toContain("`Namespace:Type`");
      expect(
        resolveSpan(spanOf("rabbitmq", "Shop.Contracts:OrderSubmitted"))
          ?.destination,
      ).toBe("Shop.Contracts:OrderSubmitted");
      expect(
        resolveSpan({
          attributes: { "messaging.destination.name": "order-submitted" },
          kind: "SPAN_KIND_CONSUMER",
        }),
      ).toBeNull();
    });

    it("keeps a Pub/Sub topic and its subscription apart, as it says", (): void => {
      expect(
        identityOf(resolveSpan(spanOf("gcp_pubsub", "orders"))),
      ).not.toEqual(
        identityOf(
          resolveSpan(
            spanOf("gcp_pubsub", "orders-billing", "SPAN_KIND_CONSUMER"),
          ),
        ),
      );
    });

    it("leaves Pulsar's per-consumer series out, as it says", (): void => {
      expect(
        resolveDatapoint({
          metricName: "pulsar_out_messages_total",
          attributes: {
            topic: "persistent://public/default/orders",
            subscription: "billing",
            consumer_name: "billing-1",
            consumer_id: "0",
          },
        }),
      ).toBeNull();
      expect(
        resolveDatapoint({
          metricName: "pulsar_out_messages_total",
          attributes: {
            topic: "persistent://public/default/orders",
            subscription: "billing",
          },
        })?.destination,
      ).toBe("persistent://public/default/orders");
    });
  });

  describe("self-hosted tuning", (): void => {
    /*
     * The discovery defaults the page states: the minimum spans a
     * destination needs to become a queue, the auto-create budget and the
     * days before an untouched queue is archived. The last two are read
     * from MessageQueueService below; the minimum spans (its variable and
     * default) from the discovery step the job runs, MessageQueueDiscovery.
     */
    const TUNING: Readonly<Record<string, string>> = {
      [MESSAGE_QUEUE_MIN_SPANS_ENV]: String(DEFAULT_MESSAGE_QUEUE_MIN_SPANS),
      MESSAGE_QUEUE_AUTO_CREATE_BUDGET: "500",
      MESSAGE_QUEUE_AUTO_ARCHIVE_DAYS: "7",
    };

    it("reads the minimum spans under the name the page gives it", (): void => {
      expect(MESSAGE_QUEUE_MIN_SPANS_ENV).toBe("MESSAGE_QUEUE_MIN_SPANS");
      expect(TUNING["MESSAGE_QUEUE_MIN_SPANS"]).toBe(
        String(DEFAULT_MESSAGE_QUEUE_MIN_SPANS),
      );
    });

    const SERVICE: string = fs.readFileSync(
      path.join(PACKAGES_DIR, "Common/Server/Services/MessageQueueService.ts"),
      "utf8",
    );

    /* A number the service declares as `const NAME: number = <n>;`, or a literal. */
    function serviceNumber(token: string): number {
      if (NUMBER_LITERAL.test(token)) {
        return Number(token);
      }

      const declared: RegExpMatchArray | null = SERVICE.match(
        new RegExp(`const ${token}: number = (\\d+);`),
      );

      expect({ token, declared: Boolean(declared) }).toEqual({
        token,
        declared: true,
      });

      return Number((declared as RegExpMatchArray)[1]);
    }

    /* The default and minimum the service reads an environment variable with. */
    function serviceEnv(name: string): { defaultValue: number; min: number } {
      const read: RegExpMatchArray | null = SERVICE.match(
        new RegExp(`name: "${name}",\\s*defaultValue: (\\w+),\\s*min: (\\w+),`),
      );

      expect({ name, read: Boolean(read) }).toEqual({ name, read: true });

      return {
        defaultValue: serviceNumber((read as RegExpMatchArray)[1] as string),
        min: serviceNumber((read as RegExpMatchArray)[2] as string),
      };
    }

    it("states the budget, the archive window and the restore grace MessageQueueService applies", (): void => {
      const tuning: string = section(readPage(), "## Self-hosted tuning");
      const budget: { defaultValue: number; min: number } = serviceEnv(
        "MESSAGE_QUEUE_AUTO_CREATE_BUDGET",
      );
      const archive: { defaultValue: number; min: number } = serviceEnv(
        "MESSAGE_QUEUE_AUTO_ARCHIVE_DAYS",
      );

      expect(String(budget.defaultValue)).toBe(
        TUNING["MESSAGE_QUEUE_AUTO_CREATE_BUDGET"],
      );
      expect(String(archive.defaultValue)).toBe(
        TUNING["MESSAGE_QUEUE_AUTO_ARCHIVE_DAYS"],
      );

      // A budget of 0 is allowed, and creates nothing; the window has a floor.
      expect(budget.min).toBe(0);
      expect(tuning).toContain("`0` turns automatic creation off");
      expect(tuning).toContain(`(minimum ${archive.min})`);

      const grace: number = serviceNumber("MANUAL_RESTORE_GRACE_DAYS");

      expect(section(readPage(), "### Lifecycle and archiving")).toContain(
        `A queue a person restores stays restored for ${grace} days (or the archive window, if that is longer) even while nothing sees it; from its next sighting the ${archive.defaultValue}-day rule applies again.`,
      );
      // The sweep never archives a queue created by hand.
      expect(SERVICE).toMatch(/mq\."discoverySource" <> \$\d/);
    });

    it("documents exactly the queue discovery variables, with their defaults", (): void => {
      const rows: Array<Array<string>> = tableRows(
        section(readPage(), "## Self-hosted tuning"),
      ).filter((cells: Array<string>): boolean => {
        return cells[0] !== "Variable";
      });

      expect(
        Object.fromEntries(
          rows.map((cells: Array<string>): [string, string] => {
            return [
              firstToken(cells[0] as string),
              firstToken(cells[1] as string),
            ];
          }),
        ),
      ).toEqual(TUNING);

      // And no other MESSAGE_QUEUE_* name anywhere on the page.
      for (const token of backtickedTokens(readPage())) {
        if (token.startsWith("MESSAGE_QUEUE_")) {
          expect(Object.keys(TUNING)).toContain(token);
        }
      }
    });

    it("states the same numbers where discovery is explained", (): void => {
      const markdown: string = readPage();

      expect(section(markdown, "### From application traces")).toContain(
        `at least ${TUNING["MESSAGE_QUEUE_MIN_SPANS"]} (\`MESSAGE_QUEUE_MIN_SPANS\`)`,
      );
      expect(section(markdown, "### The auto-create budget")).toContain(
        `fewer than ${TUNING["MESSAGE_QUEUE_AUTO_CREATE_BUDGET"]} live, non-archived discovered queues (\`MESSAGE_QUEUE_AUTO_CREATE_BUDGET\``,
      );
      expect(section(markdown, "### Lifecycle and archiving")).toContain(
        `has not been seen for ${TUNING["MESSAGE_QUEUE_AUTO_ARCHIVE_DAYS"]} days (\`MESSAGE_QUEUE_AUTO_ARCHIVE_DAYS\`)`,
      );
      expect(
        section(markdown, "### A queue my applications use was not created"),
      ).toContain(
        `Fewer than ${TUNING["MESSAGE_QUEUE_MIN_SPANS"]} of its spans`,
      );
    });
  });

  describe("instrumenting applications", (): void => {
    it("turns on the Azure SDK's .NET spans with the switch and the sources it needs", (): void => {
      const dotnet: string = section(readPage(), "### .NET");
      const code: string | undefined = fencedBlocks(dotnet)
        .filter((block: FencedBlock): boolean => {
          return block.info === "csharp";
        })
        .map((block: FencedBlock): string => {
          return block.body;
        })[0];

      expect(dotnet).toContain(
        "`AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true`",
      );
      expect(code).toContain(
        'AppContext.SetSwitch("Azure.Experimental.EnableActivitySource", true);',
      );
      expect(code).toContain('.AddSource("Azure.*")');
      expect(code).toContain('.AddSource("RabbitMQ.Client.*")');
    });

    /*
     * Celery's spans carry `messaging.destination` (a routing key) and
     * `celery.*`, but no system: the broker behind them is unknown.
     */
    it("says Celery's spans create no queue, as the resolver decides", (): void => {
      expect(section(readPage(), "### Python")).toContain(
        "Celery's spans carry no `messaging.system` and name no broker, so they do not create queues.",
      );
      expect(
        resolveSpan({
          attributes: {
            "messaging.destination": "celery",
            "celery.action": "apply_async",
            "celery.task_name": "shop.tasks.charge",
          },
          kind: "SPAN_KIND_PRODUCER",
        }),
      ).toBeNull();
    });

    it("names the Java agent's opt-in for the newer messaging attributes", (): void => {
      expect(section(readPage(), "### Java")).toContain(
        "`OTEL_SEMCONV_STABILITY_OPT_IN=messaging`",
      );
    });

    /*
     * The Java Pub/Sub client builds its tracer only when BOTH are set —
     * `if (this.openTelemetry != null && this.enableOpenTelemetryTracing)`,
     * with the builder's OpenTelemetry defaulting to null (googleapis/
     * java-pubsub v1.150.2, Publisher.java and Subscriber.java) — so the
     * switch alone traces nothing. The Node.js, Python and Go clients use
     * the global tracer, so their switch is enough.
     */
    it("gives the Java Pub/Sub client an OpenTelemetry instance as well as the tracing switch", (): void => {
      const bullet: string = lineWith(
        section(readPage(), "### Java"),
        "**Google Cloud Pub/Sub**",
      );

      expect(bullet).toContain("`setOpenTelemetry(GlobalOpenTelemetry.get())`");
      expect(bullet).toContain("`setEnableOpenTelemetryTracing(true)`");
      expect(bullet).toContain("Either call alone traces nothing.");
    });

    /*
     * OpenTelemetry Go auto-instrumentation (go.opentelemetry.io/auto, eBPF)
     * traces segmentio/kafka-go: its kafka-go producer probe writes one
     * PRODUCER span per message, its consumer probe a CONSUMER span, both
     * with semconv 1.37 keys (internal/pkg/instrumentation/bpf/github.com/
     * segmentio/kafka-go/{producer,consumer}/probe.go). What Go lacks is
     * contrib instrumentation for Kafka, RabbitMQ and NATS.
     */
    it("points kafka-go users to Go auto-instrumentation, whose spans make one queue", (): void => {
      const go: string = section(readPage(), "### Go");

      expect(go).not.toContain("OpenTelemetry has no Go instrumentation");
      expect(lineWith(go, "`segmentio/kafka-go`")).toContain(
        "`go.opentelemetry.io/auto`",
      );
      expect(go).toContain(
        "OpenTelemetry's Go contrib libraries have no Kafka, RabbitMQ or NATS instrumentation.",
      );

      const producer: ResolvedMessagingDestination | null = resolveSpan({
        attributes: {
          "messaging.system": "kafka",
          "messaging.operation.type": "send",
          "messaging.destination.name": "orders",
          "messaging.batch.message_count": 1,
          "messaging.kafka.message.key": "order-17",
        },
        kind: "SPAN_KIND_PRODUCER",
      });
      const consumer: ResolvedMessagingDestination | null = resolveSpan({
        attributes: {
          "messaging.system": "kafka",
          "messaging.operation.type": "receive",
          "messaging.destination.partition.id": "3",
          "messaging.destination.name": "orders",
          "messaging.kafka.offset": 42,
          "messaging.kafka.message.key": "order-17",
          "messaging.consumer.group.name": "billing",
        },
        kind: "SPAN_KIND_CONSUMER",
      });

      expect([producer?.direction, consumer?.direction]).toEqual([
        "publish",
        "consume",
      ]);
      expect(identityOf(producer)).toEqual(
        toMessageQueueIdentity({ system: "kafka", destination: "orders" }),
      );
      expect(identityOf(consumer)).toEqual(identityOf(producer));
    });

    it("covers every language it promises", (): void => {
      const instrumenting: string = section(
        readPage(),
        "## Instrumenting applications",
      );

      for (const language of ["Java", ".NET", "Node.js", "Python", "Go"]) {
        expect(instrumenting).toContain(`\n### ${language}\n`);
      }
    });
  });
});
