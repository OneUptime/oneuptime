import CriteriaFilterUtil from "../../../FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import { DocsHeading, readPage, scanMarkdown } from "./DocsContentSupport";
import { describe, expect, it } from "@jest/globals";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "Common/Types/Monitor/CriteriaFilter";
import {
  IoTAlertTemplate,
  getAllIoTAlertTemplates,
} from "Common/Types/Monitor/IotAlertTemplates";
import {
  IoTMetricDefinition,
  getAllIoTMetrics,
} from "Common/Types/Monitor/IotMetricCatalog";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepIoTMonitorUtil } from "Common/Types/Monitor/MonitorStepIoTMonitor";
import { MonitorStepStorageArrayMonitorUtil } from "Common/Types/Monitor/MonitorStepStorageArrayMonitor";
import { MonitorStepVMwareMonitorUtil } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import MonitorType, {
  MonitorTypeCategory,
  MonitorTypeHelper,
  MonitorTypeProps,
} from "Common/Types/Monitor/MonitorType";
import { getStorageArrayMetric } from "Common/Types/Monitor/StorageArrayMetricCatalog";
import {
  VMwareAlertTemplate,
  getAllVMwareAlertTemplates,
} from "Common/Types/Monitor/VMwareAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import { DEFAULT_VMWARE_COLLECTION_INTERVAL_IN_MINUTES } from "Common/Utils/VMware/VMwareCollectionSettings";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import fs from "fs";
import path from "path";

/*
 * What the English Storage Array, IoT Device and VMware monitor pages say
 * about the product, held to the code that makes it true (docs overhaul
 * task 17a):
 *
 *   - the create steps against the type picker and the step forms: the
 *     type's title and category, the search word, the configuration card,
 *     the fields, tabs and aggregations, and the window a new monitor starts
 *     with;
 *   - the IoT and VMware template tables (what each template watches, when
 *     it fires and when it recovers) against the monitors the templates
 *     build, and the IoT metric table against its catalog (StorageArrayDocs
 *     and VMwareDocs hold the storage tables and the VMware catalog);
 *   - the criteria and the default criteria against the criteria form;
 *   - the Products menu paths, the Recommendations pages and the Terraform
 *     attributes.
 *
 * TemplatingAndAgentMonitorDocsTranslations then holds the 16 translations
 * to the English pages.
 */

const STORAGE: string = "monitor/storage-array-monitor";
const IOT: string = "monitor/iot-device-monitor";
const VMWARE: string = "monitor/vmware-monitor";
const PAGES: Array<string> = [STORAGE, IOT, VMWARE];

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const DASHBOARD_SRC: string = "packages/App/FeatureSet/Dashboard/src";
const FORMS: string = `${DASHBOARD_SRC}/Components/Form/Monitor`;

