import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test, beforeEach } from "@jest/globals";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import {
  CriteriaFilter,
  CriteriaFilterUtil,
} from "Common/Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import DataToProcess from "Common/Server/Utils/Monitor/DataToProcess";
import MetricUnitUtil from "Common/Utils/MetricUnitUtil";
import PlatformMetricUnitUtil, {
  MetricCatalogPlatform,
} from "Common/Utils/Monitor/PlatformMetricUnitUtil";
import {
  getAllKubernetesAlertTemplates,
  KubernetesAlertTemplateArgs,
} from "Common/Types/Monitor/KubernetesAlertTemplates";
import {
  getAllDockerAlertTemplates,
  DockerAlertTemplateArgs,
} from "Common/Types/Monitor/DockerAlertTemplates";
import {
  getAllHostAlertTemplates,
  HostAlertTemplateArgs,
} from "Common/Types/Monitor/HostAlertTemplates";
import {
  getAllPodmanAlertTemplates,
  PodmanAlertTemplateArgs,
} from "Common/Types/Monitor/PodmanAlertTemplates";
import {
  getAllProxmoxAlertTemplates,
  ProxmoxAlertTemplateArgs,
} from "Common/Types/Monitor/ProxmoxAlertTemplates";
import {
  getAllVMwareAlertTemplates,
  VMwareAlertTemplateArgs,
} from "Common/Types/Monitor/VMwareAlertTemplates";
import {
  getAllDockerSwarmAlertTemplates,
  DockerSwarmAlertTemplateArgs,
} from "Common/Types/Monitor/DockerSwarmAlertTemplates";
import {
  getAllCephAlertTemplates,
  CephAlertTemplateArgs,
} from "Common/Types/Monitor/CephAlertTemplates";
import {
  getAllIoTAlertTemplates,
  IoTAlertTemplateArgs,
} from "Common/Types/Monitor/IotAlertTemplates";

/*
 * SAFETY AUDIT: returning `nativeUnitsByMetricName` from the platform
 * monitors must not change whether any shipped template fires.
 *
 * Until now only the generic Metrics monitor returned the unit map, so for
 * a platform query WITHOUT a legendUnit, MetricMonitorCriteria resolved no
 * sample unit at all. It now resolves the platform catalog's unit (or the
 * exporter-declared one). The evaluator converts samples only when
 *
 *     sampleUnit (legendUnit || unit map)  !==  displayUnit (thresholdUnit || sampleUnit)
 *
 * so a criteria's evaluation can change only if its query has no
 * legendUnit AND it sets a thresholdUnit that converts from the new unit.
 * Anything else changes how the numbers are LABELLED, never which samples
 * breach. This file proves that for every criteria of every shipped
 * template of every platform, two ways:
 *
 *  1. statically, by resolving each criteria's query exactly as the
 *     evaluator does and checking the conversion rule above; and
 *  2. end to end, by running the real worker and the real evaluator over
 *     the same data with and without the unit map, under several guesses
 *     at what the exporter declared, and comparing every series' verdict
 *     and compared values.
 *
 * A template that deliberately changes behaviour must be listed in
 * INTENDED_EVALUATION_CHANGES with the reason.
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { aggregateBy: jest.fn(), findBy: jest.fn() },
  };
});
jest.mock("Common/Server/Services/MetricTypeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});
jest.mock("Common/Server/Services/HostService", () => {
  return {
    __esModule: true,
    default: { getExpectedHostIdentifiers: jest.fn() },
  };
});
jest.mock("Common/Server/Services/IoTFleetService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});
jest.mock("Common/Server/Services/IoTDeviceCredentialService", () => {
  return {
    __esModule: true,
    default: { getExpectedDeviceExternalIds: jest.fn() },
  };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import HostService from "Common/Server/Services/HostService";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import MetricMonitorCriteria, {
  MetricSeriesEvaluationResult,
} from "Common/Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import {
  monitorCeph,
  monitorDocker,
  monitorDockerSwarm,
  monitorHost,
  monitorIoT,
  monitorKubernetes,
  monitorPodman,
  monitorProxmox,
  monitorVMware,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;
const expectedHostIdentifiers: jest.Mock =
  HostService.getExpectedHostIdentifiers as unknown as jest.Mock;
const iotFleetFindOneBy: jest.Mock =
  IoTFleetService.findOneBy as unknown as jest.Mock;

/*
 * `templateId|alias` → why its evaluation is meant to change. Empty: no
 * shipped template changes whether it fires.
 */
