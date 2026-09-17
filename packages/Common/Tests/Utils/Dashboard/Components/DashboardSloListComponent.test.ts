import {
  ComponentArgument,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardSloListComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardSloListComponent";
import DashboardComponentType from "../../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../../Types/JSON";
import SloStatus from "../../../../Types/ServiceLevelObjective/SloStatus";
import DashboardComponentsUtil from "../../../../Utils/Dashboard/Components/Index";
import DashboardSloListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardSloListComponent";
import { SLO_LIST_DEFAULT_MAX_ROWS } from "../../../../Utils/Slo/SloListWidgetFormat";
import { describe, expect, test } from "@jest/globals";

type ArgumentIds = keyof DashboardSloListComponent["arguments"];

type GetArgumentsFunction = () => Array<
  ComponentArgument<DashboardSloListComponent>
>;

const getArguments: GetArgumentsFunction = (): Array<
  ComponentArgument<DashboardSloListComponent>
> => {
  return DashboardSloListComponentUtil.getComponentConfigArguments();
};

type GetArgumentByIdFunction = (
  id: ArgumentIds,
) => ComponentArgument<DashboardSloListComponent>;

const getArgumentById: GetArgumentByIdFunction = (
  id: ArgumentIds,
): ComponentArgument<DashboardSloListComponent> => {
  const found: ComponentArgument<DashboardSloListComponent> | undefined =
    getArguments().find(
      (arg: ComponentArgument<DashboardSloListComponent>): boolean => {
        return arg.id === id;
      },
    );

  if (!found) {
    throw new Error(`No SLO List argument declared with id "${String(id)}"`);
  }

  return found;
};

describe("DashboardSloListComponentUtil", () => {
  describe("the persisted component type", () => {
    // Written verbatim into every saved dashboard's JSON config.
    test("is the string SloList", () => {
      expect(DashboardComponentType.SloList).toBe("SloList");
    });
  });

  describe("getDefaultComponent", () => {
    test("seeds an SloList widget that survives config serialization", () => {
      const component: DashboardSloListComponent =
        DashboardSloListComponentUtil.getDefaultComponent();

      expect(component.componentType).toBe(DashboardComponentType.SloList);
      expect(component._type).toBe(ObjectType.DashboardComponent);
    });

    /*
     * Five columns — name, status, SLI, the budget bar and burn rate — need
     * more room than the other list widgets' six units to be read.
     */
    test("is born wide enough for its five columns and never below its floor", () => {
      const component: DashboardSloListComponent =
        DashboardSloListComponentUtil.getDefaultComponent();

      expect(component.widthInDashboardUnits).toBe(8);
      expect(component.heightInDashboardUnits).toBe(5);
      expect(component.minWidthInDashboardUnits).toBe(6);
      expect(component.minHeightInDashboardUnits).toBe(3);
      expect(component.widthInDashboardUnits).toBeGreaterThanOrEqual(
        component.minWidthInDashboardUnits,
      );
      expect(component.heightInDashboardUnits).toBeGreaterThanOrEqual(
        component.minHeightInDashboardUnits,
      );
    });

    test("caps its rows at the shared default and pre-filters nothing", () => {
      const component: DashboardSloListComponent =
        DashboardSloListComponentUtil.getDefaultComponent();

      expect(component.arguments).toEqual({
        maxRows: SLO_LIST_DEFAULT_MAX_ROWS,
      });
    });

    test("generates a distinct componentId per call", () => {
      expect(
        DashboardSloListComponentUtil.getDefaultComponent().componentId.toString(),
      ).not.toBe(
        DashboardSloListComponentUtil.getDefaultComponent().componentId.toString(),
      );
    });
  });

  describe("getComponentConfigArguments", () => {
    test("declares exactly the documented arguments, in panel order", () => {
      expect(
        getArguments().map(
          (arg: ComponentArgument<DashboardSloListComponent>): unknown => {
            return arg.id;
          },
        ),
      ).toEqual([
        "title",
        "maxRows",
        "viewMode",
        "sloStatuses",
        "labelIds",
        "labelVariableId",
      ]);
    });

    test("keeps every argument optional, so a dropped-in list renders the whole fleet", () => {
      for (const arg of getArguments()) {
        expect(`${String(arg.id)} required=${arg.required}`).toBe(
          `${String(arg.id)} required=false`,
        );
      }
    });

    test("gives every argument a name, a description, a real input type and a section", () => {
      for (const arg of getArguments()) {
        expect(arg.name.trim().length).toBeGreaterThan(0);
        expect(arg.description.trim().length).toBeGreaterThan(0);
        expect(Object.values(ComponentInputType)).toContain(arg.type);
        expect(arg.section?.name.trim().length).toBeGreaterThan(0);
      }
    });

    test("offers every SLO status in the status filter, worst first", () => {
      const arg: ComponentArgument<DashboardSloListComponent> =
        getArgumentById("sloStatuses");

      expect(arg.type).toBe(ComponentInputType.MultiSelectDropdown);

      const values: Array<unknown> = (arg.dropdownOptions || []).map(
        (option: { value: unknown }): unknown => {
          return option.value;
        },
      );

      expect([...values].sort()).toEqual([...Object.values(SloStatus)].sort());
      expect(values[0]).toBe(SloStatus.BudgetExhausted);
    });

    test("filters by labels with the project label picker and the label variable binding", () => {
      const labels: ComponentArgument<DashboardSloListComponent> =
        getArgumentById("labelIds");
      const labelVariable: ComponentArgument<DashboardSloListComponent> =
        getArgumentById("labelVariableId");

      expect(labels.type).toBe(ComponentInputType.EntityMultiSelectDropdown);
      expect(labels.entityFilterModelType).toBe(EntityFilterModelType.Label);
      expect(labelVariable.type).toBe(ComponentInputType.ProjectLabelVariable);
    });

    test("offers the shared list / honeycomb view switch", () => {
      const arg: ComponentArgument<DashboardSloListComponent> =
        getArgumentById("viewMode");

      expect(arg.type).toBe(ComponentInputType.Dropdown);
      expect(
        (arg.dropdownOptions || []).map(
          (option: { value: unknown }): unknown => {
            return option.value;
          },
        ),
      ).toEqual(["list", "honeycomb"]);
    });

    test("explains that a capped list drops the healthiest SLOs", () => {
      expect(getArgumentById("maxRows").description).toContain("healthiest");
    });
  });

  /*
   * Through the registry's public lookup rather than the util directly, so
   * forgetting to wire SloList into Utils/Dashboard/Components/Index.ts fails.
   */
  describe("registration in DashboardComponentsUtil", () => {
    test("resolves SloList to the SLO List's own arguments", () => {
      expect(
        DashboardComponentsUtil.getComponentSettingsArguments(
          DashboardComponentType.SloList,
        ).map((arg: ComponentArgument<DashboardBaseComponent>): unknown => {
          return arg.id;
        }),
      ).toEqual(
        getArguments().map(
          (arg: ComponentArgument<DashboardSloListComponent>): unknown => {
            return arg.id;
          },
        ),
      );
    });
  });
});
