/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here uses the sandbox and the
 * prebuilt binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import { JSONObject } from "../../../../Types/JSON";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import { FilterType } from "../../../../Types/Monitor/CriteriaFilter";
import MetricMonitorResponse, {
  StorageArrayAffectedResource,
  StorageArrayResourceBreakdown,
} from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorStepStorageArrayMonitor from "../../../../Types/Monitor/MonitorStepStorageArrayMonitor";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import {
  buildStorageArrayMonitorConfig,
  buildStorageArrayMonitorStep,
  buildStorageArrayOfflineCriteriaInstance,
  buildStorageArrayOnlineCriteriaInstance,
  getStorageArrayAlertTemplateById,
} from "../../../../Types/Monitor/StorageArrayAlertTemplates";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import StorageSystem from "../../../../Types/StorageArray/StorageSystem";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import { WORD_JOINER } from "../../../../Utils/Markdown/MarkdownEscape";
import { describe, expect, test } from "@jest/globals";
import { Lexer, Token, marked } from "marked";

import { MarkdownText } from "../../../../Utils/Markdown/FeedMarkdown";
// The root cause builders write MarkdownText; these tests read its text.
function textOf(markdown: MarkdownText | null): string | null {
  return markdown === null ? null : markdown.toString();
}

/*
 * The root cause a Storage Array monitor writes into its incident / alert:
 * the "Storage Array Details" block (array, platform, the metric the
 * criteria compared, the step's object filters) and the "Affected
 * Resources" list, titled by the object each row names — an open alert, a
 * hardware component or drive, a host, a pod, or whatever the metric's
 * `name` label is (a volume, a file system, a bucket).
 *
 * Mirrors the Ceph builder's contract: rows are the ones the matched
 * criteria's direction says breached, worst first; an array-wide series
 * gets no list; values carry the catalog's unit.
 */

type BuilderInput = {
  dataToProcess: MetricMonitorResponse;
  monitorStep: MonitorStep;
  monitor: Monitor;
  criteriaInstance?: MonitorCriteriaInstance | undefined;
};

type EvaluatorPrivate = {
  buildStorageArrayRootCauseContext: (
    input: BuilderInput,
  ) => MarkdownText | null;
};

const Evaluator: EvaluatorPrivate =
  MonitorCriteriaEvaluator as unknown as EvaluatorPrivate;

const ARRAY: string = "pure-prod-01";

function criteriaOn(input: {
  alias: string;
  filterType: FilterType;
  value: number;
}): MonitorCriteriaInstance {
  return buildStorageArrayOfflineCriteriaInstance({
    offlineMonitorStatusId: ObjectID.generate(),
    incidentSeverityId: ObjectID.generate(),
    alertSeverityId: ObjectID.generate(),
    monitorName: "Storage Array Monitor",
    metricAlias: input.alias,
    filterType: input.filterType,
    value: input.value,
  });
}

function stepFor(input: {
  alias: string;
  metricName: string;
  attributes?: Record<string, string>;
  storageSystem?: StorageSystem | undefined;
  resourceFilters?: MonitorStepStorageArrayMonitor["resourceFilters"];
  groupByAttributeKey?: string | undefined;
  filterType?: FilterType;
  value?: number;
}): MonitorStep {
  const storageArrayMonitor: MonitorStepStorageArrayMonitor =
    buildStorageArrayMonitorConfig({
      arrayIdentifier: ARRAY,
      storageSystem: input.storageSystem,
      metricName: input.metricName,
      metricAlias: input.alias,
      rollingTime: RollingTime.Past5Minutes,
      aggregationType: MetricsAggregationType.Max,
      ...(input.attributes ? { attributes: input.attributes } : {}),
      groupByAttributeKey: input.groupByAttributeKey,
    });

  if (input.resourceFilters) {
    storageArrayMonitor.resourceFilters = input.resourceFilters;
  }

  return buildStorageArrayMonitorStep({
    storageArrayMonitor: storageArrayMonitor,
    offlineCriteriaInstance: criteriaOn({
      alias: input.alias,
      filterType: input.filterType ?? FilterType.GreaterThan,
      value: input.value ?? 0,
    }),
    onlineCriteriaInstance: buildStorageArrayOnlineCriteriaInstance({
      onlineMonitorStatusId: ObjectID.generate(),
      metricAlias: input.alias,
      filterType: FilterType.EqualTo,
      value: 0,
    }),
  });
}

