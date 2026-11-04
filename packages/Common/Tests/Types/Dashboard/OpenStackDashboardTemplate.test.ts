import fs from "fs";
import path from "path";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardVariable from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import {
  DashboardTemplate,
  DashboardTemplateCategory,
  DashboardTemplates,
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";

/*
 * What makes this template OpenStack's. The rules every template must keep (grid bounds,
 * overlap, unique ids, the aggregation's spelling) are in DashboardTemplateInvariants.
 *
 * A metric name, a group-by and a filter in a template are raw strings a saved dashboard
 * keeps for good, and each that matches nothing is an empty chart with no error. So they
 * are checked against what real clouds' agents export, not against a list of names:
 * the recordings under Tests/Fixtures/OpenStack.
 */

const RECORDINGS: string = path.join(__dirname, "../../Fixtures/OpenStack");
// The release recorded through the collector, and one of each backend's healthy scene.
const EXPORT_RELEASE: string = "gazpacho-ovs";

interface Series {
  name: string;
  labels: Record<string, string>;
}

// What every datapoint a real export holds carries, with the metric's name.
function readExport(release: string): {
  series: Array<Series>;
  resourceAttributes: Set<string>;
} {
  const otlp: JSONObject = JSON.parse(
    fs.readFileSync(path.join(RECORDINGS, release, "otlp.json"), "utf8"),
  ) as JSONObject;
  const series: Array<Series> = [];
  const resourceAttributes: Set<string> = new Set();

  for (const resourceMetrics of otlp["resourceMetrics"] as Array<JSONObject>) {
    for (const attribute of ((resourceMetrics["resource"] as JSONObject)[
      "attributes"
    ] as Array<JSONObject>) || []) {
      resourceAttributes.add(attribute["key"] as string);
    }
    for (const scope of resourceMetrics["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of scope["metrics"] as Array<JSONObject>) {
        const data: JSONObject =
          (metric["gauge"] as JSONObject) ||
          (metric["sum"] as JSONObject) ||
          ({} as JSONObject);
        for (const datapoint of (data["dataPoints"] as Array<JSONObject>) ||
          []) {
          const labels: Record<string, string> = {};
          for (const attribute of (datapoint[
            "attributes"
          ] as Array<JSONObject>) || []) {
            labels[attribute["key"] as string] = (
              attribute["value"] as JSONObject
            )["stringValue"] as string;
          }
          series.push({ name: metric["name"] as string, labels });
        }
      }
    }
  }

  return { series, resourceAttributes };
}

const EXPORTED: { series: Array<Series>; resourceAttributes: Set<string> } =
  readExport(EXPORT_RELEASE);

function getConfig(): DashboardViewConfig {
  const config: DashboardViewConfig | null = getTemplateConfig(
    DashboardTemplateType.OpenStack,
  );
  expect(config).not.toBeNull();
  return config as DashboardViewConfig;
}

type WidgetArguments = Record<string, unknown>;

function argumentsOf(component: DashboardBaseComponent): WidgetArguments {
  return (component.arguments as WidgetArguments | undefined) || {};
}

function titleOf(component: DashboardBaseComponent): string {
  const args: WidgetArguments = argumentsOf(component);
  for (const key of ["title", "chartTitle", "text"]) {
    const value: unknown = args[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

function queryDataOf(component: DashboardBaseComponent): WidgetArguments {
  const config: WidgetArguments | undefined = argumentsOf(component)[
    "metricQueryConfig"
  ] as WidgetArguments | undefined;
  return (config?.["metricQueryData"] as WidgetArguments | undefined) || {};
}

function filterDataOf(component: DashboardBaseComponent): WidgetArguments {
  return (queryDataOf(component)["filterData"] as WidgetArguments) || {};
}

function metricNameOf(component: DashboardBaseComponent): string {
  return String(filterDataOf(component)["metricName"] || "");
}

// The fetch layer's own spelling, as DashboardTemplateInvariants holds every template to.
function aggregationOf(component: DashboardBaseComponent): string {
  return String(filterDataOf(component)["aggegationType"] || "");
}

function metricWidgets(): Array<DashboardBaseComponent> {
  return getConfig().components.filter(
    (component: DashboardBaseComponent): boolean => {
      return metricNameOf(component) !== "";
    },
  );
}

function widgetTitled(title: string): DashboardBaseComponent {
  const found: Array<DashboardBaseComponent> = getConfig().components.filter(
    (component: DashboardBaseComponent): boolean => {
      return titleOf(component) === title;
    },
  );
  expect(found).toHaveLength(1);
  return found[0] as DashboardBaseComponent;
}

function seriesNamed(name: string): Array<Series> {
  return EXPORTED.series.filter((series: Series): boolean => {
    return series.name === name;
  });
}

describe("the OpenStack dashboard template", () => {
  test("is in the catalog once, under Infrastructure, with OpenStack's own words", () => {
    const entries: Array<DashboardTemplate> = DashboardTemplates.filter(
      (template: DashboardTemplate): boolean => {
        return template.type === DashboardTemplateType.OpenStack;
      },
    );
    expect(entries).toHaveLength(1);

    const entry: DashboardTemplate = entries[0] as DashboardTemplate;
    expect(entry.name).toBe("OpenStack Dashboard");
    expect(entry.category).toBe(DashboardTemplateCategory.Infrastructure);
    // The neutral icon, until the trademark check (#5751).
    expect(entry.icon).toBe(IconProp.Cloud);
    expect(entry.description).toMatch(/hypervisor/i);
    expect(entry.description).not.toMatch(/proxmox|vmware/i);
  });

  test("every metric on it is one a real cloud's agent exports", () => {
    expect(EXPORTED.series.length).toBeGreaterThan(0);
    const widgets: Array<DashboardBaseComponent> = metricWidgets();
    expect(widgets.length).toBeGreaterThan(0);

    for (const widget of widgets) {
      expect({
        widget: titleOf(widget),
        metric: metricNameOf(widget),
        hasSeries: seriesNamed(metricNameOf(widget)).length > 0,
      }).toEqual({
        widget: titleOf(widget),
        metric: metricNameOf(widget),
        hasSeries: true,
      });
    }
  });

  test("every chart groups by a label its metric really carries", () => {
    const grouped: Array<DashboardBaseComponent> = metricWidgets().filter(
      (widget: DashboardBaseComponent): boolean => {
        return Array.isArray(queryDataOf(widget)["groupByAttributeKeys"]);
      },
    );
    expect(grouped.length).toBeGreaterThan(0);

    for (const widget of grouped) {
      const keys: Array<string> = queryDataOf(widget)[
        "groupByAttributeKeys"
      ] as Array<string>;
      for (const key of keys) {
        const series: Array<Series> = seriesNamed(metricNameOf(widget));
        expect({
          widget: titleOf(widget),
          key,
          isOnEveryDatapoint: series.every((one: Series): boolean => {
            return Boolean(one.labels[key]);
          }),
        }).toEqual({
          widget: titleOf(widget),
          key,
          isOnEveryDatapoint: true,
        });
      }
    }
  });

  test("a chart that filters does so on a value real clouds report", () => {
    const filtered: Array<DashboardBaseComponent> = metricWidgets().filter(
      (widget: DashboardBaseComponent): boolean => {
        return Boolean(filterDataOf(widget)["attributes"]);
      },
    );
    expect(filtered.length).toBeGreaterThan(0);

    for (const widget of filtered) {
      const attributes: Record<string, string> = filterDataOf(widget)[
        "attributes"
      ] as Record<string, string>;
      const matching: Array<Series> = seriesNamed(metricNameOf(widget)).filter(
        (one: Series): boolean => {
          return Object.keys(attributes).every((key: string): boolean => {
            return one.labels[key] === attributes[key];
          });
        },
      );
      expect({
        widget: titleOf(widget),
        matches: matching.length > 0,
      }).toEqual({ widget: titleOf(widget), matches: true });
    }
  });

  test("the variables are attributes a real export carries, where it carries them", () => {
    const variables: Array<DashboardVariable> = getConfig().variables || [];
    const keyOf: (name: string) => string = (name: string): string => {
      const variable: DashboardVariable | undefined = variables.find(
        (one: DashboardVariable): boolean => {
          return one.name === name;
        },
      );
      return String(variable?.attributeKey || "");
    };

    // The cloud is the resource's, and the region a label on each datapoint.
    expect(keyOf("cloud")).toBe("resource.openstack.cloud.name");
    expect(EXPORTED.resourceAttributes.has("openstack.cloud.name")).toBe(true);
    expect(keyOf("region")).toBe("openstack.region.name");
    expect(
      seriesNamed("openstack_nova_up").every((one: Series): boolean => {
        return Boolean(one.labels["openstack.region.name"]);
      }),
    ).toBe(true);
  });

  test("nothing sums what the exporter repeats on every scrape", () => {
    for (const widget of metricWidgets()) {
      expect({
        widget: titleOf(widget),
        aggregation: aggregationOf(widget),
      }).not.toEqual({ widget: titleOf(widget), aggregation: "Sum" });
    }
  });

  test("an API reads its lowest, or one down in a window would be averaged away", () => {
    for (const [title, metric] of [
      ["Identity API", "openstack_identity_up"],
      ["Compute API", "openstack_nova_up"],
      ["Placement API", "openstack_placement_up"],
      ["Network API", "openstack_neutron_up"],
      ["Block Storage API", "openstack_cinder_up"],
      ["Image API", "openstack_glance_up"],
    ] as Array<[string, string]>) {
      const widget: DashboardBaseComponent = widgetTitled(title);
      expect(metricNameOf(widget)).toBe(metric);
      expect(aggregationOf(widget)).toBe("Min");
      expect(widget.componentType).toBe(DashboardComponentType.Value);
    }
  });

  test.each([
    ["Nova Services (lowest per binary)", "openstack_nova_agent_state"],
    ["Neutron Agents (lowest per binary)", "openstack_neutron_agent_state"],
    ["Cinder Services (lowest per binary)", "openstack_cinder_agent_state"],
  ])("%s reads each binary's lowest", (title: string, metric: string) => {
    const widget: DashboardBaseComponent = widgetTitled(title);
    expect(metricNameOf(widget)).toBe(metric);
    expect(aggregationOf(widget)).toBe("Min");
    expect(queryDataOf(widget)["groupByAttributeKeys"]).toEqual(["service"]);
  });

  test("capacity says allocated, and what it was promised out of, never CPU or usage", () => {
    const titles: Array<string> = getConfig().components.map(titleOf);

    for (const title of titles) {
      expect(title).not.toMatch(/\bCPU\b/);
      expect(title).not.toMatch(/\busage\b/i);
    }
    expect(titles).toContain("vCPUs Allocated (per hypervisor)");
    expect(titles).toContain("Memory Allocated (per hypervisor)");

    // A hypervisor's own row, with one line for each, not one for the whole cloud.
    expect(
      filterDataOf(widgetTitled("vCPUs Allocated (per hypervisor)"))[
        "attributes"
      ],
    ).toEqual({ resourcetype: "VCPU" });
    expect(
      filterDataOf(widgetTitled("Memory Allocated (per hypervisor)"))[
        "attributes"
      ],
    ).toEqual({ resourcetype: "MEMORY_MB" });
  });

  test("what can run out reads the worst of the window", () => {
    const free: DashboardBaseComponent = widgetTitled(
      "Storage Pool Free (per pool)",
    );
    expect(metricNameOf(free)).toBe("openstack_cinder_pool_capacity_free_gb");
    expect(aggregationOf(free)).toBe("Min");
    expect(
      aggregationOf(widgetTitled("Collection Time (longest per service)")),
    ).toBe("Max");
  });

  test("the logs are on it", () => {
    expect(
      getConfig().components.filter(
        (component: DashboardBaseComponent): boolean => {
          return component.componentType === DashboardComponentType.LogStream;
        },
      ),
    ).toHaveLength(1);
  });

  test("two dashboards from it share no widget", () => {
    const ids: (config: DashboardViewConfig) => Array<string> = (
      config: DashboardViewConfig,
    ): Array<string> => {
      return config.components.map(
        (component: DashboardBaseComponent): string => {
          return component.componentId.toString();
        },
      );
    };
    const first: Set<string> = new Set(ids(getConfig()));
    for (const id of ids(getConfig())) {
      expect(first.has(id)).toBe(false);
    }
  });
});