const TABLE_DELIMITER_ROW: RegExp = /^\|\s*:?-/;
const INLINE_CODE: RegExp = /`([^`\n]+)`/;
const AGGREGATION_LABEL: RegExp =
  /\{ label: "([^"]+)", value: MetricsAggregationType\.\w+ \}/g;
const TAB_NAME: RegExp = /name: "([^"]+)",\n\s+children: render/g;

const IDS: {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
} = {
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
};

function englishPage(page: string): string {
  return readPage("en", page);
}

function source(relativeToRepo: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativeToRepo), "utf8");
}

/*
 * The text under a heading, up to the next heading of the same or a higher
 * level. A "#" line in a code sample is the sample's.
 */
function sectionOf(page: string, heading: string): string {
  const markdown: string = englishPage(page);
  const lines: Array<string> = markdown.split("\n");
  const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
  const level: number = heading.indexOf(" ");
  const start: DocsHeading | undefined = headings.find(
    (candidate: DocsHeading): boolean => {
      return (
        candidate.level === level &&
        `${"#".repeat(level)} ${candidate.text}` === heading
      );
    },
  );

  expect({ page, heading, found: Boolean(start) }).toEqual({
    page,
    heading,
    found: true,
  });

  const end: DocsHeading | undefined = headings.find(
    (candidate: DocsHeading): boolean => {
      return candidate.line > start!.line && candidate.level <= level;
    },
  );

  return lines.slice(start!.line, end ? end.line - 1 : undefined).join("\n");
}

// The body rows of the first table in a text, as trimmed cells.
function tableBody(text: string): Array<Array<string>> {
  const rows: Array<Array<string>> = [];
  let started: boolean = false;

  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) {
      if (started) {
        break;
      }
      continue;
    }

    started = true;

    if (TABLE_DELIMITER_ROW.test(line)) {
      continue;
    }

    rows.push(
      line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        }),
    );
  }

  return rows.slice(1);
}

function monitorTypeProps(monitorType: MonitorType): MonitorTypeProps {
  return MonitorTypeHelper.getAllMonitorTypeProps().find(
    (props: MonitorTypeProps): boolean => {
      return props.monitorType === monitorType;
    },
  ) as MonitorTypeProps;
}

function primary(instance: MonitorCriteriaInstance): CriteriaFilter {
  return instance.data!.filters[0] as CriteriaFilter;
}

interface CreateFacts {
  page: string;
  monitorType: MonitorType;
  pickerTitle: string;
  searchWord: string;
  form: string;
  configurationTitle: string;
  resourceField: string;
  metricField: string;
  defaultWindow: RollingTime;
  // The resource's view side menu, and its Products menu title key and list.
  folder: string;
  productsTitleKey: string;
  product: string;
  list: string;
  terraform: { attribute: string; stepKey: string; identifier: string };
}

const CREATE_FACTS: Array<CreateFacts> = [
  {
    page: STORAGE,
    monitorType: MonitorType.StorageArray,
    pickerTitle: "Storage Array",
    searchWord: "storage",
    form: "StorageArrayMonitor/StorageArrayMonitorStepForm.tsx",
    configurationTitle: "Storage Array Monitor Configuration",
    resourceField: "Storage Array",
    metricField: "Storage Array Metric",
    defaultWindow: RollingTime.Past5Minutes,
    folder: "StorageArray",
    productsTitleKey: "storageArraysTitle",
    product: "Storage Arrays",
    list: "All Storage Arrays",
    terraform: {
      attribute: "storage_array_monitor",
      stepKey: "storageArrayMonitor",
      identifier: "arrayIdentifier",
    },
  },
  {
    page: IOT,
    monitorType: MonitorType.IoTDevice,
    pickerTitle: "IoT Device",
    searchWord: "iot",
    form: "IoTMonitor/IoTMonitorStepForm.tsx",
    configurationTitle: "IoT Monitor Configuration",
    resourceField: "IoT Fleet",
    metricField: "IoT Metric",
    defaultWindow: RollingTime.Past1Minute,
    folder: "IoT",
    productsTitleKey: "iotTitle",
    product: "IoT",
    list: "All Fleets",
    terraform: {
      attribute: "iot_monitor",
      stepKey: "iotMonitor",
      identifier: "fleetIdentifier",
    },
  },
  {
    page: VMWARE,
    monitorType: MonitorType.VMware,
    pickerTitle: "VMware",
    searchWord: "vmware",
    form: "VMwareMonitor/VMwareMonitorStepForm.tsx",
    configurationTitle: "VMware Monitor Configuration",
    resourceField: "vCenter",
    metricField: "VMware Metric",
    defaultWindow: RollingTime.Past5Minutes,
    folder: "VMware",
    productsTitleKey: "vmwareTitle",
    product: "VMware",
    list: "All vCenters",
    terraform: {
      attribute: "vmware_monitor",
      stepKey: "vmwareMonitor",
      identifier: "vcenterIdentifier",
    },
  },
];

const DEFAULT_CONFIGS: Record<string, { rollingTime: RollingTime }> = {
  [STORAGE]: MonitorStepStorageArrayMonitorUtil.getDefault(),
  [IOT]: MonitorStepIoTMonitorUtil.getDefault(),
  [VMWARE]: MonitorStepVMwareMonitorUtil.getDefault(),
};

describe("creating a storage array, IoT device or VMware monitor", () => {
  const infrastructure: MonitorTypeCategory =
    MonitorTypeHelper.getMonitorTypeCategories().find(
      (category: MonitorTypeCategory): boolean => {
        return category.label === "Infrastructure";
      },
    ) as MonitorTypeCategory;
  const monitorStepForm: string = source(`${FORMS}/MonitorStep.tsx`);

  it.each(CREATE_FACTS)("$page is titled as its nav link", (facts: CreateFacts) => {
    const titles: Record<string, string> = {
      [STORAGE]: "Storage Array Monitor",
      [IOT]: "IoT Device Monitor",
      [VMWARE]: "VMware Monitor",
    };

    expect(englishPage(facts.page).split("\n")[0]).toBe(
      `# ${titles[facts.page]}`,
    );
    expect(source("packages/App/FeatureSet/Docs/Utils/Nav.ts")).toContain(
      `title: "${titles[facts.page]}",\n        url: "/docs/${facts.page}",`,
    );
  });

  it.each(CREATE_FACTS)(
    "$page picks $pickerTitle under Infrastructure, behind More monitor types, or by its search word",
    (facts: CreateFacts) => {
      const props: MonitorTypeProps = monitorTypeProps(facts.monitorType);
      const searchable: string = [props.title, ...props.keywords]
        .join(" ")
        .toLowerCase();

      expect(infrastructure.monitorTypes).toContain(facts.monitorType);
      expect(MonitorTypeHelper.getCommonMonitorTypes()).not.toContain(
        facts.monitorType,
      );
      expect(props.title).toBe(facts.pickerTitle);
      expect(searchable).toContain(facts.searchWord);
      expect(englishPage(facts.page)).toContain(
        `click **More monitor types** and pick **${facts.pickerTitle}** under **Infrastructure**, or type \`${facts.searchWord}\` in the search box.`,
      );
    },
  );

  it.each(CREATE_FACTS)(
    "$page names the configuration card, resource field, metric field and tabs as the form draws them",
    (facts: CreateFacts) => {
      const form: string = source(`${FORMS}/${facts.form}`);
      const page: string = englishPage(facts.page);
      const tabs: Array<string> = Array.from(form.matchAll(TAB_NAME)).map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      );

      expect(monitorStepForm).toContain(`title="${facts.configurationTitle}"`);
      expect(page).toContain(`Under **${facts.configurationTitle}**, pick the`);
      expect(form).toContain(`title="${facts.resourceField}"`);
      expect(page).toContain(`from **${facts.resourceField}**.`);
      expect(form).toContain(`title="${facts.metricField}"`);
      expect(page).toContain(`| **${facts.metricField}** | Custom Metric |`);
      expect(tabs).toEqual(["Quick Setup", "Custom Metric", "Advanced"]);
      expect(page).toContain("Pick one of the three tabs:");
      expect(form).toContain('title="Time Range"');
      expect(form).toContain('title="Select Metrics"');
      expect(form).toContain(
        "The following settings have been auto-configured. You can adjust the time range below.",
      );
      expect(page).toContain("You can still change the **Time Range**.");
    },
  );

  it.each(CREATE_FACTS)(
    "$page lists the aggregations the Custom Metric tab offers",
    (facts: CreateFacts) => {
      const labels: Array<string> = Array.from(
        source(`${FORMS}/${facts.form}`).matchAll(AGGREGATION_LABEL),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect(labels).toEqual(["Average", "Maximum", "Minimum", "Sum", "Count"]);
      expect(englishPage(facts.page)).toContain(
        "How samples are combined: **Average**, **Maximum**, **Minimum**, **Sum** or **Count**. Starts at the metric's usual aggregation.",
      );
    },
  );

  it.each(CREATE_FACTS)(
    "$page says which window a new monitor starts with",
    (facts: CreateFacts) => {
      expect(DEFAULT_CONFIGS[facts.page]!.rollingTime).toBe(facts.defaultWindow);
      expect(englishPage(facts.page)).toContain(
        `The rolling window the query reads, from **Past 1 Minute** to **Past 365 Days**. A new monitor starts at **${facts.defaultWindow}**`,
      );

      const windows: Array<string> = Object.values(RollingTime);

      expect(windows[0]).toBe("Past 1 Minute");
      expect(windows[windows.length - 1]).toBe("Past 365 Days");
    },
  );

  it.each(CREATE_FACTS)(
    "$page: the monitor is checked every minute, with the other telemetry monitors",
    (facts: CreateFacts) => {
      expect(
        source(
          "packages/App/FeatureSet/Workers/Jobs/TelemetryMonitor/ScheduleTelemetryMonitorEvaluations.ts",
        ),
      ).toContain("{ schedule: EVERY_MINUTE, runOnStartup: false }");
      expect(
        source(
          "packages/App/FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts",
        ),
      ).toContain(`          MonitorType.${facts.monitorType === MonitorType.IoTDevice ? "IoTDevice" : facts.monitorType === MonitorType.StorageArray ? "StorageArray" : "VMware"},\n`);
      // Created on the create page, a monitor of these types has no interval of its own.
      expect(MonitorTypeHelper.doesMonitorTypeHaveInterval(facts.monitorType)).toBe(
        false,
      );
      expect(englishPage(facts.page)).toContain(
        "Every minute it runs its query over that",
      );
    },
  );

  it.each(CREATE_FACTS)(
    "$page: the Products menu path, the list and the Recommendations page are the product's own",
    (facts: CreateFacts) => {
      const navigation: string = source(
        `${DASHBOARD_SRC}/Utils/NavigationItems.tsx`,
      );
      const at: number = navigation.indexOf(
        `t("navbar.items.${facts.productsTitleKey}", "${facts.product}")`,
      );
      const category: RegExpMatchArray | null = navigation
        .slice(at)
        .match(/category: (\w+),/);

      expect(at).toBeGreaterThan(0);
      expect(category?.[1]).toBe("infrastructureCategory");
      expect(
        source(`${DASHBOARD_SRC}/Pages/${facts.folder}/SideMenu.tsx`),
      ).toContain(`title: "${facts.list}"`);
      expect(
        source(`${DASHBOARD_SRC}/Pages/${facts.folder}/View/SideMenu.tsx`),
      ).toContain('title: "Recommendations"');

      const page: string = englishPage(facts.page);

      expect(page).toContain(
        `**Products → Infrastructure → ${facts.product} → ${facts.list}**`,
      );
      expect(page).toContain(
        `open the ${facts.page === VMWARE ? "vCenter" : facts.page === IOT ? "fleet" : "array"} from **Products → Infrastructure → ${facts.product}** and go to **Recommendations**.`,
      );
    },
  );

  it.each(CREATE_FACTS)(
    "$page: Terraform carries the step in the attribute the provider registers, with the step's own fields",
    (facts: CreateFacts) => {
      const steps: string = source(
        "Scripts/TerraformProvider/StaticFiles/monitorsteps.go",
      );
      const page: string = englishPage(facts.page);
      const hcl: string = sectionOf(facts.page, "## Terraform");

      expect(steps).toContain(
        `{"${facts.terraform.attribute}", "${facts.terraform.stepKey}"},`,
      );
      expect(page).toContain(`\`${facts.terraform.attribute}\` attribute`);
      expect(page).toContain(`\`${facts.terraform.stepKey}\` configuration`);
      expect(hcl).toContain(`${facts.terraform.attribute} = jsonencode({`);

      const step: MonitorStep = new MonitorStep();

      expect(Object.keys(step.data || {})).toContain(facts.terraform.stepKey);

      // Every field the HCL sets is a field of the step's configuration.
      const config: Record<string, unknown> = DEFAULT_CONFIGS[
        facts.page
      ] as unknown as Record<string, unknown>;

      for (const field of Object.keys(config)) {
        if (field === "storageSystem") {
          continue;
        }

        expect({ field, set: hcl.includes(`${field}`) }).toEqual({
          field,
          set: true,
        });
      }

      const window: RegExpMatchArray = hcl.match(
        /rollingTime\s+= "([^"]+)"/,
      ) as RegExpMatchArray;

      expect(Object.values(RollingTime)).toContain(window[1]);

      const aggregation: RegExpMatchArray = hcl.match(
        /aggegationType = "([^"]+)"/,
      ) as RegExpMatchArray;

      expect(Object.values(MetricsAggregationType)).toContain(aggregation[1]);
    },
  );
});

