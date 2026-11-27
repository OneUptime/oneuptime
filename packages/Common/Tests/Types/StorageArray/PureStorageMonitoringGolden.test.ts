import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import StorageSystemUtil from "../../../Types/StorageArray/StorageSystemUtil";
import StorageArrayResourceKind from "../../../Types/StorageArray/StorageArrayResourceKind";
import StorageArrayResourceKindUtil from "../../../Types/StorageArray/StorageArrayResourceKindUtil";
import {
  StorageArrayMetricCategory,
  StorageArrayMetricDefinition,
  getAllStorageArrayMetricCategories,
  getAllStorageArrayMetrics,
  getStorageArrayMetric,
  getStorageArrayMetricById,
  getStorageArrayMetricByMetricName,
  getStorageArrayMetricCategoryLabel,
  getStorageArrayMetricsByCategory,
  getStorageArrayMetricsForSystem,
  getStorageArrayObjectLabel,
} from "../../../Types/Monitor/StorageArrayMetricCatalog";
import {
  StorageArrayAlertTemplate,
  StorageArrayAlertTemplateArgs,
  StorageArrayAlertTemplateCategory,
  getAllStorageArrayAlertTemplates,
  getStorageArrayAlertTemplateById,
  getStorageArrayAlertTemplatesByCategory,
  getStorageArrayAlertTemplatesForSystem,
  getStorageArrayDefaultAlertTemplateId,
} from "../../../Types/Monitor/StorageArrayAlertTemplates";
import { StorageArrayResourceScope } from "../../../Types/Monitor/MonitorStepStorageArrayMonitor";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorCriteriaEvaluator from "../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import PlatformMetricUnitUtil from "../../../Utils/Monitor/PlatformMetricUnitUtil";
import { StorageArrayAffectedResource } from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  isLaterKind,
  isLaterMetricId,
  isLaterSystem,
  isLaterTemplateId,
} from "../../Helpers/StorageArray/PureSlice";
import { describe, expect, test } from "@jest/globals";
import StorageArrayPlatformRegistry from "../../../Types/StorageArray/StorageArrayPlatformRegistry";
import { StorageArrayPlatform } from "../../../Types/StorageArray/StorageArrayPlatform";
import fs from "fs";
import path from "path";

/*
 * HOW A PURE STORAGE ARRAY IS WATCHED, PINNED BEFORE STORAGE ARRAYS WAS
 * SPLIT INTO ONE CATALOG AND SET OF TEMPLATES PER PLATFORM (#11000).
 *
 * Everything a FlashArray's or a FlashBlade's monitors and pages read about
 * the platform, as the code answered it before the split:
 *
 *   - the platforms themselves: their names, aliases and metric prefixes;
 *   - the inventory kinds each reports, and their labels;
 *   - the metric catalog, whole, and every way it is looked up (by
 *     platform, category, id, name and filters), with the unit a monitor
 *     reads each metric in and the label that names each kind of object;
 *   - every alert template with the exact monitor step it builds, which
 *     templates each platform is offered and which one a new monitor opens
 *     on;
 *   - the Recommendations each platform is offered, with their steps;
 *   - what kind of object a metric's `name` label names in an incident's
 *     Affected Resources.
 *
 * PureStorageMonitoringGolden.golden.json was written by this test from the
 * code before #11000 (UPDATE_PURE_STORAGE_GOLDEN=1) and is only ever
 * compared with since. Ids a monitor step generates fresh each time are
 * written as <id:N>, by first appearance, so a step reads the same on
 * every run.
 *
 * Platforms registered since (Dell PowerStore, ...) are left out of each
 * answer that lists every platform's entries, and an input that names one
 * of them is left out of both sides (Helpers/StorageArray/PureSlice): this
 * pins Pure's slice, whole.
 */

const GOLDEN_PATH: string = path.join(
  __dirname,
  "PureStorageMonitoringGolden.golden.json",
);

const FA: string = StorageSystem.PureStorageFlashArray;
const FB: string = StorageSystem.PureStorageFlashBlade;

const SYSTEM_INPUTS: Array<string | null | undefined> = [
  FA,
  FB,
  "purefa",
  " FlashBlade ",
  "everpure.flasharray",
  "hitachi.vsp",
  "dell.powerstore",
  "constructor",
  "__proto__",
  "not a platform!",
  "",
  null,
  undefined,
];

