import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import {
  StorageArrayResourceFilters,
  StorageArrayResourceScope,
} from "Common/Types/Monitor/MonitorStepStorageArrayMonitor";
import {
  StorageArrayAlertTemplate,
  StorageArrayAlertTemplateCategory,
  getAllStorageArrayAlertTemplates,
  getStorageArrayAlertTemplatesForSystem,
} from "Common/Types/Monitor/StorageArrayAlertTemplates";
import {
  StorageArrayMetricCategory,
  StorageArrayMetricDefinition,
  getAllStorageArrayMetricCategories,
  getAllStorageArrayMetrics,
  getStorageArrayMetricsForSystem,
  getStorageArrayObjectLabel,
} from "Common/Types/Monitor/StorageArrayMetricCatalog";
import StorageSystem from "Common/Types/StorageArray/StorageSystem";
import StorageArrayPlatformRegistry from "Common/Types/StorageArray/StorageArrayPlatformRegistry";
import {
  StorageArrayPlatform,
  StorageArrayResourceFilter,
} from "Common/Types/StorageArray/StorageArrayPlatform";
import { STORAGE_ARRAY_TEMPLATE_CATEGORIES } from "../../FeatureSet/Dashboard/src/Components/Form/Monitor/AlertTemplatePicker/AlertTemplateCategories";
import {
  AlertTemplateCategory,
  AlertTemplateGroup,
  getAlertTemplatesInDrawnOrder,
  groupAlertTemplates,
} from "../../FeatureSet/Dashboard/src/Components/Form/Monitor/AlertTemplatePicker/AlertTemplateGroups";

/*
 * The Storage Array monitor form is three React components plus one branch
 * in MonitorStep.tsx, none of which a unit test can render: the App suite
 * runs in a plain Node environment with no renderer. Every failure mode of
 * that wiring is silent — a resource filter written to the wrong key
 * compiles fine and is simply ignored by the worker, a template category
 * missing from the picker's list means those templates are never offered,
 * a custom metric that drops its catalog `dimension` filter averages a
 * 200 µs read latency with a 4 ms queue figure, and a monitor type with no
 * branch in MonitorStep.tsx renders an empty step.
 *
 * So, like VMwareMonitorForm.test.ts, these read the sources and pin the
 * exact expressions, and cross-check the hard-coded lists against the
 * Common catalog / template modules they must stay in step with. Sources
 * are whitespace-squashed first so prettier re-wrapping cannot turn a real
 * regression into a red herring.
 */

const FORM_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Form",
  "Monitor",
);

const DASHBOARD_SRC: string = path.join(FORM_DIR, "..", "..", "..");

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function dense(text: string): string {
  return text.replace(/\s+/g, "");
}

function readSource(...relativeParts: Array<string>): string {
  return squash(fs.readFileSync(path.join(FORM_DIR, ...relativeParts), "utf8"));
}

/*
 * The same with its comments removed, for pinning an object whose fields a
 * comment sits between. The checks that a word is absent read the source
 * with its comments, so a comment cannot bring one back unnoticed.
 */
function readCode(...relativeParts: Array<string>): string {
  return squash(
    fs
      .readFileSync(path.join(FORM_DIR, ...relativeParts), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|\s)\/\/.*$/gm, " "),
  );
}

const stepFormSource: string = readSource(
  "StorageArrayMonitor",
  "StorageArrayMonitorStepForm.tsx",
);
const stepFormCode: string = readCode(
  "StorageArrayMonitor",
  "StorageArrayMonitorStepForm.tsx",
);
const templatePickerSource: string = readSource(
  "StorageArrayMonitor",
  "StorageArrayTemplatePicker.tsx",
);
const metricPickerSource: string = readSource(
  "StorageArrayMonitor",
  "StorageArrayMetricPicker.tsx",
);
const categoryLabels: string = STORAGE_ARRAY_TEMPLATE_CATEGORIES.map(
  (category: AlertTemplateCategory): string => {
    return category.label;
  },
).join(" | ");
const monitorStepSource: string = readSource("MonitorStep.tsx");

/*
 * Every key of StorageArrayResourceFilters, restated as a total Record so
 * adding a filter to the Common interface fails to compile here until the
 * form is taught about it. The value is, per platform that offers the
 * filter, the datapoint label it equality-filters on as its description
 * names it, so the user can see exactly what they are filtering on. ONTAP
 * names a volume by `volume`, and a hardware part by the label its series
 * names it by (#11001).
 */