describe("the criteria of these monitors", () => {
  const criteriaForm: string = source(`${FORMS}/CriteriaFilter.tsx`);
  // The Proxmox page's criteria table, which InfrastructureMonitorDocsFacts holds to the form.
  const proxmoxRows: Array<Array<string>> = tableBody(
    readPage("en", "monitor/proxmox-monitor").slice(
      readPage("en", "monitor/proxmox-monitor").indexOf(
        "## Monitoring criteria",
      ),
    ),
  );

  it("check only the metric value; the storage array and VMware forms hide the Filter Type", () => {
    for (const monitorType of [
      MonitorType.StorageArray,
      MonitorType.IoTDevice,
      MonitorType.VMware,
    ]) {
      expect(
        CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType).map(
          (option: DropdownOption): string => {
            return String(option.value);
          },
        ),
      ).toEqual([CheckOn.MetricValue]);
      expect(CriteriaFilterUtil.getDefaultCheckOnByMonitorType(monitorType)).toBe(
        CheckOn.MetricValue,
      );
    }

    /*
     * An IoT device monitor is not one of the metric-only types, so its
     * criteria show the Filter Type, with Metric Value alone in it, and the
     * metric field under its general title.
     */
    expect(
      CriteriaFilterUtil.isMetricOnlyMonitorType(MonitorType.StorageArray),
    ).toBe(true);
    expect(CriteriaFilterUtil.isMetricOnlyMonitorType(MonitorType.VMware)).toBe(
      true,
    );
    expect(
      CriteriaFilterUtil.isMetricOnlyMonitorType(MonitorType.IoTDevice),
    ).toBe(false);
    expect(criteriaForm).toContain("{!isMetricOnly && (");
    expect(criteriaForm).toContain('<FieldLabelElement title="Filter Type" />');
    expect(criteriaForm).toContain(
      'title={isMetricOnly ? "Metric" : "Select Metric Variable"}',
    );
    expect(CheckOn.MetricValue).toBe("Metric Value");

    for (const page of [STORAGE, VMWARE]) {
      expect(englishPage(page)).toContain(
        "criteria have no **Filter Type**: every rule checks the metric value, with these fields.",
      );
    }

    expect(englishPage(IOT)).toContain(
      "An IoT device monitor's criteria offer one **Filter Type**, **Metric Value**: every rule checks the metric value, with these fields.",
    );
  });

  it.each(PAGES)(
    "%s describes the criteria fields as the Proxmox page does",
    (page: string) => {
      const all: Array<Array<string>> = tableBody(
        sectionOf(page, "## Monitoring criteria"),
      );
      // The IoT form draws the Filter Type, and the metric field under its general title.
      const rows: Array<Array<string>> =
        page === IOT ? [["**Metric**"], ...all.slice(2)] : all;

      if (page === IOT) {
        expect(all.slice(0, 2)).toEqual([
          [
            "**Filter Type**",
            "Always **Metric Value**, the only check this monitor offers.",
          ],
          [
            "**Select Metric Variable**",
            "The query or formula to check, by its variable name.",
          ],
        ]);
      }

      expect(rows.map((row: Array<string>) => {
        return row[0];
      })).toEqual(
        proxmoxRows.map((row: Array<string>) => {
          return row[0];
        }),
      );

      for (const row of rows.slice(page === IOT ? 1 : 0)) {
        // The IoT page says what each If No Data choice does to one series.
        if (page === IOT && row[0] === "**If No Data**") {
          continue;
        }

        expect(row).toEqual(
          proxmoxRows.find((proxmox: Array<string>): boolean => {
            return proxmox[0] === row[0];
          }),
        );
      }
    },
  );

  it("the IoT page's If No Data choices are the form's, Ignore first", () => {
    expect(Object.values(NoDataPolicy).sort()).toEqual(
      ["Ignore", "Treat As Zero", "Trigger"].sort(),
    );
    expect(criteriaForm).toContain('title="If No Data"');
    expect(englishPage(IOT)).toContain(
      "| **If No Data** | Under **More fields**. What happens when a series has no samples in the window: **Ignore** (the default) skips it, **Treat As Zero** reads it as `0`, and **Trigger** makes the criteria match. |",
    );
  });

  it.each([
    [STORAGE, MonitorType.StorageArray],
    [IOT, MonitorType.IoTDevice],
    [VMWARE, MonitorType.VMware],
  ])(
    "%s states the default criteria a new %s monitor gets",
    (page: string, monitorType: MonitorType) => {
      const criteria: MonitorCriteria =
        MonitorCriteria.getDefaultMonitorCriteria({
          monitorType,
          monitorName: "Acme",
          ...IDS,
        });
      const [offline, online] = criteria.data!.monitorCriteriaInstanceArray as [
        MonitorCriteriaInstance,
        MonitorCriteriaInstance,
      ];

      expect(criteria.data!.monitorCriteriaInstanceArray).toHaveLength(2);
      expect(offline.data!.name).toBe("Check if Acme is offline");
      expect(primary(offline).filterType).toBe(FilterType.EqualTo);
      expect(Number(primary(offline).value)).toBe(0);
      expect(primary(offline).metricMonitorOptions?.metricAggregationType).toBe(
        EvaluateOverTimeType.AnyValue,
      );
      expect(offline.data!.incidents[0]!.title).toBe("Acme is offline");
      expect(offline.data!.incidents[0]!.autoResolveIncident).toBe(true);
      expect(online.data!.name).toBe("Check if Acme is online");
      expect(primary(online).filterType).toBe(FilterType.GreaterThan);
      expect(Number(primary(online).value)).toBe(0);

      expect(tableBody(sectionOf(page, "### Default criteria"))).toEqual([
        [
          "1",
          "Check if _monitor name_ is offline",
          "Any value of the first query is `0`",
          'Marks the monitor **Offline** and declares the incident "_monitor name_ is offline", which resolves itself when the monitor recovers.',
        ],
        [
          "2",
          "Check if _monitor name_ is online",
          "Any value is above `0`",
          "Marks the monitor **Operational**.",
        ],
      ]);
    },
  );
});

