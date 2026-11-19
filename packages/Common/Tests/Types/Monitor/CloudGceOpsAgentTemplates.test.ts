import { describe, expect, test } from "@jest/globals";
import MetricMonitorCriteria, {
  MetricSeriesEvaluationResult,
} from "../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_MEMORY_HIGH_PERCENT,
  CLOUD_STORAGE_FULL_PERCENT,
  CLOUD_STORAGE_HIGH_PERCENT,
  CloudResourceReadings,
  GCP_OPS_AGENT_DISK_KEY,
  GCP_OPS_AGENT_MEMORY_KEY,
  getCloudHealthSeverity,
  CloudHealthSeverity,
} from "../../../Types/Cloud/CloudResourceHealth";
import { GCP_RESOURCE_TYPE_ATTRIBUTE } from "../../../Types/Cloud/CloudMonitoredResource";
import Dictionary from "../../../Types/Dictionary";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import {
  CLOUD_ALERT_SHELL_NAMES,
  CLOUD_ALERT_WINDOWS,
  CloudAlertTemplate,
  CloudAlertTemplateArgs,
  GCE_DISK_FIRST_COMMAND,
  GCE_MEMORY_FIRST_COMMAND,
  GCP_OPS_AGENT_DISK_DEVICE_ATTRIBUTE,
  getAllCloudAlertTemplates,
  getCloudAlertIncidentDescription,
  getCloudAlertTemplate,
  getCloudAlertTemplatesFor,
  getGceSshCommand,
  isCloudAlertTemplateOfOpsAgent,
} from "../../../Types/Monitor/CloudAlertTemplates";
import {
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../Types/RollingTime/RollingTimeUtil";

/*
 * #9741: RECOMMENDED MONITORS FOR A COMPUTE ENGINE VM'S MEMORY AND DISKS.
 *
 * The Ops Agent on a VM reports how full its memory and its disks are (a
 * series per disk, `device`), and the VM's health is judged by them: a
 * warning from 95% of its memory, from 90% of a disk and critical from
 * 95%. These monitors page on the same lines, offered only to a VM that
 * reports them, each disk judged on its own and named on what it opens,
 * with the first command to run: a look inside the VM over SSH, from
 * Google Cloud Shell.
 */

const MEMORY_ID: string = "cloud-gcp-compute-memory-nearly-full";
const DISK_ID: string = "cloud-gcp-compute-disk-nearly-full";
const DISK_FULL_ID: string = "cloud-gcp-compute-disk-full";
const AGENT_IDS: Array<string> = [MEMORY_ID, DISK_ID, DISK_FULL_ID];

const VM_ATTRIBUTES: Dictionary<string> = {
  [GCP_RESOURCE_TYPE_ATTRIBUTE]: "gce_instance",
  "resource.project_id": "shop-prod",
  "resource.zone": "us-central1-a",
  "resource.instance_id": "4718294310295840123",
};

const NOW: Date = new Date(Date.UTC(2026, 10, 19, 12, 30, 30));
const MINUTE_MS: number = 60 * 1000;

function template(id: string): CloudAlertTemplate {
  const found: CloudAlertTemplate | undefined = getCloudAlertTemplate(id);

  expect(found).toBeDefined();

  return found!;
}

function reading(value: number): { value: number; time: string } {
  return { value, time: new Date(NOW.getTime() - 4 * MINUTE_MS).toISOString() };
}

function argsFor(
  overrides: Partial<CloudAlertTemplateArgs> = {},
): CloudAlertTemplateArgs {
  return {
    cloudResourceId: "00000000-0000-4000-8000-0000000000c1",
    telemetryAttributes: { ...VM_ATTRIBUTES },
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "web-1",
    resourceName: "web-1",
    ...overrides,
  };
}

function idsFor(readings: CloudResourceReadings): Array<string> {
  return getCloudAlertTemplatesFor({
    provider: "gcp",
    resourceType: "gce_instance",
    telemetryAttributes: VM_ATTRIBUTES,
    readings,
    isReadByConnection: true,
  }).map((found: CloudAlertTemplate): string => {
    return found.id;
  });
}

function viewConfigOf(step: MonitorStep): MetricsViewConfig {
  return step.data!.metricMonitor!.metricViewConfig;
}

function instancesOf(step: MonitorStep): Array<MonitorCriteriaInstance> {
  return step.data!.monitorCriteria!.data!.monitorCriteriaInstanceArray;
}

describe("the templates", () => {
  test("memory nearly full, a disk nearly full and a disk full, for a Compute Engine VM", () => {
    expect(
      AGENT_IDS.map((id: string) => {
        const found: CloudAlertTemplate = template(id);

        return [
          found.id,
          found.name,
          found.severity,
          found.category,
          found.threshold,
          found.thresholdLabel,
          found.measure,
          found.resourceTypes,
        ];
      }),
    ).toEqual([
      [
        MEMORY_ID,
        "Memory Nearly Full",
        "Warning",
        "Utilization",
        95,
        "at or above 95%",
        "sustained",
        ["gce_instance"],
      ],
      [
        DISK_ID,
        "Disk Nearly Full",
        "Warning",
        "Storage",
        90,
        "at or above 90%",
        "sustained",
        ["gce_instance"],
      ],
      [
        DISK_FULL_ID,
        "Disk Full",
        "Critical",
        "Storage",
        95,
        "at or above 95%",
        "sustained",
        ["gce_instance"],
      ],
    ]);
  });

  test("their lines are the health rules': the VM reads Degraded or Unhealthy when they fire", () => {
    expect(template(MEMORY_ID).threshold).toBe(CLOUD_MEMORY_HIGH_PERCENT);
    expect(template(DISK_ID).threshold).toBe(CLOUD_STORAGE_HIGH_PERCENT);
    expect(template(DISK_FULL_ID).threshold).toBe(CLOUD_STORAGE_FULL_PERCENT);

    const judge: (key: string, value: number) => CloudHealthSeverity | null = (
      key: string,
      value: number,
    ): CloudHealthSeverity | null => {
      return getCloudHealthSeverity({
        provider: "gcp",
        type: "gce_instance",
        readings: { [key]: reading(value) },
      });
    };

    expect(judge(GCP_OPS_AGENT_MEMORY_KEY, 95)).toBe(
      CloudHealthSeverity.Warning,
    );
    expect(judge(GCP_OPS_AGENT_DISK_KEY, 90)).toBe(CloudHealthSeverity.Warning);
    expect(judge(GCP_OPS_AGENT_DISK_KEY, 95)).toBe(
      CloudHealthSeverity.Critical,
    );
  });

  test("each is a Metrics monitor over Google Cloud's 15 minutes, every five, whose summary fits", () => {
    for (const id of AGENT_IDS) {
      const found: CloudAlertTemplate = template(id);

      expect(found.provider).toBe(CloudProvider.GCP);
      expect(found.monitorType).toBe(MonitorType.Metrics);
      expect(found.rollingTime).toBe(CLOUD_ALERT_WINDOWS[CloudProvider.GCP]);
      expect(found.rollingTime).toBe(RollingTime.Past15Minutes);
      expect(found.monitoringInterval).toBe("*/5 * * * *");
      expect(found.isBetterStreamed).toBe(false);
      expect(found.requiresReading).toBe(true);
      expect(found.summary.length).toBeLessThanOrEqual(90);
      expect(isCloudAlertTemplateOfOpsAgent(found)).toBe(true);
      // It says the agent is what reports it.
      expect(found.description).toContain("Ops Agent");
    }
  });

  test("only these read what only the agent reports", () => {
    expect(
      getAllCloudAlertTemplates()
        .filter(isCloudAlertTemplateOfOpsAgent)
        .map((found: CloudAlertTemplate): string => {
          return found.id;
        }),
    ).toEqual(AGENT_IDS);
  });
});

describe("offered only to a VM that reports them", () => {
  test("a VM without the Ops Agent is offered its CPU alone", () => {
    expect(idsFor({})).toEqual(["cloud-gcp-compute-high-cpu"]);
    expect(
      idsFor({
        "compute.googleapis.com/instance/cpu/utilization": reading(0.4),
      }),
    ).toEqual(["cloud-gcp-compute-high-cpu"]);
  });

  test("its memory, once the agent reports it; its disks, once it reports them", () => {
    expect(idsFor({ [GCP_OPS_AGENT_MEMORY_KEY]: reading(41) })).toEqual([
      "cloud-gcp-compute-high-cpu",
      MEMORY_ID,
    ]);
    expect(idsFor({ [GCP_OPS_AGENT_DISK_KEY]: reading(71) })).toEqual([
      "cloud-gcp-compute-high-cpu",
      DISK_ID,
      DISK_FULL_ID,
    ]);
    expect(
      idsFor({
        [GCP_OPS_AGENT_MEMORY_KEY]: reading(41),
        [GCP_OPS_AGENT_DISK_KEY]: reading(71),
      }),
    ).toEqual(["cloud-gcp-compute-high-cpu", ...AGENT_IDS]);
  });

  test("whoever reads the VM: a collector's VM with the readings is offered them too", () => {
    expect(
      getCloudAlertTemplatesFor({
        provider: "gcp",
        resourceType: "gce_instance",
        telemetryAttributes: VM_ATTRIBUTES,
        readings: { [GCP_OPS_AGENT_DISK_KEY]: reading(71) },
        isReadByConnection: false,
      }).map((found: CloudAlertTemplate): string => {
        return found.id;
      }),
    ).toContain(DISK_ID);
  });

  test("an account's Recommendations count them as the others: by the same offering", () => {
    const offered: Array<MonitorRecommendation> =
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.CloudResource,
        {
          cloudProvider: "gcp",
          cloudResourceType: "gce_instance",
          cloudTelemetryAttributes: VM_ATTRIBUTES,
          cloudReadings: {
            [GCP_OPS_AGENT_MEMORY_KEY]: reading(41),
            [GCP_OPS_AGENT_DISK_KEY]: reading(71),
          },
          cloudReadByConnection: true,
          cloudResourceName: "web-1",
        },
      );

    expect(
      offered.map((recommendation: MonitorRecommendation): string => {
        return recommendation.recommendationId;
      }),
    ).toEqual(
      expect.arrayContaining(
        AGENT_IDS.map((id: string): string => {
          return expect.stringContaining(id) as unknown as string;
        }),
      ),
    );
  });
});

