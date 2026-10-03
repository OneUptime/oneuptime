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
  WORKFLOW_START_FROM_SCRATCH_ID,
  WORKFLOW_TEMPLATE_LISTBOX_ID,
  WORKFLOW_TEMPLATE_SEARCH_INPUT_ID,
  WORKFLOW_TEMPLATE_VIEW_SELECT_ID,
  workflowTemplateOptionDomId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowTemplatePicker";
import {
  INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE,
  WorkflowTemplateCollection,
  WorkflowTemplatePickerState,
  WorkflowTemplatePickerView,
  WorkflowTemplatePickerViewInfo,
  getWorkflowTemplateCategoryLabel,
  getWorkflowTemplatePickerCounts,
  getWorkflowTemplatePickerViews,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Workflow/WorkflowTemplatePickerUtil";
import {
  RECOMMENDED_WORKFLOW_TEMPLATE_IDS,
  WorkflowTemplate,
  WorkflowTemplateCategories,
  WorkflowTemplateCategory,
  WorkflowTemplateVariable,
  getWorkflowTemplate,
  getWorkflowTemplates,
  getWorkflowTemplatesByCategory,
} from "../../../Types/Workflow/Templates";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

/*
 * The template picker on its own: the first step of Create a workflow.
 *
 * The maintainer, about the version before this one: "This select template
 * for workflow is extremely hard to use because it shows a lot of
 * information on the modal. Can you please make sure the modal is very
 * simple to use? ... 'Start from scratch' should be more visible as well
 * because that's the most commonly used option." That version had a column
 * of twelve categories with counts, the list, a preview column that was
 * always open, keyboard hints, and Start from scratch as a small button
 * beside the search.
 *
 * These tests hold the new shape to what it promises: Start from scratch
 * first, prominent and one click away; a few recommended templates as
 * one-line rows; a quiet search and a category select with no counts; a
 * template's details only once it is picked, inside its own row; and the
 * keyboard of the command palette, unchanged. The wizard around it is
 * covered in CreateWorkflowModal.test.tsx, and the dialog in a real
 * browser in packages/E2E/WorkflowBuilder/CreateWorkflowDialog.spec.ts.
 */

const ALL_TEMPLATES: Array<WorkflowTemplate> = getWorkflowTemplates();
const OPTION_PREFIX: string = "workflow-template-option-";
const RECOMMENDED: Array<string> = [...RECOMMENDED_WORKFLOW_TEMPLATE_IDS];

// Named: eslint's wrap-regex and prettier disagree on a bare /re/.test().
const DIGIT: RegExp = /\d/;

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

type StateFunction = (
  changes: Partial<WorkflowTemplatePickerState>,
) => WorkflowTemplatePickerState;

const stateWith: StateFunction = (
  changes: Partial<WorkflowTemplatePickerState>,
): WorkflowTemplatePickerState => {
  return { ...INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE, ...changes };
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

const getScratch: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("workflow-start-from-scratch");
};

const getSearch: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("workflow-template-search");
};

const getSelect: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("workflow-template-view-select");
};

const getListbox: ElementFunction = (): HTMLElement => {
  return screen.getByRole("listbox");
};

type RowFunction = (templateId: string) => HTMLElement;

