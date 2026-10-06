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
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import DashboardStorageArrayHardwareListComponentUtil from "../../../Utils/Dashboard/Components/DashboardStorageArrayHardwareListComponent";
import {
  STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES,
  STORAGE_ARRAY_HARDWARE_WIDGET_KINDS,
  STORAGE_ARRAY_WARNING_COMPONENT_STATUSES,
} from "../../../Utils/Dashboard/Components/DashboardStorageArrayResourceListShared";
import { STORAGE_ARRAY_HEALTHY_COMPONENT_STATUSES } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/StorageArrayWidgetData";
import {
  CRITICAL_RESOURCE_STATUSES,
  HEALTHY_RESOURCE_STATUSES,
  WARNING_RESOURCE_STATUSES,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayResourceUtils";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import {
  WIDGET_CATALOG,
  WidgetCatalogCategory,
  WidgetCatalogItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/WidgetCatalog";

/*
 * The two Storage Array custom-dashboard widgets are React components, but
 * what makes them work on a PUBLIC dashboard are plain strings that have to
 * agree with the server policy byte for byte: the `kind` the query is
 * pinned to, the `publicResourceType` URL segment, the filter values the
 * policy whitelists through optionalEnum, the attribute -> column map used
 * for dashboard-variable interpolation, and the select (the server's is
 * authoritative, the client's must not drift). A mismatch produces no error
 * anywhere — the public dashboard just silently ignores a filter, drops a
 * column, or lists the wrong kind. So this suite reads the component source
 * and checks each of those strings against the server side, the way
 * VMwareDashboardWidgets does for the VMware widgets.
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

const VOLUME_SOURCE: string = readSource(
  path.join("Components", "DashboardStorageArrayVolumeListComponent.tsx"),
);
const HARDWARE_SOURCE: string = readSource(
  path.join("Components", "DashboardStorageArrayHardwareListComponent.tsx"),
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

/* `key: "value"` pairs, with the key bare or quoted. */
const extractStringMap: ExtractStringMapFunction = (
  block: string,
): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const match of block.matchAll(/^ {2}"?([\w.]+)"?:\s*"([^"]+)"/gm)) {
    map[match[1] as string] = match[2] as string;
  }
  return map;
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

const HARDWARE_ARGS: Array<ComponentArgument<DashboardBaseComponent>> =
  DashboardStorageArrayHardwareListComponentUtil.getComponentConfigArguments() as Array<
    ComponentArgument<DashboardBaseComponent>
  >;

const ALL_HARDWARE_KINDS: Includes = new Includes([
  ...STORAGE_ARRAY_HARDWARE_WIDGET_KINDS,
]);

interface WidgetSpec {
  label: string;
  source: string;
  componentType: DashboardComponentType;
  // What the policy pins `kind` to when no filter narrows it.
  pinnedKind: string | Includes;
  // The datapoint label that names one of the widget's objects.
  objectLabel: string;
  // A label the OTHER widget maps, which this one must ignore.
  siblingObjectLabel: string;
}

const WIDGETS: Array<WidgetSpec> = [
  {
    label: "volume",
    source: VOLUME_SOURCE,
    componentType: DashboardComponentType.StorageArrayVolumeList,
    pinnedKind: "Volume",
    objectLabel: "name",
    siblingObjectLabel: "component_name",
  },
  {
    label: "hardware",
    source: HARDWARE_SOURCE,
    componentType: DashboardComponentType.StorageArrayHardwareList,
    pinnedKind: ALL_HARDWARE_KINDS,
    objectLabel: "component_name",
    siblingObjectLabel: "name",
  },
];

