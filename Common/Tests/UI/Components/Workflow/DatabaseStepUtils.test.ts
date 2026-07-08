import {
  ModelGroup,
  filterModelGroups,
  groupComponentsByModel,
} from "../../../../UI/Components/Workflow/DatabaseStepUtils";
import ComponentMetadata, {
  ComponentType,
} from "../../../../Types/Workflow/Component";
import { describe, expect, test } from "@jest/globals";

const comp: (
  id: string,
  tableName: string | undefined,
  category: string,
  componentType: ComponentType,
) => ComponentMetadata = (
  id: string,
  tableName: string | undefined,
  category: string,
  componentType: ComponentType,
): ComponentMetadata => {
  return {
    id: id,
    tableName: tableName,
    category: category,
    componentType: componentType,
  } as unknown as ComponentMetadata;
};

const catalog: Array<ComponentMetadata> = [
  comp("monitor-find-one", "Monitor", "Monitor", ComponentType.Component),
  comp("incident-find-one", "Incident", "Incident", ComponentType.Component),
  comp("incident-find-many", "Incident", "Incident", ComponentType.Component),
  comp("slack", undefined, "Slack", ComponentType.Component), // static, no table
  comp("incident-on-create", "Incident", "Incident", ComponentType.Trigger),
];

describe("DatabaseStepUtils.groupComponentsByModel", () => {
  test("groups model-backed components of the type, sorted by name", () => {
    const groups: Array<ModelGroup> = groupComponentsByModel(
      catalog,
      ComponentType.Component,
    );

    expect(
      groups.map((g: ModelGroup) => {
        return g.name;
      }),
    ).toEqual(["Incident", "Monitor"]);

    const incident: ModelGroup = groups[0]!;
    expect(
      incident.components.map((c: ComponentMetadata) => {
        return c.id;
      }),
    ).toEqual(["incident-find-one", "incident-find-many"]);
  });

  test("excludes static components without a tableName", () => {
    const groups: Array<ModelGroup> = groupComponentsByModel(
      catalog,
      ComponentType.Component,
    );
    const allIds: Array<string> = groups.flatMap((g: ModelGroup) => {
      return g.components.map((c: ComponentMetadata) => {
        return c.id;
      });
    });
    expect(allIds).not.toContain("slack");
  });

  test("separates triggers from components", () => {
    const triggerGroups: Array<ModelGroup> = groupComponentsByModel(
      catalog,
      ComponentType.Trigger,
    );
    expect(triggerGroups).toHaveLength(1);
    expect(triggerGroups[0]!.components[0]!.id).toBe("incident-on-create");
  });
});

describe("DatabaseStepUtils.filterModelGroups", () => {
  test("filters model groups by name, case-insensitively", () => {
    const groups: Array<ModelGroup> = groupComponentsByModel(
      catalog,
      ComponentType.Component,
    );
    expect(
      filterModelGroups(groups, "mon").map((g: ModelGroup) => {
        return g.name;
      }),
    ).toEqual(["Monitor"]);
    expect(filterModelGroups(groups, "")).toHaveLength(2);
  });
});