function breakdown(input: {
  alias: string;
  metricName: string;
  friendlyName: string;
  metricUnit?: string | undefined;
  attributes?: Record<string, string>;
  resources: Array<StorageArrayAffectedResource>;
}): StorageArrayResourceBreakdown {
  return {
    arrayName: ARRAY,
    metricName: input.metricName,
    metricFriendlyName: input.friendlyName,
    metricAlias: input.alias,
    metricUnit: input.metricUnit,
    attributes: {
      ...(input.attributes || {}),
      "resource.storage.array.name": ARRAY,
    },
    affectedResources: input.resources,
  };
}

function response(input: {
  monitorStep: MonitorStep;
  breakdowns?: Array<StorageArrayResourceBreakdown>;
  metricResultPoints?: number;
}): MetricMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricResult: [
      {
        data: Array.from({ length: input.metricResultPoints ?? 0 }).map(() => {
          return {
            timestamp: new Date(),
            value: 1,
          } as unknown as AggregateModel;
        }),
      },
    ],
    metricViewConfig: MonitorStep.getMetricsViewConfig(input.monitorStep)!,
    storageArrayResourceBreakdowns: input.breakdowns,
  };
}

function render(input: {
  monitorStep: MonitorStep;
  dataToProcess: MetricMonitorResponse;
  criteriaInstance?: MonitorCriteriaInstance;
}): string {
  return (
    textOf(
      Evaluator.buildStorageArrayRootCauseContext({
        dataToProcess: input.dataToProcess,
        monitorStep: input.monitorStep,
        monitor: new Monitor(),
        criteriaInstance:
          input.criteriaInstance ||
          input.monitorStep.data!.monitorCriteria.data!
            .monitorCriteriaInstanceArray[0],
      }),
    ) || ""
  );
}

function resource(
  identity: Partial<StorageArrayAffectedResource>,
  value: number,
  lowest?: number,
): StorageArrayAffectedResource {
  return {
    objectName: undefined,
    hostName: undefined,
    componentName: undefined,
    componentType: undefined,
    podName: undefined,
    alertSummary: undefined,
    ...identity,
    metricValue: value,
    lowestMetricValue: lowest ?? value,
  };
}

// Text as read, with marked's HTML escapes undone.
function withoutHtmlEscapes(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// A link whose words are not the address it goes to.
function hidesItsAddress(token: Token): boolean {
  const { text, href } = token as unknown as { text: string; href: string };
  const words: string = withoutHtmlEscapes(text);
  let address: string = withoutHtmlEscapes(href);

  try {
    address = decodeURI(address);
  } catch {
    // Compared as it is.
  }

  return words !== address;
}

describe("Storage Array root cause: the details block", () => {
  test("names the array, its platform, the metric compared and the step's object filters", () => {
    const step: MonitorStep = stepFor({
      alias: "vol_read_latency",
      metricName: "purefa_volume_performance_latency_usec",
      attributes: { dimension: "usec_per_read_op" },
      storageSystem: StorageSystem.PureStorageFlashArray,
      resourceFilters: { volumeName: " vol-db-01 ", hostName: "esx-01" },
      value: 5000,
    });

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({ monitorStep: step }),
    });

    expect(text).toContain(
      [
        "**Storage Array Details**",
        `- Storage Array: ${ARRAY}`,
        "- Platform: Pure Storage FlashArray",
        "- Metric: Volume Read Latency (`purefa_volume_performance_latency_usec`)",
        "- Volume Filter: vol-db-01",
        "- Host Filter: esx-01",
      ].join("\n"),
    );
  });

  /*
   * A filter is text the monitor's author typed, shown in a root cause that
   * reaches the dashboard, email, Slack and Microsoft Teams: it reads as
   * typed there, and is no link, tag or chat mention.
   */
  test("shows each object filter as text, as it was typed", () => {
    const step: MonitorStep = stepFor({
      alias: "vol_read_latency",
      metricName: "purefa_volume_performance_latency_usec",
      storageSystem: StorageSystem.PureStorageFlashArray,
      resourceFilters: {
        volumeName: "[Runbook](https://evil.example/login) <!channel>",
        hostName: '<img src="https://tracker.example/p.png">',
      },
      value: 5000,
    });

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({ monitorStep: step }),
    });

    expect(text).toContain(
      [
        `- Volume Filter: \\[Runbook\\](https://evil.example/login) \\<${WORD_JOINER}!channel>`,
        '- Host Filter: \\<img src="https://tracker.example/p.png">',
      ].join("\n"),
    );

    const tokens: Array<Token> = [];

    marked.walkTokens(new Lexer({ gfm: true }).lex(text), (token: Token) => {
      tokens.push(token);
    });

    // A bare address may be a link, showing itself; nothing else is.
    expect(
      tokens
        .filter((token: Token): boolean => {
          return (
            token.type === "html" ||
            (token.type === "link" && hidesItsAddress(token))
          );
        })
        .map((token: Token): string => {
          return token.raw;
        }),
    ).toEqual([]);
    expect(SlackUtil.convertMarkdownToSlackRichText(text)).not.toMatch(
      /<!channel>|<https:\/\/evil\.example[^>]*\|/,
    );
  });

  test("tells read from write latency by the query's dimension filter, even with no scan", () => {
    const step: MonitorStep = stepFor({
      alias: "write_latency",
      metricName: "purefa_array_performance_latency_usec",
      attributes: { dimension: "usec_per_write_op" },
      value: 5000,
    });

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({ monitorStep: step }),
    });

    expect(text).toContain(
      "- Metric: Write Latency (`purefa_array_performance_latency_usec`)",
    );
    expect(text).not.toContain("Read Latency");
    // No platform line when the step does not record one.
    expect(text).not.toContain("- Platform:");
  });

  test("an array-wide series lists nothing and falls back to the metric summary", () => {
    const step: MonitorStep = stepFor({
      alias: "capacity_used_percent",
      metricName: "purefa_array_space_utilization",
      value: 80,
    });

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({
        monitorStep: step,
        metricResultPoints: 3,
        breakdowns: [
          breakdown({
            alias: "capacity_used_percent",
            metricName: "purefa_array_space_utilization",
            friendlyName: "Capacity Used (%)",
            metricUnit: "%",
            resources: [resource({}, 91.5)],
          }),
        ],
      }),
    });

    expect(text).not.toContain("**Affected Resources**");
    expect(text).toContain("**Metric Summary**");
    expect(text).toContain("- 3 metric data point(s) returned");
  });
});

