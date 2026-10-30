import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

import TelemetryFacetSidebar from "../../../../UI/Components/TelemetryViewer/components/TelemetryFacetSidebar";
import {
  FACET_HELP_BUTTON_TEST_ID,
  FACET_HELP_TOOLTIP_TEST_ID,
} from "../../../../UI/Components/TelemetryViewer/components/FacetHelpButton";
import {
  ActiveFilter,
  FacetConfig,
  FacetData,
} from "../../../../UI/Components/TelemetryViewer/types";
import {
  TRACE_SPAN_TYPE_OPTIONS,
  TraceSpanTypeOption,
  getTraceSpanTypeDescriptions,
} from "../../../../Types/Telemetry/TraceSpanType";

/*
 * A facet that is a choice of exactly one value (FacetConfig.chosenValue) -
 * the traces explorer's Span Type: Entry spans, Root spans or All spans,
 * each with the sentence Types/Telemetry/TraceSpanType gives it. Rendered in
 * the real shared sidebar. What is pinned:
 *
 *   - its rows are radio buttons in a radio group named for the facet, the
 *     chosen value checked whether or not a chip names it;
 *   - a click on another value chooses it (through onIncludeFilter, the
 *     explorer's one path in), a click on the chosen one changes nothing,
 *     and no value can be excluded;
 *   - every value is listed, a page's locked scope or not;
 *   - what the choices mean is never a paragraph between the title and the
 *     options ("Too long description, have this in a tooltip"): an (i)
 *     beside the title says it - on hover, keyboard focus or a tap, and to
 *     a screen reader as its description - and each option says its own on
 *     hover and keyboard focus, and as its description;
 *   - a facet with nothing to explain has no (i);
 *   - the header counts a choice only when a chip says it is not the
 *     default; every other facet keeps its checkboxes.
 */

jest.setTimeout(30000);

// The paragraph the Span Type used to show under its title.
const OLD_HELP: string =
  "Entry spans: where a request or message enters a service. Root spans: where a trace starts. All spans: every operation, including database calls and internal steps.";

const SENTENCES: Record<string, string> = {
  "Entry spans": "Where a request or message enters a service.",
  "Root spans": "Where a trace starts.",
  "All spans": "Every operation, including database calls and internal steps.",
};

const SPAN_TYPE: (chosenValue: string) => FacetConfig = (
  chosenValue: string,
): FacetConfig => {
  // As the traces explorer builds it (TracesViewer).
  return {
    key: "spanType",
    title: "Span Type",
    valueDisplayMap: Object.fromEntries(
      TRACE_SPAN_TYPE_OPTIONS.map(
        (option: TraceSpanTypeOption): [string, string] => {
          return [option.value, option.label];
        },
      ),
    ),
    valueDescriptionMap: getTraceSpanTypeDescriptions(),
    chosenValue: chosenValue,
    priority: 0.5,
  };
};

const STATUS: FacetConfig = {
  key: "statusCode",
  title: "Status",
  valueDisplayMap: { "0": "Unset", "2": "Error" },
  priority: 6,
};

const FACETS: FacetData = {
  spanType: [
    { value: "entry", count: 40 },
    { value: "root", count: 0 },
    { value: "all", count: 1000 },
  ],
  statusCode: [
    { value: "0", count: 900 },
    { value: "2", count: 100 },
  ],
};

interface Rendered {
  include: MockFunction;
  exclude: MockFunction;
  remove: MockFunction;
}

const renderSidebar: (options: {
  chosenValue: string;
  activeFilters?: Array<ActiveFilter>;
  onlyShowValuesInScope?: boolean;
  spanType?: FacetConfig;
}) => Rendered = (options: {
  chosenValue: string;
  activeFilters?: Array<ActiveFilter>;
  onlyShowValuesInScope?: boolean;
  spanType?: FacetConfig;
}): Rendered => {
  const include: MockFunction = getJestMockFunction();
  const exclude: MockFunction = getJestMockFunction();
  const remove: MockFunction = getJestMockFunction();

  render(
    <TelemetryFacetSidebar
      facetData={FACETS}
      facetConfigs={[
        options.spanType || SPAN_TYPE(options.chosenValue),
        STATUS,
      ]}
      isLoading={false}
      activeFilters={options.activeFilters || []}
      onIncludeFilter={include}
      onExcludeFilter={exclude}
      onRemoveFilter={remove}
      onlyShowValuesInScope={options.onlyShowValuesInScope}
    />,
  );

  return { include, exclude, remove };
};

