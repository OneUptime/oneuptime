import {
  ComponentArgument,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardSloComponent, {
  SloWidgetDisplayType,
  SloWidgetMetric,
} from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import DashboardComponentsUtil from "../../../Utils/Dashboard/Components/Index";
import DashboardSloComponentUtil from "../../../Utils/Dashboard/Components/DashboardSloComponent";

type ArgumentIds = keyof DashboardSloComponent["arguments"];

function getArguments(): Array<ComponentArgument<DashboardSloComponent>> {
  return DashboardSloComponentUtil.getComponentConfigArguments();
}

function getArgumentById(
  id: ArgumentIds,
): ComponentArgument<DashboardSloComponent> {
  const found: ComponentArgument<DashboardSloComponent> | undefined =
    getArguments().find((arg: ComponentArgument<DashboardSloComponent>) => {
      return arg.id === id;
    });

  if (!found) {
    throw new Error(`No SLO widget argument declared with id "${id}"`);
  }

  return found;
}

describe("DashboardSloComponentUtil", () => {
  describe("getDefaultComponent", () => {
    it("declares its componentType as Slo so the renderer dispatch matches", () => {
      expect(
        DashboardSloComponentUtil.getDefaultComponent().componentType,
      ).toBe(DashboardComponentType.Slo);
    });

    it("marks itself as a dashboard component so it survives config serialization", () => {
      expect(DashboardSloComponentUtil.getDefaultComponent()._type).toBe(
        ObjectType.DashboardComponent,
      );
    });

    it("defaults to a 3x3 tile placed at the canvas origin", () => {
      const component: DashboardSloComponent =
        DashboardSloComponentUtil.getDefaultComponent();

      expect(component.widthInDashboardUnits).toBe(3);
      expect(component.heightInDashboardUnits).toBe(3);
      expect(component.topInDashboardUnits).toBe(0);
      expect(component.leftInDashboardUnits).toBe(0);
    });

    it("cannot be resized smaller than its 2x2 minimum", () => {
      const component: DashboardSloComponent =
        DashboardSloComponentUtil.getDefaultComponent();

      expect(component.minWidthInDashboardUnits).toBe(2);
      expect(component.minHeightInDashboardUnits).toBe(2);
      expect(component.minWidthInDashboardUnits).toBeLessThanOrEqual(
        component.widthInDashboardUnits,
      );
      expect(component.minHeightInDashboardUnits).toBeLessThanOrEqual(
        component.heightInDashboardUnits,
      );
    });

    it("defaults the metric to SLI and the display to Tile", () => {
      const component: DashboardSloComponent =
        DashboardSloComponentUtil.getDefaultComponent();

      expect(component.arguments.sloMetric).toBe(SloWidgetMetric.Sli);
      expect(component.arguments.displayType).toBe(SloWidgetDisplayType.Tile);
    });

    it("leaves the SLO unselected so the widget renders its setup state", () => {
      const component: DashboardSloComponent =
        DashboardSloComponentUtil.getDefaultComponent();

      expect(component.arguments.serviceLevelObjectiveId).toBeUndefined();
      expect(component.arguments.widgetTitle).toBeUndefined();
    });

    it("generates a distinct componentId per call so two widgets never collide", () => {
      const first: DashboardSloComponent =
        DashboardSloComponentUtil.getDefaultComponent();
      const second: DashboardSloComponent =
        DashboardSloComponentUtil.getDefaultComponent();

      expect(first.componentId.toString()).not.toBe(
        second.componentId.toString(),
      );
    });
  });

  describe("getComponentConfigArguments", () => {
    it("declares exactly the four documented arguments", () => {
      expect(
        getArguments().map((arg: ComponentArgument<DashboardSloComponent>) => {
          return arg.id;
        }),
      ).toEqual([
        "serviceLevelObjectiveId",
        "sloMetric",
        "displayType",
        "widgetTitle",
      ]);
    });

    it("gives every argument a name, description, input type and required flag", () => {
      for (const arg of getArguments()) {
        expect(typeof arg.name).toBe("string");
        expect(arg.name.length).toBeGreaterThan(0);
        expect(typeof arg.description).toBe("string");
        expect(arg.description.length).toBeGreaterThan(0);
        expect(Object.values(ComponentInputType)).toContain(arg.type);
        expect(typeof arg.required).toBe("boolean");
      }
    });

    it("puts every argument in a section so the settings panel can group them", () => {
      for (const arg of getArguments()) {
        expect(arg.section).toBeDefined();
        expect(arg.section?.name.length).toBeGreaterThan(0);
        expect(typeof arg.section?.order).toBe("number");
      }
    });

    it("picks the SLO with a model-backed entity dropdown", () => {
      const arg: ComponentArgument<DashboardSloComponent> = getArgumentById(
        "serviceLevelObjectiveId",
      );

      expect(arg.type).toBe(ComponentInputType.EntityDropdown);
      expect(arg.entityFilterModelType).toBe(
        EntityFilterModelType.ServiceLevelObjective,
      );
      expect(arg.required).toBe(true);
    });

    it("offers all three SLO metrics in the metric dropdown", () => {
      const arg: ComponentArgument<DashboardSloComponent> =
        getArgumentById("sloMetric");

      expect(arg.type).toBe(ComponentInputType.Dropdown);
      expect(
        arg.dropdownOptions?.map((option: { value: unknown }) => {
          return option.value;
        }),
      ).toEqual([
        SloWidgetMetric.Sli,
        SloWidgetMetric.ErrorBudgetRemaining,
        SloWidgetMetric.BurnRate,
      ]);
    });

    it("offers both display types in the display dropdown", () => {
      const arg: ComponentArgument<DashboardSloComponent> =
        getArgumentById("displayType");

      expect(arg.type).toBe(ComponentInputType.Dropdown);
      expect(
        arg.dropdownOptions?.map((option: { value: unknown }) => {
          return option.value;
        }),
      ).toEqual([SloWidgetDisplayType.Tile, SloWidgetDisplayType.Chart]);
    });

    it("keeps the title optional because it falls back to the SLO name", () => {
      const arg: ComponentArgument<DashboardSloComponent> =
        getArgumentById("widgetTitle");

      expect(arg.type).toBe(ComponentInputType.Text);
      expect(arg.required).toBe(false);
    });

    it("gives every dropdown argument a non-empty option list", () => {
      const dropdownArgs: Array<ComponentArgument<DashboardSloComponent>> =
        getArguments().filter(
          (arg: ComponentArgument<DashboardSloComponent>) => {
            return arg.type === ComponentInputType.Dropdown;
          },
        );

      expect(dropdownArgs.length).toBeGreaterThan(0);

      for (const arg of dropdownArgs) {
        expect(arg.dropdownOptions?.length).toBeGreaterThan(0);

        for (const option of arg.dropdownOptions || []) {
          expect(typeof option.label).toBe("string");
          expect((option.label as string).length).toBeGreaterThan(0);
          expect(option.value).toBeTruthy();
        }
      }
    });

    it("declares no duplicate argument ids", () => {
      const ids: Array<unknown> = getArguments().map(
        (arg: ComponentArgument<DashboardSloComponent>) => {
          return arg.id;
        },
      );

      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  /*
   * These go through the registry's public lookup rather than the util
   * directly, so forgetting to wire DashboardComponentType.Slo into
   * Common/Utils/Dashboard/Components/Index.ts fails the suite.
   */
  describe("registration in DashboardComponentsUtil", () => {
    it("resolves DashboardComponentType.Slo instead of throwing for an unknown type", () => {
      expect(() => {
        return DashboardComponentsUtil.getComponentSettingsArguments(
          DashboardComponentType.Slo,
        );
      }).not.toThrow();
    });

    it("returns the SLO widget's own arguments for DashboardComponentType.Slo", () => {
      const fromRegistry: Array<ComponentArgument<DashboardBaseComponent>> =
        DashboardComponentsUtil.getComponentSettingsArguments(
          DashboardComponentType.Slo,
        );

      expect(
        fromRegistry.map(
          (arg: ComponentArgument<DashboardBaseComponent>): unknown => {
            return arg.id;
          },
        ),
      ).toEqual(
        getArguments().map(
          (arg: ComponentArgument<DashboardSloComponent>): unknown => {
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
