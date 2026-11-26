import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import PublicDashboardResourceListPolicy, {
  PublicDashboardResourceListPolicyResult,
} from "../../../Server/Utils/Dashboard/PublicDashboardResourceListPolicy";
import PublicDashboardViewConfig from "../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import {
  ComponentArgument,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { DashboardVariableType } from "../../../Types/Dashboard/DashboardVariable";
import BadDataException from "../../../Types/Exception/BadDataException";
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import XcpNgResourceKind from "../../../Types/XcpNg/XcpNgResourceKind";
import DashboardXcpNgHostListComponentUtil from "../../../Utils/Dashboard/Components/DashboardXcpNgHostListComponent";
import DashboardXcpNgVmListComponentUtil from "../../../Utils/Dashboard/Components/DashboardXcpNgVmListComponent";
import {
  XCP_NG_HOST_ATTRIBUTE_TO_COLUMN,
  XCP_NG_HOST_STATUS_FILTER_VALUES,
  XCP_NG_HOST_WIDGET_SELECT,
  XCP_NG_VM_ATTRIBUTE_TO_COLUMN,
  XCP_NG_VM_STATUS_FILTER_VALUES,
  XCP_NG_VM_WIDGET_SELECT,
  getXcpNgHostListQuery,
  getXcpNgHostStatusFilterQuery,
  getXcpNgVmListQuery,
  getXcpNgVmStatusFilterQuery,
} from "../../../Utils/Dashboard/Components/DashboardXcpNgResourceListShared";
import { DASHBOARD_WIDGET_ID_LIST_SETTINGS } from "../../../Utils/Dashboard/DashboardWidgetIds";
import {
  PUBLIC_DASHBOARD_WIDGET_SETTINGS,
  PublicDashboardWidgetSettings,
} from "../../../Types/Dashboard/PublicDashboardServedSettings";
import {
  WIDGET_CATALOG,
  WidgetCatalogCategory,
  WidgetCatalogItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/WidgetCatalog";

/*
 * The two XCP-ng custom-dashboard widgets are React components, but what
 * makes them work on a PUBLIC dashboard are plain values that have to
 * agree with the server policy exactly: the kind the query is pinned to
 * (and, for VMs, the control domains left out), the `publicResourceType`
 * URL segment, the status filter values the policy whitelists, what each
 * value reads, the dashboard variables that narrow a list and the columns
 * read. A mismatch produces no error anywhere - the public dashboard just
 * silently ignores a filter, drops a column, or lists the wrong rows.
 *
 * Unlike the older product widgets, both sides read those values from one
 * module (DashboardXcpNgResourceListShared). This suite holds the widgets'
 * source and the server policy to that module, the way
 * DashboardStorageArrayWidgets does for the Storage Array widgets.
 */

const COMPONENTS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Dashboard",
);

const readSource: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(COMPONENTS_DIR, relativePath), "utf8");
};

const HOST_SOURCE: string = readSource(
  path.join("Components", "DashboardXcpNgHostListComponent.tsx"),
);
const VM_SOURCE: string = readSource(
  path.join("Components", "DashboardXcpNgVmListComponent.tsx"),
);

const buildPolicy: (data: {
  componentType: DashboardComponentType;
  argumentsObject?: JSONObject | undefined;
  storedVariables?: Array<JSONObject> | undefined;
  requestedVariables?: Array<JSONObject> | undefined;
  requestedQuery?: JSONObject | undefined;
}) => PublicDashboardResourceListPolicyResult = (data: {
  componentType: DashboardComponentType;
  argumentsObject?: JSONObject | undefined;
  storedVariables?: Array<JSONObject> | undefined;
  requestedVariables?: Array<JSONObject> | undefined;
  requestedQuery?: JSONObject | undefined;
}): PublicDashboardResourceListPolicyResult => {
  return PublicDashboardResourceListPolicy.build({
    widget: {
      componentType: data.componentType,
      arguments: data.argumentsObject || {},
    },
    // The variables as the public page's toolbar draws them.
    variables: PublicDashboardViewConfig.getDrawnConfig({
      components: [],
      variables: data.storedVariables || [],
    }).variables,
    requestedVariables: data.requestedVariables || [],
    requestedQuery: data.requestedQuery || {},
  });
};

