import { describe, expect, test } from "@jest/globals";
import {
  ComponentArgument,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardSloListComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardSloListComponent";
import DashboardComponentType from "../../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../../Types/JSON";
import SloStatus from "../../../../Types/ServiceLevelObjective/SloStatus";
import DashboardSloListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardSloListComponent";
import DashboardComponentsUtil from "../../../../Utils/Dashboard/Components/Index";

type SloListArgument = ComponentArgument<DashboardSloListComponent>;
type ArgumentId = keyof DashboardSloListComponent["arguments"];

function getArguments(): Array<SloListArgument> {
  return DashboardSloListComponentUtil.getComponentConfigArguments();
}

function getArgument(id: ArgumentId): SloListArgument {
  const argument: SloListArgument | undefined = getArguments().find(
    (candidate: SloListArgument): boolean => {
      return candidate.id === id;
    },
  );

  expect(argument).toBeDefined();
  return argument as SloListArgument;
}

describe("DashboardSloListComponentUtil", () => {
  describe("getDefaultComponent", () => {
    test("seeds a real SloList dashboard component", () => {
      const component: DashboardSloListComponent =
        DashboardSloListComponentUtil.getDefaultComponent();

      expect(component._type).toBe(ObjectType.DashboardComponent);
      expect(component.componentType).toBe(DashboardComponentType.SloList);
    });

    test("uses a full-width list layout at the canvas origin", () => {
      const component: DashboardSloListComponent =
        DashboardSloListComponentUtil.getDefaultComponent();

      expect({
        width: component.widthInDashboardUnits,
        height: component.heightInDashboardUnits,
        top: component.topInDashboardUnits,
        left: component.leftInDashboardUnits,
      }).toEqual({ width: 12, height: 6, top: 0, left: 0 });
    });

    test("declares a minimum that fits inside its default size", () => {
      const component: DashboardSloListComponent =
        DashboardSloListComponentUtil.getDefaultComponent();

      expect(component.minWidthInDashboardUnits).toBe(6);
      expect(component.minHeightInDashboardUnits).toBe(3);
      expect(component.widthInDashboardUnits).toBeGreaterThanOrEqual(
        component.minWidthInDashboardUnits,
      );
      expect(component.heightInDashboardUnits).toBeGreaterThanOrEqual(
        component.minHeightInDashboardUnits,
      );
    });

    test("defaults to 50 rows without silently applying any filter", () => {
      const component: DashboardSloListComponent =
        DashboardSloListComponentUtil.getDefaultComponent();

      expect(component.arguments).toEqual({ maxRows: 50 });
      expect(component.arguments.title).toBeUndefined();
      expect(component.arguments.sloStatuses).toBeUndefined();
      expect(component.arguments.monitorIds).toBeUndefined();
      expect(component.arguments.labelIds).toBeUndefined();
      expect(component.arguments.labelVariableId).toBeUndefined();
    });

    test("generates a fresh component id on every call", () => {
      const first: DashboardSloListComponent =
        DashboardSloListComponentUtil.getDefaultComponent();
      const second: DashboardSloListComponent =
        DashboardSloListComponentUtil.getDefaultComponent();

      expect(first.componentId.toString()).not.toBe("");
      expect(second.componentId.toString()).not.toBe("");
      expect(first.componentId.toString()).not.toBe(second.componentId.toString());
    });
  });

  describe("getComponentConfigArguments", () => {
    test("declares exactly the six supported settings in form order", () => {
      expect(
        getArguments().map((argument: SloListArgument): ArgumentId => {
          return argument.id;
        }),
      ).toEqual([
        "title",
        "maxRows",
        "sloStatuses",
        "monitorIds",
        "labelIds",
        "labelVariableId",
      ]);
    });

    test("makes every setting optional so the default widget can fetch immediately", () => {
      expect(
        getArguments().every((argument: SloListArgument): boolean => {
          return argument.required === false;
        }),
      ).toBe(true);
    });

    test("gives every setting complete editor metadata", () => {
      for (const argument of getArguments()) {
        expect(argument.name.trim()).not.toBe("");
        expect(argument.description.trim()).not.toBe("");
        expect(Object.values(ComponentInputType)).toContain(argument.type);
        expect(argument.section).toBeDefined();
      }
    });

    test("declares no duplicate setting ids", () => {
      const ids: Array<ArgumentId> = getArguments().map(
        (argument: SloListArgument): ArgumentId => {
          return argument.id;
        },
      );

      expect(new Set(ids).size).toBe(ids.length);
    });

    test("groups display settings before collapsed filters", () => {
      const title: SloListArgument = getArgument("title");
      const maxRows: SloListArgument = getArgument("maxRows");
      const statuses: SloListArgument = getArgument("sloStatuses");

      expect(title.section).toEqual({
        name: "Display Options",
        description: "Configure the widget title and row limit",
        order: 1,
      });
      expect(maxRows.section).toEqual(title.section);
      expect(statuses.section).toEqual({
        name: "Filters",
        description: "Narrow down which SLOs are shown",
        order: 2,
        defaultCollapsed: true,
      });

      for (const id of [
        "monitorIds",
        "labelIds",
        "labelVariableId",
      ] as Array<ArgumentId>) {
        expect(getArgument(id).section).toEqual(statuses.section);
      }
    });

    test("uses text and number controls for the title and row limit", () => {
      expect(getArgument("title").type).toBe(ComponentInputType.Text);
      expect(getArgument("maxRows")).toMatchObject({
        type: ComponentInputType.Number,
        placeholder: "50",
      });
    });

    test("offers every persisted SLO status exactly once", () => {
      const statuses: SloListArgument = getArgument("sloStatuses");

      expect(statuses.type).toBe(ComponentInputType.MultiSelectDropdown);
      expect(statuses.dropdownOptions).toEqual(
        Object.values(SloStatus).map((status: SloStatus) => {
          return { label: status, value: status };
        }),
      );
      expect(
        new Set(
          (statuses.dropdownOptions || []).map((option) => {
            return option.value;
          }),
        ).size,
      ).toBe(Object.values(SloStatus).length);
    });

    test("backs monitor and label filters with the correct entity models", () => {
      expect(getArgument("monitorIds")).toMatchObject({
        type: ComponentInputType.EntityMultiSelectDropdown,
        entityFilterModelType: EntityFilterModelType.Monitor,
        placeholder: "All monitors",
      });
      expect(getArgument("labelIds")).toMatchObject({
        type: ComponentInputType.EntityMultiSelectDropdown,
        entityFilterModelType: EntityFilterModelType.Label,
        placeholder: "All labels",
      });
    });

    test("uses the dedicated project-label variable control", () => {
      const labelVariable: SloListArgument = getArgument("labelVariableId");

      expect(labelVariable.type).toBe(ComponentInputType.ProjectLabelVariable);
      expect(labelVariable.entityFilterModelType).toBeUndefined();
    });

    test("returns fresh settings and dropdown arrays on every call", () => {
      const first: Array<SloListArgument> = getArguments();
      const second: Array<SloListArgument> = getArguments();

      expect(first).not.toBe(second);
      expect(first).toEqual(second);
      expect(first[2]?.dropdownOptions).not.toBe(second[2]?.dropdownOptions);
    });
  });

  describe("registration in DashboardComponentsUtil", () => {
    test("resolves SloList settings through the central registry", () => {
      const registered: Array<ComponentArgument<DashboardSloListComponent>> =
        DashboardComponentsUtil.getComponentSettingsArguments(
          DashboardComponentType.SloList,
        ) as Array<ComponentArgument<DashboardSloListComponent>>;

      expect(
        registered.map((argument: SloListArgument): ArgumentId => argument.id),
      ).toEqual(
        getArguments().map(
          (argument: SloListArgument): ArgumentId => argument.id,
        ),
      );
    });
  });
});