const RESOURCE_FILTER_LABELS: Record<
  keyof Required<StorageArrayResourceFilters>,
  Partial<Record<StorageSystem, string>>
> = {
  volumeName: {
    [StorageSystem.PureStorageFlashArray]: "`name`",
    [StorageSystem.DellPowerStore]: "`name`",
    [StorageSystem.NetAppOntap]: "`volume`",
    // A PowerMax volume by its device ID (#11004).
    [StorageSystem.DellPowerMax]: "`volume`",
  },
  hostName: {
    [StorageSystem.PureStorageFlashArray]: "`host`",
  },
  podName: {
    [StorageSystem.PureStorageFlashArray]: "`local_pod`",
  },
  componentName: {
    [StorageSystem.PureStorageFlashArray]: "`component_name`",
    [StorageSystem.PureStorageFlashBlade]: "`component_name`",
    [StorageSystem.DellPowerStore]: "`name`",
    [StorageSystem.NetAppOntap]: "the node, disk, shelf or port label",
    // A PowerMax director or port (#11004).
    [StorageSystem.DellPowerMax]: "`component`",
  },
  fileSystemName: {
    [StorageSystem.PureStorageFlashBlade]: "`name`",
    [StorageSystem.DellPowerStore]: "`name`",
  },
  bucketName: {
    [StorageSystem.PureStorageFlashBlade]: "`name`",
  },
};

const ALL_FILTER_KEYS: Array<keyof StorageArrayResourceFilters> = Object.keys(
  RESOURCE_FILTER_LABELS,
) as Array<keyof StorageArrayResourceFilters>;

// The `{ key: ... }` table entry of one filter, as one squashed string.
/*
 * The platforms that offer a filter, each with what it says the filter
 * filters on. Each platform declares its own filters
 * (StorageArrayPlatform.resourceFilters, #11000); the form draws them under
 * its own title and placeholder for the filter's key.
 */
interface FilterOffering {
  storageSystem: string;
  description: string;
}

function filterOfferings(key: string): Array<FilterOffering> {
  return StorageArrayPlatformRegistry.getPlatforms().flatMap(
    (platform: StorageArrayPlatform): Array<FilterOffering> => {
      return platform.resourceFilters
        .filter((filter: StorageArrayResourceFilter): boolean => {
          return filter.key === key;
        })
        .map((filter: StorageArrayResourceFilter): FilterOffering => {
          return {
            storageSystem: platform.storageSystem,
            description: filter.description,
          };
        });
    },
  );
}