// Non-empty option values of a widget-settings dropdown ("" means "all").
const dropdownValues: (
  args: Array<ComponentArgument<DashboardBaseComponent>>,
  id: string,
) => Array<string> = (
  args: Array<ComponentArgument<DashboardBaseComponent>>,
  id: string,
): Array<string> => {
  const argument: ComponentArgument<DashboardBaseComponent> | undefined =
    args.find((candidate: ComponentArgument<DashboardBaseComponent>) => {
      return (candidate.id as string) === id;
    });

  if (!argument) {
    throw new Error(`Dropdown "${id}" not found in widget settings.`);
  }

  expect(argument.type).toBe(ComponentInputType.Dropdown);

  return (argument.dropdownOptions || [])
    .map((option: { value: string | number | boolean }) => {
      return String(option.value);
    })
    .filter((value: string) => {
      return value.length > 0;
    });
};

const variable: (attributeKey: string) => Array<JSONObject> = (
  attributeKey: string,
): Array<JSONObject> => {
  return [
    {
      id: "v",
      name: "V",
      type: DashboardVariableType.TelemetryAttribute,
      attributeKey,
    },
  ];
};

interface WidgetSpec {
  label: string;
  source: string;
  componentType: DashboardComponentType;
  // The query the widget always reads, as the policy pins it.
  pinnedQuery: JSONObject;
  queryHelper: string;
  statusValues: ReadonlyArray<string>;
  statusQuery: (value: string | undefined) => Record<string, unknown>;
  select: JSONObject;
  selectConstant: string;
  attributeToColumn: Record<string, string>;
  attributeConstant: string;
  settings: Array<ComponentArgument<DashboardBaseComponent>>;
}

const WIDGETS: Array<WidgetSpec> = [
  {
    label: "hosts",
    source: HOST_SOURCE,
    componentType: DashboardComponentType.XcpNgHostList,
    pinnedQuery: { kind: "Host" },
    queryHelper: "getXcpNgHostListQuery()",
    statusValues: XCP_NG_HOST_STATUS_FILTER_VALUES,
    statusQuery: getXcpNgHostStatusFilterQuery,
    select: XCP_NG_HOST_WIDGET_SELECT as unknown as JSONObject,
    selectConstant: "XCP_NG_HOST_WIDGET_SELECT",
    attributeToColumn: XCP_NG_HOST_ATTRIBUTE_TO_COLUMN,
    attributeConstant: "XCP_NG_HOST_ATTRIBUTE_TO_COLUMN",
    settings:
      DashboardXcpNgHostListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >,
  },
  {
    label: "VMs",
    source: VM_SOURCE,
    componentType: DashboardComponentType.XcpNgVmList,
    pinnedQuery: { kind: "VM", isControlDomain: false },
    queryHelper: "getXcpNgVmListQuery()",
    statusValues: XCP_NG_VM_STATUS_FILTER_VALUES,
    statusQuery: getXcpNgVmStatusFilterQuery,
    select: XCP_NG_VM_WIDGET_SELECT as unknown as JSONObject,
    selectConstant: "XCP_NG_VM_WIDGET_SELECT",
    attributeToColumn: XCP_NG_VM_ATTRIBUTE_TO_COLUMN,
    attributeConstant: "XCP_NG_VM_ATTRIBUTE_TO_COLUMN",
    settings:
      DashboardXcpNgVmListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >,
  },
];