const INTENDED_EVALUATION_CHANGES: Dictionary<string> = {};

type TemplateArgs = KubernetesAlertTemplateArgs &
  DockerAlertTemplateArgs &
  HostAlertTemplateArgs &
  PodmanAlertTemplateArgs &
  ProxmoxAlertTemplateArgs &
  VMwareAlertTemplateArgs &
  DockerSwarmAlertTemplateArgs &
  CephAlertTemplateArgs &
  IoTAlertTemplateArgs;

type MonitorFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<MetricMonitorResponse>;

interface ShippedTemplate {
  id: string;
  getMonitorStep: (args: TemplateArgs) => MonitorStep;
}

interface PlatformCase {
  monitorType: MonitorType;
  monitor: MonitorFunction;
  templates: Array<ShippedTemplate>;
}

const templateArgs: TemplateArgs = {
  clusterIdentifier: "prod",
  hostIdentifier: "host-1",
  vcenterIdentifier: "vcsa-prod",
  fleetIdentifier: "fleet-1",
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Prod",
};

const platformCases: Array<PlatformCase> = [
  {
    monitorType: MonitorType.Kubernetes,
    monitor: monitorKubernetes,
    templates: getAllKubernetesAlertTemplates(),
  },
  {
    monitorType: MonitorType.Docker,
    monitor: monitorDocker,
    templates: getAllDockerAlertTemplates(),
  },
  {
    monitorType: MonitorType.Host,
    monitor: monitorHost,
    templates: getAllHostAlertTemplates(),
  },
  {
    monitorType: MonitorType.Podman,
    monitor: monitorPodman,
    templates: getAllPodmanAlertTemplates(),
  },
  {
    monitorType: MonitorType.Proxmox,
    monitor: monitorProxmox,
    templates: getAllProxmoxAlertTemplates(),
  },
  {
    monitorType: MonitorType.VMware,
    monitor: monitorVMware,
    templates: getAllVMwareAlertTemplates(),
  },
  {
    monitorType: MonitorType.DockerSwarm,
    monitor: monitorDockerSwarm,
    templates: getAllDockerSwarmAlertTemplates(),
  },
  {
    monitorType: MonitorType.Ceph,
    monitor: monitorCeph,
    templates: getAllCephAlertTemplates(),
  },
  {
    monitorType: MonitorType.IoTDevice,
    monitor: monitorIoT,
    templates: getAllIoTAlertTemplates(),
  },
];

/*
 * What an exporter might have declared for a metric the catalog does not
 * know. The static check tries every one; the end-to-end check declares
 * each of them for every metric in turn.
 */
const DECLARED_UNIT_GUESSES: Array<string | undefined> = [
  undefined,
  "1",
  "%",
  "By",
  "s",
  "ms",
];

interface TemplateCriteria {
  templateId: string;
  platform: MetricCatalogPlatform;
  step: MonitorStep;
  filter: CriteriaFilter;
}

function getViewConfig(step: MonitorStep): MetricsViewConfig {
  const viewConfig: MetricsViewConfig | undefined =
    MonitorStep.getMetricsViewConfig(step);
  expect(viewConfig).toBeDefined();
  return viewConfig!;
}

function getAllTemplateCriteria(): Array<TemplateCriteria> {
  const all: Array<TemplateCriteria> = [];

  for (const platformCase of platformCases) {
    const platform: MetricCatalogPlatform | null =
      PlatformMetricUnitUtil.getPlatformForMonitorType(
        platformCase.monitorType,
      );
    expect(platform).not.toBeNull();

    for (const template of platformCase.templates) {
      const step: MonitorStep = template.getMonitorStep(templateArgs);
      const instances: Array<MonitorCriteriaInstance> =
        step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];

      for (const instance of instances) {
        for (const filter of instance.data?.filters || []) {
          all.push({
            templateId: template.id,
            platform: platform!,
            step: step,
            filter: filter,
          });
        }
      }
    }
  }

  return all;
}

/*
 * The query or formula a criteria compares, resolved exactly the way
 * MetricMonitorCriteria.evaluateOneSeries resolves it: by alias among the
 * queries, then among the formulas, else the first query.
 */