const choiceGroup: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("radiogroup", { name: "Span Type" });
};

const choice: (name: string) => HTMLElement = (name: string): HTMLElement => {
  return within(choiceGroup()).getByRole("radio", { name: name });
};

// The button that folds the Span Type section: named by its title alone.
const spanTypeHeader: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("button", { name: /^Span Type/ });
};

const helpButton: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("button", { name: "About Span Type" });
};

// Text drawn on the page: not a node only a screen reader reads.
const drawnText: (text: string) => Array<HTMLElement> = (
  text: string,
): Array<HTMLElement> => {
  return screen.queryAllByText(text).filter((element: HTMLElement) => {
    return !element.closest("[hidden]");
  });
};

// What a finger's tap sends a button, in the order the browser sends it.
const tap: (element: HTMLElement) => void = (element: HTMLElement): void => {
  fireEvent.pointerDown(element);
  fireEvent.mouseOver(element);
  fireEvent.mouseEnter(element);
  fireEvent.mouseDown(element);
  act(() => {
    element.focus();
  });
  fireEvent.mouseUp(element);
  fireEvent.click(element);
  // The finger lifts: the pointer leaves at once.
  fireEvent.mouseLeave(element);
  fireEvent.mouseOut(element);
};

// Moves focus as the Tab key does: a key goes down, then focus moves.
const tabTo: (element: HTMLElement) => void = (element: HTMLElement): void => {
  fireEvent.keyDown(document.body, { key: "Tab" });
  act(() => {
    element.focus();
  });
};

// Lets Tippy's deferred work run (a rich tooltip waits 120ms to show).
const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 250);
    });
  });
};

const tooltipsShown: () => Promise<Array<HTMLElement>> = async (): Promise<
  Array<HTMLElement>
> => {
  await settle();
  return screen.queryAllByRole("tooltip");
};

// The help's names and sentences, as its definition list draws them.
const helpEntries: (tooltip: HTMLElement) => Array<[string, string]> = (
  tooltip: HTMLElement,
): Array<[string, string]> => {
  return Array.from(tooltip.querySelectorAll("dt")).map(
    (term: Element): [string, string] => {
      return [
        term.textContent || "",
        term.nextElementSibling?.textContent || "",
      ];
    },
  );
};

afterEach(() => {
  cleanup();
});

describe("a choice of one in the facet sidebar", () => {
  test("its values are radio buttons, the chosen one checked though no chip names it", () => {
    renderSidebar({ chosenValue: "entry" });

    expect(choice("Entry spans")).toHaveAttribute("aria-checked", "true");
    expect(choice("Root spans")).toHaveAttribute("aria-checked", "false");
    expect(choice("All spans")).toHaveAttribute("aria-checked", "false");
    expect(within(choiceGroup()).queryAllByRole("checkbox")).toEqual([]);
  });

  test("a click on another value chooses it; a click on the chosen one changes nothing", () => {
    const rendered: Rendered = renderSidebar({ chosenValue: "entry" });

    fireEvent.click(choice("All spans"));
    expect(rendered.include.mock.calls).toEqual([["spanType", "all"]]);

    fireEvent.click(choice("Entry spans"));
    expect(rendered.include.mock.calls).toHaveLength(1);
    expect(rendered.remove).not.toHaveBeenCalled();
  });

  test("no value can be excluded, though the explorer could exclude elsewhere", () => {
    renderSidebar({ chosenValue: "entry" });

    expect(
      within(choiceGroup()).queryAllByRole("button", { name: /^Exclude / }),
    ).toEqual([]);
  });

  test("every value is listed under a page's locked scope, a 0 count too", () => {
    renderSidebar({ chosenValue: "entry", onlyShowValuesInScope: true });

    expect(choice("Root spans")).toBeInTheDocument();
    expect(choice("Entry spans")).toHaveAttribute("aria-checked", "true");
  });

  test("the header counts the choice only when a chip says it is not the default", () => {
    renderSidebar({ chosenValue: "entry" });
    expect(within(spanTypeHeader()).queryByText("1")).toBeNull();
    cleanup();

    renderSidebar({
      chosenValue: "all",
      activeFilters: [
        {
          facetKey: "spanType",
          value: "all",
          displayKey: "Span Type",
          displayValue: "All spans",
        },
      ],
    });
    expect(within(spanTypeHeader()).getByText("1")).toBeInTheDocument();
    expect(choice("All spans")).toHaveAttribute("aria-checked", "true");
  });

  test("every other facet keeps its checkboxes", () => {
    const rendered: Rendered = renderSidebar({ chosenValue: "entry" });

    const error: HTMLElement = screen.getByRole("checkbox", { name: "Error" });
    expect(error).toHaveAttribute("aria-checked", "false");

    fireEvent.click(error);
    expect(rendered.include.mock.calls).toEqual([["statusCode", "2"]]);
    expect(screen.queryAllByRole("radio")).toHaveLength(3);
  });
});

