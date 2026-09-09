import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import PublicDashboardResourceListPolicy, {
  PublicDashboardResourceListPolicyResult,
} from "../../../Server/Utils/Dashboard/PublicDashboardResourceListPolicy";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import {
  ComponentArgument,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { DashboardVariableType } from "../../../Types/Dashboard/DashboardVariable";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import DashboardVMwareVirtualMachineListComponentUtil from "../../../Utils/Dashboard/Components/DashboardVMwareVirtualMachineListComponent";
import DashboardVMwareHostListComponentUtil from "../../../Utils/Dashboard/Components/DashboardVMwareHostListComponent";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import {
  WIDGET_CATALOG,
  WidgetCatalogCategory,
  WidgetCatalogItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/WidgetCatalog";

/*
 * The two VMware custom-dashboard widgets are React components, but the
 * things that make them work on a PUBLIC dashboard are plain strings that
 * have to agree with the server policy byte for byte: the `kind` the query
 * is pinned to, the `publicResourceType` URL segment, the filter values the
 * policy whitelists through optionalEnum, the attribute -> column map used
 * for dashboard-variable interpolation, and the select (the server's is
 * authoritative, the client's must not drift). A mismatch produces no error
 * anywhere - the public dashboard just silently ignores a filter, drops a
 * column, or lists the wrong kind. So this suite reads the component source
 * and checks each of those strings against the server side.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMPONENTS_DIR: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "Dashboard",
);

type ReadSourceFunction = (relativePath: string) => string;

const readSource: ReadSourceFunction = (relativePath: string): string => {
  return fs.readFileSync(path.join(COMPONENTS_DIR, relativePath), "utf8");
};

const HOST_SOURCE: string = readSource(
  path.join("Components", "DashboardVMwareHostListComponent.tsx"),
);
const VM_SOURCE: string = readSource(
  path.join("Components", "DashboardVMwareVirtualMachineListComponent.tsx"),
);

type ExtractBlockFunction = (source: string, declaration: string) => string;

/*
 * Returns the body of a top-level `const NAME: Type = {` ... `};` object
 * literal. Both widgets declare BASE_SELECT and ATTRIBUTE_TO_COLUMN this
 * way at module scope.
 */
const extractBlock: ExtractBlockFunction = (
  source: string,
  declaration: string,
): string => {
  const start: number = source.indexOf(declaration);
  if (start < 0) {
    throw new Error(`Declaration "${declaration}" not found.`);
  }
  const end: number = source.indexOf("\n};", start);
  if (end < 0) {
    throw new Error(`Declaration "${declaration}" is not terminated.`);
  }
  return source.slice(start + declaration.length, end);
};

type ExtractTopLevelKeysFunction = (block: string) => Array<string>;

const extractTopLevelKeys: ExtractTopLevelKeysFunction = (
  block: string,
): Array<string> => {
  const keys: Array<string> = [];
  for (const match of block.matchAll(/^ {2}([A-Za-z_]\w*):/gm)) {
    keys.push(match[1] as string);
  }
  return keys;
};

type ExtractStringMapFunction = (block: string) => Record<string, string>;

const extractStringMap: ExtractStringMapFunction = (
  block: string,
): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const match of block.matchAll(/"([^"]+)":\s*"([^"]+)"/g)) {
    map[match[1] as string] = match[2] as string;
  }
  return map;
};

type ExtractFilterValuesFunction = (
  source: string,
  argumentName: string,
) => Array<string>;

/* Every literal the widget compares `args.<argumentName>` against. */
const extractFilterValues: ExtractFilterValuesFunction = (
  source: string,
  argumentName: string,
): Array<string> => {
  const values: Array<string> = [];
  const pattern: RegExp = new RegExp(
    `args\\.${argumentName}\\s*===\\s*"([^"]*)"`,
    "g",
  );
  for (const match of source.matchAll(pattern)) {
    values.push(match[1] as string);
  }
  return values;
};

type DropdownValuesFunction = (
  args: Array<ComponentArgument<DashboardBaseComponent>>,
  id: string,
) => Array<string>;

