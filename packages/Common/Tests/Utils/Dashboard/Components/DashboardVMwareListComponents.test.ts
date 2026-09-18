import { describe, expect, test } from "@jest/globals";
import DashboardComponentType from "../../../../Types/Dashboard/DashboardComponentType";
import {
  ComponentArgument,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardVMwareHostListComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardVMwareHostListComponent";
import DashboardVMwareVirtualMachineListComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardVMwareVirtualMachineListComponent";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../../Types/Dashboard/DashboardViewConfig";
import {
  DashboardTemplate,
  DashboardTemplateCategory,
  DashboardTemplates,
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../../Types/Dashboard/DashboardTemplates";
import IconProp from "../../../../Types/Icon/IconProp";
import { ObjectType } from "../../../../Types/JSON";
import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../../Types/ObjectID";
import DashboardComponentsUtil from "../../../../Utils/Dashboard/Components/Index";
import DashboardVMwareHostListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardVMwareHostListComponent";
import {
  VMwareDisplaySection,
  VMwareFiltersSection,
  getVMwareCommonArguments,
} from "../../../../Utils/Dashboard/Components/DashboardVMwareResourceListShared";
import DashboardVMwareVirtualMachineListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardVMwareVirtualMachineListComponent";

/*
 * The two VMware custom-dashboard list widgets and the VMware dashboard
 * template. The generic suites (DashboardComponentDefaults,
 * DashboardComponentsUtil, DashboardResourceListSharedArgs,
 * DashboardTemplateInvariants) prove the widgets are wired and well-formed;
 * this suite pins the VMware-specific contract other layers depend on:
 *
 *   - the argument ids and their order (the React widget, the public
 *     dashboard policy and the settings form all read them by name);
 *   - the filter option VALUES ("on"/"off", "exclude"/"only") — the widget
 *     query switch and the server-side optionalEnum whitelist must accept
 *     exactly these strings, or public dashboards silently ignore the
 *     filter while the authenticated app applies it;
 *   - the fact that the host widget carries NO status filter, because the
 *     vcenter receiver reports no per-host power/connection state;
 *   - the template's use of list widgets (never Sum-of-gauge Value tiles)
 *     for counts, and its vCenter variable key.
 */

type AnyArgument = ComponentArgument<DashboardBaseComponent>;

function ids(args: Array<AnyArgument>): Array<string> {
  return args.map((argument: AnyArgument): string => {
    return argument.id as unknown as string;
  });
}

function argumentById(
  args: Array<AnyArgument>,
  id: string,
): AnyArgument | undefined {
  return args.find((argument: AnyArgument): boolean => {
    return (argument.id as unknown as string) === id;
  });
}

function optionValues(argument: AnyArgument | undefined): Array<unknown> {
  return (argument?.dropdownOptions || []).map(
    (option: { value: string | number | boolean }): unknown => {
      return option.value;
    },
  );
}

function optionLabels(argument: AnyArgument | undefined): Array<string> {
  return (argument?.dropdownOptions || []).map(
    (option: { label: string }): string => {
      return option.label;
    },
  );
}

const hostArgs: Array<AnyArgument> =
  DashboardVMwareHostListComponentUtil.getComponentConfigArguments() as Array<AnyArgument>;

const vmArgs: Array<AnyArgument> =
  DashboardVMwareVirtualMachineListComponentUtil.getComponentConfigArguments() as Array<AnyArgument>;

describe("VMware dashboard list widgets", () => {
  describe("enum registration", () => {
    test("both widget types are enum members with their own name as value", () => {
      expect(DashboardComponentType.VMwareHostList).toBe("VMwareHostList");
      expect(DashboardComponentType.VMwareVirtualMachineList).toBe(
        "VMwareVirtualMachineList",
      );
    });

    test("the vCenter entity filter type exists and is distinct from Proxmox's", () => {
      expect(EntityFilterModelType.VMwareVCenter).toBe("VMwareVCenter");
      expect(EntityFilterModelType.VMwareVCenter).not.toBe(
        EntityFilterModelType.ProxmoxCluster,
      );
    });

    test("both widgets dispatch through DashboardComponentsUtil to their own util", () => {
      expect(
        DashboardComponentsUtil.getComponentSettingsArguments(
          DashboardComponentType.VMwareHostList,
        ),
      ).toEqual(hostArgs);
      expect(
        DashboardComponentsUtil.getComponentSettingsArguments(
          DashboardComponentType.VMwareVirtualMachineList,
        ),
      ).toEqual(vmArgs);
    });
  });

  describe("shared arguments", () => {
    test("emit exactly title, maxRows, viewMode, vmwareVCenterIds in that order", () => {
      const shape: Array<string> =
        getVMwareCommonArguments<DashboardBaseComponent>().map(
          (argument: AnyArgument): string => {
            return `${argument.id as unknown as string}:${argument.type}`;
          },
        );

      expect(shape).toEqual([
        `title:${ComponentInputType.Text}`,
        `maxRows:${ComponentInputType.Number}`,
        `viewMode:${ComponentInputType.Dropdown}`,
        `vmwareVCenterIds:${ComponentInputType.EntityMultiSelectDropdown}`,
      ]);
    });

    test("the vCenter filter resolves against VMwareVCenter and sits in the Filters panel", () => {
      const vcenters: AnyArgument | undefined = argumentById(
        getVMwareCommonArguments<DashboardBaseComponent>(),
        "vmwareVCenterIds",
      );

      expect(vcenters).toBeDefined();
      expect(vcenters!.name).toBe("vCenters");
      expect(vcenters!.placeholder).toBe("All vCenters");
      expect(vcenters!.entityFilterModelType).toBe(
        EntityFilterModelType.VMwareVCenter,
      );
      expect(vcenters!.section).toBe(VMwareFiltersSection);
    });

    test("sections are named and ordered like the other infrastructure widgets", () => {
      expect(VMwareDisplaySection.name).toBe("Display Options");
      expect(VMwareDisplaySection.order).toBe(1);
      expect(VMwareFiltersSection.name).toBe("Filters");
      expect(VMwareFiltersSection.order).toBe(2);
      expect(VMwareFiltersSection.defaultCollapsed).toBe(true);
    });

    test("returns a fresh array on every call", () => {
      const first: Array<AnyArgument> =
        getVMwareCommonArguments<DashboardBaseComponent>();
      const second: Array<AnyArgument> =
        getVMwareCommonArguments<DashboardBaseComponent>();

      expect(second).toEqual(first);
      expect(second).not.toBe(first);
    });

    test("no Proxmox wording leaks into VMware copy", () => {
      for (const argument of [...hostArgs, ...vmArgs]) {
        const copy: string = `${argument.name} ${argument.description} ${
          argument.placeholder ?? ""
        } ${optionLabels(argument).join(" ")}`.toLowerCase();

        expect(copy).not.toContain("proxmox");
        expect(copy).not.toContain("pve");
        expect(copy).not.toContain("qemu");
        expect(copy).not.toContain("lxc");
        expect(copy).not.toContain("guest");
        expect(copy).not.toContain("node");
      }
    });
  });

  describe("VMwareHostList", () => {
    test("default component is a 6x4 list widget with min 6x3 and 25 rows", () => {
      const component: DashboardVMwareHostListComponent =
        DashboardVMwareHostListComponentUtil.getDefaultComponent();

      expect(component._type).toBe(ObjectType.DashboardComponent);
      expect(component.componentType).toBe(
        DashboardComponentType.VMwareHostList,
      );
      expect(component.widthInDashboardUnits).toBe(6);
      expect(component.heightInDashboardUnits).toBe(4);
      expect(component.minWidthInDashboardUnits).toBe(6);
      expect(component.minHeightInDashboardUnits).toBe(3);
      expect(component.topInDashboardUnits).toBe(0);
      expect(component.leftInDashboardUnits).toBe(0);
      expect(component.arguments).toEqual({ maxRows: 25 });
      expect(ObjectID.isValidUUID(component.componentId.toString())).toBe(true);
    });

    test("offers exactly the shared arguments and no status filter", () => {
      /*
       * The vcenter receiver emits no per-host power or connection state
       * (host power state exists only as a datacenter-level count), so a
       * status dropdown here would filter on a column that is never
       * populated. If one is ever added, the receiver must report it first.
       */
      expect(ids(hostArgs)).toEqual([
        "title",
        "maxRows",
        "viewMode",
        "vmwareVCenterIds",
      ]);
      expect(argumentById(hostArgs, "statusFilter")).toBeUndefined();
      expect(argumentById(hostArgs, "powerStateFilter")).toBeUndefined();
    });

    test("every argument is optional", () => {
      for (const argument of hostArgs) {
        expect(argument.required).toBe(false);
      }
    });
  });

  describe("VMwareVirtualMachineList", () => {
    test("default component is a 6x4 list widget with min 6x3 and 25 rows", () => {
      const component: DashboardVMwareVirtualMachineListComponent =
        DashboardVMwareVirtualMachineListComponentUtil.getDefaultComponent();

      expect(component._type).toBe(ObjectType.DashboardComponent);
      expect(component.componentType).toBe(
        DashboardComponentType.VMwareVirtualMachineList,
      );
      expect(component.widthInDashboardUnits).toBe(6);
      expect(component.heightInDashboardUnits).toBe(4);
      expect(component.minWidthInDashboardUnits).toBe(6);
      expect(component.minHeightInDashboardUnits).toBe(3);
      expect(component.arguments).toEqual({ maxRows: 25 });
      expect(ObjectID.isValidUUID(component.componentId.toString())).toBe(true);
    });

    test("adds the power state and template filters after the shared arguments", () => {
      expect(ids(vmArgs)).toEqual([
        "title",
        "maxRows",
        "viewMode",
        "vmwareVCenterIds",
        "powerStateFilter",
        "templateFilter",
      ]);
    });

    test("power state filter offers exactly all / on / off", () => {
      const powerState: AnyArgument | undefined = argumentById(
        vmArgs,
        "powerStateFilter",
      );

      expect(powerState).toBeDefined();
      expect(powerState!.type).toBe(ComponentInputType.Dropdown);
      expect(powerState!.required).toBe(false);
      expect(powerState!.section).toBe(VMwareFiltersSection);
      expect(optionValues(powerState)).toEqual(["", "on", "off"]);
    });

    test("template filter offers exactly all / exclude / only", () => {
      const templates: AnyArgument | undefined = argumentById(
        vmArgs,
        "templateFilter",
      );

      expect(templates).toBeDefined();
      expect(templates!.type).toBe(ComponentInputType.Dropdown);
      expect(templates!.required).toBe(false);
      expect(templates!.section).toBe(VMwareFiltersSection);
      expect(optionValues(templates)).toEqual(["", "exclude", "only"]);
    });

    test("the first option of every filter is the empty 'all' value", () => {
      /*
       * "" is what the widget and the public policy treat as "no filter".
       * A non-empty first option would make a freshly added widget filter
       * by default, hiding rows the operator never asked to hide.
       */
      for (const id of ["powerStateFilter", "templateFilter"]) {
        expect(optionValues(argumentById(vmArgs, id))[0]).toBe("");
      }
    });

    test("filter labels say powered on / powered off, never running / stopped", () => {
      /*
       * The receiver cannot distinguish powered-off from suspended, so the
       * UI label is "Powered off", not "Stopped"; and "Running" would be
       * Proxmox wording.
       */
      const labels: Array<string> = optionLabels(
        argumentById(vmArgs, "powerStateFilter"),
      );

      expect(labels).toEqual(["All", "Powered on only", "Powered off only"]);
    });

    test("every argument is optional and ids are unique", () => {
      for (const argument of vmArgs) {
        expect(argument.required).toBe(false);
      }
      expect(new Set(ids(vmArgs)).size).toBe(vmArgs.length);
    });
  });
});

describe("VMware dashboard template", () => {
  const config: DashboardViewConfig = getTemplateConfig(
    DashboardTemplateType.VMware,
  ) as DashboardViewConfig;

  function componentsOfType(
    type: DashboardComponentType,
  ): Array<DashboardBaseComponent> {
    return config.components.filter(
      (component: DashboardBaseComponent): boolean => {
        return component.componentType === type;
      },
    );
  }

  function metricNameOf(component: DashboardBaseComponent): string {
    const args: Record<string, unknown> = component.arguments as Record<
      string,
      unknown
    >;
    const queryConfig: Record<string, unknown> = args[
      "metricQueryConfig"
    ] as Record<string, unknown>;
    const queryData: Record<string, unknown> = queryConfig[
      "metricQueryData"
    ] as Record<string, unknown>;
    const filterData: Record<string, unknown> = queryData[
      "filterData"
    ] as Record<string, unknown>;

    return filterData["metricName"] as string;
  }

  function aggregationOf(component: DashboardBaseComponent): string {
    const args: Record<string, unknown> = component.arguments as Record<
      string,
      unknown
    >;
    const queryConfig: Record<string, unknown> = args[
      "metricQueryConfig"
    ] as Record<string, unknown>;
    const queryData: Record<string, unknown> = queryConfig[
      "metricQueryData"
    ] as Record<string, unknown>;
    const filterData: Record<string, unknown> = queryData[
      "filterData"
    ] as Record<string, unknown>;

    return filterData["aggegationType"] as string;
  }

  test("has exactly one catalog card, filed under Infrastructure with the VMware icon", () => {
    const cards: Array<DashboardTemplate> = DashboardTemplates.filter(
      (template: DashboardTemplate): boolean => {
        return template.type === DashboardTemplateType.VMware;
      },
    );

    expect(cards).toHaveLength(1);
    expect(cards[0]!.name).toBe("VMware Dashboard");
    expect(cards[0]!.category).toBe(DashboardTemplateCategory.Infrastructure);
    expect(cards[0]!.icon).toBe(IconProp.VMware);
    expect(cards[0]!.description.toLowerCase()).not.toContain("proxmox");
  });

  test("is listed right after the Proxmox card so the two hypervisor products sit together", () => {
    const types: Array<DashboardTemplateType> = DashboardTemplates.map(
      (template: DashboardTemplate): DashboardTemplateType => {
        return template.type;
      },
    );

    expect(types.indexOf(DashboardTemplateType.VMware)).toBe(
      types.indexOf(DashboardTemplateType.Proxmox) + 1,
    );
  });

  test("resolves to a config that is tall enough for its lowest widget", () => {
    expect(config).not.toBeNull();
    expect(config._type).toBe(ObjectType.DashboardViewConfig);
    expect(config.components.length).toBeGreaterThan(0);

    /*
     * The canvas is never shorter than the default dashboard height, and it
     * must always reach the bottom edge of the lowest widget so nothing in
     * the template is clipped on first render.
     */
    const lowestEdge: number = Math.max(
      ...config.components.map((component: DashboardBaseComponent): number => {
        return component.topInDashboardUnits + component.heightInDashboardUnits;
      }),
    );

    expect(lowestEdge).toBe(20);
    expect(config.heightInDashboardUnits).toBeGreaterThanOrEqual(lowestEdge);
  });

  test("takes host and VM counts from the two list widgets", () => {
    const hosts: Array<DashboardBaseComponent> = componentsOfType(
      DashboardComponentType.VMwareHostList,
    );
    const vms: Array<DashboardBaseComponent> = componentsOfType(
      DashboardComponentType.VMwareVirtualMachineList,
    );

    expect(hosts).toHaveLength(1);
    expect(vms).toHaveLength(1);
    expect(hosts[0]!.arguments).toEqual({ title: "Hosts", maxRows: 25 });
    /*
     * Templates are hidden so the header count is real virtual machines;
     * power state is left open so both on and off VMs appear.
     */
    expect(vms[0]!.arguments).toEqual({
      title: "Virtual Machines",
      maxRows: 25,
      powerStateFilter: undefined,
      templateFilter: "exclude",
    });
  });

  test("never builds a Value tile from a count metric, and never Sums a gauge", () => {
    /*
     * The receiver's count metrics fan out over status x power_state and
     * re-emit each scrape; a Sum over the dashboard window multiplies
     * (buckets x scrapes), and a Max picks one bucket. Counts belong to the
     * list widgets above.
     */
    const values: Array<DashboardBaseComponent> = componentsOfType(
      DashboardComponentType.Value,
    );

    expect(values.length).toBeGreaterThan(0);

    for (const value of values) {
      expect(metricNameOf(value)).not.toMatch(/\.count$/);
      expect(aggregationOf(value)).toBe(MetricsAggregationType.Avg);
    }

    for (const chart of componentsOfType(DashboardComponentType.Chart)) {
      expect(metricNameOf(chart)).not.toMatch(/\.count$/);
      expect(aggregationOf(chart)).not.toBe(MetricsAggregationType.Sum);
    }
  });

  test("every metric widget queries a vcenter receiver metric", () => {
    const metricWidgets: Array<DashboardBaseComponent> = [
      ...componentsOfType(DashboardComponentType.Value),
      ...componentsOfType(DashboardComponentType.Chart),
    ];
    const metricNames: Array<string> = metricWidgets.map(metricNameOf);

    expect(metricNames.length).toBeGreaterThan(0);

    for (const metricName of metricNames) {
      expect(metricName).toMatch(/^vcenter\./);
      expect(metricName).not.toMatch(/^pve_/);
    }

    expect(metricNames).toEqual(
      expect.arrayContaining([
        "vcenter.host.cpu.utilization",
        "vcenter.host.memory.utilization",
        "vcenter.datastore.disk.utilization",
        "vcenter.vm.cpu.readiness",
        "vcenter.vm.memory.ballooned",
      ]),
    );
  });

  test("groups per-host and per-datastore charts by the resource's own identity attribute", () => {
    const charts: Array<DashboardBaseComponent> = componentsOfType(
      DashboardComponentType.Chart,
    );

    for (const chart of charts) {
      const args: Record<string, unknown> = chart.arguments as Record<
        string,
        unknown
      >;
      const queryConfig: Record<string, unknown> = args[
        "metricQueryConfig"
      ] as Record<string, unknown>;
      const queryData: Record<string, unknown> = queryConfig[
        "metricQueryData"
      ] as Record<string, unknown>;
      const groupBy: Array<string> | undefined = queryData[
        "groupByAttributeKeys"
      ] as Array<string> | undefined;
      const metricName: string = metricNameOf(chart);

      if (metricName.startsWith("vcenter.host.")) {
        expect(groupBy).toEqual(["resource.vcenter.host.name"]);
      }
      if (metricName.startsWith("vcenter.datastore.")) {
        expect(groupBy).toEqual(["resource.vcenter.datastore.name"]);
      }
    }
  });

  test("ships one vCenter variable bound to resource.vmware.vcenter.name", () => {
    const variables: Array<DashboardVariable> = config.variables || [];

    expect(variables).toHaveLength(1);
    expect(variables[0]!.name).toBe("vcenter");
    expect(variables[0]!.label).toBe("vCenter");
    expect(variables[0]!.type).toBe(DashboardVariableType.TelemetryAttribute);
    expect(variables[0]!.attributeKey).toBe("resource.vmware.vcenter.name");
    expect(variables[0]!.isMultiSelect).toBe(false);
  });

  test("includes a log stream for forwarded ESXi syslog", () => {
    expect(componentsOfType(DashboardComponentType.LogStream)).toHaveLength(1);
  });

  test("uses no Proxmox-only wording in any widget title", () => {
    for (const component of config.components) {
      const args: Record<string, unknown> = component.arguments as Record<
        string,
        unknown
      >;
      const label: string = String(
        args["title"] ?? args["chartTitle"] ?? args["text"] ?? "",
      ).toLowerCase();

      expect(label).not.toContain("proxmox");
      expect(label).not.toContain("guest");
      expect(label).not.toContain("node");
    }
  });
});