const METRIC_NAMES_FOR_PLATFORM: Array<string> = [
  "purefa_info",
  "purefb_info",
  "purefa_volume_space_bytes",
  "purefb_buckets_object_count",
  "pure_something",
  "hitachi_volume_size",
  "",
];

const ARGS: StorageArrayAlertTemplateArgs = {
  arrayIdentifier: "fa-prod-01",
  onlineMonitorStatusId: new ObjectID("11a00000-0000-4000-8000-000000000001"),
  offlineMonitorStatusId: new ObjectID("11a00000-0000-4000-8000-000000000002"),
  defaultIncidentSeverityId: new ObjectID(
    "11a00000-0000-4000-8000-000000000003",
  ),
  defaultAlertSeverityId: new ObjectID("11a00000-0000-4000-8000-000000000004"),
  monitorName: "fa-prod-01 storage",
};

const RECOMMENDATION_ARGS: MonitorRecommendationArgs = {
  resourceIdentifier: ARGS.arrayIdentifier,
  onlineMonitorStatusId: ARGS.onlineMonitorStatusId,
  offlineMonitorStatusId: ARGS.offlineMonitorStatusId,
  defaultIncidentSeverityId: ARGS.defaultIncidentSeverityId,
  defaultAlertSeverityId: ARGS.defaultAlertSeverityId,
  monitorName: ARGS.monitorName,
};

const FIXED_IDS: Array<string> = [
  ARGS.onlineMonitorStatusId.toString(),
  ARGS.offlineMonitorStatusId.toString(),
  ARGS.defaultIncidentSeverityId.toString(),
  ARGS.defaultAlertSeverityId.toString(),
];

const UUID_PATTERN: RegExp =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

// A monitor step as JSON, its freshly generated ids numbered by appearance.
function stepJson(step: MonitorStep): JSONValue {
  const seen: Map<string, string> = new Map();
  const text: string = JSON.stringify(step.toJSON()).replace(
    UUID_PATTERN,
    (id: string): string => {
      if (FIXED_IDS.includes(id)) {
        return id;
      }
      if (!seen.has(id)) {
        seen.set(id, `<id:${seen.size + 1}>`);
      }
      return seen.get(id)!;
    },
  );
  return JSON.parse(text) as JSONValue;
}

function labelOf(value: string | null | undefined): string {
  return value === undefined ? "undefined" : JSON.stringify(value);
}

interface EvaluatorPrivate {
  getStorageArrayObjectKind: (metricName: string) => string | null;
  getStorageArrayAffectedResourceEntry: (input: {
    resource: Omit<
      StorageArrayAffectedResource,
      "metricValue" | "lowestMetricValue"
    >;
    arrayName: string;
    metricName: string;
    value: string;
  }) => { kind: string; name: unknown; details: unknown };
}

const Evaluator: EvaluatorPrivate =
  MonitorCriteriaEvaluator as unknown as EvaluatorPrivate;

