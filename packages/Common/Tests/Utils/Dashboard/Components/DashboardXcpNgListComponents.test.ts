import { describe, expect, test } from "@jest/globals";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import DashboardComponentType from "../../../../Types/Dashboard/DashboardComponentType";
import {
  ComponentArgument,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardXcpNgHostListComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardXcpNgHostListComponent";
import DashboardXcpNgVmListComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardXcpNgVmListComponent";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../../Types/Dashboard/DashboardViewConfig";
import {
  DashboardTemplate,
  DashboardTemplateCategory,
  DashboardTemplateType,
  DashboardTemplates,
  getTemplateConfig,
} from "../../../../Types/Dashboard/DashboardTemplates";
import IconProp from "../../../../Types/Icon/IconProp";
import { JSONObject, ObjectType } from "../../../../Types/JSON";
import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import {
  XcpNgMetricDefinition,
  getXcpNgMetricByMetricName,
} from "../../../../Types/Monitor/XcpNgMetricCatalog";
import {
  XCP_NG_RATE_TYPED_AS_COUNTER_SERIES,
  XcpNgLabel,
} from "../../../../Types/XcpNg/XcpNgTelemetry";
import DashboardComponentsUtil from "../../../../Utils/Dashboard/Components/Index";
import DashboardXcpNgHostListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardXcpNgHostListComponent";
import DashboardXcpNgVmListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardXcpNgVmListComponent";
import {
  XCP_NG_HOST_STATUS_FILTER_VALUES,
  XCP_NG_VM_STATUS_FILTER_VALUES,
  XcpNgDisplaySection,
  XcpNgFiltersSection,
  getXcpNgCommonArguments,
} from "../../../../Utils/Dashboard/Components/DashboardXcpNgResourceListShared";
import DashboardVMwareHostListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardVMwareHostListComponent";
import { getDashboardWidgetSortSpec } from "../../../../Utils/Dashboard/DashboardWidgetSorts";

/*
 * The two XCP-ng custom-dashboard list widgets, as the dashboard's own
 * registries know them (no React): their types, their settings, their
 * defaults and their sorts, and the XCP-ng Dashboard template that starts
 * a board with both.
 */

type AnyArgument = ComponentArgument<DashboardBaseComponent>;

const ids: (args: Array<AnyArgument>) => Array<string> = (
  args: Array<AnyArgument>,
): Array<string> => {
  return args.map((argument: AnyArgument): string => {
    return argument.id as string;
  });
};

const optionValues: (args: Array<AnyArgument>, id: string) => Array<string> = (
  args: Array<AnyArgument>,
  id: string,
): Array<string> => {
  const argument: AnyArgument | undefined = args.find(
    (candidate: AnyArgument): boolean => {
      return (candidate.id as string) === id;
    },
  );

  return (argument?.dropdownOptions || []).map(
    (option: { value: string | number | boolean }): string => {
      return String(option.value);
    },
  );
};

const HOST_ARGS: Array<AnyArgument> =
  DashboardXcpNgHostListComponentUtil.getComponentConfigArguments() as Array<AnyArgument>;
const VM_ARGS: Array<AnyArgument> =
  DashboardXcpNgVmListComponentUtil.getComponentConfigArguments() as Array<AnyArgument>;

describe("XCP-ng dashboard list widgets", () => {
  describe("enum registration", () => {
    test("both widget types are enum members with their own name as value", () => {
      expect(DashboardComponentType.XcpNgHostList).toBe("XcpNgHostList");
      expect(DashboardComponentType.XcpNgVmList).toBe("XcpNgVmList");
    });

    test("the XCP-ng pool entity filter type exists and is its own", () => {
      expect(EntityFilterModelType.XcpNgPool).toBe("XcpNgPool");
      expect(EntityFilterModelType.XcpNgPool).not.toBe(
        EntityFilterModelType.ProxmoxCluster,
      );
    });

    test("both widgets dispatch through DashboardComponentsUtil to their own util", () => {
      expect(
        ids(
          DashboardComponentsUtil.getComponentSettingsArguments(
            DashboardComponentType.XcpNgHostList,
          ),
        ),
      ).toEqual(ids(HOST_ARGS));
      expect(
        ids(
          DashboardComponentsUtil.getComponentSettingsArguments(
            DashboardComponentType.XcpNgVmList,
          ),
        ),
      ).toEqual(ids(VM_ARGS));
    });
  });

  describe("shared arguments", () => {
    const shared: Array<AnyArgument> =
      getXcpNgCommonArguments<DashboardBaseComponent>();

    test("emit exactly title, maxRows, viewMode, xcpNgPoolIds in that order", () => {
      expect(ids(shared)).toEqual([
        "title",
        "maxRows",
        "viewMode",
        "xcpNgPoolIds",
      ]);
    });

    test("have the very shape of every other infrastructure list's", () => {
      // VMware's builder: the same fields in the same sections, but its own model.
      const vmware: Array<AnyArgument> =
        DashboardVMwareHostListComponentUtil.getComponentConfigArguments() as Array<AnyArgument>;

      expect(
        shared.map((argument: AnyArgument) => {
          return [argument.type, argument.section?.name, argument.required];
        }),
      ).toEqual(
        vmware.map((argument: AnyArgument) => {
          return [argument.type, argument.section?.name, argument.required];
        }),
      );
    });

    test("the pool filter resolves against XcpNgPool and sits in the Filters panel", () => {
      const pools: AnyArgument | undefined = shared.find(
        (argument: AnyArgument): boolean => {
          return (argument.id as string) === "xcpNgPoolIds";
        },
      );

      expect(pools?.type).toBe(ComponentInputType.EntityMultiSelectDropdown);
      expect(pools?.entityFilterModelType).toBe(
        EntityFilterModelType.XcpNgPool,
      );
      expect(pools?.section).toBe(XcpNgFiltersSection);
      // Never the bare "Pools": the storage pools' word in other languages.
      expect(pools?.name).toBe("XCP-ng Pools");
      expect(pools?.placeholder).toBe("All XCP-ng pools");
    });

    test("sections are named and ordered like the other infrastructure widgets", () => {
      expect(XcpNgDisplaySection.name).toBe("Display Options");
      expect(XcpNgDisplaySection.order).toBe(1);
      expect(XcpNgFiltersSection.name).toBe("Filters");
      expect(XcpNgFiltersSection.order).toBe(2);
      expect(XcpNgFiltersSection.defaultCollapsed).toBe(true);
    });

    test("returns a fresh array on every call", () => {
      const first: Array<AnyArgument> =
        getXcpNgCommonArguments<DashboardBaseComponent>();
      const second: Array<AnyArgument> =
        getXcpNgCommonArguments<DashboardBaseComponent>();

      expect(first).not.toBe(second);
      first.pop();
      expect(second).toHaveLength(4);
    });

    test("no other product's wording leaks into XCP-ng copy", () => {
      const copy: string = [...HOST_ARGS, ...VM_ARGS]
        .flatMap((argument: AnyArgument): Array<string> => {
          return [
            argument.name,
            argument.description || "",
            argument.placeholder || "",
            ...(argument.dropdownOptions || []).map(
              (option: { label: string }): string => {
                return option.label;
              },
            ),
          ];
        })
        .join(" ")
        .toLowerCase();

      for (const word of ["proxmox", "vcenter", "esxi", "guest", "cluster"]) {
        expect({ word, found: copy.includes(word) }).toEqual({
          word,
          found: false,
        });
      }
    });
  });

  describe.each([
    {
      name: "XcpNgHostList",
      component:
        DashboardXcpNgHostListComponentUtil.getDefaultComponent() as DashboardBaseComponent,
      type: DashboardComponentType.XcpNgHostList,
      args: HOST_ARGS,
      statusValues: XCP_NG_HOST_STATUS_FILTER_VALUES,
      statusLabels: [
        "All",
        "Running only",
        "Not running only",
        "Disabled only",
      ],
    },
    {
      name: "XcpNgVmList",
      component:
        DashboardXcpNgVmListComponentUtil.getDefaultComponent() as DashboardBaseComponent,
      type: DashboardComponentType.XcpNgVmList,
      args: VM_ARGS,
      statusValues: XCP_NG_VM_STATUS_FILTER_VALUES,
      statusLabels: ["All", "Running only", "Not running only"],
    },
  ])(
    "$name",
    (spec: {
      name: string;
      component: DashboardBaseComponent;
      type: DashboardComponentType;
      args: Array<AnyArgument>;
      statusValues: ReadonlyArray<string>;
      statusLabels: Array<string>;
    }) => {
      test("default component is a 6x4 list widget with min 6x3 and 25 rows", () => {
        expect(spec.component._type).toBe(ObjectType.DashboardComponent);
        expect(spec.component.componentType).toBe(spec.type);
        expect(spec.component.widthInDashboardUnits).toBe(6);
        expect(spec.component.heightInDashboardUnits).toBe(4);
        expect(spec.component.minWidthInDashboardUnits).toBe(6);
        expect(spec.component.minHeightInDashboardUnits).toBe(3);
        expect(spec.component.arguments).toEqual({ maxRows: 25 });
      });

      test("each default is a new widget", () => {
        const util:
          | typeof DashboardXcpNgHostListComponentUtil
          | typeof DashboardXcpNgVmListComponentUtil =
          spec.type === DashboardComponentType.XcpNgHostList
            ? DashboardXcpNgHostListComponentUtil
            : DashboardXcpNgVmListComponentUtil;

        expect(util.getDefaultComponent().componentId.toString()).not.toBe(
          util.getDefaultComponent().componentId.toString(),
        );
      });

      test("adds the status filter after the shared arguments", () => {
        expect(ids(spec.args)).toEqual([
          "title",
          "maxRows",
          "viewMode",
          "xcpNgPoolIds",
          "statusFilter",
        ]);
      });

      test("its status filter offers all, then exactly the shared values", () => {
        expect(optionValues(spec.args, "statusFilter")).toEqual([
          "",
          ...spec.statusValues,
        ]);

        const status: AnyArgument | undefined = spec.args.find(
          (argument: AnyArgument): boolean => {
            return (argument.id as string) === "statusFilter";
          },
        );

        expect(
          (status?.dropdownOptions || []).map(
            (option: { label: string }): string => {
              return option.label;
            },
          ),
        ).toEqual(spec.statusLabels);
        expect(status?.section).toBe(XcpNgFiltersSection);
      });

      test("every argument is optional and ids are unique", () => {
        for (const argument of spec.args) {
          expect(argument.required).toBe(false);
        }

        expect(new Set(ids(spec.args)).size).toBe(spec.args.length);
      });

      test("every column its header sorts by is one the registry orders", () => {
        const keys: Array<string> =
          getDashboardWidgetSortSpec(spec.type)?.columns.map(
            (column: { key: string }): string => {
              return column.key;
            },
          ) || [];

        expect(keys).toContain("name");
        expect(keys).toContain("status");
        expect(keys).toContain("cpu");
        expect(keys).toContain("memory");
        expect(keys).toContain("pool");
      });
    },
  );

  test("the hosts' status column sorts by what a status means, the VMs' by the up flag", () => {
    const hostStatus: { ranks?: unknown; fields?: unknown } | undefined =
      getDashboardWidgetSortSpec(
        DashboardComponentType.XcpNgHostList,
      )?.columns.find((column: { key: string }): boolean => {
        return column.key === "status";
      });
    const vmStatus: { ranks?: unknown; fields?: unknown } | undefined =
      getDashboardWidgetSortSpec(
        DashboardComponentType.XcpNgVmList,
      )?.columns.find((column: { key: string }): boolean => {
        return column.key === "status";
      });

    expect(hostStatus?.ranks).toBeDefined();
    expect(vmStatus?.fields).toEqual([
      { path: "isUp", whenDescending: SortOrder.Ascending, nullsLast: true },
    ]);
  });

  test("the typed settings carry what the settings form writes", () => {
    const host: DashboardXcpNgHostListComponent["arguments"] = {
      title: "Hosts",
      maxRows: 10,
      viewMode: "honeycomb",
      xcpNgPoolIds: ["pool-1"],
      statusFilter: "disabled",
    };
    const vm: DashboardXcpNgVmListComponent["arguments"] = {
      title: "VMs",
      maxRows: 10,
      viewMode: "list",
      xcpNgPoolIds: ["pool-1"],
      statusFilter: "not-running",
    };

    expect(Object.keys(host).sort()).toEqual(ids(HOST_ARGS).sort());
    expect(Object.keys(vm).sort()).toEqual(ids(VM_ARGS).sort());
  });
});

describe("the XCP-ng dashboard template", () => {
  const template: DashboardTemplate | undefined = DashboardTemplates.find(
    (candidate: DashboardTemplate): boolean => {
      return candidate.type === DashboardTemplateType.XcpNg;
    },
  );
  const config: DashboardViewConfig = getTemplateConfig(
    DashboardTemplateType.XcpNg,
  ) as DashboardViewConfig;

  const charts: Array<DashboardBaseComponent> = config.components.filter(
    (component: DashboardBaseComponent): boolean => {
      return component.componentType === DashboardComponentType.Chart;
    },
  );

  const queryOf: (chart: DashboardBaseComponent) => JSONObject = (
    chart: DashboardBaseComponent,
  ): JSONObject => {
    return (chart.arguments as JSONObject)["metricQueryConfig"] as JSONObject;
  };

  const filterOf: (chart: DashboardBaseComponent) => JSONObject = (
    chart: DashboardBaseComponent,
  ): JSONObject => {
    return (queryOf(chart)["metricQueryData"] as JSONObject)[
      "filterData"
    ] as JSONObject;
  };

  test("has exactly one catalog card, filed under Infrastructure with the XCP-ng icon", () => {
    expect(
      DashboardTemplates.filter((candidate: DashboardTemplate): boolean => {
        return candidate.type === DashboardTemplateType.XcpNg;
      }),
    ).toHaveLength(1);
    expect(template?.name).toBe("XCP-ng Dashboard");
    expect(template?.category).toBe(DashboardTemplateCategory.Infrastructure);
    expect(template?.icon).toBe(IconProp.XcpNg);
    /*
     * Its description already says Xen Orchestra (a search for "xen" finds
     * it there), so its keywords are the words it does not say: the product
     * XCP-ng forked from, and what it is.
     */
    expect(template?.description).toContain("Xen Orchestra");
    expect(template?.keywords).toEqual([
      "xenserver",
      "hypervisor",
      "virtualization",
    ]);
  });

  test("is listed right after the VMware card, with the other hypervisors", () => {
    const types: Array<DashboardTemplateType> = DashboardTemplates.map(
      (candidate: DashboardTemplate): DashboardTemplateType => {
        return candidate.type;
      },
    );

    expect(types[types.indexOf(DashboardTemplateType.XcpNg) - 1]).toBe(
      DashboardTemplateType.VMware,
    );
  });

  test("opens with its name, then the host and VM lists from the inventory", () => {
    const [title, hosts, vms] = config.components;

    expect(title?.componentType).toBe(DashboardComponentType.Text);
    expect((title?.arguments as JSONObject)["text"]).toBe("XCP-ng Dashboard");
    expect(hosts?.componentType).toBe(DashboardComponentType.XcpNgHostList);
    expect(vms?.componentType).toBe(DashboardComponentType.XcpNgVmList);

    // Hosts that are not running, then disabled ones, on top.
    expect((hosts?.arguments as JSONObject)["sort"]).toBe("status:desc");
    // A halted VM is often meant to be: the VM list keeps its name order.
    expect((vms?.arguments as JSONObject)["sort"]).toBeUndefined();
  });

  test("every chart reads a series of the XCP-ng metric catalog", () => {
    expect(charts.length).toBeGreaterThanOrEqual(6);

    for (const chart of charts) {
      const metricName: string = filterOf(chart)["metricName"] as string;
      const definition: XcpNgMetricDefinition | undefined =
        getXcpNgMetricByMetricName(metricName);

      expect({ metricName, inCatalog: Boolean(definition) }).toEqual({
        metricName,
        inCatalog: true,
      });
    }
  });

  test("never takes a rate of a series that is a rate already", () => {
    for (const chart of charts) {
      const metricName: string = filterOf(chart)["metricName"] as string;

      expect({
        metricName,
        transformAsRate: Boolean(queryOf(chart)["transformAsRate"]),
      }).toEqual({ metricName, transformAsRate: false });
    }

    // And it charts the rate-typed network series it reads as the gauges they are.
    const metricNames: Array<string> = charts.map(
      (chart: DashboardBaseComponent): string => {
        return filterOf(chart)["metricName"] as string;
      },
    );

    expect(
      metricNames.filter((metricName: string): boolean => {
        return XCP_NG_RATE_TYPED_AS_COUNTER_SERIES.includes(metricName);
      }),
    ).toEqual([
      "xcp_host_network_receive_bytes_total",
      "xcp_host_network_transmit_bytes_total",
    ]);
  });

  test("never Sums a gauge across an interval", () => {
    for (const chart of charts) {
      expect({
        metricName: filterOf(chart)["metricName"],
        aggregation: filterOf(chart)["aggegationType"],
      }).not.toEqual(
        expect.objectContaining({ aggregation: MetricsAggregationType.Sum }),
      );
    }
  });

  test("draws one line per host, and per storage repository, on Xen Orchestra's own labels", () => {
    const groupedBy: Record<string, unknown> = {};

    for (const chart of charts) {
      groupedBy[filterOf(chart)["metricName"] as string] = (
        queryOf(chart)["metricQueryData"] as JSONObject
      )["groupByAttributeKeys"];
    }

    expect(groupedBy["xcp_host_cpu_average"]).toEqual([XcpNgLabel.HostName]);
    expect(groupedBy["xcp_host_memory_free_bytes"]).toEqual([
      XcpNgLabel.HostName,
    ]);
    expect(groupedBy["xcp_sr_physical_usage_bytes"]).toEqual([
      XcpNgLabel.SrName,
    ]);
  });

  test("has no logs widget: the XCP-ng Agent reads metrics only", () => {
    expect(
      config.components.filter((component: DashboardBaseComponent): boolean => {
        return component.componentType === DashboardComponentType.LogStream;
      }),
    ).toEqual([]);
  });

  test("ships one variable, the pool, bound to the pool's name on every series", () => {
    const variables: Array<DashboardVariable> = config.variables || [];

    expect(variables).toHaveLength(1);
    expect(variables[0]?.type).toBe(DashboardVariableType.TelemetryAttribute);
    expect(variables[0]?.attributeKey).toBe("resource.xcp_ng.pool.name");
    // Never the bare "Pool": the storage pools' word in other languages.
    expect(variables[0]?.label).toBe("XCP-ng Pool");
  });

  test("uses no other product's wording in any widget title", () => {
    const titles: string = config.components
      .map((component: DashboardBaseComponent): string => {
        const args: JSONObject = component.arguments as JSONObject;

        return String(
          args["chartTitle"] || args["title"] || args["text"] || "",
        );
      })
      .join(" ")
      .toLowerCase();

    for (const word of ["proxmox", "vmware", "vcenter", "esxi", "guest"]) {
      expect({ word, found: titles.includes(word) }).toEqual({
        word,
        found: false,
      });
    }
  });
});
