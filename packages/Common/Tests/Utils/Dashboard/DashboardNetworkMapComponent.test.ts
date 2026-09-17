import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardNetworkMapComponent from "../../../Types/Dashboard/DashboardComponents/DashboardNetworkMapComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import DashboardComponentsUtil from "../../../Utils/Dashboard/Components/Index";
import DashboardNetworkMapComponentUtil, {
  DEFAULT_MAX_SITES,
} from "../../../Utils/Dashboard/Components/DashboardNetworkMapComponent";

type ArgumentIds = keyof DashboardNetworkMapComponent["arguments"];

function getArguments(): Array<
  ComponentArgument<DashboardNetworkMapComponent>
> {
  return DashboardNetworkMapComponentUtil.getComponentConfigArguments();
}

function getArgumentById(
  id: ArgumentIds,
): ComponentArgument<DashboardNetworkMapComponent> {
  const found: ComponentArgument<DashboardNetworkMapComponent> | undefined =
    getArguments().find(
      (arg: ComponentArgument<DashboardNetworkMapComponent>) => {
        return arg.id === id;
      },
    );

  if (!found) {
    throw new Error(`No Network Map widget argument declared with id "${id}"`);
  }

  return found;
}

function getDropdownValues(id: ArgumentIds): Array<string> {
  return (getArgumentById(id).dropdownOptions || []).map(
    (option: DropdownOption): string => {
      return String(option.value);
    },
  );
}

