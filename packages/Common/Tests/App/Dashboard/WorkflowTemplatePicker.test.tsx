import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import WorkflowTemplatePicker, {
  WORKFLOW_TEMPLATE_LISTBOX_ID,
  workflowTemplateOptionDomId,
  workflowTemplateViewDomId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowTemplatePicker";
import {
  INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE,
  WorkflowTemplateCollection,
  WorkflowTemplatePickerState,
  WorkflowTemplatePickerView,
  WorkflowTemplatePickerViewInfo,
  getWorkflowTemplateCategoryLabel,
  getWorkflowTemplatePickerViews,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Workflow/WorkflowTemplatePickerUtil";
import {
  RECOMMENDED_WORKFLOW_TEMPLATE_IDS,
  WorkflowTemplate,
  WorkflowTemplateCategories,
  WorkflowTemplateCategory,
  getWorkflowTemplate,
  getWorkflowTemplateCategoryInfo,
  getWorkflowTemplates,
  getWorkflowTemplatesByCategory,
} from "../../../Types/Workflow/Templates";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

/*
 * The template picker on its own: the "Start from" step of Create a
 * workflow. It replaced a grid of every template at once, as equally large
 * cards, that the maintainer called decision paralysis. These tests hold the
 * new shape to what it promises: a handful of recommended templates first,
 * the rest one click away under categories with counts, compact rows, a
 * preview of what a template does before it is chosen, a search that reads
 * every word, a keyboard that works like the command palette's, and a
 * narrow-screen layout where the preview takes the list's place. The wizard
 * around it is covered in CreateWorkflowModal.test.tsx.
 */

const ALL_TEMPLATES: Array<WorkflowTemplate> = getWorkflowTemplates();
const OPTION_PREFIX: string = "workflow-template-option-";

interface Harness {
  view: RenderResult;
  onUseTemplate: MockFunction;
  onStartFromScratch: MockFunction;
  onStateChange: MockFunction;
}

interface HarnessProps {
  initialState: WorkflowTemplatePickerState;
  isStartFromScratchChosen: boolean;
  onUseTemplate: (template: WorkflowTemplate) => void;
  onStartFromScratch: () => void;
  onStateChange: (state: WorkflowTemplatePickerState) => void;
}

// Holds the picker's state the way the wizard does.
const PickerHost: (props: HarnessProps) => ReactElement = (
  props: HarnessProps,
): ReactElement => {
  const [state, setState] = useState<WorkflowTemplatePickerState>(
    props.initialState,
  );

  return (
    <WorkflowTemplatePicker
      state={state}
      onStateChange={(next: WorkflowTemplatePickerState) => {
        props.onStateChange(next);
        setState(next);
      }}
      onUseTemplate={props.onUseTemplate}
      onStartFromScratch={props.onStartFromScratch}
      isStartFromScratchChosen={props.isStartFromScratchChosen}
    />
  );
};

interface RenderOptions {
  initialState?: WorkflowTemplatePickerState | undefined;
  isStartFromScratchChosen?: boolean | undefined;
}

type RenderPickerFunction = (options?: RenderOptions) => Harness;

const renderPicker: RenderPickerFunction = (
  options?: RenderOptions,
): Harness => {
  const onUseTemplate: MockFunction = getJestMockFunction();
  const onStartFromScratch: MockFunction = getJestMockFunction();
  const onStateChange: MockFunction = getJestMockFunction();

  const view: RenderResult = render(
    <PickerHost
      initialState={
        options?.initialState || INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE
      }
      isStartFromScratchChosen={Boolean(options?.isStartFromScratchChosen)}
      onUseTemplate={onUseTemplate}
      onStartFromScratch={onStartFromScratch}
      onStateChange={onStateChange}
    />,
  );

  return {
    view: view,
    onUseTemplate: onUseTemplate,
    onStartFromScratch: onStartFromScratch,
    onStateChange: onStateChange,
  };
};

type TemplateFunction = (templateId: string) => WorkflowTemplate;

const template: TemplateFunction = (templateId: string): WorkflowTemplate => {
  const found: WorkflowTemplate | null = getWorkflowTemplate(templateId);

  if (!found) {
    throw new Error(`No template "${templateId}".`);
  }

  return found;
};

type ElementFunction = () => HTMLElement;

const getSearch: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("workflow-template-search");
};

const getListbox: ElementFunction = (): HTMLElement => {
  return screen.getByRole("listbox");
};

const getCategories: ElementFunction = (): HTMLElement => {
  return screen.getByRole("radiogroup", { name: "Template categories" });
};

const getPreview: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("workflow-template-preview");
};

type ListedIdsFunction = (container?: HTMLElement) => Array<string>;

/** The template ids on the list, in the order shown. */
const listedIds: ListedIdsFunction = (
  container?: HTMLElement,
): Array<string> => {
  return within(container || getListbox())
    .queryAllByRole("option")
    .map((option: HTMLElement): string => {
      return (option.getAttribute("data-testid") || "").slice(
        OPTION_PREFIX.length,
      );
    });
};

type ActiveIdFunction = () => string | null;

const activeId: ActiveIdFunction = (): string | null => {
  const selected: Array<HTMLElement> = within(getListbox())
    .queryAllByRole("option")
    .filter((option: HTMLElement) => {
      return option.getAttribute("aria-selected") === "true";
    });

  expect(selected.length).toBeLessThanOrEqual(1);

  return selected[0]
    ? (selected[0].getAttribute("data-testid") || "").slice(
        OPTION_PREFIX.length,
      )
    : null;
};

