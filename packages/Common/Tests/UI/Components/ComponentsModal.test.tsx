import ComponentsModal, {
  ComponentProps,
  SEARCH_RESULTS_PAGE_SIZE,
} from "../../../UI/Components/Workflow/ComponentsModal";
import ComponentMetadata, {
  ComponentCategory,
  ComponentType,
} from "../../../Types/Workflow/Component";
import IconProp from "../../../Types/Icon/IconProp";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";
import {
  FixturePalette,
  buildFixturePalette,
  findByTitle,
} from "./Workflow/ComponentPicker/PickerFixtures";
import { describe, expect, it } from "@jest/globals";
/*
 * The main entry, not "/extend-expect": the latter no longer ships type
 * declarations, so every jest-dom matcher in this file fails to typecheck and
 * the whole suite is skipped before a single assertion runs.
 */
import "@testing-library/jest-dom";
import {
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React from "react";

/*
 * The Add Component / Add Trigger picker: what it leads with, browsing a
 * resource, picking a step, and how search results are drawn. Keyboard use
 * and accessibility are in ComponentsModalUsability.test.tsx; the ranking
 * itself in Workflow/ComponentPicker/ComponentSearch.test.ts; the full
 * catalog in Workflow/ComponentPicker/ComponentPickerRealCatalog.test.tsx.
 *
 * The palette is the real hand-written steps plus the real generator's
 * steps for a handful of models (PickerFixtures), with Incident State
 * registered before Incident as in the product.
 */

const palette: FixturePalette = buildFixturePalette();

type RenderPickerFunction = (
  overrides?: Partial<ComponentProps>,
) => RenderResult;

const renderPicker: RenderPickerFunction = (
  overrides: Partial<ComponentProps> = {},
): RenderResult => {
  return render(
    <ComponentsModal
      componentsType={ComponentType.Component}
      components={palette.components}
      categories={palette.categories}
      onCloseModal={getJestMockFunction()}
      onComponentClick={getJestMockFunction()}
      {...overrides}
    />,
  );
};

type SearchFunction = (value: string) => void;

const search: SearchFunction = (value: string): void => {
  fireEvent.change(screen.getByRole("combobox"), { target: { value } });
};

type SectionFunction = (name: string) => HTMLElement;

const section: SectionFunction = (name: string): HTMLElement => {
  return screen.getByRole("region", { name });
};

type ButtonNamesFunction = (container: HTMLElement) => Array<string>;

const buttonNames: ButtonNamesFunction = (
  container: HTMLElement,
): Array<string> => {
  return within(container)
    .getAllByRole("button")
    .map((button: HTMLElement): string => {
      return button.getAttribute("aria-label") || button.textContent || "";
    });
};

type OptionTitlesFunction = () => Array<string>;

const optionTitles: OptionTitlesFunction = (): Array<string> => {
  return screen.queryAllByRole("option").map((option: HTMLElement): string => {
    return option.getAttribute("aria-label") || "";
  });
};

describe("the start view leads with what people use", () => {
  it("says what the panel is for, and offers no second button to confirm a pick", () => {
    renderPicker();

    expect(screen.getByTestId("side-over-title")).toHaveTextContent(
      "Add Component",
    );
    expect(screen.getByTestId("side-over-description")).toHaveTextContent(
      "Click a component to add it to your workflow.",
    );
    expect(
      screen.queryByRole("button", { name: "Add to Workflow" }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("side-over-footer")).getByRole("button", {
        name: "Close",
      }),
    ).toBeInTheDocument();
  });

  it("shows the popular actions first, in order", () => {
    renderPicker();

    expect(buttonNames(section("Popular"))).toEqual([
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

  it("then the rest of the hand-written steps, each once", () => {
    renderPicker();

    expect(buttonNames(section("More components"))).toEqual([
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
  });

  it("then the common resources, and a way to every other one", () => {
    renderPicker();

    const resources: HTMLElement = section("OneUptime resources");

    expect(resources).toHaveTextContent(
      "Create, find, update or delete incidents, alerts, monitors and every other record in this project.",
    );
    expect(buttonNames(resources)).toEqual([
      "Incident, 8 actions",
      "Alert, 8 actions",
      "Monitor, 8 actions",
      "Status Page, 8 actions",
      "On-Call Policy, 8 actions",
      "Incident Public Note, 8 actions",
      "Incident Internal Note, 8 actions",
      "Incident Episode, 8 actions",
      `Browse all resources, ${21}`,
    ]);
  });

  it("does not list the generated steps themselves, which are what made the old list endless", () => {
    renderPicker();

    for (const title of [
      "Create One Incident State",
      "Find One Incident",
      "Update Many Monitors",
      "Delete One Incident Episode State Timeline",
    ]) {
      expect(
        screen.queryByRole("button", { name: title }),
      ).not.toBeInTheDocument();
    }

    // Everything on the start view, in all: a short list, whatever the catalog holds.
    expect(
      within(screen.getByTestId("workflow-component-picker")).getAllByRole(
        "button",
      ).length,
    ).toBeLessThan(40);
  });

  it("describes every step it shows", () => {
    renderPicker();

    expect(
      screen.getByRole("button", { name: "Log" }),
    ).toHaveAccessibleDescription(
      findByTitle(palette.components, "Log").description,
    );
    expect(
      screen.getByRole("button", { name: "Create One Incident" }),
    ).toHaveAccessibleDescription("Database query to create one Incident");
  });

  it("leads the trigger picker with the popular triggers, and counts a resource's triggers", () => {
    renderPicker({ componentsType: ComponentType.Trigger });

    expect(screen.getByTestId("side-over-title")).toHaveTextContent(
      "Add Trigger",
    );
    expect(buttonNames(section("Popular"))).toEqual([
      "Manual",
      "Schedule",
      "Webhook",
      "On Create Incident",
      "On Update Incident",
      "On Create Alert",
      "On Update Monitor",
    ]);
    // Every hand-written trigger is popular, so there is nothing more to list.
    expect(
      screen.queryByRole("region", { name: "More triggers" }),
    ).not.toBeInTheDocument();
    expect(section("OneUptime resources")).toHaveTextContent(
      "Start this workflow when an incident, alert, monitor or any other record in this project is created, updated or deleted.",
    );
    expect(
      screen.getByRole("button", { name: "Incident, 3 triggers" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Log" }),
    ).not.toBeInTheDocument();
  });

  it("names the hand-written steps' section plainly when nothing is popular", () => {
    const customCode: ComponentMetadata = {
      id: "custom",
      title: "Custom Step",
      description: "Does a custom thing",
      category: "Utils",
      iconProp: IconProp.Code,
      componentType: ComponentType.Component,
      arguments: [],
      returnValues: [],
      inPorts: [],
      outPorts: [],
    };

    renderPicker({ components: [customCode], categories: [] });

    expect(
      screen.queryByRole("region", { name: "Popular" }),
    ).not.toBeInTheDocument();
    expect(buttonNames(section("Components"))).toEqual(["Custom Step"]);
    expect(
      screen.queryByRole("region", { name: "OneUptime resources" }),
    ).not.toBeInTheDocument();
  });

  it("says when there is nothing to pick", () => {
    renderPicker({ components: [] });
    expect(screen.getByText("No components to show.")).toBeInTheDocument();

    renderPicker({
      componentsType: ComponentType.Trigger,
      components: palette.components.filter(
        (componentMetadata: ComponentMetadata): boolean => {
          return componentMetadata.componentType === ComponentType.Component;
        },
      ),
    });
    expect(screen.getByText("No triggers to show.")).toBeInTheDocument();
  });
});

describe("one click picks a step", () => {
  it("adds a step from the start view at once, and only that step", () => {
    const onComponentClick: MockFunction = getJestMockFunction();
    const onCloseModal: MockFunction = getJestMockFunction();
    renderPicker({ onComponentClick, onCloseModal });

    fireEvent.click(screen.getByRole("button", { name: "Send Email" }));

    expect(onComponentClick).toHaveBeenCalledTimes(1);
    expect(onComponentClick).toHaveBeenCalledWith(
      findByTitle(palette.components, "Send Email"),
    );
    // Closing is the builder's job once it has the step.
    expect(onCloseModal).not.toHaveBeenCalled();
  });

  it("closes from the footer without picking anything", () => {
    const onComponentClick: MockFunction = getJestMockFunction();
    const onCloseModal: MockFunction = getJestMockFunction();
    renderPicker({ onComponentClick, onCloseModal });

    fireEvent.click(
      within(screen.getByTestId("side-over-footer")).getByRole("button", {
        name: "Close",
      }),
    );

    expect(onCloseModal).toHaveBeenCalledTimes(1);
    expect(onComponentClick).not.toHaveBeenCalled();
  });
});

describe("browsing a resource", () => {
  it("opens a resource to what can be done with it, and adds the one clicked", () => {
    const onComponentClick: MockFunction = getJestMockFunction();
    renderPicker({ onComponentClick });

    fireEvent.click(
      screen.getByRole("button", { name: "Incident, 8 actions" }),
    );

    expect(
      screen.getByRole("heading", { name: "Incident" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Manage incidents for your project"),
    ).toBeInTheDocument();
    expect(
      buttonNames(screen.getByRole("group", { name: "Incident components" })),
    ).toEqual([
      "Create One Incident",
      "Create Many Incidents",
      "Find One Incident",
      "Find Many Incidents",
      "Update One Incident",
      "Update Many Incidents",
      "Delete One Incident",
      "Delete Many Incidents",
    ]);
    // The start view is gone while a resource is open.
    expect(
      screen.queryByRole("region", { name: "Popular" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Update One Incident" }),
    );

    expect(onComponentClick).toHaveBeenCalledTimes(1);
    expect(onComponentClick).toHaveBeenCalledWith(
      findByTitle(palette.components, "Update One Incident"),
    );
  });

  it("goes back to where it was opened from", () => {
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Alert, 8 actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(section("Popular")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Alert" }),
    ).not.toBeInTheDocument();
  });

  it("lists every resource A to Z, opens one, and comes back to the list", () => {
    renderPicker();

    fireEvent.click(
      screen.getByRole("button", { name: /^Browse all resources/ }),
    );

    expect(
      screen.getByRole("heading", { name: "All resources" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "21 resources, A to Z. Search above to find one by name.",
      ),
    ).toBeInTheDocument();

    const names: Array<string> = buttonNames(
      screen.getByRole("group", { name: "All resources" }),
    );

    expect(names).toHaveLength(21);
    expect(names.slice(0, 3)).toEqual([
      "AI Agent, 2 actions",
      "Alert, 8 actions",
      "Email Log, 2 actions",
    ]);
    // The rarely used ones are here, and only here.
    expect(names).toContain("Incident State, 8 actions");
    expect(names).toContain("Incident Episode State Timeline, 8 actions");

    fireEvent.click(
      screen.getByRole("button", { name: "Incident State, 8 actions" }),
    );
    expect(
      screen.getByRole("heading", { name: "Incident State" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("heading", { name: "All resources" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(section("Popular")).toBeInTheDocument();
  });

  it("tells apart two resources with the same name", () => {
    renderPicker();

    fireEvent.click(
      screen.getByRole("button", { name: /^Browse all resources/ }),
    );

    expect(
      screen.getByRole("button", {
        name: "Subscriber Notification Template (Status Page Subscriber Notification Template), 8 actions",
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Subscriber Notification Template (Status Page Subscriber Notification Template Status Page), 8 actions",
      }),
    );

    expect(
      screen.getByText(
        "Status Page Subscriber Notification Template Status Page",
      ),
    ).toBeInTheDocument();
  });

  it("goes back to the start view if the open resource leaves the catalog", () => {
    const props: ComponentProps = {
      componentsType: ComponentType.Component,
      components: palette.components,
      categories: palette.categories,
      onCloseModal: getJestMockFunction(),
      onComponentClick: getJestMockFunction(),
    };
    const view: RenderResult = render(<ComponentsModal {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Alert, 8 actions" }));

    view.rerender(
      <ComponentsModal
        {...props}
        components={palette.components.filter(
          (componentMetadata: ComponentMetadata): boolean => {
            return componentMetadata.tableName !== "Alert";
          },
        )}
      />,
    );

    expect(section("Popular")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Alert" }),
    ).not.toBeInTheDocument();
  });
});

describe("search results", () => {
  it("replace the view while there is a search, and give it back after", () => {
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Monitor, 8 actions" }));
    search("slack");

    expect(optionTitles()).toEqual(["Send Message to Slack"]);
    expect(
      screen.queryByRole("heading", { name: "Monitor" }),
    ).not.toBeInTheDocument();

    search("");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Monitor" }),
    ).toBeInTheDocument();
  });

  it("put the resource named first: Incident's steps before Incident State's", () => {
    renderPicker();

    search("incident");

    expect(optionTitles().slice(0, 8)).toEqual([
      "Create One Incident",
      "Create Many Incidents",
      "Find One Incident",
      "Find Many Incidents",
      "Update One Incident",
      "Update Many Incidents",
      "Delete One Incident",
      "Delete Many Incidents",
    ]);

    search("create incident");

    expect(optionTitles()[0]).toBe("Create One Incident");
    expect(optionTitles().indexOf("Create One Incident State")).toBeGreaterThan(
      1,
    );
  });

  it("draw only the best results, with the rest a click away", () => {
    renderPicker();

    search("incident");

    const total: number = 72;
    expect(screen.getAllByRole("option")).toHaveLength(
      SEARCH_RESULTS_PAGE_SIZE,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      `Best ${SEARCH_RESULTS_PAGE_SIZE} of ${total} matches.`,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: `Show ${total - SEARCH_RESULTS_PAGE_SIZE} more`,
      }),
    );

    expect(screen.getAllByRole("option")).toHaveLength(total);
    expect(screen.getByRole("status")).toHaveTextContent(`${total} matches.`);
    expect(
      screen.queryByRole("button", { name: /^Show \d+ more$/ }),
    ).not.toBeInTheDocument();

    // A new search starts again from the best results.
    search("incidents");
    expect(screen.getAllByRole("option")).toHaveLength(
      SEARCH_RESULTS_PAGE_SIZE,
    );
  });

  it("count one match as one", () => {
    renderPicker();

    search("slack");

    expect(screen.getByRole("status")).toHaveTextContent("1 match.");
  });

  it("mark what matched in each title, and show the resource beside it", () => {
    renderPicker();

    search("create inc");

    const first: HTMLElement = screen.getAllByRole("option")[0]!;

    expect(
      Array.from(first.querySelectorAll("mark")).map(
        (mark: HTMLElement): string | null => {
          return mark.textContent;
        },
      ),
    ).toEqual(["Create", "Inc"]);
    expect(first).toHaveAccessibleName("Create One Incident");
    expect(first).toHaveAccessibleDescription(
      "Database query to create one Incident",
    );
    expect(first).toHaveTextContent("Incident");
  });

  it("name the table of a resource that shares its name", () => {
    renderPicker();

    search("create one subscriber notification template");

    const options: Array<HTMLElement> = screen.getAllByRole("option");

    expect(options).toHaveLength(2);
    expect(
      options.map((option: HTMLElement): string => {
        return option.textContent || "";
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Status Page Subscriber Notification Template Status Page",
        ),
      ]),
    );
  });

  it("add the result clicked", () => {
    const onComponentClick: MockFunction = getJestMockFunction();
    renderPicker({ onComponentClick });

    search("incident state");
    fireEvent.click(screen.getAllByRole("option")[2]!);

    expect(onComponentClick).toHaveBeenCalledTimes(1);
    expect(onComponentClick).toHaveBeenCalledWith(
      findByTitle(palette.components, "Find One Incident State"),
    );
  });

  it("say what to try when nothing matches, and clear back to the view", () => {
    renderPicker();

    search("zzzz qqq");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(
      screen.getByText("No components match “zzzz qqq”"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Check the spelling, or try fewer or different words. For anything that is not here, the API components and Run Custom JavaScript can work with any service.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "No components match.",
    );

    /*
     * The × in the box clears it too; this is the button under the advice,
     * the one with words on it.
     */
    expect(
      screen.getAllByRole("button", { name: "Clear search" }),
    ).toHaveLength(2);
    fireEvent.click(screen.getByText("Clear search").closest("button")!);

    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(section("Popular")).toBeInTheDocument();
  });

  it("point a trigger search that finds nothing at the Webhook trigger", () => {
    renderPicker({ componentsType: ComponentType.Trigger });

    search("zzzz");

    expect(
      screen.getByText(
        "Check the spelling, or try fewer or different words. To start this workflow from another tool, use the Webhook trigger.",
      ),
    ).toBeInTheDocument();
  });

  it("treat punctuation alone as no search at all", () => {
    renderPicker();

    search("/ - ?");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(section("Popular")).toBeInTheDocument();
    // The box still holds what was typed, and can be cleared.
    expect(
      screen.getByRole("button", { name: "Clear search" }),
    ).toBeInTheDocument();
  });
});

describe("the categories a caller hands in", () => {
  it("are optional: steps without one are still shown and searchable", () => {
    const categories: Array<ComponentCategory> = [];
    renderPicker({ categories });

    expect(screen.getByRole("button", { name: "Log" })).toBeInTheDocument();
    search("incident");
    expect(optionTitles()[0]).toBe("Create One Incident");
  });
});