function computeGolden(): JSONObject {
  const systems: JSONObject = {};
  for (const input of SYSTEM_INPUTS.filter(
    (candidate: string | null | undefined): boolean => {
      return !isLaterSystem(candidate);
    },
  )) {
    systems[labelOf(input)] = {
      normalize: StorageSystemUtil.normalize(input),
      isKnownSystem: StorageSystemUtil.isKnownSystem(input),
      displayName: StorageSystemUtil.getDisplayName(input),
      shortName: StorageSystemUtil.getShortName(input),
      vendorName: StorageSystemUtil.getVendorName(input),
      isFlashArray: StorageSystemUtil.isFlashArray(input),
      isFlashBlade: StorageSystemUtil.isFlashBlade(input),
      kinds: StorageArrayResourceKindUtil.getKindsForSystem(input).filter(
        (kind: string): boolean => {
          return !isLaterKind(kind);
        },
      ),
      metricCount: getStorageArrayMetricsForSystem(input).filter(
        (metric: StorageArrayMetricDefinition): boolean => {
          return !isLaterMetricId(metric.id);
        },
      ).length,
      metricIds: getStorageArrayMetricsForSystem(input)
        .filter((metric: StorageArrayMetricDefinition): boolean => {
          return !isLaterMetricId(metric.id);
        })
        .map((metric: StorageArrayMetricDefinition): string => {
          return metric.id;
        }),
      templates: getStorageArrayAlertTemplatesForSystem(input)
        .filter((template: StorageArrayAlertTemplate): boolean => {
          return !isLaterTemplateId(template.id);
        })
        .map((template: StorageArrayAlertTemplate): JSONObject => {
          return {
            id: template.id,
            name: template.name,
            storageSystems: template.storageSystems,
          };
        }),
      defaultTemplateId: getStorageArrayDefaultAlertTemplateId(input),
      recommendations: MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.StorageArray,
        { storageSystem: input },
      )
        .filter((recommendation: MonitorRecommendation): boolean => {
          return !isLaterTemplateId(recommendation.templateId);
        })
        .map((recommendation: MonitorRecommendation): JSONObject => {
          const template: StorageArrayAlertTemplate | undefined =
            getStorageArrayAlertTemplateById(recommendation.templateId);
          return {
            recommendationId: recommendation.recommendationId,
            templateId: recommendation.templateId,
            name: recommendation.name,
            summary: recommendation.summary || null,
            category: recommendation.category,
            severity: recommendation.severity,
            // The step itself is pinned once, on its template, below.
            buildsItsTemplatesStep: template
              ? JSON.stringify(
                  stepJson(recommendation.getMonitorStep(RECOMMENDATION_ARGS)),
                ) === JSON.stringify(stepJson(template.getMonitorStep(ARGS)))
              : false,
          };
        }),
      recommendationCategories: MonitorRecommendationCatalog.getCategories(
        MonitorRecommendationResourceType.StorageArray,
        { storageSystem: input },
      ),
    };
  }

  const pureSystems: Array<StorageSystem> =
    StorageSystemUtil.getAllSystems().filter(
      (system: StorageSystem): boolean => {
        return !isLaterSystem(system);
      },
    );
  const pureKinds: Array<StorageArrayResourceKind> =
    StorageArrayResourceKindUtil.getAllKinds().filter(
      (kind: StorageArrayResourceKind): boolean => {
        return !isLaterKind(kind);
      },
    );

  const prefixes: JSONObject = {};
  for (const system of pureSystems) {
    prefixes[system] = StorageSystemUtil.getMetricPrefix(system);
  }

  const platformOfMetric: JSONObject = {};
  for (const name of METRIC_NAMES_FOR_PLATFORM) {
    platformOfMetric[name] = StorageSystemUtil.fromMetricName(name);
  }

  const kindLabels: JSONObject = {};
  for (const kind of [...pureKinds, "Aggregate", "constructor"]) {
    kindLabels[kind] = {
      singular: StorageArrayResourceKindUtil.getSingularLabel(
        kind as StorageArrayResourceKind,
      ),
      plural: StorageArrayResourceKindUtil.getPluralLabel(
        kind as StorageArrayResourceKind,
      ),
    };
  }

  const metrics: Array<StorageArrayMetricDefinition> =
    getAllStorageArrayMetrics().filter(
      (metric: StorageArrayMetricDefinition): boolean => {
        return !isLaterMetricId(metric.id);
      },
    );

  const metricNames: Array<string> = Array.from(
    new Set(
      metrics.map((metric: StorageArrayMetricDefinition): string => {
        return metric.metricName;
      }),
    ),
  );

  const byMetricName: JSONObject = {};
  for (const name of metricNames) {
    byMetricName[name] = getStorageArrayMetricByMetricName(name)?.id || null;
  }

  // Every entry looked up by its own name and filters, then by its name alone.
  const byNameAndFilters: JSONObject = {};
  for (const metric of metrics) {
    byNameAndFilters[metric.id] = {
      withFilters:
        getStorageArrayMetric(metric.metricName, metric.attributes)?.id || null,
      withoutFilters: getStorageArrayMetric(metric.metricName)?.id || null,
      byId: getStorageArrayMetricById(metric.id)?.id || null,
      unit:
        PlatformMetricUnitUtil.getMetricUnit({
          platform: "storageArray",
          metricName: metric.metricName,
          attributes: metric.attributes,
        }) || null,
    };
  }

  const categories: JSONObject = {};
  for (const category of getAllStorageArrayMetricCategories()) {
    const metricIds: Array<string> = getStorageArrayMetricsByCategory(category)
      .filter((metric: StorageArrayMetricDefinition): boolean => {
        return !isLaterMetricId(metric.id);
      })
      .map((metric: StorageArrayMetricDefinition): string => {
        return metric.id;
      });
    // A category only later platforms' metrics are in.
    if (metricIds.length === 0) {
      continue;
    }
    categories[category] = {
      label: getStorageArrayMetricCategoryLabel(
        category as StorageArrayMetricCategory,
      ),
      metricIds,
    };
  }

  const objectLabels: JSONObject = {};
  for (const scope of Object.values(StorageArrayResourceScope)) {
    for (const system of [FA, FB, "hitachi.vsp", null]) {
      for (const metricName of [undefined, ...metricNames]) {
        const label: string | null = getStorageArrayObjectLabel(
          scope,
          system,
          metricName,
        );
        objectLabels[`${scope}|${labelOf(system)}|${metricName ?? "-"}`] =
          label;
      }
    }
  }

  const templates: Array<JSONObject> = getAllStorageArrayAlertTemplates()
    .filter((template: StorageArrayAlertTemplate): boolean => {
      return !isLaterTemplateId(template.id);
    })
    .map((template: StorageArrayAlertTemplate): JSONObject => {
      return {
        id: template.id,
        name: template.name,
        summary: template.summary,
        description: template.description,
        category: template.category,
        severity: template.severity,
        storageSystems: template.storageSystems,
        byId: getStorageArrayAlertTemplateById(template.id)?.id || null,
        monitorStep: stepJson(template.getMonitorStep(ARGS)),
      };
    });

  const templateCategories: JSONObject = {};
  for (const category of [
    "Availability",
    "Array Health",
    "Capacity",
    "Performance",
    "Hardware",
    "Hosts",
    "Replication",
    "File Systems",
  ] as Array<StorageArrayAlertTemplateCategory>) {
    templateCategories[category] = getStorageArrayAlertTemplatesByCategory(
      category,
    )
      .filter((template: StorageArrayAlertTemplate): boolean => {
        return !isLaterTemplateId(template.id);
      })
      .map((template: StorageArrayAlertTemplate): string => {
        return template.id;
      });
  }

  const allRecommendations: Array<string> =
    MonitorRecommendationCatalog.getAllPossibleRecommendations(
      MonitorRecommendationResourceType.StorageArray,
    )
      .filter((recommendation: MonitorRecommendation): boolean => {
        return !isLaterTemplateId(recommendation.templateId);
      })
      .map((recommendation: MonitorRecommendation): string => {
        return recommendation.recommendationId;
      });

  const objectKinds: JSONObject = {};
  for (const name of [
    ...metricNames,
    "purefa_volume_group_performance_latency_usec",
    "purefa_hw_controller_info",
    "purefa_hw_component_status",
    "purefa_drive_capacity_bytes",
    "purefa_network_interface_performance_errors",
    "purefa_directory_space_bytes",
    "purefa_host_connections_info",
    "purefb_file_systems_space_bytes",
    "purefb_hardware_health",
    "purefb_buckets_space_bytes",
    "purefa_array_space_bytes",
    "hitachi_volume_size",
    "",
  ]) {
    objectKinds[name] = Evaluator.getStorageArrayObjectKind(name);
  }

  const affectedEntries: JSONObject = {};
  const identities: Array<[string, Partial<StorageArrayAffectedResource>]> = [
    ["an open alert", { alertSummary: "Drive failed", componentName: "CH0" }],
    ["a component", { componentName: "CH0.BAY3", componentType: "drive_bay" }],
    ["a pod", { podName: "pod-prod" }],
    ["a host", { hostName: "esx-02" }],
    ["a named object", { objectName: "vol-db-01" }],
    ["nothing named", {}],
  ];
  for (const [identityName, identity] of identities) {
    for (const metricName of [
      "purefa_volume_performance_latency_usec",
      "purefa_drive_capacity_bytes",
      "purefa_hw_component_status",
      "purefb_file_systems_space_bytes",
      "purefb_buckets_object_count",
      "purefb_hardware_health",
      "purefa_volume_group_performance_latency_usec",
      "hitachi_volume_size",
    ]) {
      const entry: { kind: string; name: unknown; details: unknown } =
        Evaluator.getStorageArrayAffectedResourceEntry({
          resource: {
            objectName: undefined,
            hostName: undefined,
            componentName: undefined,
            componentType: undefined,
            podName: undefined,
            alertSummary: undefined,
            ...identity,
          },
          arrayName: "fa-prod-01",
          metricName,
          value: "1",
        });
      affectedEntries[`${identityName}|${metricName}`] = JSON.parse(
        JSON.stringify(entry),
      ) as JSONValue;
    }
  }

  return {
    allSystems: pureSystems,
    systems,
    prefixes,
    platformOfMetric,
    allKinds: pureKinds,
    kindLabels,
    metrics: JSON.parse(JSON.stringify(metrics)) as JSONValue,
    categories,
    byMetricName,
    byNameAndFilters,
    objectLabels,
    templates,
    templateCategories,
    allRecommendations,
    objectKinds,
    affectedEntries,
  };
}