/* Non-empty option values of a widget-settings dropdown ("" means "all"). */
const dropdownValues: DropdownValuesFunction = (
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

type BuildPolicyFunction = (data: {
  componentType: DashboardComponentType;
  argumentsObject?: JSONObject | undefined;
  storedVariables?: Array<JSONObject> | undefined;
  requestedVariables?: Array<JSONObject> | undefined;
}) => PublicDashboardResourceListPolicyResult;

const buildPolicy: BuildPolicyFunction = (data: {
  componentType: DashboardComponentType;
  argumentsObject?: JSONObject | undefined;
  storedVariables?: Array<JSONObject> | undefined;
  requestedVariables?: Array<JSONObject> | undefined;
}): PublicDashboardResourceListPolicyResult => {
  return PublicDashboardResourceListPolicy.build({
    widget: {
      componentType: data.componentType,
      arguments: data.argumentsObject || {},
    },
    dashboardViewConfig: {
      components: [],
      variables: data.storedVariables || [],
    },
    requestedVariables: data.requestedVariables || [],
    requestedQuery: {},
  });
};

const VM_ARGS: Array<ComponentArgument<DashboardBaseComponent>> =
  DashboardVMwareVirtualMachineListComponentUtil.getComponentConfigArguments() as Array<
    ComponentArgument<DashboardBaseComponent>
  >;

const HOST_ARGS: Array<ComponentArgument<DashboardBaseComponent>> =
  DashboardVMwareHostListComponentUtil.getComponentConfigArguments() as Array<
    ComponentArgument<DashboardBaseComponent>
  >;

interface WidgetSpec {
  label: string;
  source: string;
  componentType: DashboardComponentType;
  kind: string;
  listPageMapKey: PageMap;
  detailPageMapKey: PageMap;
  /* Route keys of OTHER products the file must not link to. */
  foreignRouteFragment: string;
}

const WIDGETS: Array<WidgetSpec> = [
  {
    label: "host",
    source: HOST_SOURCE,
    componentType: DashboardComponentType.VMwareHostList,
    kind: "Host",
    listPageMapKey: PageMap.VMWARE_VCENTER_VIEW_HOSTS,
    detailPageMapKey: PageMap.VMWARE_VCENTER_VIEW_HOST_DETAIL,
    foreignRouteFragment: "PROXMOX_",
  },
  {
    label: "virtual machine",
    source: VM_SOURCE,
    componentType: DashboardComponentType.VMwareVirtualMachineList,
    kind: "VirtualMachine",
    listPageMapKey: PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINES,
    detailPageMapKey: PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINE_DETAIL,
    foreignRouteFragment: "PROXMOX_",
  },
];

describe("VMware dashboard widgets", () => {
  describe.each(WIDGETS)("$label widget", (spec: WidgetSpec) => {
    test("pins the query to its VMwareResource kind", () => {
      expect(spec.source).toContain(`kind: "${spec.kind}",`);

      const policy: PublicDashboardResourceListPolicyResult = buildPolicy({
        componentType: spec.componentType,
      });
      expect(policy.query["kind"]).toBe(spec.kind);
    });

    test("uses the vmware-resource public resource type the server registers", () => {
      expect(spec.source).toContain('publicResourceType="vmware-resource"');
      expect(
        buildPolicy({ componentType: spec.componentType }).resourceType,
      ).toBe("vmware-resource");
    });

    test("scopes to the selected vCenters through vmwareVCenterIds", () => {
      expect(spec.source).toContain("args.vmwareVCenterIds");
      expect(spec.source).toContain('["vmwareVCenterId"] = new Includes(');

      const policy: PublicDashboardResourceListPolicyResult = buildPolicy({
        componentType: spec.componentType,
        argumentsObject: { vmwareVCenterIds: ["vc-1", "vc-2"] },
      });
      expect(policy.query["vmwareVCenterId"]).toBeDefined();
    });

    test("selects exactly the server projection plus lastSeenAt", () => {
      const clientKeys: Array<string> = extractTopLevelKeys(
        extractBlock(
          spec.source,
          "const BASE_SELECT: Select<VMwareResource> = {",
        ),
      ).sort();

      const serverSelect: JSONObject = buildPolicy({
        componentType: spec.componentType,
      }).select;
      const serverKeys: Array<string> = [
        ...Object.keys(serverSelect),
        "lastSeenAt",
      ].sort();

      expect(clientKeys).toEqual(serverKeys);
      expect(serverSelect["vmwareVCenter"]).toEqual({ name: true });
      expect(spec.source).toContain("vmwareVCenter: {\n    name: true,\n  },");
    });

    test("maps the same vSphere attributes to the same columns as the server policy", () => {
      const clientMap: Record<string, string> = extractStringMap(
        extractBlock(
          spec.source,
          "const ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {",
        ),
      );
      expect(Object.keys(clientMap).length).toBeGreaterThan(0);
      expect(spec.source).toContain("attributeToColumn={ATTRIBUTE_TO_COLUMN}");

      for (const [attributeKey, column] of Object.entries(clientMap)) {
        const value: string = `value-for-${attributeKey}`;
        const policy: PublicDashboardResourceListPolicyResult = buildPolicy({
          componentType: spec.componentType,
          storedVariables: [
            {
              id: "v",
              name: "V",
              type: DashboardVariableType.TelemetryAttribute,
              attributeKey,
            },
          ],
          requestedVariables: [{ id: "v", selectedValue: value }],
        });
        expect({ attributeKey, query: policy.query }).toEqual({
          attributeKey,
          query: { kind: spec.kind, [column]: value },
        });
      }

      /*
       * And nothing the server interpolates is missing on the client, so
       * the authenticated app and the public dashboard narrow alike. The
       * host attribute is the one key both maps share; it lands on a
       * different column for each widget, which the loop above pins.
       */
      const unknownAttribute: PublicDashboardResourceListPolicyResult =
        buildPolicy({
          componentType: spec.componentType,
          storedVariables: [
            {
              id: "v",
              name: "V",
              type: DashboardVariableType.TelemetryAttribute,
              attributeKey: "vcenter.datastore.name",
            },
          ],
          requestedVariables: [{ id: "v", selectedValue: "ds-1" }],
        });
      expect(unknownAttribute.query).toEqual({ kind: spec.kind });
      expect(clientMap["vcenter.datastore.name"]).toBeUndefined();
    });

    test("deep-links to the vCenter pages with the percent-encoded externalId", () => {
      expect(spec.source).toContain(`PageMap.${spec.listPageMapKey}`);
      expect(spec.source).toContain(`PageMap.${spec.detailPageMapKey}`);
      expect(spec.source).toContain(
        "subModelId: encodeURIComponent(externalId),",
      );
      expect(spec.source).not.toContain(spec.foreignRouteFragment);

      const listRoute: Route | undefined = RouteMap[spec.listPageMapKey];
      const detailRoute: Route | undefined = RouteMap[spec.detailPageMapKey];
      expect(listRoute).toBeDefined();
      expect(detailRoute).toBeDefined();
      expect(detailRoute?.toString()).toContain(":subModelId");
      expect(detailRoute?.toString().startsWith(listRoute!.toString())).toBe(
        true,
      );
    });

    test("carries no Proxmox-only concepts", () => {
      for (const forbidden of [
        "Proxmox",
        "proxmox",
        "pve",
        "qemu",
        "lxc",
        "haState",
        "isUp",
        "guest",
      ]) {
        expect({ forbidden, present: spec.source.includes(forbidden) }).toEqual(
          { forbidden, present: false },
        );
      }
    });

    test("is registered in the render map and the add-widget dispatch", () => {
      const baseComponent: string = readSource(
        path.join("Components", "DashboardBaseComponent.tsx"),
      );
      const dashboardView: string = readSource("DashboardView.tsx");

      expect(baseComponent).toMatch(
        new RegExp(`\\[DashboardComponentType\\.${spec.componentType}\\]:`),
      );
      expect(dashboardView).toContain(
        `componentType === DashboardComponentType.${spec.componentType}`,
      );
    });
  });

  describe("host widget filters", () => {
    test("offers no status filter because the vcenter receiver reports no per-host state", () => {
      const ids: Array<string> = HOST_ARGS.map(
        (argument: ComponentArgument<DashboardBaseComponent>) => {
          return argument.id as string;
        },
      );
      expect(ids).toEqual(["title", "maxRows", "viewMode", "vmwareVCenterIds"]);

      expect(HOST_SOURCE).not.toContain("statusFilter");
      expect(HOST_SOURCE).not.toContain("powerStateFilter");
      expect(HOST_SOURCE).not.toContain("templateFilter");

      const policy: PublicDashboardResourceListPolicyResult = buildPolicy({
        componentType: DashboardComponentType.VMwareHostList,
        argumentsObject: { statusFilter: "online", powerStateFilter: "on" },
      });
      expect(policy.query).toEqual({ kind: "Host" });
    });
  });

  describe("virtual machine widget filters", () => {
    test("power state values are byte-identical across settings, widget query and public policy", () => {
      const settingValues: Array<string> = dropdownValues(
        VM_ARGS,
        "powerStateFilter",
      );
      const widgetValues: Array<string> = extractFilterValues(
        VM_SOURCE,
        "powerStateFilter",
      );

      expect(settingValues).toEqual(["on", "off"]);
      expect(widgetValues).toEqual(settingValues);

      expect(
        buildPolicy({
          componentType: DashboardComponentType.VMwareVirtualMachineList,
          argumentsObject: { powerStateFilter: "on" },
        }).query,
      ).toEqual({ kind: "VirtualMachine", isPoweredOn: true });
      expect(
        buildPolicy({
          componentType: DashboardComponentType.VMwareVirtualMachineList,
          argumentsObject: { powerStateFilter: "off" },
        }).query,
      ).toEqual({ kind: "VirtualMachine", isPoweredOn: false });

      /*
       * "" is the settings dropdown's "All" option and means no filter;
       * any other spelling is rejected by the server rather than silently
       * widened to "all", so a drifted client value fails loudly.
       */
      expect(
        buildPolicy({
          componentType: DashboardComponentType.VMwareVirtualMachineList,
          argumentsObject: { powerStateFilter: "" },
        }).query,
      ).toEqual({ kind: "VirtualMachine" });
      for (const stray of ["poweredOn", "running", "suspended"]) {
        expect(() => {
          return buildPolicy({
            componentType: DashboardComponentType.VMwareVirtualMachineList,
            argumentsObject: { powerStateFilter: stray },
          });
        }).toThrow(BadDataException);
      }

      expect(VM_SOURCE).toContain('["isPoweredOn"] = true;');
      expect(VM_SOURCE).toContain('["isPoweredOn"] = false;');
    });

    test("template values are byte-identical across settings, widget query and public policy", () => {
      const settingValues: Array<string> = dropdownValues(
        VM_ARGS,
        "templateFilter",
      );
      const widgetValues: Array<string> = extractFilterValues(
        VM_SOURCE,
        "templateFilter",
      );

      expect(settingValues).toEqual(["exclude", "only"]);
      expect(widgetValues).toEqual(settingValues);

      expect(
        buildPolicy({
          componentType: DashboardComponentType.VMwareVirtualMachineList,
          argumentsObject: { templateFilter: "exclude" },
        }).query,
      ).toEqual({ kind: "VirtualMachine", isTemplate: false });
      expect(
        buildPolicy({
          componentType: DashboardComponentType.VMwareVirtualMachineList,
          argumentsObject: { templateFilter: "only" },
        }).query,
      ).toEqual({ kind: "VirtualMachine", isTemplate: true });

      expect(
        buildPolicy({
          componentType: DashboardComponentType.VMwareVirtualMachineList,
          argumentsObject: { templateFilter: "" },
        }).query,
      ).toEqual({ kind: "VirtualMachine" });
      for (const stray of ["include", "true", "templates"]) {
        expect(() => {
          return buildPolicy({
            componentType: DashboardComponentType.VMwareVirtualMachineList,
            argumentsObject: { templateFilter: stray },
          });
        }).toThrow(BadDataException);
      }

      expect(VM_SOURCE).toContain('["isTemplate"] = false;');
      expect(VM_SOURCE).toContain('["isTemplate"] = true;');
    });

    test("renders power state and template badges from the selected columns", () => {
      expect(VM_SOURCE).toContain("isPoweredOn: true,");
      expect(VM_SOURCE).toContain("isTemplate: true,");
      expect(VM_SOURCE).toContain('"Powered on"');
      expect(VM_SOURCE).toContain('"Powered off"');
      expect(VM_SOURCE).toContain('"Template"');
      expect(VM_SOURCE).toContain("hostName: true,");
    });
  });

  describe("shared registrations", () => {
    test("the public resource type union accepts vmware-resource", () => {
      const union: string = readSource(
        path.join("Utils", "DashboardResourceList.ts"),
      );
      expect(union).toContain('| "vmware-resource"');
    });

    test("the vCenter entity filter resolves to the VMwareVCenter model", () => {
      const dropdown: string = readSource(
        path.join("Canvas", "EntityFilterDropdown.tsx"),
      );
      expect(dropdown).toContain(
        'import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";',
      );
      expect(dropdown).toContain("case EntityFilterModelType.VMwareVCenter:");
      expect(dropdown).toContain(
        "modelType: VMwareVCenter as unknown as ModelTypeOf<BaseModel>,",
      );
    });

    test("the widget catalog lists both widgets under VMware, between Proxmox and Ceph", () => {
      const names: Array<string> = WIDGET_CATALOG.map(
        (category: WidgetCatalogCategory) => {
          return category.name;
        },
      );
      const vmwareIndex: number = names.indexOf("VMware");
      expect(vmwareIndex).toBeGreaterThan(-1);
      expect(names[vmwareIndex - 1]).toBe("Proxmox");
      expect(names[vmwareIndex + 1]).toBe("Ceph");

      const vmware: WidgetCatalogCategory = WIDGET_CATALOG[
        vmwareIndex
      ] as WidgetCatalogCategory;
      expect(
        vmware.items.map((item: WidgetCatalogItem) => {
          return item.type;
        }),
      ).toEqual([
        DashboardComponentType.VMwareHostList,
        DashboardComponentType.VMwareVirtualMachineList,
      ]);

      /* The Ceph OSD wall owns the word "honeycomb" in catalog search. */
      const copy: string = [
        vmware.name,
        vmware.description,
        ...vmware.items.flatMap((item: WidgetCatalogItem) => {
          return [item.label, item.description, ...item.keywords];
        }),
      ]
        .join(" ")
        .toLowerCase();
      expect(copy).not.toContain("honeycomb");
      expect(copy).toContain("esxi");
      expect(copy).toContain("vcenter");
    });
  });
});