describe("StorageArrayMonitorStepForm resource filters", () => {
  test.each(ALL_FILTER_KEYS)(
    "offers a field for the %s filter and names its label",
    (key: keyof StorageArrayResourceFilters) => {
      // The form has a title for the field by its key...
      expect(dense(stepFormSource)).toContain(`${key}:{title:`);
      // ...and each platform that offers it says which label it maps to.
      expect(filterOfferings(key).length).toBeGreaterThan(0);
      for (const offering of filterOfferings(key)) {
        const label: string | undefined =
          RESOURCE_FILTER_LABELS[key][offering.storageSystem as StorageSystem];
        expect({
          key,
          system: offering.storageSystem,
          known: Boolean(label),
        }).toEqual({ key, system: offering.storageSystem, known: true });
        expect(offering.description).toContain(label!);
      }
    },
  );

  test.each(ALL_FILTER_KEYS)(
    "offers the %s filter only on the platforms whose series carry it",
    (key: keyof StorageArrayResourceFilters) => {
      const offeredOn: Array<string> = filterOfferings(key).map(
        (offering: FilterOffering): string => {
          return offering.storageSystem;
        },
      );
      for (const system of [
        StorageSystem.PureStorageFlashArray,
        StorageSystem.PureStorageFlashBlade,
        StorageSystem.DellPowerStore,
        StorageSystem.NetAppOntap,
        StorageSystem.DellPowerMax,
      ]) {
        expect({ key, system, offered: offeredOn.includes(system) }).toEqual({
          key,
          system,
          offered: Boolean(RESOURCE_FILTER_LABELS[key][system]),
        });
      }
    },
  );

  test("the platform's fields are picked from the array's storage system, all of them while it is unknown", () => {
    // The array's platform, from the registry; every field while it has none.
    expect(dense(stepFormSource)).toContain(
      "StorageArrayPlatformRegistry.getPlatform(storageSystem);",
    );
    expect(dense(stepFormSource)).toContain("if(!platform){returnfields;}");
    expect(dense(stepFormSource)).toContain(
      ".includes(platform.storageSystem,);",
    );
    expect(dense(stepFormSource)).toContain(
      "{getResourceFilterFields(storageSystem).map(",
    );
  });

  test("the labels the descriptions name are the ones the catalog filters objects on", () => {
    // FlashArray: volumes and pods by `name`, hosts by `host`, hardware by `component_name`.
    expect(
      getStorageArrayObjectLabel(
        StorageArrayResourceScope.Volume,
        StorageSystem.PureStorageFlashArray,
      ),
    ).toBe("name");
    expect(
      getStorageArrayObjectLabel(
        StorageArrayResourceScope.Host,
        StorageSystem.PureStorageFlashArray,
      ),
    ).toBe("host");
    expect(
      getStorageArrayObjectLabel(
        StorageArrayResourceScope.Hardware,
        StorageSystem.PureStorageFlashArray,
      ),
    ).toBe("component_name");
    expect(
      getStorageArrayObjectLabel(
        StorageArrayResourceScope.Pod,
        StorageSystem.PureStorageFlashArray,
        "purefa_pod_replica_links_lag_max_msec",
      ),
    ).toBe("local_pod");
    // FlashBlade: file systems, buckets and hardware by `name`.
    for (const scope of [
      StorageArrayResourceScope.FileSystem,
      StorageArrayResourceScope.Bucket,
      StorageArrayResourceScope.Hardware,
    ]) {
      expect(
        getStorageArrayObjectLabel(scope, StorageSystem.PureStorageFlashBlade),
      ).toBe("name");
    }
    // Pure's hardware field names both Pure platforms' labels.
    for (const offering of filterOfferings("componentName").filter(
      (candidate: FilterOffering): boolean => {
        return candidate.storageSystem.startsWith("purestorage.");
      },
    )) {
      expect(offering.description).toContain("`name` on a FlashBlade");
    }
    // ONTAP: a volume by `volume`, a hardware part by its node (#11001).
    expect(
      getStorageArrayObjectLabel(
        StorageArrayResourceScope.Volume,
        StorageSystem.NetAppOntap,
      ),
    ).toBe("volume");
    expect(
      getStorageArrayObjectLabel(
        StorageArrayResourceScope.Hardware,
        StorageSystem.NetAppOntap,
      ),
    ).toBe("node");
    // PowerMax: a volume by `volume`, a director or a port by `component` (#11004).
    expect(
      getStorageArrayObjectLabel(
        StorageArrayResourceScope.Volume,
        StorageSystem.DellPowerMax,
      ),
    ).toBe("volume");
    expect(
      getStorageArrayObjectLabel(
        StorageArrayResourceScope.Hardware,
        StorageSystem.DellPowerMax,
      ),
    ).toBe("component");
  });

  test("writes each field back under its own key, spreading the rest", () => {
    /*
     * One generic onChange writes `[field.key]: value || undefined` on top
     * of the existing filters. Pin both halves: the spread (so typing a
     * host name does not wipe a volume name typed earlier) and the
     * computed key (so the value lands where the worker reads it).
     */
    expect(stepFormSource).toContain(
      "resourceFilters: { ...monitorStepStorageArrayMonitor.resourceFilters, [field.key]: value || undefined, }",
    );
    expect(dense(stepFormSource)).toContain(
      'value={monitorStepStorageArrayMonitor.resourceFilters[field.key]||""}',
    );
  });

  test("offers exactly the filters StorageArrayResourceFilters declares — no scope dropdown", () => {
    /*
     * Pure's series name their object in a datapoint label; there is no
     * scope attribute to filter on, so a scope dropdown here would be sent
     * to the worker as a filter it cannot map.
     */
    const declaredKeys: Array<string> =
      StorageArrayPlatformRegistry.getPlatforms().flatMap(
        (platform: StorageArrayPlatform): Array<string> => {
          return platform.resourceFilters.map(
            (filter: StorageArrayResourceFilter): string => {
              return filter.key;
            },
          );
        },
      );

    expect(new Set(declaredKeys)).toEqual(new Set<string>(ALL_FILTER_KEYS));
    expect(stepFormSource).not.toContain("scope:");
  });

  test("keeps already-typed filters when a custom metric is picked", () => {
    expect(stepFormSource).toContain(
      "config.resourceFilters = { ...monitorStepStorageArrayMonitor.resourceFilters, }",
    );
  });
});

