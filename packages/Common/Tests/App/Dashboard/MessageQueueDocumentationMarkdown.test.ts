import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import {
  MESSAGE_QUEUE_DOCS_PATH,
  MESSAGE_QUEUE_SUPPORTED_SYSTEMS_ANCHOR,
  MessageQueueChartedMetricRow,
  MessageQueueDocumentationTarget,
  getAwsRegionFromBrokerAddress,
  getAzureMonitorCollectedMetricNames,
  getMessageQueueChartedMetricRows,
  getMessageQueueDestinationAttributeKeys,
  getMessageQueueDocsUrl,
  getMessageQueueDocumentationMarkdown,
  getMessageQueueGuideReceivers,
  getMessageQueueGuideSystems,
  getMessageQueueMetricTypeLabel,
  getMessageQueueSystemGuideMarkdown,
  getMessagingInstrumentationNotes,
  markdownInlineCode,
  parseMessageQueueBrokerAddress,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/DocumentationMarkdown";
import {
  MESSAGING_SYSTEMS,
  MessagingBrokerMetricsSource,
  MessagingSystemDescriptor,
  getMessagingBrokerMetricsReceivers,
} from "../../../Types/MessageQueue/MessagingSystem";
import {
  MessageQueueMetricDescriptor,
  getMessageQueueMetricsForSystem,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";

/*
 * The in-app Queues setup guide. A collector config that does not parse, or
 * that drifted from the one the docs page validated, installs a collector
 * that silently sends nothing — so these tests hold every block the guide
 * emits to the docs page's own blocks (each validated with `otelcol-contrib
 * validate` on otel/opentelemetry-collector-contrib 0.161.0), check every
 * YAML block parses and exports to the viewer's endpoint with the viewer's
 * key, and pin the catalog facts the guide states: receivers, Prometheus
 * ports and paths, the Azure and Pub/Sub metric lists, the charted metrics
 * table, and how a queue's own telemetry finds it.
 */

const REPO_PACKAGES: string = path.join(__dirname, "..", "..", "..", "..");
const QUEUES_DOC: string = fs.readFileSync(
  path.join(
    REPO_PACKAGES,
    "App",
    "FeatureSet",
    "Docs",
    "Content",
    "en",
    "telemetry",
    "queues.md",
  ),
  "utf8",
);

// The values the docs page writes where the in-app guide interpolates.
const DOCS_VARS: { oneuptimeUrl: string; apiKey: string } = {
  oneuptimeUrl: "https://oneuptime.com",
  apiKey: "YOUR_TELEMETRY_INGESTION_TOKEN",
};

const VARS: { oneuptimeUrl: string; apiKey: string } = {
  oneuptimeUrl: "https://oneuptime.example.com",
  apiKey: "ingest-key-123",
};

type YamlMap = { [key: string]: any };

interface CodeBlock {
  language: string;
  body: string;
}

/* Fenced code blocks of some markdown, with their info string. */
function codeBlocks(markdown: string): Array<CodeBlock> {
  const blocks: Array<CodeBlock> = [];
  let current: { language: string; lines: Array<string> } | null = null;

  for (const line of markdown.split("\n")) {
    const fence: RegExpMatchArray | null = line.match(/^```(\S*)\s*$/);
    if (fence) {
      if (current) {
        blocks.push({
          language: current.language,
          body: current.lines.join("\n"),
        });
        current = null;
      } else {
        current = { language: fence[1] || "", lines: [] };
      }
      continue;
    }
    if (current) {
      current.lines.push(line);
    }
  }

  expect(current).toBeNull();
  return blocks;
}

function yamlBlocks(markdown: string): Array<YamlMap> {
  return codeBlocks(markdown)
    .filter((block: CodeBlock): boolean => {
      return block.language === "yaml";
    })
    .map((block: CodeBlock): YamlMap => {
      return yaml.load(block.body) as YamlMap;
    });
}

/* A system's broker-metrics section on the docs page: its "### <name>" heading down to the next heading. */
function docsSection(displayName: string): string {
  const heading: string = `\n### ${displayName}\n`;
  const start: number = QUEUES_DOC.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  const rest: string = QUEUES_DOC.slice(start + heading.length);
  const end: number = rest.search(/\n#{2,3} /);
  return end === -1 ? rest : rest.slice(0, end);
}

/*
 * The docs page and the guide quote shell values differently (the guide
 * quotes everything that comes from data); compare the words, not the
 * quoting.
 */
function normalizeShell(body: string): string {
  return body
    .split("\n")
    .map((line: string): string => {
      return line
        .replace(/^(export [A-Z_]+=)"(.*)"$/, "$1$2")
        .replace(/\s+$/, "");
    })
    .join("\n")
    .trim();
}

// The SDK environment block every guide shares; not a per-system block.
function isSdkEnvironmentBlock(block: CodeBlock): boolean {
  return block.body.startsWith("OTEL_EXPORTER_OTLP_ENDPOINT=");
}

function descriptorOf(system: string): MessagingSystemDescriptor {
  const descriptor: MessagingSystemDescriptor | undefined =
    MESSAGING_SYSTEMS.find((candidate: MessagingSystemDescriptor): boolean => {
      return candidate.system === system;
    });
  expect(descriptor).toBeDefined();
  return descriptor!;
}

function queueGuide(target: MessageQueueDocumentationTarget): string {
  return getMessageQueueDocumentationMarkdown(VARS, target);
}

const SYSTEMS: Array<string> = MESSAGING_SYSTEMS.map(
  (descriptor: MessagingSystemDescriptor): string => {
    return descriptor.system;
  },
);

/* A realistic queue of every catalog system, as its Documentation tab sees it. */
function sampleQueue(system: string): MessageQueueDocumentationTarget {
  const descriptor: MessagingSystemDescriptor = descriptorOf(system);
  return {
    system,
    destination: "orders",
    brokerScope:
      descriptor.brokerScope === "azure-namespace" ? "shop-prod" : "",
    brokerAddress: "broker-1.internal:9092",
  };
}

describe("every guide's YAML parses and exports to the viewer's OneUptime", () => {
  const guides: Array<[string, string]> = [];
  for (const system of SYSTEMS) {
    guides.push([
      `${system} (product)`,
      getMessageQueueSystemGuideMarkdown(VARS, system),
    ]);
    guides.push([`${system} (queue)`, queueGuide(sampleQueue(system))]);
  }

  test.each(guides)("%s", (_name: string, markdown: string) => {
    for (const config of yamlBlocks(markdown)) {
      expect(config["exporters"]).toEqual({
        otlphttp: {
          endpoint: `${VARS.oneuptimeUrl}/otlp`,
          headers: { "x-oneuptime-token": VARS.apiKey },
        },
      });

      const pipelines: YamlMap = config["service"]["pipelines"];
      expect(Object.keys(pipelines).length).toBeGreaterThan(0);

      for (const pipeline of Object.values(pipelines) as Array<YamlMap>) {
        expect(pipeline["exporters"]).toEqual(["otlphttp"]);
        for (const receiver of pipeline["receivers"]) {
          expect(Object.keys(config["receivers"])).toContain(receiver);
        }
        for (const processor of pipeline["processors"]) {
          expect(Object.keys(config["processors"])).toContain(processor);
        }
      }

      for (const extension of config["service"]["extensions"] || []) {
        expect(Object.keys(config["extensions"])).toContain(extension);
      }
    }

    // The SDK environment points at the same place with the same key.
    const environment: CodeBlock | undefined = codeBlocks(markdown).find(
      isSdkEnvironmentBlock,
    );
    if (environment) {
      expect(environment.body).toContain(
        `OTEL_EXPORTER_OTLP_ENDPOINT="${VARS.oneuptimeUrl}/otlp"`,
      );
      expect(environment.body).toContain(
        `OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=${VARS.apiKey}"`,
      );
      expect(environment.body).toContain(
        'OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"',
      );
    }

    // Never a placeholder the viewer's own values should have replaced.
    expect(markdown).not.toContain("<YOUR_API_KEY>");
    expect(markdown).not.toContain("YOUR_TELEMETRY_INGESTION_TOKEN");
  });
});

describe("every block equals the docs page's validated one", () => {
  test.each(SYSTEMS)("%s", (system: string) => {
    const descriptor: MessagingSystemDescriptor = descriptorOf(system);
    const markdown: string = getMessageQueueSystemGuideMarkdown(
      DOCS_VARS,
      system,
    );
    /*
     * JMS's broker path is ActiveMQ's (its JMS section links there), so its
     * blocks are ActiveMQ's.
     */
    const sections: Array<string> = [docsSection(descriptor.displayName)];
    if (system === "jms") {
      sections.push(docsSection(descriptorOf("activemq").displayName));
    }
    const docsBlocks: Array<CodeBlock> = sections.flatMap(
      (section: string): Array<CodeBlock> => {
        return codeBlocks(section);
      },
    );

    const guideBlocks: Array<CodeBlock> = codeBlocks(markdown).filter(
      (block: CodeBlock): boolean => {
        return !isSdkEnvironmentBlock(block);
      },
    );

    for (const block of guideBlocks) {
      const match: CodeBlock | undefined = docsBlocks.find(
        (candidate: CodeBlock): boolean => {
          if (candidate.language !== block.language) {
            return false;
          }
          if (block.language === "yaml") {
            return (
              JSON.stringify(yaml.load(candidate.body)) ===
              JSON.stringify(yaml.load(block.body))
            );
          }
          return normalizeShell(candidate.body) === normalizeShell(block.body);
        },
      );

      expect({ system, block: block.body, matched: Boolean(match) }).toEqual({
        system,
        block: block.body,
        matched: true,
      });
    }
  });

  test("every system with a ready-made metrics path gets its config, none the fallback", () => {
    for (const system of SYSTEMS) {
      const source: MessagingBrokerMetricsSource =
        descriptorOf(system).brokerMetrics;
      for (const markdown of [
        getMessageQueueSystemGuideMarkdown(VARS, system),
        queueGuide(sampleQueue(system)),
      ]) {
        expect(markdown).not.toContain("for the collector configuration.");
        const blocks: Array<CodeBlock> = codeBlocks(markdown).filter(
          (block: CodeBlock): boolean => {
            return !isSdkEnvironmentBlock(block);
          },
        );
        if (source.kind === "none" && system !== "jms" && system !== "bullmq") {
          expect(blocks).toEqual([]);
        } else {
          expect({ system, blocks: blocks.length > 0 }).toEqual({
            system,
            blocks: true,
          });
        }
      }
    }
  });
});

describe("the configs run the catalog's receivers", () => {
  test.each(
    SYSTEMS.filter((system: string): boolean => {
      return ["receiver", "prometheus", "cloud-monitoring"].includes(
        descriptorOf(system).brokerMetrics.kind,
      );
    }),
  )("%s", (system: string) => {
    const source: MessagingBrokerMetricsSource =
      descriptorOf(system).brokerMetrics;
    const configs: Array<YamlMap> = yamlBlocks(
      getMessageQueueSystemGuideMarkdown(VARS, system),
    );
    expect(configs).toHaveLength(1);

    const receiverTypes: Array<string> = Object.keys(
      configs[0]!["receivers"],
    ).map((id: string): string => {
      return id.split("/")[0]!;
    });
    const expected: string =
      source.kind === "prometheus"
        ? "prometheus"
        : (source as { receiver: string }).receiver;

    expect(receiverTypes).toEqual([expected]);
    expect(getMessageQueueGuideReceivers(system)).toContain(expected);
    expect(getMessageQueueGuideReceivers(system)).toEqual(
      getMessagingBrokerMetricsReceivers(source),
    );
  });

  test("every Prometheus scrape uses the catalog's port and path", () => {
    for (const system of SYSTEMS) {
      const source: MessagingBrokerMetricsSource =
        descriptorOf(system).brokerMetrics;
      if (source.kind !== "prometheus") {
        continue;
      }
      const config: YamlMap = yamlBlocks(
        getMessageQueueSystemGuideMarkdown(VARS, system),
      )[0]!;
      const scrapes: Array<YamlMap> =
        config["receivers"]["prometheus"]["config"]["scrape_configs"];
      expect(scrapes).toHaveLength(1);
      expect(scrapes[0]!["metrics_path"]).toBe(source.path);
      for (const target of scrapes[0]!["static_configs"][0]["targets"]) {
        expect(target.endsWith(`:${source.port}`)).toBe(true);
      }
    }
  });

  test("Pulsar's scrape keeps exactly the charted families", () => {
    const config: YamlMap = yamlBlocks(
      getMessageQueueSystemGuideMarkdown(VARS, "pulsar"),
    )[0]!;
    const relabel: YamlMap =
      config["receivers"]["prometheus"]["config"]["scrape_configs"][0][
        "metric_relabel_configs"
      ][0];
    expect(relabel["action"]).toBe("keep");
    expect(relabel["source_labels"]).toEqual(["__name__"]);
    // Prometheus anchors a relabel regex at both ends.
    const keep: RegExp = new RegExp(`^(?:${relabel["regex"]})$`);
    for (const descriptor of getMessageQueueMetricsForSystem("pulsar")) {
      expect(keep.test(descriptor.metricName)).toBe(true);
    }
    expect(keep.test("pulsar_throughput_in")).toBe(false);
    expect(keep.test("pulsar_msg_backlog_extra")).toBe(false);
  });

  test.each(["servicebus", "eventhubs"])(
    "%s's Azure Monitor config collects every charted metric",
    (system: string) => {
      const collected: Array<string> =
        getAzureMonitorCollectedMetricNames(system);
      for (const descriptor of getMessageQueueMetricsForSystem(system)) {
        expect(collected).toContain(descriptor.metricName);
      }
      expect(collected.length).toBe(
        getMessageQueueMetricsForSystem(system).length,
      );

      const config: YamlMap = yamlBlocks(
        getMessageQueueSystemGuideMarkdown(VARS, system),
      )[0]!;
      const receiver: YamlMap = config["receivers"][`azure_monitor/${system}`];
      const [resourceType] = receiver["services"];
      expect(Object.keys(receiver["metrics"])).toEqual([resourceType]);
      expect(
        Object.entries(receiver["metrics"][resourceType]).map(
          ([name, aggregations]: [string, any]): string => {
            return `azure_${name}_${aggregations[0]}`.toLowerCase();
          },
        ),
      ).toEqual(collected);
    },
  );

  test("the Pub/Sub config lists exactly the charted metric types", () => {
    const config: YamlMap = yamlBlocks(
      getMessageQueueSystemGuideMarkdown(VARS, "gcp_pubsub"),
    )[0]!;
    expect(
      config["receivers"]["googlecloudmonitoring"]["metrics_list"].map(
        (entry: YamlMap): string => {
          return entry["metric_name"];
        },
      ),
    ).toEqual(
      getMessageQueueMetricsForSystem("gcp_pubsub").map(
        (descriptor: MessageQueueMetricDescriptor): string => {
          return descriptor.metricName;
        },
      ),
    );
  });

  test("the ActiveMQ scraper targets ActiveMQ and pushes to the viewer's OneUptime", () => {
    const markdown: string = getMessageQueueSystemGuideMarkdown(
      VARS,
      "activemq",
    );
    const scraper: CodeBlock | undefined = codeBlocks(markdown).find(
      (block: CodeBlock): boolean => {
        return block.body.includes("java -jar opentelemetry-jmx-scraper.jar");
      },
    );
    expect(scraper).toBeDefined();
    expect(scraper!.body).toContain("export OTEL_JMX_TARGET_SYSTEM=activemq");
    expect(scraper!.body).toContain(
      `export OTEL_EXPORTER_OTLP_ENDPOINT="${VARS.oneuptimeUrl}/otlp"`,
    );
    expect(scraper!.body).toContain(
      `export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=${VARS.apiKey}"`,
    );
    expect(markdown).toContain(
      (descriptorOf("activemq").brokerMetrics as { scraper: string }).scraper,
    );
  });
});

describe("what a queue's page charts", () => {
  /* The docs section's "| Metric | Shown as | Type |" rows. */
  function docsRows(displayName: string): Array<MessageQueueChartedMetricRow> {
    return docsSection(displayName)
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("| `");
      })
      .map((line: string): MessageQueueChartedMetricRow => {
        const cells: Array<string> = line
          .slice(1, -1)
          .split(" | ")
          .map((cell: string): string => {
            return cell.trim();
          });
        return { metric: cells[0]!, title: cells[1]!, type: cells[2]! };
      });
  }

  test.each(SYSTEMS)("%s's table equals the docs page's", (system: string) => {
    expect(getMessageQueueChartedMetricRows(system)).toEqual(
      docsRows(descriptorOf(system).displayName),
    );
  });

  test.each(SYSTEMS)("%s's guide renders that table", (system: string) => {
    const markdown: string = getMessageQueueSystemGuideMarkdown(VARS, system);
    const rows: Array<MessageQueueChartedMetricRow> =
      getMessageQueueChartedMetricRows(system);
    for (const row of rows) {
      expect(markdown).toContain(
        `| ${row.metric} | ${row.title} | ${row.type} |`,
      );
    }
    if (rows.length > 0) {
      expect(markdown).toContain(
        "under **Broker health**, and each gauge has **Create monitor**",
      );
    } else {
      expect(markdown).toContain(
        `OneUptime charts no broker metrics for ${descriptorOf(system).displayName} under **Broker health**`,
      );
      expect(markdown).toContain("**Metrics** explorer");
      expect(markdown).toContain("**Metrics** tab");
    }
  });

  test("every charted metric is in its system's table, the JSON-stream twins folded", () => {
    for (const system of SYSTEMS) {
      const text: string = getMessageQueueChartedMetricRows(system)
        .map((row: MessageQueueChartedMetricRow): string => {
          return row.metric;
        })
        .join("\n");
      for (const descriptor of getMessageQueueMetricsForSystem(system)) {
        expect(text).toContain(`\`${descriptor.metricName}\``);
      }
    }
  });

  test("the type column follows the metric's kind and aggregation", () => {
    const base: MessageQueueMetricDescriptor =
      getMessageQueueMetricsForSystem("kafka")[0]!;
    expect(getMessageQueueMetricTypeLabel({ ...base, kind: "counter" })).toBe(
      "Counter, charted per second",
    );
    expect(
      getMessageQueueMetricTypeLabel({
        ...base,
        kind: "gauge",
        aggregation: AggregationType.Sum,
      }),
    ).toBe("Count per period");
    for (const aggregation of [
      AggregationType.Max,
      AggregationType.Avg,
      AggregationType.Min,
    ]) {
      expect(
        getMessageQueueMetricTypeLabel({
          ...base,
          kind: "gauge",
          aggregation: aggregation as AggregationType.Max,
        }),
      ).toBe("Gauge");
    }
  });

  test("JMS says an ActiveMQ broker's metrics chart once they arrive", () => {
    const markdown: string = queueGuide(sampleQueue("jms"));
    expect(markdown).toContain(
      "Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue",
    );
    expect(markdown).toContain(getMessageQueueDocsUrl("activemq"));
  });
});

describe("the product guide", () => {
  test.each(SYSTEMS)(
    "%s opens with how its queues appear",
    (system: string) => {
      const descriptor: MessagingSystemDescriptor = descriptorOf(system);
      const markdown: string = getMessageQueueSystemGuideMarkdown(VARS, system);

      expect(
        markdown.startsWith(`## Connect ${descriptor.displayName}\n`),
      ).toBe(true);
      expect(markdown).toContain(
        `${descriptor.displayName} queues appear in OneUptime on their own`,
      );
      expect(markdown).toContain("**Queues → Create Queue**");
      expect(markdown).toContain(
        `\`messaging.system\` = ${markdownInlineCode(descriptor.system)}`,
      );
      for (const alias of descriptor.aliases) {
        expect(markdown).toContain(markdownInlineCode(alias));
      }
      /*
       * Broker metrics are promised only where they name a queue: a system
       * with curated metrics. A collector path alone is not enough — NATS
       * and Azure Event Grid have one, and their metrics attach to no queue.
       */
      expect(markdown.includes("and the broker's own metrics")).toBe(
        getMessageQueueMetricsForSystem(system).length > 0,
      );
      expect(markdown).toContain(
        `[${descriptor.displayName} on the Queues documentation page](${MESSAGE_QUEUE_DOCS_PATH}#${descriptor.docsAnchor})`,
      );
      // The catalog's own note or reason, verbatim.
      const source: MessagingBrokerMetricsSource = descriptor.brokerMetrics;
      expect(markdown).toContain(
        source.kind === "none" ? source.reason : source.note,
      );
    },
  );

  test("the section headings follow the source", () => {
    expect(getMessageQueueSystemGuideMarkdown(VARS, "kafka")).toContain(
      "### 2. Send the broker's metrics",
    );
    expect(getMessageQueueSystemGuideMarkdown(VARS, "bullmq")).toContain(
      "### 2. Report the queue's depth",
    );
    expect(getMessageQueueSystemGuideMarkdown(VARS, "jms")).toContain(
      "### 2. Broker metrics",
    );
  });

  test("every docs link lands on a heading of the docs page", () => {
    for (const descriptor of MESSAGING_SYSTEMS) {
      expect(QUEUES_DOC).toContain(`\n### ${descriptor.displayName}\n`);
      expect(getMessageQueueDocsUrl(descriptor.system)).toBe(
        `/docs/telemetry/queues#${descriptor.docsAnchor}`,
      );
    }
    expect(QUEUES_DOC).toContain("\n## Supported messaging systems\n");
    expect(getMessageQueueDocsUrl("ibmmq")).toBe(
      `/docs/telemetry/queues#${MESSAGE_QUEUE_SUPPORTED_SYSTEMS_ANCHOR}`,
    );
    expect(getMessageQueueDocsUrl(undefined)).toBe(
      "/docs/telemetry/queues#supported-messaging-systems",
    );
    // The awsfirehose pointer.
    expect(QUEUES_DOC).toContain("\n### Amazon SQS\n");
  });

  test("the picker's systems are the catalog's, alphabetical", () => {
    const names: Array<string> = getMessageQueueGuideSystems().map(
      (descriptor: MessagingSystemDescriptor): string => {
        return descriptor.displayName;
      },
    );
    expect([...names].sort()).toEqual(
      MESSAGING_SYSTEMS.map((descriptor: MessagingSystemDescriptor): string => {
        return descriptor.displayName;
      }).sort(),
    );
    expect(names).toEqual(
      [...names].sort((a: string, b: string): number => {
        return a.localeCompare(b);
      }),
    );
  });
});

describe("the instrumentation notes", () => {
  test("Kafka names a way for every major language", () => {
    const languages: Array<string> = getMessagingInstrumentationNotes(
      "kafka",
    ).map((note: { language: string }): string => {
      return note.language;
    });
    expect(languages).toEqual(["Java", ".NET", "Node.js", "Python", "Go"]);
  });

  test("Service Bus and Event Hubs share the Azure SDK switches", () => {
    for (const system of ["servicebus", "eventhubs"]) {
      const markdown: string = getMessageQueueSystemGuideMarkdown(VARS, system);
      expect(markdown).toContain(
        "AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true",
      );
      expect(markdown).toContain('.AddSource("Azure.*")');
      expect(markdown).toContain("createAzureSdkInstrumentation()");
      expect(markdown).toContain("azure-core-tracing-opentelemetry");
    }
  });

  test("JMS and ActiveMQ explain the family", () => {
    for (const system of ["jms", "activemq"]) {
      expect(getMessageQueueSystemGuideMarkdown(VARS, system)).toContain(
        "JMS spans say `jms` whichever broker is behind them",
      );
    }
  });

  test("the AWS notes ask .NET for the latest attribute set", () => {
    for (const system of ["aws_sqs", "aws.sns"]) {
      expect(getMessageQueueSystemGuideMarkdown(VARS, system)).toContain(
        "SemanticConventionVersion.Latest",
      );
    }
  });

  test("every guide ends its client list with the generic advice for its own system", () => {
    for (const system of SYSTEMS) {
      if (system === "bullmq") {
        continue;
      }
      expect(getMessageQueueSystemGuideMarkdown(VARS, system)).toContain(
        `set \`messaging.system\` = ${markdownInlineCode(system)}, \`messaging.destination.name\` and the span kind`,
      );
    }
  });

  test("BullMQ gets the transform that adds the keys OneUptime reads", () => {
    const markdown: string = getMessageQueueSystemGuideMarkdown(VARS, "bullmq");
    const transform: YamlMap = yamlBlocks(markdown)[0]!;
    expect(Object.keys(transform["service"]["pipelines"]).sort()).toEqual([
      "metrics",
      "traces",
    ]);
    expect(
      transform["processors"]["transform/bullmq"]["trace_statements"].join(
        "\n",
      ),
    ).toContain('set(span.attributes["messaging.system"], "bullmq")');
    expect(markdown).toContain('createObservableGauge("queue.size"');
  });
});

describe("a queue's own guide", () => {
  test("says how its telemetry finds it", () => {
    const markdown: string = queueGuide({
      system: "kafka",
      destination: "orders.created",
      brokerAddress: "",
    });
    expect(markdown.startsWith("## Connect `orders.created`\n")).toBe(true);
    expect(markdown).toContain(
      "This is the Apache Kafka queue `orders.created`.",
    );
    expect(markdown).toContain(
      "- **Spans**: `messaging.system` = `kafka` and the destination `orders.created`",
    );
    expect(markdown).toContain(
      "- **Broker metrics**: `topic` = `orders.created`.",
    );
    expect(markdown).toContain("Names are compared without regard to case.");
  });

  test("an Azure queue names its namespace on both sides", () => {
    const markdown: string = queueGuide({
      system: "servicebus",
      destination: "orders",
      brokerScope: "shop-prod",
    });
    expect(markdown).toContain(
      "This is the Azure Service Bus queue `orders` in the `shop-prod` namespace.",
    );
    expect(markdown).toContain(
      "from an SDK connected to `shop-prod.servicebus.windows.net`",
    );
    expect(markdown).toContain(
      "- **Broker metrics**: `metadata_entityname` = `orders`, on the namespace whose `name` is `shop-prod`.",
    );
    // Every accepted spelling keys the same queue.
    expect(markdown).toContain(
      "`messaging.system` = `servicebus` (or `azure_servicebus`, `azure.servicebus` or `microsoft.servicebus`)",
    );
  });

  test("an Azure queue without a namespace says Azure Monitor's metrics go elsewhere", () => {
    const markdown: string = queueGuide({
      system: "eventhubs",
      destination: "telemetry",
      brokerScope: "",
    });
    expect(markdown).toContain(
      "from an SDK connected to a host that names no namespace",
    );
    expect(markdown).toContain(
      "Azure Monitor names the namespace of every metric it reports",
    );
    expect(markdown).not.toContain("on the namespace whose");
  });

  test("an ActiveMQ queue is found by its JMS family's spans too", () => {
    const markdown: string = queueGuide({
      system: "activemq",
      destination: "orders",
    });
    expect(markdown).toContain(
      "`messaging.system` = `jms` (or `activemq`, `artemis` or `activemq_artemis`)",
    );
    expect(markdown).toContain(
      "JMS clients' spans say `jms` whichever broker is behind them, so they and the Apache ActiveMQ broker's metrics land on this one queue.",
    );
    expect(markdown).toContain(
      "- **Broker metrics**: `messaging.destination.name` or `destination` = `orders`.",
    );
  });

  test("the broker-metric keys come from the catalog, one per spelling", () => {
    expect(getMessageQueueDestinationAttributeKeys("servicebus")).toEqual([
      "metadata_entityname",
    ]);
    expect(getMessageQueueDestinationAttributeKeys("aws_sqs")).toEqual([
      "Dimensions.QueueName",
      "QueueName",
    ]);
    expect(getMessageQueueDestinationAttributeKeys("gcp_pubsub")).toEqual([
      "resource.subscription_id",
      "resource.topic_id",
    ]);
    expect(getMessageQueueDestinationAttributeKeys("nats")).toEqual([]);
  });

  test("a system without broker metrics promises only spans and application metrics", () => {
    const markdown: string = queueGuide({
      system: "bullmq",
      destination: "orders",
    });
    expect(markdown).toContain(
      "and from metrics that carry its `messaging.system` and `messaging.destination.name`",
    );
    expect(markdown).not.toContain("**Broker metrics**:");
    expect(markdown).not.toContain("the broker's own metrics");
  });

  test("a long-tail system gets the generic guide", () => {
    const markdown: string = queueGuide({
      system: "ibmmq",
      destination: "DEV.QUEUE.1",
    });
    expect(markdown).toContain("This is the ibmmq queue `DEV.QUEUE.1`.");
    expect(markdown).toContain("`messaging.system` = `ibmmq`");
    expect(markdown).toContain("OneUptime does not know this messaging system");
    expect(yamlBlocks(markdown)).toEqual([]);
    expect(markdown).toContain(
      "(/docs/telemetry/queues#supported-messaging-systems)",
    );
  });

  test("a queue with no system still renders", () => {
    const markdown: string = queueGuide({ system: null, destination: "x" });
    expect(markdown).toContain("## Connect `x`");
    expect(markdown).toContain("`messaging.system` = `<system>`");
    expect(markdown).toContain(
      "- **Spans**: `messaging.system` = `<system>` and the destination `x`",
    );
    // No empty code span (two backticks that are not part of a fence).
    expect(markdown).not.toMatch(/(^|[^`])``([^`]|$)/m);
  });
});

/*
 * The guide promises broker metrics only where they can reach the queue —
 * the rule the Overview's Broker health section follows (a system with
 * curated metrics). A collector path is not enough: NATS's exporter reports
 * JetStream streams and consumers, not subjects, and Azure Monitor reports
 * Event Grid per resource and event subscription, so neither ever creates
 * or fills a queue. Nor does Azure Monitor reach a Service Bus / Event Hubs
 * queue without a namespace: it names the namespace of every metric.
 */
describe("broker metrics are promised only where they reach the queue", () => {
  // Computed, so a system that gains curated metrics leaves the list.
  const UNCHARTED_WITH_A_COLLECTOR: Array<string> = SYSTEMS.filter(
    (system: string): boolean => {
      return (
        descriptorOf(system).brokerMetrics.kind !== "none" &&
        getMessageQueueMetricsForSystem(system).length === 0
      );
    },
  );

  test("the catalog has systems a collector reads but no queue charts", () => {
    // NATS and Azure Event Grid today; keeps the next test from passing empty.
    expect(UNCHARTED_WITH_A_COLLECTOR.length).toBeGreaterThan(0);
  });

  test.each(UNCHARTED_WITH_A_COLLECTOR)(
    "%s's guides promise spans and application metrics, and send the collector's metrics to the Metrics explorer",
    (system: string) => {
      const displayName: string = descriptorOf(system).displayName;
      const product: string = getMessageQueueSystemGuideMarkdown(VARS, system);
      const queue: string = queueGuide(sampleQueue(system));

      expect(product).toContain(
        `${displayName} queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them.`,
      );
      expect(queue).toContain(
        "and from metrics that carry its `messaging.system` and `messaging.destination.name`.",
      );
      for (const markdown of [product, queue]) {
        expect(markdown).not.toContain("the broker's own metrics");
        expect(markdown).not.toContain("Overview charts these");
        // The collector config stays: its metrics are worth exploring.
        expect(markdown).toContain("### 2. Send the broker's metrics");
        expect(yamlBlocks(markdown)).toHaveLength(1);
        expect(markdown).toContain(
          `OneUptime charts no broker metrics for ${displayName} under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer.`,
        );
      }
    },
  );

  test.each(["servicebus", "eventhubs"])(
    "a %s queue without a namespace is promised no broker metrics, and the namespaced one is",
    (system: string) => {
      const markdown: string = queueGuide({
        system,
        destination: "orders",
        brokerScope: "",
        brokerAddress: "localhost:5672",
      });
      expect(markdown).toContain(
        "and from metrics that carry its `messaging.system` and `messaging.destination.name`.",
      );
      expect(markdown).not.toContain("the broker's own metrics");
      expect(markdown).not.toContain("The queue's Overview charts these");
      expect(markdown).toContain(
        "This queue has no namespace, so Azure Monitor's metrics never reach it: they chart under **Broker health** on the same destination's queue in their namespace, where each gauge has **Create monitor**.",
      );
      // The table still says what that namespaced queue charts.
      for (const row of getMessageQueueChartedMetricRows(system)) {
        expect(markdown).toContain(
          `| ${row.metric} | ${row.title} | ${row.type} |`,
        );
      }

      const namespaced: string = queueGuide({
        system,
        destination: "orders",
        brokerScope: "shop-prod",
      });
      expect(namespaced).toContain("and from the broker's own metrics.");
      expect(namespaced).toContain(
        "The queue's Overview charts these under **Broker health**",
      );
      expect(namespaced).not.toContain("This queue has no namespace");
    },
  );

  test("only the namespace systems wait up to a day for a new namespace", () => {
    const waiting: Array<string> = [];
    for (const system of SYSTEMS) {
      for (const markdown of [
        getMessageQueueSystemGuideMarkdown(VARS, system),
        queueGuide(sampleQueue(system)),
      ]) {
        if (
          markdown.includes("The receiver lists your namespaces once a day")
        ) {
          waiting.push(system);
        }
      }
    }
    // Both guides of each namespace system, and nothing else.
    const expected: Array<string> = SYSTEMS.filter(
      (system: string): boolean => {
        return descriptorOf(system).brokerScope === "azure-namespace";
      },
    ).flatMap((system: string): Array<string> => {
      return [system, system];
    });
    expect(expected.length).toBeGreaterThan(0);
    expect(waiting).toEqual(expected);
    // Azure Event Grid shares the receiver but has no namespaces to list.
    expect(waiting).not.toContain("eventgrid");
  });
});

describe("prefilled from what the queue's telemetry reported", () => {
  function kafkaBrokers(address: string | null): Array<string> {
    return yamlBlocks(
      queueGuide({
        system: "kafka",
        destination: "orders",
        brokerAddress: address,
      }),
    )[0]!["receivers"]["kafka_metrics"]["brokers"];
  }

  test("Kafka's bootstrap broker, with the default port when none was reported", () => {
    expect(kafkaBrokers("kafka-1.internal:9093")).toEqual([
      "kafka-1.internal:9093",
    ]);
    expect(kafkaBrokers("10.0.0.7")).toEqual(["10.0.0.7:9092"]);
    expect(kafkaBrokers(null)).toEqual(["kafka-1:9092", "kafka-2:9092"]);
    // Nothing that could break the config is pasted in.
    expect(kafkaBrokers("[::1]:9092")).toEqual([
      "kafka-1:9092",
      "kafka-2:9092",
    ]);
    expect(kafkaBrokers("tcp://kafka:9092")).toEqual([
      "kafka-1:9092",
      "kafka-2:9092",
    ]);
    expect(kafkaBrokers('kafka"]: 1')).toEqual([
      "kafka-1:9092",
      "kafka-2:9092",
    ]);
  });

  test("the prefill is said out loud, and only when it happened", () => {
    expect(
      queueGuide({
        system: "kafka",
        destination: "orders",
        brokerAddress: "kafka-1.internal:9093",
      }),
    ).toContain(
      "The bootstrap broker is prefilled from the broker address this queue's telemetry reports (`kafka-1.internal:9093`)",
    );
    expect(
      queueGuide({ system: "kafka", destination: "orders" }),
    ).not.toContain("is prefilled from");
  });

  test("RabbitMQ's management endpoint on the broker's host", () => {
    const config: YamlMap = yamlBlocks(
      queueGuide({
        system: "rabbitmq",
        destination: "orders",
        brokerAddress: "rabbit.internal:5672",
      }),
    )[0]!;
    expect(config["receivers"]["rabbitmq"]["endpoint"]).toBe(
      "http://rabbit.internal:15672",
    );
  });

  test("ActiveMQ's JMX host", () => {
    const markdown: string = queueGuide({
      system: "activemq",
      destination: "orders",
      brokerAddress: "amq.internal:61616",
    });
    expect(markdown).toContain(
      "export OTEL_JMX_SERVICE_URL=service:jmx:rmi:///jndi/rmi://amq.internal:1099/jmxrmi",
    );
    expect(markdown).toContain("-Djava.rmi.server.hostname=amq.internal");
    expect(markdown).toContain(
      "The JMX host is prefilled from the broker address this queue's telemetry reports (`amq.internal:61616`).",
    );
  });

  test.each([
    ["aws_sqs", "sqs.eu-west-2.amazonaws.com:443", "eu-west-2"],
    ["aws_sqs", "sqs-fips.us-gov-west-1.amazonaws.com", "us-gov-west-1"],
    ["aws_sqs", "sqs.cn-north-1.amazonaws.com.cn", "cn-north-1"],
    ["aws.sns", "sns.ap-southeast-2.amazonaws.com", "ap-southeast-2"],
    ["aws_sqs", "localhost:4566", "us-east-1"],
    ["aws_sqs", "", "us-east-1"],
  ])(
    "the %s region from %p is %p",
    (system: string, address: string, region: string) => {
      const config: YamlMap = yamlBlocks(
        queueGuide({ system, destination: "orders", brokerAddress: address }),
      )[0]!;
      const receiverId: string = Object.keys(config["receivers"])[0]!;
      expect(config["receivers"][receiverId]["region"]).toBe(region);
    },
  );

  test.each(["pulsar", "rocketmq", "nats"])(
    "%s keeps its placeholders: its clients reach a proxy or name server, not the metrics endpoint",
    (system: string) => {
      const withAddress: string = queueGuide({
        system,
        destination: "orders",
        brokerAddress: "broker-1.internal:6650",
      });
      expect(withAddress).not.toContain("broker-1.internal");
      expect(yamlBlocks(withAddress)).toEqual(
        yamlBlocks(queueGuide({ system, destination: "orders" })),
      );
    },
  );

  test("BullMQ's gauge observes this queue", () => {
    expect(
      queueGuide({ system: "bullmq", destination: 'emails "urgent"' }),
    ).toContain('const queue = new Queue("emails \\"urgent\\"",');
  });
});

describe("values from data never break a block", () => {
  test("a key or URL with YAML-significant characters parses back exactly", () => {
    const vars: { oneuptimeUrl: string; apiKey: string } = {
      oneuptimeUrl: "https://one: uptime.example.com #x",
      apiKey: 'a"b: #c \\ d',
    };
    for (const system of SYSTEMS) {
      for (const config of yamlBlocks(
        getMessageQueueSystemGuideMarkdown(vars, system),
      )) {
        expect(config["exporters"]["otlphttp"]).toEqual({
          endpoint: `${vars.oneuptimeUrl}/otlp`,
          headers: { "x-oneuptime-token": vars.apiKey },
        });
      }
    }
  });

  test("the unconfigured placeholders still parse", () => {
    const vars: { oneuptimeUrl: string; apiKey: string } = {
      oneuptimeUrl: "<YOUR_ONEUPTIME_URL>",
      apiKey: "<YOUR_API_KEY>",
    };
    const config: YamlMap = yamlBlocks(
      getMessageQueueSystemGuideMarkdown(vars, "kafka"),
    )[0]!;
    expect(config["exporters"]["otlphttp"]["endpoint"]).toBe(
      "<YOUR_ONEUPTIME_URL>/otlp",
    );
    expect(
      config["exporters"]["otlphttp"]["headers"]["x-oneuptime-token"],
    ).toBe("<YOUR_API_KEY>");
  });

  test("a destination with backticks stays one code span", () => {
    expect(markdownInlineCode("orders")).toBe("`orders`");
    expect(markdownInlineCode("a`b")).toBe("``a`b``");
    expect(markdownInlineCode("a``b`")).toBe("``` a``b` ```");
    expect(markdownInlineCode("`x")).toBe("`` `x ``");
    expect(queueGuide({ system: "kafka", destination: "we`ird" })).toContain(
      "## Connect ``we`ird``",
    );
  });
});

describe("broker address parsing", () => {
  test.each([
    ["kafka-1.internal:9092", { host: "kafka-1.internal", port: 9092 }],
    ["10.0.0.7", { host: "10.0.0.7", port: null }],
    [" rabbit ", { host: "rabbit", port: null }],
    ["a:65535", { host: "a", port: 65535 }],
    ["a:0", null],
    ["a:65536", null],
    ["[::1]:9092", null],
    ["tcp://kafka:9092", null],
    ["kafka-1,kafka-2", null],
    ["-kafka", null],
    ["", null],
    [null, null],
    [undefined, null],
  ])("%p → %p", (address: string | null | undefined, expected: unknown) => {
    expect(parseMessageQueueBrokerAddress(address)).toEqual(expected);
  });

  test.each([
    ["sqs.us-east-1.amazonaws.com", "us-east-1"],
    ["SQS.EU-WEST-1.AMAZONAWS.COM:443", "eu-west-1"],
    ["sns.us-gov-east-1.amazonaws.com", "us-gov-east-1"],
    ["sqs.amazonaws.com", null],
    ["queue.amazonaws.com", null],
    ["sqs.us-east-1.example.com", null],
    ["broker:9092", null],
    [null, null],
  ])(
    "the AWS region of %p is %p",
    (address: string | null, region: unknown) => {
      expect(getAwsRegionFromBrokerAddress(address)).toBe(region);
    },
  );
});
