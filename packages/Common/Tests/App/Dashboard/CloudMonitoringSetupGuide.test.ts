import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  AWS_POLLING_EXAMPLE_NAMESPACES,
  AWS_READ_POLICY,
  CLOUD_MONITORING_GUIDE_OPTIONS,
  CLOUD_RESOURCES_DOCS_URL,
  COLLECTOR_IMAGE,
  CloudMonitoringGuideOption,
  DEFAULT_CLOUD_MONITORING_GUIDE_OPTION,
  GCP_EXAMPLE_METRIC_PREFIXES,
  getAwsCloudWatchCollectorConfig,
  getAwsMetricStreamsCollectorConfig,
  getAzureMonitorCollectorConfig,
  getCloudMonitoringSetupGuide,
  getGoogleCloudMonitoringCollectorConfig,
  resolveCloudMonitoringGuideOption,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudMonitoringSetupGuide";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SETUP_GUIDE_URL_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideOptionGroup,
  SetupGuideStep,
  SetupGuideTopic,
  getSetupGuideMarkdown,
  groupSetupGuideOptions,
  resolveSetupGuideOption,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  AWS_CLOUDWATCH_DISCOVERY_NAMESPACES,
  getAwsCloudWatchRulesForNamespace,
  getGcpMonitoredResourceRule,
} from "../../../Types/Cloud/CloudResourceCatalog";
import {
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "../../../Types/Cloud/CloudMonitoredResource";

/*
 * The "Discover your cloud resources" guide: one per way a cloud's
 * monitoring API reaches OneUptime (Azure Monitor, CloudWatch polled or
 * streamed, Cloud Monitoring), each run by a collector the reader owns.
 * These tests pin, for every guide:
 *
 *   - the picker: every guide, grouped by provider, opening on CloudWatch
 *     polling - and a resource's page opening on its own provider's guide;
 *   - the steps: read-only access, the configuration, `docker run`, then a
 *     token check that points at Cloud → All Resources;
 *   - the collector configuration: valid YAML, a metrics pipeline only,
 *     every component it uses defined and every one it defines used, the
 *     token read from the environment and never written into the file, and
 *     no resource detection - which would file the cloud's metrics under the
 *     collector's own host;
 *   - `docker run` sets every variable the configuration reads, mounts it
 *     where the contrib image looks, and quotes what the shell would split;
 *   - the examples only read what OneUptime turns into Cloud Resources, and
 *     the docs page carries the very same configurations.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const DOCS_CONTENT: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Docs/Content/en",
);
const DOCS_PAGE: string = path.join(DOCS_CONTENT, "telemetry/cloud-resources.md");

const ONEUPTIME_URL: string = "https://oneuptime.example.com";
const KEY: string = "tik_secret_123";
const PICK_KEY_NOTE: string = `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`;
const CONTAINER_NAME: string = "oneuptime-cloud-collector";
const CONFIG_PATH: string = "/etc/otelcol-contrib/config.yaml";
const EXPORTER: string = "otlphttp/oneuptime";

const ALL_OPTIONS: Array<CloudMonitoringGuideOption> = Object.values(
  CloudMonitoringGuideOption,
);

// The receiver each guide's pipeline reads from.
const PIPELINE_RECEIVERS: Readonly<
  Record<CloudMonitoringGuideOption, Array<string>>
> = {
  [CloudMonitoringGuideOption.AzureMonitor]: ["azure_monitor"],
  [CloudMonitoringGuideOption.AwsCloudWatch]: AWS_POLLING_EXAMPLE_NAMESPACES.map(
    (namespace: string): string => {
      return `aws_cloudwatch/${namespace.split("/")[1]!.toLowerCase()}`;
    },
  ),
  [CloudMonitoringGuideOption.AwsMetricStreams]: ["awsfirehose"],
  [CloudMonitoringGuideOption.GoogleCloudMonitoring]: ["googlecloudmonitoring"],
};

interface FencedBlock {
  language: string;
  body: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type YamlConfig = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function guideFor(
  option: CloudMonitoringGuideOption,
  apiKey: string = KEY,
  oneuptimeUrl: string = ONEUPTIME_URL,
): SetupGuideContent {
  return getCloudMonitoringSetupGuide({
    oneuptimeUrl: oneuptimeUrl,
    apiKey: apiKey,
    option: option,
  });
}

function markdownOf(option: CloudMonitoringGuideOption, apiKey?: string): string {
  return getSetupGuideMarkdown(guideFor(option, apiKey));
}

function fencedBlocks(markdown: string): Array<FencedBlock> {
  return Array.from(markdown.matchAll(/```([^\n]*)\n([\s\S]*?)```/g)).map(
    (match: RegExpMatchArray): FencedBlock => {
      return { language: match[1]!.trim(), body: match[2]! };
    },
  );
}

function collectorYaml(markdown: string): string {
  const blocks: Array<FencedBlock> = fencedBlocks(markdown).filter(
    (block: FencedBlock): boolean => {
      return block.language === "yaml";
    },
  );
  expect(blocks).toHaveLength(1);
  return blocks[0]!.body;
}

function collectorConfig(option: CloudMonitoringGuideOption): YamlConfig {
  return yaml.load(collectorYaml(markdownOf(option))) as YamlConfig;
}

function dockerRun(markdown: string): string {
  const blocks: Array<FencedBlock> = fencedBlocks(markdown).filter(
    (block: FencedBlock): boolean => {
      return (
        block.language === "bash" && block.body.trimStart().startsWith("docker run")
      );
    },
  );
  expect(blocks).toHaveLength(1);
  return blocks[0]!.body.trim();
}

function stepTitles(option: CloudMonitoringGuideOption): Array<string> {
  return guideFor(option).steps.map((step: SetupGuideStep): string => {
    return step.title;
  });
}

function topicTitles(topics: Array<SetupGuideTopic> | undefined): Array<string> {
  return (topics || []).map((topic: SetupGuideTopic): string => {
    return topic.title;
  });
}

describe("the guide picker", () => {
  test("offers every guide exactly once", () => {
    const keys: Array<string> = CLOUD_MONITORING_GUIDE_OPTIONS.map(
      (option: SetupGuideOption<CloudMonitoringGuideOption>): string => {
        return option.key;
      },
    );

    expect([...keys].sort()).toEqual([...ALL_OPTIONS].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("groups the guides by provider: AWS, Azure, Google Cloud", () => {
    const groups: Array<SetupGuideOptionGroup<CloudMonitoringGuideOption>> =
      groupSetupGuideOptions(CLOUD_MONITORING_GUIDE_OPTIONS);

    expect(
      groups.map(
        (
          group: SetupGuideOptionGroup<CloudMonitoringGuideOption>,
        ): [string | undefined, Array<string>] => {
          return [
            group.label,
            group.options.map(
              (option: SetupGuideOption<CloudMonitoringGuideOption>): string => {
                return option.key;
              },
            ),
          ];
        },
      ),
    ).toEqual([
      [
        "AWS",
        [
          CloudMonitoringGuideOption.AwsCloudWatch,
          CloudMonitoringGuideOption.AwsMetricStreams,
        ],
      ],
      ["Azure", [CloudMonitoringGuideOption.AzureMonitor]],
      ["Google Cloud", [CloudMonitoringGuideOption.GoogleCloudMonitoring]],
    ]);
  });

  test("labels every guide with a name and a one-line description", () => {
    for (const option of CLOUD_MONITORING_GUIDE_OPTIONS) {
      expect(option.label.trim().length).toBeGreaterThan(0);
      expect(option.description).toBeDefined();
      expect(option.description!).not.toContain("\n");
      expect(option.description!.trim().endsWith(".")).toBe(true);
    }
  });

  test("opens on CloudWatch polling, which is also the option the card falls back to", () => {
    expect(DEFAULT_CLOUD_MONITORING_GUIDE_OPTION).toBe(
      CloudMonitoringGuideOption.AwsCloudWatch,
    );
    expect(resolveSetupGuideOption(CLOUD_MONITORING_GUIDE_OPTIONS, "nope")).toBe(
      DEFAULT_CLOUD_MONITORING_GUIDE_OPTION,
    );
  });

  test("resolves every guide to itself", () => {
    for (const option of ALL_OPTIONS) {
      expect(resolveCloudMonitoringGuideOption(option)).toBe(option);
      expect(resolveCloudMonitoringGuideOption(`  ${option}  `)).toBe(option);
    }
  });

  test("resolves a resource's provider to its provider's guide", () => {
    expect(resolveCloudMonitoringGuideOption("azure")).toBe(
      CloudMonitoringGuideOption.AzureMonitor,
    );
    expect(resolveCloudMonitoringGuideOption("aws")).toBe(
      CloudMonitoringGuideOption.AwsCloudWatch,
    );
    expect(resolveCloudMonitoringGuideOption("gcp")).toBe(
      CloudMonitoringGuideOption.GoogleCloudMonitoring,
    );
    expect(resolveCloudMonitoringGuideOption(" AZURE ")).toBe(
      CloudMonitoringGuideOption.AzureMonitor,
    );
  });

  test.each([[undefined], [null], [""], ["   "], ["oracle"], ["aws_ecs"]])(
    "resolves %p to the default guide",
    (value: string | null | undefined) => {
      expect(resolveCloudMonitoringGuideOption(value)).toBe(
        DEFAULT_CLOUD_MONITORING_GUIDE_OPTION,
      );
    },
  );
});

describe("every guide", () => {
  test.each(ALL_OPTIONS)("%s: grants read access, configures, runs, verifies", (option: CloudMonitoringGuideOption) => {
    const titles: Array<string> = stepTitles(option);

    expect(titles[titles.length - 1]).toBe("Verify");
    expect(titles).toContain("Configure the collector");
    expect(titles).toContain("Run the collector");
    expect(titles.indexOf("Configure the collector")).toBeLessThan(
      titles.indexOf("Run the collector"),
    );

    if (option === CloudMonitoringGuideOption.AwsMetricStreams) {
      // Firehose needs the collector's address, so the stream comes after it runs.
      expect(titles).toEqual([
        "Configure the collector",
        "Run the collector",
        "Create the Firehose stream and the metric stream",
        "Verify",
      ]);
    } else {
      expect(titles).toEqual([
        "Give the collector read access",
        "Configure the collector",
        "Run the collector",
        "Verify",
      ]);
    }
  });

  test.each(ALL_OPTIONS)("%s: every step has a one-line plain-text description", (option: CloudMonitoringGuideOption) => {
    for (const step of guideFor(option).steps) {
      expect(step.description).toBeDefined();
      expect(step.description!).not.toContain("\n");
      expect(step.description!).not.toContain("`");
      expect(step.description!.trim().endsWith(".")).toBe(true);
    }
  });

  test.each(ALL_OPTIONS)("%s: step 1 shows the OTLP endpoint", (option: CloudMonitoringGuideOption) => {
    const guide: SetupGuideContent = guideFor(option);

    expect(guide.keyStep?.endpointLabel).toBe("OTLP Endpoint");
    expect(guide.keyStep?.endpointValue).toBe(`${ONEUPTIME_URL}/otlp`);
    expect(guide.keyStep?.description).toContain("environment variable");
  });

  test.each(ALL_OPTIONS)("%s: lists what to have ready, one line each", (option: CloudMonitoringGuideOption) => {
    const prerequisites: Array<string> = guideFor(option).prerequisites || [];

    expect(prerequisites.length).toBeGreaterThan(0);
    for (const line of prerequisites) {
      expect(line).not.toContain("\n");
    }
    expect(prerequisites.join(" ")).toContain("OpenTelemetry Collector");
  });

  test.each(ALL_OPTIONS)("%s: says OneUptime never holds the cloud credentials, or why the collector must be reachable", (option: CloudMonitoringGuideOption) => {
    const intro: string = guideFor(option).intro || "";

    expect(intro).toContain("**Cloud → All Resources**");
    if (option === CloudMonitoringGuideOption.AwsMetricStreams) {
      expect(intro).toContain("reachable from AWS over HTTPS");
    } else {
      expect(intro).toContain("OneUptime never holds your");
    }
  });

  test.each(ALL_OPTIONS)("%s: verifies the token with /otlp/v1/validate, then points at Cloud → All Resources and alerting", (option: CloudMonitoringGuideOption) => {
    const guide: SetupGuideContent = guideFor(option);
    const verify: SetupGuideStep = guide.steps[guide.steps.length - 1]!;

    expect(verify.markdown).toContain(
      `curl -i ${ONEUPTIME_URL}/otlp/v1/validate \\`,
    );
    expect(verify.markdown).toContain(`-H "x-oneuptime-token: ${KEY}"`);
    expect(verify.markdown).toContain("**Cloud → All Resources**");
    expect(verify.markdown).toContain("**Create monitor from this view**");
    expect(verify.markdown).not.toContain(PICK_KEY_NOTE);
  });

  test.each(ALL_OPTIONS)("%s: folds resource detection and identity under Advanced, each with a summary", (option: CloudMonitoringGuideOption) => {
    const advanced: Array<SetupGuideTopic> = guideFor(option).advanced || [];

    expect(topicTitles(advanced)).toEqual(
      expect.arrayContaining([
        "Keep this pipeline free of resource detection",
        "How a resource is identified",
      ]),
    );
    for (const topic of advanced) {
      expect(topic.summary).toBeDefined();
      expect(topic.summary!.trim().length).toBeGreaterThan(0);
      expect(topic.summary!).not.toContain("\n");
    }
  });

  test.each(ALL_OPTIONS)("%s: troubleshooting is titled by symptom and ends at the docs page", (option: CloudMonitoringGuideOption) => {
    const troubleshooting: Array<SetupGuideTopic> =
      guideFor(option).troubleshooting || [];

    expect(troubleshooting[0]!.title).toBe("No resources appear");
    expect(topicTitles(troubleshooting)).toContain(
      "A resource reads Not reporting",
    );
    expect(
      troubleshooting[0]!.markdown.trim().split("\n").pop(),
    ).toContain(`(${CLOUD_RESOURCES_DOCS_URL}#troubleshooting)`);
    expect(troubleshooting[0]!.markdown).toContain(
      `docker logs ${CONTAINER_NAME}`,
    );
  });

  test.each(ALL_OPTIONS)("%s: links to the Cloud Resources docs page", (option: CloudMonitoringGuideOption) => {
    expect(guideFor(option).links).toEqual([
      { title: "Cloud Resources documentation", url: CLOUD_RESOURCES_DOCS_URL },
    ]);
  });

  test.each(ALL_OPTIONS)("%s: every /docs link it makes is a page on disk", (option: CloudMonitoringGuideOption) => {
    const targets: Array<string> = Array.from(
      markdownOf(option).matchAll(/\]\((\/docs\/[^)#]+)(?:#[^)]*)?\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect({
        target,
        exists: fs.existsSync(
          path.join(DOCS_CONTENT, `${target.replace("/docs/", "")}.md`),
        ),
      }).toEqual({ target, exists: true });
    }
  });

  test.each(ALL_OPTIONS)("%s: closes every code fence", (option: CloudMonitoringGuideOption) => {
    const fences: number = markdownOf(option)
      .split("\n")
      .filter((line: string): boolean => {
        return line.trimStart().startsWith("```");
      }).length;

    expect(fences % 2).toBe(0);
  });
});

describe("the collector configuration", () => {
  test.each(ALL_OPTIONS)("%s: is valid YAML with a metrics pipeline only", (option: CloudMonitoringGuideOption) => {
    const config: YamlConfig = collectorConfig(option);

    expect(Object.keys(config.service.pipelines)).toEqual(["metrics"]);
    expect(config.service.pipelines.metrics.receivers).toEqual(
      PIPELINE_RECEIVERS[option],
    );
    expect(config.service.pipelines.metrics.processors).toEqual(["batch"]);
    expect(config.service.pipelines.metrics.exporters).toEqual([EXPORTER]);
  });

  test.each(ALL_OPTIONS)("%s: defines every component it uses, and uses every one it defines", (option: CloudMonitoringGuideOption) => {
    const config: YamlConfig = collectorConfig(option);
    const pipeline: YamlConfig = config.service.pipelines.metrics;

    expect(Object.keys(config.receivers).sort()).toEqual(
      [...pipeline.receivers].sort(),
    );
    expect(Object.keys(config.processors).sort()).toEqual(
      [...pipeline.processors].sort(),
    );
    expect(Object.keys(config.exporters).sort()).toEqual(
      [...pipeline.exporters].sort(),
    );
    expect(Object.keys(config.extensions || {}).sort()).toEqual(
      [...(config.service.extensions || [])].sort(),
    );
  });

  test.each(ALL_OPTIONS)("%s: exports to the reader's OTLP endpoint with the token from the environment", (option: CloudMonitoringGuideOption) => {
    const config: YamlConfig = collectorConfig(option);

    expect(config.exporters[EXPORTER]).toEqual({
      endpoint: `${ONEUPTIME_URL}/otlp`,
      headers: { "x-oneuptime-token": "${env:ONEUPTIME_TOKEN}" },
    });
    expect(collectorYaml(markdownOf(option))).not.toContain(KEY);
  });

  test.each(ALL_OPTIONS)("%s: has no resource detection, which would file the metrics under the collector's host", (option: CloudMonitoringGuideOption) => {
    const text: string = collectorYaml(markdownOf(option));

    expect(text).not.toMatch(/resourcedetection/);
    expect(Object.keys(collectorConfig(option).processors)).toEqual(["batch"]);
  });

  test("Azure: reads every resource type of the subscription through the azure_auth extension", () => {
    const config: YamlConfig = collectorConfig(
      CloudMonitoringGuideOption.AzureMonitor,
    );
    const receiver: YamlConfig = config.receivers.azure_monitor;

    expect(receiver.subscription_ids).toEqual(["${env:AZURE_SUBSCRIPTION_ID}"]);
    expect(receiver.services).toBeUndefined();
    expect(receiver.resource_groups).toBeUndefined();
    expect(receiver.auth).toEqual({ authenticator: "azure_auth" });
    expect(receiver.maximum_number_of_records_per_resource).toBe(50);
    expect(config.extensions.azure_auth).toEqual({
      service_principal: {
        tenant_id: "${env:AZURE_TENANT_ID}",
        client_id: "${env:AZURE_CLIENT_ID}",
        client_secret: "${env:AZURE_CLIENT_SECRET}",
      },
    });
  });

  test("CloudWatch polling: one receiver per namespace, each reading its own namespace in the reader's region", () => {
    const config: YamlConfig = collectorConfig(
      CloudMonitoringGuideOption.AwsCloudWatch,
    );

    AWS_POLLING_EXAMPLE_NAMESPACES.forEach(
      (namespace: string, index: number): void => {
        const receiver: YamlConfig =
          config.receivers[
            PIPELINE_RECEIVERS[CloudMonitoringGuideOption.AwsCloudWatch][index]!
          ];

        expect(receiver.region).toBe("${env:AWS_REGION}");
        expect(receiver.metrics.discovery.filters).toEqual({
          namespace: namespace,
        });
        expect(receiver.metrics.discovery.limit).toBe(1000);
        // CloudWatch publishes late: the delay must cover a whole period.
        expect(receiver.metrics.delay).toBe("10m");
        expect(receiver.metrics.period).toBe("5m");
      },
    );
  });

  test("Metric Streams: Firehose in the OpenTelemetry 1.0 format, behind TLS and an access key", () => {
    const config: YamlConfig = collectorConfig(
      CloudMonitoringGuideOption.AwsMetricStreams,
    );

    expect(config.extensions.awscloudwatchmetricstreams_encoding).toEqual({
      format: "opentelemetry1.0",
    });
    expect(config.receivers.awsfirehose).toEqual({
      endpoint: "0.0.0.0:4433",
      encoding: "awscloudwatchmetricstreams_encoding",
      access_key: "${env:FIREHOSE_ACCESS_KEY}",
      tls: {
        cert_file: "/etc/otelcol-contrib/tls/server.crt",
        key_file: "/etc/otelcol-contrib/tls/server.key",
      },
    });
  });

  test("Cloud Monitoring: one filter per example service, in the receiver's own syntax", () => {
    const config: YamlConfig = collectorConfig(
      CloudMonitoringGuideOption.GoogleCloudMonitoring,
    );
    const receiver: YamlConfig = config.receivers.googlecloudmonitoring;

    expect(receiver.project_id).toBe("${env:GCP_PROJECT_ID}");
    expect(receiver.metrics_list).toEqual(
      GCP_EXAMPLE_METRIC_PREFIXES.map(
        (prefix: string): Record<string, string> => {
          return {
            metric_descriptor_filter: `metric.type = starts_with("${prefix}")`,
          };
        },
      ),
    );
  });

  test("the exported config helpers are what the guides show", () => {
    const context: { oneuptimeUrl: string; apiKey: string } = {
      oneuptimeUrl: ONEUPTIME_URL,
      apiKey: KEY,
    };

    expect(markdownOf(CloudMonitoringGuideOption.AzureMonitor)).toContain(
      getAzureMonitorCollectorConfig(context),
    );
    expect(markdownOf(CloudMonitoringGuideOption.AwsCloudWatch)).toContain(
      getAwsCloudWatchCollectorConfig(context),
    );
    expect(markdownOf(CloudMonitoringGuideOption.AwsMetricStreams)).toContain(
      getAwsMetricStreamsCollectorConfig(context),
    );
    expect(
      markdownOf(CloudMonitoringGuideOption.GoogleCloudMonitoring),
    ).toContain(getGoogleCloudMonitoringCollectorConfig(context));
  });
});

describe("running the collector", () => {
  test.each(ALL_OPTIONS)("%s: one flag per line, every line but the last continued", (option: CloudMonitoringGuideOption) => {
    const lines: Array<string> = dockerRun(markdownOf(option)).split("\n");

    expect(lines[0]).toBe(
      `docker run -d --name ${CONTAINER_NAME} --restart unless-stopped \\`,
    );
    lines.slice(0, -1).forEach((line: string): void => {
      expect(line.endsWith(" \\")).toBe(true);
    });
    expect(lines[lines.length - 1]).toBe(`  ${COLLECTOR_IMAGE}`);
  });

  test.each(ALL_OPTIONS)("%s: passes the token as ONEUPTIME_TOKEN and mounts the configuration where the image reads it", (option: CloudMonitoringGuideOption) => {
    const command: string = dockerRun(markdownOf(option));

    expect(command).toContain(`  -e ONEUPTIME_TOKEN=${KEY} \\`);
    expect(command).toContain(`  -v "$(pwd)/config.yaml:${CONFIG_PATH}" \\`);
  });

  test.each(ALL_OPTIONS)("%s: sets every variable the configuration reads", (option: CloudMonitoringGuideOption) => {
    const markdown: string = markdownOf(option);
    const command: string = dockerRun(markdown);
    const read: Array<string> = Array.from(
      new Set(
        Array.from(
          collectorYaml(markdown).matchAll(/\$\{env:([A-Z0-9_]+)\}/g),
        ).map((match: RegExpMatchArray): string => {
          return match[1]!;
        }),
      ),
    );

    expect(read).toContain("ONEUPTIME_TOKEN");
    for (const variable of read) {
      expect({ variable, set: command.includes(`-e ${variable}=`) }).toEqual({
        variable,
        set: true,
      });
    }
  });

  test("Metric Streams: publishes the port the receiver listens on, and mounts the certificate it reads", () => {
    const markdown: string = markdownOf(
      CloudMonitoringGuideOption.AwsMetricStreams,
    );
    const command: string = dockerRun(markdown);
    const config: YamlConfig = collectorConfig(
      CloudMonitoringGuideOption.AwsMetricStreams,
    );
    const port: string = String(config.receivers.awsfirehose.endpoint).split(
      ":",
    )[1]!;

    expect(command).toContain(`-p ${port}:${port}`);
    expect(command).toContain(
      '-v "$(pwd)/tls:/etc/otelcol-contrib/tls:ro"',
    );
    expect(config.receivers.awsfirehose.tls.cert_file).toMatch(
      /^\/etc\/otelcol-contrib\/tls\//,
    );
  });

  test("Cloud Monitoring: mounts the key where GOOGLE_APPLICATION_CREDENTIALS points", () => {
    const command: string = dockerRun(
      markdownOf(CloudMonitoringGuideOption.GoogleCloudMonitoring),
    );
    const credentials: RegExpMatchArray | null = command.match(
      /-e GOOGLE_APPLICATION_CREDENTIALS=(\S+)/,
    );

    expect(credentials).not.toBeNull();
    expect(command).toContain(`key.json:${credentials![1]}:ro"`);
  });

  test("CloudWatch polling: the region the receivers read is set, and the role's credentials can replace the keys", () => {
    const markdown: string = markdownOf(CloudMonitoringGuideOption.AwsCloudWatch);

    expect(dockerRun(markdown)).toContain("-e AWS_REGION=us-east-1");
    expect(markdown).toContain("leave out the two key variables");
  });

  test("a key the shell would split is single-quoted, and survives a quote inside it", () => {
    expect(
      dockerRun(markdownOf(CloudMonitoringGuideOption.AzureMonitor, "a b")),
    ).toContain("-e ONEUPTIME_TOKEN='a b' \\");
    expect(
      dockerRun(markdownOf(CloudMonitoringGuideOption.AzureMonitor, "it's")),
    ).toContain("-e ONEUPTIME_TOKEN='it'\\''s' \\");
  });
});

describe("before a key is picked", () => {
  test.each(ALL_OPTIONS)("%s: the placeholder is quoted for the shell, and step 1 is pointed at once", (option: CloudMonitoringGuideOption) => {
    const markdown: string = markdownOf(option, SETUP_GUIDE_API_KEY_PLACEHOLDER);

    expect(dockerRun(markdown)).toContain(
      `-e ONEUPTIME_TOKEN='${SETUP_GUIDE_API_KEY_PLACEHOLDER}' \\`,
    );
    expect(markdown.split(PICK_KEY_NOTE).length - 1).toBe(1);
  });

  test.each(ALL_OPTIONS)("%s: the placeholder URL keeps the /otlp path", (option: CloudMonitoringGuideOption) => {
    const guide: SetupGuideContent = guideFor(
      option,
      SETUP_GUIDE_API_KEY_PLACEHOLDER,
      SETUP_GUIDE_URL_PLACEHOLDER,
    );
    const config: YamlConfig = yaml.load(
      collectorYaml(getSetupGuideMarkdown(guide)),
    ) as YamlConfig;

    expect(config.exporters[EXPORTER].endpoint).toBe(
      `${SETUP_GUIDE_URL_PLACEHOLDER}/otlp`,
    );
    expect(guide.keyStep?.endpointValue).toBe(
      `${SETUP_GUIDE_URL_PLACEHOLDER}/otlp`,
    );
  });
});

describe("read access", () => {
  test("AWS: the policy only reads CloudWatch and asks who it is", () => {
    const policy: {
      Version: string;
      Statement: Array<{ Effect: string; Action: Array<string>; Resource: string }>;
    } = JSON.parse(AWS_READ_POLICY);

    expect(policy.Version).toBe("2012-10-17");
    expect(policy.Statement).toHaveLength(1);
    expect(policy.Statement[0]!.Effect).toBe("Allow");
    expect([...policy.Statement[0]!.Action].sort()).toEqual([
      "cloudwatch:GetMetricData",
      "cloudwatch:ListMetrics",
      "sts:GetCallerIdentity",
    ]);
    expect(markdownOf(CloudMonitoringGuideOption.AwsCloudWatch)).toContain(
      AWS_READ_POLICY,
    );
  });

  test("Azure: Monitoring Reader on the subscription, nothing more", () => {
    const markdown: string = markdownOf(CloudMonitoringGuideOption.AzureMonitor);

    expect(markdown).toContain('--role "Monitoring Reader"');
    expect(markdown).toContain("--scopes /subscriptions/<SUBSCRIPTION_ID>");
    expect(markdown).not.toMatch(/--role "?(Contributor|Owner|Reader)"?\s/);
  });

  test("Google Cloud: Monitoring Viewer on the project, nothing more", () => {
    const markdown: string = markdownOf(
      CloudMonitoringGuideOption.GoogleCloudMonitoring,
    );

    expect(markdown).toContain("--role roles/monitoring.viewer");
    expect(markdown.match(/--role /g)).toHaveLength(1);
  });
});

describe("the examples read what OneUptime turns into Cloud Resources", () => {
  test("every namespace the polling example reads has a discovery rule", () => {
    for (const namespace of AWS_POLLING_EXAMPLE_NAMESPACES) {
      expect({
        namespace,
        rules: getAwsCloudWatchRulesForNamespace(namespace).length > 0,
      }).toEqual({ namespace, rules: true });
    }
  });

  test("the polling guide lists every namespace OneUptime recognises, and only those", () => {
    const markdown: string = markdownOf(CloudMonitoringGuideOption.AwsCloudWatch);
    const listed: string | undefined = markdown
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("`AWS/");
      });

    expect(listed).toBeDefined();
    expect(
      listed!.split(", ").map((part: string): string => {
        return part.replace(/`/g, "");
      }),
    ).toEqual([...AWS_CLOUDWATCH_DISCOVERY_NAMESPACES]);
  });

  /*
   * The services the Cloud Monitoring example reads, and a monitored
   * resource type each publishes its metrics under.
   */
  const GCP_PREFIX_TYPES: Readonly<Record<string, string>> = {
    "compute.googleapis.com/": "gce_instance",
    "cloudsql.googleapis.com/": "cloudsql_database",
    "loadbalancing.googleapis.com/": "https_lb_rule",
    "storage.googleapis.com/": "gcs_bucket",
    "redis.googleapis.com/": "redis_instance",
    "run.googleapis.com/": "cloud_run_revision",
  };

  test("every service the Cloud Monitoring example reads has a monitored resource type OneUptime recognises", () => {
    expect([...GCP_EXAMPLE_METRIC_PREFIXES].sort()).toEqual(
      Object.keys(GCP_PREFIX_TYPES).sort(),
    );
    for (const prefix of GCP_EXAMPLE_METRIC_PREFIXES) {
      expect({
        prefix,
        recognised: Boolean(getGcpMonitoredResourceRule(GCP_PREFIX_TYPES[prefix]!)),
      }).toEqual({ prefix, recognised: true });
    }
  });

  test("a datapoint of each polled namespace, as its receiver stores it, becomes a resource", () => {
    const examples: Readonly<Record<string, Record<string, string>>> = {
      "AWS/EC2": { "Dimensions.InstanceId": "i-0abc" },
      "AWS/EBS": { "Dimensions.VolumeId": "vol-0abc" },
      "AWS/ApplicationELB": {
        "Dimensions.LoadBalancer": "app/web/50dc6c495c0c9188",
      },
      "AWS/RDS": { "Dimensions.DBInstanceIdentifier": "orders" },
      "AWS/Lambda": { "Dimensions.FunctionName": "checkout" },
      "AWS/DynamoDB": { "Dimensions.TableName": "carts" },
    };

    expect(Object.keys(examples).sort()).toEqual(
      [...AWS_POLLING_EXAMPLE_NAMESPACES].sort(),
    );

    for (const namespace of AWS_POLLING_EXAMPLE_NAMESPACES) {
      const resource: CloudMonitoredResource | null =
        resolveCloudMonitoredResource({
          metricName: `amazonaws.com/${namespace.toLowerCase()}/somemetric`,
          attributes: {
            Namespace: namespace,
            ...examples[namespace],
            "resource.cloud.account.id": "123456789012",
            "resource.cloud.region": "us-east-1",
          },
        });

      expect({ namespace, resolved: Boolean(resource) }).toEqual({
        namespace,
        resolved: true,
      });
    }
  });
});