describe("StorageArrayMonitorStepForm rolling windows", () => {
  test("the form reads its fallback from the Common default", () => {
    expect(stepFormSource).toContain(
      "const DEFAULT_ROLLING_TIME: RollingTime = MonitorStepStorageArrayMonitorUtil.getDefault().rollingTime;",
    );
  });

  test("every rollingTime fallback uses that default — never a literal", () => {
    const fallbacks: Array<string> = [
      ...stepFormSource.matchAll(
        /monitorStepStorageArrayMonitor\.rollingTime \|\| ([A-Za-z_.]+)/g,
      ),
    ].map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    // The two start/end-time effects.
    expect(fallbacks).toHaveLength(2);
    for (const fallback of fallbacks) {
      expect(fallback).toBe("DEFAULT_ROLLING_TIME");
    }
  });

  test("a custom metric starts on a window its scrape interval always fills", () => {
    /*
     * The agent reads the array endpoint every 60 s and volumes, hosts
     * and pods every 2 min (a FlashBlade's file systems and buckets every
     * 5 min): a 1-minute window would be empty on some evaluations of a
     * volume metric and the monitor would flap.
     */
    expect(stepFormSource).toContain(
      "rollingTime: getRecommendedRollingTime(metric),",
    );
    expect(dense(stepFormSource)).toContain(
      "if(metric.defaultResourceScope===StorageArrayResourceScope.FileSystem||metric.defaultResourceScope===StorageArrayResourceScope.Bucket){returnRollingTime.Past15Minutes;}returnRollingTime.Past5Minutes;",
    );
  });

  test("no storage array form component hard-codes a 1-minute window", () => {
    for (const source of [
      stepFormSource,
      templatePickerSource,
      metricPickerSource,
    ]) {
      expect(source).not.toContain("Past1Minute");
    }
  });
});

describe("StorageArrayMonitorStepForm array selection", () => {
  test("lists arrays from the StorageArray model and uses the name as the identifier", () => {
    /*
     * `name` is the `storage.array.name` attribute the agent stamps on
     * every metric; the worker scopes on it. Using the row id here would
     * match nothing. The picker searches arrays by it past its first page,
     * and reads the step's own array by it (#10646).
     */
    expect(stepFormSource).toContain(
      'useInfrastructureResources<StorageArray>({ valueField: "name", searchFields: ["name"], heldValue: monitorStepStorageArrayMonitor.arrayIdentifier, modelType: StorageArray,',
    );
    /*
     * The option draws an array's own name as written (isUserContent), never
     * looked up in the reader's language, where an array named like one of
     * the product's words would read as its translation; "Unknown", for an
     * array with no name, is the product's word and is looked up (#8065).
     */
    expect(stepFormCode).toContain(
      'return { label: storageArray.name || "Unknown", isUserContent: Boolean(storageArray.name), value: storageArray.name || "", };',
    );
    expect(dense(stepFormSource)).toContain("onChange={changeResource}");
    expect(dense(stepFormSource)).toContain(
      "constchangeResource:(arrayIdentifier:string,",
    );
  });

  test("picking an array records its platform with the step", () => {
    expect(dense(stepFormSource)).toContain(
      "select:{_id:true,lastSeenAt:true,name:true,storageSystem:true,}",
    );
    expect(dense(stepFormSource)).toContain(
      "constarrayStorageSystem:string|undefined=addedArrayStorageSystem||storageSystemByArray[arrayIdentifier]||undefined;",
    );
    expect(dense(stepFormSource)).toContain(
      "arrayIdentifier:arrayIdentifier,storageSystem:arrayStorageSystem,",
    );
  });

  test("the catalog and templates follow the step's platform, else the picked array's", () => {
    expect(dense(stepFormSource)).toContain(
      "conststorageSystem:string|undefined=monitorStepStorageArrayMonitor.storageSystem||storageSystemByArray[monitorStepStorageArrayMonitor.arrayIdentifier]||undefined;",
    );
    expect(dense(stepFormSource)).toContain(
      "<StorageArrayTemplatePickerstorageSystem={storageSystem}",
    );
    expect(dense(stepFormSource)).toContain(
      "<StorageArrayMetricPickerstorageSystem={storageSystem}",
    );
  });

  test("hands the selected array to templates and custom metrics", () => {
    expect(stepFormSource).toContain(
      'template.getMonitorStep({ arrayIdentifier: arrayIdentifier || "",',
    );
    expect(stepFormSource).toContain(
      'buildStorageArrayMonitorConfig({ arrayIdentifier: arrayIdentifier || "",',
    );
    // The template's step is applied through the storageArrayMonitor sub-config.
    expect(stepFormSource).toContain("templateStep.data?.storageArrayMonitor");
    expect(stepFormSource).not.toContain("cephMonitor");
    expect(stepFormSource).not.toContain("clusterIdentifier");
  });
});