function resolveCriteriaTarget(input: {
  viewConfig: MetricsViewConfig;
  alias: string;
}): {
  query: MetricQueryConfigData | undefined;
  formula: MetricFormulaConfigData | undefined;
} {
  let query: MetricQueryConfigData | undefined = input.alias
    ? input.viewConfig.queryConfigs.find((q: MetricQueryConfigData) => {
        return q.metricAliasData?.metricVariable === input.alias;
      })
    : undefined;

  const formula: MetricFormulaConfigData | undefined =
    !query && input.alias
      ? (input.viewConfig.formulaConfigs || []).find(
          (f: MetricFormulaConfigData) => {
            return f.metricAliasData?.metricVariable === input.alias;
          },
        )
      : undefined;

  if (!query && !formula) {
    query = input.viewConfig.queryConfigs[0];
  }

  return { query, formula };
}

/*
 * Would MetricMonitorCriteria now convert this criteria's samples, when it
 * did not before? Before: no unit map, so a query without a legendUnit had
 * no sample unit and nothing was ever converted.
 */
function evaluationChangeReason(input: {
  criteria: TemplateCriteria;
  declaredUnit: string | undefined;
}): string | null {
  const alias: string =
    input.criteria.filter.metricMonitorOptions?.metricAlias || "";
  const { query, formula } = resolveCriteriaTarget({
    viewConfig: getViewConfig(input.criteria.step),
    alias: alias,
  });

  const legendUnit: string | undefined =
    query?.metricAliasData?.legendUnit ||
    formula?.metricAliasData?.legendUnit ||
    undefined;

  // (a) A legendUnit wins over the unit map, so nothing changed.
  if (legendUnit) {
    return null;
  }

  // A formula's unit never comes from the unit map.
  if (!query) {
    return null;
  }

  const thresholdUnit: string | undefined =
    input.criteria.filter.metricMonitorOptions?.thresholdUnit || undefined;

  // (b) No thresholdUnit: the display unit IS the sample unit — no conversion.
  if (!thresholdUnit) {
    return null;
  }

  const metricName: string =
    (query.metricQueryData.filterData.metricName as string) || "";
  const newSampleUnit: string | undefined =
    PlatformMetricUnitUtil.getMetricUnit({
      platform: input.criteria.platform,
      metricName: metricName,
      declaredUnit: input.declaredUnit,
    });

  if (!newSampleUnit || newSampleUnit === thresholdUnit) {
    return null;
  }

  // (c) Different spellings of one unit ("bytes" vs "B") convert by 1.
  const probe: number = 12345.678;
  const converted: number = MetricUnitUtil.convertToMetricUnit({
    value: probe,
    fromUnit: newSampleUnit,
    metricUnit: thresholdUnit,
  });

  if (converted === probe) {
    return null;
  }

  return `${metricName}: samples would convert ${newSampleUnit} → ${thresholdUnit} (declared ${input.declaredUnit ?? "nothing"})`;
}

describe("shipped platform templates: the unit map cannot change evaluation", () => {
  test("no template uses an anomaly criteria (whose evaluation this audit does not cover)", () => {
    const anomalies: Array<string> = getAllTemplateCriteria()
      .filter((criteria: TemplateCriteria) => {
        return CriteriaFilterUtil.isAnomalyFilterType(
          criteria.filter.filterType,
        );
      })
      .map((criteria: TemplateCriteria) => {
        return criteria.templateId;
      });

    expect(anomalies).toEqual([]);
  });

  test("static: every criteria has a legendUnit, no thresholdUnit, or an identity conversion", () => {
    const all: Array<TemplateCriteria> = getAllTemplateCriteria();

    // Never vacuous: every platform ships templates with criteria.
    for (const platformCase of platformCases) {
      expect(platformCase.templates.length).toBeGreaterThan(0);
    }
    expect(all.length).toBeGreaterThan(100);

    const changes: Dictionary<string> = {};

    for (const criteria of all) {
      for (const declaredUnit of DECLARED_UNIT_GUESSES) {
        const reason: string | null = evaluationChangeReason({
          criteria,
          declaredUnit,
        });

        if (reason) {
          const key: string = `${criteria.templateId}|${criteria.filter.metricMonitorOptions?.metricAlias || ""}`;
          changes[key] = reason;
        }
      }
    }

    expect(Object.keys(changes).sort()).toEqual(
      Object.keys(INTENDED_EVALUATION_CHANGES).sort(),
    );
  });

  test("static: no shipped platform template sets a thresholdUnit at all", () => {
    /*
     * The reason (b) above holds everywhere today. If a template starts
     * setting one, the audit above decides whether it is safe; this test
     * just makes that moment visible.
     */
    const withThresholdUnit: Array<string> = getAllTemplateCriteria()
      .filter((criteria: TemplateCriteria) => {
        return Boolean(criteria.filter.metricMonitorOptions?.thresholdUnit);
      })
      .map((criteria: TemplateCriteria) => {
        return `${criteria.templateId}|${criteria.filter.metricMonitorOptions?.thresholdUnit}`;
      });

    expect(withThresholdUnit).toEqual([]);
  });
});