describe("XCP-ng dashboard widgets", () => {
  describe.each(WIDGETS)("the $label widget", (spec: WidgetSpec) => {
    test("reads the query the policy pins, from the module both share", () => {
      expect(buildPolicy({ componentType: spec.componentType }).query).toEqual(
        spec.pinnedQuery,
      );
      expect(spec.source).toContain(`...${spec.queryHelper},`);
    });

    test("never takes a kind, a project or a control domain from the caller", () => {
      const policy: PublicDashboardResourceListPolicyResult = buildPolicy({
        componentType: spec.componentType,
        argumentsObject: { kind: "StorageRepository", isControlDomain: true },
        requestedQuery: {
          kind: "VDI",
          projectId: "another-project",
          isControlDomain: true,
        },
      });

      expect(policy.query).toEqual(spec.pinnedQuery);
    });

    test("uses the xcp-ng-resource public resource type the server registers", () => {
      expect(spec.source).toContain('publicResourceType="xcp-ng-resource"');
      expect(
        buildPolicy({ componentType: spec.componentType }).resourceType,
      ).toBe("xcp-ng-resource");
    });

    test("scopes to the selected pools through xcpNgPoolIds", () => {
      expect(spec.source).toContain("args.xcpNgPoolIds");
      expect(spec.source).toContain('["xcpNgPoolId"] = new Includes(');

      expect(
        buildPolicy({
          componentType: spec.componentType,
          argumentsObject: { xcpNgPoolIds: ["pool-1", "pool-2"] },
        }).query["xcpNgPoolId"],
      ).toEqual(new Includes(["pool-1", "pool-2"]));
    });

    test("its pool filter is the XCP-ng pool picker, an id setting every board reads as ids", () => {
      const pools: ComponentArgument<DashboardBaseComponent> | undefined =
        spec.settings.find(
          (argument: ComponentArgument<DashboardBaseComponent>) => {
            return (argument.id as string) === "xcpNgPoolIds";
          },
        );

      expect(pools?.type).toBe(ComponentInputType.EntityMultiSelectDropdown);
      expect(pools?.entityFilterModelType).toBe(
        EntityFilterModelType.XcpNgPool,
      );
      expect(DASHBOARD_WIDGET_ID_LIST_SETTINGS).toContain("xcpNgPoolIds");
    });

    test("reads exactly the columns the server reads for it", () => {
      expect(spec.source).toContain(
        `${spec.selectConstant} as Select<XcpNgResource>`,
      );

      const serverSelect: JSONObject = buildPolicy({
        componentType: spec.componentType,
      }).select;

      expect(serverSelect).toEqual(spec.select);
      expect(serverSelect["xcpNgPool"]).toEqual({ name: true });

      // A copy: a read that adds a sort's columns never changes the widget's.
      (serverSelect["xcpNgPool"] as JSONObject)["slug"] = true;
      expect(spec.select["xcpNgPool"]).toEqual({ name: true });
    });

    test("its status filter offers exactly the values the policy accepts", () => {
      expect(dropdownValues(spec.settings, "statusFilter")).toEqual([
        ...spec.statusValues,
      ]);
    });

    test.each(
      spec.statusValues.map((value: string) => {
        return [value];
      }),
    )(
      "status %s reads the same rows on a board and on a public dashboard",
      (value: string) => {
        const expected: Record<string, unknown> = spec.statusQuery(value);

        expect(Object.keys(expected).length).toBeGreaterThan(0);
        expect(
          buildPolicy({
            componentType: spec.componentType,
            argumentsObject: { statusFilter: value },
          }).query,
        ).toEqual({ ...spec.pinnedQuery, ...expected });
        expect(spec.source).toContain(
          `...${spec.queryHelper.replace("ListQuery()", "StatusFilterQuery(args.statusFilter)")},`,
        );
      },
    );

    test("a status the widget never offers is refused, and none reads every row", () => {
      expect(() => {
        buildPolicy({
          componentType: spec.componentType,
          argumentsObject: { statusFilter: "rebooting" },
        });
      }).toThrow(BadDataException);

      expect(spec.statusQuery(undefined)).toEqual({});
      expect(spec.statusQuery("")).toEqual({});
      expect(spec.statusQuery("rebooting")).toEqual({});
      expect(
        buildPolicy({
          componentType: spec.componentType,
          argumentsObject: { statusFilter: "" },
        }).query,
      ).toEqual(spec.pinnedQuery);
    });

    test("a dashboard variable narrows it on the board and on a public dashboard alike", () => {
      expect(spec.source).toContain(
        `attributeToColumn={${spec.attributeConstant}}`,
      );

      for (const [attributeKey, column] of Object.entries(
        spec.attributeToColumn,
      )) {
        expect(
          buildPolicy({
            componentType: spec.componentType,
            storedVariables: variable(attributeKey),
            requestedVariables: [{ id: "v", selectedValue: "xcp-host-01" }],
          }).query,
        ).toEqual({ ...spec.pinnedQuery, [column]: "xcp-host-01" });
      }
    });

    test("a variable on an attribute the widget does not map narrows nothing", () => {
      for (const attributeKey of [
        "xcp_ng.id",
        "pool_name",
        "resource.xcp_ng.pool.name",
      ]) {
        expect(
          buildPolicy({
            componentType: spec.componentType,
            storedVariables: variable(attributeKey),
            requestedVariables: [{ id: "v", selectedValue: "anything" }],
          }).query,
        ).toEqual(spec.pinnedQuery);
      }
    });

    test("is served every setting it has on a public dashboard", () => {
      const settings: PublicDashboardWidgetSettings =
        PUBLIC_DASHBOARD_WIDGET_SETTINGS[
          spec.componentType as keyof typeof PUBLIC_DASHBOARD_WIDGET_SETTINGS
        ];

      expect(settings.withheld).toEqual([]);
      expect(settings.served).toEqual(
        expect.arrayContaining([
          "title",
          "maxRows",
          "viewMode",
          "xcpNgPoolIds",
          "statusFilter",
        ]),
      );
    });

    test("is registered in the render map and the add-widget dispatch", () => {
      const renderMap: string = readSource(
        path.join("Components", "DashboardBaseComponent.tsx"),
      );
      const view: string = readSource("DashboardView.tsx");

      expect(renderMap).toContain(
        `[DashboardComponentType.${
          spec.componentType
        }]: Dashboard${spec.componentType}Component,`,
      );
      expect(view).toContain(
        `componentType === DashboardComponentType.${spec.componentType}`,
      );
      expect(view).toContain(
        `Dashboard${spec.componentType}ComponentUtil.getDefaultComponent()`,
      );
    });

    test("carries no other product's concepts", () => {
      // A VM's "guest tools" are XCP-ng's own words; a Proxmox guest is not.
      for (const word of [
        "proxmox",
        "Proxmox",
        "pve",
        "qemu",
        "lxc",
        "vcenter",
        "vmware",
        "VMware",
        "ProxmoxResource",
        "VMwareResource",
      ]) {
        expect({ word, found: spec.source.includes(word) }).toEqual({
          word,
          found: false,
        });
      }
    });
  });

  describe("the hosts widget", () => {
    test("links a host to its page in its pool, by its UUID as one path segment", () => {
      expect(HOST_SOURCE).toContain("PageMap.XCP_NG_POOL_VIEW_HOST_DETAIL");
      expect(HOST_SOURCE).toContain("PageMap.XCP_NG_POOL_VIEW_HOSTS");
      expect(HOST_SOURCE).toContain(
        "subModelId: encodeURIComponent(externalId)",
      );
    });

    test("status filters: running, not running, disabled", () => {
      expect(getXcpNgHostStatusFilterQuery("running")).toEqual({ isUp: true });
      expect(getXcpNgHostStatusFilterQuery("not-running")).toEqual({
        isUp: false,
      });
      expect(getXcpNgHostStatusFilterQuery("disabled")).toEqual({
        isEnabled: false,
      });
    });

    test("reads what its rows draw: state, maintenance mode, CPU, memory and pool", () => {
      for (const column of [
        "name",
        "externalId",
        "powerState",
        "isUp",
        "isEnabled",
        "latestCpuPercent",
        "latestMemoryPercent",
        "xcpNgPoolId",
      ]) {
        expect(XCP_NG_HOST_WIDGET_SELECT).toHaveProperty(column, true);
      }

      // A VM's own columns are the VM widget's.
      expect(XCP_NG_HOST_WIDGET_SELECT).not.toHaveProperty("parentHostName");
      expect(XCP_NG_HOST_WIDGET_SELECT).not.toHaveProperty("isControlDomain");
    });

    test("a host_name variable narrows it to that host", () => {
      expect(XCP_NG_HOST_ATTRIBUTE_TO_COLUMN).toEqual({ host_name: "name" });
    });
  });

  describe("the VMs widget", () => {
    test("links a VM to its page in its pool, by its UUID as one path segment", () => {
      expect(VM_SOURCE).toContain("PageMap.XCP_NG_POOL_VIEW_VM_DETAIL");
      expect(VM_SOURCE).toContain("PageMap.XCP_NG_POOL_VIEW_VMS");
      expect(VM_SOURCE).toContain("subModelId: encodeURIComponent(externalId)");
    });

    test("never lists a control domain, the management VM each host runs", () => {
      expect(getXcpNgVmListQuery()).toEqual({
        kind: XcpNgResourceKind.VM,
        isControlDomain: false,
      });

      for (const statusFilter of ["", ...XCP_NG_VM_STATUS_FILTER_VALUES]) {
        expect(
          buildPolicy({
            componentType: DashboardComponentType.XcpNgVmList,
            argumentsObject: { statusFilter },
          }).query["isControlDomain"],
        ).toBe(false);
      }
    });

    test("status filters: running and not running (halted, paused or suspended)", () => {
      expect(getXcpNgVmStatusFilterQuery("running")).toEqual({ isUp: true });
      expect(getXcpNgVmStatusFilterQuery("not-running")).toEqual({
        isUp: false,
      });
      // A host's filter means nothing to a VM.
      expect(getXcpNgVmStatusFilterQuery("disabled")).toEqual({});
    });

    test("reads what its rows draw: state, CPU, memory, its host and pool", () => {
      for (const column of [
        "name",
        "externalId",
        "powerState",
        "isUp",
        "parentHostName",
        "latestCpuPercent",
        "latestMemoryPercent",
        "xcpNgPoolId",
      ]) {
        expect(XCP_NG_VM_WIDGET_SELECT).toHaveProperty(column, true);
      }

      expect(XCP_NG_VM_WIDGET_SELECT).not.toHaveProperty("isEnabled");
    });

    test("a vm_name variable narrows it to that VM, a host_name one to the VMs that host runs", () => {
      expect(XCP_NG_VM_ATTRIBUTE_TO_COLUMN).toEqual({
        vm_name: "name",
        host_name: "parentHostName",
      });
    });
  });

  describe("shared registrations", () => {
    test("the hosts list reads the Host kind the inventory stores", () => {
      expect(getXcpNgHostListQuery()).toEqual({ kind: XcpNgResourceKind.Host });
    });

    test("the public resource type union accepts xcp-ng-resource", () => {
      expect(
        readSource(path.join("Utils", "DashboardResourceList.ts")),
      ).toContain('| "xcp-ng-resource"');
    });

    test("the pool picker resolves to the XcpNgPool model", () => {
      const dropdown: string = readSource(
        path.join("Canvas", "EntityFilterDropdown.tsx"),
      );

      expect(dropdown).toContain(
        'import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";',
      );
      expect(dropdown).toContain("case EntityFilterModelType.XcpNgPool:");
      expect(dropdown).toContain(
        "modelType: XcpNgPool as unknown as ModelTypeOf<BaseModel>,",
      );
    });

    test("the widget catalog lists both widgets under XCP-ng, right after VMware", () => {
      const names: Array<string> = WIDGET_CATALOG.map(
        (category: WidgetCatalogCategory) => {
          return category.name;
        },
      );
      const index: number = names.indexOf("XCP-ng");

      expect(index).toBeGreaterThan(-1);
      expect(names[index - 1]).toBe("VMware");

      const category: WidgetCatalogCategory = WIDGET_CATALOG[
        index
      ] as WidgetCatalogCategory;

      expect(
        category.items.map((item: WidgetCatalogItem) => {
          return item.type;
        }),
      ).toEqual([
        DashboardComponentType.XcpNgHostList,
        DashboardComponentType.XcpNgVmList,
      ]);
      expect(
        category.items.map((item: WidgetCatalogItem) => {
          return item.name;
        }),
      ).toEqual(["XCP-ng Hosts", "XCP-ng VMs"]);

      // Found by the words people search the catalog with.
      for (const item of category.items) {
        for (const keyword of ["xcp-ng", "xen", "xen orchestra"]) {
          expect(item.keywords).toContain(keyword);
        }
      }

      const copy: string = [
        category.name,
        category.description,
        ...category.items.flatMap((item: WidgetCatalogItem) => {
          return [item.label, item.description, ...item.keywords];
        }),
      ]
        .join(" ")
        .toLowerCase();

      expect(copy).not.toContain("proxmox");
      expect(copy).not.toContain("vmware");
      expect(copy).not.toContain("vcenter");
    });
  });
});