describe("StorageArrayMonitorStepForm custom metrics", () => {
  test("keeps the catalog entry's label filters, which tell read from write", () => {
    expect(stepFormSource).toContain(
      "attributes: { ...(metric.attributes || {}) },",
    );
    expect(stepFormSource).toContain("metricName: metric.metricName,");
    expect(stepFormSource).toContain(
      "aggregationType: metric.defaultAggregation,",
    );
  });

  test("groups per object by the label that names it on the platform", () => {
    /*
     * "Volume write latency > 5 ms" fires for the one slow volume instead
     * of the average of every volume on the array.
     */
    expect(dense(stepFormSource)).toContain(
      "constgroupByAttributeKey:string|null=getStorageArrayObjectLabel(metric.defaultResourceScope,storageSystem||metric.storageSystems[0],metric.metricName,);",
    );
    expect(stepFormSource).toContain(
      "groupByAttributeKey: groupByAttributeKey || undefined,",
    );
  });

  test("every catalog metric that names an object is grouped by a label its series carry", () => {
    for (const metric of getAllStorageArrayMetrics()) {
      const label: string | null = getStorageArrayObjectLabel(
        metric.defaultResourceScope,
        metric.storageSystems[0],
        metric.metricName,
      );
      if (metric.defaultResourceScope === StorageArrayResourceScope.Array) {
        /*
         * An array-wide series is grouped by nothing, unless its entry
         * names the object it describes: ONTAP's aggregates, SVMs, LUNs,
         * SnapMirror relationships, health subsystems and EMS messages, and a
         * PowerMax's storage groups, pools and SRDF groups (#11004) - kinds
         * with no scope of their own (#11001).
         */
        expect({ id: metric.id, label }).toEqual({
          id: metric.id,
          label: metric.objectLabel || null,
        });
      } else {
        expect({ id: metric.id, hasLabel: Boolean(label) }).toEqual({
          id: metric.id,
          hasLabel: true,
        });
      }
    }
  });

  test("the metric alias is the catalog id, safe as a variable name", () => {
    expect(stepFormSource).toContain(
      'metricAlias: metric.id.replace(/-/g, "_"),',
    );
    for (const metric of getAllStorageArrayMetrics()) {
      expect(metric.id.replace(/-/g, "_")).toMatch(/^[a-z0-9_]+$/);
    }
  });
});