interface TemplateRow {
  name: string;
  category: string;
  severity: string;
  watches: string;
  fires: string;
  recovers: string;
}

function templateRows(page: string): Array<TemplateRow> {
  return tableBody(sectionOf(page, "## Pre-built Alert Templates")).map(
    (cells: Array<string>): TemplateRow => {
      return {
        name: cells[0] as string,
        category: cells[1] as string,
        severity: cells[2] as string,
        watches: cells[3] as string,
        fires: cells[4] as string,
        recovers: cells[5] as string,
      };
    },
  );
}

interface BuiltCriteria {
  metricName: string;
  aggregation: MetricsAggregationType;
  groupBy: Array<string>;
  rollingTime: RollingTime;
  fire: CriteriaFilter;
  recover: CriteriaFilter;
}

function buildCriteria(
  step: MonitorStep,
  config: {
    metricViewConfig: {
      queryConfigs: Array<{
        metricQueryData: {
          filterData: { metricName?: unknown; aggegationType?: unknown };
          groupByAttributeKeys?: Array<string> | undefined;
        };
      }>;
    };
    rollingTime: RollingTime;
  },
): BuiltCriteria {
  const query: {
    metricQueryData: {
      filterData: { metricName?: unknown; aggegationType?: unknown };
      groupByAttributeKeys?: Array<string> | undefined;
    };
  } = config.metricViewConfig.queryConfigs[0]!;
  const instances: Array<MonitorCriteriaInstance> =
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;

  return {
    metricName: query.metricQueryData.filterData.metricName as string,
    aggregation: query.metricQueryData.filterData
      .aggegationType as MetricsAggregationType,
    groupBy: query.metricQueryData.groupByAttributeKeys || [],
    rollingTime: config.rollingTime,
    fire: primary(instances[0]!),
    recover: primary(instances[1]!),
  };
}