/*
 * End to end. A spread of values wide enough to straddle every template
 * threshold — negative dBm, fractions, percentages, counts, bytes — dealt
 * out so each series and each query sees a different one.
 */
const SAMPLE_VALUES: Array<number> = [
  -120, -95, -1, 0, 0.05, 0.5, 0.95, 1, 2, 5, 10, 20, 50, 75, 79.9, 80.1, 84.9,
  85.1, 90, 95.5, 99, 100, 101, 150, 300, 1000, 1e4, 1e6, 5e8, 1e9, 2.6e11,
];

const baseTime: number = Date.UTC(2026, 8, 25, 10, 0, 30);

function offsetFor(metricName: string): number {
  let sum: number = 0;
  for (let i: number = 0; i < metricName.length; i++) {
    sum += metricName.charCodeAt(i);
  }
  return sum % SAMPLE_VALUES.length;
}

function mockTelemetry(input: {
  step: MonitorStep;
  declaredUnit: string | undefined;
}): void {
  const viewConfig: MetricsViewConfig = getViewConfig(input.step);
  const groupByKeys: Array<string> = MonitorStep.getGroupByAttributeKeys(
    input.step,
  );

  const metricNames: Array<string> = viewConfig.queryConfigs.map(
    (q: MetricQueryConfigData) => {
      return (q.metricQueryData.filterData.metricName as string) || "";
    },
  );

  metricTypeFindBy.mockResolvedValue(
    input.declaredUnit
      ? metricNames.map((name: string) => {
          return { name: name, unit: input.declaredUnit };
        })
      : [],
  );

  // Grouped: one raw row per series, labelled with every group-by key.
  metricFindBy.mockImplementation(async (args: unknown) => {
    const name: string = (args as { query: { name: string } }).query.name;
    const offset: number = offsetFor(name);

    return SAMPLE_VALUES.map((_value: number, seriesIndex: number) => {
      const attributes: JSONObject = {};
      for (const key of groupByKeys) {
        attributes[key] = `series-${seriesIndex}`;
      }
      return {
        time: new Date(baseTime),
        value: SAMPLE_VALUES[(seriesIndex + offset) % SAMPLE_VALUES.length],
        attributes: attributes,
      };
    });
  });

  // Ungrouped: one whole-monitor series, one value per minute.
  metricAggregateBy.mockImplementation(async (args: unknown) => {
    const name: string = (args as { query: { name: string } }).query.name;
    const offset: number = offsetFor(name);

    return {
      data: SAMPLE_VALUES.map((_value: number, minute: number) => {
        return {
          timestamp: new Date(baseTime + minute * 60_000),
          value: SAMPLE_VALUES[(minute + offset) % SAMPLE_VALUES.length],
        };
      }),
    };
  });
}

interface SeriesVerdict {
  fingerprint: string | undefined;
  fired: boolean;
  sampleValueRange: { min: number; max: number } | undefined;
}