describe("StorageArrayTemplatePicker", () => {
  const allTemplates: Array<StorageArrayAlertTemplate> =
    getAllStorageArrayAlertTemplates();

  test("there are templates to offer", () => {
    expect(allTemplates.length).toBeGreaterThan(0);
  });

  test("offers only the templates of the selected array's platform", () => {
    expect(templatePickerSource).toContain(
      "getStorageArrayAlertTemplatesForSystem(props.storageSystem)",
    );
    expect(templatePickerSource).not.toContain(
      "getAllStorageArrayAlertTemplates()",
    );
    for (const template of getStorageArrayAlertTemplatesForSystem(
      StorageSystem.PureStorageFlashBlade,
    )) {
      expect(template.storageSystems).toContain(
        StorageSystem.PureStorageFlashBlade,
      );
    }
    for (const template of getStorageArrayAlertTemplatesForSystem(
      StorageSystem.PureStorageFlashArray,
    )) {
      expect(template.storageSystems).toContain(
        StorageSystem.PureStorageFlashArray,
      );
    }
  });

  /*
   * The shared AlertTemplatePicker lists the templates under the type's
   * headings (STORAGE_ARRAY_TEMPLATE_CATEGORIES). A template whose category
   * has no heading is still offered, after the named ones - but under its
   * raw category value, so every category in use must have a heading.
   */
  test("every template is listed under a heading of its own category", () => {
    expect(templatePickerSource).toContain(
      "categories={STORAGE_ARRAY_TEMPLATE_CATEGORIES}",
    );

    for (const system of [
      StorageSystem.PureStorageFlashArray,
      StorageSystem.PureStorageFlashBlade,
      undefined,
    ]) {
      const offered: Array<StorageArrayAlertTemplate> =
        getStorageArrayAlertTemplatesForSystem(system);
      const groups: Array<AlertTemplateGroup<StorageArrayAlertTemplate>> =
        groupAlertTemplates(offered, STORAGE_ARRAY_TEMPLATE_CATEGORIES);

      expect(getAlertTemplatesInDrawnOrder(groups)).toHaveLength(
        offered.length,
      );

      for (const group of groups) {
        // A named heading, never the fallback for an unknown category.
        expect(group.icon).toBeDefined();

        for (const template of group.templates) {
          expect(template.category).toBe(group.category);
        }
      }
    }
  });

  test("the picker lists no category that has no templates", () => {
    const listed: Array<string> = STORAGE_ARRAY_TEMPLATE_CATEGORIES.map(
      (category: AlertTemplateCategory): string => {
        return category.category;
      },
    );
    const categoriesInUse: Set<StorageArrayAlertTemplateCategory> = new Set(
      allTemplates.map(
        (
          template: StorageArrayAlertTemplate,
        ): StorageArrayAlertTemplateCategory => {
          return template.category;
        },
      ),
    );

    expect(new Set(listed)).toEqual(categoriesInUse);
    expect(new Set(listed).size).toBe(listed.length);
  });

  test("uses storage vocabulary, not Ceph's", () => {
    for (const word of ["Ceph", "OSD", "Placement Group", "cluster"]) {
      expect(categoryLabels).not.toContain(word);
      expect(templatePickerSource).not.toContain(word);
    }
    expect(categoryLabels).toContain("Array Health");
    expect(categoryLabels).toContain("Replication");
  });
});

describe("StorageArrayMetricPicker", () => {
  test("there are metrics and categories to offer", () => {
    expect(getAllStorageArrayMetrics().length).toBeGreaterThan(0);
    expect(getAllStorageArrayMetricCategories().length).toBeGreaterThan(0);
  });

  test("offers only the metrics of the selected array's platform, grouped by catalog category", () => {
    expect(metricPickerSource).toContain(
      "getStorageArrayMetricsForSystem(props.storageSystem)",
    );
    expect(metricPickerSource).toContain(
      "getAllStorageArrayMetricCategories()",
    );
    expect(metricPickerSource).toContain("return m.category === category;");
    // A platform without a category (a FlashBlade has no volumes) skips it.
    expect(metricPickerSource).toContain("return group.options.length > 0;");
  });

  test("a FlashBlade is offered no FlashArray metric, and the other way round", () => {
    for (const metric of getStorageArrayMetricsForSystem(
      StorageSystem.PureStorageFlashBlade,
    )) {
      expect(metric.metricName.startsWith("purefb_")).toBe(true);
    }
    for (const metric of getStorageArrayMetricsForSystem(
      StorageSystem.PureStorageFlashArray,
    )) {
      expect(metric.metricName.startsWith("purefa_")).toBe(true);
    }
  });

  test("every metric belongs to a listed category", () => {
    const categories: Array<StorageArrayMetricCategory> =
      getAllStorageArrayMetricCategories();
    for (const metric of getAllStorageArrayMetrics()) {
      expect(categories).toContain(metric.category);
    }
  });

  test("shows the unit next to the metric name and the label filters it pins", () => {
    expect(metricPickerSource).toContain(
      'label: `${translator.translateText(m.friendlyName)}${m.unit ? ` (${m.unit})` : ""}`,',
    );
    expect(metricPickerSource).toContain("selectedMetric.metricName");
    expect(metricPickerSource).toContain(
      "formatPinnedAttributes(selectedMetric)",
    );
    const pinned: Array<StorageArrayMetricDefinition> =
      getAllStorageArrayMetrics().filter(
        (metric: StorageArrayMetricDefinition): boolean => {
          return Object.keys(metric.attributes || {}).length > 0;
        },
      );
    expect(pinned.length).toBeGreaterThan(0);
  });
});