/*
 * The golden is what the code answered when Pure's were the only
 * platforms, and whole-catalog answers (an array of no known platform is
 * offered every template) grow with each platform added since (NetApp
 * ONTAP, #11001). So it is computed with Pure's platforms alone; what Pure
 * answers beside the others is held to it below.
 */
function withPurePlatformsAlone<T>(compute: () => T): T {
  const others: Array<StorageArrayPlatform> =
    StorageArrayPlatformRegistry.getPlatforms().filter(
      (platform: StorageArrayPlatform): boolean => {
        return platform.vendorName !== "Pure Storage";
      },
    );
  for (const platform of others) {
    StorageArrayPlatformRegistry.unregister(platform.storageSystem);
  }
  try {
    return compute();
  } finally {
    for (const platform of others) {
      StorageArrayPlatformRegistry.register(platform);
    }
  }
}

const computed: JSONObject = withPurePlatformsAlone(computeGolden);
const besideTheOthers: JSONObject = computeGolden();

// A canonical Pure value, a Pure catalog id or a Pure series' name.
const ABOUT_PURE: RegExp =
  /purestorage\.(flasharray|flashblade)"|purefa[-_]|purefb[-_]/;

// A golden entry about a Pure platform or a Pure catalog id.
function isAboutPure(key: string): boolean {
  return ABOUT_PURE.test(key);
}

