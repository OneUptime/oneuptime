import ComponentsModal, {
  SEARCH_RESULTS_PAGE_SIZE,
} from "../../../../../UI/Components/Workflow/ComponentsModal";
import {
  ComponentSearchIndex,
  ComponentSearchResult,
  SearchTier,
  buildComponentSearchIndex,
  searchComponents,
} from "../../../../../UI/Components/Workflow/ComponentPicker/ComponentSearch";
import {
  COMMON_RESOURCE_TABLE_NAMES,
  PickerCatalog,
  PickerResource,
  POPULAR_COMPONENT_IDS,
  buildPickerCatalog,
  getComponentOperation,
} from "../../../../../UI/Components/Workflow/ComponentPicker/PickerCatalog";
import { loadComponentsAndCategories } from "../../../../../UI/Components/Workflow/Utils";
import ComponentMetadata, {
  ComponentCategory,
  ComponentType,
} from "../../../../../Types/Workflow/Component";
import getJestMockFunction from "../../../../MockType";
import { describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

/*
 * The picker over the real catalog: every database model's steps plus the
 * hand-written ones, about 2,700 in all. This is the catalog the maintainer
 * searched when "incident" showed Incident State first and typing froze the
 * page, so the ranking that report was about is pinned here on the real
 * strings, and so is the cost of a search.
 *
 * It also holds the picker's own lists - the popular steps and the common
 * resources - to the catalog, so renaming a model or a step cannot quietly
 * empty them.
 */

const loaded: {
  components: Array<ComponentMetadata>;
  categories: Array<ComponentCategory>;
} = loadComponentsAndCategories();

const ACTIONS: PickerCatalog = buildPickerCatalog({
  components: loaded.components,
  categories: loaded.categories,
  componentsType: ComponentType.Component,
});
const TRIGGERS: PickerCatalog = buildPickerCatalog({
  components: loaded.components,
  categories: loaded.categories,
  componentsType: ComponentType.Trigger,
});

const ACTION_INDEX: ComponentSearchIndex = buildComponentSearchIndex(ACTIONS);
const TRIGGER_INDEX: ComponentSearchIndex = buildComponentSearchIndex(TRIGGERS);

type TitlesFunction = (
  index: ComponentSearchIndex,
  query: string,
) => Array<string>;

const titles: TitlesFunction = (
  index: ComponentSearchIndex,
  query: string,
): Array<string> => {
  return searchComponents(index, query).results.map(
    (result: ComponentSearchResult): string => {
      return result.component.title;
    },
  );
};

const INCIDENT_ACTIONS: Array<string> = [
  "Create One Incident",
  "Create Many Incidents",
  "Find One Incident",
  "Find Many Incidents",
  "Update One Incident",
  "Update Many Incidents",
  "Delete One Incident",
  "Delete Many Incidents",
];

describe("the picker's lists hold to the real catalog", () => {
  test("is the size of catalog the report was about", () => {
    expect(ACTIONS.components.length).toBeGreaterThan(1500);
    expect(TRIGGERS.components.length).toBeGreaterThan(500);
    expect(ACTIONS.resources.length).toBeGreaterThan(200);
  });

  test.each([ComponentType.Component, ComponentType.Trigger])(
    "every popular %s exists, as that kind of step",
    (componentsType: ComponentType) => {
      for (const id of POPULAR_COMPONENT_IDS[componentsType]) {
        const found: ComponentMetadata | undefined = loaded.components.find(
          (componentMetadata: ComponentMetadata): boolean => {
            return componentMetadata.id === id;
          },
        );

        expect({ id, type: found?.componentType }).toEqual({
          id,
          type: componentsType,
        });
      }

      const catalog: PickerCatalog =
        componentsType === ComponentType.Component ? ACTIONS : TRIGGERS;

      expect(catalog.popular).toHaveLength(
        POPULAR_COMPONENT_IDS[componentsType].length,
      );
    },
  );

  test("every common resource exists, with actions and triggers", () => {
    for (const tableName of COMMON_RESOURCE_TABLE_NAMES) {
      expect({
        tableName,
        actions: (ACTIONS.resourcesByKey.get(tableName)?.components || [])
          .length,
        triggers: (TRIGGERS.resourcesByKey.get(tableName)?.components || [])
          .length,
      }).toEqual({ tableName, actions: 8, triggers: 3 });
    }

    expect(
      ACTIONS.commonResources.map((resource: PickerResource): string => {
        return resource.key;
      }),
    ).toEqual([...COMMON_RESOURCE_TABLE_NAMES]);
  });

  test("every generated step's operation is read off its id", () => {
    /*
     * The picker orders and searches a resource's steps by operation, which
     * it reads off the end of the id BaseModelComponent gives each step. A
     * renamed suffix would leave a step without one.
     */
    const unread: Array<string> = loaded.components
      .filter((componentMetadata: ComponentMetadata): boolean => {
        return Boolean(componentMetadata.tableName);
      })
      .filter((componentMetadata: ComponentMetadata): boolean => {
        return getComponentOperation(componentMetadata) === null;
      })
      .map((componentMetadata: ComponentMetadata): string => {
        return componentMetadata.id;
      });

    expect(unread).toEqual([]);
  });

  test("every resource has its model's own description and icon", () => {
    for (const resource of ACTIONS.resources) {
      const category: ComponentCategory | undefined = loaded.categories.find(
        (candidate: ComponentCategory): boolean => {
          return candidate.tableName === resource.key;
        },
      );

      expect({ key: resource.key, found: Boolean(category) }).toEqual({
        key: resource.key,
        found: true,
      });
      expect(resource.description).toBe(category!.description);
      expect(resource.icon).toBe(category!.icon);
    }

    expect(ACTIONS.resourcesByKey.get("Incident")!.description).toBe(
      "Manage incidents for your project",
    );
  });

  test("every step has an id of its own", () => {
    const ids: Array<string> = loaded.components.map(
      (componentMetadata: ComponentMetadata): string => {
        return componentMetadata.id;
      },
    );

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("a model with no steps has no category for the picker to show", () => {
    for (const category of loaded.categories) {
      if (!category.tableName) {
        continue;
      }

      expect({
        tableName: category.tableName,
        hasSteps: loaded.components.some(
          (componentMetadata: ComponentMetadata): boolean => {
            return componentMetadata.tableName === category.tableName;
          },
        ),
      }).toEqual({ tableName: category.tableName, hasSteps: true });
    }
  });
});

describe("the searches from the report, on the real catalog", () => {
  test("'incident' lists Incident's steps first, and Incident State's after them", () => {
    const results: Array<string> = titles(ACTION_INDEX, "incident");

    expect(results.slice(0, 8)).toEqual(INCIDENT_ACTIONS);
    expect(results.indexOf("Create One Incident State")).toBeGreaterThan(7);
  });

  test("'create incident' puts Create One Incident first", () => {
    const results: Array<ComponentSearchResult> = searchComponents(
      ACTION_INDEX,
      "create incident",
    ).results;

    expect(results[0]!.component.title).toBe("Create One Incident");
    expect(results[1]!.component.title).toBe("Create Many Incidents");
    expect(results[0]!.tier).toBe(SearchTier.Named);
    expect(
      results.findIndex((result: ComponentSearchResult): boolean => {
        return result.component.title === "Create One Incident State";
      }),
    ).toBeGreaterThan(1);
  });

  test("the resource named comes first for other resources too", () => {
    expect(titles(ACTION_INDEX, "incident state").slice(0, 2)).toEqual([
      "Create One Incident State",
      "Create Many Incident States",
    ]);
    expect(titles(ACTION_INDEX, "alert")[0]).toBe("Create One Alert");
    expect(titles(ACTION_INDEX, "monitor")[0]).toBe("Create One Monitor");
    expect(titles(ACTION_INDEX, "status page")[0]).toBe(
      "Create One Status Page",
    );
    expect(titles(ACTION_INDEX, "update monitor")[0]).toBe(
      "Update One Monitor",
    );
    expect(titles(ACTION_INDEX, "find incidents")[0]).toBe(
      "Find Many Incidents",
    );
  });

  test("the hand-written steps are found by what people call them", () => {
    expect(titles(ACTION_INDEX, "log")[0]).toBe("Log");
    expect(titles(ACTION_INDEX, "slack")[0]).toBe("Send Message to Slack");
    expect(titles(ACTION_INDEX, "teams")[0]).toBe("Send Message to Teams");
    expect(titles(ACTION_INDEX, "email")[0]).toBe("Send Email");
    expect(titles(ACTION_INDEX, "if else")[0]).toBe("If / Else");
    expect(titles(ACTION_INDEX, "javascript")[0]).toBe("Run Custom JavaScript");
    expect(titles(ACTION_INDEX, "wait")[0]).toBe("Sleep");
    expect(titles(ACTION_INDEX, "http request").slice(0, 2).sort()).toEqual([
      "API Get (JSON)",
      "API Post (JSON)",
    ]);
  });

  test("plurals and typos find the same steps", () => {
    expect(titles(ACTION_INDEX, "incidnet").slice(0, 8)).toEqual(
      INCIDENT_ACTIONS,
    );
    expect(titles(ACTION_INDEX, "cretae incidnet")[0]).toBe(
      "Create One Incident",
    );
    expect(titles(ACTION_INDEX, "incidents").slice(0, 8).sort()).toEqual(
      [...INCIDENT_ACTIONS].sort(),
    );
    /*
     * The model's plural is "On-Call Duty Policies"; typing a plural puts the
     * steps that act on many first, all of them On-Call Policy's.
     */
    const policies: Array<ComponentSearchResult> = searchComponents(
      ACTION_INDEX,
      "on-call policies",
    ).results;

    expect(policies[0]!.component.title).toBe(
      "Create Many On-Call Duty Policies",
    );
    expect(
      policies.slice(0, 8).map((result: ComponentSearchResult): string => {
        return result.component.category;
      }),
    ).toEqual(new Array(8).fill("On-Call Policy"));
  });

  test("the trigger picker", () => {
    expect(titles(TRIGGER_INDEX, "incident").slice(0, 3)).toEqual([
      "On Create Incident",
      "On Update Incident",
      "On Delete Incident",
    ]);
    expect(titles(TRIGGER_INDEX, "incident created")[0]).toBe(
      "On Create Incident",
    );
    expect(titles(TRIGGER_INDEX, "webhook")[0]).toBe("Webhook");
    expect(titles(TRIGGER_INDEX, "every hour")[0]).toBe("Schedule");
  });
});

describe("a search over the full catalog is fast", () => {
  /*
   * The budgets are loose on purpose - a shared CI runner, no JIT warm-up -
   * and still far below what the old picker spent: it scored and drew every
   * step on every key, seconds on a slow machine.
   */
  test("building the catalog and its index takes a moment, once", () => {
    const started: number = performance.now();

    for (const componentsType of [
      ComponentType.Component,
      ComponentType.Trigger,
    ]) {
      buildComponentSearchIndex(
        buildPickerCatalog({
          components: loaded.components,
          categories: loaded.categories,
          componentsType: componentsType,
        }),
      );
    }

    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("each search, typed one letter at a time, stays well under a frame budget on average", () => {
    const typed: Array<string> = [];

    for (const query of [
      "create incident",
      "incident state",
      "send slack message",
      "cretae incidnet",
      "status page announcement",
      "update one monitor",
    ]) {
      for (let length: number = 1; length <= query.length; length++) {
        typed.push(query.slice(0, length));
      }
    }

    const durations: Array<number> = typed.map((query: string): number => {
      const started: number = performance.now();
      searchComponents(ACTION_INDEX, query);
      return performance.now() - started;
    });

    const total: number = durations.reduce((sum: number, value: number) => {
      return sum + value;
    }, 0);

    expect(typed.length).toBeGreaterThan(80);
    expect(total / typed.length).toBeLessThan(25);
    expect(Math.max(...durations)).toBeLessThan(250);
  });
});

describe("the picker over the full catalog draws a short list", () => {
  test("the start view and a search draw tens of entries, not thousands", () => {
    render(
      <ComponentsModal
        componentsType={ComponentType.Component}
        components={loaded.components}
        categories={loaded.categories}
        onCloseModal={getJestMockFunction()}
        onComponentClick={getJestMockFunction()}
      />,
    );

    const picker: HTMLElement = screen.getByTestId("workflow-component-picker");

    // Popular, the other built-ins, the common resources and "Browse all".
    expect(within(picker).getAllByRole("button").length).toBeLessThan(40);
    expect(
      screen.getByRole("button", {
        name: `Browse all resources, ${ACTIONS.resources.length}`,
      }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "incident" },
    });

    expect(screen.getAllByRole("option")).toHaveLength(
      SEARCH_RESULTS_PAGE_SIZE,
    );
    expect(screen.getAllByRole("option")[0]).toHaveAccessibleName(
      "Create One Incident",
    );
  });
});