type CategoryRadioFunction = (view: WorkflowTemplatePickerView) => HTMLElement;

const categoryRadio: CategoryRadioFunction = (
  view: WorkflowTemplatePickerView,
): HTMLElement => {
  return screen.getByTestId(workflowTemplateViewDomId(view));
};

type ShowViewFunction = (view: WorkflowTemplatePickerView) => void;

const showView: ShowViewFunction = (view: WorkflowTemplatePickerView): void => {
  fireEvent.click(categoryRadio(view));
};

type TypeFunction = (text: string) => void;

const typeSearch: TypeFunction = (text: string): void => {
  fireEvent.change(getSearch(), { target: { value: text } });
};

type PreviewTitleFunction = () => string;

const previewTitle: PreviewTitleFunction = (): string => {
  return (
    within(getPreview()).getByRole("heading", { level: 3 }).textContent || ""
  );
};

type KeyFunction = (element: HTMLElement, key: string) => boolean;

/** Press a key on an element; true when the picker handled it (default prevented). */
const press: KeyFunction = (element: HTMLElement, key: string): boolean => {
  return !fireEvent.keyDown(element, { key: key });
};

const scrollIntoView: MockFunction = getJestMockFunction();

beforeEach(() => {
  scrollIntoView.mockClear();
  // jsdom has no layout, and so no scrollIntoView of its own.
  Element.prototype.scrollIntoView =
    scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the two ways to start", () => {
  test("Start from scratch is a plain button beside the search, and starts with an empty canvas", () => {
    const harness: Harness = renderPicker();
    const scratch: HTMLElement = screen.getByTestId(
      "workflow-start-from-scratch",
    );

    expect(scratch).toHaveTextContent("Start from scratch");
    expect(scratch).toHaveAttribute("type", "button");
    // Plain, never filled: the dialog's one primary button is Use this template.
    expect(scratch.className).toContain("bg-white");
    expect(scratch.className).not.toMatch(/\bbg-indigo-\d+/);

    fireEvent.click(scratch);

    expect(harness.onStartFromScratch).toHaveBeenCalledTimes(1);
    expect(harness.onUseTemplate).not.toHaveBeenCalled();
  });

  test("Start from scratch shows when it is the start already chosen", () => {
    renderPicker({ isStartFromScratchChosen: true });

    const scratch: HTMLElement = screen.getByTestId(
      "workflow-start-from-scratch",
    );

    expect(scratch).toHaveAttribute("aria-pressed", "true");
    expect(scratch.className).toContain("border-indigo-500");
  });

  test("it is not pressed otherwise", () => {
    renderPicker();

    expect(screen.getByTestId("workflow-start-from-scratch")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("what the picker opens on", () => {
  test("the recommended handful, in their order, and nothing else", () => {
    renderPicker();

    expect(listedIds()).toEqual([...RECOMMENDED_WORKFLOW_TEMPLATE_IDS]);
    expect(listedIds().length).toBeLessThanOrEqual(8);
    expect(ALL_TEMPLATES.length).toBeGreaterThan(listedIds().length * 5);
  });

  test("headed Recommended, with a line saying what they are", () => {
    renderPicker();

    expect(
      screen.getByRole("heading", { level: 3, name: "Recommended" }),
    ).toBeInTheDocument();
    expect(screen.getByText("A few good places to start.")).toBeInTheDocument();
    expect(getListbox()).toHaveAccessibleName("Recommended");
  });

  test("compact rows: no subheadings and no category tags", () => {
    renderPicker();

    expect(within(getListbox()).queryAllByRole("group")).toEqual([]);
    expect(screen.queryAllByTestId("workflow-template-row-category")).toEqual(
      [],
    );
  });

  test("each row shows the template's name and description, and nothing else to read", () => {
    renderPicker();

    for (const templateId of RECOMMENDED_WORKFLOW_TEMPLATE_IDS) {
      const row: HTMLElement = screen.getByTestId(
        workflowTemplateOptionDomId(templateId),
      );

      expect(row).toHaveTextContent(
        `${template(templateId).name}${template(templateId).description}`,
      );
    }
  });

  test("the first one highlighted and previewed, with the search box focused", () => {
    renderPicker();

    expect(activeId()).toBe(RECOMMENDED_WORKFLOW_TEMPLATE_IDS[0]);
    expect(previewTitle()).toBe(
      template(RECOMMENDED_WORKFLOW_TEMPLATE_IDS[0]!).name,
    );
    expect(getSearch()).toHaveFocus();
  });

  test("a hint for the keyboard under the list", () => {
    renderPicker();

    expect(screen.getByText("to move")).toBeInTheDocument();
    expect(screen.getByText("to use")).toBeInTheDocument();
  });
});

describe("the categories", () => {
  test("Recommended, every category, then All templates, each with its count", () => {
    renderPicker();

    const radios: Array<HTMLElement> =
      within(getCategories()).getAllByRole("radio");

    expect(
      radios.map((radio: HTMLElement): string => {
        return radio.getAttribute("aria-label") || "";
      }),
    ).toEqual([
      `Recommended (${RECOMMENDED_WORKFLOW_TEMPLATE_IDS.length})`,
      ...WorkflowTemplateCategories.map(
        (category: WorkflowTemplateCategory): string => {
          return `${getWorkflowTemplateCategoryInfo(category).label} (${
            getWorkflowTemplatesByCategory(category).length
          })`;
        },
      ),
      `All templates (${ALL_TEMPLATES.length})`,
    ]);
  });

  test("a name cut short for room can still be read whole, on hover", () => {
    renderPicker();

    for (const info of getWorkflowTemplatePickerViews()) {
      expect(categoryRadio(info.view)).toHaveAttribute("title", info.label);
    }
  });

  test("one is chosen at a time, and only it is in the tab order", () => {
    renderPicker();

    const radios: Array<HTMLElement> =
      within(getCategories()).getAllByRole("radio");
    const checked: Array<HTMLElement> = radios.filter((radio: HTMLElement) => {
      return radio.getAttribute("aria-checked") === "true";
    });

    expect(checked).toEqual([
      categoryRadio(WorkflowTemplateCollection.Recommended),
    ]);

    for (const radio of radios) {
      expect(radio).toHaveAttribute(
        "tabindex",
        radio === checked[0] ? "0" : "-1",
      );
    }
  });

  test.each(
    WorkflowTemplateCategories.map((category: WorkflowTemplateCategory) => {
      return [category];
    }),
  )(
    "%s lists its own templates, under its label and description",
    (category: WorkflowTemplateCategory) => {
      renderPicker();
      showView(category);

      const expectedIds: Array<string> = getWorkflowTemplatesByCategory(
        category,
      ).map((candidate: WorkflowTemplate): string => {
        return candidate.id;
      });

      expect(listedIds()).toEqual(expectedIds);
      expect(categoryRadio(category)).toHaveAttribute("aria-checked", "true");
      expect(
        screen.getByRole("heading", {
          level: 3,
          name: getWorkflowTemplateCategoryInfo(category).label,
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(getWorkflowTemplateCategoryInfo(category).description),
      ).toBeInTheDocument();
      // The first of them is highlighted.
      expect(activeId()).toBe(expectedIds[0]);
    },
  );

  test("Jira's seventeen are split into its incident and its alert templates", () => {
    renderPicker();
    showView(WorkflowTemplateCategory.Jira);

    const groups: Array<HTMLElement> =
      within(getListbox()).getAllByRole("group");

    expect(
      groups.map((group: HTMLElement) => {
        return [group.getAttribute("aria-label"), listedIds(group).length];
      }),
    ).toEqual([
      ["Incidents", 9],
      ["Alerts", 8],
    ]);

    for (const group of groups) {
      const noun: string =
        group.getAttribute("aria-label") === "Incidents" ? "incident" : "alert";

      for (const templateId of listedIds(group)) {
        expect(template(templateId).subcategory).toBe(
          group.getAttribute("aria-label"),
        );
        expect(templateId).toContain(`-${noun}`);
      }
    }
  });

  /*
   * Nothing may go missing in the new layout: All templates is the one place
   * where every template is listed, each under its category's heading.
   */
  test("All templates lists every template exactly once, under its category", () => {
    renderPicker();
    showView(WorkflowTemplateCollection.All);

    expect(listedIds().sort()).toEqual(
      ALL_TEMPLATES.map((candidate: WorkflowTemplate): string => {
        return candidate.id;
      }).sort(),
    );

    for (const group of within(getListbox()).getAllByRole("group")) {
      for (const templateId of listedIds(group)) {
        expect(
          getWorkflowTemplateCategoryLabel(template(templateId).category),
        ).toBe(group.getAttribute("aria-label"));
      }
    }

    expect(
      within(getListbox())
        .getAllByRole("group")
        .map((group: HTMLElement) => {
          return group.getAttribute("aria-label");
        }),
    ).toEqual(
      WorkflowTemplateCategories.map((category: WorkflowTemplateCategory) => {
        return getWorkflowTemplateCategoryInfo(category).label;
      }),
    );
  });

  test("a group's heading says how many templates are under it", () => {
    renderPicker();
    showView(WorkflowTemplateCategory.Jira);

    const incidents: HTMLElement = screen.getByTestId(
      "workflow-template-section-incidents",
    );

    expect(incidents.firstElementChild).toHaveTextContent("Incidents9");
    expect(incidents.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  test("the arrow keys move between categories, choosing as they go, and wrap round", () => {
    renderPicker();

    const recommended: HTMLElement = categoryRadio(
      WorkflowTemplateCollection.Recommended,
    );
    const views: Array<WorkflowTemplatePickerViewInfo> =
      getWorkflowTemplatePickerViews();

    recommended.focus();

    expect(press(recommended, "ArrowDown")).toBe(true);
    expect(categoryRadio(views[1]!.view)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(categoryRadio(views[1]!.view)).toHaveFocus();
    expect(listedIds()).toEqual(
      getWorkflowTemplatesByCategory(
        views[1]!.view as WorkflowTemplateCategory,
      ).map((candidate: WorkflowTemplate) => {
        return candidate.id;
      }),
    );

    press(categoryRadio(views[1]!.view), "ArrowRight");
    expect(categoryRadio(views[2]!.view)).toHaveAttribute(
      "aria-checked",
      "true",
    );

    press(categoryRadio(views[2]!.view), "ArrowLeft");
    press(categoryRadio(views[1]!.view), "ArrowUp");
    expect(recommended).toHaveAttribute("aria-checked", "true");

    // Up from the first goes round to the last.
    press(recommended, "ArrowUp");
    expect(categoryRadio(WorkflowTemplateCollection.All)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(categoryRadio(WorkflowTemplateCollection.All)).toHaveFocus();

    press(categoryRadio(WorkflowTemplateCollection.All), "Home");
    expect(recommended).toHaveAttribute("aria-checked", "true");

    press(recommended, "End");
    expect(categoryRadio(WorkflowTemplateCollection.All)).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("other keys are left alone", () => {
    renderPicker();

    expect(
      press(categoryRadio(WorkflowTemplateCollection.Recommended), "a"),
    ).toBe(false);
  });

  /*
   * Below the widest screens the categories are a select over the list: as
   * a wrapping row of twelve chips they took three lines.
   */
  test("narrower screens choose the category from a select, which says the same", () => {
    renderPicker();

    const select: HTMLSelectElement = screen.getByTestId(
      "workflow-template-view-select",
    ) as HTMLSelectElement;

    expect(select).toHaveAccessibleName("Template categories");
    expect(
      Array.from(select.options).map((option: HTMLOptionElement) => {
        return option.textContent;
      }),
    ).toEqual(
      within(getCategories())
        .getAllByRole("radio")
        .map((radio: HTMLElement) => {
          return radio.getAttribute("aria-label");
        }),
    );
    expect(select.value).toBe(WorkflowTemplateCollection.Recommended);

    fireEvent.change(select, {
      target: { value: WorkflowTemplateCategory.Monitors },
    });

    expect(listedIds()).toEqual(
      getWorkflowTemplatesByCategory(WorkflowTemplateCategory.Monitors).map(
        (candidate: WorkflowTemplate) => {
          return candidate.id;
        },
      ),
    );
    expect(categoryRadio(WorkflowTemplateCategory.Monitors)).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("the list of categories is a column only on wide screens, and the select is the rest of the time", () => {
    renderPicker();

    expect(getCategories().className).toContain("max-xl:hidden");
    expect(getCategories().className).toContain("xl:flex");
    expect(
      screen.getByTestId("workflow-template-view-select").parentElement
        ?.className,
    ).toContain("xl:hidden");
  });
});

describe("the search", () => {
  test("is a combobox over the list", () => {
    renderPicker();

    const search: HTMLElement = getSearch();

    expect(search).toHaveAttribute("role", "combobox");
    expect(search).toHaveAttribute(
      "aria-controls",
      WORKFLOW_TEMPLATE_LISTBOX_ID,
    );
    expect(search).toHaveAttribute("aria-expanded", "true");
    expect(search).toHaveAttribute("aria-autocomplete", "list");
    expect(search).toHaveAttribute("autocomplete", "off");
    expect(search).toHaveAccessibleName("Search templates…");
    expect(search).toHaveAttribute(
      "aria-activedescendant",
      workflowTemplateOptionDomId(RECOMMENDED_WORKFLOW_TEMPLATE_IDS[0]!),
    );
    expect(getListbox()).toHaveAttribute("id", WORKFLOW_TEMPLATE_LISTBOX_ID);
  });

  test("looks through every template, whichever category was open", () => {
    renderPicker();
    showView(WorkflowTemplateCategory.Alerts);
    typeSearch("discord");

    expect(listedIds()).toEqual(["incident-created-discord"]);
    expect(categoryRadio(WorkflowTemplateCollection.All)).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("says how many it found, and where", () => {
    renderPicker();
    typeSearch("slack");

    const results: number = listedIds().length;

    expect(results).toBeGreaterThan(1);
    expect(
      screen.getByRole("heading", { level: 3, name: `${results} results` }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-template-result-count"),
    ).toHaveTextContent(`${results} results`);
    expect(
      screen.getByTestId("workflow-template-result-count"),
    ).toHaveAttribute("aria-live", "polite");
    expect(categoryRadio(WorkflowTemplateCategory.Jira)).toHaveAttribute(
      "aria-label",
      "Jira (0)",
    );
    expect(categoryRadio(WorkflowTemplateCollection.All)).toHaveAttribute(
      "aria-label",
      `All templates (${results})`,
    );
  });

  test("one result is a result, not results", () => {
    renderPicker();
    typeSearch("discord");

    expect(
      screen.getByRole("heading", { level: 3, name: "1 result" }),
    ).toBeInTheDocument();
  });

  test("dims the categories it found nothing in", () => {
    renderPicker();
    typeSearch("slack");

    expect(categoryRadio(WorkflowTemplateCategory.Jira).className).toContain(
      "text-gray-400",
    );
    expect(
      categoryRadio(WorkflowTemplateCategory.Incidents).className,
    ).toContain("text-gray-700");
  });

  test("tags each result with its category, where the results mix them", () => {
    renderPicker();
    typeSearch("slack");

    const tags: Array<string> = screen
      .getAllByTestId("workflow-template-row-category")
      .map((tag: HTMLElement) => {
        return tag.textContent || "";
      });

    expect(tags).toHaveLength(listedIds().length);
    expect(tags).toEqual(
      listedIds().map((templateId: string): string => {
        return getWorkflowTemplateCategoryLabel(template(templateId).category);
      }),
    );
  });

  test("narrowed to one category, the results need no tags", () => {
    renderPicker();
    typeSearch("slack");
    showView(WorkflowTemplateCategory.Monitors);

    expect(screen.queryAllByTestId("workflow-template-row-category")).toEqual(
      [],
    );
    expect(listedIds().length).toBeGreaterThan(0);

    for (const templateId of listedIds()) {
      expect(template(templateId).category).toBe(
        WorkflowTemplateCategory.Monitors,
      );
    }
  });

  test("marks the words it matched", () => {
    renderPicker();
    typeSearch("teams incident");

    const row: HTMLElement = screen.getByTestId(
      workflowTemplateOptionDomId("incident-created-teams"),
    );
    const marks: Array<string> = Array.from(row.querySelectorAll("mark")).map(
      (mark: Element) => {
        return mark.textContent || "";
      },
    );

    expect(marks).toContain("Teams");
    expect(marks).toContain("incident");
  });

  test("highlights the best match", () => {
    renderPicker();
    typeSearch("heartbeat");

    expect(activeId()).toBe("scheduled-heartbeat");
    expect(previewTitle()).toBe(template("scheduled-heartbeat").name);
  });

  test("a clear button takes the search away and gives the focus back to the box", () => {
    renderPicker();

    expect(
      screen.queryByTestId("workflow-template-search-clear"),
    ).not.toBeInTheDocument();

    typeSearch("slack");
    fireEvent.click(screen.getByTestId("workflow-template-search-clear"));

    expect(getSearch()).toHaveValue("");
    expect(getSearch()).toHaveFocus();
    expect(listedIds()).toEqual([...RECOMMENDED_WORKFLOW_TEMPLATE_IDS]);
  });

  test("clearing the search goes back to the category that was being browsed", () => {
    renderPicker();
    showView(WorkflowTemplateCategory.OnCall);
    typeSearch("slack");
    typeSearch("");

    expect(categoryRadio(WorkflowTemplateCategory.OnCall)).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  describe("when nothing matches", () => {
    test("it says so, offers to clear the search, and previews nothing", () => {
      renderPicker();
      typeSearch("pagerduty");

      const empty: HTMLElement = screen.getByTestId("workflow-template-empty");

      expect(empty).toHaveTextContent("No templates match your search.");
      expect(empty).toHaveTextContent(
        "Try other words, or start from scratch.",
      );
      expect(listedIds()).toEqual([]);
      expect(
        screen.queryByTestId("workflow-template-preview"),
      ).not.toBeInTheDocument();
      expect(getSearch()).not.toHaveAttribute("aria-activedescendant");
      // There is nothing else to search.
      expect(
        screen.queryByTestId("workflow-template-search-everywhere"),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("workflow-template-empty-clear"));

      expect(getSearch()).toHaveValue("");
      expect(listedIds()).toEqual([...RECOMMENDED_WORKFLOW_TEMPLATE_IDS]);
    });

    test("narrowed to a category, it offers the matches elsewhere", () => {
      renderPicker();
      typeSearch("slack");
      showView(WorkflowTemplateCategory.Jira);

      expect(listedIds()).toEqual([]);

      const everywhere: HTMLElement = screen.getByTestId(
        "workflow-template-search-everywhere",
      );
      const allCount: string = (
        categoryRadio(WorkflowTemplateCollection.All).getAttribute(
          "aria-label",
        ) || ""
      ).replace(/^All templates /, "");

      expect(everywhere).toHaveTextContent(`Search all templates ${allCount}`);

      fireEvent.click(everywhere);

      expect(categoryRadio(WorkflowTemplateCollection.All)).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(listedIds().length).toBeGreaterThan(0);
      expect(getSearch()).toHaveValue("slack");
    });

    test("no keyboard hint, since there is nothing to move to", () => {
      renderPicker();
      typeSearch("pagerduty");

      expect(screen.queryByText("to move")).not.toBeInTheDocument();
    });
  });
});

describe("the keyboard, from the search box", () => {
  test("the arrow keys move the highlight, and the preview follows", () => {
    renderPicker();

    const recommended: Array<string> = [...RECOMMENDED_WORKFLOW_TEMPLATE_IDS];

    expect(press(getSearch(), "ArrowDown")).toBe(true);
    expect(activeId()).toBe(recommended[1]);
    expect(getSearch()).toHaveAttribute(
      "aria-activedescendant",
      workflowTemplateOptionDomId(recommended[1]!),
    );
    expect(previewTitle()).toBe(template(recommended[1]!).name);

    press(getSearch(), "ArrowDown");
    press(getSearch(), "ArrowUp");

    expect(activeId()).toBe(recommended[1]);
    // The focus stays in the box, so typing goes on.
    expect(getSearch()).toHaveFocus();
  });

  test("the highlight is scrolled into view as it moves", () => {
    renderPicker();
    press(getSearch(), "ArrowDown");

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  test("it stops at the top and the bottom of the list", () => {
    renderPicker();

    const recommended: Array<string> = [...RECOMMENDED_WORKFLOW_TEMPLATE_IDS];

    press(getSearch(), "ArrowUp");
    expect(activeId()).toBe(recommended[0]);

    for (let i: number = 0; i < recommended.length + 3; i++) {
      press(getSearch(), "ArrowDown");
    }

    expect(activeId()).toBe(recommended[recommended.length - 1]);
  });

  test("Home and End move the caret in the box, not the highlight", () => {
    renderPicker();

    expect(press(getSearch(), "End")).toBe(false);
    expect(press(getSearch(), "Home")).toBe(false);
    expect(activeId()).toBe(RECOMMENDED_WORKFLOW_TEMPLATE_IDS[0]);
  });

  test("Enter uses the highlighted template", () => {
    const harness: Harness = renderPicker();

    typeSearch("telegram");
    expect(press(getSearch(), "Enter")).toBe(true);

    expect(harness.onUseTemplate).toHaveBeenCalledTimes(1);
    expect(harness.onUseTemplate.mock.calls[0]?.[0]).toEqual(
      template("alert-created-telegram"),
    );
  });

  test("Enter while an input method is still composing does nothing", () => {
    const harness: Harness = renderPicker();

    fireEvent.keyDown(getSearch(), { key: "Enter", isComposing: true });

    expect(harness.onUseTemplate).not.toHaveBeenCalled();
  });

  test("Enter with nothing found does nothing", () => {
    const harness: Harness = renderPicker();

    typeSearch("pagerduty");
    press(getSearch(), "Enter");

    expect(harness.onUseTemplate).not.toHaveBeenCalled();
  });

  test("Escape clears a search, and is handled; on an empty box it is left to the dialog", () => {
    renderPicker();

    typeSearch("jira");
    expect(press(getSearch(), "Escape")).toBe(true);
    expect(getSearch()).toHaveValue("");

    expect(press(getSearch(), "Escape")).toBe(false);
  });

  test("typing a slash in the box types a slash", () => {
    renderPicker();

    expect(press(getSearch(), "/")).toBe(false);
  });
});

describe("the keyboard, in the list", () => {
  test("the list can take the focus, and answers the arrow keys, Home and End", () => {
    renderPicker();

    const listbox: HTMLElement = getListbox();
    const recommended: Array<string> = [...RECOMMENDED_WORKFLOW_TEMPLATE_IDS];

    expect(listbox).toHaveAttribute("tabindex", "0");

    listbox.focus();

    press(listbox, "ArrowDown");
    expect(activeId()).toBe(recommended[1]);
    expect(listbox).toHaveAttribute(
      "aria-activedescendant",
      workflowTemplateOptionDomId(recommended[1]!),
    );

    expect(press(listbox, "End")).toBe(true);
    expect(activeId()).toBe(recommended[recommended.length - 1]);

    expect(press(listbox, "Home")).toBe(true);
    expect(activeId()).toBe(recommended[0]);
  });

  test("Enter uses the highlighted template, and Space does not scroll the dialog", () => {
    const harness: Harness = renderPicker();
    const listbox: HTMLElement = getListbox();

    press(listbox, "ArrowDown");
    expect(press(listbox, " ")).toBe(true);
    expect(harness.onUseTemplate).not.toHaveBeenCalled();

    press(listbox, "Enter");

    expect(harness.onUseTemplate.mock.calls[0]?.[0]).toEqual(
      template(RECOMMENDED_WORKFLOW_TEMPLATE_IDS[1]!),
    );
  });

  test("the arrows walk across Jira's two parts as one list", () => {
    renderPicker();
    showView(WorkflowTemplateCategory.Jira);

    const listbox: HTMLElement = getListbox();
    const groups: Array<HTMLElement> = within(listbox).getAllByRole("group");
    const lastIncident: string = listedIds(groups[0]).pop() as string;
    const firstAlert: string = listedIds(groups[1])[0] as string;

    fireEvent.click(
      screen.getByTestId(workflowTemplateOptionDomId(lastIncident)),
    );
    press(listbox, "ArrowDown");

    expect(activeId()).toBe(firstAlert);
  });

  test("Escape in the list is left to the dialog", () => {
    renderPicker();

    expect(press(getListbox(), "Escape")).toBe(false);
  });

  test("a slash anywhere outside a text box goes back to the search", () => {
    renderPicker();

    const listbox: HTMLElement = getListbox();

    listbox.focus();

    expect(press(listbox, "/")).toBe(true);
    expect(getSearch()).toHaveFocus();
  });

  test("a slash with a modifier is not taken", () => {
    renderPicker();

    const listbox: HTMLElement = getListbox();

    listbox.focus();

    expect(!fireEvent.keyDown(listbox, { key: "/", ctrlKey: true })).toBe(
      false,
    );
    expect(listbox).toHaveFocus();
  });

  test("the slash listener goes away with the picker", () => {
    const harness: Harness = renderPicker();
    const outside: HTMLButtonElement = document.createElement("button");

    document.body.appendChild(outside);
    harness.view.unmount();

    outside.focus();

    expect(!fireEvent.keyDown(outside, { key: "/" })).toBe(false);
    outside.remove();
  });
});

describe("the mouse", () => {
  test("a click highlights a template and previews it, without using it", () => {
    const harness: Harness = renderPicker();
    const pick: string = RECOMMENDED_WORKFLOW_TEMPLATE_IDS[3]!;

    fireEvent.click(screen.getByTestId(workflowTemplateOptionDomId(pick)));

    expect(activeId()).toBe(pick);
    expect(previewTitle()).toBe(template(pick).name);
    expect(harness.onUseTemplate).not.toHaveBeenCalled();
  });

  test("a double-click uses the template", () => {
    const harness: Harness = renderPicker();
    const pick: string = RECOMMENDED_WORKFLOW_TEMPLATE_IDS[2]!;

    fireEvent.doubleClick(
      screen.getByTestId(workflowTemplateOptionDomId(pick)),
    );

    expect(harness.onUseTemplate).toHaveBeenCalledTimes(1);
    expect(harness.onUseTemplate.mock.calls[0]?.[0]).toEqual(template(pick));
  });

  test("the highlight is a tint on the row, not a filled button", () => {
    renderPicker();

    const active: HTMLElement = screen.getByTestId(
      workflowTemplateOptionDomId(RECOMMENDED_WORKFLOW_TEMPLATE_IDS[0]!),
    );
    const other: HTMLElement = screen.getByTestId(
      workflowTemplateOptionDomId(RECOMMENDED_WORKFLOW_TEMPLATE_IDS[1]!),
    );

    expect(active.className).toContain("bg-indigo-50");
    expect(other.className).toContain("hover:bg-gray-50");
    expect(other.className).not.toContain("bg-indigo-50");
  });
});

describe("the preview", () => {
  type ShowFunction = (templateId: string) => HTMLElement;

  const show: ShowFunction = (templateId: string): HTMLElement => {
    showView(WorkflowTemplateCollection.All);
    fireEvent.click(
      screen.getByTestId(workflowTemplateOptionDomId(templateId)),
    );

    return getPreview();
  };

  test("names the template, its category and its size, and says what it does", () => {
    renderPicker();

    const preview: HTMLElement = show("incident-created-slack");

    expect(
      within(preview).getByRole("heading", { level: 3 }),
    ).toHaveTextContent("Tell Slack when an incident opens");
    expect(preview).toHaveAccessibleName("Tell Slack when an incident opens");
    expect(
      within(preview).getByTestId("workflow-template-preview-meta"),
    ).toHaveTextContent("Incidents · 3 blocks");
    expect(preview).toHaveTextContent(
      template("incident-created-slack").description,
    );
  });

  test("a Jira template's size line says which part it is from", () => {
    renderPicker();

    expect(
      within(show("jira-create-issue-for-alert")).getByTestId(
        "workflow-template-preview-meta",
      ),
    ).toHaveTextContent("Jira · Alerts · 8 blocks");
  });

  test("how it works: the trigger, then the other blocks, as the canvas names them", () => {
    renderPicker();

    const preview: HTMLElement = show("scheduled-check-alert-slack");
    const blocks: HTMLElement = within(preview).getByTestId(
      "workflow-template-preview-blocks",
    );

    // Drawn in capitals; the text is the product's existing "How It Works".
    expect(within(preview).getByText("How It Works")).toBeInTheDocument();
    expect(within(blocks).getByText("Trigger")).toBeInTheDocument();
    expect(within(blocks).getByText("Steps")).toBeInTheDocument();
    expect(
      within(blocks).getByTestId("workflow-template-preview-trigger"),
    ).toHaveTextContent("Schedule");
    expect(
      within(blocks)
        .getAllByTestId("workflow-template-preview-step")
        .map((step: HTMLElement) => {
          return step.textContent;
        }),
    ).toEqual(["API Get (JSON)", "Send Message to Slack", "Log"]);
  });

  test("what you'll need: each setting, the secret ones and the optional ones said so", () => {
    renderPicker();

    const preview: HTMLElement = show("scheduled-email-digest");
    const settings: HTMLElement = within(preview).getByTestId(
      "workflow-template-preview-settings",
    );
    const variables: Array<{
      name: string;
      title: string;
      required: boolean;
      isSecret: boolean;
    }> = template("scheduled-email-digest").variables;

    expect(within(preview).getByText("What you'll need")).toBeInTheDocument();
    expect(within(settings).getAllByRole("listitem")).toHaveLength(
      variables.length,
    );

    for (const variable of variables) {
      const row: HTMLElement = within(settings).getByTestId(
        `workflow-template-preview-setting-${variable.name}`,
      );

      expect(row).toHaveTextContent(variable.title);
      expect({
        variable: variable.name,
        optional: (row.textContent || "").includes("(Optional)"),
        secret: (row.textContent || "").includes("Secret"),
      }).toEqual({
        variable: variable.name,
        optional: !variable.required,
        secret: variable.isSecret,
      });
    }
  });

  test("a template that asks for nothing says so", () => {
    renderPicker();

    const preview: HTMLElement = show("manual-log");

    expect(
      within(preview).getByTestId("workflow-template-preview-no-settings"),
    ).toHaveTextContent("Nothing to fill in.");
    expect(
      within(preview).queryByTestId("workflow-template-preview-settings"),
    ).not.toBeInTheDocument();
  });
});

describe("on a narrow screen", () => {
  test("opening a template shows its preview in the list's place, and Back to templates returns", () => {
    renderPicker();

    const listColumn: HTMLElement = screen.getByTestId(
      "workflow-template-list-column",
    );
    const previewColumn: HTMLElement = screen.getByTestId(
      "workflow-template-preview-column",
    );

    // Before: the list shows, the preview waits.
    expect(listColumn.className).not.toContain("max-md:hidden");
    expect(previewColumn.className).toContain("max-md:hidden");

    fireEvent.click(
      screen.getByTestId(
        workflowTemplateOptionDomId(RECOMMENDED_WORKFLOW_TEMPLATE_IDS[1]!),
      ),
    );

    expect(listColumn.className).toContain("max-md:hidden");
    expect(previewColumn.className).not.toContain("max-md:hidden");

    const back: HTMLElement = screen.getByTestId(
      "workflow-template-preview-back",
    );

    expect(back).toHaveTextContent("Back to templates");
    // Only drawn where the preview takes the list's place.
    expect(back.className).toContain("md:hidden");

    fireEvent.click(back);

    expect(listColumn.className).not.toContain("max-md:hidden");
    expect(previewColumn.className).toContain("max-md:hidden");
    // The template stays highlighted.
    expect(activeId()).toBe(RECOMMENDED_WORKFLOW_TEMPLATE_IDS[1]);
  });

  /*
   * jsdom draws nothing, so the list column is made to report what a phone's
   * browser would once the preview has taken its place.
   */
  test("the focus follows: to Back to templates, then to the list again", () => {
    renderPicker();

    const listColumn: HTMLElement = screen.getByTestId(
      "workflow-template-list-column",
    );
    const realGetComputedStyle: typeof window.getComputedStyle =
      window.getComputedStyle.bind(window);

    jest
      .spyOn(window, "getComputedStyle")
      .mockImplementation((element: Element): CSSStyleDeclaration => {
        const style: CSSStyleDeclaration = realGetComputedStyle(element);

        if (
          element === listColumn &&
          listColumn.className.includes("max-md:hidden")
        ) {
          return { ...style, display: "none" } as CSSStyleDeclaration;
        }

        return style;
      });

    fireEvent.click(
      screen.getByTestId(
        workflowTemplateOptionDomId(RECOMMENDED_WORKFLOW_TEMPLATE_IDS[2]!),
      ),
    );

    expect(screen.getByTestId("workflow-template-preview-back")).toHaveFocus();

    fireEvent.click(screen.getByTestId("workflow-template-preview-back"));

    expect(getListbox()).toHaveFocus();
  });

  test("where the list and the preview sit side by side, a click leaves the focus where it was", () => {
    renderPicker();

    const listbox: HTMLElement = getListbox();

    listbox.focus();
    fireEvent.click(
      screen.getByTestId(
        workflowTemplateOptionDomId(RECOMMENDED_WORKFLOW_TEMPLATE_IDS[2]!),
      ),
    );

    expect(listbox).toHaveFocus();
  });

  test("a new search or another category closes the preview again", () => {
    renderPicker();

    fireEvent.click(
      screen.getByTestId(
        workflowTemplateOptionDomId(RECOMMENDED_WORKFLOW_TEMPLATE_IDS[1]!),
      ),
    );
    typeSearch("slack");

    expect(
      screen.getByTestId("workflow-template-list-column").className,
    ).not.toContain("max-md:hidden");

    fireEvent.click(
      screen.getByTestId(workflowTemplateOptionDomId("incident-created-slack")),
    );
    showView(WorkflowTemplateCategory.Jira);

    expect(
      screen.getByTestId("workflow-template-list-column").className,
    ).not.toContain("max-md:hidden");
  });
});

describe("the state it reports", () => {
  test("is the whole state, as the wizard keeps it", () => {
    const harness: Harness = renderPicker();

    typeSearch("slack");

    expect(harness.onStateChange).toHaveBeenLastCalledWith({
      search: "slack",
      browseView: WorkflowTemplateCollection.Recommended,
      searchView: WorkflowTemplateCollection.All,
      activeTemplateId: null,
      isPreviewOpen: false,
    });

    showView(WorkflowTemplateCategory.Monitors);

    expect(harness.onStateChange).toHaveBeenLastCalledWith({
      search: "slack",
      browseView: WorkflowTemplateCollection.Recommended,
      searchView: WorkflowTemplateCategory.Monitors,
      activeTemplateId: null,
      isPreviewOpen: false,
    });

    fireEvent.click(
      screen.getByTestId(
        workflowTemplateOptionDomId("monitor-offline-only-slack"),
      ),
    );

    expect(harness.onStateChange).toHaveBeenLastCalledWith({
      search: "slack",
      browseView: WorkflowTemplateCollection.Recommended,
      searchView: WorkflowTemplateCategory.Monitors,
      activeTemplateId: "monitor-offline-only-slack",
      isPreviewOpen: true,
    });
  });

  test("a picker given a state shows it: the search, the category and the template", () => {
    renderPicker({
      initialState: {
        search: "slack",
        browseView: WorkflowTemplateCategory.Jira,
        searchView: WorkflowTemplateCategory.Monitors,
        activeTemplateId: "monitor-offline-only-slack",
        isPreviewOpen: false,
      },
    });

    expect(getSearch()).toHaveValue("slack");
    expect(categoryRadio(WorkflowTemplateCategory.Monitors)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(activeId()).toBe("monitor-offline-only-slack");
    expect(previewTitle()).toBe(template("monitor-offline-only-slack").name);
  });

  test("moving with the keyboard reports only the new highlight", () => {
    const harness: Harness = renderPicker();

    act(() => {
      press(getSearch(), "ArrowDown");
    });

    expect(harness.onStateChange).toHaveBeenLastCalledWith({
      ...INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE,
      activeTemplateId: RECOMMENDED_WORKFLOW_TEMPLATE_IDS[1],
    });
  });
});