// How the tables write a template's aggregation.
const AGGREGATION_WORDS: Record<string, MetricsAggregationType> = {
  Avg: MetricsAggregationType.Avg,
  Max: MetricsAggregationType.Max,
  Min: MetricsAggregationType.Min,
  Sum: MetricsAggregationType.Sum,
};

const WINDOW_MINUTES: Partial<Record<RollingTime, number>> = {
  [RollingTime.Past5Minutes]: 5,
  [RollingTime.Past15Minutes]: 15,
  [RollingTime.Past30Minutes]: 30,
};

function numberIn(text: string): number {
  return parseFloat(
    (text.match(/-?\d[\d ]*(?:\.\d+)?/) as RegExpMatchArray)[0].replace(
      / /g,
      "",
    ),
  );
}

describe("the IoT Device templates", () => {
  const templates: Array<IoTAlertTemplate> = getAllIoTAlertTemplates();
  const rows: Array<TemplateRow> = templateRows(IOT);

  function built(template: IoTAlertTemplate): BuiltCriteria {
    const step: MonitorStep = template.getMonitorStep({
      fleetIdentifier: "fleet",
      monitorName: "Acme",
      ...IDS,
    });

    return buildCriteria(step, step.data!.iotMonitor!);
  }

  it("lists every template the picker offers, in its order, with its category and severity", () => {
    expect(
      rows.map((row: TemplateRow): Array<string> => {
        return [row.name, row.category, row.severity];
      }),
    ).toEqual(
      templates.map((template: IoTAlertTemplate): Array<string> => {
        return [template.name, template.category, template.severity];
      }),
    );
    expect(englishPage(IOT)).toContain(
      `**Quick Setup** offers ${templates.length} templates.`,
    );
  });

  it.each(templates.map((template: IoTAlertTemplate) => {
    return [template.name, template] as [string, IoTAlertTemplate];
  }))(
    "%s: the metric, aggregation, group-by and window the template builds",
    (_name: string, template: IoTAlertTemplate) => {
      const criteria: BuiltCriteria = built(template);
      const row: TemplateRow = rows.find((candidate: TemplateRow) => {
        return candidate.name === template.name;
      }) as TemplateRow;
      const aggregation: string = (row.watches.match(
        /\b(Avg|Max|Min|Sum)\b/,
      ) as RegExpMatchArray)[1]!;

      expect(row.watches.match(INLINE_CODE)?.[1]).toBe(criteria.metricName);
      expect(AGGREGATION_WORDS[aggregation]).toBe(criteria.aggregation);
      expect(criteria.groupBy).toEqual(["device.id"]);
      expect(row.watches).toContain("per `device.id`");
      expect(row.watches).toContain(
        `past ${WINDOW_MINUTES[criteria.rollingTime]} minutes`,
      );
    },
  );

  it.each(templates.map((template: IoTAlertTemplate) => {
    return [template.name, template] as [string, IoTAlertTemplate];
  }))(
    "%s: fires and recovers at the thresholds the template sets",
    (_name: string, template: IoTAlertTemplate) => {
      const criteria: BuiltCriteria = built(template);
      const row: TemplateRow = rows.find((candidate: TemplateRow) => {
        return candidate.name === template.name;
      }) as TemplateRow;
      const fireWord: Record<string, FilterType> = {
        Below: FilterType.LessThan,
        Above: FilterType.GreaterThan,
        "Any reading is below": FilterType.LessThan,
      };
      const recoverWord: Record<string, FilterType> = {
        "At or above": FilterType.GreaterThanOrEqualTo,
        "At or below": FilterType.LessThanOrEqualTo,
        "Back at": FilterType.GreaterThanOrEqualTo,
      };

      const fireKey: string = Object.keys(fireWord).find((word: string) => {
        return row.fires.startsWith(word);
      }) as string;
      const recoverKey: string = Object.keys(recoverWord).find(
        (word: string) => {
          return row.recovers.startsWith(word);
        },
      ) as string;

      expect(fireWord[fireKey]).toBe(criteria.fire.filterType);
      expect(numberIn(row.fires)).toBe(Number(criteria.fire.value));
      expect(recoverWord[recoverKey]).toBe(criteria.recover.filterType);
      expect(numberIn(row.recovers)).toBeCloseTo(
        Number(criteria.recover.value),
        6,
      );
    },
  );

  it("Device Offline fires on the first reading below 1, and treats a silent registered device as 0", () => {
    const offline: IoTAlertTemplate = templates.find(
      (template: IoTAlertTemplate) => {
        return template.name === "Device Offline";
      },
    ) as IoTAlertTemplate;
    const criteria: BuiltCriteria = built(offline);

    expect(criteria.fire.metricMonitorOptions?.metricAggregationType).toBe(
      EvaluateOverTimeType.AnyValue,
    );
    expect(criteria.fire.metricMonitorOptions?.onNoDataPolicy).toBe(
      NoDataPolicy.TreatAsZero,
    );
    expect(criteria.rollingTime).toBe(RollingTime.Past30Minutes);

    for (const template of templates) {
      if (template === offline) {
        continue;
      }

      expect(built(template).fire.metricMonitorOptions?.metricAggregationType).toBe(
        EvaluateOverTimeType.AllValues,
      );
    }

    const page: string = englishPage(IOT);

    expect(page).toContain(
      "A criteria fires only when the condition holds for every minute of its window - except **Device Offline**, which fires on the first reading below 1.",
    );
    expect(page).toContain(
      "Silence detection needs the **Treat As Zero** no-data policy on the `iot_device_up` criteria, which Device Offline monitors created from the template have.",
    );
  });
});

