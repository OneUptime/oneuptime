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
  XcpNgAffectedResource,
  XcpNgResourceBreakdown,
} from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorStepXcpNgMonitor from "../../../../Types/Monitor/MonitorStepXcpNgMonitor";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import {
  XcpNgAlertTemplateArgs,
  buildXcpNgMonitorConfig,
  buildXcpNgMonitorStep,
  buildXcpNgOfflineCriteriaInstance,
  buildXcpNgOnlineCriteriaInstance,
  getXcpNgAlertTemplateById,
} from "../../../../Types/Monitor/XcpNgAlertTemplates";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import { XcpNgScope } from "../../../../Types/XcpNg/XcpNgTelemetry";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import { WORD_JOINER } from "../../../../Utils/Markdown/MarkdownEscape";
import { MarkdownText } from "../../../../Utils/Markdown/FeedMarkdown";
import { describe, expect, test } from "@jest/globals";
import { Lexer, Token, marked } from "marked";

// The root cause builders write MarkdownText; these tests read its text.
function textOf(markdown: MarkdownText | null): string | null {
  return markdown === null ? null : markdown.toString();
}

/*
 * The root cause an XCP-ng monitor writes into its incident or alert: the
 * "XCP-ng Pool Details" block (the pool's UUID, the metric the criteria
 * compared, the step's scope / object / host filters) and the "Affected
 * Resources" list, titled by what each row is - a host, a VM, a storage
 * repository, a virtual disk - named by its name next to its UUID, with
 * where it sits beneath (the host a VM runs on, the VM and the storage
 * repository a virtual disk belongs to).
 *
 * The same contract as the other platforms': rows are the ones the
 * matched criteria's direction says breached, worst first; a pool-wide
 * series gets no list.
 */

type BuilderInput = {
  dataToProcess: MetricMonitorResponse;
  monitorStep: MonitorStep;
  monitor: Monitor;
  criteriaInstance?: MonitorCriteriaInstance | undefined;
};

type EvaluatorPrivate = {
  buildXcpNgRootCauseContext: (input: BuilderInput) => MarkdownText | null;
};

const Evaluator: EvaluatorPrivate =
  MonitorCriteriaEvaluator as unknown as EvaluatorPrivate;

const POOL: string = "1e8b7c4a-3f2d-4b6e-9a1c-0d5e7f9b2a3c";
const HOST_1: string = "a1b2c3d4-0000-4000-8000-000000000001";
const HOST_2: string = "a1b2c3d4-0000-4000-8000-000000000002";
const HOST_3: string = "a1b2c3d4-0000-4000-8000-000000000003";
const VM_1: string = "b1b2c3d4-0000-4000-8000-000000000011";
const SR_1: string = "c1b2c3d4-0000-4000-8000-000000000021";
const VDI_1: string = "d1b2c3d4-0000-4000-8000-000000000031";

const templateArgs: XcpNgAlertTemplateArgs = {
  poolIdentifier: POOL,
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Production",
};

