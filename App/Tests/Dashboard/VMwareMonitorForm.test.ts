import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  MonitorStepVMwareMonitorUtil,
  VMwareResourceFilters,
  VMwareResourceScope,
} from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import {
  VMwareAlertTemplate,
  VMwareAlertTemplateCategory,
  VMwareGroupByKey,
  getAllVMwareAlertTemplates,
} from "Common/Types/Monitor/VMwareAlertTemplates";
import {
  VMwareMetricCategory,
  VMwareMetricDefinition,
  getAllVMwareMetricCategories,
  getAllVMwareMetrics,
} from "Common/Types/Monitor/VMwareMetricCatalog";

/*
 * The VMware monitor form is three React components plus one branch in
 * MonitorStep.tsx, none of which a unit test can render: the App suite runs
 * in a plain Node environment with no renderer. Every failure mode of that
 * wiring is silent — a resource filter written to the wrong key compiles
 * fine and is simply ignored by the worker, a template category missing
 * from the picker's list means those templates are never offered, and a
 * monitor type with no branch in MonitorStep.tsx renders an empty step.
 *
 * So, like RecommendationPageWiring.test.ts, these read the sources and pin
 * the exact expressions, and cross-check the hard-coded lists against the
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

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function readSource(...relativeParts: Array<string>): string {
  return squash(fs.readFileSync(path.join(FORM_DIR, ...relativeParts), "utf8"));
}

const stepFormSource: string = readSource(
  "VMwareMonitor",
  "VMwareMonitorStepForm.tsx",
);
const templatePickerSource: string = readSource(
  "VMwareMonitor",
  "VMwareTemplatePicker.tsx",
);
const metricPickerSource: string = readSource(
  "VMwareMonitor",
  "VMwareMetricPicker.tsx",
);
const monitorStepSource: string = readSource("MonitorStep.tsx");

/*
 * Every key of VMwareResourceFilters, restated as a total Record so adding a
 * filter to the Common interface fails to compile here until the form is
 * taught about it. The value is the `resource.`-prefixed attribute the
 * worker maps the key to; the form's field description must name it so the
 * user can see exactly what they are filtering on.
 */
const RESOURCE_FILTER_ATTRIBUTES: Record<
  keyof Required<VMwareResourceFilters>,
  string
> = {
  datacenterName: "resource.vcenter.datacenter.name",
  clusterName: "resource.vcenter.cluster.name",
  hostName: "resource.vcenter.host.name",
  vmName: "resource.vcenter.vm.name",
  datastoreName: "resource.vcenter.datastore.name",
  resourcePoolPath: "resource.vcenter.resource_pool.inventory_path",
};

const ALL_FILTER_KEYS: Array<keyof VMwareResourceFilters> = Object.keys(
  RESOURCE_FILTER_ATTRIBUTES,
) as Array<keyof VMwareResourceFilters>;

describe("VMwareMonitorStepForm resource filters", () => {
  test.each(ALL_FILTER_KEYS)(
    "offers a field for the %s filter and names its attribute",
    (key: keyof VMwareResourceFilters) => {
      // The field is declared in the resourceFilterFields table by its key...
      expect(stepFormSource).toContain(`key: "${key}",`);
      // ...and its description tells the user which attribute it maps to.
      expect(stepFormSource).toContain(RESOURCE_FILTER_ATTRIBUTES[key]);
    },
  );

  test("writes each field back under its own key, spreading the rest", () => {
    /*
     * One generic onChange writes `[field.key]: value || undefined` on top
     * of the existing filters. Pin both halves: the spread (so typing a VM
     * name does not wipe a host name typed earlier) and the computed key
     * (so the value lands where the worker reads it).
     */
    expect(stepFormSource).toContain(
      "resourceFilters: { ...monitorStepVMwareMonitor.resourceFilters, [field.key]: value || undefined, }",
    );
    expect(stepFormSource).toMatch(
      /value=\{ ?monitorStepVMwareMonitor\.resourceFilters\[field\.key\] \|\| "" ?\}/,
    );
  });

  test("offers exactly the filters VMwareResourceFilters declares — no scope dropdown", () => {
    /*
     * Unlike Proxmox there is no `pve.scope` datapoint attribute to filter
     * on: the vcenter receiver tells objects apart by metric name and
     * resource attributes. A scope dropdown here would be sent to the
     * worker as a filter it cannot map.
     */
    const declaredKeys: Array<string> = [
      ...stepFormSource.matchAll(/key: "([a-zA-Z]+)",/g),
    ].map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(new Set(declaredKeys)).toEqual(new Set<string>(ALL_FILTER_KEYS));
    expect(stepFormSource).not.toContain("scope:");
    expect(stepFormSource).not.toContain("pve.");
  });

  test("keeps already-typed filters when a custom metric is picked", () => {
    expect(stepFormSource).toContain(
      "config.resourceFilters = { ...monitorStepVMwareMonitor.resourceFilters, }",
    );
  });
});

