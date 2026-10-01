import {
  COMMON_RESOURCE_TABLE_NAMES,
  DATABASE_OPERATION_ORDER,
  PickerBuiltInGroup,
  PickerCatalog,
  PickerResource,
  POPULAR_COMPONENT_IDS,
  buildPickerCatalog,
  getComponentOperation,
  getOperationRank,
  getPickerCatalog,
  isResourceComponent,
  tableNameToWords,
} from "../../../../../UI/Components/Workflow/ComponentPicker/PickerCatalog";
import IconProp from "../../../../../Types/Icon/IconProp";
import ComponentMetadata, {
  ComponentType,
} from "../../../../../Types/Workflow/Component";
import { DatabaseOperation } from "../../../../../Types/Workflow/DatabaseOperation";
import {
  FIXTURE_MODELS,
  FixtureModel,
  FixturePalette,
  buildFixturePalette,
} from "./PickerFixtures";
import { describe, expect, test } from "@jest/globals";

const palette: FixturePalette = buildFixturePalette();

type CatalogForFunction = (
  componentsType: ComponentType,
  source?: FixturePalette,
) => PickerCatalog;

const catalogFor: CatalogForFunction = (
  componentsType: ComponentType,
  source: FixturePalette = palette,
): PickerCatalog => {
  return buildPickerCatalog({
    components: source.components,
    categories: source.categories,
    componentsType: componentsType,
  });
};

const ACTIONS: PickerCatalog = catalogFor(ComponentType.Component);
const TRIGGERS: PickerCatalog = catalogFor(ComponentType.Trigger);

type TitlesOfFunction = (components: Array<ComponentMetadata>) => Array<string>;

const titlesOf: TitlesOfFunction = (
  components: Array<ComponentMetadata>,
): Array<string> => {
  return components.map((componentMetadata: ComponentMetadata): string => {
    return componentMetadata.title;
  });
};

type ResourceFunction = (catalog: PickerCatalog, key: string) => PickerResource;

const resource: ResourceFunction = (
  catalog: PickerCatalog,
  key: string,
): PickerResource => {
  const found: PickerResource | undefined = catalog.resourcesByKey.get(key);

  if (!found) {
    throw new Error(`No resource ${key} in this catalog.`);
  }

  return found;
};

describe("what the picker leads with", () => {
  test("the popular actions, in order: the steps most workflows are built from", () => {
    expect(titlesOf(ACTIONS.popular)).toEqual([
      "Log",
      "If / Else",
      "API Post (JSON)",
      "API Get (JSON)",
      "Send Message to Slack",
      "Send Message to Teams",
      "Send Message to Discord",
      "Send Email",
      "Run Custom JavaScript",
      "Create One Incident",
    ]);
  });

  test("the popular triggers, in order", () => {
    expect(titlesOf(TRIGGERS.popular)).toEqual([
      "Manual",
      "Schedule",
      "Webhook",
      "On Create Incident",
      "On Update Incident",
      "On Create Alert",
      "On Update Monitor",
    ]);
  });

  test("a popular step the catalog does not have is skipped, not an error", () => {
    const withoutIncident: FixturePalette = buildFixturePalette(
      FIXTURE_MODELS.filter((model: FixtureModel): boolean => {
        return model.tableName !== "Incident";
      }),
    );
    const catalog: PickerCatalog = catalogFor(
      ComponentType.Component,
      withoutIncident,
    );

    expect(titlesOf(catalog.popular)).not.toContain("Create One Incident");
    expect(catalog.popular).toHaveLength(
      POPULAR_COMPONENT_IDS[ComponentType.Component].length - 1,
    );
  });

  test("the other hand-written steps, by category in the categories' order, without the popular ones again", () => {
    expect(
      ACTIONS.otherBuiltInGroups.map((group: PickerBuiltInGroup): string => {
        return group.name;
      }),
    ).toEqual(["AI", "API", "Telegram", "JSON", "Utils"]);

    const others: Array<string> = ACTIONS.otherBuiltInGroups.flatMap(
      (group: PickerBuiltInGroup): Array<string> => {
        return titlesOf(group.components);
      },
    );

    expect(others).toEqual([
      "Generate Text with AI",
      "API Put (JSON)",
      "API Patch (JSON)",
      "API Delete (JSON)",
      "Send Message to Telegram",
      "JSON to Text",
      "Text to JSON",
      "Merge JSON",
      "Execute Workflow",
      "Sleep",
    ]);

    for (const title of titlesOf(ACTIONS.popular)) {
      expect(others).not.toContain(title);
    }
  });

  test("every trigger that is not generated is popular, so the trigger picker has no other group", () => {
    expect(TRIGGERS.otherBuiltInGroups).toEqual([]);
  });
});