const row: RowFunction = (templateId: string): HTMLElement => {
  return screen.getByTestId(workflowTemplateOptionDomId(templateId));
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

type PickedIdFunction = () => string | null;

/** The template picked: the one row marked selected. */
const pickedId: PickedIdFunction = (): string | null => {
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

type DetailsFunction = () => Array<HTMLElement>;

/** Every open details panel. There is never more than one. */
const openDetails: DetailsFunction = (): Array<HTMLElement> => {
  return screen.queryAllByTestId("workflow-template-details");
};

type ShowViewFunction = (view: WorkflowTemplatePickerView) => void;

const showView: ShowViewFunction = (view: WorkflowTemplatePickerView): void => {
  fireEvent.change(getSelect(), { target: { value: String(view) } });
};

type TypeFunction = (text: string) => void;

const typeSearch: TypeFunction = (text: string): void => {
  fireEvent.change(getSearch(), { target: { value: text } });
};

type PickFunction = (templateId: string) => HTMLElement;

/** Click a template's row, opening All templates first if it is not listed. */
const pick: PickFunction = (templateId: string): HTMLElement => {
  if (!screen.queryByTestId(workflowTemplateOptionDomId(templateId))) {
    showView(WorkflowTemplateCollection.All);
  }

  fireEvent.click(row(templateId));

  return row(templateId);
};

type KeyFunction = (element: HTMLElement, key: string) => boolean;

/** Press a key on an element; true when the picker handled it (default prevented). */
const press: KeyFunction = (element: HTMLElement, key: string): boolean => {
  return !fireEvent.keyDown(element, { key: key });
};

type OptionTextsFunction = () => Array<string>;

const selectOptionTexts: OptionTextsFunction = (): Array<string> => {
  return Array.from((getSelect() as HTMLSelectElement).options).map(
    (option: HTMLOptionElement): string => {
      return option.textContent || "";
    },
  );
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

describe("Start from scratch, the first and most visible choice", () => {
  test("it comes first: before the search, the categories and the templates", () => {
    renderPicker();

    const scratch: HTMLElement = getScratch();
    const follows: (later: HTMLElement) => boolean = (
      later: HTMLElement,
    ): boolean => {
      return Boolean(
        scratch.compareDocumentPosition(later) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    };

    expect(follows(getSearch())).toBe(true);
    expect(follows(getSelect())).toBe(true);
    expect(follows(getListbox())).toBe(true);

    // The first control in the step.
    const firstControl: Element | null = screen
      .getByTestId("workflow-template-picker")
      .querySelector("button, input, select, [tabindex]");

    expect(firstControl).toBe(scratch);
  });

  test("it is a button that says what it is and what it gives you", () => {
    renderPicker();

    const scratch: HTMLElement = getScratch();

    expect(scratch.tagName).toBe("BUTTON");
    expect(scratch).toHaveAttribute("type", "button");
    expect(scratch).toHaveAttribute("id", WORKFLOW_START_FROM_SCRATCH_ID);
    expect(scratch).toHaveTextContent("Start from scratch");
    expect(
      screen.getByRole("button", {
        name: "Start from scratch Begin with an empty canvas and add your own trigger and steps.",
      }),
    ).toBe(scratch);
    expect(scratch).toHaveAccessibleDescription(
      "Begin with an empty canvas and add your own trigger and steps.",
    );
  });

  test("one click starts from scratch, and uses no template", () => {
    const harness: Harness = renderPicker();

    fireEvent.click(getScratch());

    expect(harness.onStartFromScratch).toHaveBeenCalledTimes(1);
    expect(harness.onUseTemplate).not.toHaveBeenCalled();
  });

  test("it works with a template picked too: it is always one click away", () => {
    const harness: Harness = renderPicker();

    pick(RECOMMENDED[1]!);
    fireEvent.click(getScratch());

    expect(harness.onStartFromScratch).toHaveBeenCalledTimes(1);
    expect(harness.onUseTemplate).not.toHaveBeenCalled();
  });

  test("it has the focus when the step opens, so Enter takes the most common way in", () => {
    renderPicker();

    expect(getScratch()).toHaveFocus();
  });

  /*
   * The step's one card, with the brand colour on its icon; the template
   * rows below it are neutral until one is picked. Not a filled button: the
   * dialog's one primary button is Use this template, in its footer.
   */
  test("it stands out as a card with the brand's colour, without being a filled button", () => {
    renderPicker();

    const scratch: HTMLElement = getScratch();

    expect(scratch.className).toContain("rounded-xl");
    expect(scratch.className).toContain("border");
    expect(scratch.className).toContain("shadow-sm");
    expect(scratch.className).not.toMatch(/\bbg-indigo-(?:5|6|7)00\b/);
    expect(scratch.querySelector(".text-indigo-600")).not.toBeNull();

    for (const templateId of RECOMMENDED) {
      expect({
        templateId: templateId,
        tinted: row(templateId).querySelector(".text-indigo-600") !== null,
      }).toEqual({ templateId: templateId, tinted: false });
    }
  });

  test("it says when it is the start already chosen, as after Back from Name", () => {
    renderPicker({ isStartFromScratchChosen: true });

    const scratch: HTMLElement = getScratch();

    expect(scratch).toHaveAttribute("aria-current", "true");
    expect(scratch.className).toContain("border-indigo-500");
    expect(scratch.className).toContain("ring-indigo-500");
  });

  test("otherwise it is not marked", () => {
    renderPicker();

    expect(getScratch()).not.toHaveAttribute("aria-current");
    expect(getScratch().className).not.toContain("border-indigo-500");
  });
});

describe("what the step opens on", () => {
  test("the recommended handful, in their order, and nothing else", () => {
    renderPicker();

    expect(listedIds()).toEqual(RECOMMENDED);
    expect(listedIds().length).toBeLessThanOrEqual(8);
    expect(ALL_TEMPLATES.length).toBeGreaterThan(listedIds().length * 5);
  });

  test("under one heading, which names the list", () => {
    renderPicker();

    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Or start from a template",
      }),
    ).toBeInTheDocument();
    expect(getListbox()).toHaveAccessibleName("Or start from a template");
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  test("nothing picked, and no template's details open", () => {
    renderPicker();

    expect(pickedId()).toBeNull();
    expect(openDetails()).toEqual([]);
    expect(getSearch()).not.toHaveAttribute("aria-activedescendant");
    expect(getListbox()).not.toHaveAttribute("aria-activedescendant");
  });

  test("each row is its template's name and one line of description, and nothing else", () => {
    renderPicker();

    for (const templateId of RECOMMENDED) {
      const option: HTMLElement = row(templateId);

      expect(option.textContent).toBe(
        `${template(templateId).name}${template(templateId).description}`,
      );
      expect(option).toHaveAccessibleName(template(templateId).name);
      expect(option).toHaveAccessibleDescription(
        template(templateId).description,
      );

      const description: HTMLElement = document.getElementById(
        `${workflowTemplateOptionDomId(templateId)}-description`,
      ) as HTMLElement;

      // One line: cut short with an ellipsis rather than wrapped.
      expect(description.className).toContain("truncate");
    }
  });

  test("one list, with no headings inside it, though Recommended holds a Jira template", () => {
    renderPicker();

    expect(
      RECOMMENDED.some((templateId: string) => {
        return template(templateId).category === WorkflowTemplateCategory.Jira;
      }),
    ).toBe(true);
    expect(within(getListbox()).queryAllByRole("group")).toEqual([]);
  });

  /*
   * What the version before this one drew, and the maintainer found too much:
   * a column of categories with counts, a preview that was always open, a
   * keyboard hint under the list, and a category tag on search results.
   */
  test("none of what made the old step crowded", () => {
    renderPicker();

    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-template-categories"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-template-preview"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-template-preview-column"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("to move")).not.toBeInTheDocument();
    expect(screen.queryByText("to use")).not.toBeInTheDocument();
    expect(
      screen.queryByText("A few good places to start."),
    ).not.toBeInTheDocument();

    typeSearch("slack");

    expect(screen.queryAllByTestId("workflow-template-row-category")).toEqual(
      [],
    );
  });

  test("no counts anywhere: not beside the categories, not in the heading", () => {
    renderPicker();

    for (const text of selectOptionTexts()) {
      expect({ text: text, hasDigit: DIGIT.test(text) }).toEqual({
        text: text,
        hasDigit: false,
      });
    }

    expect(
      screen.getByRole("heading", { level: 3 }).textContent || "",
    ).not.toMatch(DIGIT);
  });

  test("the only controls are Start from scratch, the search, the category select and the list", () => {
    renderPicker();

    const picker: HTMLElement = screen.getByTestId("workflow-template-picker");

    expect(within(picker).getAllByRole("button")).toEqual([getScratch()]);
    expect(
      Array.from(
        picker.querySelectorAll("input, select, textarea, [tabindex]"),
      ),
    ).toEqual([getSearch(), getSelect(), getListbox()]);
  });
});

describe("the category select", () => {
  test("offers Recommended, every category, then All templates, by name alone", () => {
    renderPicker();

    expect(getSelect().tagName).toBe("SELECT");
    expect(getSelect()).toHaveAttribute("id", WORKFLOW_TEMPLATE_VIEW_SELECT_ID);
    expect(getSelect()).toHaveAccessibleName("Template categories");
    expect(selectOptionTexts()).toEqual(
      getWorkflowTemplatePickerViews().map(
        (info: WorkflowTemplatePickerViewInfo): string => {
          return info.label;
        },
      ),
    );
    expect(selectOptionTexts()[0]).toBe("Recommended");
    expect(selectOptionTexts()[selectOptionTexts().length - 1]).toBe(
      "All templates",
    );
    expect(getSelect()).toHaveValue(WorkflowTemplateCollection.Recommended);
  });

  test.each(
    WorkflowTemplateCategories.map((category: WorkflowTemplateCategory) => {
      return [category];
    }),
  )(
    "%s lists its own templates, in the catalog's order",
    (category: WorkflowTemplateCategory) => {
      renderPicker();
      showView(category);

      expect(getSelect()).toHaveValue(category);
      expect(listedIds()).toEqual(
        getWorkflowTemplatesByCategory(category).map(
          (candidate: WorkflowTemplate): string => {
            return candidate.id;
          },
        ),
      );
      expect(pickedId()).toBeNull();
      expect(openDetails()).toEqual([]);
    },
  );

  test("Jira's seventeen come in two parts, its incident and its alert templates", () => {
    renderPicker();
    showView(WorkflowTemplateCategory.Jira);

    const groups: Array<HTMLElement> =
      within(getListbox()).getAllByRole("group");

    expect(
      groups.map((group: HTMLElement): string => {
        return group.getAttribute("aria-label") || "";
      }),
    ).toEqual(["Incidents", "Alerts"]);
    expect(listedIds()).toHaveLength(17);

    for (const group of groups) {
      const part: string = group.getAttribute("aria-label") || "";

      // The part's heading is drawn over its rows.
      expect(group).toHaveTextContent(part);

      for (const templateId of listedIds(group)) {
        expect(template(templateId).subcategory).toBe(part);
      }
    }
  });

  test("All templates lists every template exactly once, under its category", () => {
    renderPicker();
    showView(WorkflowTemplateCollection.All);

    const groups: Array<HTMLElement> =
      within(getListbox()).getAllByRole("group");

    expect(listedIds()).toHaveLength(ALL_TEMPLATES.length);
    expect(new Set(listedIds()).size).toBe(ALL_TEMPLATES.length);

    for (const group of groups) {
      const label: string = group.getAttribute("aria-label") || "";

      for (const templateId of listedIds(group)) {
        expect(
          getWorkflowTemplateCategoryLabel(template(templateId).category),
        ).toBe(label);
      }
    }
  });

  test("a group's heading carries no count", () => {
    renderPicker();
    showView(WorkflowTemplateCollection.All);

    for (const group of within(getListbox()).getAllByRole("group")) {
      const heading: Element | null = group.querySelector(
        "[aria-hidden='true']",
      );

      expect(heading?.textContent).toBe(group.getAttribute("aria-label"));
    }
  });

  test("choosing another category closes the details of the template picked", () => {
    renderPicker();
    pick(RECOMMENDED[0]!);

    expect(openDetails()).toHaveLength(1);

    showView(WorkflowTemplateCategory.Incidents);

    expect(listedIds()).toContain(RECOMMENDED[0]);
    expect(pickedId()).toBeNull();
    expect(openDetails()).toEqual([]);
  });

  test("it follows a search: All templates while searching, back to what was browsed after", () => {
    renderPicker();
    showView(WorkflowTemplateCategory.OnCall);
    typeSearch("slack");

    expect(getSelect()).toHaveValue(WorkflowTemplateCollection.All);

    typeSearch("");

    expect(getSelect()).toHaveValue(WorkflowTemplateCategory.OnCall);
  });
});

describe("picking a template", () => {
  test("a click picks it and opens its details inside its own row", () => {
    const harness: Harness = renderPicker();
    const option: HTMLElement = pick(RECOMMENDED[3]!);

    expect(pickedId()).toBe(RECOMMENDED[3]);
    expect(openDetails()).toHaveLength(1);
    expect(within(option).getByTestId("workflow-template-details")).toBe(
      openDetails()[0],
    );
    // A click looks; it does not create anything.
    expect(harness.onUseTemplate).not.toHaveBeenCalled();
  });

  test("the picked row shows its whole description, the others one line", () => {
    renderPicker();
    pick(RECOMMENDED[2]!);

    const description: (templateId: string) => HTMLElement = (
      templateId: string,
    ): HTMLElement => {
      return document.getElementById(
        `${workflowTemplateOptionDomId(templateId)}-description`,
      ) as HTMLElement;
    };

    expect(description(RECOMMENDED[2]!).className).not.toContain("truncate");
    expect(description(RECOMMENDED[1]!).className).toContain("truncate");
  });

  test("picking another moves the details: one row is open at a time", () => {
    renderPicker();
    pick(RECOMMENDED[0]!);
    pick(RECOMMENDED[4]!);

    expect(pickedId()).toBe(RECOMMENDED[4]);
    expect(openDetails()).toHaveLength(1);
    expect(
      within(row(RECOMMENDED[4]!)).getByTestId("workflow-template-details"),
    ).toBeInTheDocument();
    expect(
      within(row(RECOMMENDED[0]!)).queryByTestId("workflow-template-details"),
    ).not.toBeInTheDocument();
  });

  test("a click on the template already picked keeps it picked", () => {
    renderPicker();
    pick(RECOMMENDED[1]!);
    fireEvent.click(row(RECOMMENDED[1]!));

    expect(pickedId()).toBe(RECOMMENDED[1]);
    expect(openDetails()).toHaveLength(1);
  });

  test("a double-click uses the template", () => {
    const harness: Harness = renderPicker();

    fireEvent.doubleClick(row(RECOMMENDED[2]!));

    expect(harness.onUseTemplate).toHaveBeenCalledTimes(1);
    expect(harness.onUseTemplate.mock.calls[0]?.[0]).toEqual(
      template(RECOMMENDED[2]!),
    );
    expect(harness.onStartFromScratch).not.toHaveBeenCalled();
  });

  test("the pick is a tint on the row, not a filled button", () => {
    renderPicker();
    pick(RECOMMENDED[0]!);

    const picked: HTMLElement = row(RECOMMENDED[0]!);
    const other: HTMLElement = row(RECOMMENDED[1]!);

    expect(picked.className).toContain("bg-indigo-50/60");
    expect(picked.className).not.toMatch(/\bbg-indigo-(?:5|6|7)00\b/);
    expect(other.className).toContain("hover:bg-gray-50");
    expect(other.className).not.toContain("bg-indigo-50");
    // The picked row's icon takes the brand colour; the others stay grey.
    expect(picked.querySelector(".text-indigo-600")).not.toBeNull();
    expect(other.querySelector(".text-indigo-600")).toBeNull();
  });

  test("the search box and the list name the picked row as the active one", () => {
    renderPicker();
    pick(RECOMMENDED[3]!);

    expect(getSearch()).toHaveAttribute(
      "aria-activedescendant",
      workflowTemplateOptionDomId(RECOMMENDED[3]!),
    );
    expect(getListbox()).toHaveAttribute(
      "aria-activedescendant",
      workflowTemplateOptionDomId(RECOMMENDED[3]!),
    );
  });
});

describe("a picked template's details", () => {
  type DetailsOfFunction = (templateId: string) => HTMLElement;

  const detailsOf: DetailsOfFunction = (templateId: string): HTMLElement => {
    return within(pick(templateId)).getByTestId("workflow-template-details");
  };

  test("how it works: the trigger, then the other blocks, as the canvas names them", () => {
    renderPicker();

    const details: HTMLElement = detailsOf("scheduled-check-alert-slack");
    const blocks: HTMLElement = within(details).getByTestId(
      "workflow-template-details-blocks",
    );

    // Drawn in capitals; the text is the product's existing "How It Works".
    expect(within(details).getByText("How It Works")).toBeInTheDocument();
    expect(
      within(blocks).getByTestId("workflow-template-details-trigger"),
    ).toHaveTextContent("Schedule");
    expect(
      within(blocks)
        .getAllByTestId("workflow-template-details-step")
        .map((step: HTMLElement) => {
          return step.textContent;
        }),
    ).toEqual(["API Get (JSON)", "Send Message to Slack", "Log"]);
  });

  test("the trigger comes first, and says it is the trigger to a screen reader", () => {
    renderPicker();

    const blocks: HTMLElement = within(
      detailsOf("incident-created-slack"),
    ).getByTestId("workflow-template-details-blocks");
    const items: Array<HTMLElement> = within(blocks).getAllByRole("listitem");
    const trigger: HTMLElement = within(blocks).getByTestId(
      "workflow-template-details-trigger",
    );

    expect(items[0]).toContainElement(trigger);
    expect(trigger).toHaveTextContent("Trigger: On Create Incident");
    expect(within(trigger).getByText("Trigger:").className).toContain(
      "sr-only",
    );
    expect(items).toHaveLength(3);
  });

  test("what you'll need: each setting in order, the secret and the optional ones said so", () => {
    renderPicker();

    const details: HTMLElement = detailsOf("scheduled-email-digest");
    const settings: HTMLElement = within(details).getByTestId(
      "workflow-template-details-settings",
    );
    const variables: Array<WorkflowTemplateVariable> = template(
      "scheduled-email-digest",
    ).variables;

    expect(within(details).getByText("What you'll need")).toBeInTheDocument();
    expect(
      within(settings)
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return (item.getAttribute("data-testid") || "").replace(
            "workflow-template-details-setting-",
            "",
          );
        }),
    ).toEqual(
      variables.map((variable: WorkflowTemplateVariable): string => {
        return variable.name;
      }),
    );

    for (const variable of variables) {
      const item: HTMLElement = within(settings).getByTestId(
        `workflow-template-details-setting-${variable.name}`,
      );

      expect(item).toHaveTextContent(variable.title);
      expect({
        variable: variable.name,
        optional: (item.textContent || "").includes("(Optional)"),
        secret: (item.textContent || "").includes(", Secret"),
      }).toEqual({
        variable: variable.name,
        optional: !variable.required,
        secret: variable.isSecret,
      });
    }
  });

  test("a Jira template that calls Jira asks for its site and its token, and only the token is secret", () => {
    renderPicker();

    const settings: HTMLElement = within(
      detailsOf("jira-create-issue-for-incident"),
    ).getByTestId("workflow-template-details-settings");

    expect(
      within(settings).getByTestId(
        "workflow-template-details-setting-jiraBasicAuthToken",
      ),
    ).toHaveTextContent("Secret");
    expect(
      within(settings).getByTestId(
        "workflow-template-details-setting-jiraBaseUrl",
      ),
    ).not.toHaveTextContent("Secret");
  });

  test("a template that asks for nothing says so", () => {
    renderPicker();

    const details: HTMLElement = detailsOf("manual-log");

    expect(
      within(details).getByTestId("workflow-template-details-no-settings"),
    ).toHaveTextContent("Nothing to fill in.");
    expect(
      within(details).queryByTestId("workflow-template-details-settings"),
    ).not.toBeInTheDocument();
  });

  test("every template's details open, with its trigger and every setting it asks for", () => {
    renderPicker();
    showView(WorkflowTemplateCollection.All);

    for (const candidate of ALL_TEMPLATES) {
      const details: HTMLElement = within(pick(candidate.id)).getByTestId(
        "workflow-template-details",
      );

      expect({
        template: candidate.id,
        trigger: within(details).queryAllByTestId(
          "workflow-template-details-trigger",
        ).length,
        settings: within(details)
          .queryAllByTestId(/^workflow-template-details-setting-/)
          .map((item: HTMLElement): string => {
            return (item.getAttribute("data-testid") || "").replace(
              "workflow-template-details-setting-",
              "",
            );
          }),
      }).toEqual({
        template: candidate.id,
        trigger: 1,
        settings: candidate.variables.map(
          (variable: WorkflowTemplateVariable): string => {
            return variable.name;
          },
        ),
      });
    }
  });
});

describe("the search", () => {
  test("is a quiet combobox over the list", () => {
    renderPicker();

    const search: HTMLElement = getSearch();

    expect(search).toHaveAttribute("id", WORKFLOW_TEMPLATE_SEARCH_INPUT_ID);
    expect(search).toHaveAttribute("role", "combobox");
    expect(search).toHaveAttribute(
      "aria-controls",
      WORKFLOW_TEMPLATE_LISTBOX_ID,
    );
    expect(search).toHaveAttribute("aria-expanded", "true");
    expect(search).toHaveAttribute("aria-autocomplete", "list");
    expect(search).toHaveAttribute("autocomplete", "off");
    expect(search).toHaveAttribute("placeholder", "Search templates…");
    expect(search).toHaveAccessibleName("Search templates…");
    expect(getListbox()).toHaveAttribute("id", WORKFLOW_TEMPLATE_LISTBOX_ID);
    // Not focused on its own: the step opens on Start from scratch.
    expect(search).not.toHaveFocus();
  });

  test("looks through every template, whichever category was open", () => {
    renderPicker();
    showView(WorkflowTemplateCategory.Alerts);
    typeSearch("discord");

    expect(listedIds()).toEqual(["incident-created-discord"]);
    expect(getSelect()).toHaveValue(WorkflowTemplateCollection.All);
  });

  test("picks its best match and opens its details, so Enter takes it", () => {
    renderPicker();
    typeSearch("heartbeat");

    expect(pickedId()).toBe("scheduled-heartbeat");
    expect(
      within(row("scheduled-heartbeat")).getByTestId(
        "workflow-template-details",
      ),
    ).toBeInTheDocument();
    expect(getSearch()).toHaveAttribute(
      "aria-activedescendant",
      workflowTemplateOptionDomId("scheduled-heartbeat"),
    );
  });

  test("narrowed to a category, it finds only that category's matches", () => {
    renderPicker();
    typeSearch("slack");
    showView(WorkflowTemplateCategory.Monitors);

    expect(listedIds().length).toBeGreaterThan(0);

    for (const templateId of listedIds()) {
      expect(template(templateId).category).toBe(
        WorkflowTemplateCategory.Monitors,
      );
    }
  });

  test("tells a screen reader how many it found, and says nothing while browsing", () => {
    renderPicker();

    const count: HTMLElement = screen.getByTestId(
      "workflow-template-result-count",
    );

    expect(count).toHaveAttribute("aria-live", "polite");
    expect(count.className).toContain("sr-only");
    expect(count.textContent).toBe("");

    typeSearch("slack");

    expect(count).toHaveTextContent(`${listedIds().length} results`);

    typeSearch("discord");

    expect(count).toHaveTextContent("1 result");
  });

  test("marks the words it matched", () => {
    renderPicker();
    typeSearch("teams incident");

    const marks: Array<string> = Array.from(
      row("incident-created-teams").querySelectorAll("mark"),
    ).map((mark: Element) => {
      return mark.textContent || "";
    });

    expect(marks).toContain("Teams");
    expect(marks).toContain("incident");
  });

  test("forgives a typo, and marks the word it was read as", () => {
    renderPicker();
    typeSearch("incidnet");

    expect(listedIds()).toContain("incident-created-slack");
    expect(
      Array.from(row("incident-created-slack").querySelectorAll("mark")).map(
        (mark: Element) => {
          return mark.textContent;
        },
      ),
    ).toContain("incident");
  });

  test("finds a plural written in the singular", () => {
    renderPicker();
    typeSearch("webhooks");

    expect(listedIds()).toContain("webhook-relay");
  });

  test("a clear button takes the search away and gives the focus back to the box", () => {
    renderPicker();

    expect(
      screen.queryByTestId("workflow-template-search-clear"),
    ).not.toBeInTheDocument();

    typeSearch("slack");

    const clear: HTMLElement = screen.getByTestId(
      "workflow-template-search-clear",
    );

    expect(clear).toHaveAccessibleName("Clear search");

    fireEvent.click(clear);

    expect(getSearch()).toHaveValue("");
    expect(getSearch()).toHaveFocus();
    expect(listedIds()).toEqual(RECOMMENDED);
    expect(pickedId()).toBeNull();
  });

  describe("when nothing matches", () => {
    test("it says so, offers to clear the search, and picks nothing", () => {
      renderPicker();
      typeSearch("pagerduty");

      const empty: HTMLElement = screen.getByTestId("workflow-template-empty");

      expect(empty).toHaveTextContent("No templates match your search.");
      expect(empty).toHaveTextContent(
        "Try other words, or start from scratch.",
      );
      expect(listedIds()).toEqual([]);
      expect(openDetails()).toEqual([]);
      expect(getSearch()).not.toHaveAttribute("aria-activedescendant");
      // There is nothing else to search.
      expect(
        screen.queryByTestId("workflow-template-search-everywhere"),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("workflow-template-empty-clear"));

      expect(getSearch()).toHaveValue("");
      expect(getSearch()).toHaveFocus();
      expect(listedIds()).toEqual(RECOMMENDED);
    });

    test("the empty list draws no frame of its own; the message does", () => {
      renderPicker();
      typeSearch("pagerduty");

      expect(getListbox().className).not.toContain("border-gray-200");
      expect(screen.getByTestId("workflow-template-empty").className).toContain(
        "border-dashed",
      );
    });

    test("narrowed to a category, it offers the matches elsewhere, with how many", () => {
      renderPicker();
      typeSearch("slack");
      showView(WorkflowTemplateCategory.Jira);

      expect(listedIds()).toEqual([]);

      const everywhere: HTMLElement = screen.getByTestId(
        "workflow-template-search-everywhere",
      );
      const matches: number =
        getWorkflowTemplatePickerCounts("slack").get(
          WorkflowTemplateCollection.All,
        ) || 0;

      expect(matches).toBeGreaterThan(1);

      expect(everywhere).toHaveTextContent(`Search all templates (${matches})`);

      fireEvent.click(everywhere);

      expect(getSelect()).toHaveValue(WorkflowTemplateCollection.All);
      expect(listedIds()).toHaveLength(matches);
      expect(getSearch()).toHaveValue("slack");
    });
  });
});

describe("the keyboard, from the search box", () => {
  test("with nothing picked, down picks the first template and opens its details", () => {
    renderPicker();
    getSearch().focus();

    expect(press(getSearch(), "ArrowDown")).toBe(true);
    expect(pickedId()).toBe(RECOMMENDED[0]);
    expect(openDetails()).toHaveLength(1);
    expect(getSearch()).toHaveAttribute(
      "aria-activedescendant",
      workflowTemplateOptionDomId(RECOMMENDED[0]!),
    );
    // The focus stays in the box, so typing goes on.
    expect(getSearch()).toHaveFocus();
  });

  test("with nothing picked, up picks the last template", () => {
    renderPicker();

    expect(press(getSearch(), "ArrowUp")).toBe(true);
    expect(pickedId()).toBe(RECOMMENDED[RECOMMENDED.length - 1]);
  });

  test("the arrow keys then move the pick, one row at a time", () => {
    renderPicker();

    press(getSearch(), "ArrowDown");
    press(getSearch(), "ArrowDown");
    press(getSearch(), "ArrowDown");
    press(getSearch(), "ArrowUp");

    expect(pickedId()).toBe(RECOMMENDED[1]);
  });

  test("the picked row is scrolled into view as the pick moves", () => {
    renderPicker();
    press(getSearch(), "ArrowDown");

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  test("a click does not scroll: the row is where the pointer is", () => {
    renderPicker();
    pick(RECOMMENDED[2]!);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  test("it stops at the bottom of the list", () => {
    renderPicker();

    for (let i: number = 0; i < RECOMMENDED.length + 3; i++) {
      press(getSearch(), "ArrowDown");
    }

    expect(pickedId()).toBe(RECOMMENDED[RECOMMENDED.length - 1]);
  });

  test("Home and End move the caret in the box, not the pick", () => {
    renderPicker();

    expect(press(getSearch(), "End")).toBe(false);
    expect(press(getSearch(), "Home")).toBe(false);
    expect(pickedId()).toBeNull();
  });

  test("Enter uses the template picked, which after typing is the best match", () => {
    const harness: Harness = renderPicker();

    typeSearch("telegram");
    expect(press(getSearch(), "Enter")).toBe(true);

    expect(harness.onUseTemplate).toHaveBeenCalledTimes(1);
    expect(harness.onUseTemplate.mock.calls[0]?.[0]).toEqual(
      template("alert-created-telegram"),
    );
  });

  test("Enter with nothing picked does nothing", () => {
    const harness: Harness = renderPicker();

    expect(press(getSearch(), "Enter")).toBe(true);

    expect(harness.onUseTemplate).not.toHaveBeenCalled();
    expect(harness.onStartFromScratch).not.toHaveBeenCalled();
  });

  test("Enter while an input method is still composing does nothing", () => {
    const harness: Harness = renderPicker();

    typeSearch("telegram");
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

    expect(listbox).toHaveAttribute("tabindex", "0");

    listbox.focus();

    press(listbox, "ArrowDown");
    expect(pickedId()).toBe(RECOMMENDED[0]);

    press(listbox, "ArrowDown");
    expect(pickedId()).toBe(RECOMMENDED[1]);
    expect(listbox).toHaveAttribute(
      "aria-activedescendant",
      workflowTemplateOptionDomId(RECOMMENDED[1]!),
    );

    expect(press(listbox, "End")).toBe(true);
    expect(pickedId()).toBe(RECOMMENDED[RECOMMENDED.length - 1]);

    expect(press(listbox, "Home")).toBe(true);
    expect(pickedId()).toBe(RECOMMENDED[0]);
  });

  test("Enter uses the template picked, and Space does not scroll the dialog", () => {
    const harness: Harness = renderPicker();
    const listbox: HTMLElement = getListbox();

    press(listbox, "ArrowDown");
    press(listbox, "ArrowDown");
    expect(press(listbox, " ")).toBe(true);
    expect(harness.onUseTemplate).not.toHaveBeenCalled();

    press(listbox, "Enter");

    expect(harness.onUseTemplate.mock.calls[0]?.[0]).toEqual(
      template(RECOMMENDED[1]!),
    );
  });

  test("the arrows walk across Jira's two parts as one list", () => {
    renderPicker();
    showView(WorkflowTemplateCategory.Jira);

    const listbox: HTMLElement = getListbox();
    const groups: Array<HTMLElement> = within(listbox).getAllByRole("group");
    const lastIncident: string = listedIds(groups[0]).pop() as string;
    const firstAlert: string = listedIds(groups[1])[0] as string;

    pick(lastIncident);
    press(listbox, "ArrowDown");

    expect(pickedId()).toBe(firstAlert);
  });

  test("Escape in the list is left to the dialog", () => {
    renderPicker();

    expect(press(getListbox(), "Escape")).toBe(false);
  });

  test("a slash anywhere outside a text box goes to the search", () => {
    renderPicker();

    expect(getScratch()).toHaveFocus();
    expect(press(getScratch(), "/")).toBe(true);
    expect(getSearch()).toHaveFocus();

    getListbox().focus();

    expect(press(getListbox(), "/")).toBe(true);
    expect(getSearch()).toHaveFocus();
  });

  test("a slash in the category select is the select's", () => {
    renderPicker();

    getSelect().focus();

    expect(press(getSelect(), "/")).toBe(false);
    expect(getSelect()).toHaveFocus();
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

describe("the state it reports", () => {
  test("is the whole state, as the wizard keeps it", () => {
    const harness: Harness = renderPicker();

    typeSearch("slack");

    expect(harness.onStateChange).toHaveBeenLastCalledWith({
      search: "slack",
      browseView: WorkflowTemplateCollection.Recommended,
      searchView: WorkflowTemplateCollection.All,
      selectedTemplateId: null,
    });

    showView(WorkflowTemplateCategory.Monitors);

    expect(harness.onStateChange).toHaveBeenLastCalledWith({
      search: "slack",
      browseView: WorkflowTemplateCollection.Recommended,
      searchView: WorkflowTemplateCategory.Monitors,
      selectedTemplateId: null,
    });

    fireEvent.click(row("monitor-offline-only-slack"));

    expect(harness.onStateChange).toHaveBeenLastCalledWith({
      search: "slack",
      browseView: WorkflowTemplateCollection.Recommended,
      searchView: WorkflowTemplateCategory.Monitors,
      selectedTemplateId: "monitor-offline-only-slack",
    });
  });

  test("moving with the keyboard reports only the new pick", () => {
    const harness: Harness = renderPicker();

    act(() => {
      press(getSearch(), "ArrowDown");
    });

    expect(harness.onStateChange).toHaveBeenLastCalledWith({
      ...INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE,
      selectedTemplateId: RECOMMENDED[0],
    });
  });

  test("Start from scratch changes nothing in the picker itself", () => {
    const harness: Harness = renderPicker();

    fireEvent.click(getScratch());

    expect(harness.onStateChange).not.toHaveBeenCalled();
  });

  test("a picker given a state shows it: the search, the category and the template", () => {
    renderPicker({
      initialState: stateWith({
        search: "slack",
        browseView: WorkflowTemplateCategory.Jira,
        searchView: WorkflowTemplateCategory.Monitors,
        selectedTemplateId: "monitor-offline-only-slack",
      }),
    });

    expect(getSearch()).toHaveValue("slack");
    expect(getSelect()).toHaveValue(WorkflowTemplateCategory.Monitors);
    expect(pickedId()).toBe("monitor-offline-only-slack");
    expect(
      within(row("monitor-offline-only-slack")).getByTestId(
        "workflow-template-details",
      ),
    ).toBeInTheDocument();
  });

  /*
   * Back from Name puts the focus on what was chosen: the list, with the
   * template open, or Start from scratch.
   */
  test("coming back to a picked template, the focus is on the list", () => {
    renderPicker({
      initialState: stateWith({ selectedTemplateId: RECOMMENDED[2]! }),
    });

    expect(getListbox()).toHaveFocus();
    expect(getListbox()).toHaveAttribute(
      "aria-activedescendant",
      workflowTemplateOptionDomId(RECOMMENDED[2]!),
    );
  });

  test("coming back to Start from scratch, the focus is on it", () => {
    renderPicker({
      initialState: stateWith({ selectedTemplateId: RECOMMENDED[2]! }),
      isStartFromScratchChosen: true,
    });

    expect(getScratch()).toHaveFocus();
  });
});
