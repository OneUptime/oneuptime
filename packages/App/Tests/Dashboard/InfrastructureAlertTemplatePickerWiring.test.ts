import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ALERT_TEMPLATE_CHANGE,
  ALERT_TEMPLATE_PICKED_LABEL,
  ALERT_TEMPLATE_PICKER_ARIA_LABEL,
  ALERT_TEMPLATE_PICKER_INTRO,
  ALERT_TEMPLATE_SHOW_LESS,
  ALERT_TEMPLATE_SHOW_MORE,
  ALERT_TEMPLATE_TIME_RANGE,
  ALERT_TEMPLATE_TIME_RANGE_DESCRIPTION,
  AlertTemplateCategory,
  AlertTemplateGroup,
  AlertTemplatePickerTemplate,
  INFRASTRUCTURE_MONITOR_CONFIGURATION_DESCRIPTION,
  getAlertTemplateIdAfterKey,
  getAlertTemplateTabStopId,
  getAlertTemplatesInDrawnOrder,
  getPickedAlertTemplate,
  groupAlertTemplates,
  hasAlertTemplateDetails,
  isCriticalAlertTemplate,
  isNewAlertTemplatePick,
} from "../../FeatureSet/Dashboard/src/Components/Form/Monitor/AlertTemplatePicker/AlertTemplateGroups";
import {
  ALERT_TEMPLATE_CATEGORIES_BY_RESOURCE_TYPE,
  KUBERNETES_RECOMMENDATION_CATEGORIES,
  KUBERNETES_TEMPLATE_CATEGORIES,
  getAlertTemplateCategoryLabel,
  orderAlertTemplateCategories,
} from "../../FeatureSet/Dashboard/src/Components/Form/Monitor/AlertTemplatePicker/AlertTemplateCategories";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorRecommendationCatalog from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * Quick Setup's alert templates on the ten infrastructure monitor types,
 * held in the source.
 *
 * - One shared picker (AlertTemplatePicker) draws every type's templates: a
 *   compact radio row per template with its name, severity and one-line
 *   summary. The ten copies of a card list that carried each template's
 *   whole description, in a blue that is not the product's, are gone.
 * - Once a template is picked, the list folds into it: its row with Change,
 *   its full description behind Show more, and its Time Range under it,
 *   handed in by the step form as the picker's children.
 * - A template pick and a Custom Metric pick each clear the other tab's
 *   pick: both replace the monitor's query.
 * - Each type's configuration card says in one line what its three tabs are
 *   for, instead of ten sentences listing them.
 * - On the Custom Metric and Advanced tabs, the metric fields say nothing
 *   their title and the picker under them do not ("Select a Kubernetes
 *   metric to monitor ..."), and Aggregation says what it is in a sentence
 *   rather than a question.
 * - A resource's Recommendations list their headings in the order Quick
 *   Setup does: the same templates, under the same headings, in one order.
 * - The words it added are in every language, and the ones it retired are
 *   in none.
 *
 * App has no renderer, so the components are read as text and the
 * React-free helpers are called. Common's InfrastructureAlertTemplatePicker
 * and InfrastructureMonitorQuickSetup render them.
 */

const APP_ROOT: string = path.join(__dirname, "../..");
const DASHBOARD_SRC: string = path.join(APP_ROOT, "FeatureSet/Dashboard/src");
const FORMS: string = "Components/Form/Monitor";
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

function read(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

// Runs of whitespace, so a source reads the same however prettier wraps it.
const WHITESPACE: RegExp = /\s+/g;

// A template pick, then (after at most a comment line) the metric pick cleared.
const TEMPLATE_PICK_CLEARS_METRIC: RegExp =
  /setSelectedTemplateId\(template\.id\);\s*(?:\/\/[^\n]*\s*)?setSelectedMetricId\(undefined\);/;

// A metric pick, then (after at most a comment line) the template pick cleared.
const METRIC_PICK_CLEARS_TEMPLATE: RegExp =
  /setSelectedMetricId\(metric\.id\);\s*(?:\/\/[^\n]*\s*)?setSelectedTemplateId\(undefined\);/;

function flat(text: string): string {
  return text.replace(WHITESPACE, " ");
}

interface InfrastructureType {
  name: string;
  stepForm: string;
  picker: string;
  configurationTitle: string;
}

// Its Custom Metric tab's metric field.
const METRIC_FIELD_TITLES: Record<string, string> = {
  Host: "Host Metric",
  Docker: "Docker Metric",
  Podman: "Podman Metric",
  "Docker Swarm": "Docker Swarm Metric",
  Kubernetes: "Kubernetes Metric",
  Proxmox: "Proxmox Metric",
  VMware: "VMware Metric",
  Ceph: "Ceph Metric",
  "Storage Array": "Storage Array Metric",
  IoT: "IoT Metric",
};

const AGGREGATION_DESCRIPTION: string =
  "How the metric values are combined over the time range.";

const TYPES: Array<InfrastructureType> = [
  {
    name: "Host",
    stepForm: "HostMonitor/HostMonitorStepForm.tsx",
    picker: "HostMonitor/HostTemplatePicker.tsx",
    configurationTitle: "Host Monitor Configuration",
  },
  {
    name: "Docker",
    stepForm: "DockerMonitor/DockerMonitorStepForm.tsx",
    picker: "DockerMonitor/DockerTemplatePicker.tsx",
    configurationTitle: "Docker Monitor Configuration",
  },
  {
    name: "Podman",
    stepForm: "PodmanMonitor/PodmanMonitorStepForm.tsx",
    picker: "PodmanMonitor/PodmanTemplatePicker.tsx",
    configurationTitle: "Podman Monitor Configuration",
  },
  {
    name: "Docker Swarm",
    stepForm: "DockerSwarmMonitor/DockerSwarmMonitorStepForm.tsx",
    picker: "DockerSwarmMonitor/DockerSwarmTemplatePicker.tsx",
    configurationTitle: "Docker Swarm Monitor Configuration",
  },
  {
    name: "Kubernetes",
    stepForm: "KubernetesMonitor/KubernetesMonitorStepForm.tsx",
    picker: "KubernetesMonitor/KubernetesTemplatePicker.tsx",
    configurationTitle: "Kubernetes Monitor Configuration",
  },
  {
    name: "Proxmox",
    stepForm: "ProxmoxMonitor/ProxmoxMonitorStepForm.tsx",
    picker: "ProxmoxMonitor/ProxmoxTemplatePicker.tsx",
    configurationTitle: "Proxmox Monitor Configuration",
  },
  {
    name: "VMware",
    stepForm: "VMwareMonitor/VMwareMonitorStepForm.tsx",
    picker: "VMwareMonitor/VMwareTemplatePicker.tsx",
    configurationTitle: "VMware Monitor Configuration",
  },
  {
    name: "Ceph",
    stepForm: "CephMonitor/CephMonitorStepForm.tsx",
    picker: "CephMonitor/CephTemplatePicker.tsx",
    configurationTitle: "Ceph Monitor Configuration",
  },
  {
    name: "Storage Array",
    stepForm: "StorageArrayMonitor/StorageArrayMonitorStepForm.tsx",
    picker: "StorageArrayMonitor/StorageArrayTemplatePicker.tsx",
    configurationTitle: "Storage Array Monitor Configuration",
  },
  {
    name: "IoT",
    stepForm: "IoTMonitor/IoTMonitorStepForm.tsx",
    picker: "IoTMonitor/IoTTemplatePicker.tsx",
    configurationTitle: "IoT Monitor Configuration",
  },
];

describe("one shared template picker for every infrastructure type", () => {
  test.each(TYPES)(
    "$name's picker is the shared one",
    (type: InfrastructureType) => {
      const picker: string = flat(read(`${FORMS}/${type.picker}`));

      expect(picker).toContain("<AlertTemplatePicker<");
      expect(picker).toContain("templates={");
      expect(picker).toContain("onTemplateSelected={props.onTemplateSelected}");
      // What the picked template asks for goes through to the fold.
      expect(picker).toContain("children?: ReactNode | undefined;");
      expect(picker).toContain("{props.children} </AlertTemplatePicker>");

      // No hand-drawn cards, category blurbs or intro of its own.
      expect(picker).not.toContain('role="button"');
      expect(picker).not.toContain("cat.description");
      expect(picker).not.toContain("translateText(");
      expect(picker).not.toContain("template.description");
    },
  );

  test.each(TYPES)(
    "$name's step form hands the picker its Time Range, to sit under the picked template",
    (type: InfrastructureType) => {
      const form: string = flat(read(`${FORMS}/${type.stepForm}`));
      const pickerName: string = path.basename(type.picker, ".tsx");
      const opening: number = form.indexOf(`<${pickerName}`);
      const closing: number = form.indexOf(`</${pickerName}>`);
      const configuration: number = form.indexOf("<AlertTemplateConfiguration");

      // The picker's children: shown under the template once one is picked.
      expect(opening).toBeGreaterThan(-1);
      expect(configuration).toBeGreaterThan(opening);
      expect(closing).toBeGreaterThan(configuration);
      expect(form).toContain("onRollingTimeChange={");
      // The form no longer looks the template up to draw a panel of its own.
      expect(form).not.toContain("template={selectedTemplate}");
      expect(form).not.toContain("selectedTemplate &&");

      // The ten blue boxes are gone.
      expect(form).not.toMatch(/\b(?:bg|border|text)-blue-\d+/);
      expect(form).not.toContain("auto-configured");
      expect(form).not.toContain("Adjust the monitoring time range.");
    },
  );

  test.each(TYPES)(
    "$name's step form: a template pick and a Custom Metric pick clear each other",
    (type: InfrastructureType) => {
      const form: string = read(`${FORMS}/${type.stepForm}`);

      // A template replaces the metric: the Custom Metric tab's pick goes.
      expect(form).toMatch(TEMPLATE_PICK_CLEARS_METRIC);
      // A metric replaces the template's: Quick Setup's pick goes.
      expect(form).toMatch(METRIC_PICK_CLEARS_TEMPLATE);
    },
  );

  test.each(TYPES)(
    "$name's every Time Range says in one line what it is, the same on all three tabs",
    (type: InfrastructureType) => {
      const form: string = flat(read(`${FORMS}/${type.stepForm}`));
      const timeRanges: number = form.split('title="Time Range"').length - 1;

      // Custom Metric's and Advanced's; Quick Setup's is the shared field.
      expect(timeRanges).toBe(2);
      expect(
        form.split(
          `title="Time Range" description={"${ALERT_TEMPLATE_TIME_RANGE_DESCRIPTION}"}`,
        ).length - 1,
      ).toBe(timeRanges);
      expect(form).not.toContain("Select the time range for the");
    },
  );

  test.each(TYPES)(
    "$name's resource field does not repeat its title in a description",
    (type: InfrastructureType) => {
      const form: string = flat(read(`${FORMS}/${type.stepForm}`));

      expect(form).not.toMatch(
        /description=\{"Select the [^"]+ to monitor\."\}/,
      );
    },
  );

  test.each(TYPES)(
    "$name's metric fields carry no line that repeats them, and Aggregation says what it is",
    (type: InfrastructureType) => {
      const form: string = flat(read(`${FORMS}/${type.stepForm}`));
      const metricTitle: string | undefined = METRIC_FIELD_TITLES[type.name];

      expect(metricTitle).toBeDefined();
      // The metric picker shows its own grouping; the query builder is right there.
      expect(form).toContain(
        `<FieldLabelElement title="${metricTitle}" required={true} />`,
      );
      expect(form).toContain(
        '<FieldLabelElement title="Select Metrics" required={true} />',
      );
      expect(form).not.toContain("Metrics are organized by");
      expect(form).not.toContain("Use the query builder for full control");
      expect(form).not.toContain("metrics to monitor, with");

      expect(form).toContain(
        `title="Aggregation" description={ "${AGGREGATION_DESCRIPTION}" }`,
      );
      expect(form).not.toContain("How should the metric values");
    },
  );

  test.each(TYPES)(
    "$name's filter fields carry no line that says their label again",
    (type: InfrastructureType) => {
      const form: string = flat(read(`${FORMS}/${type.stepForm}`));

      // The label says the field's name and "(Optional)" already.
      expect(form).not.toMatch(
        /description=\{"Filter by [^"]+ \(optional\)\."\}/,
      );
    },
  );

  test("Kubernetes, Docker and Podman draw those filter fields with their label alone", () => {
    const kubernetes: string = flat(
      read(`${FORMS}/KubernetesMonitor/KubernetesMonitorStepForm.tsx`),
    );

    for (const title of [
      "Namespace",
      "Workload Name",
      "Node Name",
      "Pod Name",
    ]) {
      expect(kubernetes).toContain(
        `<FieldLabelElement title="${title}" required={false} />`,
      );
    }

    for (const stepForm of [
      "DockerMonitor/DockerMonitorStepForm.tsx",
      "PodmanMonitor/PodmanMonitorStepForm.tsx",
    ]) {
      const form: string = flat(read(`${FORMS}/${stepForm}`));

      for (const title of ["Container Name", "Container Image"]) {
        expect(form).toContain(
          `<FieldLabelElement title="${title}" required={false} />`,
        );
      }
    }
  });

  test("the shared components draw only the product's indigo", () => {
    for (const file of [
      "AlertTemplatePicker/AlertTemplatePicker.tsx",
      "AlertTemplatePicker/AlertTemplateConfiguration.tsx",
    ]) {
      const source: string = read(`${FORMS}/${file}`);

      expect(source).not.toMatch(/\b(?:bg|border|ring|text)-blue-\d+/);
    }
  });

  test("the picker is a radio group: one tab stop, rows that are radios", () => {
    const picker: string = flat(
      read(`${FORMS}/AlertTemplatePicker/AlertTemplatePicker.tsx`),
    );

    expect(picker).toContain('role="radiogroup"');
    expect(picker).toContain('role="radio"');
    expect(picker).toContain("aria-checked={isSelected}");
    expect(picker).toContain("tabIndex={template.id === tabStopId ? 0 : -1}");
    // Never the long description on a row: that is the picked template's.
    expect(picker).not.toContain("template.description");
    expect(picker).toContain("{template.summary}");
  });

  test("a pick folds the list into the picked template, as the monitor type picker does", () => {
    const picker: string = flat(
      read(`${FORMS}/AlertTemplatePicker/AlertTemplatePicker.tsx`),
    );

    expect(picker).toContain('data-testid="alert-template-picked"');
    expect(picker).toContain('data-testid="alert-template-change"');
    // Its full description waits behind Show more.
    expect(picker).toContain("{pickedTemplate.description}");
    expect(picker).toContain("aria-expanded={isDescriptionShown}");
    // What the template still asks for sits under it.
    expect(picker).toContain("{props.children}");
    // Picking the template already picked folds the list and nothing more.
    expect(picker).toContain("isNewAlertTemplatePick(");
    // Escape after Change keeps the pick.
    expect(picker).toContain('event.key === "Escape"');
  });

  test("the folded template reads like the monitor type's: the same frame and Change button", () => {
    const picker: string = read(
      `${FORMS}/AlertTemplatePicker/AlertTemplatePicker.tsx`,
    );
    const cardSelect: string = fs.readFileSync(
      path.join(APP_ROOT, "../Common/UI/Components/CardSelect/CardSelect.tsx"),
      "utf8",
    );

    for (const className of [
      "rounded-lg border border-indigo-200 bg-indigo-50/50 px-3 py-2.5",
      "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm",
    ]) {
      expect(cardSelect).toContain(className);
      expect(picker).toContain(className);
    }
  });
});

describe("the configuration cards say in one line what the tabs are for", () => {
  const monitorStep: string = flat(read(`${FORMS}/MonitorStep.tsx`));

  test.each(TYPES)("$name's configuration card", (type: InfrastructureType) => {
    const at: number = monitorStep.indexOf(
      `title="${type.configurationTitle}"`,
    );

    expect(at).toBeGreaterThan(-1);
    expect(monitorStep.slice(at, at + 200)).toContain(
      "description={INFRASTRUCTURE_MONITOR_CONFIGURATION_DESCRIPTION}",
    );
  });

  test("no card lists the tabs in a sentence any more", () => {
    expect(monitorStep).not.toContain(
      "using templates, curated metrics, or the advanced query builder",
    );
    expect(
      INFRASTRUCTURE_MONITOR_CONFIGURATION_DESCRIPTION.length,
    ).toBeLessThan(80);
  });
});

describe("grouping and keyboard rules (React-free)", () => {
  function template(id: string, category: string): AlertTemplatePickerTemplate {
    return {
      id,
      name: id,
      summary: `${id} fires.`,
      description: `${id} fires, in detail.`,
      severity: "Warning",
      category,
    };
  }

  const categories: Array<AlertTemplateCategory> = [
    { category: "B", label: "Bee", icon: IconProp.Cube },
    { category: "A", label: "Ay", icon: IconProp.Server },
  ];

  test("groups follow the heading order, each keeping the catalog's order", () => {
    const groups: Array<AlertTemplateGroup<AlertTemplatePickerTemplate>> =
      groupAlertTemplates(
        [template("a1", "A"), template("b1", "B"), template("a2", "A")],
        categories,
      );

    expect(
      groups.map(
        (group: AlertTemplateGroup<AlertTemplatePickerTemplate>): string => {
          return `${group.label}:${group.templates
            .map((item: AlertTemplatePickerTemplate): string => {
              return item.id;
            })
            .join(",")}`;
        },
      ),
    ).toEqual(["Bee:b1", "Ay:a1,a2"]);
  });

  test("a heading with no templates is not drawn", () => {
    expect(
      groupAlertTemplates([template("a1", "A")], categories).map(
        (group: AlertTemplateGroup<AlertTemplatePickerTemplate>) => {
          return group.category;
        },
      ),
    ).toEqual(["A"]);
  });

  test("a template whose category has no heading is still offered, last", () => {
    const groups: Array<AlertTemplateGroup<AlertTemplatePickerTemplate>> =
      groupAlertTemplates(
        [template("z1", "Z"), template("a1", "A"), template("z2", "Z")],
        categories,
      );

    expect(
      getAlertTemplatesInDrawnOrder(groups).map(
        (item: AlertTemplatePickerTemplate): string => {
          return item.id;
        },
      ),
    ).toEqual(["a1", "z1", "z2"]);
    expect(groups[groups.length - 1]!.label).toBe("Z");
    expect(groups[groups.length - 1]!.icon).toBeUndefined();
  });

  test("without headings the list is flat, in the catalog's order", () => {
    const groups: Array<AlertTemplateGroup<AlertTemplatePickerTemplate>> =
      groupAlertTemplates([template("x", "A"), template("y", "B")]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBeUndefined();
    expect(groupAlertTemplates([])).toEqual([]);
  });

  test("the tab stop is the picked template when listed, else the first", () => {
    expect(
      getAlertTemplateTabStopId({
        templateIds: ["a", "b", "c"],
        selectedTemplateId: "b",
      }),
    ).toBe("b");
    expect(
      getAlertTemplateTabStopId({
        templateIds: ["a", "b", "c"],
        selectedTemplateId: "gone",
      }),
    ).toBe("a");
    expect(
      getAlertTemplateTabStopId({
        templateIds: ["a", "b"],
        selectedTemplateId: undefined,
      }),
    ).toBe("a");
    expect(
      getAlertTemplateTabStopId({ templateIds: [], selectedTemplateId: "a" }),
    ).toBeUndefined();
  });

  test("arrows step and clamp; Home and End jump; other keys do nothing", () => {
    const ids: Array<string> = ["a", "b", "c"];
    const after: (from: string, key: string) => string | undefined = (
      from: string,
      key: string,
    ): string | undefined => {
      return getAlertTemplateIdAfterKey({
        templateIds: ids,
        fromTemplateId: from,
        key,
      });
    };

    expect(after("a", "ArrowDown")).toBe("b");
    expect(after("a", "ArrowRight")).toBe("b");
    expect(after("c", "ArrowDown")).toBe("c");
    expect(after("b", "ArrowUp")).toBe("a");
    expect(after("a", "ArrowLeft")).toBe("a");
    expect(after("b", "Home")).toBe("a");
    expect(after("a", "End")).toBe("c");
    expect(after("a", "Tab")).toBeUndefined();
    expect(after("gone", "ArrowDown")).toBeUndefined();
  });

  test("only Critical reads as critical", () => {
    expect(isCriticalAlertTemplate({ severity: "Critical" })).toBe(true);
    expect(isCriticalAlertTemplate({ severity: "Warning" })).toBe(false);
  });

  test("the picked template is the listed one with the picked id, if any", () => {
    const listed: Array<AlertTemplatePickerTemplate> = [
      template("a", "A"),
      template("b", "B"),
    ];

    expect(getPickedAlertTemplate(listed, "b")?.id).toBe("b");
    // Not offered (another platform's): nothing to fold into.
    expect(getPickedAlertTemplate(listed, "gone")).toBeUndefined();
    expect(getPickedAlertTemplate(listed, undefined)).toBeUndefined();
    expect(getPickedAlertTemplate([], "a")).toBeUndefined();
  });

  test("only a different template is a new pick: the one already picked keeps the criteria", () => {
    expect(
      isNewAlertTemplatePick({
        templateId: "a",
        selectedTemplateId: undefined,
      }),
    ).toBe(true);
    expect(
      isNewAlertTemplatePick({ templateId: "a", selectedTemplateId: "b" }),
    ).toBe(true);
    expect(
      isNewAlertTemplatePick({ templateId: "a", selectedTemplateId: "a" }),
    ).toBe(false);
  });

  test("Show more only when the description says more than the summary", () => {
    expect(
      hasAlertTemplateDetails({
        summary: "It fires.",
        description: "It fires, when the metric says so.",
      }),
    ).toBe(true);
    expect(
      hasAlertTemplateDetails({
        summary: "It fires.",
        description: " It fires. ",
      }),
    ).toBe(false);
    expect(
      hasAlertTemplateDetails({ summary: "It fires.", description: "  " }),
    ).toBe(false);
  });
});

describe("a resource's Recommendations use the picker's category names", () => {
  test.each([
    [
      MonitorRecommendationResourceType.Kubernetes,
      "ControlPlane",
      "Control Plane",
    ],
    [MonitorRecommendationResourceType.Ceph, "PG", "Placement Groups"],
    [MonitorRecommendationResourceType.Proxmox, "HA", "High Availability"],
    [MonitorRecommendationResourceType.VMware, "Host", "ESXi Host"],
  ])(
    "%s %s reads %s",
    (
      resourceType: MonitorRecommendationResourceType,
      category: string,
      label: string,
    ) => {
      expect(getAlertTemplateCategoryLabel(resourceType, category)).toBe(label);
    },
  );

  test("a type or category without a heading has no label", () => {
    expect(
      getAlertTemplateCategoryLabel(
        MonitorRecommendationResourceType.Service,
        "Latency",
      ),
    ).toBeUndefined();
    expect(
      getAlertTemplateCategoryLabel(
        MonitorRecommendationResourceType.Kubernetes,
        "Nope",
      ),
    ).toBeUndefined();
  });

  test.each(
    Object.keys(
      ALERT_TEMPLATE_CATEGORIES_BY_RESOURCE_TYPE,
    ) as Array<MonitorRecommendationResourceType>,
  )(
    "every %s recommendation category has a heading",
    (resourceType: MonitorRecommendationResourceType) => {
      for (const category of new Set(
        MonitorRecommendationCatalog.getAllPossibleRecommendations(
          resourceType,
        ).map((recommendation: { category: string }): string => {
          return recommendation.category;
        }),
      )) {
        expect({
          resourceType,
          category,
          label: getAlertTemplateCategoryLabel(resourceType, category)
            ? "named"
            : "missing",
        }).toEqual({ resourceType, category, label: "named" });
      }
    },
  );

  test("Kubernetes Recommendations come in Quick Setup's order, not the catalog's", () => {
    const catalogOrder: Array<string> =
      MonitorRecommendationCatalog.getCategories(
        MonitorRecommendationResourceType.Kubernetes,
      );
    const pickerOrder: Array<string> = KUBERNETES_TEMPLATE_CATEGORIES.map(
      (category: AlertTemplateCategory): string => {
        return category.category;
      },
    );

    // The catalog meets Scheduling second (Pod Stuck in Pending); the picker lists it last.
    expect(catalogOrder).not.toEqual(pickerOrder);
    /*
     * Then Events: the warning events alert is a Logs monitor
     * (KubernetesEventAlertTemplates), which a Kubernetes monitor's Quick
     * Setup cannot build, so only Recommendations list it - last.
     */
    expect(
      orderAlertTemplateCategories(
        MonitorRecommendationResourceType.Kubernetes,
        catalogOrder,
      ),
    ).toEqual([...pickerOrder, "Events"]);
  });

  test("Kubernetes Recommendations name Quick Setup's headings, then Events, and Quick Setup never lists Events", () => {
    expect(
      KUBERNETES_RECOMMENDATION_CATEGORIES.map(
        (category: { category: string }): string => {
          return category.category;
        },
      ),
    ).toEqual([
      ...KUBERNETES_TEMPLATE_CATEGORIES.map(
        (category: { category: string }): string => {
          return category.category;
        },
      ),
      "Events",
    ]);
    expect(
      ALERT_TEMPLATE_CATEGORIES_BY_RESOURCE_TYPE[
        MonitorRecommendationResourceType.Kubernetes
      ],
    ).toBe(KUBERNETES_RECOMMENDATION_CATEGORIES);
    expect(
      getAlertTemplateCategoryLabel(
        MonitorRecommendationResourceType.Kubernetes,
        "Events",
      ),
    ).toBe("Events");
    expect(
      KUBERNETES_TEMPLATE_CATEGORIES.some(
        (category: { category: string }): boolean => {
          return category.category === "Events";
        },
      ),
    ).toBe(false);
  });

  test.each(
    Object.keys(
      ALERT_TEMPLATE_CATEGORIES_BY_RESOURCE_TYPE,
    ) as Array<MonitorRecommendationResourceType>,
  )(
    "%s Recommendations list every catalog category once, in the picker's order",
    (resourceType: MonitorRecommendationResourceType) => {
      const catalogOrder: Array<string> =
        MonitorRecommendationCatalog.getCategories(resourceType);
      const ordered: Array<string> = orderAlertTemplateCategories(
        resourceType,
        catalogOrder,
      );
      const pickerOrder: Array<string> = (
        ALERT_TEMPLATE_CATEGORIES_BY_RESOURCE_TYPE[resourceType] || []
      )
        .map((category: AlertTemplateCategory): string => {
          return category.category;
        })
        .filter((category: string): boolean => {
          return catalogOrder.includes(category);
        });

      expect([...ordered].sort()).toEqual([...catalogOrder].sort());
      expect(ordered.slice(0, pickerOrder.length)).toEqual(pickerOrder);
    },
  );

  test("a category the picker names no heading for is kept, after the named ones", () => {
    expect(
      orderAlertTemplateCategories(
        MonitorRecommendationResourceType.Kubernetes,
        ["Brand New", "Storage", "Workload"],
      ),
    ).toEqual(["Workload", "Storage", "Brand New"]);
  });

  test("a type without headings keeps the catalog's order", () => {
    const categories: Array<string> = ["Latency", "Errors", "Throughput"];
    const ordered: Array<string> = orderAlertTemplateCategories(
      MonitorRecommendationResourceType.Service,
      categories,
    );

    expect(ordered).toEqual(categories);
    // A copy: the page's list is never the catalog's own array.
    expect(ordered).not.toBe(categories);
  });

  test("the page orders the catalog's categories that way", () => {
    const page: string = flat(
      read("Components/Recommendations/MonitorRecommendations.tsx"),
    );

    expect(page).toContain(
      "const categories: Array<string> = orderAlertTemplateCategories( props.resourceType, MonitorRecommendationCatalog.getCategories( props.resourceType, props.resourceContext, ), );",
    );
  });

  test("the list reads the label and translates it", () => {
    const list: string = flat(
      read("Components/Recommendations/RecommendationsList.tsx"),
    );

    expect(list).toContain("getAlertTemplateCategoryLabel(");
    expect(list).toContain("translator.translateText(categoryLabel)");
  });
});

describe("the words, in every language", () => {
  type Locale = Record<string, unknown>;

  const locales: Record<string, Locale> = {};

  for (const file of fs.readdirSync(LOCALES_DIR).sort()) {
    if (file.endsWith(".json")) {
      locales[file.replace(/\.json$/, "")] = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      ) as Locale;
    }
  }

  const NON_ENGLISH: Array<string> = Object.keys(locales).filter(
    (code: string): boolean => {
      return code !== "en";
    },
  );

  const ADDED: Array<string> = [
    ALERT_TEMPLATE_PICKER_INTRO,
    ALERT_TEMPLATE_PICKER_ARIA_LABEL,
    INFRASTRUCTURE_MONITOR_CONFIGURATION_DESCRIPTION,
    "Its platform decides which metrics and templates are offered.",
    // The fold reuses words the Dashboard already has, in every language.
    ALERT_TEMPLATE_PICKED_LABEL,
    ALERT_TEMPLATE_CHANGE,
    ALERT_TEMPLATE_SHOW_MORE,
    ALERT_TEMPLATE_SHOW_LESS,
    ALERT_TEMPLATE_TIME_RANGE,
    ALERT_TEMPLATE_TIME_RANGE_DESCRIPTION,
    // Aggregation's sentence keeps the translations of the question it replaced.
    AGGREGATION_DESCRIPTION,
  ];

  test("there are sixteen languages besides English", () => {
    expect(NON_ENGLISH).toHaveLength(16);
  });

  test.each(ADDED)(
    "%s is in English and translated in every language",
    (key: string) => {
      expect(locales["en"]![key]).toBe(key);

      for (const code of NON_ENGLISH) {
        const value: unknown = locales[code]![key];

        expect({
          code,
          translated: typeof value === "string" && value !== key,
        }).toEqual({ code, translated: true });
      }
    },
  );

  test("Spanish speaks to the reader as tú", () => {
    expect(locales["es"]![ALERT_TEMPLATE_PICKER_INTRO]).toContain("Elige");
    expect(
      locales["es"]![INFRASTRUCTURE_MONITOR_CONFIGURATION_DESCRIPTION],
    ).toContain("Empieza");
  });

  const RETIRED: Array<string> = [
    // The panel's heading: the folded template names itself.
    "Template Configuration",
    "The following settings have been auto-configured. You can adjust the time range below.",
    "Adjust the monitoring time range.",
    "Select a pre-built alert template to quickly set up monitoring. The template will auto-configure the metric, scope, aggregation, time range, and thresholds.",
    "Select a pre-built alert template to quickly set up host monitoring. The template will auto-configure the metric, aggregation, time range, and thresholds.",
    "Monitor workload health including pod restarts, replica mismatches, and job failures.",
    "Configure your Kubernetes cluster monitoring using templates, curated metrics, or the advanced query builder.",
    "Configure your host monitoring using templates, curated metrics, or the advanced query builder.",
    "Select the Kubernetes cluster to monitor.",
    "Select the host to monitor.",
    "Select the storage array to monitor. Its platform decides which metrics and templates are offered.",
    // The Custom Metric and Advanced tabs' Time Range: now the line Quick Setup's says.
    "Select the time range for the host monitor.",
    "Select the time range for the Docker monitor.",
    "Select the time range for the Podman monitor.",
    "Select the time range for the Docker Swarm monitor.",
    "Select the time range for the Kubernetes monitor.",
    "Select the time range for the Proxmox monitor.",
    "Select the time range for the VMware monitor.",
    "Select the time range for the Ceph monitor.",
    "Select the time range for the storage array monitor.",
    "Select the time range for the IoT monitor.",
    // Aggregation's question, now a sentence.
    "How should the metric values be aggregated over the time range.",
    // The metric fields' lines that said their title again.
    "Select a Ceph metric to monitor. Metrics are organized by resource type.",
    "Select a Docker metric to monitor. Metrics are organized by resource type.",
    "Select a Docker Swarm metric to monitor. Metrics are organized by category.",
    "Select a host metric to monitor. Metrics are organized by resource type.",
    "Select an IoT metric to monitor. Metrics are organized by category.",
    "Select a Kubernetes metric to monitor. Metrics are organized by resource type.",
    "Select a Podman metric to monitor. Metrics are organized by resource type.",
    "Select a Proxmox metric to monitor. Metrics are organized by resource type.",
    "A metric the array exports, grouped by what it describes.",
    "A vCenter metric, grouped by vSphere object.",
    "Select the Ceph metrics to monitor. Use the query builder for full control over metric selection and filtering.",
    "Select the Docker metrics to monitor. Use the query builder for full control over metric selection and filtering.",
    "Select the Docker Swarm metrics to monitor. Use the query builder for full control over metric selection and filtering.",
    "Select the host metrics to monitor. Use the query builder for full control over metric selection and filtering.",
    "Select the IoT metrics to monitor. Use the query builder for full control over metric selection and filtering.",
    "Select the Kubernetes metrics to monitor. Use the query builder for full control over metric selection and filtering.",
    "Select the Podman metrics to monitor. Use the query builder for full control over metric selection and filtering.",
    "Select the Proxmox metrics to monitor. Use the query builder for full control over metric selection and filtering.",
    "The array metrics to monitor, with label filters and grouping.",
    "The vCenter metrics to monitor, with attribute filters and grouping.",
    // The filter fields' lines that said their label again.
    "Filter by namespace (optional).",
    "Filter by workload name (optional).",
    "Filter by node name (optional).",
    "Filter by pod name (optional).",
    "Filter by container name (optional).",
    "Filter by container image (optional).",
  ];

  test.each(RETIRED)("%s is in no language any more", (key: string) => {
    for (const code of Object.keys(locales)) {
      expect({ code, present: key in locales[code]! }).toEqual({
        code,
        present: false,
      });
    }
  });
});