describe("VMwareMonitorStepForm rolling window fallback", () => {
  /*
   * The VMware Agent polls vCenter every VCENTER_COLLECTION_INTERVAL (2
   * minutes by default) and the receiver emits one sample per object per
   * collection. The Proxmox / Kubernetes forms fall back to Past1Minute
   * because their agents scrape every 30 s; copied here, that window is
   * empty on every other evaluation and a hand-built monitor flaps between
   * "no criteria met" and firing. Every fallback in the form must therefore
   * be the shared Common default, and that default must be >= 5 minutes.
   */
  test("the Common default is a 5-minute window", () => {
    expect(MonitorStepVMwareMonitorUtil.getDefault().rollingTime).toBe(
      RollingTime.Past5Minutes,
    );
  });

  test("the form reads its fallback from the Common default", () => {
    expect(stepFormSource).toContain(
      "const DEFAULT_ROLLING_TIME: RollingTime = MonitorStepVMwareMonitorUtil.getDefault().rollingTime;",
    );
  });

  test("every rollingTime fallback uses that default — never a literal", () => {
    const fallbacks: Array<string> = [
      ...stepFormSource.matchAll(
        /monitorStepVMwareMonitor\.rollingTime \|\| ([A-Za-z_.]+)/g,
      ),
    ].map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    // The two start/end-time effects plus the custom metric config builder.
    expect(fallbacks).toHaveLength(3);
    for (const fallback of fallbacks) {
      expect(fallback).toBe("DEFAULT_ROLLING_TIME");
    }
  });

  test("no VMware form component falls back to a 1-minute window", () => {
    for (const source of [
      stepFormSource,
      templatePickerSource,
      metricPickerSource,
    ]) {
      expect(source).not.toContain("Past1Minute");
    }
  });
});

describe("VMwareMonitorStepForm vCenter selection", () => {
  test("lists vCenters from the VMwareVCenter model and uses the name as the identifier", () => {
    /*
     * `name` is the `vmware.vcenter.name` attribute the agent stamps on
     * every metric; the worker scopes on it. Using the row id here would
     * match nothing.
     */
    expect(stepFormSource).toContain(
      "ModelAPI.getList<VMwareVCenter>({ modelType: VMwareVCenter,",
    );
    expect(stepFormSource).toContain(
      'return { label: vcenter.name || "Unknown", value: vcenter.name || "", };',
    );
    expect(stepFormSource).toContain(
      'vcenterIdentifier: (value as string) || ""',
    );
  });

  test("hands the selected vCenter to templates and custom metrics", () => {
    expect(stepFormSource).toContain(
      'template.getMonitorStep({ vcenterIdentifier: vcenterIdentifier || "",',
    );
    expect(stepFormSource).toContain(
      'buildVMwareMonitorConfig({ vcenterIdentifier: vcenterIdentifier || "",',
    );
    // The template's step is applied through the vmwareMonitor sub-config.
    expect(stepFormSource).toContain("templateStep.data?.vmwareMonitor");
    expect(stepFormSource).not.toContain("proxmoxMonitor");
  });
});

