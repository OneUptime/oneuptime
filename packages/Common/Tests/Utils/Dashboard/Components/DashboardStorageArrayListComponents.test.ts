import { describe, expect, test } from "@jest/globals";
import DashboardComponentType from "../../../../Types/Dashboard/DashboardComponentType";
import {
  ComponentArgument,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardStorageArrayHardwareListComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardStorageArrayHardwareListComponent";
import DashboardStorageArrayVolumeListComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardStorageArrayVolumeListComponent";
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
import {
  StorageArrayMetricDefinition,
  getStorageArrayMetric,
} from "../../../../Types/Monitor/StorageArrayMetricCatalog";
import ObjectID from "../../../../Types/ObjectID";
import StorageArrayResourceKind from "../../../../Types/StorageArray/StorageArrayResourceKind";
import StorageSystem from "../../../../Types/StorageArray/StorageSystem";
import DashboardComponentsUtil from "../../../../Utils/Dashboard/Components/Index";
import DashboardStorageArrayHardwareListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardStorageArrayHardwareListComponent";
import {
  STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES,
  STORAGE_ARRAY_HARDWARE_UNHEALTHY_FILTER,
  STORAGE_ARRAY_HARDWARE_WIDGET_KINDS,
  STORAGE_ARRAY_UNHEALTHY_COMPONENT_STATUSES,
  STORAGE_ARRAY_WARNING_COMPONENT_STATUSES,
  StorageArrayDisplaySection,
  StorageArrayFiltersSection,
  getStorageArrayCommonArguments,
} from "../../../../Utils/Dashboard/Components/DashboardStorageArrayResourceListShared";
import DashboardStorageArrayVolumeListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardStorageArrayVolumeListComponent";
import { UNHEALTHY_HARDWARE_STATUSES } from "../../../../Server/Services/StorageArrayResourceService";
import {
  isCriticalComponentStatus,
  isUnhealthyComponentStatus,
} from "../../../../Server/Utils/Telemetry/StorageArraySnapshotScan";

/*
 * The two Storage Array custom-dashboard list widgets and the Storage Array
 * dashboard template. The generic suites (DashboardComponentDefaults,
 * DashboardComponentsUtil, DashboardResourceListSharedArgs,
 * DashboardTemplateInvariants) prove the widgets are wired and well-formed;
 * this suite pins the Storage Array contract other layers depend on:
 *
 *   - the argument ids and their order (the React widget, the public
 *     dashboard policy and the settings form all read them by name);
 *   - the filter option VALUES (the inventory kinds, "unhealthy") — the
 *     widget query and the server-side optionalEnum whitelist must accept
 *     exactly these strings, or public dashboards silently ignore the filter
 *     while the authenticated app applies it;
 *   - the component statuses the hardware widget bands by, which have to
 *     be the ones ingest derives an array's health from;
 *   - the template's metric queries, which must read exactly the series the
 *     Storage Array metric catalog defines (name, dimension filter and
 *     aggregation), because Pure puts read, write and queue figures on one
 *     metric name.
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

const volumeArgs: Array<AnyArgument> =
  DashboardStorageArrayVolumeListComponentUtil.getComponentConfigArguments() as Array<AnyArgument>;

const hardwareArgs: Array<AnyArgument> =
  DashboardStorageArrayHardwareListComponentUtil.getComponentConfigArguments() as Array<AnyArgument>;

describe("Storage Array dashboard list widgets", () => {
  describe("enum registration", () => {
    test("both widget types are enum members with their own name as value", () => {
      expect(DashboardComponentType.StorageArrayVolumeList).toBe(
        "StorageArrayVolumeList",
      );
      expect(DashboardComponentType.StorageArrayHardwareList).toBe(
        "StorageArrayHardwareList",
      );
    });

    test("the storage array entity filter type exists and is distinct from Ceph's", () => {
      expect(EntityFilterModelType.StorageArray).toBe("StorageArray");
      expect(EntityFilterModelType.StorageArray).not.toBe(
        EntityFilterModelType.CephCluster,
      );
    });

    test("both widgets dispatch through DashboardComponentsUtil to their own util", () => {
      expect(
        DashboardComponentsUtil.getComponentSettingsArguments(
          DashboardComponentType.StorageArrayVolumeList,
        ),
      ).toEqual(volumeArgs);
      expect(
        DashboardComponentsUtil.getComponentSettingsArguments(
          DashboardComponentType.StorageArrayHardwareList,
        ),
      ).toEqual(hardwareArgs);
    });
  });

  describe("shared arguments", () => {
    test("emit exactly title, maxRows, viewMode, storageArrayIds in that order", () => {
      const shape: Array<string> =
        getStorageArrayCommonArguments<DashboardBaseComponent>().map(
          (argument: AnyArgument): string => {
            return `${argument.id as unknown as string}:${argument.type}`;
          },
        );

      expect(shape).toEqual([
        `title:${ComponentInputType.Text}`,
        `maxRows:${ComponentInputType.Number}`,
        `viewMode:${ComponentInputType.Dropdown}`,
        `storageArrayIds:${ComponentInputType.EntityMultiSelectDropdown}`,
      ]);
    });

    test("the array filter resolves against StorageArray and sits in the Filters panel", () => {
      const arrays: AnyArgument | undefined = argumentById(
        getStorageArrayCommonArguments<DashboardBaseComponent>(),
        "storageArrayIds",
      );

      expect(arrays).toBeDefined();
      expect(arrays!.name).toBe("Storage Arrays");
      expect(arrays!.placeholder).toBe("All storage arrays");
      expect(arrays!.entityFilterModelType).toBe(
        EntityFilterModelType.StorageArray,
      );
      expect(arrays!.section).toBe(StorageArrayFiltersSection);
    });

    test("sections are named and ordered like the other infrastructure widgets", () => {
      expect(StorageArrayDisplaySection.name).toBe("Display Options");
      expect(StorageArrayDisplaySection.order).toBe(1);
      expect(StorageArrayFiltersSection.name).toBe("Filters");
      expect(StorageArrayFiltersSection.order).toBe(2);
      expect(StorageArrayFiltersSection.defaultCollapsed).toBe(true);
    });

    test("returns a fresh array on every call", () => {
      const first: Array<AnyArgument> =
        getStorageArrayCommonArguments<DashboardBaseComponent>();
      const second: Array<AnyArgument> =
        getStorageArrayCommonArguments<DashboardBaseComponent>();

      expect(second).toEqual(first);
      expect(second).not.toBe(first);
    });

    test("no other product's wording leaks into Storage Array copy", () => {
      for (const argument of [...volumeArgs, ...hardwareArgs]) {
        const copy: string = `${argument.name} ${argument.description} ${
          argument.placeholder ?? ""
        } ${optionLabels(argument).join(" ")}`.toLowerCase();

        for (const foreign of [
          "ceph",
          "osd",
          "pool",
          "cluster",
          "vcenter",
          "proxmox",
        ]) {
          expect({ foreign, present: copy.includes(foreign) }).toEqual({
            foreign,
            present: false,
          });
        }
      }
    });
  });

  describe("StorageArrayVolumeList", () => {
    test("default component is a 6x4 list widget with min 6x3 and 25 rows", () => {
      const component: DashboardStorageArrayVolumeListComponent =
        DashboardStorageArrayVolumeListComponentUtil.getDefaultComponent();

      expect(component._type).toBe(ObjectType.DashboardComponent);
      expect(component.componentType).toBe(
        DashboardComponentType.StorageArrayVolumeList,
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

    test("offers exactly the shared arguments", () => {
      /*
       * A volume's state is its latency, which the widget bands by; there
       * is no status column on a volume to filter on.
       */
      expect(ids(volumeArgs)).toEqual([
        "title",
        "maxRows",
        "viewMode",
        "storageArrayIds",
      ]);
      expect(argumentById(volumeArgs, "statusFilter")).toBeUndefined();
      expect(argumentById(volumeArgs, "kindFilter")).toBeUndefined();
    });

    test("every argument is optional", () => {
      for (const argument of volumeArgs) {
        expect(argument.required).toBe(false);
      }
    });
  });

  describe("StorageArrayHardwareList", () => {
    test("default component is the hardware wall: a 6x4 honeycomb with min 6x3 and 50 cells", () => {
      const component: DashboardStorageArrayHardwareListComponent =
        DashboardStorageArrayHardwareListComponentUtil.getDefaultComponent();

      expect(component._type).toBe(ObjectType.DashboardComponent);
      expect(component.componentType).toBe(
        DashboardComponentType.StorageArrayHardwareList,
      );
      expect(component.widthInDashboardUnits).toBe(6);
      expect(component.heightInDashboardUnits).toBe(4);
      expect(component.minWidthInDashboardUnits).toBe(6);
      expect(component.minHeightInDashboardUnits).toBe(3);
      expect(component.arguments).toEqual({
        maxRows: 50,
        viewMode: "honeycomb",
      });
      expect(ObjectID.isValidUUID(component.componentId.toString())).toBe(true);
    });

    test("adds the kind and status filters after the shared arguments", () => {
      expect(ids(hardwareArgs)).toEqual([
        "title",
        "maxRows",
        "viewMode",
        "storageArrayIds",
        "kindFilter",
        "statusFilter",
      ]);
    });

    test("kind filter offers exactly all / hardware components / drives / controllers", () => {
      const kind: AnyArgument | undefined = argumentById(
        hardwareArgs,
        "kindFilter",
      );

      expect(kind).toBeDefined();
      expect(kind!.type).toBe(ComponentInputType.Dropdown);
      expect(kind!.required).toBe(false);
      expect(kind!.section).toBe(StorageArrayFiltersSection);
      expect(optionValues(kind)).toEqual([
        "",
        StorageArrayResourceKind.Hardware,
        StorageArrayResourceKind.Drive,
        StorageArrayResourceKind.Controller,
      ]);
      // The non-empty values are the kinds the widget lists, in order.
      expect(optionValues(kind).slice(1)).toEqual([
        ...STORAGE_ARRAY_HARDWARE_WIDGET_KINDS,
      ]);
      expect(optionLabels(kind)).toEqual([
        "All",
        "Hardware components only",
        "Drives only",
        "Controllers only",
      ]);
    });

    test("status filter offers exactly all / unhealthy", () => {
      const status: AnyArgument | undefined = argumentById(
        hardwareArgs,
        "statusFilter",
      );

      expect(status).toBeDefined();
      expect(status!.type).toBe(ComponentInputType.Dropdown);
      expect(status!.required).toBe(false);
      expect(status!.section).toBe(StorageArrayFiltersSection);
      expect(optionValues(status)).toEqual([
        "",
        STORAGE_ARRAY_HARDWARE_UNHEALTHY_FILTER,
      ]);
      expect(STORAGE_ARRAY_HARDWARE_UNHEALTHY_FILTER).toBe("unhealthy");
    });

    test("the first option of every filter is the empty 'all' value", () => {
      /*
       * "" is what the widget and the public policy treat as "no filter".
       * A non-empty first option would make a freshly added widget filter
       * by default, hiding components the operator never asked to hide.
       */
      for (const id of ["kindFilter", "statusFilter"]) {
        expect(optionValues(argumentById(hardwareArgs, id))[0]).toBe("");
      }
    });

    test("every argument is optional and ids are unique", () => {
      for (const argument of hardwareArgs) {
        expect(argument.required).toBe(false);
      }
      expect(new Set(ids(hardwareArgs)).size).toBe(hardwareArgs.length);
    });
  });

  describe("the hardware widget's vocabulary", () => {
    test("lists hardware components, drives and controllers and nothing else", () => {
      expect([...STORAGE_ARRAY_HARDWARE_WIDGET_KINDS]).toEqual([
        StorageArrayResourceKind.Hardware,
        StorageArrayResourceKind.Drive,
        StorageArrayResourceKind.Controller,
      ]);
    });

    test("critical and warning statuses do not overlap and together are the unhealthy ones", () => {
      for (const status of STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES) {
        expect(STORAGE_ARRAY_WARNING_COMPONENT_STATUSES).not.toContain(status);
      }
      expect([...STORAGE_ARRAY_UNHEALTHY_COMPONENT_STATUSES].sort()).toEqual(
        [
          ...STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES,
          ...STORAGE_ARRAY_WARNING_COMPONENT_STATUSES,
        ].sort(),
      );
      expect(new Set(STORAGE_ARRAY_UNHEALTHY_COMPONENT_STATUSES).size).toBe(
        STORAGE_ARRAY_UNHEALTHY_COMPONENT_STATUSES.length,
      );
    });

    test("statuses are lowercase, as ingest writes them", () => {
      for (const status of STORAGE_ARRAY_UNHEALTHY_COMPONENT_STATUSES) {
        expect(status).toBe(status.trim().toLowerCase());
      }
    });

    test("unhealthy means exactly what StorageArrayResourceService counts as unhealthy hardware", () => {
      expect([...STORAGE_ARRAY_UNHEALTHY_COMPONENT_STATUSES].sort()).toEqual(
        [...UNHEALTHY_HARDWARE_STATUSES].sort(),
      );
    });

    test("each status bands the way ingest derives an array's health from it", () => {
      for (const status of STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES) {
        expect({ status, critical: isCriticalComponentStatus(status) }).toEqual(
          { status, critical: true },
        );
      }
      for (const status of STORAGE_ARRAY_WARNING_COMPONENT_STATUSES) {
        expect({
          status,
          critical: isCriticalComponentStatus(status),
          unhealthy: isUnhealthyComponentStatus(status),
        }).toEqual({ status, critical: false, unhealthy: true });
      }
      for (const status of [
        "ok",
        "healthy",
        "ready",
        "identifying",
        "not_installed",
        "device_off",
        "empty",
        "unused",
      ]) {
        expect({
          status,
          unhealthy: isUnhealthyComponentStatus(status),
        }).toEqual({ status, unhealthy: false });
      }
    });
  });
});