describe("Storage Array root cause: the affected resources list", () => {
  test("open alerts are titled by their summary, with the component beneath", () => {
    const step: MonitorStep = stepFor({
      alias: "critical_alerts",
      metricName: "purefa_alerts_open",
      attributes: { severity: "critical" },
    });

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({
        monitorStep: step,
        breakdowns: [
          breakdown({
            alias: "critical_alerts",
            metricName: "purefa_alerts_open",
            friendlyName: "Open Alerts",
            attributes: { severity: "critical" },
            resources: [
              resource(
                {
                  alertSummary: "Controller failed",
                  componentName: "CT0",
                  componentType: "controller",
                },
                1,
              ),
            ],
          }),
        ],
      }),
    });

    expect(text).toContain(
      [
        "**Affected Resources** (1 total)",
        "",
        "1. **Alert** `Controller failed` — **1**",
        "   - Component: `CT0`",
        "   - Component Type: `controller`",
      ].join("\n"),
    );
  });

  test("hardware components and drives are titled as such, worst first", () => {
    const step: MonitorStep = stepFor({
      alias: "failed_drives",
      metricName: "purefa_drive_capacity_bytes",
      attributes: { component_status: "failed" },
    });

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({
        monitorStep: step,
        breakdowns: [
          breakdown({
            alias: "failed_drives",
            metricName: "purefa_drive_capacity_bytes",
            friendlyName: "Drive Capacity",
            metricUnit: "bytes",
            attributes: { component_status: "failed" },
            resources: [
              resource(
                { componentName: "CH0.BAY3", componentType: "SSD" },
                1e12,
              ),
              resource(
                { componentName: "CH0.BAY9", componentType: "SSD" },
                3.84e12,
              ),
            ],
          }),
        ],
      }),
    });

    expect(text).toContain(
      [
        "**Affected Resources** (2 total)",
        "",
        "1. **Drive** `CH0.BAY9` — **3.84 TB**",
        "   - Component Type: `SSD`",
        "2. **Drive** `CH0.BAY3` — **1 TB**",
        "   - Component Type: `SSD`",
      ].join("\n"),
    );
  });

  test("a FlashArray component is a hardware component, a host a host", () => {
    const hardwareStep: MonitorStep = stepFor({
      alias: "critical_components",
      metricName: "purefa_hw_component_status",
      attributes: { component_status: "critical" },
    });

    expect(
      render({
        monitorStep: hardwareStep,
        dataToProcess: response({
          monitorStep: hardwareStep,
          breakdowns: [
            breakdown({
              alias: "critical_components",
              metricName: "purefa_hw_component_status",
              friendlyName: "Hardware Component Status",
              resources: [
                resource(
                  { componentName: "CT0.FAN0", componentType: "cooling" },
                  1,
                ),
              ],
            }),
          ],
        }),
      }),
    ).toContain("1. **Hardware Component** `CT0.FAN0` — **1**");

    const hostStep: MonitorStep = stepFor({
      alias: "host_read_latency",
      metricName: "purefa_host_performance_latency_usec",
      attributes: { dimension: "usec_per_read_op" },
      value: 5000,
    });

    expect(
      render({
        monitorStep: hostStep,
        dataToProcess: response({
          monitorStep: hostStep,
          breakdowns: [
            breakdown({
              alias: "host_read_latency",
              metricName: "purefa_host_performance_latency_usec",
              friendlyName: "Host Read Latency",
              metricUnit: "µs",
              attributes: { dimension: "usec_per_read_op" },
              resources: [resource({ hostName: "esx-01" }, 7200)],
            }),
          ],
        }),
      }),
    ).toContain("1. **Host** `esx-01` — **7.2 ms**");
  });

  test("a `name` row is titled by the object the metric's family names", () => {
    const cases: Array<{ metricName: string; kind: string }> = [
      { metricName: "purefa_volume_space_bytes", kind: "Volume" },
      { metricName: "purefa_pod_space_bytes", kind: "Pod" },
      { metricName: "purefa_directory_space_bytes", kind: "Directory" },
      { metricName: "purefa_hw_controller_info", kind: "Controller" },
      {
        metricName: "purefa_network_interface_performance_errors",
        kind: "Network Interface",
      },
      { metricName: "purefb_file_systems_space_bytes", kind: "File System" },
      { metricName: "purefb_buckets_space_bytes", kind: "Bucket" },
      { metricName: "purefb_hardware_health", kind: "Hardware Component" },
      // A volume group is no inventory object: plainly an object.
      { metricName: "purefa_volume_group_space_bytes", kind: "Object" },
    ];

    for (const testCase of cases) {
      const step: MonitorStep = stepFor({
        alias: "q",
        metricName: testCase.metricName,
      });

      const text: string = render({
        monitorStep: step,
        dataToProcess: response({
          monitorStep: step,
          breakdowns: [
            breakdown({
              alias: "q",
              metricName: testCase.metricName,
              friendlyName: testCase.metricName,
              resources: [resource({ objectName: "obj-1" }, 2)],
            }),
          ],
        }),
      });

      expect(text).toContain(`1. **${testCase.kind}** \`obj-1\``);
    }
  });

  test("a criteria that fires when the metric FALLS lists the unhealthy (zero) rows, lowest first", () => {
    const step: MonitorStep = getStorageArrayAlertTemplateById(
      "purefb-hardware-unhealthy",
    )!.getMonitorStep({
      arrayIdentifier: ARRAY,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "FB",
    });

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({
        monitorStep: step,
        breakdowns: [
          breakdown({
            alias: "hardware_health",
            metricName: "purefb_hardware_health",
            friendlyName: "Hardware Health",
            resources: [
              resource({ objectName: "CH1.FB1", componentType: "fb" }, 1, 1),
              resource({ objectName: "CH1.FB2", componentType: "fb" }, 1, 0),
              resource({ objectName: "CH1.FB3", componentType: "fb" }, 2, 2),
            ],
          }),
        ],
      }),
    });

    expect(text).toContain("(1 total)");
    expect(text).toContain("1. **Hardware Component** `CH1.FB2` — **0**");
    expect(text).not.toContain("CH1.FB1");
    expect(text).not.toContain("CH1.FB3");
  });

  /*
   * A unit no catalog knows labels the value as the exporter wrote it: text
   * a monitored system chose, so it is no tag or chat mention in the list.
   */
  test("a value labelled with a unit no catalog knows reads as text", () => {
    const step: MonitorStep = stepFor({
      alias: "vendor_metric",
      metricName: "purefa_vendor_specific_gauge",
      value: 0,
    });

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({
        monitorStep: step,
        breakdowns: [
          breakdown({
            alias: "vendor_metric",
            metricName: "purefa_vendor_specific_gauge",
            friendlyName: "Vendor Gauge",
            metricUnit: "<!here>",
            resources: [resource({ objectName: "vol-enc-01" }, 7)],
          }),
        ],
      }),
    });

    expect(text).toContain("`vol-enc-01`");
    expect(text.split(WORD_JOINER).join("")).toContain("7 \\<!here>");
    expect(text).not.toMatch(/(^|[^\\])<[A-Za-z!@#/]/m);
    expect(SlackUtil.convertMarkdownToSlackRichText(text)).not.toMatch(
      /<[!@#][A-Za-z]/,
    );
  });

  test("a data reduction ratio reads as a ratio, never as a percentage", () => {
    const step: MonitorStep = stepFor({
      alias: "volume_drr",
      metricName: "purefa_volume_space_data_reduction_ratio",
      filterType: FilterType.LessThan,
      value: 2,
    });

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({
        monitorStep: step,
        breakdowns: [
          breakdown({
            alias: "volume_drr",
            metricName: "purefa_volume_space_data_reduction_ratio",
            friendlyName: "Volume Data Reduction Ratio",
            metricUnit: "1",
            resources: [resource({ objectName: "vol-enc-01" }, 1.08, 1.04)],
          }),
        ],
      }),
    });

    expect(text).toContain("1. **Volume** `vol-enc-01` — **1.04**");
    expect(text).not.toContain("%");
  });

  test("a FlashBlade file system's available ratio is read with its own unit, not the name's bytes", () => {
    const step: MonitorStep = getStorageArrayAlertTemplateById(
      "purefb-file-system-near-full",
    )!.getMonitorStep({
      arrayIdentifier: ARRAY,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "FB",
    });

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({
        monitorStep: step,
        breakdowns: [
          breakdown({
            alias: "available_ratio",
            metricName: "purefb_file_systems_space_bytes",
            friendlyName: "File System Space Available (Ratio)",
            metricUnit: "1",
            attributes: { space: "available_ratio" },
            resources: [resource({ objectName: "fs-home" }, 0.06, 0.04)],
          }),
        ],
      }),
    });

    expect(text).toContain("1. **File System** `fs-home` — **0.04**");
    expect(text).not.toMatch(/0\.04 ?B\b/);
    expect(text).toContain(
      "- Metric: File System Space Available (Ratio) (`purefb_file_systems_space_bytes`)",
    );
  });
});