describe("against the docs page", () => {
  const docs: string = fs.readFileSync(DOCS_PAGE, "utf8");
  // The docs are written for OneUptime Cloud.
  const docsContext: { oneuptimeUrl: string; apiKey: string } = {
    oneuptimeUrl: "https://oneuptime.com",
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
  };

  test("carries every guide's collector configuration verbatim", () => {
    for (const config of [
      getAzureMonitorCollectorConfig(docsContext),
      getAwsCloudWatchCollectorConfig(docsContext),
      getAwsMetricStreamsCollectorConfig(docsContext),
      getGoogleCloudMonitoringCollectorConfig(docsContext),
    ]) {
      expect(docs).toContain(config);
    }
  });

  test("carries the AWS policy verbatim", () => {
    expect(docs).toContain(AWS_READ_POLICY);
  });

  test("every YAML block on the page is a valid configuration without resource detection", () => {
    const blocks: Array<FencedBlock> = fencedBlocks(docs).filter(
      (block: FencedBlock): boolean => {
        return block.language === "yaml";
      },
    );

    expect(blocks.length).toBe(4);
    for (const block of blocks) {
      const config: YamlConfig = yaml.load(block.body) as YamlConfig;
      expect(Object.keys(config.service.pipelines)).toEqual(["metrics"]);
      expect(block.body).not.toContain("resourcedetection");
    }
  });

  test("the guides' docs links land on headings the page has", () => {
    const anchors: Set<string> = new Set(
      docs
        .split("\n")
        .filter((line: string): boolean => {
          return /^#{2,6} /.test(line);
        })
        .map((line: string): string => {
          return line
            .replace(/^#+ /, "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9 -]/g, "")
            .replace(/ /g, "-");
        }),
    );

    let checked: number = 0;
    for (const option of ALL_OPTIONS) {
      for (const match of markdownOf(option).matchAll(
        new RegExp(`\\(${CLOUD_RESOURCES_DOCS_URL}#([^)]+)\\)`, "g"),
      )) {
        checked++;
        expect({ option, anchor: match[1], exists: anchors.has(match[1]!) }).toEqual({
          option,
          anchor: match[1],
          exists: true,
        });
      }
    }

    // Every guide's troubleshooting links #troubleshooting; polling also #aws.
    expect(checked).toBeGreaterThanOrEqual(ALL_OPTIONS.length + 1);
  });
});