describe("Storage Array dashboard widgets", () => {
  describe.each(WIDGETS)("$label widget", (spec: WidgetSpec) => {
    test("pins the query to the StorageArrayResource kind the policy pins", () => {
      const policy: PublicDashboardResourceListPolicyResult = buildPolicy({
        componentType: spec.componentType,
      });
      expect(policy.query["kind"]).toEqual(spec.pinnedKind);

      if (typeof spec.pinnedKind === "string") {
        expect(spec.source).toContain(`kind: "${spec.pinnedKind}",`);
      } else {
        // The hardware widget pins the same shared list the policy does.
        expect(spec.source).toContain(
          "new Includes([...STORAGE_ARRAY_HARDWARE_WIDGET_KINDS])",
        );
      }
    });

    test("uses the storage-array-resource public resource type the server registers", () => {
      expect(spec.source).toContain(
        'publicResourceType="storage-array-resource"',
      );
      expect(
        buildPolicy({ componentType: spec.componentType }).resourceType,
      ).toBe("storage-array-resource");
    });

    test("scopes to the selected storage arrays through storageArrayIds", () => {
      expect(spec.source).toContain("args.storageArrayIds");
      expect(spec.source).toContain('["storageArrayId"] = new Includes(');

      const policy: PublicDashboardResourceListPolicyResult = buildPolicy({
        componentType: spec.componentType,
        argumentsObject: { storageArrayIds: ["array-1", "array-2"] },
      });
      expect(policy.query["storageArrayId"]).toEqual(
        new Includes(["array-1", "array-2"]),
      );
    });

    test("selects exactly the server projection plus lastSeenAt", () => {
      const clientKeys: Array<string> = extractTopLevelKeys(
        extractBlock(
          spec.source,
          "const BASE_SELECT: Select<StorageArrayResource> = {",
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
      expect(serverSelect["storageArray"]).toEqual({ name: true });
      expect(spec.source).toContain("storageArray: {\n    name: true,\n  },");
    });

    test("maps the same object label to the same column as the server policy", () => {
      const clientMap: Record<string, string> = extractStringMap(
        extractBlock(
          spec.source,
          "const ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {",
        ),
      );
      expect(clientMap).toEqual({ [spec.objectLabel]: "externalId" });
      expect(spec.source).toContain("attributeToColumn={ATTRIBUTE_TO_COLUMN}");

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

      expect(
        buildPolicy({
          componentType: spec.componentType,
          storedVariables: variable(spec.objectLabel),
          requestedVariables: [{ id: "v", selectedValue: "object-1" }],
        }).query,
      ).toEqual({ kind: spec.pinnedKind, externalId: "object-1" });

      // The sibling widget's object label narrows nothing here.
      expect(
        buildPolicy({
          componentType: spec.componentType,
          storedVariables: variable(spec.siblingObjectLabel),
          requestedVariables: [{ id: "v", selectedValue: "object-1" }],
        }).query,
      ).toEqual({ kind: spec.pinnedKind });
      expect(clientMap[spec.siblingObjectLabel]).toBeUndefined();
    });

    test("carries no other product's concepts", () => {
      for (const forbidden of [
        "Ceph",
        "ceph",
        "Osd",
        "cephCluster",
        "VMware",
        "vmware",
        "Proxmox",
        "isUp",
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

  describe("volume widget", () => {
    test("deep-links to the volume pages with the percent-encoded volume name", () => {
      expect(VOLUME_SOURCE).toContain("PageMap.STORAGE_ARRAY_VIEW_VOLUMES");
      expect(VOLUME_SOURCE).toContain(
        "PageMap.STORAGE_ARRAY_VIEW_VOLUME_DETAIL",
      );
      /*
       * A FlashArray volume in a volume group is named "vgroup/vol" and one
       * in a pod "pod::vol": unencoded, the "/" would split the route.
       */
      expect(VOLUME_SOURCE).toContain(
        "subModelId: encodeURIComponent(externalId),",
      );

      const listRoute: Route | undefined =
        RouteMap[PageMap.STORAGE_ARRAY_VIEW_VOLUMES];
      const detailRoute: Route | undefined =
        RouteMap[PageMap.STORAGE_ARRAY_VIEW_VOLUME_DETAIL];
      expect(listRoute).toBeDefined();
      expect(detailRoute).toBeDefined();
      expect(detailRoute?.toString()).toContain(":subModelId");
      expect(detailRoute?.toString().startsWith(listRoute!.toString())).toBe(
        true,
      );
    });

    test("offers no hardware filters and the policy ignores stray ones", () => {
      expect(VOLUME_SOURCE).not.toContain("kindFilter");
      expect(VOLUME_SOURCE).not.toContain("statusFilter");
      expect(
        buildPolicy({
          componentType: DashboardComponentType.StorageArrayVolumeList,
          argumentsObject: { kindFilter: "Drive", statusFilter: "unhealthy" },
        }).query,
      ).toEqual({ kind: "Volume" });
    });

    test("renders capacity, latency and IOPS from the selected columns", () => {
      for (const column of [
        "capacityBytes: true,",
        "usedBytes: true,",
        "readLatencyUsec: true,",
        "writeLatencyUsec: true,",
        "readIops: true,",
        "writeIops: true,",
      ]) {
        expect(VOLUME_SOURCE).toContain(column);
      }
      for (const header of [
        '"Volume"',
        '"Used / Provisioned"',
        '"Latency (R / W)"',
        '"IOPS"',
        '"Array"',
      ]) {
        expect(VOLUME_SOURCE).toContain(header);
      }
    });
  });

  describe("hardware widget", () => {
    test("links components to their array's Hardware page", () => {
      expect(HARDWARE_SOURCE).toContain("PageMap.STORAGE_ARRAY_VIEW_HARDWARE");
      expect(RouteMap[PageMap.STORAGE_ARRAY_VIEW_HARDWARE]).toBeDefined();
    });

    test("kind filter values agree across settings, widget query and public policy", () => {
      const settingValues: Array<string> = dropdownValues(
        HARDWARE_ARGS,
        "kindFilter",
      );

      expect(settingValues).toEqual([...STORAGE_ARRAY_HARDWARE_WIDGET_KINDS]);
      /*
       * The widget accepts a kind only from the same shared list, and falls
       * back to every hardware kind for anything else — so a value the
       * policy would refuse never narrows the authenticated view either.
       */
      expect(HARDWARE_SOURCE).toContain("args.kindFilter");
      expect(HARDWARE_SOURCE).toContain(
        "STORAGE_ARRAY_HARDWARE_WIDGET_KINDS.includes(",
      );

      for (const kind of settingValues) {
        expect(
          buildPolicy({
            componentType: DashboardComponentType.StorageArrayHardwareList,
            argumentsObject: { kindFilter: kind },
          }).query,
        ).toEqual({ kind: kind });
      }

      expect(
        buildPolicy({
          componentType: DashboardComponentType.StorageArrayHardwareList,
          argumentsObject: { kindFilter: "" },
        }).query,
      ).toEqual({ kind: ALL_HARDWARE_KINDS });
      for (const stray of ["Volume", "hardware", "Disk"]) {
        expect(() => {
          return buildPolicy({
            componentType: DashboardComponentType.StorageArrayHardwareList,
            argumentsObject: { kindFilter: stray },
          });
        }).toThrow(BadDataException);
      }
    });

    test("status filter values agree across settings, widget query and public policy", () => {
      const settingValues: Array<string> = dropdownValues(
        HARDWARE_ARGS,
        "statusFilter",
      );

      expect(settingValues).toEqual(["unhealthy"]);
      expect(HARDWARE_SOURCE).toContain(
        "args.statusFilter === STORAGE_ARRAY_HARDWARE_UNHEALTHY_FILTER",
      );
      expect(HARDWARE_SOURCE).toContain(
        '["status"] = new Includes([\n      ...STORAGE_ARRAY_UNHEALTHY_COMPONENT_STATUSES,\n    ]);',
      );

      const policy: PublicDashboardResourceListPolicyResult = buildPolicy({
        componentType: DashboardComponentType.StorageArrayHardwareList,
        argumentsObject: { statusFilter: "unhealthy" },
      });
      expect(policy.query["status"]).toBeInstanceOf(Includes);

      for (const stray of ["critical", "Unhealthy", "ok"]) {
        expect(() => {
          return buildPolicy({
            componentType: DashboardComponentType.StorageArrayHardwareList,
            argumentsObject: { statusFilter: stray },
          });
        }).toThrow(BadDataException);
      }
    });

    test("defaults to the hardware wall, as its settings seed it", () => {
      expect(HARDWARE_SOURCE).toContain(
        'args.viewMode === "list" ? "list" : "honeycomb"',
      );
    });

    test("colors every status the way the Storage Arrays pages do", () => {
      /*
       * A cell links to its array's Hardware page; a component must not be
       * red on the dashboard and amber, or gray, there.
       */
      expect([...STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES].sort()).toEqual(
        [...CRITICAL_RESOURCE_STATUSES].sort(),
      );
      expect([...STORAGE_ARRAY_WARNING_COMPONENT_STATUSES].sort()).toEqual(
        [...WARNING_RESOURCE_STATUSES].sort(),
      );
      expect([...STORAGE_ARRAY_HEALTHY_COMPONENT_STATUSES].sort()).toEqual(
        [...HEALTHY_RESOURCE_STATUSES].sort(),
      );
    });
  });

  describe("shared registrations", () => {
    test("the public resource type union accepts storage-array-resource", () => {
      const union: string = readSource(
        path.join("Utils", "DashboardResourceList.ts"),
      );
      expect(union).toContain('| "storage-array-resource"');
    });

    test("the storage array entity filter resolves to the StorageArray model", () => {
      const dropdown: string = readSource(
        path.join("Canvas", "EntityFilterDropdown.tsx"),
      );
      expect(dropdown).toContain(
        'import StorageArray from "Common/Models/DatabaseModels/StorageArray";',
      );
      expect(dropdown).toContain("case EntityFilterModelType.StorageArray:");
      expect(dropdown).toContain(
        "modelType: StorageArray as unknown as ModelTypeOf<BaseModel>,",
      );
    });

    test("the widget catalog lists both widgets under Storage Arrays, between Ceph and Network", () => {
      const names: Array<string> = WIDGET_CATALOG.map(
        (category: WidgetCatalogCategory) => {
          return category.name;
        },
      );
      const index: number = names.indexOf("Storage Arrays");
      expect(index).toBeGreaterThan(-1);
      expect(names[index - 1]).toBe("Ceph");
      expect(names[index + 1]).toBe("Network");

      const category: WidgetCatalogCategory = WIDGET_CATALOG[
        index
      ] as WidgetCatalogCategory;
      expect(
        category.items.map((item: WidgetCatalogItem) => {
          return item.type;
        }),
      ).toEqual([
        DashboardComponentType.StorageArrayVolumeList,
        DashboardComponentType.StorageArrayHardwareList,
      ]);

      /* The Ceph OSD wall owns the word "honeycomb" in catalog search. */
      const copy: string = [
        category.name,
        category.description,
        ...category.items.flatMap((item: WidgetCatalogItem) => {
          return [item.label, item.description, ...item.keywords];
        }),
      ]
        .join(" ")
        .toLowerCase();
      expect(copy).not.toContain("honeycomb");
      expect(copy).not.toContain("ceph");
      expect(copy).toContain("flasharray");
      expect(copy).toContain("flashblade");
    });
  });
});