describe("the IoT Device page against the form, the catalog and the inventory", () => {
  const form: string = source(`${FORMS}/IoTMonitor/IoTMonitorStepForm.tsx`);

  it("lists every metric of the catalog, with its unit", () => {
    const rows: Array<Array<string>> = tableBody(
      sectionOf(IOT, "## Collected Metrics"),
    );

    expect(
      rows.map((row: Array<string>): Array<string> => {
        return [row[0] as string, row[1] as string];
      }),
    ).toEqual(
      getAllIoTMetrics().map((metric: IoTMetricDefinition): Array<string> => {
        return [`\`${metric.metricName}\``, metric.unit ? `\`${metric.unit}\`` : "—"];
      }),
    );
  });

  it("a custom metric is not grouped, and starts on the Device scope", () => {
    const handler: string = form.slice(
      form.indexOf("const handleCustomMetricSelection"),
      form.indexOf("const renderFleetDropdown"),
    );

    expect(handler).toContain("buildIoTMonitorConfig({");
    expect(handler).not.toContain("groupByAttributeKey");
    expect(handler).toContain("scope: metric.defaultResourceScope,");

    for (const metric of getAllIoTMetrics()) {
      expect(metric.defaultResourceScope).toBe("device");
    }

    expect(englishPage(IOT)).toContain(
      "A custom metric is not grouped: it judges the fleet as a whole.",
    );
    expect(englishPage(IOT)).toContain("Picking a metric sets it to **Device**.");
  });

  it("names the filters as the form draws them, and the worker applies all three", () => {
    for (const title of [
      'title="IoT Fleet"',
      'title="Resource Scope"',
      'title="Device ID"',
      'title="Device Type"',
      'title="IoT Metric"',
      '{ label: "Device", value: IoTResourceScope.Device }',
      '{ label: "Fleet", value: IoTResourceScope.Fleet }',
    ]) {
      expect(form).toContain(title);
    }

    const worker: string = source(
      "packages/App/FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts",
    );

    for (const assignment of [
      'attributes["resource.iot.fleet.name"] = iotMonitorConfig.fleetIdentifier;',
      'attributes["device.id"] = resourceFilters.deviceId;',
      'attributes["iot.device.type"] = resourceFilters.deviceType;',
      'attributes["iot.scope"] = resourceFilters.scope;',
    ]) {
      expect(worker).toContain(assignment);
    }

    expect(englishPage(IOT)).toContain(
      "The filters work together: with a **Device ID** and a **Device Type**, a device of another type matches nothing.",
    );
  });

  it("keeps a registered device in the inventory, and drops an unregistered one after 15 silent minutes", () => {
    const devices: string = source(
      "packages/Common/Server/Services/IoTDeviceService.ts",
    );

    expect(devices).toContain(
      'const raw: string | undefined = process.env["IOT_INVENTORY_STALE_MINUTES"];',
    );
    expect(devices).toMatch(/return 15;\n\s+\}/);
    expect(devices).toContain(
      'UPDATE "IoTDevice" SET "isUp" = false, "updatedAt" = now() WHERE "iotFleetId" = $1 AND "lastSeenAt" < $2',
    );
    expect(
      source(`${DASHBOARD_SRC}/Pages/IoT/View/SideMenu.tsx`),
    ).toContain('title: "Device Registry"');
    expect(englishPage(IOT)).toContain(
      "A registered device is also kept in the fleet's inventory as offline, where an unregistered one is removed after 15 minutes of silence.",
    );
  });
});