async function evaluate(input: {
  step: MonitorStep;
  filter: CriteriaFilter;
  response: MetricMonitorResponse;
}): Promise<{ verdicts: Array<SeriesVerdict>; units: Array<string | null> }> {
  const results: Array<MetricSeriesEvaluationResult> =
    await MetricMonitorCriteria.evaluateAllSeries({
      dataToProcess: input.response as DataToProcess,
      // The evaluator defaults a missing aggregation type in place.
      criteriaFilter: JSON.parse(
        JSON.stringify(input.filter),
      ) as CriteriaFilter,
      monitorStep: input.step,
    });

  return {
    verdicts: results.map((result: MetricSeriesEvaluationResult) => {
      return {
        fingerprint: result.fingerprint,
        fired: result.rootCause !== null,
        sampleValueRange: result.context.sampleValueRange,
      };
    }),
    units: results.map((result: MetricSeriesEvaluationResult) => {
      return result.context.unit ?? null;
    }),
  };
}

describe("shipped platform templates end to end: same verdicts with and without the unit map", () => {
  beforeEach(() => {
    metricAggregateBy.mockReset();
    metricFindBy.mockReset();
    metricTypeFindBy.mockReset();
    expectedHostIdentifiers.mockReset().mockResolvedValue([]);
    iotFleetFindOneBy.mockReset().mockResolvedValue(null);
  });

  for (const platformCase of platformCases) {
    test(`${platformCase.monitorType}: every template, every criteria, every declared-unit guess`, async () => {
      const evaluationChanges: Dictionary<string> = {};
      let comparedCriteria: number = 0;
      let firedAtLeastOnce: number = 0;
      let relabelled: number = 0;

      for (const template of platformCase.templates) {
        for (const declaredUnit of DECLARED_UNIT_GUESSES) {
          const step: MonitorStep = template.getMonitorStep(templateArgs);
          mockTelemetry({ step, declaredUnit });

          const withUnits: MetricMonitorResponse = await platformCase.monitor({
            monitorStep: step,
            monitorId: ObjectID.generate(),
            projectId: ObjectID.generate(),
          });

          expect(withUnits.nativeUnitsByMetricName).toBeDefined();

          // Exactly what the worker returned before this change.
          const withoutUnits: MetricMonitorResponse = {
            ...withUnits,
            nativeUnitsByMetricName: undefined,
          };

          const instances: Array<MonitorCriteriaInstance> =
            step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray ||
            [];

          for (const instance of instances) {
            for (const filter of instance.data?.filters || []) {
              const before: {
                verdicts: Array<SeriesVerdict>;
                units: Array<string | null>;
              } = await evaluate({ step, filter, response: withoutUnits });
              const after: {
                verdicts: Array<SeriesVerdict>;
                units: Array<string | null>;
              } = await evaluate({ step, filter, response: withUnits });

              comparedCriteria++;

              if (
                after.verdicts.some((verdict: SeriesVerdict) => {
                  return verdict.fired;
                })
              ) {
                firedAtLeastOnce++;
              }

              if (
                JSON.stringify(before.units) !== JSON.stringify(after.units)
              ) {
                relabelled++;
              }

              if (
                JSON.stringify(before.verdicts) !==
                JSON.stringify(after.verdicts)
              ) {
                const key: string = `${template.id}|${filter.metricMonitorOptions?.metricAlias || ""}`;
                evaluationChanges[key] =
                  `declared ${declaredUnit ?? "nothing"}: ${JSON.stringify(before.verdicts).slice(0, 200)} → ${JSON.stringify(after.verdicts).slice(0, 200)}`;
              }
            }
          }
        }
      }

      expect(comparedCriteria).toBeGreaterThan(0);
      // The data really exercises the thresholds, so "unchanged" means something.
      expect(firedAtLeastOnce).toBeGreaterThan(0);

      const intended: Array<string> = Object.keys(
        INTENDED_EVALUATION_CHANGES,
      ).filter((key: string) => {
        return platformCase.templates.some((template: ShippedTemplate) => {
          return key.startsWith(`${template.id}|`);
        });
      });

      expect(evaluationChanges).toEqual(
        Object.fromEntries(
          intended.map((key: string) => {
            return [key, expect.any(String)];
          }),
        ),
      );

      /*
       * Non-vacuity for the platforms whose templates leave legendUnit
       * unset: the map really reached the evaluator and relabelled them.
       * (IoT templates set a legendUnit on every query, so for IoT the
       * map changes nothing at all.)
       */
      if (platformCase.monitorType !== MonitorType.IoTDevice) {
        expect(relabelled).toBeGreaterThan(0);
      }
    });
  }
});