if (process.env["UPDATE_PURE_STORAGE_GOLDEN"] === "1") {
  fs.writeFileSync(
    GOLDEN_PATH,
    `${JSON.stringify(
      {
        note: "Written by PureStorageMonitoringGolden.test.ts from the code before #11000. Compared with, never rewritten, unless a Pure array is meant to be watched differently.",
        ...computed,
      },
      null,
      2,
    )}\n`,
  );
}

/*
 * The golden, less the inputs that name a platform registered since: on
 * #11000's day they named no platform, and today they name that one.
 */
function readGolden(): JSONObject {
  const golden: JSONObject = JSON.parse(
    fs.readFileSync(GOLDEN_PATH, "utf8"),
  ) as JSONObject;
  const systems: JSONObject = golden["systems"] as JSONObject;
  for (const input of SYSTEM_INPUTS) {
    if (isLaterSystem(input)) {
      delete systems[labelOf(input)];
    }
  }
  return golden;
}

describe("a Pure Storage array is watched as it was before #11000", () => {
  test.each(
    Object.keys(computed).map((key: string): [string] => {
      return [key];
    }),
  )("%s", (key: string) => {
    expect(computed[key]).toEqual(readGolden()[key]);
  });

  test("with every shipped platform registered, Pure's own answers are the same", () => {
    const golden: JSONObject = readGolden();
    let compared: number = 0;
    for (const [key, part] of Object.entries(besideTheOthers)) {
      const expected: JSONValue | undefined = golden[key];
      if (
        !part ||
        typeof part !== "object" ||
        Array.isArray(part) ||
        !expected ||
        typeof expected !== "object" ||
        Array.isArray(expected)
      ) {
        continue;
      }
      for (const [entry, value] of Object.entries(part as JSONObject)) {
        if (!isAboutPure(entry) || !(entry in (expected as JSONObject))) {
          continue;
        }
        expect({ key, entry, value }).toEqual({
          key,
          entry,
          value: (expected as JSONObject)[entry],
        });
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(100);
    // And they were computed with ONTAP registered.
    expect(
      StorageArrayPlatformRegistry.getPlatform("netapp.ontap"),
    ).not.toBeNull();
  });

  test("the golden holds every part this test computes, and no other", () => {
    const golden: JSONObject = readGolden();
    delete golden["note"];
    expect(Object.keys(golden).sort()).toEqual(Object.keys(computed).sort());
  });
});