describe("the VMware templates", () => {
  const templates: Array<VMwareAlertTemplate> = getAllVMwareAlertTemplates();
  const rows: Array<TemplateRow> = templateRows(VMWARE);

  function built(template: VMwareAlertTemplate): BuiltCriteria {
    const step: MonitorStep = template.getMonitorStep({
      vcenterIdentifier: "vcenter",
      monitorName: "Acme",
      ...IDS,
    });

    return buildCriteria(step, step.data!.vmwareMonitor!);
  }

  it("lists every template the picker offers, in its order", () => {
    expect(
      rows.map((row: TemplateRow): string => {
        return row.name;
      }),
    ).toEqual(
      templates.map((template: VMwareAlertTemplate): string => {
        return template.name;
      }),
    );
  });

  it.each(templates.map((template: VMwareAlertTemplate) => {
    return [template.name, template] as [string, VMwareAlertTemplate];
  }))(
    "%s: fires above its threshold, recovers where the template recovers, over the window the row gives",
    (_name: string, template: VMwareAlertTemplate) => {
      const criteria: BuiltCriteria = built(template);
      const row: TemplateRow = rows.find((candidate: TemplateRow) => {
        return candidate.name === template.name;
      }) as TemplateRow;

      expect(criteria.fire.filterType).toBe(FilterType.GreaterThan);
      expect(row.fires.startsWith("Above ")).toBe(true);
      expect(numberIn(row.fires)).toBe(Number(criteria.fire.value));
      expect(criteria.fire.metricMonitorOptions?.metricAggregationType).toBe(
        EvaluateOverTimeType.AllValues,
      );

      if (Number(criteria.recover.value) === 0) {
        expect(row.recovers).toBe("At 0");
      } else {
        expect(criteria.recover.filterType).toBe(FilterType.LessThanOrEqualTo);
        expect(row.recovers.startsWith("At or below ")).toBe(true);
        expect(numberIn(row.recovers)).toBeCloseTo(
          Number(criteria.recover.value),
          6,
        );
      }

      const aggregation: string = (row.watches.match(
        /\b(Avg|Max|Min|Sum)\b/,
      ) as RegExpMatchArray)[1]!;

      expect(AGGREGATION_WORDS[aggregation]).toBe(criteria.aggregation);

      if (criteria.rollingTime === RollingTime.Past5Minutes) {
        expect(row.watches).not.toContain("past ");
      } else {
        expect(row.watches).toContain(
          `**past ${WINDOW_MINUTES[criteria.rollingTime]} minutes**`,
        );
      }
    },
  );

  it("say that templates read the past 5 minutes unless the table says otherwise", () => {
    expect(englishPage(VMWARE)).toContain(
      "Templates read the past 5 minutes unless the table says otherwise.",
    );
  });
});