describe("the monitor each builds", () => {
  test("memory: the VM's one series, the most of each minute", () => {
    const step: MonitorStep = template(MEMORY_ID).getMonitorStep(argsFor());
    const [query] = viewConfigOf(step)
      .queryConfigs as Array<MetricQueryConfigData>;

    expect(query!.metricQueryData.filterData).toEqual({
      metricName: GCP_OPS_AGENT_MEMORY_KEY,
      attributes: VM_ATTRIBUTES,
      aggegationType: AggregationType.Max,
      aggregateBy: {},
    });
    expect(query!.metricQueryData.groupByAttributeKeys).toBeUndefined();
    expect(query!.eventScope).toEqual({
      cloudResourceId: "00000000-0000-4000-8000-0000000000c1",
    });
    expect(query!.metricAliasData?.legendUnit).toBe("%");
  });

  test("disks: a series per disk, each its most of each minute, so the fullest is never averaged away", () => {
    for (const id of [DISK_ID, DISK_FULL_ID]) {
      const step: MonitorStep = template(id).getMonitorStep(argsFor());
      const [query] = viewConfigOf(step)
        .queryConfigs as Array<MetricQueryConfigData>;

      expect(query!.metricQueryData.filterData.metricName).toBe(
        GCP_OPS_AGENT_DISK_KEY,
      );
      expect(query!.metricQueryData.filterData.aggegationType).toBe(
        AggregationType.Max,
      );
      expect(query!.metricQueryData.groupByAttributeKeys).toEqual([
        GCP_OPS_AGENT_DISK_DEVICE_ATTRIBUTE,
      ]);
      expect(GCP_OPS_AGENT_DISK_DEVICE_ATTRIBUTE).toBe("device");
      expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual(["device"]);
    }
  });

  test("every reading of the window at the line fires; below it, it clears", () => {
    for (const id of AGENT_IDS) {
      const step: MonitorStep = template(id).getMonitorStep(argsFor());
      const [unhealthy, healthy] = instancesOf(step);
      const fires: CriteriaFilter = unhealthy!.data!.filters[0]!;

      expect(fires.filterType).toBe(FilterType.GreaterThanOrEqualTo);
      expect(fires.value).toBe(template(id).threshold);
      expect(fires.metricMonitorOptions?.metricAggregationType).toBe(
        EvaluateOverTimeType.AllValues,
      );
      expect(healthy!.data!.filters[0]!.filterType).toBe(FilterType.LessThan);
    }
  });
});

