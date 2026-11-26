import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  MonitorStepXcpNgMonitorUtil,
  XcpNgResourceFilters,
} from "Common/Types/Monitor/MonitorStepXcpNgMonitor";
import {
  XcpNgAlertTemplate,
  XcpNgAlertTemplateCategory,
  getAllXcpNgAlertTemplates,
  getXcpNgAlertTemplateById,
  getXcpNgDefaultAlertTemplateId,
} from "Common/Types/Monitor/XcpNgAlertTemplates";
import {
  XcpNgMetricCategory,
  XcpNgMetricDefinition,
  getAllXcpNgMetricCategories,
  getAllXcpNgMetrics,
} from "Common/Types/Monitor/XcpNgMetricCatalog";
import { XcpNgScope } from "Common/Types/XcpNg/XcpNgTelemetry";
import { XCP_NG_TEMPLATE_CATEGORIES } from "../../FeatureSet/Dashboard/src/Components/Form/Monitor/AlertTemplatePicker/AlertTemplateCategories";
import {
  AlertTemplateCategory,
  AlertTemplateGroup,
  groupAlertTemplates,
} from "../../FeatureSet/Dashboard/src/Components/Form/Monitor/AlertTemplatePicker/AlertTemplateGroups";

/*
 * The XCP-ng monitor's step form, read as source: the App project has no
 * React on its resolution path, so what the form does is held here to the
 * Common types it writes (MonitorStepXcpNgMonitor), and the form is drawn
 * for real in Common's XcpNgMonitorStepForm suite.
 *
 * What it must get right: a pool is watched by its XAPI UUID
 * (poolIdentifier), never its name; every resource filter is one of
 * XcpNgResourceFilters' keys; a metric of your own alerts once per object;
 * a new monitor starts on Pool Disconnected.
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

const read: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(FORM_DIR, relativePath), "utf8");
};

const stepFormSource: string = read("XcpNgMonitor/XcpNgMonitorStepForm.tsx");
const templatePickerSource: string = read(
  "XcpNgMonitor/XcpNgTemplatePicker.tsx",
);
const metricPickerSource: string = read("XcpNgMonitor/XcpNgMetricPicker.tsx");
const monitorStepSource: string = read("MonitorStep.tsx");

const stepForm: string = squash(stepFormSource);

describe("XcpNgMonitorStepForm pool selection", () => {
  test("lists pools from the XcpNgPool model, by their UUID, named by their name", () => {
    expect(stepFormSource).toContain(
      'import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";',
    );
    expect(stepForm).toContain("useInfrastructureResources<XcpNgPool>({");
    expect(stepForm).toContain('valueField: "poolIdentifier"');
    expect(stepForm).toContain('searchFields: ["name", "poolIdentifier"]');
    expect(stepForm).toContain(
      "heldValue: monitorStepXcpNgMonitor.poolIdentifier",
    );
    expect(stepForm).toContain(
      'label: pool.name || pool.poolIdentifier || "Unknown"',
    );
    expect(stepForm).toContain('value: pool.poolIdentifier || ""');
    // Never matched by name: two Xen Orchestras can each have a "Production".
    expect(stepForm).not.toContain("value: pool.name");
  });

  test("shows the pool a step is bound to, renamed or not", () => {
    expect(stepForm).toMatch(
      /value=\{resources\.valueOf\(\{ value: monitorStepXcpNgMonitor\.poolIdentifier, resourceId: monitorStepXcpNgMonitor\.resourceId, \}\)\}/,
    );
  });

  test("a pool added from the form is picked by its UUID", () => {
    expect(stepForm).toContain(
      'String((record as XcpNgPool).poolIdentifier || "")',
    );
    expect(stepForm).toContain("onboarding={XCP_NG_POOL_ONBOARDING}");
    expect(stepForm).toContain("title: XCP_NG_POOL_ONBOARDING.addTitle");
  });

  test("hands the picked pool to templates and to metrics of your own", () => {
    expect(stepForm).toContain(
      "applyTemplate(template, monitorStepXcpNgMonitor.poolIdentifier)",
    );
    expect(stepForm).toContain(
      'poolIdentifier: input.current.poolIdentifier || ""',
    );
    expect(stepForm).toContain('poolIdentifier: poolIdentifier || "",');
  });

  test("the field says what it watches, in the product's words", () => {
    expect(stepForm).toContain('title="XCP-ng Pool"');
    expect(stepForm).toContain('placeholder="Select an XCP-ng pool..."');
  });
});

describe("XcpNgMonitorStepForm resource filters", () => {
  const FILTER_KEYS: Array<keyof XcpNgResourceFilters> = [
    "scope",
    "xcpNgId",
    "hostName",
  ];

  test("offers exactly the filters XcpNgResourceFilters declares", () => {
    for (const key of FILTER_KEYS) {
      expect(stepFormSource).toContain(`resourceFilters.${key}`);
    }

    const written: Array<string> = Array.from(
      stepFormSource.matchAll(/changeResourceFilters\(\{\s*(\w+):/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(written.sort()).toEqual([...FILTER_KEYS].sort());
  });

  test("writes each filter back under its own key, spreading the rest", () => {
    expect(stepForm).toContain(
      "resourceFilters: { ...resourceFilters, ...filters, },",
    );
  });

  test("its scope picker offers every scope ingest stamps, the pool's last", () => {
    for (const scope of Object.values(XcpNgScope)) {
      const key: string = Object.keys(XcpNgScope).find((name: string) => {
        return XcpNgScope[name as keyof typeof XcpNgScope] === scope;
      })!;

      expect(stepFormSource).toContain(`value: XcpNgScope.${key} }`);
    }

    const pool: number = stepFormSource.indexOf("value: XcpNgScope.Pool }");
    for (const scope of ["Host", "VM", "StorageRepository", "VDI", "Xostor"]) {
      expect(
        stepFormSource.indexOf(`value: XcpNgScope.${scope} }`),
      ).toBeLessThan(pool);
    }
  });

  test("the scope options name each kind of object as the pool pages do", () => {
    for (const [label, scope] of [
      ["Host", "Host"],
      ["VM", "VM"],
      ["Storage Repository", "StorageRepository"],
      ["Virtual Disk", "VDI"],
      ["XOSTOR", "Xostor"],
      // Never the bare "Pool": a Ceph or OpenStack storage pool's word.
      ["XCP-ng Pool", "Pool"],
    ]) {
      expect(stepFormSource).toContain(
        `{ label: "${label}", value: XcpNgScope.${scope} }`,
      );
    }
  });

  test("an empty field clears its filter rather than writing an empty one", () => {
    expect(stepForm).toContain("scope: (value as XcpNgScope) || undefined,");
    expect(stepForm).toContain("xcpNgId: value || undefined,");
    expect(stepForm).toContain("hostName: value || undefined,");
  });

  test("its help says what each filter does in one short line, and not '(optional)' again", () => {
    const descriptions: Array<string> = Array.from(
      stepForm.matchAll(/description=\{ "([^"]+)" \}/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(descriptions.length).toBeGreaterThanOrEqual(3);

    for (const description of descriptions) {
      expect({ description, length: description.length <= 150 }).toEqual({
        description,
        length: true,
      });
      expect(description.toLowerCase()).not.toContain("(optional)");
    }
  });
});

describe("XcpNgMonitorStepForm metrics of your own", () => {
  test("alert once per object: grouped by xcp_ng.id, but a pool's own series whole", () => {
    expect(stepForm).toContain(
      "groupByAttributeKey: metric.defaultResourceScope === XcpNgScope.Pool ? undefined : XCP_NG_ID_ATTRIBUTE,",
    );
  });

  test("keep the unit the stored values are in", () => {
    expect(stepForm).toContain("legendUnit: metric.unit || undefined,");
  });

  test("start on the kind of object the metric describes", () => {
    expect(stepForm).toContain("scope: metric.defaultResourceScope,");

    // Every catalog metric names a scope ingest stamps.
    const scopes: Array<string> = Object.values(XcpNgScope);
    for (const metric of getAllXcpNgMetrics()) {
      expect({
        id: metric.id,
        scope: scopes.includes(metric.defaultResourceScope),
      }).toEqual({
        id: metric.id,
        scope: true,
      });
    }
  });

  test("read the step's window, or five minutes when it names none", () => {
    expect(stepForm).toContain(
      "const DEFAULT_ROLLING_TIME: RollingTime = RollingTime.Past5Minutes;",
    );
    expect(stepForm).toContain(
      "rollingTime: input.current.rollingTime || DEFAULT_ROLLING_TIME,",
    );
  });

  test("start on the out-of-the-box criteria of an XCP-ng monitor", () => {
    expect(stepForm).toContain(
      "MonitorCriteria.getDefaultMonitorCriteria({ monitorType: MonitorType.XcpNg,",
    );
  });

  test("chart what the monitor reads, narrowed to the pool and its filters", () => {
    expect(stepForm).toContain(
      "chartQueryConfigs={MonitorStepMetricQueries.getReadQueryConfigs({ monitorType: MonitorType.XcpNg, settings: monitorStepXcpNgMonitor, })}",
    );
  });
});

describe("XcpNgMonitorStepForm's first alert", () => {
  test("a new monitor starts on Pool Disconnected", () => {
    const template: XcpNgAlertTemplate | undefined = getXcpNgAlertTemplateById(
      getXcpNgDefaultAlertTemplateId(),
    );

    expect(template?.name).toBe("Pool Disconnected");
    expect(template?.category).toBe("Availability");
    expect(stepForm).toContain(
      "getXcpNgAlertTemplateById( getXcpNgDefaultAlertTemplateId(), );",
    );
  });

  test("the default step a form starts from is the Common one", () => {
    expect(stepForm).toContain(
      "props.monitorStepXcpNgMonitor || MonitorStepXcpNgMonitorUtil.getDefault();",
    );
    expect(MonitorStepXcpNgMonitorUtil.getDefault().poolIdentifier).toBe("");
  });
});

describe("XcpNgTemplatePicker", () => {
  const templates: Array<XcpNgAlertTemplate> = getAllXcpNgAlertTemplates();

  test("there are templates to offer", () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  test("the picker is the shared one, over the whole catalog and its headings", () => {
    const picker: string = squash(templatePickerSource);

    expect(picker).toContain("<AlertTemplatePicker<XcpNgAlertTemplate>");
    expect(picker).toContain("templates={getAllXcpNgAlertTemplates()}");
    expect(picker).toContain("categories={XCP_NG_TEMPLATE_CATEGORIES}");
  });

  test("every category a template uses has a heading", () => {
    const headed: Array<string> = XCP_NG_TEMPLATE_CATEGORIES.map(
      (category: AlertTemplateCategory): string => {
        return category.category;
      },
    );

    for (const template of templates) {
      expect(headed).toContain(template.category);
    }
  });

  test("the picker lists no category that has no templates", () => {
    const used: Set<XcpNgAlertTemplateCategory> = new Set(
      templates.map((template: XcpNgAlertTemplate) => {
        return template.category;
      }),
    );

    for (const category of XCP_NG_TEMPLATE_CATEGORIES) {
      expect(used.has(category.category as XcpNgAlertTemplateCategory)).toBe(
        true,
      );
    }
  });

  test("groups the templates under its headings, Availability first", () => {
    const groups: Array<AlertTemplateGroup<XcpNgAlertTemplate>> =
      groupAlertTemplates(templates, XCP_NG_TEMPLATE_CATEGORIES);

    expect(
      groups.map((group: AlertTemplateGroup<XcpNgAlertTemplate>) => {
        return group.label;
      }),
    ).toEqual(["Availability", "Host", "VM", "Storage"]);

    expect(
      groups.reduce(
        (count: number, group: AlertTemplateGroup<XcpNgAlertTemplate>) => {
          return count + group.templates.length;
        },
        0,
      ),
    ).toBe(templates.length);
  });

  test("uses XCP-ng's vocabulary, not another hypervisor's", () => {
    const words: Array<string> = [
      ...templatePickerSource.split(/\W+/),
      ...XCP_NG_TEMPLATE_CATEGORIES.map((category: AlertTemplateCategory) => {
        return category.label;
      }),
    ];

    for (const word of ["Proxmox", "pve", "Guest", "Node", "VMware", "ESXi"]) {
      expect(words).not.toContain(word);
    }
  });
});

describe("XcpNgMetricPicker", () => {
  const metrics: Array<XcpNgMetricDefinition> = getAllXcpNgMetrics();
  const categories: Array<XcpNgMetricCategory> = getAllXcpNgMetricCategories();

  test("there are metrics and categories to offer", () => {
    expect(metrics.length).toBeGreaterThan(0);
    expect(categories.length).toBeGreaterThan(0);
  });

  test("groups options by every catalog category, each heading looked up once", () => {
    const picker: string = squash(metricPickerSource);

    expect(picker).toContain("getAllXcpNgMetricCategories()");
    expect(picker).toContain("getXcpNgMetricCategoryLabel(category)");
    expect(picker).toContain(
      "label: translator.translateText(heading) || heading,",
    );
  });

  test("every metric belongs to a listed category", () => {
    for (const metric of metrics) {
      expect(categories).toContain(metric.category);
    }
  });

  test("shows the unit the stored values are in next to the metric name", () => {
    expect(metricPickerSource).toContain('${m.unit ? ` (${m.unit})` : ""}');
  });

  test("draws the metric's name as code, never with backticks", () => {
    const picker: string = squash(metricPickerSource);

    expect(picker).toContain(
      '<code className="bg-gray-100 px-1 rounded text-xs"> {selectedMetric.metricName} </code>',
    );

    // The catalog's descriptions are shown as text: they hold no backtick.
    for (const metric of metrics) {
      expect(metric.description).not.toContain("`");
    }
  });
});

describe("MonitorStep.tsx switches on MonitorType.XcpNg", () => {
  const monitorStep: string = squash(monitorStepSource);

  test("the enum member exists", () => {
    expect(MonitorType.XcpNg).toBe("XCP-ng");
  });

  test("renders the XCP-ng step form for XCP-ng monitors", () => {
    expect(monitorStep).toContain(
      '{props.monitorType === MonitorType.XcpNg && ( <Card title="XCP-ng Monitor Configuration"',
    );
    expect(monitorStep).toContain("<XcpNgMonitorStepForm");
  });

  test("reads and writes the xcpNgMonitor sub-config", () => {
    expect(monitorStep).toContain(
      "monitorStepXcpNgMonitor={ monitorStep.data?.xcpNgMonitor || MonitorStepXcpNgMonitorUtil.getDefault() }",
    );
    expect(monitorStep).toContain("monitorStep.setXcpNgMonitor(value);");
  });

  test("lets a Quick Setup template replace the criteria", () => {
    const start: number = monitorStep.indexOf("<XcpNgMonitorStepForm");
    const end: number = monitorStep.indexOf("/>", start);
    const form: string = monitorStep.slice(start, end);

    expect(form).toContain("onMonitorCriteriaChange={");
    expect(form).toContain("monitorStep.setMonitorCriteria(criteria);");
    for (const prop of [
      "onlineMonitorStatusId",
      "offlineMonitorStatusId",
      "defaultIncidentSeverityId",
      "defaultAlertSeverityId",
      "monitorName",
    ]) {
      expect(form).toContain(`${prop}={props.${prop}}`);
    }
  });
});