describe("database steps, by resource", () => {
  test("every model with a step of the picker's kind is a resource, A to Z", () => {
    const names: Array<string> = ACTIONS.resources.map(
      (item: PickerResource): string => {
        return item.name;
      },
    );

    expect(names).toEqual(
      [...names].sort((a: string, b: string): number => {
        return a.localeCompare(b);
      }),
    );
    expect(ACTIONS.resources).toHaveLength(FIXTURE_MODELS.length);
  });

  test("a resource's actions run create, find, update, delete; one before many", () => {
    expect(titlesOf(resource(ACTIONS, "Incident").components)).toEqual([
      "Create One Incident",
      "Create Many Incidents",
      "Find One Incident",
      "Find Many Incidents",
      "Update One Incident",
      "Update Many Incidents",
      "Delete One Incident",
      "Delete Many Incidents",
    ]);
    expect(titlesOf(resource(TRIGGERS, "Incident").components)).toEqual([
      "On Create Incident",
      "On Update Incident",
      "On Delete Incident",
    ]);
  });

  test("a resource offers only what its model allows", () => {
    // Read only: two actions, and no triggers at all.
    expect(titlesOf(resource(ACTIONS, "AIAgent").components)).toEqual([
      "Find One AI Agent",
      "Find Many AI Agents",
    ]);
    expect(TRIGGERS.resourcesByKey.has("AIAgent")).toBe(false);

    // Create only.
    expect(titlesOf(resource(ACTIONS, "EmailLog").components)).toEqual([
      "Create One Email Log",
      "Create Many Email Logs",
    ]);
    expect(titlesOf(resource(TRIGGERS, "EmailLog").components)).toEqual([
      "On Create Email Log",
    ]);
  });

  test("a resource takes its description and icon from its own model's category", () => {
    const incident: PickerResource = resource(ACTIONS, "Incident");

    expect(incident.name).toBe("Incident");
    expect(incident.description).toBe("Manage incidents for your project");
    expect(incident.icon).toBe(IconProp.Alert);
    expect(incident.disambiguation).toBeNull();
  });

  test("two models with the same name stay two resources, each with its own icon, told apart by table", () => {
    const templates: PickerResource = resource(
      ACTIONS,
      "StatusPageSubscriberNotificationTemplate",
    );
    const links: PickerResource = resource(
      ACTIONS,
      "StatusPageSubscriberNotificationTemplateStatusPage",
    );

    expect(templates.name).toBe(links.name);
    expect(templates.icon).toBe(IconProp.Email);
    expect(links.icon).toBe(IconProp.Link);
    expect(templates.disambiguation).toBe(
      "Status Page Subscriber Notification Template",
    );
    expect(links.disambiguation).toBe(
      "Status Page Subscriber Notification Template Status Page",
    );
    expect(templates.components).toHaveLength(8);
    expect(links.components).toHaveLength(8);
  });

  test("the common resources are shown in their own order, and only those the catalog has", () => {
    const keys: Array<string> = ACTIONS.commonResources.map(
      (item: PickerResource): string => {
        return item.key;
      },
    );

    expect(keys).toEqual(
      COMMON_RESOURCE_TABLE_NAMES.filter((tableName: string): boolean => {
        return ACTIONS.resourcesByKey.has(tableName);
      }),
    );
    expect(keys.slice(0, 3)).toEqual(["Incident", "Alert", "Monitor"]);
    expect(keys).not.toContain("IncidentState");
    expect(resource(ACTIONS, "Incident").commonRank).toBe(0);
    expect(resource(ACTIONS, "IncidentState").commonRank).toBeNull();
  });
});

describe("telling the steps apart", () => {
  test("generated steps carry their table, hand-written ones do not", () => {
    for (const componentMetadata of palette.components) {
      expect(isResourceComponent(componentMetadata)).toBe(
        Boolean(componentMetadata.tableName),
      );
    }
  });

  test("every generated step's operation is read off its id", () => {
    const generated: Array<ComponentMetadata> =
      palette.components.filter(isResourceComponent);

    expect(generated.length).toBeGreaterThan(100);

    for (const componentMetadata of generated) {
      expect({
        id: componentMetadata.id,
        operation: getComponentOperation(componentMetadata),
      }).toEqual({
        id: componentMetadata.id,
        operation: expect.any(String),
      });
    }

    const incidentState: ComponentMetadata = palette.components.find(
      (componentMetadata: ComponentMetadata): boolean => {
        return componentMetadata.id === "incident-state-find-many";
      },
    )!;

    expect(getComponentOperation(incidentState)).toBe(
      DatabaseOperation.FindMany,
    );
  });

  test("a hand-written step, or an id with an unknown ending, has no operation", () => {
    const log: ComponentMetadata = palette.components.find(
      (componentMetadata: ComponentMetadata): boolean => {
        return componentMetadata.id === "log";
      },
    )!;

    expect(getComponentOperation(log)).toBeNull();
    expect(
      getComponentOperation({
        ...log,
        id: "incident-archive-one",
        tableName: "Incident",
      }),
    ).toBeNull();
    expect(getOperationRank(null)).toBe(DATABASE_OPERATION_ORDER.length);
    expect(getOperationRank(DatabaseOperation.CreateOne)).toBe(0);
    expect(getOperationRank(DatabaseOperation.OnDelete)).toBe(10);
  });

  test("a table name reads as words", () => {
    expect(tableNameToWords("OnCallDutyPolicy")).toBe("On Call Duty Policy");
    expect(tableNameToWords("AIAgent")).toBe("AI Agent");
    expect(tableNameToWords("Incident")).toBe("Incident");
  });
});

describe("only the first opening pays", () => {
  test("the same arrays give the same catalog; new arrays or another kind, a new one", () => {
    const first: PickerCatalog = getPickerCatalog({
      components: palette.components,
      categories: palette.categories,
      componentsType: ComponentType.Component,
    });

    expect(
      getPickerCatalog({
        components: palette.components,
        categories: palette.categories,
        componentsType: ComponentType.Component,
      }),
    ).toBe(first);
    expect(
      getPickerCatalog({
        components: palette.components,
        categories: [...palette.categories],
        componentsType: ComponentType.Component,
      }),
    ).not.toBe(first);
    expect(
      getPickerCatalog({
        components: palette.components,
        categories: palette.categories,
        componentsType: ComponentType.Trigger,
      }).componentsType,
    ).toBe(ComponentType.Trigger);
  });
});