describe("the VMware page against the form and the agents", () => {
  const form: string = source(`${FORMS}/VMwareMonitor/VMwareMonitorStepForm.tsx`);

  it("names each filter as the form draws it, with the attribute it matches", () => {
    const rows: Array<Array<string>> = tableBody(
      sectionOf(VMWARE, "## Monitor settings"),
    );

    for (const [title, attribute] of [
      ["Datacenter", "resource.vcenter.datacenter.name"],
      ["Cluster", "resource.vcenter.cluster.name"],
      ["ESXi Host", "resource.vcenter.host.name"],
      ["Virtual Machine", "resource.vcenter.vm.name"],
      ["Datastore", "resource.vcenter.datastore.name"],
      ["Resource Pool Path", "resource.vcenter.resource_pool.inventory_path"],
    ] as Array<[string, string]>) {
      expect(form).toContain(`title: "${title}",`);
      expect(form).toContain(`\`${attribute}\``);

      const row: Array<string> | undefined = rows.find(
        (cells: Array<string>): boolean => {
          return cells[0] === `**${title}**`;
        },
      );

      expect({ title, attribute: row?.[2]?.includes(`\`${attribute}\``) }).toEqual({
        title,
        attribute: true,
      });
    }
  });

  it("groups a custom metric by the object it describes", () => {
    expect(form).toContain(
      "groupByAttributeKey: groupByKeyForScope[metric.defaultResourceScope],",
    );
    expect(englishPage(VMWARE)).toContain(
      "The form groups it by the object it describes, so each host, VM or datastore is judged on its own",
    );
  });

  it("reads vCenter every 2 minutes by default, through the agent or a probe", () => {
    expect(source("agents/VMwareAgent/docker-compose.yml")).toContain(
      "VCENTER_COLLECTION_INTERVAL=${VCENTER_COLLECTION_INTERVAL:-2m}",
    );
    expect(DEFAULT_VMWARE_COLLECTION_INTERVAL_IN_MINUTES).toBe(2);
    expect(englishPage(VMWARE)).toContain(
      "Both send the same series every collection interval (2 minutes by default)",
    );
  });
});

describe("the Storage Array page against the form and the agent", () => {
  const form: string = source(
    `${FORMS}/StorageArrayMonitor/StorageArrayMonitorStepForm.tsx`,
  );

  it("names each filter as the form draws it, with the platforms that offer it", () => {
    const rows: Array<Array<string>> = tableBody(
      sectionOf(STORAGE, "## Monitor settings"),
    );

    for (const [title, onlyOn] of [
      ["Volume", "FlashArray only."],
      ["Host", "FlashArray only."],
      ["Pod", "FlashArray only."],
      ["Hardware Component", ""],
      ["File System", "FlashBlade only."],
      ["Bucket", "FlashBlade only."],
    ] as Array<[string, string]>) {
      const at: number = form.indexOf(`title: "${title}",`);
      const platforms: string = form.slice(
        at,
        form.indexOf("},", form.indexOf("storageSystems:", at)),
      );

      expect(at).toBeGreaterThan(0);
      expect(platforms.includes("PureStorageFlashArray")).toBe(
        onlyOn !== "FlashBlade only.",
      );
      expect(platforms.includes("PureStorageFlashBlade")).toBe(
        onlyOn !== "FlashArray only.",
      );

      const row: Array<string> | undefined = rows.find(
        (cells: Array<string>): boolean => {
          return cells[0] === `**${title}**`;
        },
      );

      expect(row).toBeDefined();

      if (onlyOn) {
        expect(row![2]!.startsWith(onlyOn)).toBe(true);
      } else {
        expect(row![2]).not.toContain(" only.");
      }
    }
  });

  it("starts a custom metric of a file system or bucket at 15 minutes, any other at 5", () => {
    expect(form).toContain(
      "metric.defaultResourceScope === StorageArrayResourceScope.FileSystem ||\n    metric.defaultResourceScope === StorageArrayResourceScope.Bucket\n  ) {\n    return RollingTime.Past15Minutes;\n  }\n  return RollingTime.Past5Minutes;",
    );
    expect(englishPage(STORAGE)).toContain(
      "A new monitor starts at **Past 5 Minutes**; a custom metric of a file system or bucket at **Past 15 Minutes**; templates set their own.",
    );
  });

  it("states how often the agent reads each endpoint", () => {
    const fa: string = source("agents/StorageArrayAgent/otel-collector-config.yaml");
    const fb: string = source(
      "agents/StorageArrayAgent/otel-collector-config.flashblade.yaml",
    );
    const intervalOf: (config: string, path: string) => string = (
      config: string,
      metricsPath: string,
    ): string => {
      const at: number = config.indexOf(`metrics_path: /metrics/${metricsPath}`);

      return (config.slice(at).match(/scrape_interval: (\S+)/) as RegExpMatchArray)[1]!;
    };

    expect(intervalOf(fa, "array")).toBe("60s");
    expect(intervalOf(fa, "volumes")).toBe("120s");
    expect(intervalOf(fa, "hosts")).toBe("120s");
    expect(intervalOf(fa, "pods")).toBe("120s");
    expect(intervalOf(fa, "directories")).toBe("30m");
    expect(intervalOf(fb, "filesystems")).toBe("300s");
    expect(intervalOf(fb, "objectstore")).toBe("300s");
    expect(englishPage(STORAGE)).toContain(
      "The agent reads the array endpoint every 60 seconds, and volumes, hosts and pods every 2 minutes, so a 5-minute window always holds a sample. It reads a FlashBlade's file systems and buckets every 5 minutes, hence 15, and FlashArray directories every 30 minutes: give a directory monitor a 60-minute window.",
    );
  });

  it("names, for each series that carries its state in a label, a series of the catalog", () => {
    const rows: Array<Array<string>> = tableBody(
      sectionOf(STORAGE, "## How Pure's series are shaped"),
    );

    expect(rows.length).toBe(4);

    for (const row of rows) {
      const metricName: string = (row[0]!.match(INLINE_CODE) as RegExpMatchArray)[1]!;

      expect({
        metricName,
        inCatalog: Boolean(getStorageArrayMetric(metricName)),
      }).toEqual({ metricName, inCatalog: true });
    }
  });
});