describe("Storage Array root cause: grouped monitors end to end", () => {
  test("a grouped hardware template names each breaching component from its series", async () => {
    const step: MonitorStep = getStorageArrayAlertTemplateById(
      "purefa-hardware-critical",
    )!.getMonitorStep({
      arrayIdentifier: ARRAY,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "Hardware",
    });

    const queryConfig: MetricQueryConfigData =
      MonitorStep.getMetricsViewConfig(step)!.queryConfigs[0]!;

    const seriesFor: (componentName: string) => MetricSeriesResult = (
      componentName: string,
    ): MetricSeriesResult => {
      const attributes: JSONObject = {
        "resource.storage.array.name": ARRAY,
        component_name: componentName,
        component_type: "cooling",
        component_status: "critical",
      };
      const labels: JSONObject = MetricSeriesFingerprint.extractSeriesLabels({
        sample: { attributes: attributes } as unknown as AggregateModel,
        attributeKeys: ["component_name"],
      });
      return {
        fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
        labels: labels,
        aggregatedResults: [
          {
            data: [
              {
                timestamp: new Date(),
                value: 1,
                attributes: attributes,
              } as unknown as AggregateModel,
            ],
          },
        ],
      };
    };

    const dataToProcess: MetricMonitorResponse = {
      ...response({ monitorStep: step }),
      metricViewConfig: MonitorStep.getMetricsViewConfig(step)!,
      seriesBreakdown: [seriesFor("CT0.FAN0"), seriesFor("CT1.FAN2")],
    };

    expect(queryConfig.metricQueryData.groupByAttributeKeys).toEqual([
      "component_name",
    ]);

    const monitor: Monitor = new Monitor();
    monitor._id = ObjectID.generate().toString();
    monitor.monitorType = MonitorType.StorageArray;
    monitor.name = "Hardware";

    const result: ProbeApiIngestResponse =
      await MonitorCriteriaEvaluator.processMonitorStep({
        dataToProcess: dataToProcess,
        monitorStep: step,
        monitor: monitor,
        probeApiIngestResponse: {
          monitorId: monitor.id!,
          rootCause: null,
        },
        evaluationSummary: {
          criteriaResults: [],
          events: [],
        } as unknown as MonitorEvaluationSummary,
      });

    const rootCause: string = result.rootCause || "";
    expect(rootCause).toContain("**Storage Array Details**");
    expect(rootCause).toContain("**Hardware Component** `CT0.FAN0`");
    expect(rootCause).toContain("**Hardware Component** `CT1.FAN2`");
    // The datapoint's component type is borrowed into the row.
    expect(rootCause).toContain("   - Component Type: `cooling`");
  });
});