function stepFor(input: {
  alias: string;
  metricName: string;
  attributes?: Record<string, string>;
  resourceFilters?: MonitorStepXcpNgMonitor["resourceFilters"];
  groupByAttributeKey?: string | undefined;
  filterType?: FilterType;
  value?: number;
}): MonitorStep {
  const xcpNgMonitor: MonitorStepXcpNgMonitor = buildXcpNgMonitorConfig({
    poolIdentifier: POOL,
    queries: [
      {
        alias: input.alias,
        metricName: input.metricName,
        attributes: input.attributes,
      },
    ],
    rollingTime: RollingTime.Past5Minutes,
    aggregationType: MetricsAggregationType.Max,
    groupByAttributeKey: input.groupByAttributeKey,
  });

  if (input.resourceFilters) {
    xcpNgMonitor.resourceFilters = input.resourceFilters;
  }

  return buildXcpNgMonitorStep({
    xcpNgMonitor: xcpNgMonitor,
    offlineCriteriaInstance: buildXcpNgOfflineCriteriaInstance({
      offlineMonitorStatusId: ObjectID.generate(),
      incidentSeverityId: ObjectID.generate(),
      alertSeverityId: ObjectID.generate(),
      monitorName: "XCP-ng Monitor",
      metricAlias: input.alias,
      filterType: input.filterType ?? FilterType.GreaterThan,
      value: input.value ?? 0,
    }),
    onlineCriteriaInstance: buildXcpNgOnlineCriteriaInstance({
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
  resources: Array<XcpNgAffectedResource>;
}): XcpNgResourceBreakdown {
  return {
    poolIdentifier: POOL,
    metricName: input.metricName,
    metricFriendlyName: input.friendlyName,
    metricAlias: input.alias,
    metricUnit: input.metricUnit,
    attributes: {
      ...(input.attributes || {}),
      "resource.xcp_ng.pool.id": POOL,
    },
    affectedResources: input.resources,
  };
}

function response(input: {
  monitorStep: MonitorStep;
  breakdowns?: Array<XcpNgResourceBreakdown>;
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
    xcpNgResourceBreakdowns: input.breakdowns,
  };
}

function render(input: {
  monitorStep: MonitorStep;
  dataToProcess: MetricMonitorResponse;
  criteriaInstance?: MonitorCriteriaInstance;
}): string {
  return (
    textOf(
      Evaluator.buildXcpNgRootCauseContext({
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
  identity: Partial<XcpNgAffectedResource>,
  value: number,
  lowest?: number,
): XcpNgAffectedResource {
  return {
    scope: undefined,
    objectId: undefined,
    hostName: undefined,
    vmName: undefined,
    storageRepositoryName: undefined,
    vdiName: undefined,
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

describe("XCP-ng root cause: the details block", () => {
  test("names the pool by its UUID, the metric compared and the step's filters", () => {
    const step: MonitorStep = stepFor({
      alias: "host_running",
      metricName: "xcp_ng.host.running",
      attributes: { "xcp_ng.scope": "host" },
      resourceFilters: {
        scope: XcpNgScope.Host,
        xcpNgId: ` ${HOST_1} `,
        hostName: "xcp-host-01",
      },
      filterType: FilterType.LessThan,
      value: 1,
    });

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({ monitorStep: step }),
    });

    expect(text).toContain(
      [
        "**XCP-ng Pool Details**",
        `- Pool: ${POOL}`,
        "- Metric: Host Running (`xcp_ng.host.running`)",
        "- Scope Filter: host",
        `- Object Filter: ${HOST_1}`,
        "- Host Filter: xcp-host-01",
      ].join("\n"),
    );
  });

  test("a blank or non-text filter is left out", () => {
    const step: MonitorStep = stepFor({
      alias: "vm_cpu",
      metricName: "xcp_vm_cpu_usage",
      resourceFilters: {
        scope: "  " as XcpNgScope,
        xcpNgId: 42 as unknown as string,
        hostName: "xcp-host-02",
      },
    });

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({ monitorStep: step }),
    });

    expect(text).not.toContain("- Scope Filter:");
    expect(text).not.toContain("- Object Filter:");
    expect(text).toContain("- Host Filter: xcp-host-02");
  });

  test("the breakdown's pool wins over the step's, and a step without one says Unknown", () => {
    const step: MonitorStep = stepFor({
      alias: "vm_cpu",
      metricName: "xcp_vm_cpu_usage",
    });
    step.data!.xcpNgMonitor!.poolIdentifier = "";

    expect(
      render({
        monitorStep: step,
        dataToProcess: response({ monitorStep: step }),
      }),
    ).toContain("- Pool: Unknown");

    expect(
      render({
        monitorStep: step,
        dataToProcess: response({
          monitorStep: step,
          breakdowns: [
            breakdown({
              alias: "vm_cpu",
              metricName: "xcp_vm_cpu_usage",
              friendlyName: "VM CPU Usage",
              metricUnit: "1",
              resources: [
                resource({ scope: "vm", objectId: VM_1, vmName: "web-01" }, 1),
              ],
            }),
          ],
        }),
      }),
    ).toContain(`- Pool: ${POOL}`);
  });

  /*
   * A filter is text the monitor's author typed, shown in a root cause that
   * reaches the dashboard, email, Slack and Microsoft Teams: it reads as
   * typed there, and is no link, tag or chat mention.
   */
  test("shows each filter as text, as it was typed", () => {
    const step: MonitorStep = stepFor({
      alias: "vm_cpu",
      metricName: "xcp_vm_cpu_usage",
      resourceFilters: {
        hostName: "[Runbook](https://evil.example/login) <!channel>",
        xcpNgId: '<img src="https://tracker.example/p.png">',
      },
    });

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({ monitorStep: step }),
    });

    expect(text).toContain(
      '- Object Filter: \\<img src="https://tracker.example/p.png">',
    );
    expect(text).toContain(
      `- Host Filter: \\[Runbook\\](https://evil.example/login) \\<${WORD_JOINER}!channel>`,
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

  test("a formula names the formula and each of its queries' metrics", () => {
    const step: MonitorStep = getXcpNgAlertTemplateById(
      "xcp-ng-sr-near-full",
    )!.getMonitorStep(templateArgs);

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({ monitorStep: step }),
    });

    expect(text).toContain("- Formula: `(sr_used / sr_size) * 100`");
    expect(text).toContain(
      "  - `sr_used` = Storage Repository Used (`xcp_sr_physical_usage_bytes`)",
    );
    expect(text).toContain(
      "  - `sr_size` = Storage Repository Size (`xcp_sr_physical_size_bytes`)",
    );
  });

  test("a pool-wide series lists nothing and falls back to the metric summary", () => {
    const step: MonitorStep = getXcpNgAlertTemplateById(
      "xcp-ng-pool-disconnected",
    )!.getMonitorStep(templateArgs);

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({
        monitorStep: step,
        metricResultPoints: 3,
        breakdowns: [
          breakdown({
            alias: "samples_received",
            metricName: "xcp_pool_connected",
            friendlyName: "Pool Connected",
            resources: [resource({}, 1)],
          }),
        ],
      }),
    });

    expect(text).toContain("**XCP-ng Pool Details**");
    expect(text).not.toContain("**Affected Resources**");
    expect(text).toContain("**Metric Summary**");
    expect(text).toContain("- 3 metric data point(s) returned");
  });
});

describe("XCP-ng root cause: the affected resources list", () => {
  test("Host Offline lists the halted hosts, the zero rows, by name and UUID - not the running ones", () => {
    const step: MonitorStep = getXcpNgAlertTemplateById(
      "xcp-ng-host-offline",
    )!.getMonitorStep(templateArgs);

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({
        monitorStep: step,
        breakdowns: [
          breakdown({
            alias: "host_running",
            metricName: "xcp_ng.host.running",
            friendlyName: "Host Running",
            attributes: { "xcp_ng.scope": "host" },
            resources: [
              resource(
                { scope: "host", objectId: HOST_1, hostName: "xcp-host-01" },
                1,
                1,
              ),
              resource(
                { scope: "host", objectId: HOST_2, hostName: "xcp-host-02" },
                1,
                0,
              ),
              resource(
                { scope: "host", objectId: HOST_3, hostName: "xcp-host-03" },
                0,
                0,
              ),
            ],
          }),
        ],
      }),
    });

    expect(text).toContain("**Affected Resources** (2 total)");
    expect(text).toContain(`**Host** \`xcp-host-02\` (\`${HOST_2}\`) — **0**`);
    expect(text).toContain(`**Host** \`xcp-host-03\` (\`${HOST_3}\`) — **0**`);
    expect(text).not.toContain("xcp-host-01");
    // A host's own row names no host beneath it.
    expect(text).not.toContain("   - Host:");
  });

  test("a VM is titled VM, with the host it runs on beneath, and its CPU share reads as a percentage", () => {
    const step: MonitorStep = stepFor({
      alias: "vm_cpu",
      metricName: "xcp_vm_cpu_usage",
      value: 0.9,
    });

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({
        monitorStep: step,
        breakdowns: [
          breakdown({
            alias: "vm_cpu",
            metricName: "xcp_vm_cpu_usage",
            friendlyName: "VM CPU Usage",
            resources: [
              resource(
                {
                  scope: "vm",
                  objectId: VM_1,
                  vmName: "web-01",
                  hostName: "xcp-host-01",
                },
                0.95,
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
        // Xen Orchestra's 0-1 share, as the catalog's ratio: a percentage.
        `1. **VM** \`web-01\` (\`${VM_1}\`) — **95.00%**`,
        "   - Host: `xcp-host-01`",
      ].join("\n"),
    );
  });

  test("storage repositories and virtual disks are titled as such, with what they belong to, worst first", () => {
    const step: MonitorStep = stepFor({
      alias: "used",
      metricName: "xcp_vdi_physical_usage_bytes",
      value: 0,
    });

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({
        monitorStep: step,
        breakdowns: [
          breakdown({
            alias: "used",
            metricName: "xcp_vdi_physical_usage_bytes",
            friendlyName: "Virtual Disk Used",
            resources: [
              resource(
                {
                  scope: "sr",
                  objectId: SR_1,
                  storageRepositoryName: "Local storage",
                },
                1e12,
              ),
              resource(
                {
                  scope: "vdi",
                  objectId: VDI_1,
                  vdiName: "web-01 disk 0",
                  vmName: "web-01",
                  storageRepositoryName: "Local storage",
                },
                2.5e12,
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
        // Bytes, as the catalog says, held to the figure by a no-break space.
        `1. **Virtual Disk** \`web-01 disk 0\` (\`${VDI_1}\`) — **2.5\u00A0TB**`,
        "   - VM: `web-01`",
        "   - Storage Repository: `Local storage`",
        `2. **Storage Repository** \`Local storage\` (\`${SR_1}\`) — **1\u00A0TB**`,
      ].join("\n"),
    );
  });

  test("a row with no scope is titled by the narrowest name it carries", () => {
    const step: MonitorStep = stepFor({
      alias: "q",
      metricName: "xcp_host_disk_latency_seconds",
      value: 0,
    });

    const cases: Array<{
      identity: Partial<XcpNgAffectedResource>;
      title: string;
    }> = [
      { identity: { vdiName: "disk-a" }, title: "**Virtual Disk** `disk-a`" },
      { identity: { vmName: "web-01" }, title: "**VM** `web-01`" },
      {
        identity: { storageRepositoryName: "NFS" },
        title: "**Storage Repository** `NFS`",
      },
      {
        identity: { hostName: "xcp-host-01" },
        title: "**Host** `xcp-host-01`",
      },
      { identity: { objectId: HOST_1 }, title: `**Object** \`${HOST_1}\`` },
    ];

    for (const testCase of cases) {
      const text: string = render({
        monitorStep: step,
        dataToProcess: response({
          monitorStep: step,
          breakdowns: [
            breakdown({
              alias: "q",
              metricName: "xcp_host_disk_latency_seconds",
              friendlyName: "Host Disk Latency",
              resources: [resource(testCase.identity, 3)],
            }),
          ],
        }),
      });

      expect({
        case: testCase.title,
        found: text.includes(`1. ${testCase.title}`),
      }).toEqual({
        case: testCase.title,
        found: true,
      });
    }
  });

  test("a pool-scoped row is the pool, named by its UUID", () => {
    const step: MonitorStep = stepFor({
      alias: "q",
      metricName: "xcp_pool_connected",
      value: 0,
    });

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({
        monitorStep: step,
        breakdowns: [
          breakdown({
            alias: "q",
            metricName: "xcp_pool_connected",
            friendlyName: "Pool Connected",
            resources: [
              resource(
                { scope: "pool", objectId: POOL, hostName: "master" },
                1,
              ),
            ],
          }),
        ],
      }),
    });

    expect(text).toContain(`1. **Pool** \`${POOL}\` — **1**`);
    // The pool's row names nothing beneath it.
    expect(text).not.toContain("   - Host:");
  });

  test("an object's name is text a monitored system chose: no tag or chat mention", () => {
    const step: MonitorStep = stepFor({
      alias: "vm_cpu",
      metricName: "xcp_vm_cpu_usage",
      value: 0,
    });

    const text: string = render({
      monitorStep: step,
      dataToProcess: response({
        monitorStep: step,
        breakdowns: [
          breakdown({
            alias: "vm_cpu",
            metricName: "xcp_vm_cpu_usage",
            friendlyName: "VM CPU Usage",
            resources: [
              resource(
                {
                  scope: "vm",
                  objectId: VM_1,
                  vmName: "<!here> [x](https://evil.example)",
                  hostName: "<@U123>",
                },
                0.5,
              ),
            ],
          }),
        ],
      }),
    });

    expect(SlackUtil.convertMarkdownToSlackRichText(text)).not.toMatch(
      /<[!@#][A-Za-z]|<https:\/\/evil\.example[^>]*\|/,
    );
  });
});

describe("XCP-ng root cause: grouped monitors end to end", () => {
  test("a grouped Host Offline names each halted host from its series, its name borrowed from the datapoint", async () => {
    const step: MonitorStep = getXcpNgAlertTemplateById(
      "xcp-ng-host-offline",
    )!.getMonitorStep(templateArgs);

    const queryConfig: MetricQueryConfigData =
      MonitorStep.getMetricsViewConfig(step)!.queryConfigs[0]!;

    const seriesFor: (
      hostId: string,
      hostName: string,
    ) => MetricSeriesResult = (
      hostId: string,
      hostName: string,
    ): MetricSeriesResult => {
      const attributes: JSONObject = {
        "resource.xcp_ng.pool.id": POOL,
        "xcp_ng.scope": "host",
        "xcp_ng.id": hostId,
        host_name: hostName,
        power_state: "Halted",
      };
      const labels: JSONObject = MetricSeriesFingerprint.extractSeriesLabels({
        sample: { attributes: attributes } as unknown as AggregateModel,
        attributeKeys: ["xcp_ng.id"],
      });
      return {
        fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
        labels: labels,
        aggregatedResults: [
          {
            data: [
              {
                timestamp: new Date(),
                value: 0,
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
      seriesBreakdown: [
        seriesFor(HOST_1, "xcp-host-01"),
        seriesFor(HOST_2, "xcp-host-02"),
      ],
    };

    // One incident per host: grouped by the object's UUID.
    expect(queryConfig.metricQueryData.groupByAttributeKeys).toEqual([
      "xcp_ng.id",
    ]);

    const monitor: Monitor = new Monitor();
    monitor._id = ObjectID.generate().toString();
    monitor.monitorType = MonitorType.XcpNg;
    monitor.name = "Production";

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
    expect(rootCause).toContain("**XCP-ng Pool Details**");
    expect(rootCause).toContain(`- Pool: ${POOL}`);
    expect(rootCause).toContain(`**Host** \`xcp-host-01\` (\`${HOST_1}\`)`);
    expect(rootCause).toContain(`**Host** \`xcp-host-02\` (\`${HOST_2}\`)`);
  });
});
