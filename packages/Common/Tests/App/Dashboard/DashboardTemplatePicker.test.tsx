import "@testing-library/jest-dom";
import {
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
import DashboardTemplatePicker, {
  DASHBOARD_START_FROM_SCRATCH_ID,
  DASHBOARD_TEMPLATE_LISTBOX_ID,
  DASHBOARD_TEMPLATE_SEARCH_INPUT_ID,
  DASHBOARD_TEMPLATE_VIEW_SELECT_ID,
  dashboardTemplateOptionDomId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardTemplatePicker";
import { workflowTemplateOptionDomId } from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowTemplatePicker";
import {
  DASHBOARD_PICKER_CATEGORIES,
  DashboardPickerTemplate,
  DashboardTemplatePickerState,
  DashboardTemplatePreview,
  DashboardTemplatePreviewWidget,
  INITIAL_DASHBOARD_TEMPLATE_PICKER_STATE,
  getDashboardPickerTemplate,
  getDashboardPickerTemplates,
  getDashboardTemplatePreview,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Dashboard/DashboardTemplatePickerUtil";
import { TemplateCollection } from "../../../../App/FeatureSet/Dashboard/src/Utils/TemplatePicker/TemplatePickerUtil";
import {
  DashboardTemplateCategory,
  DashboardTemplateType,
  RECOMMENDED_DASHBOARD_TEMPLATE_TYPES,
} from "../../../Types/Dashboard/DashboardTemplates";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

/*
 * The first step of Create a dashboard, on its own.
 *
 * The maintainer: "The workflow templates model is a lot easier to
 * understand and use. Please make the dashboard templates model like
 * workflow templates." The dialog before it was Create from Template:
 * sixteen equally large cards, each with three or four lines of
 * description, in four labelled groups that ran past the bottom of the
 * dialog, Blank Dashboard one card among them, and a click on any card went
 * straight on.
 *
 * These tests hold the step to the workflow picker's shape - it is the same
 * shared step (Components/TemplatePicker/TemplatePicker), over the
 * dashboard catalog: Start from scratch first, prominent and one click
 * away; a few recommended templates as one-line rows; a quiet search and a
 * category select with no counts; a template's details - the widgets it
 * adds, the variables it brings - only once it is picked, inside its row;
 * and the command palette's keyboard. The wizard around it is covered in
 * CreateDashboardModal.test.tsx, and the dialog in a real browser in
 * packages/E2E/DashboardTemplates.
 */

const OPTION_PREFIX: string = "dashboard-template-option-";
const RECOMMENDED: Array<string> = [...RECOMMENDED_DASHBOARD_TEMPLATE_TYPES];
const ALL_TEMPLATES: Array<DashboardPickerTemplate> =
  getDashboardPickerTemplates();

// Named: eslint's wrap-regex and prettier disagree on a bare /re/.test().
const DIGIT: RegExp = /\d/;

interface Harness {
  view: RenderResult;
  onUseTemplate: MockFunction;
  onStartFromScratch: MockFunction;
  onStateChange: MockFunction;
}

interface HarnessProps {
  initialState: DashboardTemplatePickerState;
  isStartFromScratchChosen: boolean;
  busyTemplateId: string | null;
  onUseTemplate: (template: DashboardPickerTemplate) => void;
  onStartFromScratch: () => void;
  onStateChange: (state: DashboardTemplatePickerState) => void;
}

// Holds the picker's state the way the wizard does.
const PickerHost: (props: HarnessProps) => ReactElement = (
  props: HarnessProps,
): ReactElement => {
  const [state, setState] = useState<DashboardTemplatePickerState>(
    props.initialState,
  );

  return (
    <DashboardTemplatePicker
      state={state}
      onStateChange={(next: DashboardTemplatePickerState) => {
        props.onStateChange(next);
        setState(next);
      }}
      onUseTemplate={props.onUseTemplate}
      onStartFromScratch={props.onStartFromScratch}
      isStartFromScratchChosen={props.isStartFromScratchChosen}
      busyTemplateId={props.busyTemplateId}
    />
  );
};

interface RenderOptions {
  initialState?: DashboardTemplatePickerState | undefined;
  isStartFromScratchChosen?: boolean | undefined;
  busyTemplateId?: string | null | undefined;
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
        options?.initialState || INITIAL_DASHBOARD_TEMPLATE_PICKER_STATE
      }
      isStartFromScratchChosen={Boolean(options?.isStartFromScratchChosen)}
      busyTemplateId={options?.busyTemplateId || null}
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

type TemplateFunction = (type: string) => DashboardPickerTemplate;

const template: TemplateFunction = (type: string): DashboardPickerTemplate => {
  const found: DashboardPickerTemplate | null = getDashboardPickerTemplate(
    type as DashboardTemplateType,
  );

  if (!found) {
    throw new Error(`No template "${type}".`);
  }

  return found;
};

type ElementFunction = () => HTMLElement;

const getScratch: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("dashboard-start-from-scratch");
};

const getSearch: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("dashboard-template-search");
};

const getSelect: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("dashboard-template-view-select");
};