describe("DashboardNetworkMapComponentUtil", () => {
  describe("getDefaultComponent", () => {
    it("declares its componentType as NetworkMap so the renderer dispatch matches", () => {
      expect(
        DashboardNetworkMapComponentUtil.getDefaultComponent().componentType,
      ).toBe(DashboardComponentType.NetworkMap);
    });

    it("marks itself as a dashboard component so it survives config serialization", () => {
      expect(DashboardNetworkMapComponentUtil.getDefaultComponent()._type).toBe(
        ObjectType.DashboardComponent,
      );
    });

    it("places a 6x5 tile at the canvas origin", () => {
      const component: DashboardNetworkMapComponent =
        DashboardNetworkMapComponentUtil.getDefaultComponent();

      expect(component.widthInDashboardUnits).toBe(6);
      expect(component.heightInDashboardUnits).toBe(5);
      expect(component.topInDashboardUnits).toBe(0);
      expect(component.leftInDashboardUnits).toBe(0);
    });

    /*
     * The world is roughly 2:1, so a tile that is allowed to be short and
     * wide letterboxes the map into an unreadable strip. The minimum has to
     * bound BOTH axes, and the default has to sit at or above it — a widget
     * that spawns below its own minimum is one the resize handles then
     * refuse to shrink.
     */
    it("cannot be resized below a square-ish 4x4, and spawns at or above that", () => {
      const component: DashboardNetworkMapComponent =
        DashboardNetworkMapComponentUtil.getDefaultComponent();

      expect(component.minWidthInDashboardUnits).toBe(4);
      expect(component.minHeightInDashboardUnits).toBe(4);
      expect(component.widthInDashboardUnits).toBeGreaterThanOrEqual(
        component.minWidthInDashboardUnits,
      );
      expect(component.heightInDashboardUnits).toBeGreaterThanOrEqual(
        component.minHeightInDashboardUnits,
      );
    });

    it("fits inside the 12-unit dashboard grid", () => {
      const component: DashboardNetworkMapComponent =
        DashboardNetworkMapComponentUtil.getDefaultComponent();

      expect(
        component.leftInDashboardUnits + component.widthInDashboardUnits,
      ).toBeLessThanOrEqual(12);
    });

    it("opens on the map rather than the list, with names on and the row cap seeded", () => {
      const component: DashboardNetworkMapComponent =
        DashboardNetworkMapComponentUtil.getDefaultComponent();

      expect(component.arguments.viewMode).toBe("map");
      expect(component.arguments.showLabels).toBe(true);
      expect(component.arguments.maxSites).toBe(DEFAULT_MAX_SITES);
    });

    it("seeds no filters, so a freshly added widget shows the whole estate", () => {
      const component: DashboardNetworkMapComponent =
        DashboardNetworkMapComponentUtil.getDefaultComponent();

      expect(component.arguments.statusFilter).toBeUndefined();
      expect(component.arguments.networkSiteTypeIds).toBeUndefined();
    });

    /*
     * Two widgets dropped on the same dashboard must not share an id — the
     * canvas keys, selects and persists components by it.
     */
    it("generates a fresh component id on every call", () => {
      const first: DashboardNetworkMapComponent =
        DashboardNetworkMapComponentUtil.getDefaultComponent();
      const second: DashboardNetworkMapComponent =
        DashboardNetworkMapComponentUtil.getDefaultComponent();

      expect(first.componentId.toString()).not.toBe(
        second.componentId.toString(),
      );
    });

    it("caps the fetch at a bounded number of sites", () => {
      expect(DEFAULT_MAX_SITES).toBeGreaterThan(0);
      expect(Number.isInteger(DEFAULT_MAX_SITES)).toBe(true);
    });
  });

  describe("getComponentConfigArguments", () => {
    it("declares exactly the arguments the widget reads", () => {
      const ids: Array<unknown> = getArguments().map(
        (arg: ComponentArgument<DashboardNetworkMapComponent>) => {
          return arg.id;
        },
      );

      expect(ids).toEqual([
        "title",
        "viewMode",
        "maxSites",
        "showLabels",
        "networkSiteTypeIds",
        "statusFilter",
      ]);
    });

    it("declares no duplicate argument ids", () => {
      const ids: Array<unknown> = getArguments().map(
        (arg: ComponentArgument<DashboardNetworkMapComponent>) => {
          return arg.id;
        },
      );

      expect(new Set(ids).size).toBe(ids.length);
    });

    it("gives every argument a name, a description and no required flag", () => {
      for (const arg of getArguments()) {
        expect(arg.name.trim().length).toBeGreaterThan(0);
        expect(arg.description.trim().length).toBeGreaterThan(0);
        /*
         * Every argument has a working default, so none of them may be
         * required — a required field with a default is a form the user
         * cannot submit without re-entering what is already true.
         */
        expect(arg.required).toBe(false);
      }
    });

    it("types each argument as the input the settings form should render", () => {
      expect(getArgumentById("title").type).toBe(ComponentInputType.Text);
      expect(getArgumentById("viewMode").type).toBe(
        ComponentInputType.Dropdown,
      );
      expect(getArgumentById("maxSites").type).toBe(ComponentInputType.Number);
      expect(getArgumentById("showLabels").type).toBe(
        ComponentInputType.Boolean,
      );
      expect(getArgumentById("networkSiteTypeIds").type).toBe(
        ComponentInputType.EntityMultiSelectDropdown,
      );
      expect(getArgumentById("statusFilter").type).toBe(
        ComponentInputType.Dropdown,
      );
    });

    /*
     * The site-type picker has to name a model the EntityFilterDropdown
     * switch knows about, or it throws when the settings modal opens.
     */
    it("binds the site-type picker to the NetworkSiteType lookup table", () => {
      expect(getArgumentById("networkSiteTypeIds").entityFilterModelType).toBe(
        EntityFilterModelType.NetworkSiteType,
      );
    });

    it("gives only the entity picker an entityFilterModelType", () => {
      for (const arg of getArguments()) {
        if (arg.id === "networkSiteTypeIds") {
          continue;
        }
        expect(arg.entityFilterModelType).toBeUndefined();
      }
    });

    it("offers exactly the two view modes the renderer implements", () => {
      expect(getDropdownValues("viewMode")).toEqual(["map", "list"]);
    });

    /*
     * The empty option is what lets somebody UNDO a status filter. Without
     * it the only way back to "all sites" is to delete the widget.
     */
    it("offers an empty status option so the filter can be cleared", () => {
      expect(getDropdownValues("statusFilter")).toEqual([
        "",
        "down",
        "operational",
      ]);
    });

    it("gives every dropdown option a non-empty label", () => {
      for (const arg of getArguments()) {
        for (const option of arg.dropdownOptions || []) {
          expect(String(option.label).trim().length).toBeGreaterThan(0);
        }
      }
    });

    it("splits the arguments into a Display section and a collapsed Filters section", () => {
      const sectionOf: (
        id: ArgumentIds,
      ) => ComponentArgumentSection | undefined = (
        id: ArgumentIds,
      ): ComponentArgumentSection | undefined => {
        return getArgumentById(id).section;
      };

      for (const id of [
        "title",
        "viewMode",
        "maxSites",
        "showLabels",
      ] as Array<ArgumentIds>) {
        expect(sectionOf(id)?.name).toBe("Display Options");
      }

      for (const id of [
        "networkSiteTypeIds",
        "statusFilter",
      ] as Array<ArgumentIds>) {
        expect(sectionOf(id)?.name).toBe("Filters");
      }

      expect(sectionOf("title")?.order).toBeLessThan(
        sectionOf("statusFilter")?.order as number,
      );
      expect(sectionOf("statusFilter")?.defaultCollapsed).toBe(true);
    });

    it("returns a fresh array each call so a caller cannot mutate the declaration", () => {
      const first: Array<ComponentArgument<DashboardNetworkMapComponent>> =
        getArguments();
      first.pop();

      expect(getArguments()).toHaveLength(6);
    });
  });

  /*
   * These go through the registry's public lookup rather than the util
   * directly, so forgetting to wire DashboardComponentType.NetworkMap into
   * Common/Utils/Dashboard/Components/Index.ts fails the suite. Nothing else
   * in the codebase asserts that registry is exhaustive.
   */
  describe("registration in DashboardComponentsUtil", () => {
    it("resolves DashboardComponentType.NetworkMap instead of throwing", () => {
      expect(() => {
        return DashboardComponentsUtil.getComponentSettingsArguments(
          DashboardComponentType.NetworkMap,
        );
      }).not.toThrow();
    });

    it("returns the Network Map widget's own arguments for that type", () => {
      const fromRegistry: Array<ComponentArgument<DashboardBaseComponent>> =
        DashboardComponentsUtil.getComponentSettingsArguments(
          DashboardComponentType.NetworkMap,
        );

      expect(
        fromRegistry.map(
          (arg: ComponentArgument<DashboardBaseComponent>): unknown => {
            return arg.id;
          },
        ),
      ).toEqual(
        getArguments().map(
          (arg: ComponentArgument<DashboardNetworkMapComponent>): unknown => {
            return arg.id;
          },
        ),
      );
    });

    it("still throws for a component type that is not registered", () => {
      expect(() => {
        return DashboardComponentsUtil.getComponentSettingsArguments(
          "NotARealWidget" as DashboardComponentType,
        );
      }).toThrow();
    });
  });
});