describe("Storage Array dashboard template", () => {
  const config: DashboardViewConfig = getTemplateConfig(
    DashboardTemplateType.StorageArray,
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

  function argsOf(component: DashboardBaseComponent): Record<string, unknown> {
    return component.arguments as Record<string, unknown>;
  }

  function titleOf(component: DashboardBaseComponent): string {
    const args: Record<string, unknown> = argsOf(component);
    return String(args["title"] ?? args["chartTitle"] ?? args["text"] ?? "");
  }

  function componentTitled(
    type: DashboardComponentType,
    title: string,
  ): DashboardBaseComponent {
    const component: DashboardBaseComponent | undefined = componentsOfType(
      type,
    ).find((candidate: DashboardBaseComponent): boolean => {
      return titleOf(candidate) === title;
    });
    if (!component) {
      throw new Error(`No ${type} titled "${title}" in the template.`);
    }
    return component;
  }

  interface StoredQuery {
    metricVariable: string | undefined;
    legend: string | undefined;
    legendUnit: string | undefined;
    metricName: string;
    aggregation: string;
    attributes: Record<string, string> | undefined;
    groupByAttributeKeys: Array<string> | undefined;
    transformAsRate: unknown;
  }

  function readQuery(queryConfig: Record<string, unknown>): StoredQuery {
    const aliasData: Record<string, unknown> =
      (queryConfig["metricAliasData"] as Record<string, unknown>) || {};
    const queryData: Record<string, unknown> = queryConfig[
      "metricQueryData"
    ] as Record<string, unknown>;
    const filterData: Record<string, unknown> = queryData[
      "filterData"
    ] as Record<string, unknown>;

    return {
      metricVariable: aliasData["metricVariable"] as string | undefined,
      legend: aliasData["legend"] as string | undefined,
      legendUnit: aliasData["legendUnit"] as string | undefined,
      metricName: filterData["metricName"] as string,
      aggregation: filterData["aggegationType"] as string,
      attributes: filterData["attributes"] as
        | Record<string, string>
        | undefined,
      groupByAttributeKeys: queryData["groupByAttributeKeys"] as
        | Array<string>
        | undefined,
      transformAsRate: queryConfig["transformAsRate"],
    };
  }

  // Every query a metric widget runs: the primary, then any additional ones.
  function queriesOf(component: DashboardBaseComponent): Array<StoredQuery> {
    const args: Record<string, unknown> = argsOf(component);
    const queries: Array<StoredQuery> = [
      readQuery(args["metricQueryConfig"] as Record<string, unknown>),
    ];
    for (const additional of (args["metricQueryConfigs"] as
      | Array<Record<string, unknown>>
      | undefined) || []) {
      queries.push(readQuery(additional));
    }
    return queries;
  }

  const metricWidgets: Array<DashboardBaseComponent> = [
    ...componentsOfType(DashboardComponentType.Value),
    ...componentsOfType(DashboardComponentType.Chart),
  ];

  const allQueries: Array<StoredQuery> = metricWidgets.flatMap(queriesOf);

  test("has exactly one catalog card, filed under Infrastructure with the Storage Array icon", () => {
    const cards: Array<DashboardTemplate> = DashboardTemplates.filter(
      (template: DashboardTemplate): boolean => {
        return template.type === DashboardTemplateType.StorageArray;
      },
    );

    expect(DashboardTemplateType.StorageArray).toBe("StorageArray");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.name).toBe("Storage Array Dashboard");
    expect(cards[0]!.category).toBe(DashboardTemplateCategory.Infrastructure);
    expect(cards[0]!.icon).toBe(IconProp.StorageArray);
    expect(cards[0]!.description).toContain("Pure Storage FlashArray");
    expect(cards[0]!.description.toLowerCase()).not.toContain("ceph");
  });

  test("is listed right after the Ceph card so the two storage products sit together", () => {
    const types: Array<DashboardTemplateType> = DashboardTemplates.map(
      (template: DashboardTemplate): DashboardTemplateType => {
        return template.type;
      },
    );

    expect(types.indexOf(DashboardTemplateType.StorageArray)).toBe(
      types.indexOf(DashboardTemplateType.Ceph) + 1,
    );
  });

  test("resolves to a config that is tall enough for its lowest widget", () => {
    expect(config).not.toBeNull();
    expect(config._type).toBe(ObjectType.DashboardViewConfig);
    expect(config.components.length).toBeGreaterThan(0);

    const lowestEdge: number = Math.max(
      ...config.components.map((component: DashboardBaseComponent): number => {
        return component.topInDashboardUnits + component.heightInDashboardUnits;
      }),
    );

    expect(lowestEdge).toBe(20);
    expect(config.heightInDashboardUnits).toBeGreaterThanOrEqual(lowestEdge);
  });

  test("opens with the volume list and the hardware wall from the inventory", () => {
    const volumes: Array<DashboardBaseComponent> = componentsOfType(
      DashboardComponentType.StorageArrayVolumeList,
    );
    const hardware: Array<DashboardBaseComponent> = componentsOfType(
      DashboardComponentType.StorageArrayHardwareList,
    );

    expect(volumes).toHaveLength(1);
    expect(hardware).toHaveLength(1);
    expect(volumes[0]!.topInDashboardUnits).toBe(1);
    expect(hardware[0]!.topInDashboardUnits).toBe(1);
    expect(volumes[0]!.arguments).toEqual({ title: "Volumes", maxRows: 25 });
    expect(hardware[0]!.arguments).toEqual({
      title: "Hardware",
      maxRows: 100,
      viewMode: "honeycomb",
      kindFilter: undefined,
      statusFilter: undefined,
    });
  });

  test("every metric query reads a FlashArray series", () => {
    expect(allQueries.length).toBeGreaterThan(0);

    for (const query of allQueries) {
      expect(query.metricName).toMatch(/^purefa_/);
    }
  });

  test("every metric query reads its catalog entry's own series: name, dimension filter and aggregation", () => {
    /*
     * Pure puts read, write and queue latency on ONE metric name, told apart
     * only by `dimension`; a query that drops the filter averages them. So
     * each query must match a catalog entry exactly, for the platform the
     * template is about.
     */
    for (const query of allQueries) {
      const definition: StorageArrayMetricDefinition | undefined =
        getStorageArrayMetric(query.metricName, query.attributes);

      expect(definition).toBeDefined();
      expect(definition!.storageSystems).toContain(
        StorageSystem.PureStorageFlashArray,
      );
      expect({
        metricName: query.metricName,
        aggregation: query.aggregation,
      }).toEqual({
        metricName: query.metricName,
        aggregation: definition!.defaultAggregation,
      });

      for (const [key, value] of Object.entries(definition!.attributes || {})) {
        expect({
          metricName: query.metricName,
          key,
          value: query.attributes?.[key],
        }).toEqual({
          metricName: query.metricName,
          key,
          value,
        });
      }
    }
  });

  test("covers capacity, data reduction, latency, IOPS, bandwidth and open alerts", () => {
    expect(
      allQueries.map((query: StoredQuery) => {
        return query.metricName;
      }),
    ).toEqual(
      expect.arrayContaining([
        "purefa_array_space_utilization",
        "purefa_array_space_data_reduction_ratio",
        "purefa_array_space_bytes",
        "purefa_array_performance_latency_usec",
        "purefa_array_performance_throughput_iops",
        "purefa_array_performance_bandwidth_bytes",
        "purefa_alerts_open",
      ]),
    );
  });

  test("never Sums a gauge and never rates one", () => {
    /*
     * Every Pure series is a gauge the array computes itself — already per
     * second for IOPS and bandwidth — so a Sum grows with the time range and
     * a rate of a rate is noise.
     */
    for (const query of allQueries) {
      expect(query.aggregation).not.toBe(MetricsAggregationType.Sum);
      expect(query.transformAsRate).toBeUndefined();
    }
  });

  test.each([
    {
      title: "Read & Write Latency",
      metricName: "purefa_array_performance_latency_usec",
      read: "usec_per_read_op",
      write: "usec_per_write_op",
      legendUnit: "µs",
    },
    {
      title: "Read & Write IOPS",
      metricName: "purefa_array_performance_throughput_iops",
      read: "reads_per_sec",
      write: "writes_per_sec",
      legendUnit: "ops/s",
    },
    {
      title: "Read & Write Bandwidth",
      metricName: "purefa_array_performance_bandwidth_bytes",
      read: "read_bytes_per_sec",
      write: "write_bytes_per_sec",
      legendUnit: "bytes/s",
    },
  ])(
    "$title charts read (query a) against write (query b) on one chart",
    (expectation: {
      title: string;
      metricName: string;
      read: string;
      write: string;
      legendUnit: string;
    }) => {
      const queries: Array<StoredQuery> = queriesOf(
        componentTitled(DashboardComponentType.Chart, expectation.title),
      );

      expect(queries).toHaveLength(2);
      expect(queries[0]).toMatchObject({
        metricVariable: "a",
        legend: "Read",
        legendUnit: expectation.legendUnit,
        metricName: expectation.metricName,
        attributes: { dimension: expectation.read },
      });
      expect(queries[1]).toMatchObject({
        metricVariable: "b",
        legend: "Write",
        legendUnit: expectation.legendUnit,
        metricName: expectation.metricName,
        attributes: { dimension: expectation.write },
      });
    },
  );

  test("charts critical and warning alerts, never the hidden or info ones", () => {
    const queries: Array<StoredQuery> = queriesOf(
      componentTitled(DashboardComponentType.Chart, "Open Alerts"),
    );

    expect(
      queries.map((query: StoredQuery) => {
        return [query.legend, query.metricName, query.attributes];
      }),
    ).toEqual([
      ["Critical", "purefa_alerts_open", { severity: "critical" }],
      ["Warning", "purefa_alerts_open", { severity: "warning" }],
    ]);
    // One series per open alert, valued 1: Max says whether any is open.
    for (const query of queries) {
      expect(query.aggregation).toBe(MetricsAggregationType.Max);
    }
  });

  test("reads capacity in bytes from the capacity and empty space series", () => {
    expect(
      queriesOf(
        componentTitled(DashboardComponentType.Value, "Usable Capacity"),
      )[0]!.attributes,
    ).toEqual({ space: "capacity" });
    expect(
      queriesOf(
        componentTitled(DashboardComponentType.Value, "Free Capacity"),
      )[0]!.attributes,
    ).toEqual({ space: "empty" });
  });

  test("ships one storage array variable bound to resource.storage.array.name", () => {
    const variables: Array<DashboardVariable> = config.variables || [];

    expect(variables).toHaveLength(1);
    expect(variables[0]!.name).toBe("array");
    expect(variables[0]!.label).toBe("Storage Array");
    expect(variables[0]!.type).toBe(DashboardVariableType.TelemetryAttribute);
    expect(variables[0]!.attributeKey).toBe("resource.storage.array.name");
    expect(variables[0]!.isMultiSelect).toBe(false);
  });

  test("includes a log stream for forwarded array syslog", () => {
    expect(componentsOfType(DashboardComponentType.LogStream)).toHaveLength(1);
  });

  test("uses no other product's wording in any widget title", () => {
    for (const component of config.components) {
      const label: string = titleOf(component).toLowerCase();

      expect(label).not.toContain("ceph");
      expect(label).not.toContain("cluster");
      expect(label).not.toContain("pool");
      expect(label).not.toContain("osd");
    }
  });

  test("the attribute filters and extra queries it uses leave every other template's queries as they were", () => {
    /*
     * The template helpers grew an attribute filter and additional chart
     * queries for this template. Both are written only when asked for, so no
     * other template's stored widgets change shape.
     */
    for (const type of Object.values(DashboardTemplateType)) {
      if (
        type === DashboardTemplateType.StorageArray ||
        type === DashboardTemplateType.Blank
      ) {
        continue;
      }

      const other: DashboardViewConfig | null = getTemplateConfig(type);

      for (const component of other?.components || []) {
        const args: Record<string, unknown> = argsOf(component);
        expect({ type, extraQueries: args["metricQueryConfigs"] }).toEqual({
          type,
          extraQueries: undefined,
        });

        const queryConfig: Record<string, unknown> | undefined = args[
          "metricQueryConfig"
        ] as Record<string, unknown> | undefined;
        const filterData: Record<string, unknown> | undefined = (
          queryConfig?.["metricQueryData"] as
            | Record<string, unknown>
            | undefined
        )?.["filterData"] as Record<string, unknown> | undefined;

        expect({
          type,
          hasAttributes: Boolean(
            filterData &&
              Object.prototype.hasOwnProperty.call(filterData, "attributes"),
          ),
        }).toEqual({ type, hasAttributes: false });
      }
    }
  });
});