describe("VMwareMonitorStepForm custom metric grouping", () => {
  /*
   * A custom metric is grouped by the identity attribute of the vSphere
   * object it describes, so "host CPU > 90" fires per ESXi host instead of
   * averaging the whole vCenter into one series. The map is restated here
   * per scope so a new scope in the Common enum fails this test until the
   * form decides how to group it.
   */
  const EXPECTED_GROUP_BY: Record<VMwareResourceScope, string | undefined> = {
    [VMwareResourceScope.VCenter]: undefined,
    [VMwareResourceScope.Datacenter]: VMwareGroupByKey.Datacenter,
    [VMwareResourceScope.Cluster]: VMwareGroupByKey.Cluster,
    [VMwareResourceScope.Host]: VMwareGroupByKey.Host,
    [VMwareResourceScope.VirtualMachine]: VMwareGroupByKey.VirtualMachine,
    [VMwareResourceScope.Datastore]: VMwareGroupByKey.Datastore,
    [VMwareResourceScope.ResourcePool]: VMwareGroupByKey.ResourcePool,
  };

  test.each(Object.values(VMwareResourceScope))(
    "scope %s is mapped to its group-by key (or deliberately left ungrouped)",
    (scope: VMwareResourceScope) => {
      const enumMember: string = Object.keys(VMwareResourceScope).find(
        (member: string): boolean => {
          return (
            VMwareResourceScope[member as keyof typeof VMwareResourceScope] ===
            scope
          );
        },
      )!;
      const expected: string | undefined = EXPECTED_GROUP_BY[scope];

      if (expected === undefined) {
        expect(stepFormSource).not.toContain(
          `[VMwareResourceScope.${enumMember}]:`,
        );
        return;
      }

      const groupByMember: string = Object.keys(VMwareGroupByKey).find(
        (member: string): boolean => {
          return (
            VMwareGroupByKey[member as keyof typeof VMwareGroupByKey] ===
            expected
          );
        },
      )!;

      expect(stepFormSource).toContain(
        `[VMwareResourceScope.${enumMember}]: VMwareGroupByKey.${groupByMember},`,
      );
    },
  );

  test("passes the group-by key and the receiver's unit into the config", () => {
    expect(stepFormSource).toContain(
      "groupByAttributeKey: groupByKeyForScope[metric.defaultResourceScope],",
    );
    expect(stepFormSource).toContain("legendUnit: metric.unit,");
  });

  test("every catalog metric's scope has a grouping decision", () => {
    for (const metric of getAllVMwareMetrics()) {
      expect(Object.keys(EXPECTED_GROUP_BY)).toContain(
        metric.defaultResourceScope,
      );
    }
  });
});

describe("VMwareTemplatePicker", () => {
  const allTemplates: Array<VMwareAlertTemplate> = getAllVMwareAlertTemplates();

  test("there are templates to offer", () => {
    expect(allTemplates.length).toBeGreaterThan(0);
  });

  test("renders every template through its category block", () => {
    /*
     * The picker filters templates by `t.category === cat.category` over a
     * hard-coded category list. A template whose category is missing from
     * that list is silently never offered — so every category that any
     * template uses must appear in the list.
     */
    const categoriesInUse: Set<VMwareAlertTemplateCategory> = new Set(
      allTemplates.map((template: VMwareAlertTemplate) => {
        return template.category;
      }),
    );

    for (const category of categoriesInUse) {
      expect(templatePickerSource).toContain(`category: "${category}",`);
    }
  });

  test.each(getAllVMwareAlertTemplates())(
    "$name is reachable from the picker",
    (template: VMwareAlertTemplate) => {
      expect(templatePickerSource).toContain(
        `category: "${template.category}",`,
      );
      expect(templatePickerSource).toContain("getAllVMwareAlertTemplates()");
      expect(templatePickerSource).toContain(
        "return t.category === cat.category;",
      );
    },
  );

  test("the picker lists no category that has no templates", () => {
    const listed: Array<string> = [
      ...templatePickerSource.matchAll(/category: "([^"]+)",/g),
    ].map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    const categoriesInUse: Set<string> = new Set(
      allTemplates.map((template: VMwareAlertTemplate): string => {
        return template.category;
      }),
    );

    expect(new Set(listed)).toEqual(categoriesInUse);
    expect(new Set(listed).size).toBe(listed.length);
  });

  test("uses vSphere vocabulary, not Proxmox's", () => {
    for (const word of ["Proxmox", "pve", "Guest", "Node", "LXC", "QEMU"]) {
      expect(templatePickerSource).not.toContain(word);
    }
    expect(templatePickerSource).toContain("ESXi Host");
    expect(templatePickerSource).toContain("Datastore");
    expect(templatePickerSource).toContain("vSAN");
  });
});

