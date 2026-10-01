import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import {
  DEFAULT_MESSAGE_QUEUE_GUIDE_SYSTEM,
  MESSAGE_QUEUE_DOCS_PATH,
  MESSAGE_QUEUE_GUIDE_MIN_SPANS,
  MESSAGE_QUEUE_MIN_SPANS_ENV_NAME,
  MESSAGE_QUEUE_SETUP_GUIDE_OPTIONS,
  MESSAGE_QUEUE_SUPPORTED_SYSTEMS_ANCHOR,
  MessageQueueChartedMetricRow,
  MessageQueueDocumentationTarget,
  getAwsRegionFromBrokerAddress,
  getAzureMonitorCollectedMetricNames,
  getMessageQueueChartedMetricRows,
  getMessageQueueDestinationAttributeKeys,
  getMessageQueueDocsUrl,
  getMessageQueueGuideReceivers,
  getMessageQueueGuideSystems,
  getMessageQueueMetricTypeLabel,
  getMessageQueueSetupGuide,
  getMessagingInstrumentationNotes,
  markdownInlineCode,
  parseMessageQueueBrokerAddress,
  resolveMessageQueueGuideSystem,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/DocumentationMarkdown";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SETUP_GUIDE_URL_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideLink,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  getSetupGuideCodeBlocks,
  getSetupGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  MESSAGE_QUEUE_DISCOVERY_CLOUD_METRIC_WINDOW_MINUTES,
  MESSAGE_QUEUE_DISCOVERY_INTERVAL_MINUTES,
  MESSAGE_QUEUE_DISCOVERY_WINDOW_MINUTES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueOverviewPresentation";
import {
  canBrokerMetricsReachMessageQueue,
  getMessageQueueSystemLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/MessageQueuePresentation";
import {
  MESSAGING_SYSTEMS,
  MessagingBrokerMetricsSource,
  MessagingSystemDescriptor,
  getMessagingBrokerMetricsReceivers,
  getMessagingBrokerMetricsSource,
} from "../../../Types/MessageQueue/MessagingSystem";
import {
  MessageQueueMetricDescriptor,
  getMessageQueueMetricsForSystem,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import {
  DEFAULT_MESSAGE_QUEUE_MIN_SPANS,
  MESSAGE_QUEUE_MIN_SPANS_ENV,
} from "../../../Server/Utils/Telemetry/MessageQueueDiscovery";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import slugify from "../../../Server/Types/MarkdownSlugify";

/*
 * The in-app Queues setup guide, on the shared SetupGuide layout: the
 * ingestion key as step 1, then instrument the applications, send the
 * broker's metrics (or report BullMQ's depth) and check it worked, with the
 * identity, the charted metrics and JMS's ActiveMQ scraper under Advanced
 * and the docs page's troubleshooting entries under Troubleshooting.
 *
 * A collector config that does not parse, or that drifted from the one the
 * docs page validated, installs a collector that silently sends nothing —
 * so these tests hold every block the guide emits to the docs page's own
 * blocks (each validated with `otelcol-contrib validate` on
 * otel/opentelemetry-collector-contrib 0.161.0), check every YAML block
 * parses and exports to the viewer's endpoint with the viewer's key, and
 * pin the catalog facts the guide states: receivers, Prometheus ports and
 * paths, the Azure and Pub/Sub metric lists, the charted metrics table, how
 * a queue's own telemetry finds it, the numbers discovery runs on and the
 * docs page's troubleshooting.
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

interface GuideVariables {
  oneuptimeUrl: string;
  apiKey: string;
}

// The values the docs page writes where the in-app guide interpolates.
const DOCS_VARS: GuideVariables = {
  oneuptimeUrl: "https://oneuptime.com",
  apiKey: "YOUR_TELEMETRY_INGESTION_TOKEN",
};

const VARS: GuideVariables = {
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

// Markdown without its code blocks: the prose a reader reads.
function proseOf(markdown: string): string {
  return markdown.replace(/```[^\n]*\n[\s\S]*?```/g, "");
}

/* A section of the docs page: its heading down to the next heading of the same level or above. */
function docsSectionAt(heading: string): string {
  const level: number = heading.indexOf(" ");
  const marker: string = `\n${heading}\n`;
  const start: number = QUEUES_DOC.indexOf(marker);
  expect({ heading, found: start > -1 }).toEqual({ heading, found: true });
  const rest: string = QUEUES_DOC.slice(start + marker.length);
  const end: number = rest.search(new RegExp(`\\n#{2,${level}} `));
  return end === -1 ? rest : rest.slice(0, end);
}

/* A system's broker-metrics section on the docs page: its "### <name>" heading down to the next heading. */
function docsSection(displayName: string): string {
  return docsSectionAt(`### ${displayName}`);
}

const DOCS_SLUGS: Set<string> = ((): Set<string> => {
  const slugs: Set<string> = new Set<string>();
  for (const line of QUEUES_DOC.split("\n")) {
    const heading: RegExpMatchArray | null = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      slugs.add(slugify(heading[1]!));
    }
  }
  return slugs;
})();

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

function productContent(
  system: string,
  vars: GuideVariables = VARS,
): SetupGuideContent {
  return getMessageQueueSetupGuide({
    oneuptimeUrl: vars.oneuptimeUrl,
    apiKey: vars.apiKey,
    system: system,
  });
}

function queueContent(
  target: MessageQueueDocumentationTarget,
  vars: GuideVariables = VARS,
): SetupGuideContent {
  return getMessageQueueSetupGuide({
    oneuptimeUrl: vars.oneuptimeUrl,
    apiKey: vars.apiKey,
    system: target.system,
    queue: target,
  });
}

// The whole product guide as one markdown document, as the reader reads it.
function productGuide(system: string, vars: GuideVariables = VARS): string {
  return getSetupGuideMarkdown(productContent(system, vars));
}

function queueGuide(
  target: MessageQueueDocumentationTarget,
  vars: GuideVariables = VARS,
): string {
  return getSetupGuideMarkdown(queueContent(target, vars));
}

function stepTitles(content: SetupGuideContent): Array<string> {
  return content.steps.map((step: SetupGuideStep): string => {
    return step.title;
  });
}

function topicTitles(
  topics: Array<SetupGuideTopic> | undefined,
): Array<string> {
  return (topics || []).map((topic: SetupGuideTopic): string => {
    return topic.title;
  });
}

function findTopic(
  topics: Array<SetupGuideTopic> | undefined,
  title: string,
): SetupGuideTopic {
  const topic: SetupGuideTopic | undefined = (topics || []).find(
    (candidate: SetupGuideTopic): boolean => {
      return candidate.title === title;
    },
  );
  expect({ title, found: Boolean(topic) }).toEqual({ title, found: true });
  return topic!;
}

function findStep(content: SetupGuideContent, title: string): SetupGuideStep {
  const step: SetupGuideStep | undefined = content.steps.find(
    (candidate: SetupGuideStep): boolean => {
      return candidate.title === title;
    },
  );
  expect({ title, found: Boolean(step) }).toEqual({ title, found: true });
  return step!;
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

// A system OneUptime does not know, as its spans name it.
const LONG_TAIL_QUEUE: MessageQueueDocumentationTarget = {
  system: "ibmmq",
  destination: "DEV.QUEUE.1",
};

/*
 * Every guide the dashboard can show: each catalog system's product guide,
 * a prefilled queue of each, and a long-tail system's product and queue
 * guide.
 */
const ALL_GUIDES: Array<[string, SetupGuideContent]> = [
  ...SYSTEMS.flatMap((system: string): Array<[string, SetupGuideContent]> => {
    return [
      [`${system} (product)`, productContent(system)],
      [`${system} (queue)`, queueContent(sampleQueue(system))],
    ];
  }),
  ["ibmmq (product)", productContent("ibmmq")],
  ["ibmmq (queue)", queueContent(LONG_TAIL_QUEUE)],
];

describe("every guide's YAML parses and exports to the viewer's OneUptime", () => {
  test.each(ALL_GUIDES)("%s", (_name: string, content: SetupGuideContent) => {
    const markdown: string = getSetupGuideMarkdown(content);
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
    expect(markdown).not.toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
    expect(markdown).not.toContain(SETUP_GUIDE_URL_PLACEHOLDER);
    expect(markdown).not.toContain("YOUR_TELEMETRY_INGESTION_TOKEN");
  });

  test.each(ALL_GUIDES)(
    "%s: the blocks a reader copies are the ones read here",
    (_name: string, content: SetupGuideContent) => {
      expect(
        getSetupGuideCodeBlocks(content).map((body: string): string => {
          return body.replace(/\n$/, "");
        }),
      ).toEqual(
        codeBlocks(getSetupGuideMarkdown(content)).map(
          (block: CodeBlock): string => {
            return block.body;
          },
        ),
      );
    },
  );
});

describe("every block equals the docs page's validated one", () => {
  test.each(SYSTEMS)("%s", (system: string) => {
    const descriptor: MessagingSystemDescriptor = descriptorOf(system);
    const content: SetupGuideContent = productContent(system, DOCS_VARS);
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

    const guideBlocks: Array<CodeBlock> = codeBlocks(
      getSetupGuideMarkdown(content),
    ).filter((block: CodeBlock): boolean => {
      return !isSdkEnvironmentBlock(block);
    });

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
        productGuide(system),
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
    const content: SetupGuideContent = productContent(system);
    const configs: Array<YamlMap> = yamlBlocks(getSetupGuideMarkdown(content));
    expect(configs).toHaveLength(1);
    // The config is the broker step's.
    expect(
      yamlBlocks(findStep(content, "Send the broker's metrics").markdown || ""),
    ).toEqual(configs);

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
      const config: YamlMap = yamlBlocks(productGuide(system))[0]!;
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
    const config: YamlMap = yamlBlocks(productGuide("pulsar"))[0]!;
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

      const config: YamlMap = yamlBlocks(productGuide(system))[0]!;
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
    const config: YamlMap = yamlBlocks(productGuide("gcp_pubsub"))[0]!;
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
    const content: SetupGuideContent = productContent("activemq");
    const markdown: string = getSetupGuideMarkdown(content);
    const scraper: CodeBlock | undefined = codeBlocks(
      findStep(content, "Send the broker's metrics").markdown || "",
    ).find((block: CodeBlock): boolean => {
      return block.body.includes("java -jar opentelemetry-jmx-scraper.jar");
    });
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

/*
 * How late the guide's `aws_cloudwatch` receiver delivers. It asks
 * CloudWatch, once per `collection_interval`, for the whole periods that
 * ended by now - `delay`, each point stamped with its period's start
 * (receiver/awscloudwatchreceiver metrics.go @v0.161.0): right after a
 * scrape the newest point is delay + period old, just before the next one
 * delay + 2 × period + collection_interval. The guide states that for the
 * configuration it prints, in the docs page's words, and sends whoever
 * builds a monitor over those metrics to Late metrics under Alerting.
 */
describe("how late CloudWatch's metrics arrive", () => {
  // "10m" → 10, "30s" → 0.5.
  function minutesOf(value: unknown): number {
    const match: RegExpMatchArray | null = String(value).match(/^(\d+)(s|m)$/);
    expect({ value, duration: Boolean(match) }).toEqual({
      value,
      duration: true,
    });
    const amount: number = Number(match![1]);
    return match![2] === "m" ? amount : amount / 60;
  }

  function delayLine(markdown: string): string {
    const lines: Array<string> = markdown
      .split("\n")
      .filter((line: string): boolean => {
        return line.includes("`delay` waits for CloudWatch");
      });
    expect(lines).toHaveLength(1);
    return lines[0]!;
  }

  test.each(["aws_sqs", "aws.sns"])(
    "%s's guides state it for the configuration they print, as the docs page does",
    (system: string) => {
      const guides: Array<[string, SetupGuideContent]> = [
        ["a queue's", productContent(system)],
        ["this queue's", queueContent(sampleQueue(system))],
      ];
      for (const [whose, content] of guides) {
        const markdown: string = getSetupGuideMarkdown(content);
        const configs: Array<YamlMap> = yamlBlocks(markdown);
        expect(configs).toHaveLength(1);
        const receivers: Array<YamlMap> = Object.entries(
          configs[0]!["receivers"] as YamlMap,
        )
          .filter(([id]: [string, unknown]): boolean => {
            return id.split("/")[0] === "aws_cloudwatch";
          })
          .map(([, receiver]: [string, unknown]): YamlMap => {
            return receiver as YamlMap;
          });
        expect(receivers).toHaveLength(1);

        const metrics: YamlMap = receivers[0]!["metrics"];
        const period: number = minutesOf(metrics["period"]);
        const delay: number = minutesOf(metrics["delay"]);
        const interval: number = minutesOf(metrics["collection_interval"]);
        const late: string = `${delay + period} to ${
          delay + 2 * period + interval
        } minutes late`;

        // Said in the broker step, next to the config.
        expect(
          delayLine(findStep(content, "Send the broker's metrics").markdown!),
        ).toBe(
          `- \`delay\` waits for CloudWatch to publish a period, so with this configuration ${whose} broker metrics arrive ${late}: a monitor over them needs a longer window (see **Late metrics** under [Alerting](${MESSAGE_QUEUE_DOCS_PATH}#alerting)).`,
        );
        expect(delayLine(markdown)).toContain(late);
        expect(markdown).not.toContain("minutes behind");

        // Troubleshooting says the same of the same delay.
        expect(
          findTopic(content.troubleshooting, "Broker health stays empty")
            .markdown,
        ).toContain(
          `\`aws_cloudwatch\` waits \`delay\` (${delay} minutes) for CloudWatch to publish, so its points arrive ${late}.`,
        );

        // The docs page says the same of the same configuration.
        expect(delayLine(docsSection("Amazon SQS"))).toContain(
          `so with this configuration a queue's broker metrics arrive ${late}: a monitor over them needs a longer window (see **Late metrics** under [Alerting](#alerting)).`,
        );
      }

      // A queue's check step says when its Broker health fills in.
      const queueCheck: SetupGuideStep = findStep(
        queueContent(sampleQueue(system)),
        "Check that this queue fills in",
      );
      expect(queueCheck.markdown).toContain(
        "with the configuration in step 3, CloudWatch's arrive 11 to 17 minutes late.",
      );
    },
  );

  test("the Alerting link lands on the section that says how long a window to use", () => {
    const alerting: string = docsSectionAt("## Alerting");
    expect(alerting).toContain("**Late metrics.**");
    expect(alerting).toContain("needs a window longer than that");
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

  test.each(SYSTEMS)(
    "%s's guide renders that table under Advanced",
    (system: string) => {
      const content: SetupGuideContent = productContent(system);
      const topic: SetupGuideTopic = findTopic(
        content.advanced,
        "What a queue's page charts",
      );
      expect(
        findTopic(
          queueContent(sampleQueue(system)).advanced,
          "What this queue's page charts",
        ).markdown.length,
      ).toBeGreaterThan(0);

      const rows: Array<MessageQueueChartedMetricRow> =
        getMessageQueueChartedMetricRows(system);
      for (const row of rows) {
        expect(topic.markdown).toContain(
          `| ${row.metric} | ${row.title} | ${row.type} |`,
        );
      }
      if (rows.length > 0) {
        // Every row but a counter's: MessageQueueBrokerHealth.test holds it.
        expect(topic.markdown).toContain(
          "under **Broker health**, and each gauge and each count per period has **Create monitor**",
        );
      } else {
        expect(topic.markdown).toContain(
          `OneUptime charts no broker metrics for ${descriptorOf(system).displayName} under **Broker health**`,
        );
        expect(topic.markdown).toContain("**Metrics** explorer");
        expect(topic.markdown).toContain("**Metrics** tab");
      }
      // The table is reference material: never in a step.
      for (const step of content.steps) {
        expect(step.markdown || "").not.toContain("| Metric | Shown as |");
      }
    },
  );

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
    const topic: SetupGuideTopic = findTopic(
      queueContent(sampleQueue("jms")).advanced,
      "What this queue's page charts",
    );
    expect(topic.markdown).toContain(
      "Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue",
    );
    expect(topic.markdown).toContain(getMessageQueueDocsUrl("activemq"));
  });
});

describe("the product guide", () => {
  test.each(SYSTEMS)(
    "%s opens with how its queues appear",
    (system: string) => {
      const descriptor: MessagingSystemDescriptor = descriptorOf(system);
      const content: SetupGuideContent = productContent(system);
      const intro: string = content.intro || "";
      const markdown: string = getSetupGuideMarkdown(content);

      // The card's title names the guide: the intro starts with its first sentence.
      expect(
        intro.startsWith(
          `${descriptor.displayName} queues appear in OneUptime on their own`,
        ),
      ).toBe(true);
      expect(intro).toContain("**Queues → Create Queue**");
      expect(intro).toContain(
        `\`messaging.system\` = ${markdownInlineCode(descriptor.system)}`,
      );
      for (const alias of descriptor.aliases) {
        expect(intro).toContain(markdownInlineCode(alias));
      }
      /*
       * Broker metrics are promised only where they name a queue: a system
       * with curated metrics. A collector path alone is not enough — NATS
       * and Azure Event Grid have one, and their metrics attach to no queue.
       */
      expect(markdown.includes("and the broker's own metrics")).toBe(
        getMessageQueueMetricsForSystem(system).length > 0,
      );
      expect(content.links).toContainEqual({
        title: `${descriptor.displayName} in the Queues documentation`,
        url: `${MESSAGE_QUEUE_DOCS_PATH}#${descriptor.docsAnchor}`,
      });
      /*
       * The catalog's own note or reason, verbatim: the note in the broker
       * step, BullMQ's reason in the step that reports its depth, and the
       * reason of a system with no step for it in the intro.
       */
      const source: MessagingBrokerMetricsSource = descriptor.brokerMetrics;
      if (source.kind !== "none") {
        expect(
          findStep(content, "Send the broker's metrics").markdown,
        ).toContain(source.note);
      } else if (system === "bullmq") {
        expect(
          findStep(content, "Report the queue's depth").markdown,
        ).toContain(source.reason);
      } else {
        expect(intro).toContain(source.reason);
      }
    },
  );

  test("the steps follow the source", () => {
    expect(stepTitles(productContent("kafka"))).toEqual([
      "Instrument the applications that use them",
      "Send the broker's metrics",
      "Check that your queues appear",
    ]);
    expect(stepTitles(productContent("bullmq"))).toEqual([
      "Tag BullMQ's telemetry in your collector",
      "Report the queue's depth",
      "Check that your queues appear",
    ]);
    // No ready-made metrics path: no broker step, and the reason up front.
    expect(stepTitles(productContent("jms"))).toEqual([
      "Instrument the applications that use them",
      "Check that your queues appear",
    ]);
    expect(stepTitles(queueContent(LONG_TAIL_QUEUE))).toEqual([
      "Instrument the applications that use it",
      "Check that this queue fills in",
    ]);
  });

  test("JMS's ActiveMQ scraper is an Advanced topic, not a step", () => {
    for (const content of [
      productContent("jms"),
      queueContent(sampleQueue("jms")),
    ]) {
      const topic: SetupGuideTopic = findTopic(
        content.advanced,
        "If the broker is Apache ActiveMQ",
      );
      expect(topic.markdown).toContain(
        "java -jar opentelemetry-jmx-scraper.jar",
      );
      expect(topic.markdown).toContain("ACTIVEMQ_SUNJMX_START");
      expect(topic.markdown).toContain(
        "which from then on shows as an Apache ActiveMQ queue.",
      );
      for (const step of content.steps) {
        expect(step.markdown || "").not.toContain("opentelemetry-jmx-scraper");
      }
    }
    // Only JMS gets it: ActiveMQ's own guide has the scraper as its broker step.
    for (const system of SYSTEMS) {
      expect(
        topicTitles(productContent(system).advanced).includes(
          "If the broker is Apache ActiveMQ",
        ),
      ).toBe(system === "jms");
    }
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

  test("every docs link any guide carries lands on a heading of the docs page", () => {
    const anchors: Set<string> = new Set<string>();
    for (const [, content] of ALL_GUIDES) {
      for (const link of getSetupGuideMarkdown(content).matchAll(
        /\]\(\/docs\/telemetry\/queues#([^)\s]*)\)/g,
      )) {
        anchors.add(link[1]!);
      }
    }

    // The system sections, the fallback, the Metric Stream, Late metrics and troubleshooting.
    expect(anchors).toContain("amazon-sqs");
    expect(anchors).toContain("alerting");
    expect(anchors).toContain("broker-health-stays-empty");
    expect(anchors).toContain("the-auto-create-budget");
    expect(anchors).toContain(MESSAGE_QUEUE_SUPPORTED_SYSTEMS_ANCHOR);
    for (const anchor of anchors) {
      expect({ anchor, resolves: DOCS_SLUGS.has(anchor) }).toEqual({
        anchor,
        resolves: true,
      });
    }
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

describe("the picker", () => {
  test("offers one option per catalog system, in the guide's order, keyed by messaging.system", () => {
    expect(MESSAGE_QUEUE_SETUP_GUIDE_OPTIONS).toEqual(
      getMessageQueueGuideSystems().map(
        (descriptor: MessagingSystemDescriptor): SetupGuideOption => {
          return {
            key: descriptor.system,
            label: descriptor.displayName,
            description: `messaging.system: ${descriptor.system}`,
          };
        },
      ),
    );
    expect(MESSAGE_QUEUE_SETUP_GUIDE_OPTIONS).toHaveLength(
      MESSAGING_SYSTEMS.length,
    );
  });

  test("has no groups or badges, and one-line tooltips", () => {
    for (const option of MESSAGE_QUEUE_SETUP_GUIDE_OPTIONS) {
      expect(option.group).toBeUndefined();
      expect(option.badge).toBeUndefined();
      expect(option.description).not.toContain("\n");
    }
  });

  test("opens on Kafka, which it offers", () => {
    expect(DEFAULT_MESSAGE_QUEUE_GUIDE_SYSTEM).toBe("kafka");
    expect(
      MESSAGE_QUEUE_SETUP_GUIDE_OPTIONS.map((option: SetupGuideOption) => {
        return option.key;
      }),
    ).toContain(DEFAULT_MESSAGE_QUEUE_GUIDE_SYSTEM);
  });

  test("a system resolves through its aliases, and an unknown one to Kafka", () => {
    expect(resolveMessageQueueGuideSystem("azure_servicebus")).toBe(
      "servicebus",
    );
    expect(resolveMessageQueueGuideSystem("AmazonSQS")).toBe("aws_sqs");
    expect(resolveMessageQueueGuideSystem("ibmmq")).toBe("kafka");
    expect(resolveMessageQueueGuideSystem(undefined)).toBe("kafka");
    for (const option of MESSAGE_QUEUE_SETUP_GUIDE_OPTIONS) {
      expect(resolveMessageQueueGuideSystem(option.key)).toBe(option.key);
    }
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
      const markdown: string = productContent(system).steps[0]!.markdown || "";
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
      expect(productGuide(system)).toContain(
        "JMS spans say `jms` whichever broker is behind them",
      );
    }
  });

  test("the AWS notes ask .NET for the latest attribute set", () => {
    for (const system of ["aws_sqs", "aws.sns"]) {
      expect(productGuide(system)).toContain(
        "SemanticConventionVersion.Latest",
      );
    }
  });

  test("every guide ends its client list with the generic advice for its own system", () => {
    for (const system of SYSTEMS) {
      if (system === "bullmq") {
        continue;
      }
      expect(productContent(system).steps[0]!.markdown).toContain(
        `set \`messaging.system\` = ${markdownInlineCode(system)}, \`messaging.destination.name\` and the span kind`,
      );
    }
  });

  test("BullMQ gets the transform that adds the keys OneUptime reads", () => {
    const content: SetupGuideContent = productContent("bullmq");
    const transform: YamlMap = yamlBlocks(
      findStep(content, "Tag BullMQ's telemetry in your collector").markdown ||
        "",
    )[0]!;
    expect(Object.keys(transform["service"]["pipelines"]).sort()).toEqual([
      "metrics",
      "traces",
    ]);
    expect(
      transform["processors"]["transform/bullmq"]["trace_statements"].join(
        "\n",
      ),
    ).toContain('set(span.attributes["messaging.system"], "bullmq")');
    expect(findStep(content, "Report the queue's depth").markdown).toContain(
      'createObservableGauge("queue.size"',
    );
  });

  test("every SDK environment block keeps the note that the token is a secret", () => {
    for (const [, content] of ALL_GUIDES) {
      const markdown: string = getSetupGuideMarkdown(content);
      if (codeBlocks(markdown).some(isSdkEnvironmentBlock)) {
        expect(markdown).toContain(
          "> **This token is a secret.** Use a **Server** ingestion key",
        );
        expect(markdown).toContain(
          "Never put a Server key in browser JavaScript",
        );
      }
    }
  });
});

describe("a queue's own guide", () => {
  test("says how its telemetry finds it", () => {
    const content: SetupGuideContent = queueContent({
      system: "kafka",
      destination: "orders.created",
      brokerAddress: "",
    });
    expect(
      (content.intro || "").startsWith(
        "This is the Apache Kafka queue `orders.created`.",
      ),
    ).toBe(true);
    expect(content.intro).toContain(
      "Everything below is prefilled for this queue.",
    );
    const identity: SetupGuideTopic = findTopic(
      content.advanced,
      "How telemetry finds this queue",
    );
    expect(identity.markdown).toContain(
      "- **Spans**: `messaging.system` = `kafka` and the destination `orders.created`",
    );
    expect(identity.markdown).toContain(
      "- **Broker metrics**: `topic` = `orders.created`.",
    );
    expect(identity.markdown).toContain(
      "Names are compared without regard to case.",
    );
  });

  test("the product guide has no identity topic: it names no queue", () => {
    for (const system of SYSTEMS) {
      expect(topicTitles(productContent(system).advanced)).not.toContain(
        "How telemetry finds this queue",
      );
      expect(topicTitles(queueContent(sampleQueue(system)).advanced)[0]).toBe(
        "How telemetry finds this queue",
      );
    }
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
    const content: SetupGuideContent = queueContent(LONG_TAIL_QUEUE);
    const markdown: string = getSetupGuideMarkdown(content);
    expect(content.intro).toContain("This is the ibmmq queue `DEV.QUEUE.1`.");
    expect(markdown).toContain("`messaging.system` = `ibmmq`");
    // The catalog's reason is in the intro: there is no broker step to hold it.
    expect(content.intro).toContain(
      "OneUptime does not know this messaging system",
    );
    expect(yamlBlocks(markdown)).toEqual([]);
    expect(markdown).toContain(
      "(/docs/telemetry/queues#supported-messaging-systems)",
    );
    expect(content.links).toEqual([
      {
        title: "Supported messaging systems",
        url: "/docs/telemetry/queues#supported-messaging-systems",
      },
      { title: "Queues documentation", url: "/docs/telemetry/queues" },
    ]);
  });

  test("a queue with no system still renders", () => {
    const content: SetupGuideContent = queueContent({
      system: null,
      destination: "x",
    });
    const markdown: string = getSetupGuideMarkdown(content);
    expect(content.intro).toContain("This is the — queue `x`.");
    expect(markdown).toContain("`messaging.system` = `<system>`");
    expect(markdown).toContain(
      "- **Spans**: `messaging.system` = `<system>` and the destination `x`",
    );
    // No empty code span (two backticks that are not part of a fence).
    expect(markdown).not.toMatch(/(^|[^`])``([^`]|$)/m);
  });

  /*
   * The guide names a queue's system as every other Queues page does
   * (getMessageQueueSystemLabel): the list's System cell, the Overview and
   * the Documentation tab's own title all read "—" for a queue without one,
   * so its guide does too rather than a wording of its own.
   */
  test.each([null, undefined, "", "   "])(
    "a queue whose system is %p is named as the list names it",
    (system: string | null | undefined) => {
      const label: string = getMessageQueueSystemLabel(system);
      expect(label).toBe("—");

      const markdown: string = queueGuide({ system: system, destination: "x" });
      expect(markdown).toContain(`This is the ${label} queue \`x\`.`);
      expect(markdown).toContain(
        `OneUptime charts no broker metrics for ${label} under **Broker health**.`,
      );
      expect(markdown).not.toContain("the this messaging system");
      expect(markdown).not.toContain("for this messaging system under");
    },
  );

  test.each([
    ["kafka", "Apache Kafka"],
    ["azure_servicebus", "Azure Service Bus"],
    ["IBMMQ", "ibmmq"],
  ])(
    "a queue of %p is named %p, as the list names it",
    (system: string, label: string) => {
      expect(
        queueGuide({ system: system, destination: "x", brokerScope: "shop" }),
      ).toContain(`This is the ${label} queue \`x\``);
    },
  );
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
      const productGuideContent: SetupGuideContent = productContent(system);
      const queueGuideContent: SetupGuideContent = queueContent(
        sampleQueue(system),
      );

      expect(productGuideContent.intro).toContain(
        `${displayName} queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them.`,
      );
      expect(queueGuideContent.intro).toContain(
        "and from metrics that carry its `messaging.system` and `messaging.destination.name`.",
      );
      for (const content of [productGuideContent, queueGuideContent]) {
        const markdown: string = getSetupGuideMarkdown(content);
        expect(markdown).not.toContain("the broker's own metrics");
        expect(markdown).not.toContain("Overview charts these");
        expect(markdown).not.toContain("creates its queue too");
        // The collector config stays: its metrics are worth exploring.
        const broker: SetupGuideStep = findStep(
          content,
          "Send the broker's metrics",
        );
        expect(broker.description).toBe(
          "No queue page charts them: they arrive in the Metrics explorer.",
        );
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
      const content: SetupGuideContent = queueContent({
        system,
        destination: "orders",
        brokerScope: "",
        brokerAddress: "localhost:5672",
      });
      const markdown: string = getSetupGuideMarkdown(content);
      expect(markdown).toContain(
        "and from metrics that carry its `messaging.system` and `messaging.destination.name`.",
      );
      expect(markdown).not.toContain("the broker's own metrics");
      expect(markdown).not.toContain("The queue's Overview charts these");
      expect(markdown).toContain(
        "This queue has no namespace, so Azure Monitor's metrics never reach it: they chart under **Broker health** on the same destination's queue in their namespace, where each gauge and each count per period has **Create monitor**.",
      );
      expect(findStep(content, "Send the broker's metrics").description).toBe(
        "They chart on the same destination's queue in its namespace, not on this one.",
      );
      expect(
        findStep(content, "Check that this queue fills in").markdown,
      ).toContain(
        "Azure Monitor's metrics chart under **Broker health** on the same destination's queue in its namespace, not on this one.",
      );
      // The table still says what that namespaced queue charts.
      for (const row of getMessageQueueChartedMetricRows(system)) {
        expect(markdown).toContain(
          `| ${row.metric} | ${row.title} | ${row.type} |`,
        );
      }

      const namespaced: SetupGuideContent = queueContent({
        system,
        destination: "orders",
        brokerScope: "shop-prod",
      });
      const namespacedMarkdown: string = getSetupGuideMarkdown(namespaced);
      expect(namespacedMarkdown).toContain(
        "and from the broker's own metrics.",
      );
      expect(namespacedMarkdown).toContain(
        "The queue's Overview charts these under **Broker health**",
      );
      expect(namespacedMarkdown).not.toContain("This queue has no namespace");
      expect(
        findStep(namespaced, "Check that this queue fills in").markdown,
      ).toContain(
        "**Broker health** on the Overview fills in from the broker's metrics as they arrive.",
      );
    },
  );

  test("only the namespace systems wait up to a day for a new namespace", () => {
    const waiting: Array<string> = [];
    for (const system of SYSTEMS) {
      for (const markdown of [
        productGuide(system),
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

  test("a JMS queue's ActiveMQ topic scrapes the broker its telemetry reported", () => {
    const topic: SetupGuideTopic = findTopic(
      queueContent({
        system: "jms",
        destination: "orders",
        brokerAddress: "amq.internal:61616",
      }).advanced,
      "If the broker is Apache ActiveMQ",
    );
    expect(topic.markdown).toContain(
      "export OTEL_JMX_SERVICE_URL=service:jmx:rmi:///jndi/rmi://amq.internal:1099/jmxrmi",
    );
    expect(topic.markdown).toContain(
      "Its metrics join this queue, which from then on shows as an Apache ActiveMQ queue.",
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
    const vars: GuideVariables = {
      oneuptimeUrl: "https://one: uptime.example.com #x",
      apiKey: 'a"b: #c \\ d',
    };
    for (const system of SYSTEMS) {
      for (const config of yamlBlocks(productGuide(system, vars))) {
        expect(config["exporters"]["otlphttp"]).toEqual({
          endpoint: `${vars.oneuptimeUrl}/otlp`,
          headers: { "x-oneuptime-token": vars.apiKey },
        });
      }
    }
  });

  test("the unconfigured placeholders still parse", () => {
    const vars: GuideVariables = {
      oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
      apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    };
    const config: YamlMap = yamlBlocks(productGuide("kafka", vars))[0]!;
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
    expect(
      queueContent({ system: "kafka", destination: "we`ird" }).intro,
    ).toContain("This is the Apache Kafka queue ``we`ird``.");
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

// ---- the SetupGuide layout ---------------------------------------------------

// The title of the link to a system's docs section.
function getMessagingSystemTitle(system: string): string {
  const descriptor: MessagingSystemDescriptor | undefined =
    MESSAGING_SYSTEMS.find((candidate: MessagingSystemDescriptor): boolean => {
      return candidate.system === system;
    });
  return descriptor
    ? `${descriptor.displayName} in the Queues documentation`
    : "Supported messaging systems";
}

describe("every guide follows the SetupGuide layout", () => {
  test.each(ALL_GUIDES)(
    "%s: step 1 shows the OTLP endpoint and asks for a Server key",
    (_name: string, content: SetupGuideContent) => {
      expect(content.keyStep?.endpointLabel).toBe("OTLP Endpoint");
      expect(content.keyStep?.endpointValue).toBe(`${VARS.oneuptimeUrl}/otlp`);
      expect(content.keyStep?.endpointHint).toContain(
        "add /v1/traces, /v1/metrics and /v1/logs to it",
      );
      const description: string = content.keyStep?.description || "";
      expect(description).toMatch(
        /^Your applications' OpenTelemetry exporters\b/,
      );
      expect(description).toContain("a Server key");
      expect(description).toContain("never in browser JavaScript");
    },
  );

  /*
   * Step 1 names who sends with the key, and only what this guide sets up:
   * the collector that reads the broker where the broker step runs one, the
   * JMX Scraper where the guide runs that, and BullMQ's tagging collector.
   * A guide with neither (a long-tail system) names only the applications.
   */
  test.each(ALL_GUIDES)(
    "%s: step 1 names only the senders this guide sets up",
    (name: string, content: SetupGuideContent) => {
      const system: string = name.split(" ")[0]!;
      const description: string = content.keyStep?.description || "";
      const brokerStep: SetupGuideStep | undefined = content.steps.find(
        (step: SetupGuideStep): boolean => {
          return step.title === "Send the broker's metrics";
        },
      );
      const runsCollectorForBroker: boolean = yamlBlocks(
        brokerStep?.markdown || "",
      ).some((block: YamlMap): boolean => {
        return Boolean(block["receivers"]);
      });
      const runsJmxScraper: boolean = getSetupGuideMarkdown(content).includes(
        "OTEL_JMX_TARGET_SYSTEM=activemq",
      );

      expect({
        system,
        collector: description.includes("the collector that reads your broker"),
      }).toEqual({ system, collector: runsCollectorForBroker });
      expect({
        system,
        scraper: description.includes("OpenTelemetry JMX Scraper"),
      }).toEqual({ system, scraper: runsJmxScraper });
      expect({
        system,
        bullmq: description.includes(
          "the collector that tags BullMQ's telemetry",
        ),
      }).toEqual({ system, bullmq: system === "bullmq" });
      if (system === "jms") {
        expect(description).toContain(
          "the OpenTelemetry JMX Scraper if the broker is Apache ActiveMQ",
        );
      }
      if (system === "ibmmq") {
        expect(description).toMatch(
          /^Your applications' OpenTelemetry exporters send to OneUptime with this key/,
        );
      }
    },
  );

  test.each(ALL_GUIDES)(
    "%s: a few steps, each with a one-line description, ending with the check",
    (name: string, content: SetupGuideContent) => {
      const isQueue: boolean = name.endsWith("(queue)");
      expect(content.steps.length).toBeGreaterThanOrEqual(2);
      expect(content.steps.length).toBeLessThanOrEqual(3);
      expect(content.steps[content.steps.length - 1]!.title).toBe(
        isQueue
          ? "Check that this queue fills in"
          : "Check that your queues appear",
      );
      for (const step of content.steps) {
        expect((step.description || "").length).toBeGreaterThan(0);
        expect(step.description).not.toContain("\n");
        expect((step.markdown || "").length).toBeGreaterThan(0);
        // The card numbers the steps.
        expect(step.title).not.toMatch(/^\d/);
      }
    },
  );

  test.each(ALL_GUIDES)(
    "%s: every Advanced and Troubleshooting topic has a title, a plain one-line summary and a body",
    (_name: string, content: SetupGuideContent) => {
      const topics: Array<SetupGuideTopic> = [
        ...(content.advanced || []),
        ...(content.troubleshooting || []),
      ];
      expect((content.advanced || []).length).toBeGreaterThan(0);
      expect((content.troubleshooting || []).length).toBe(4);
      const titles: Array<string> = topicTitles(topics);
      expect(new Set(titles).size).toBe(titles.length);
      for (const topic of topics) {
        expect(topic.title.length).toBeGreaterThan(0);
        expect(topic.summary).toBeTruthy();
        // Summaries render as plain text, so no markdown.
        expect(topic.summary).not.toMatch(/[`*_[\]#<>|]/);
        expect(topic.summary).not.toContain("\n");
        expect(topic.markdown.trim().length).toBeGreaterThan(0);
      }
    },
  );

  test.each(ALL_GUIDES)(
    "%s: no leftover heading, numbering or unfilled value",
    (_name: string, content: SetupGuideContent) => {
      const markdown: string = getSetupGuideMarkdown(content);
      expect(markdown).not.toContain("## Connect");
      expect(markdown).not.toMatch(/^#{1,6} \d+\./m);
      expect(markdown).not.toContain("Full guide:");
      for (const bad of ["undefined", "null", "[object Object]", "NaN"]) {
        expect({ bad, found: proseOf(markdown).includes(bad) }).toEqual({
          bad,
          found: false,
        });
      }
      /*
       * The pieces carry no headings of their own (the card titles every
       * step and topic); `#` lines inside code blocks are comments.
       */
      const pieces: Array<string> = [
        content.intro || "",
        ...content.steps.map((step: SetupGuideStep): string => {
          return step.markdown || "";
        }),
        ...[
          ...(content.advanced || []),
          ...(content.troubleshooting || []),
        ].map((topic: SetupGuideTopic): string => {
          return topic.markdown;
        }),
      ];
      for (const piece of pieces) {
        expect(proseOf(piece)).not.toMatch(/^#{1,6} /m);
      }
    },
  );

  test.each(ALL_GUIDES)(
    "%s: links the system's docs section and the Queues page, once each",
    (name: string, content: SetupGuideContent) => {
      const system: string = name.split(" ")[0]!;
      const links: Array<SetupGuideLink> = content.links || [];
      expect(links).toEqual([
        {
          title: getMessagingSystemTitle(system),
          url: getMessageQueueDocsUrl(system),
        },
        { title: "Queues documentation", url: MESSAGE_QUEUE_DOCS_PATH },
      ]);
      const urls: Array<string> = links.map((link: SetupGuideLink): string => {
        return link.url;
      });
      expect(new Set(urls).size).toBe(urls.length);
      for (const link of links) {
        const anchor: string = link.url.split("#")[1] || "";
        if (anchor) {
          expect(DOCS_SLUGS.has(anchor)).toBe(true);
        }
        expect(link.url.startsWith(MESSAGE_QUEUE_DOCS_PATH)).toBe(true);
      }
    },
  );
});

// Every key a guide sends with: `x-oneuptime-token=<key>` and `x-oneuptime-token: "<key>"`.
function tokensIn(markdown: string): Array<string> {
  return Array.from(
    markdown.matchAll(/x-oneuptime-token[=:]\s*"?([^"\s]+)"?/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
  });
}

describe("the ingestion key", () => {
  const PLACEHOLDER_VARS: GuideVariables = {
    oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
  };
  const PICK_KEY_NOTE: string = `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`;

  test.each(SYSTEMS)(
    "%s shows the placeholders until a key is picked, and says where to pick one",
    (system: string) => {
      for (const content of [
        productContent(system, PLACEHOLDER_VARS),
        queueContent(sampleQueue(system), PLACEHOLDER_VARS),
      ]) {
        const markdown: string = getSetupGuideMarkdown(content);
        expect(tokensIn(markdown).length).toBeGreaterThan(0);
        for (const token of tokensIn(markdown)) {
          expect(token).toBe(SETUP_GUIDE_API_KEY_PLACEHOLDER);
        }
        expect(markdown).toContain(`${SETUP_GUIDE_URL_PLACEHOLDER}/otlp`);
        expect(content.keyStep?.endpointValue).toBe(
          `${SETUP_GUIDE_URL_PLACEHOLDER}/otlp`,
        );
        // Said once, in the first step that carries the key.
        expect(content.steps[0]!.markdown).toContain(PICK_KEY_NOTE);
        expect(markdown.split(PICK_KEY_NOTE)).toHaveLength(2);
      }
    },
  );

  test.each(ALL_GUIDES)(
    "%s: once a key is picked, every token in the guide is that key",
    (_name: string, content: SetupGuideContent) => {
      const markdown: string = getSetupGuideMarkdown(content);
      expect(markdown).not.toContain("Pick an ingestion key in step 1");
      const tokens: Array<string> = tokensIn(markdown);
      expect(tokens.length).toBeGreaterThan(0);
      for (const token of tokens) {
        expect(token).toBe(VARS.apiKey);
      }
      for (const block of getSetupGuideCodeBlocks(content)) {
        if (block.includes("x-oneuptime-token")) {
          expect(block).toContain(VARS.apiKey);
        }
      }
    },
  );
});

/*
 * The check step says what to expect, and when, in the numbers discovery
 * actually runs on: the interval and windows the Overview's liveness pill
 * states (held to the discovery job's cron by
 * App/Tests/Dashboard/MessageQueueOverviewWiring.test), and the span
 * minimum of the server's discovery, which the dashboard cannot import and
 * so repeats — held equal here.
 */
describe("the check step states discovery's own numbers", () => {
  test("the guide's span minimum is the server's, under the same variable", () => {
    expect(MESSAGE_QUEUE_GUIDE_MIN_SPANS).toBe(DEFAULT_MESSAGE_QUEUE_MIN_SPANS);
    expect(MESSAGE_QUEUE_MIN_SPANS_ENV_NAME).toBe(MESSAGE_QUEUE_MIN_SPANS_ENV);
  });

  test("the docs page states the same numbers", () => {
    expect(QUEUES_DOC).toContain(
      `Every ${MESSAGE_QUEUE_DISCOVERY_INTERVAL_MINUTES} minutes OneUptime summarises the spans your applications sent in the last ${MESSAGE_QUEUE_DISCOVERY_WINDOW_MINUTES} minutes`,
    );
    expect(QUEUES_DOC).toContain(
      `number at least ${DEFAULT_MESSAGE_QUEUE_MIN_SPANS} (\`${MESSAGE_QUEUE_MIN_SPANS_ENV}\`)`,
    );
    expect(QUEUES_DOC).toContain("one broker metric is enough");
    expect(QUEUES_DOC).toContain(
      "Messaging client metrics never create a queue",
    );
    // The cloud window: "the last hour".
    expect(MESSAGE_QUEUE_DISCOVERY_CLOUD_METRIC_WINDOW_MINUTES).toBe(60);
    expect(QUEUES_DOC).toContain(
      "each run reads their metrics from the last hour",
    );
  });

  test.each(SYSTEMS)("%s's product guide", (system: string) => {
    const content: SetupGuideContent = productContent(system);
    const check: SetupGuideStep = findStep(
      content,
      "Check that your queues appear",
    );
    expect(check.description).toBe(
      `OneUptime looks for new queues every ${MESSAGE_QUEUE_DISCOVERY_INTERVAL_MINUTES} minutes.`,
    );
    const markdown: string = check.markdown || "";
    expect(markdown).toContain(
      `Every ${MESSAGE_QUEUE_DISCOVERY_INTERVAL_MINUTES} minutes OneUptime reads the last ${MESSAGE_QUEUE_DISCOVERY_WINDOW_MINUTES} minutes of spans and lists, under **Queues**, each destination at least ${DEFAULT_MESSAGE_QUEUE_MIN_SPANS} of them name (spans of any kind but SERVER).`,
    );
    expect(markdown).toContain(
      `On a self-hosted OneUptime, \`${MESSAGE_QUEUE_MIN_SPANS_ENV}\` sets that number.`,
    );
    expect(markdown).toContain(
      "Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.",
    );
    expect(markdown).toContain(
      `Queues are created on their own only while the project is under its [auto-create budget](${MESSAGE_QUEUE_DOCS_PATH}#the-auto-create-budget).`,
    );

    // A broker metric creates a queue only where the system's metrics reach one.
    const reaches: boolean = canBrokerMetricsReachMessageQueue(system);
    expect(markdown.includes("creates its queue too")).toBe(reaches);
    const isCloud: boolean =
      descriptorOf(system).brokerMetrics.kind === "cloud-monitoring";
    expect(
      markdown.includes(
        `each run reads them from the last ${MESSAGE_QUEUE_DISCOVERY_CLOUD_METRIC_WINDOW_MINUTES} minutes`,
      ),
    ).toBe(reaches && isCloud);
  });

  /*
   * The sentences above, held to the docs page: the variable is the
   * self-hosted tuning one, queues are created only under the budget, and
   * client metrics and the reader's own never create one.
   */
  test("the docs page says what the product guide's check step says", () => {
    const tuning: string = docsSectionAt("## Self-hosted tuning");
    expect(tuning).toContain(
      "Self-hosted installations can tune discovery with these environment variables",
    );
    expect(tuning).toContain(
      `| \`${MESSAGE_QUEUE_MIN_SPANS_ENV}\` | \`${DEFAULT_MESSAGE_QUEUE_MIN_SPANS}\` | Spans a destination needs`,
    );
    expect(docsSectionAt("### The auto-create budget")).toContain(
      "Traces and broker metrics create queues on their own only while the project holds fewer than",
    );
    expect(docsSectionAt("### From messaging client metrics")).toContain(
      "Messaging client metrics never create a queue",
    );
    expect(docsSectionAt("### From messaging client metrics")).toContain(
      "A metric of your own does neither: it only shows on the queue's **Metrics** tab.",
    );
  });

  /*
   * Every queue guide's check step, including the queues whose broker
   * metrics never reach them: an Azure queue without a namespace, a
   * system none of whose metrics name a queue, and a long-tail system.
   */
  const CHECKED_QUEUES: Array<[string, MessageQueueDocumentationTarget]> = [
    ...SYSTEMS.map(
      (system: string): [string, MessageQueueDocumentationTarget] => {
        return [system, sampleQueue(system)];
      },
    ),
    [
      "servicebus without a namespace",
      { system: "servicebus", destination: "orders" },
    ],
    [
      "eventhubs without a namespace",
      { system: "eventhubs", destination: "orders" },
    ],
    ["ibmmq", LONG_TAIL_QUEUE],
  ];

  test.each(CHECKED_QUEUES)(
    "%s's queue guide says what fills in where",
    (_name: string, target: MessageQueueDocumentationTarget) => {
      const markdown: string =
        findStep(queueContent(target), "Check that this queue fills in")
          .markdown || "";
      const reaches: boolean = canBrokerMetricsReachMessageQueue(
        target.system,
        target,
      );
      const isOutsideScope: boolean =
        canBrokerMetricsReachMessageQueue(target.system) && !reaches;

      if (reaches) {
        expect(markdown).toContain(
          "**Broker health** on the Overview fills in from the broker's metrics as they arrive",
        );
      } else if (isOutsideScope) {
        expect(markdown).toContain(
          "Azure Monitor's metrics chart under **Broker health** on the same destination's queue in its namespace, not on this one.",
        );
      } else {
        // No broker metric reaches it: only metrics that name it, on its Metrics tab.
        expect(markdown).toContain(
          "Metrics that carry its `messaging.system` and `messaging.destination.name` on each datapoint show on its **Metrics** tab.",
        );
        expect(markdown).not.toContain("Broker health");
      }

      /*
       * Liveness: broker metrics, and the cloud monitoring window they are
       * read over, only where they reach this queue; otherwise what does
       * sight it — spans and messaging client metrics.
       */
      const isCloud: boolean =
        getMessagingBrokerMetricsSource(target.system).kind ===
        "cloud-monitoring";
      expect(markdown).toContain(
        reaches
          ? `The header reads **Seen recently** once discovery finds spans or broker metrics naming this queue. It runs every ${MESSAGE_QUEUE_DISCOVERY_INTERVAL_MINUTES} minutes over the last ${MESSAGE_QUEUE_DISCOVERY_WINDOW_MINUTES} minutes of telemetry${
              isCloud
                ? `, and over the last ${MESSAGE_QUEUE_DISCOVERY_CLOUD_METRIC_WINDOW_MINUTES} minutes of cloud monitoring metrics, which arrive late`
                : ""
            }.`
          : `The header reads **Seen recently** once discovery finds spans or messaging client metrics naming this queue. It runs every ${MESSAGE_QUEUE_DISCOVERY_INTERVAL_MINUTES} minutes over the last ${MESSAGE_QUEUE_DISCOVERY_WINDOW_MINUTES} minutes of telemetry.`,
      );
      if (!reaches) {
        expect(markdown).not.toContain("broker metrics naming this queue");
        expect(markdown).not.toContain("cloud monitoring metrics");
      }
    },
  );

  test("the docs page says client metrics keep a queue's Last seen current", () => {
    expect(docsSectionAt("### From messaging client metrics")).toContain(
      "A client metric that names a queue that exists keeps its **Last seen** current, as its spans do.",
    );
    expect(docsSectionAt("### Lifecycle and archiving")).toContain(
      "**Last seen** is when discovery last saw the queue, in traces, messaging client metrics or broker metrics.",
    );
  });

  test.each(SYSTEMS)("%s's queue guide", (system: string) => {
    const target: MessageQueueDocumentationTarget = sampleQueue(system);
    const check: SetupGuideStep = findStep(
      queueContent(target),
      "Check that this queue fills in",
    );
    const markdown: string = check.markdown || "";
    // What spans fill in, and that they are matched as they are ingested.
    expect(markdown).toContain(
      "Every span that names this queue is tagged with it as OneUptime ingests it",
    );
    expect(markdown).toContain("**Producers** and **Consumers**");
    expect(markdown).toContain("the **Traces** tab");
    // A queue that exists needs no minimum: spans always count towards it.
    expect(markdown).not.toContain(
      `at least ${DEFAULT_MESSAGE_QUEUE_MIN_SPANS}`,
    );
    expect(
      markdown.includes("**Broker health** on the Overview fills in"),
    ).toBe(canBrokerMetricsReachMessageQueue(system, target));
  });
});

/*
 * Troubleshooting is the docs page's "## Troubleshooting", condensed: the
 * same entries in the same order, each linking to its own, and every fact
 * it states one the docs entry states too.
 */
describe("troubleshooting follows the docs page", () => {
  const TROUBLESHOOTING: string = docsSectionAt("## Troubleshooting");
  const DOCS_ENTRIES: Array<string> = Array.from(
    TROUBLESHOOTING.matchAll(/^### (.+)$/gm),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!.trim();
  });

  // The docs entry under a "### " heading of the troubleshooting section.
  function docsEntry(title: string): string {
    const start: number = TROUBLESHOOTING.indexOf(`### ${title}\n`);
    expect(start).toBeGreaterThan(-1);
    const rest: string = TROUBLESHOOTING.slice(start + title.length + 5);
    const end: number = rest.search(/\n### /);
    return (end === -1 ? rest : rest.slice(0, end)).toLowerCase();
  }

  test("the docs page has the four entries", () => {
    expect(DOCS_ENTRIES).toEqual([
      "A queue my applications use was not created",
      "Broker health stays empty",
      "Two queues for one destination",
      "A new queue for every request",
    ]);
  });

  test.each(ALL_GUIDES)(
    "%s: the same entries, in order, each linking to its own",
    (_name: string, content: SetupGuideContent) => {
      expect(topicTitles(content.troubleshooting)).toEqual(DOCS_ENTRIES);
      for (const topic of content.troubleshooting || []) {
        const anchor: string = slugify(topic.title);
        expect(DOCS_SLUGS.has(anchor)).toBe(true);
        expect(topic.markdown).toContain(
          `[${topic.title}](${MESSAGE_QUEUE_DOCS_PATH}#${anchor})`,
        );
      }
    },
  );

  /*
   * Phrases each guide entry states, which the docs entry must state too
   * (compared without regard to case).
   */
  const SHARED_FACTS: ReadonlyArray<[string, ReadonlyArray<string>]> = [
    [
      "A queue my applications use was not created",
      [
        "Celery's spans, BullMQ's own telemetry",
        "Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind.",
        "or only SERVER spans name it",
        `Fewer than ${DEFAULT_MESSAGE_QUEUE_MIN_SPANS} of its spans arrived in the last ${MESSAGE_QUEUE_DISCOVERY_WINDOW_MINUTES} minutes, or the project reached its [auto-create budget]`,
        "When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.",
      ],
    ],
    [
      "Broker health stays empty",
      [
        "Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a browser key), and the collector logs `Exporting failed` for every batch it drops.",
      ],
    ],
    [
      "Two queues for one destination",
      [
        "Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.",
        "One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.",
        "RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name",
        "Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.",
      ],
    ],
    [
      "A new queue for every request",
      [
        "A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded",
        "Mark such destinations `messaging.destination.temporary=true` in your instrumentation, or give them a stable name, then archive the queues already created.",
      ],
    ],
  ];

  test.each(ALL_GUIDES)(
    "%s: states the docs entries' facts",
    (_name: string, content: SetupGuideContent) => {
      for (const [title, facts] of SHARED_FACTS) {
        const guide: string = findTopic(
          content.troubleshooting,
          title,
        ).markdown.toLowerCase();
        const docs: string = docsEntry(title);
        for (const fact of facts) {
          const lower: string = fact.toLowerCase();
          expect({ title, fact, inGuide: guide.includes(lower) }).toEqual({
            title,
            fact,
            inGuide: true,
          });
          expect({ title, fact, inDocs: docs.includes(lower) }).toEqual({
            title,
            fact,
            inDocs: true,
          });
        }
      }
    },
  );

  /*
   * Broker health's causes, narrowed to the system: each phrase is in the
   * system's guide entry and in the docs entry.
   */
  const SYSTEM_FACTS: ReadonlyArray<[string, ReadonlyArray<string>]> = [
    [
      "kafka",
      ["reports a consumer group's lag only after the group commits an offset"],
    ],
    [
      "rabbitmq",
      [
        "RabbitMQ spans usually name the exchange",
        "reports only the queues of virtual hosts its user has access to, and logs no error for the rest",
        "RabbitMQ's counters appear with the first activity",
      ],
    ],
    [
      "servicebus",
      [
        "returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised",
      ],
    ],
    [
      "eventhubs",
      [
        "returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised",
      ],
    ],
    [
      "aws_sqs",
      [
        "`aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late",
      ],
    ],
    [
      "aws.sns",
      [
        "`aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late",
      ],
    ],
    [
      "gcp_pubsub",
      [
        "topic has the topic metrics and its subscriptions the subscription metrics",
        "Cloud Monitoring reads only the types in `metrics_list`",
        "Pub/Sub's metrics arrive minutes late",
      ],
    ],
  ];

  test.each(SYSTEM_FACTS)(
    "%s's Broker health entry names its own causes, as the docs entry does",
    (system: string, facts: ReadonlyArray<string>) => {
      const guide: string = findTopic(
        productContent(system).troubleshooting,
        "Broker health stays empty",
      ).markdown.toLowerCase();
      const docs: string = docsEntry("Broker health stays empty");
      for (const fact of facts) {
        const lower: string = fact.toLowerCase();
        expect({ system, fact, inGuide: guide.includes(lower) }).toEqual({
          system,
          fact,
          inGuide: true,
        });
        expect({ system, fact, inDocs: docs.includes(lower) }).toEqual({
          system,
          fact,
          inDocs: true,
        });
      }
    },
  );

  test("a system whose broker metrics chart nowhere says so, as the docs entry does", () => {
    const docs: string = docsEntry("Broker health stays empty");
    expect(docs).toContain(
      "the system has no charted metrics: azure event grid, nats, jms brokers other than activemq and bullmq",
    );
    expect(docs).toContain("their metrics are in the **metrics** explorer.");
    for (const system of ["nats", "eventgrid", "bullmq"]) {
      expect(
        findTopic(
          productContent(system).troubleshooting,
          "Broker health stays empty",
        ).markdown,
      ).toContain(
        `- ${descriptorOf(system).displayName} has no charted metrics. Its metrics are in the **Metrics** explorer.`,
      );
    }
  });

  /*
   * JMS keeps the docs entry's exception: an ActiveMQ broker's metrics DO
   * chart (they turn the queue into an ActiveMQ one), as the guide's own
   * ActiveMQ and charted-metrics topics say.
   */
  test("JMS names only the brokers other than ActiveMQ, and points at the ActiveMQ topic", () => {
    for (const content of [
      productContent("jms"),
      queueContent(sampleQueue("jms")),
    ]) {
      const markdown: string = findTopic(
        content.troubleshooting,
        "Broker health stays empty",
      ).markdown;
      expect(markdown).toContain(
        "- JMS brokers other than ActiveMQ have no charted metrics. Their metrics are in the **Metrics** explorer. For an ActiveMQ broker, see **If the broker is Apache ActiveMQ** under **Advanced**.",
      );
      expect(markdown).not.toContain("JMS has no charted metrics");
      findTopic(content.advanced, "If the broker is Apache ActiveMQ");
    }
  });

  /*
   * Every guide the dashboard can show, plus the queues whose Broker
   * health entry differs: Azure queues without a namespace, and a queue
   * with no system at all.
   */
  const TROUBLESHOOTING_GUIDES: Array<[string, SetupGuideContent]> = [
    ...ALL_GUIDES,
    [
      "servicebus (queue without a namespace)",
      queueContent({ system: "servicebus", destination: "orders" }),
    ],
    [
      "eventhubs (queue without a namespace)",
      queueContent({ system: "eventhubs", destination: "orders" }),
    ],
    ["no system (queue)", queueContent({ system: "", destination: "orders" })],
  ];

  /*
   * The sentences of a troubleshooting topic or docs entry, compared
   * without regard to case: links into the docs page as the page writes
   * them, "(see [..](..))" asides dropped (the guide links its entry
   * instead), split at each sentence end and semicolon, without the
   * guide's closing "See [entry] on the Queues documentation page." line.
   */
  function normalizeEntryText(text: string): string {
    return text
      .replace(/\(\/docs\/telemetry\/queues#/g, "(#")
      .replace(/\s*\(see \[[^\]]*\]\([^)]*\)\)/gi, "")
      .replace(/\s+/g, " ")
      .toLowerCase()
      .trim();
  }

  const ENTRY_LINK_LINE: RegExp =
    /^See \[[^\]]+\]\([^)]+\) on the Queues documentation page\.$/;

  function entrySentences(markdown: string): Array<string> {
    const sentences: Array<string> = [];
    for (const rawLine of markdown.split("\n")) {
      const line: string = rawLine.replace(/^- /, "").trim();
      if (!line || ENTRY_LINK_LINE.test(line)) {
        continue;
      }
      for (const piece of normalizeEntryText(line).split(/(?<=[.;])\s+/)) {
        const sentence: string = piece.replace(/[.;]$/, "").trim();
        if (sentence) {
          sentences.push(sentence);
        }
      }
    }
    return sentences;
  }

  /*
   * The only sentences a guide's troubleshooting may state that its docs
   * entry does not: each proved by the docs section it comes from, by the
   * step of the same guide it points at, or by the Advanced topic it names.
   */
  interface TroubleshootingAddition {
    sentence: string;
    docs?: { section: string; says: string };
    step?: { number: number; contains: string };
    topic?: string;
  }

  const NO_CHARTED_METRICS: { section: string; says: string } = {
    section: "## Troubleshooting",
    says: "The system has no charted metrics: Azure Event Grid, NATS, JMS brokers other than ActiveMQ and BullMQ",
  };

  const ADDITIONS: ReadonlyArray<TroubleshootingAddition> = [
    {
      sentence: "for bullmq, the transform in step 2 does that",
      step: { number: 2, contains: "transform/bullmq:" },
    },
    {
      sentence: "the receiver skips topics whose names start with `_`",
      docs: {
        section: "### Apache Kafka",
        says: "skips topics whose names start with `_`",
      },
    },
    {
      sentence:
        "the two meet for messages sent through the default exchange, whose routing key is the queue's name",
      docs: {
        section: "## Limitations",
        says: "The two meet for messages sent through the default exchange, whose routing key is the queue's name",
      },
    },
    {
      sentence: "the config in step 3 raises it",
      step: {
        number: 3,
        contains: "maximum_number_of_records_per_resource: 1000",
      },
    },
    {
      sentence:
        "the receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear",
      docs: {
        section: "### Azure Service Bus",
        says: "The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.",
      },
    },
    {
      sentence: "only the broker's own metrics need a system oneuptime knows",
      docs: {
        section: "## Supported messaging systems",
        says: "only the broker's own metrics need a system from this table",
      },
    },
    {
      sentence: "its metrics are in the **metrics** explorer",
      docs: {
        section: "## Troubleshooting",
        says: "Their metrics are in the **Metrics** explorer.",
      },
    },
    {
      sentence: "jms brokers other than activemq have no charted metrics",
      docs: NO_CHARTED_METRICS,
    },
    { sentence: "nats has no charted metrics", docs: NO_CHARTED_METRICS },
    {
      sentence: "azure event grid has no charted metrics",
      docs: NO_CHARTED_METRICS,
    },
    { sentence: "bullmq has no charted metrics", docs: NO_CHARTED_METRICS },
    {
      sentence:
        "for an activemq broker, see **if the broker is apache activemq** under **advanced**",
      topic: "If the broker is Apache ActiveMQ",
    },
  ];

  test.each(TROUBLESHOOTING_GUIDES)(
    "%s: every sentence of every entry is its docs entry's, or a proved addition",
    (_name: string, content: SetupGuideContent) => {
      for (const topic of content.troubleshooting || []) {
        const docs: string = normalizeEntryText(docsEntry(topic.title));
        for (const sentence of entrySentences(topic.markdown)) {
          if (docs.includes(sentence)) {
            continue;
          }
          const addition: TroubleshootingAddition | undefined = ADDITIONS.find(
            (candidate: TroubleshootingAddition): boolean => {
              return candidate.sentence === sentence;
            },
          );
          expect({
            title: topic.title,
            sentence,
            sourced: Boolean(addition),
          }).toEqual({ title: topic.title, sentence, sourced: true });
          if (addition?.step) {
            const step: SetupGuideStep | undefined =
              content.steps[addition.step.number - 2];
            expect({
              sentence,
              step: (step?.markdown || "").includes(addition.step.contains),
            }).toEqual({ sentence, step: true });
          }
          if (addition?.topic) {
            findTopic(content.advanced, addition.topic);
          }
        }
      }
    },
  );

  test.each(
    ADDITIONS.map(
      (
        addition: TroubleshootingAddition,
      ): [string, TroubleshootingAddition] => {
        return [addition.sentence, addition];
      },
    ),
  )(
    'the addition "%s" is proved, and some guide states it',
    (sentence: string, addition: TroubleshootingAddition) => {
      expect(
        Boolean(addition.docs) ||
          Boolean(addition.step) ||
          Boolean(addition.topic),
      ).toBe(true);
      if (addition.docs) {
        expect(
          normalizeEntryText(docsSectionAt(addition.docs.section)),
        ).toContain(normalizeEntryText(addition.docs.says));
      }
      const stated: boolean = TROUBLESHOOTING_GUIDES.some(
        ([, content]: [string, SetupGuideContent]): boolean => {
          return (content.troubleshooting || []).some(
            (topic: SetupGuideTopic): boolean => {
              return entrySentences(topic.markdown).includes(sentence);
            },
          );
        },
      );
      expect(stated).toBe(true);
    },
  );

  /*
   * Every "step N" a guide's text names: the pick-key note's step 1, or a
   * step of the same guide holding what the sentence says it holds.
   */
  const STEP_REFERENCES: ReadonlyArray<[RegExp, string]> = [
    [/Pick an ingestion key in step (\d+)/g, ""],
    [/the transform in step (\d+)/gi, "transform/bullmq:"],
    [
      /the config in step (\d+) raises it/gi,
      "maximum_number_of_records_per_resource:",
    ],
    [/with the configuration in step (\d+), CloudWatch's/g, "aws_cloudwatch/"],
  ];

  test.each(TROUBLESHOOTING_GUIDES)(
    "%s: every step a sentence names is the step that holds it",
    (name: string, content: SetupGuideContent) => {
      const pieces: Array<string> = [
        content.intro || "",
        ...content.steps.map((step: SetupGuideStep): string => {
          return step.markdown || "";
        }),
        ...[
          ...(content.advanced || []),
          ...(content.troubleshooting || []),
        ].map((topic: SetupGuideTopic): string => {
          return topic.markdown;
        }),
      ];
      const prose: string = pieces.map(proseOf).join("\n");
      let checked: number = 0;
      for (const [pattern, contains] of STEP_REFERENCES) {
        for (const match of prose.matchAll(pattern)) {
          checked += 1;
          const number: number = Number(match[1]);
          if (contains === "") {
            expect(number).toBe(1);
            continue;
          }
          const step: SetupGuideStep | undefined = content.steps[number - 2];
          expect({
            name,
            reference: match[0],
            holds: (step?.markdown || "").includes(contains),
          }).toEqual({ name, reference: match[0], holds: true });
        }
      }
      // No mention of a step that the table above does not check.
      expect({
        name,
        mentions: Array.from(prose.matchAll(/\bstep \d+\b/gi)).length,
      }).toEqual({ name, mentions: checked });
    },
  );

  /*
   * The Broker health topic's folded summary names this system's causes
   * and no other: every cause it lists is one the bullets below it state.
   */
  const SUMMARY_CAUSES: ReadonlyArray<
    [RegExp, (cause: RegExpMatchArray) => string]
  > = [
    [
      /^a refused key$/,
      (): string => {
        return "refuses a wrong ingestion key";
      },
    ],
    [
      /^spans without a namespace( on a different queue from azure monitor's metrics)?$/,
      (): string => {
        return "spans without a namespace host are on a different queue from azure monitor's metrics";
      },
    ],
    [
      /^a system oneuptime does not know$/,
      (): string => {
        return "only the broker's own metrics need a system oneuptime knows";
      },
    ],
    [
      /^no charted metrics for (.+)$/,
      (cause: RegExpMatchArray): string => {
        return `${cause[1]} ha${cause[1]!.startsWith("jms brokers") ? "ve" : "s"} no charted metrics`;
      },
    ],
    [
      /^a consumer group that has not committed an offset$/,
      (): string => {
        return "reports a consumer group's lag only after the group commits an offset";
      },
    ],
    [
      /^a topic the receiver skips$/,
      (): string => {
        return "the receiver skips topics whose names start with";
      },
    ],
    [
      /^spans that name the exchange rather than the queue$/,
      (): string => {
        return "rabbitmq spans usually name the exchange, while the broker's metrics describe queues";
      },
    ],
    [
      /^a virtual host the user has no access to$/,
      (): string => {
        return "reports only the queues of virtual hosts its user has access to";
      },
    ],
    [
      /^more queues than azure monitor returns$/,
      (): string => {
        return "azure monitor returns 10 queues per metric and namespace";
      },
    ],
    [
      /^a namespace not listed yet$/,
      (): string => {
        return "the receiver lists your namespaces once a day";
      },
    ],
    [
      /^metrics that arrive (.+) late$/,
      (cause: RegExpMatchArray): string => {
        return `so its points arrive ${cause[1]} late`;
      },
    ],
    [
      /^a topic and its subscriptions on separate queues$/,
      (): string => {
        return "a pub/sub topic has the topic metrics and its subscriptions the subscription metrics";
      },
    ],
    [
      /^a metric type the config does not list$/,
      (): string => {
        return "cloud monitoring reads only the types in `metrics_list`";
      },
    ],
    [
      /^late metrics$/,
      (): string => {
        return "pub/sub's metrics arrive minutes late";
      },
    ],
    [
      /^a metric that names the queue differently from the spans$/,
      (): string => {
        return "the metric names the queue differently from the spans";
      },
    ],
  ];

  test.each(TROUBLESHOOTING_GUIDES)(
    "%s: Broker health's summary names only causes its bullets state",
    (name: string, content: SetupGuideContent) => {
      const topic: SetupGuideTopic = findTopic(
        content.troubleshooting,
        "Broker health stays empty",
      );
      const body: string = normalizeEntryText(topic.markdown);
      const causes: Array<string> = (topic.summary || "")
        .toLowerCase()
        .replace(/\.$/, "")
        .split(/, (?:or )?/);
      expect(causes[0]).toBe("a refused key");
      expect(causes.length).toBeGreaterThan(1);
      for (const cause of causes) {
        const known: Array<string> = [];
        for (const [pattern, bodySays] of SUMMARY_CAUSES) {
          const match: RegExpMatchArray | null = cause.match(pattern);
          if (match) {
            known.push(bodySays(match));
          }
        }
        expect({ name, cause, known: known.length }).toEqual({
          name,
          cause,
          known: 1,
        });
        expect({ name, cause, inBody: body.includes(known[0]!) }).toEqual({
          name,
          cause,
          inBody: true,
        });
      }
    },
  );

  test("the summaries differ by system", () => {
    const summaries: Set<string> = new Set<string>(
      TROUBLESHOOTING_GUIDES.map(
        ([, content]: [string, SetupGuideContent]): string => {
          return (
            findTopic(content.troubleshooting, "Broker health stays empty")
              .summary || ""
          );
        },
      ),
    );
    /*
     * Kafka, RabbitMQ, Azure, CloudWatch, Pub/Sub, default, JMS, a system per
     * no-chart name, the long-tail system and the Azure queue without a namespace.
     */
    expect(summaries.size).toBeGreaterThanOrEqual(10);
  });

  test("an Azure queue without a namespace is pointed at the namespace rule", () => {
    const markdown: string = findTopic(
      queueContent({ system: "servicebus", destination: "orders" })
        .troubleshooting,
      "Broker health stays empty",
    ).markdown;
    expect(markdown).toContain(
      "spans without a namespace host are on a different queue from Azure Monitor's metrics",
    );
    expect(docsEntry("Broker health stays empty")).toContain(
      "service bus and event hubs spans without a namespace host are on a different queue from azure monitor's metrics",
    );
  });
});