describe("the first command an incident says", () => {
  test("a look inside the VM over SSH, from Google Cloud Shell, by its name, zone and project", () => {
    expect(template(MEMORY_ID).firstCommand!(VM_ATTRIBUTES, "web-1")).toBe(
      "gcloud compute ssh web-1 --zone us-central1-a --project shop-prod --command 'free -m; ps -eo pid,user,%mem,rss,comm --sort=-%mem | head -n 15'",
    );
    expect(template(DISK_ID).firstCommand!(VM_ATTRIBUTES, "web-1")).toBe(
      "gcloud compute ssh web-1 --zone us-central1-a --project shop-prod --command 'df -h'",
    );
    expect(template(DISK_FULL_ID).firstCommand!(VM_ATTRIBUTES, "web-1")).toBe(
      template(DISK_ID).firstCommand!(VM_ATTRIBUTES, "web-1"),
    );
    expect(GCE_MEMORY_FIRST_COMMAND).toContain("--sort=-%mem");
    expect(GCE_DISK_FIRST_COMMAND).toBe("df -h");
  });

  test("the incident ends with it, in Google Cloud Shell", () => {
    expect(CLOUD_ALERT_SHELL_NAMES[CloudProvider.GCP]).toBe(
      "Google Cloud Shell",
    );

    const step: MonitorStep = template(DISK_ID).getMonitorStep(argsFor());
    const [unhealthy] = instancesOf(step);

    expect(unhealthy!.data!.incidents[0]!.description).toBe(
      `${template(DISK_ID).incidentDescription} First, run this in Google Cloud Shell: \`gcloud compute ssh web-1 --zone us-central1-a --project shop-prod --command 'df -h'\``,
    );
    // AWS's are still AWS CloudShell's.
    expect(
      getCloudAlertIncidentDescription(
        {
          provider: CloudProvider.AWS,
          incidentDescription: "Down.",
          firstCommand: (): string => {
            return "aws x";
          },
        },
        {},
      ),
    ).toBe("Down. First, run this in AWS CloudShell: `aws x`");
  });

  test("a name gcloud does not take, or none, says no command rather than a wrong one", () => {
    for (const name of [
      undefined,
      null,
      "",
      // Its numeric id, the name a VM gets while nothing named it.
      "4718294310295840123",
      "Web 1",
      "web-1; rm -rf /",
      "web_1",
      "-web",
      `w${"e".repeat(63)}`,
    ]) {
      expect([
        name,
        getGceSshCommand({
          attributes: VM_ATTRIBUTES,
          resourceName: name,
          command: "df -h",
        }),
      ]).toEqual([name, null]);
    }

    // The description says no command then.
    const step: MonitorStep = template(DISK_ID).getMonitorStep(
      argsFor({ resourceName: undefined }),
    );

    expect(instancesOf(step)[0]!.data!.incidents[0]!.description).toBe(
      template(DISK_ID).incidentDescription,
    );
  });

  test("a zone or a project that is no zone or project says none either", () => {
    for (const attributes of [
      { ...VM_ATTRIBUTES, "resource.zone": "us-central1" },
      { ...VM_ATTRIBUTES, "resource.zone": "" },
      { ...VM_ATTRIBUTES, "resource.project_id": "Shop Prod" },
      { ...VM_ATTRIBUTES, "resource.project_id": "$(whoami)" },
      { [GCP_RESOURCE_TYPE_ATTRIBUTE]: "gce_instance" },
    ]) {
      expect(
        getGceSshCommand({
          attributes,
          resourceName: "web-1",
          command: "df -h",
        }),
      ).toBe(null);
    }

    // A domain-scoped project is one.
    expect(
      getGceSshCommand({
        attributes: {
          ...VM_ATTRIBUTES,
          "resource.project_id": "example.com:shop-prod",
        },
        resourceName: "web-1",
        command: "df -h",
      }),
    ).toBe(
      "gcloud compute ssh web-1 --zone us-central1-a --project example.com:shop-prod --command 'df -h'",
    );
  });

  test("the recommendation catalog hands the VM's own name to its monitor", () => {
    const recommendation: MonitorRecommendation | undefined =
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.CloudResource,
        {
          cloudProvider: "gcp",
          cloudResourceType: "gce_instance",
          cloudTelemetryAttributes: VM_ATTRIBUTES,
          cloudReadings: { [GCP_OPS_AGENT_DISK_KEY]: reading(71) },
          cloudReadByConnection: true,
          cloudResourceName: "web-1",
        },
      ).find((candidate: MonitorRecommendation): boolean => {
        return candidate.recommendationId.includes(DISK_FULL_ID);
      });

    expect(recommendation).toBeDefined();

    const step: MonitorStep = recommendation!.getMonitorStep({
      resourceIdentifier: "00000000-0000-4000-8000-0000000000c1",
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "web-1 - Disk Full",
    });

    expect(instancesOf(step)[0]!.data!.incidents[0]!.description).toContain(
      "gcloud compute ssh web-1 --zone us-central1-a --project shop-prod --command 'df -h'",
    );
  });
});