describe("VMwareMetricPicker", () => {
  test("there are metrics and categories to offer", () => {
    expect(getAllVMwareMetrics().length).toBeGreaterThan(0);
    expect(getAllVMwareMetricCategories().length).toBeGreaterThan(0);
  });

  test("groups options by every catalog category", () => {
    /*
     * The picker builds one option group per getAllVMwareMetricCategories()
     * entry and fills it with `m.category === category`. Both halves are
     * pinned: it must iterate the catalog's own category list (not a
     * hand-kept copy that could drift), and every category must actually
     * hold at least one metric so no empty group heading renders.
     */
    expect(metricPickerSource).toContain("getAllVMwareMetricCategories()");
    expect(metricPickerSource).toContain("return m.category === category;");

    const metrics: Array<VMwareMetricDefinition> = getAllVMwareMetrics();
    for (const category of getAllVMwareMetricCategories()) {
      expect(
        metrics.filter((metric: VMwareMetricDefinition): boolean => {
          return metric.category === category;
        }).length,
      ).toBeGreaterThan(0);
    }
  });

  test("every metric belongs to a listed category", () => {
    const categories: Array<VMwareMetricCategory> =
      getAllVMwareMetricCategories();
    for (const metric of getAllVMwareMetrics()) {
      expect(categories).toContain(metric.category);
    }
  });

  test("shows the receiver's unit next to the metric name", () => {
    expect(metricPickerSource).toContain(
      'label: `${m.friendlyName}${m.unit ? ` (${m.unit})` : ""}`,',
    );
    expect(metricPickerSource).toContain("selectedMetric.metricName");
  });
});

describe("MonitorStep.tsx switches on MonitorType.VMware", () => {
  test("the enum member exists", () => {
    expect(MonitorType.VMware).toBe("VMware");
  });

  test("renders the VMware step form for VMware monitors", () => {
    expect(monitorStepSource).toContain(
      "{props.monitorType === MonitorType.VMware && (",
    );
    expect(monitorStepSource).toContain(
      'import VMwareMonitorStepForm from "./VMwareMonitor/VMwareMonitorStepForm";',
    );
    expect(monitorStepSource).toContain("<VMwareMonitorStepForm");
  });

  test("reads and writes the vmwareMonitor sub-config", () => {
    expect(monitorStepSource).toContain(
      "monitorStepVMwareMonitor={ monitorStep.data?.vmwareMonitor || MonitorStepVMwareMonitorUtil.getDefault() }",
    );
    expect(monitorStepSource).toContain(
      "onChange={(value: MonitorStepVMwareMonitor) => { monitorStep.setVMwareMonitor(value); props.onChange?.(MonitorStep.clone(monitorStep)); }}",
    );
  });

  test("lets a Quick Setup template replace the criteria", () => {
    /*
     * The block must also wire onMonitorCriteriaChange, or picking a
     * template configures the metric query but leaves the criteria empty.
     */
    const vmwareBlock: string = monitorStepSource.slice(
      monitorStepSource.indexOf(
        "{props.monitorType === MonitorType.VMware && (",
      ),
    );
    const blockEnd: number = vmwareBlock.indexOf("</Card>");
    const block: string = vmwareBlock.slice(0, blockEnd);

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