describe("what the choices mean: never a paragraph under the title", () => {
  test("REGRESSION: the paragraph is gone - the title is followed by the options alone", () => {
    renderSidebar({ chosenValue: "entry" });

    // Not the old paragraph, nor any of its sentences, drawn anywhere.
    expect(screen.queryByText(OLD_HELP)).toBeNull();
    expect(screen.queryByTestId("facet-section-description")).toBeNull();
    for (const sentence of Object.values(SENTENCES)) {
      expect(drawnText(sentence)).toEqual([]);
    }
    expect(
      Array.from(document.querySelectorAll("p")).map(
        (paragraph: HTMLParagraphElement): string => {
          return paragraph.textContent || "";
        },
      ),
    ).toEqual([]);

    // The radio group holds the three options and nothing before them.
    const group: HTMLElement = choiceGroup();
    expect(group.firstElementChild).toHaveAttribute(
      "data-testid",
      "facet-value-row",
    );
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio: HTMLElement): string => {
          return radio.textContent || "";
        }),
    ).toEqual(["Entry spans", "Root spans", "All spans"]);
  });

  test("an (i) beside the title is a button named for the facet, reached by Tab", () => {
    renderSidebar({ chosenValue: "entry" });

    const button: HTMLElement = helpButton();

    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("data-testid", FACET_HELP_BUTTON_TEST_ID);
    expect(button).not.toHaveAttribute("tabindex", "-1");
    // Not a disclosure of its own, and no part of the header's name.
    expect(button).not.toHaveAttribute("aria-expanded");
    expect(spanTypeHeader()).toHaveAccessibleName("Span Type");

    // The icon is decorative: the name comes from the label alone.
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");

    // In the header's row, after the title and before the chevron.
    const header: HTMLElement = spanTypeHeader();
    const chevron: HTMLElement = within(
      header.parentElement as HTMLElement,
    ).getByTestId("facet-section-chevron");
    expect(header.parentElement).toBe(button.parentElement);
    expect(
      header.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      button.compareDocumentPosition(chevron) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a screen reader hears what each choice is as the (i)'s description, with no tooltip showing", () => {
    renderSidebar({ chosenValue: "entry" });

    const button: HTMLElement = helpButton();

    expect(screen.queryAllByRole("tooltip")).toEqual([]);
    expect(button).toHaveAccessibleDescription(
      "Entry spans: Where a request or message enters a service. Root spans: Where a trace starts. All spans: Every operation, including database calls and internal steps.",
    );

    const description: HTMLElement = document.getElementById(
      button.getAttribute("aria-describedby") || "",
    ) as HTMLElement;

    // Never drawn on its own: only read as the description.
    expect(description).toHaveAttribute("hidden");
    expect(description).not.toBeVisible();
  });

  test("hovering the (i) shows each choice's name with its sentence, in the facet's order", async () => {
    renderSidebar({ chosenValue: "entry" });

    fireEvent.mouseEnter(helpButton());

    const tooltips: Array<HTMLElement> = await tooltipsShown();
    expect(tooltips).toHaveLength(1);
    expect(
      within(tooltips[0]!).getByTestId(FACET_HELP_TOOLTIP_TEST_ID),
    ).toBeInTheDocument();
    expect(helpEntries(tooltips[0]!)).toEqual(Object.entries(SENTENCES));

    fireEvent.mouseLeave(helpButton());
    await waitFor(() => {
      expect(screen.queryAllByRole("tooltip")).toEqual([]);
    });
  });

  test("keyboard focus on the (i) shows the help", async () => {
    renderSidebar({ chosenValue: "entry" });

    tabTo(helpButton());

    expect(document.activeElement).toBe(helpButton());
    const tooltips: Array<HTMLElement> = await tooltipsShown();
    expect(tooltips).toHaveLength(1);
    expect(helpEntries(tooltips[0]!)).toEqual(Object.entries(SENTENCES));
  });

  test("a tap on a phone shows the help, and it stays once the finger lifts; a second tap puts it away", async () => {
    renderSidebar({ chosenValue: "entry" });

    tap(helpButton());

    const tooltips: Array<HTMLElement> = await tooltipsShown();
    expect(tooltips).toHaveLength(1);
    expect(helpEntries(tooltips[0]!)).toEqual(Object.entries(SENTENCES));

    tap(helpButton());
    await waitFor(() => {
      expect(screen.queryAllByRole("tooltip")).toEqual([]);
    });
  });

  test("Tippy adds no description of its own: the help is read once", async () => {
    renderSidebar({ chosenValue: "entry" });

    const describedBy: string | null =
      helpButton().getAttribute("aria-describedby");

    tap(helpButton());
    await tooltipsShown();

    expect(helpButton().getAttribute("aria-describedby")).toBe(describedBy);
  });

  test("a press on the (i) asks only what the choices mean: the section stays open and nothing is chosen", () => {
    const rendered: Rendered = renderSidebar({ chosenValue: "entry" });

    fireEvent.click(helpButton());
    fireEvent.keyDown(helpButton(), { key: "Enter" });
    fireEvent.keyDown(helpButton(), { key: " " });

    expect(spanTypeHeader()).toHaveAttribute("aria-expanded", "true");
    expect(rendered.include).not.toHaveBeenCalled();
    expect(choiceGroup()).toBeInTheDocument();
  });

  test("the header still folds the section, and the (i) stays to explain it while folded", () => {
    renderSidebar({ chosenValue: "entry" });

    fireEvent.click(spanTypeHeader());

    expect(spanTypeHeader()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("radiogroup", { name: "Span Type" })).toBeNull();
    expect(helpButton()).toBeInTheDocument();

    fireEvent.click(spanTypeHeader());
    expect(choice("Root spans")).toBeInTheDocument();
  });

  test.each(Object.entries(SENTENCES))(
    "%s says what it is: its description, and on hover beside it",
    async (name: string, sentence: string) => {
      renderSidebar({ chosenValue: "entry" });

      const radio: HTMLElement = choice(name);

      // A screen reader hears it with the option, no tooltip showing.
      expect(radio).toHaveAccessibleName(name);
      expect(radio).toHaveAccessibleDescription(sentence);
      // Its sentence takes the place of the row's own hover text.
      expect(radio).not.toHaveAttribute("title");

      fireEvent.mouseEnter(radio);

      const tooltips: Array<HTMLElement> = await tooltipsShown();
      expect(
        tooltips.map((tooltip: HTMLElement): string => {
          return tooltip.textContent || "";
        }),
      ).toEqual([sentence]);

      fireEvent.mouseLeave(radio);
      await waitFor(() => {
        expect(screen.queryAllByRole("tooltip")).toEqual([]);
      });
    },
  );

  test("an option the keyboard reaches says what it is; one a click focused says nothing more than its hover", async () => {
    renderSidebar({ chosenValue: "entry" });

    tabTo(choice("Root spans"));
    expect(
      (await tooltipsShown()).map((tooltip: HTMLElement): string => {
        return tooltip.textContent || "";
      }),
    ).toEqual([SENTENCES["Root spans"]]);

    act(() => {
      choice("Root spans").blur();
    });
    await waitFor(() => {
      expect(screen.queryAllByRole("tooltip")).toEqual([]);
    });

    // A click's focus, with the pointer already gone: no tooltip pops up.
    fireEvent.pointerDown(choice("All spans"));
    fireEvent.mouseDown(choice("All spans"));
    act(() => {
      choice("All spans").focus();
    });
    expect(await tooltipsShown()).toEqual([]);
  });

  test("a facet with nothing to explain has no (i), and its rows no description", () => {
    renderSidebar({ chosenValue: "entry" });

    expect(screen.queryByRole("button", { name: "About Status" })).toBeNull();
    expect(screen.getAllByTestId(FACET_HELP_BUTTON_TEST_ID)).toHaveLength(1);

    const error: HTMLElement = screen.getByRole("checkbox", { name: "Error" });
    expect(error).not.toHaveAttribute("aria-describedby");
    expect(error).toHaveAttribute("title", "Filter to Error");

    // The plain header: its chevron inside the button that folds it.
    const status: HTMLElement = screen.getByRole("button", { name: "Status" });
    expect(
      within(status).getByTestId("facet-section-chevron"),
    ).toBeInTheDocument();
  });

  test("a choice without sentences has no (i), and its options keep their own hover text", () => {
    const plain: FacetConfig = {
      ...SPAN_TYPE("entry"),
      valueDescriptionMap: undefined,
    };

    renderSidebar({ chosenValue: "entry", spanType: plain });

    expect(screen.queryAllByTestId(FACET_HELP_BUTTON_TEST_ID)).toEqual([]);
    expect(choice("Root spans")).toHaveAttribute("title", "Show Root spans");
    expect(choice("Root spans")).not.toHaveAttribute("aria-describedby");
  });

  test("a facet that only says what it is about has an (i) with that sentence, and nothing under its title", async () => {
    const about: string =
      "Spans grouped by how they reached the service that recorded them.";
    const described: FacetConfig = {
      ...SPAN_TYPE("entry"),
      valueDescriptionMap: undefined,
      description: about,
    };

    renderSidebar({ chosenValue: "entry", spanType: described });

    expect(drawnText(about)).toEqual([]);
    expect(helpButton()).toHaveAccessibleDescription(about);

    fireEvent.mouseEnter(helpButton());

    const tooltips: Array<HTMLElement> = await tooltipsShown();
    expect(tooltips).toHaveLength(1);
    expect(within(tooltips[0]!).getByText(about)).toBeInTheDocument();
    expect(tooltips[0]!.querySelectorAll("dt")).toHaveLength(0);
  });

  test("an empty or blank description is nothing to explain", () => {
    const blank: FacetConfig = {
      ...SPAN_TYPE("entry"),
      description: "   ",
      valueDescriptionMap: { entry: "", root: " \n " },
    };

    renderSidebar({ chosenValue: "entry", spanType: blank });

    expect(screen.queryAllByTestId(FACET_HELP_BUTTON_TEST_ID)).toEqual([]);
    expect(choice("Root spans")).not.toHaveAttribute("aria-describedby");
  });
});