const getListbox: ElementFunction = (): HTMLElement => {
  return screen.getByRole("listbox");
};

type RowFunction = (type: string) => HTMLElement;

const row: RowFunction = (type: string): HTMLElement => {
  return screen.getByTestId(dashboardTemplateOptionDomId(type));
};

type ListedFunction = () => Array<string>;

/** The template types on the list, in the order shown. */
const listed: ListedFunction = (): Array<string> => {
  return within(getListbox())
    .queryAllByRole("option")
    .map((option: HTMLElement): string => {
      return (option.getAttribute("data-testid") || "").slice(
        OPTION_PREFIX.length,
      );
    });
};

type PickedFunction = () => string | null;

/** The template picked: the one row marked selected. */
const picked: PickedFunction = (): string | null => {
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

type ShowViewFunction = (view: string) => void;

const showView: ShowViewFunction = (view: string): void => {
  fireEvent.change(getSelect(), { target: { value: view } });
};

type TypeFunction = (text: string) => void;

const typeSearch: TypeFunction = (text: string): void => {
  fireEvent.change(getSearch(), { target: { value: text } });
};

type PickFunction = (type: string) => HTMLElement;

/** Click a template's row, opening All templates first if it is not listed. */
const pick: PickFunction = (type: string): HTMLElement => {
  if (!screen.queryByTestId(dashboardTemplateOptionDomId(type))) {
    showView(TemplateCollection.All);
  }

  fireEvent.click(row(type));

  return row(type);
};

type KeyFunction = (element: HTMLElement, key: string) => boolean;

/** Press a key on an element; true when the picker handled it (default prevented). */
const press: KeyFunction = (element: HTMLElement, key: string): boolean => {
  return !fireEvent.keyDown(element, { key: key });
};

type DetailsFunction = (type: string) => HTMLElement;

const detailsOf: DetailsFunction = (type: string): HTMLElement => {
  return within(pick(type)).getByTestId("dashboard-template-details");
};

type TextsFunction = (elements: Array<HTMLElement>) => Array<string>;

const texts: TextsFunction = (elements: Array<HTMLElement>): Array<string> => {
  return elements.map((element: HTMLElement): string => {
    return element.textContent || "";
  });
};

type PreviewFunction = (type: string) => DashboardTemplatePreview;

const previewOf: PreviewFunction = (type: string): DashboardTemplatePreview => {
  return getDashboardTemplatePreview(template(type))!;
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

describe("Start from scratch, first and most visible, where Blank Dashboard was one card among sixteen", () => {
  test("it comes first: before the search, the categories and the templates", () => {
    renderPicker();

    const firstControl: Element | null = screen
      .getByTestId("dashboard-template-picker")
      .querySelector("button, input, select, [tabindex]");

    expect(firstControl).toBe(getScratch());
    expect(
      getScratch().compareDocumentPosition(getListbox()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("it is a button that says what it gives you: an empty dashboard", () => {
    renderPicker();

    const scratch: HTMLElement = getScratch();

    expect(scratch.tagName).toBe("BUTTON");
    expect(scratch).toHaveAttribute("type", "button");
    expect(scratch).toHaveAttribute("id", DASHBOARD_START_FROM_SCRATCH_ID);
    expect(
      screen.getByRole("button", {
        name: "Start from scratch Begin with an empty dashboard and add your own widgets.",
      }),
    ).toBe(scratch);
    expect(scratch).toHaveAccessibleDescription(
      "Begin with an empty dashboard and add your own widgets.",
    );
  });

  test("one click starts from scratch, and uses no template, even with one picked", () => {
    const harness: Harness = renderPicker();

    fireEvent.click(getScratch());
    pick(DashboardTemplateType.Kubernetes);
    fireEvent.click(getScratch());

    expect(harness.onStartFromScratch).toHaveBeenCalledTimes(2);
    expect(harness.onUseTemplate).not.toHaveBeenCalled();
  });

  test("it has the focus when the step opens", () => {
    renderPicker();

    expect(getScratch()).toHaveFocus();
  });

  test("it says when it is the start already chosen, as after Back from Name", () => {
    renderPicker({ isStartFromScratchChosen: true });

    expect(getScratch()).toHaveAttribute("aria-current", "true");
    expect(getScratch().className).toContain("border-indigo-500");
  });

  test("Blank Dashboard is not a row: not in the recommended handful, not in All templates, not found by a search", () => {
    renderPicker();

    expect(listed()).not.toContain(DashboardTemplateType.Blank);
    showView(TemplateCollection.All);
    expect(listed()).not.toContain(DashboardTemplateType.Blank);
    typeSearch("blank");
    expect(listed()).not.toContain(DashboardTemplateType.Blank);
  });
});

describe("what the step opens on", () => {
  test("the six recommended, in their order, and nothing else", () => {
    renderPicker();

    expect(listed()).toEqual(RECOMMENDED);
    expect(RECOMMENDED).toHaveLength(6);
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

    expect(picked()).toBeNull();
    expect(screen.queryAllByTestId("dashboard-template-details")).toEqual([]);
    expect(getSearch()).not.toHaveAttribute("aria-activedescendant");
  });

  test("each row is its template's name and one line of description, and nothing else", () => {
    renderPicker();

    for (const type of RECOMMENDED) {
      const option: HTMLElement = row(type);

      expect(option.textContent).toBe(
        `${template(type).name}${template(type).description}`,
      );
      expect(option).toHaveAccessibleName(template(type).name);
      expect(option).toHaveAccessibleDescription(template(type).description);
      expect(
        document.getElementById(
          `${dashboardTemplateOptionDomId(type)}-description`,
        )!.className,
      ).toContain("truncate");
    }
  });

  test("none of what made the old dialog a wall: no cards, no group headings, no counts", () => {
    renderPicker();

    expect(screen.queryAllByTestId("dashboard-template-card")).toEqual([]);
    expect(within(getListbox()).queryAllByRole("group")).toEqual([]);
    expect(screen.queryByText("Get Started")).not.toBeInTheDocument();

    for (const option of Array.from(
      (getSelect() as HTMLSelectElement).options,
    )) {
      expect(option.textContent || "").not.toMatch(DIGIT);
    }
  });

  test("the only controls are Start from scratch, the search, the category select and the list", () => {
    renderPicker();

    const step: HTMLElement = screen.getByTestId("dashboard-template-picker");

    expect(within(step).getAllByRole("button")).toEqual([getScratch()]);
    expect(
      Array.from(step.querySelectorAll("input, select, textarea, [tabindex]")),
    ).toEqual([getSearch(), getSelect(), getListbox()]);
    expect(getSearch()).toHaveAttribute(
      "id",
      DASHBOARD_TEMPLATE_SEARCH_INPUT_ID,
    );
    expect(getSelect()).toHaveAttribute(
      "id",
      DASHBOARD_TEMPLATE_VIEW_SELECT_ID,
    );
    expect(getListbox()).toHaveAttribute("id", DASHBOARD_TEMPLATE_LISTBOX_ID);
  });

  test("its ids are its own: no workflow picker id is drawn", () => {
    renderPicker();

    expect(
      document.querySelector("[data-testid^='workflow-'], [id^='workflow-']"),
    ).toBeNull();
    expect(dashboardTemplateOptionDomId("Monitor")).not.toBe(
      workflowTemplateOptionDomId("Monitor"),
    );
  });
});

describe("the category select", () => {
  test("offers Recommended, the three categories by name, then All templates", () => {
    renderPicker();

    expect(
      Array.from((getSelect() as HTMLSelectElement).options).map(
        (option: HTMLOptionElement): Array<string> => {
          return [option.value, option.textContent || ""];
        },
      ),
    ).toEqual([
      [TemplateCollection.Recommended, "Recommended"],
      [DashboardTemplateCategory.Monitoring, "Monitoring & APM"],
      [DashboardTemplateCategory.IncidentResponse, "Incident Response"],
      [DashboardTemplateCategory.Infrastructure, "Infrastructure"],
      [TemplateCollection.All, "All templates"],
    ]);
    expect(getSelect()).toHaveAccessibleName("Template categories");
  });

  test.each(
    DASHBOARD_PICKER_CATEGORIES.map((category: string) => {
      return [category];
    }),
  )(
    "%s lists its own templates, in the catalog's order",
    (category: string) => {
      renderPicker();
      showView(category);

      expect(listed()).toEqual(
        ALL_TEMPLATES.filter((candidate: DashboardPickerTemplate) => {
          return candidate.category === category;
        }).map((candidate: DashboardPickerTemplate) => {
          return candidate.type;
        }),
      );
    },
  );

  test("All templates lists every template exactly once, under its category, a heading per category", () => {
    renderPicker();
    showView(TemplateCollection.All);

    expect(listed()).toEqual(
      DASHBOARD_PICKER_CATEGORIES.flatMap((category: string) => {
        return ALL_TEMPLATES.filter((candidate: DashboardPickerTemplate) => {
          return candidate.category === category;
        }).map((candidate: DashboardPickerTemplate) => {
          return candidate.type;
        });
      }),
    );
    expect(new Set(listed()).size).toBe(15);
    expect(
      within(getListbox())
        .getAllByRole("group")
        .map((group: HTMLElement): string => {
          return group.getAttribute("aria-label") || "";
        }),
    ).toEqual(["Monitoring & APM", "Incident Response", "Infrastructure"]);
  });

  test("choosing another category closes the details of the template picked", () => {
    renderPicker();
    pick(DashboardTemplateType.Monitor);

    showView(DashboardTemplateCategory.Infrastructure);

    expect(picked()).toBeNull();
    expect(screen.queryAllByTestId("dashboard-template-details")).toEqual([]);
  });
});

describe("picking a template", () => {
  test("a click picks it and opens its details inside its own row, its whole description too", () => {
    renderPicker();

    const option: HTMLElement = pick(DashboardTemplateType.Kubernetes);

    expect(picked()).toBe(DashboardTemplateType.Kubernetes);
    expect(option).toHaveAttribute("aria-selected", "true");
    expect(
      within(option).getByTestId("dashboard-template-details"),
    ).toBeVisible();
    expect(
      document.getElementById(
        `${dashboardTemplateOptionDomId("Kubernetes")}-description`,
      )!.className,
    ).not.toContain("truncate");
  });

  test("one row is open at a time", () => {
    renderPicker();
    pick(DashboardTemplateType.Monitor);
    pick(DashboardTemplateType.Host);

    expect(screen.getAllByTestId("dashboard-template-details")).toHaveLength(1);
    expect(picked()).toBe(DashboardTemplateType.Host);
  });

  test("a double-click uses the template", () => {
    const harness: Harness = renderPicker();

    fireEvent.doubleClick(row(DashboardTemplateType.Incident));

    expect(harness.onUseTemplate).toHaveBeenCalledTimes(1);
    expect(
      (harness.onUseTemplate.mock.calls[0]![0] as DashboardPickerTemplate).type,
    ).toBe(DashboardTemplateType.Incident);
  });

  test("the pick is a tint on the row, never a filled button", () => {
    renderPicker();

    const option: HTMLElement = pick(DashboardTemplateType.Alert);

    expect(option.className).toContain("bg-indigo-50/60");
    expect(option.className).not.toMatch(/\bbg-indigo-(?:5|6|7)00\b/);
  });

  test("the search box and the list name the picked row as the active one", () => {
    renderPicker();
    pick(DashboardTemplateType.Metrics);

    expect(getSearch()).toHaveAttribute(
      "aria-activedescendant",
      dashboardTemplateOptionDomId("Metrics"),
    );
    expect(getListbox()).toHaveAttribute(
      "aria-activedescendant",
      dashboardTemplateOptionDomId("Metrics"),
    );
  });
});

describe("a picked template's details", () => {
  test("Widgets: each kind it adds, as Add Widget names it, in the order the dashboard shows them", () => {
    renderPicker();

    const details: HTMLElement = detailsOf(DashboardTemplateType.Kubernetes);

    expect(within(details).getByText("Widgets")).toBeInTheDocument();
    expect(
      texts(
        within(details).getAllByTestId("dashboard-template-details-widget"),
      ),
    ).toEqual(["Value", "Chart", "Pods", "Nodes", "Table", "Log Stream"]);
  });

  test("Variables: the pickers its toolbar narrows it with", () => {
    renderPicker();

    const details: HTMLElement = detailsOf(DashboardTemplateType.Kubernetes);

    expect(within(details).getByText("Variables")).toBeInTheDocument();
    expect(
      texts(
        within(details).getAllByTestId("dashboard-template-details-variable"),
      ),
    ).toEqual(["Cluster", "Namespace"]);
  });

  test("a template without variables leaves that row out, rather than saying so", () => {
    renderPicker();

    const details: HTMLElement = detailsOf(DashboardTemplateType.Incident);

    expect(
      within(details).queryByTestId("dashboard-template-details-variables"),
    ).toBeNull();
    expect(within(details).queryByText("Variables")).toBeNull();
    expect(
      within(details).getAllByTestId("dashboard-template-details-widget"),
    ).toHaveLength(4);
  });

  test.each(
    getDashboardPickerTemplates().map((candidate: DashboardPickerTemplate) => {
      return [candidate.type];
    }),
  )("%s: its details say what its preview says", (type: string) => {
    renderPicker();

    const details: HTMLElement = detailsOf(type);
    const preview: DashboardTemplatePreview = previewOf(type);

    expect(
      texts(
        within(details).getAllByTestId("dashboard-template-details-widget"),
      ),
    ).toEqual(
      preview.widgets.map((widget: DashboardTemplatePreviewWidget) => {
        return widget.label;
      }),
    );
    expect(
      texts(
        within(details).queryAllByTestId("dashboard-template-details-variable"),
      ),
    ).toEqual(preview.variables);
  });

  test("the details are labelled rows, the widgets as chips", () => {
    renderPicker();

    const details: HTMLElement = detailsOf(DashboardTemplateType.Host);

    expect(details.tagName).toBe("DL");
    expect(
      Array.from(details.querySelectorAll("dt")).map((term: Element) => {
        return term.textContent;
      }),
    ).toEqual(["Widgets", "Variables"]);
    expect(
      within(details).getByTestId("dashboard-template-details-widgets").tagName,
    ).toBe("UL");
  });
});

describe("the search", () => {
  test("is a quiet combobox over the list", () => {
    renderPicker();

    expect(getSearch()).toHaveAttribute("role", "combobox");
    expect(getSearch()).toHaveAttribute(
      "aria-controls",
      DASHBOARD_TEMPLATE_LISTBOX_ID,
    );
    expect(getSearch()).toHaveAttribute("placeholder", "Search templates…");
  });

  test("looks through every template, whichever category was open", () => {
    renderPicker();
    showView(DashboardTemplateCategory.IncidentResponse);
    typeSearch("ceph");

    expect(listed()).toEqual([DashboardTemplateType.Ceph]);
    expect(getSelect()).toHaveValue(TemplateCollection.All);
  });

  test("picks its best match and opens its details, so Enter takes it", () => {
    const harness: Harness = renderPicker();

    typeSearch("k8s");

    expect(listed()).toEqual([
      DashboardTemplateType.Kubernetes,
      DashboardTemplateType.KubernetesCost,
    ]);
    expect(picked()).toBe(DashboardTemplateType.Kubernetes);
    expect(screen.getByTestId("dashboard-template-details")).toBeVisible();

    expect(press(getSearch(), "Enter")).toBe(true);
    expect(
      (harness.onUseTemplate.mock.calls[0]![0] as DashboardPickerTemplate).type,
    ).toBe(DashboardTemplateType.Kubernetes);
  });

  test("tells a screen reader how many it found, and says nothing while browsing", () => {
    renderPicker();

    const count: HTMLElement = screen.getByTestId(
      "dashboard-template-result-count",
    );

    expect(count).toHaveTextContent("");
    typeSearch("k8s");
    expect(count).toHaveTextContent("2 results");
    typeSearch("ceph");
    expect(count).toHaveTextContent("1 result");
  });

  test("marks the words it matched", () => {
    renderPicker();
    typeSearch("proxmox");

    expect(
      Array.from(
        row(DashboardTemplateType.Proxmox).querySelectorAll("mark"),
      ).map((mark: Element) => {
        return mark.textContent;
      }),
    ).toContain("Proxmox");
  });

  test("forgives a typo", () => {
    renderPicker();
    typeSearch("kubernets");

    expect(listed()[0]).toBe(DashboardTemplateType.Kubernetes);
  });

  test("a clear button takes the search away and gives the focus back to the box", () => {
    renderPicker();
    typeSearch("hosts");

    fireEvent.click(screen.getByTestId("dashboard-template-search-clear"));

    expect(getSearch()).toHaveValue("");
    expect(getSearch()).toHaveFocus();
    expect(listed()).toEqual(RECOMMENDED);
  });

  /*
   * Found in the UI review: the box kept the clear button's room on its
   * right while empty too, and cut the longest prompts short - German
   * "Vorlagen durchsuchen.." and French "Rechercher des modèl..". The
   * browser suite measures every language's prompt against the box
   * (packages/E2E/DashboardTemplates).
   */
  test("keeps room on its right for the clear button only while the button is there", () => {
    renderPicker();

    expect(getSearch()).toHaveClass("pl-8", "pr-3");
    expect(getSearch()).not.toHaveClass("pr-8");
    expect(screen.queryByTestId("dashboard-template-search-clear")).toBeNull();

    typeSearch("hosts");

    expect(getSearch()).toHaveClass("pl-8", "pr-8");
    expect(getSearch()).not.toHaveClass("pr-3");
    expect(
      screen.getByTestId("dashboard-template-search-clear"),
    ).toBeInTheDocument();
  });

  test("the Enter an input method commits a search's characters with uses no template", () => {
    const harness: Harness = renderPicker();
    typeSearch("k8s");

    // Chrome marks it composing; Safari sends keyCode 229 once it has ended.
    fireEvent.keyDown(getSearch(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(getSearch(), { key: "Enter", keyCode: 229 });

    expect(harness.onUseTemplate).not.toHaveBeenCalled();
    expect(picked()).toBe(DashboardTemplateType.Kubernetes);

    expect(press(getSearch(), "Enter")).toBe(true);
    expect(harness.onUseTemplate).toHaveBeenCalledTimes(1);
  });

  describe("when nothing matches", () => {
    test("it says so, offers to clear the search, and picks nothing", () => {
      renderPicker();
      typeSearch("zzzzzz");

      const empty: HTMLElement = screen.getByTestId("dashboard-template-empty");

      expect(empty).toHaveTextContent("No templates match your search.");
      expect(empty).toHaveTextContent(
        "Try other words, or start from scratch.",
      );
      expect(picked()).toBeNull();

      fireEvent.click(screen.getByTestId("dashboard-template-empty-clear"));
      expect(getSearch()).toHaveValue("");
    });

    test("narrowed to a category, it offers the matches elsewhere, with how many", () => {
      renderPicker();
      typeSearch("k8s");
      showView(DashboardTemplateCategory.IncidentResponse);

      const everywhere: HTMLElement = screen.getByTestId(
        "dashboard-template-search-everywhere",
      );

      expect(everywhere).toHaveTextContent("Search all templates (2)");
      fireEvent.click(everywhere);
      expect(listed()).toEqual([
        DashboardTemplateType.Kubernetes,
        DashboardTemplateType.KubernetesCost,
      ]);
    });
  });
});

describe("the keyboard", () => {
  test("from the search box, down picks the first and up the last", () => {
    renderPicker();

    expect(press(getSearch(), "ArrowDown")).toBe(true);
    expect(picked()).toBe(RECOMMENDED[0]);
    expect(press(getSearch(), "ArrowUp")).toBe(true);
    expect(picked()).toBe(RECOMMENDED[0]);
    expect(press(getSearch(), "End")).toBe(false);
  });

  test("the list takes the arrows, Home and End, and Enter uses the pick", () => {
    const harness: Harness = renderPicker();
    const list: HTMLElement = getListbox();

    press(list, "End");
    expect(picked()).toBe(RECOMMENDED[RECOMMENDED.length - 1]);
    press(list, "Home");
    expect(picked()).toBe(RECOMMENDED[0]);
    press(list, "ArrowDown");
    expect(picked()).toBe(RECOMMENDED[1]);
    expect(scrollIntoView).toHaveBeenCalled();

    expect(press(list, " ")).toBe(true);
    expect(press(list, "Enter")).toBe(true);
    expect(
      (harness.onUseTemplate.mock.calls[0]![0] as DashboardPickerTemplate).type,
    ).toBe(RECOMMENDED[1]);
  });

  test("Escape clears a search first, and is left to the dialog on an empty box", () => {
    renderPicker();
    typeSearch("hosts");

    expect(press(getSearch(), "Escape")).toBe(true);
    expect(getSearch()).toHaveValue("");
    expect(press(getSearch(), "Escape")).toBe(false);
  });

  test("a slash anywhere outside a text box goes to the search", () => {
    renderPicker();
    getListbox().focus();

    fireEvent.keyDown(getListbox(), { key: "/" });

    expect(getSearch()).toHaveFocus();
  });

  test("coming back to a picked template, the focus is on the list", () => {
    renderPicker({
      initialState: {
        ...INITIAL_DASHBOARD_TEMPLATE_PICKER_STATE,
        selectedTemplateId: DashboardTemplateType.Host,
      },
    });

    expect(getListbox()).toHaveFocus();
    expect(picked()).toBe(DashboardTemplateType.Host);
  });
});

describe("a template waiting to be used", () => {
  test("its row says it is busy, with a bar, and the others do not", () => {
    renderPicker({ busyTemplateId: DashboardTemplateType.Monitor });

    expect(row(DashboardTemplateType.Monitor)).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(
      within(row(DashboardTemplateType.Monitor)).getByTestId(
        `${dashboardTemplateOptionDomId("Monitor")}-busy`,
      ),
    ).toBeInTheDocument();
    expect(row(DashboardTemplateType.Incident)).not.toHaveAttribute(
      "aria-busy",
    );
  });

  test("nothing is busy otherwise", () => {
    renderPicker();

    expect(document.querySelector("[aria-busy]")).toBeNull();
  });
});

describe("the state it reports", () => {
  test("is the whole state, as the wizard keeps it", () => {
    const harness: Harness = renderPicker();

    typeSearch("hosts");

    expect(harness.onStateChange).toHaveBeenLastCalledWith({
      search: "hosts",
      browseView: TemplateCollection.Recommended,
      searchView: TemplateCollection.All,
      selectedTemplateId: null,
    });
  });

  test("a picker given a state shows it: the search, the category and the template", () => {
    renderPicker({
      initialState: {
        search: "",
        browseView: DashboardTemplateCategory.Infrastructure,
        searchView: TemplateCollection.All,
        selectedTemplateId: DashboardTemplateType.Ceph,
      },
    });

    expect(getSelect()).toHaveValue(DashboardTemplateCategory.Infrastructure);
    expect(picked()).toBe(DashboardTemplateType.Ceph);
  });
});