/*
 * What the worker decides of a VM's disks: each disk's series judged on
 * its own (MetricMonitorCriteria.evaluateAllSeries), a minute a point.
 */
describe("each disk, judged on its own", () => {
  function diskSeries(
    device: string,
    value: (minute: number) => number,
  ): {
    fingerprint: string;
    labels: Dictionary<string>;
    result: AggregatedResult;
  } {
    const data: AggregatedResult["data"] = [];

    // A minute a point, the newest four minutes old, over the window.
    for (let minute: number = 4; minute <= 18; minute++) {
      data.push({
        timestamp: new Date(NOW.getTime() - minute * MINUTE_MS),
        value: value(minute),
      });
    }

    data.reverse();

    return {
      fingerprint: `device=${device}`,
      labels: { device },
      result: { data },
    };
  }

  async function breachedDevices(
    id: string,
    series: Array<ReturnType<typeof diskSeries>>,
  ): Promise<Array<string>> {
    const step: MonitorStep = template(id).getMonitorStep(argsFor());
    const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
      template(id).rollingTime,
      NOW,
    );
    const response: MetricMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      metricViewConfig: viewConfigOf(step),
      metricResult: [],
      seriesBreakdown: series.map((item: ReturnType<typeof diskSeries>) => {
        return {
          fingerprint: item.fingerprint,
          labels: item.labels,
          aggregatedResults: [item.result],
        };
      }),
      startAndEndDate: window,
    };
    const [unhealthy] = instancesOf(step);
    const evaluations: Array<MetricSeriesEvaluationResult> =
      await MetricMonitorCriteria.evaluateAllSeries({
        dataToProcess: response,
        criteriaFilter: JSON.parse(
          JSON.stringify(unhealthy!.data!.filters[0]!),
        ) as CriteriaFilter,
        monitorStep: step,
      });

    return evaluations
      .filter((evaluation: MetricSeriesEvaluationResult): boolean => {
        return evaluation.rootCause !== null;
      })
      .map((evaluation: MetricSeriesEvaluationResult): string => {
        return String(evaluation.labels["device"]);
      });
  }

  test("the full disk fires, the empty one beside it does not: nothing is averaged", async () => {
    const series: Array<ReturnType<typeof diskSeries>> = [
      diskSeries("/dev/sda1", () => {
        return 97;
      }),
      diskSeries("/dev/sdb", () => {
        return 12;
      }),
    ];

    expect(await breachedDevices(DISK_ID, series)).toEqual(["/dev/sda1"]);
    expect(await breachedDevices(DISK_FULL_ID, series)).toEqual(["/dev/sda1"]);
  });

  test("a disk at 92% is nearly full, not full", async () => {
    const series: Array<ReturnType<typeof diskSeries>> = [
      diskSeries("/dev/sda1", () => {
        return 92;
      }),
    ];

    expect(await breachedDevices(DISK_ID, series)).toEqual(["/dev/sda1"]);
    expect(await breachedDevices(DISK_FULL_ID, series)).toEqual([]);
  });

  test("a disk that dips under the line in the window has not held there: no breach", async () => {
    const series: Array<ReturnType<typeof diskSeries>> = [
      diskSeries("/dev/sda1", (minute: number) => {
        return minute === 10 ? 85 : 93;
      }),
    ];

    expect(await breachedDevices(DISK_ID, series)).toEqual([]);
  });
});