/*
 * Escape puts the help away (WCAG 1.4.13), however it came up, without the
 * pointer or the focus moving; the choice stays as it was.
 */
describe("Escape puts the Span Type's help away", () => {
  // Escape as the keyboard sends it; false when the key was spent.
  const pressEscape: () => boolean = (): boolean => {
    return fireEvent.keyDown(document.activeElement || document.body, {
      key: "Escape",
    });
  };

  const noTooltips: () => Promise<void> = async (): Promise<void> => {
    await waitFor(() => {
      expect(screen.queryAllByRole("tooltip")).toEqual([]);
    });
  };

  test("the (i)'s help, pointed at: Escape closes it", async () => {
    renderSidebar({ chosenValue: "entry" });

    fireEvent.mouseEnter(helpButton());
    expect(await tooltipsShown()).toHaveLength(1);

    expect(pressEscape()).toBe(false);
    await noTooltips();
    expect(choice("Entry spans")).toHaveAttribute("aria-checked", "true");
  });

  test("the (i)'s help, tabbed to: Escape closes it and the focus stays on the (i)", async () => {
    renderSidebar({ chosenValue: "entry" });

    tabTo(helpButton());
    expect(await tooltipsShown()).toHaveLength(1);

    pressEscape();
    await noTooltips();
    expect(helpButton()).toHaveFocus();
  });

  test("the (i)'s help, tapped open on a phone: Escape closes it, and a tap opens it again", async () => {
    renderSidebar({ chosenValue: "entry" });

    tap(helpButton());
    expect(await tooltipsShown()).toHaveLength(1);

    pressEscape();
    await noTooltips();

    tap(helpButton());
    expect(await tooltipsShown()).toHaveLength(1);
  });

  test("an option's sentence, tabbed to: Escape closes it, the focus stays, nothing is chosen", async () => {
    const rendered: Rendered = renderSidebar({ chosenValue: "entry" });

    tabTo(choice("Root spans"));
    expect(
      (await tooltipsShown()).map((tooltip: HTMLElement): string => {
        return tooltip.textContent || "";
      }),
    ).toEqual(["Where a trace starts."]);

    pressEscape();
    await noTooltips();
    expect(choice("Root spans")).toHaveFocus();
    expect(rendered.include).not.toHaveBeenCalled();
  });

  test("an option's sentence, pointed at: Escape closes it", async () => {
    renderSidebar({ chosenValue: "entry" });

    fireEvent.mouseEnter(choice("All spans"));
    expect(await tooltipsShown()).toHaveLength(1);

    expect(pressEscape()).toBe(false);
    await noTooltips();
  });
});