describe("MonitorStep.tsx switches on MonitorType.StorageArray", () => {
  test("the enum member exists", () => {
    expect(MonitorType.StorageArray).toBe("Storage Array");
  });

  test("renders the storage array step form for storage array monitors", () => {
    expect(monitorStepSource).toContain(
      "{props.monitorType === MonitorType.StorageArray && (",
    );
    expect(monitorStepSource).toContain(
      'import StorageArrayMonitorStepForm from "./StorageArrayMonitor/StorageArrayMonitorStepForm";',
    );
    expect(monitorStepSource).toContain("<StorageArrayMonitorStepForm");
  });

  test("reads and writes the storageArrayMonitor sub-config", () => {
    expect(monitorStepSource).toContain(
      "monitorStepStorageArrayMonitor={ monitorStep.data?.storageArrayMonitor || MonitorStepStorageArrayMonitorUtil.getDefault() }",
    );
    expect(monitorStepSource).toContain(
      "onChange={(value: MonitorStepStorageArrayMonitor) => { monitorStep.setStorageArrayMonitor(value); props.onChange?.(MonitorStep.clone(monitorStep)); }}",
    );
  });

  test("lets a Quick Setup template replace the criteria", () => {
    /*
     * The block must also wire onMonitorCriteriaChange, or picking a
     * template configures the metric query but leaves the criteria empty.
     */
    const storageArrayBlock: string = monitorStepSource.slice(
      monitorStepSource.indexOf(
        "{props.monitorType === MonitorType.StorageArray && (",
      ),
    );
    const blockEnd: number = storageArrayBlock.indexOf("</Card>");
    const block: string = storageArrayBlock.slice(0, blockEnd);

    expect(block).toContain(
      "onMonitorCriteriaChange={(criteria: MonitorCriteria) => { monitorStep.setMonitorCriteria(criteria);",
    );
    expect(block).toContain(
      "onlineMonitorStatusId={props.onlineMonitorStatusId}",
    );
    expect(block).toContain(
      "offlineMonitorStatusId={props.offlineMonitorStatusId}",
    );
    expect(block).toContain(
      "defaultIncidentSeverityId={props.defaultIncidentSeverityId}",
    );
    expect(block).toContain(
      "defaultAlertSeverityId={props.defaultAlertSeverityId}",
    );
    expect(block).toContain("monitorName={props.monitorName}");
  });
});

describe("the criteria form treats storage array monitors as metric monitors", () => {
  const criteriaFilterUtil: string = fs.readFileSync(
    path.join(DASHBOARD_SRC, "Utils", "Form", "Monitor", "CriteriaFilter.ts"),
    "utf8",
  );
  const criteriaFilters: string = readSource("CriteriaFilters.tsx");

  test("its filters are pinned to the metric value", () => {
    const start: number = criteriaFilterUtil.indexOf(
      "public static isMetricOnlyMonitorType(",
    );
    const body: string = criteriaFilterUtil.slice(start, start + 800);

    // The metric-backed list, minus IoT Device; storage arrays are on it.
    expect(body).toContain(
      "MonitorTypeHelper.isMetricBackedMonitor(monitorType) &&",
    );
    expect(body).toContain("monitorType !== MonitorType.IoTDevice");
    expect(
      MonitorTypeHelper.getMetricBackedMonitorTypes().includes(
        MonitorType.StorageArray,
      ),
    ).toBe(true);
  });

  /*
   * The wording follows isMetricOnlyMonitorType - the list the test above
   * pins storage arrays into - instead of three copies of that list.
   */
  test("it says rule, not filter, in all three places the Ceph monitor does", () => {
    expect(criteriaFilters).toContain(
      "const isMetricOnly: boolean = CriteriaFilterUtil.isMetricOnlyMonitorType( props.monitorType, );",
    );
    expect(criteriaFilters).toContain(
      'title={isMetricOnly ? "Add Rule" : "Add Filter"}',
    );
    expect(criteriaFilters).toContain(
      "description={ isMetricOnly ? `At least one alert rule is required.",
    );
    expect(criteriaFilters).toContain(
      "title={ isMetricOnly ? `Cannot delete last remaining rule.`",
    );
    expect(criteriaFilters).not.toContain("MonitorType.StorageArray");
  });
});
