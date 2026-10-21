import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import CorrelateFilterBuilder, {
  getDefaultCorrelationCondition,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateFilterBuilder";
import {
  CorrelationCondition,
  CorrelationConnector,
  CorrelationFieldKey,
  CorrelationOperator,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/SecurityEventCorrelation";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  isVisibleAtWidth,
} from "../../ResponsiveVisibility";

/*
 * The correlate filter builder rows (issue #3395): field + operator + value
 * per row, add/remove, one AND/OR connector. Pinned here: the default row,
 * append/delete, the operator vocabulary following the field, value reset
 * on field change, the connector toggle appearing only for chains, and the
 * value editor switching between text input and fixed dropdown per field.
 * The redesign adds a leading "Where"/AND/OR cell per row, an empty-state
 * hint, a footer that hosts the parent's action, and Enter-to-submit on the
 * plain text value editors.
 */

/*
 * Identity translations by default; a test can register a translation to
 * prove a string is routed through useTranslateValue (or deliberately not).
 */
const mockTranslations: Record<string, string> = {};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return mockTranslations[key] ?? key;
        },
      };
    },
  };
});

interface HarnessExtraProps {
  footerAction?: ReactElement | undefined;
  onSubmit?: (() => void) | undefined;
}

interface HarnessProps extends HarnessExtraProps {
  initialConditions: Array<CorrelationCondition>;
  initialConnector: CorrelationConnector;
  onChangeSpy: (
    conditions: Array<CorrelationCondition>,
    connector: CorrelationConnector,
  ) => void;
}

const Harness: FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): ReactElement => {
  const [conditions, setConditions] = useState<Array<CorrelationCondition>>(
    props.initialConditions,
  );
  const [connector, setConnector] = useState<CorrelationConnector>(
    props.initialConnector,
  );

  return (
    <CorrelateFilterBuilder
      conditions={conditions}
      connector={connector}
      onChange={(
        nextConditions: Array<CorrelationCondition>,
        nextConnector: CorrelationConnector,
      ) => {
        setConditions(nextConditions);
        setConnector(nextConnector);
        props.onChangeSpy(nextConditions, nextConnector);
      }}
      footerAction={props.footerAction}
      onSubmit={props.onSubmit}
    />
  );
};

type RenderHarnessFunction = (
  initialConditions?: Array<CorrelationCondition>,
  initialConnector?: CorrelationConnector,
  extraProps?: HarnessExtraProps,
) => MockFunction;

const renderHarness: RenderHarnessFunction = (
  initialConditions?: Array<CorrelationCondition>,
  initialConnector?: CorrelationConnector,
  extraProps?: HarnessExtraProps,
): MockFunction => {
  const onChangeSpy: MockFunction = getJestMockFunction();
  render(
    <Harness
      initialConditions={
        initialConditions || [getDefaultCorrelationCondition()]
      }
      initialConnector={initialConnector || "and"}
      onChangeSpy={
        onChangeSpy as (
          conditions: Array<CorrelationCondition>,
          connector: CorrelationConnector,
        ) => void
      }
      footerAction={extraProps?.footerAction}
      onSubmit={extraProps?.onSubmit}
    />,
  );
  return onChangeSpy;
};

type SelectOptionFunction = (combobox: HTMLElement, optionText: string) => void;

/*
 * react-select renders its menu on ArrowDown; the option text is unique on
 * the page at that moment, so a global text lookup finds it.
 */
const selectOption: SelectOptionFunction = (
  combobox: HTMLElement,
  optionText: string,
): void => {
  fireEvent.keyDown(combobox, { key: "ArrowDown" });
  const option: HTMLElement = screen.getByText(optionText);
  fireEvent.mouseDown(option);
  fireEvent.click(option);
};

function rowComboboxes(rowIndex: number): Array<HTMLElement> {
  return within(
    screen.getByTestId(`correlate-condition-row-${rowIndex}`),
  ).getAllByRole("combobox");
}

/*
 * Elements whose OWN text (ignoring descendants) equals the given string, so
 * a badge is counted once rather than once per ancestor.
 */
function elementsWithOwnText(
  container: HTMLElement,
  text: string,
): Array<Element> {
  return Array.from(container.querySelectorAll("*")).filter(
    (element: Element): boolean => {
      const ownText: string = Array.from(element.childNodes)
        .filter((node: ChildNode): boolean => {
          return node.nodeType === Node.TEXT_NODE;
        })
        .map((node: ChildNode): string => {
          return node.textContent || "";
        })
        .join("")
        .trim();
      return ownText === text;
    },
  );
}

function leadCell(rowIndex: number): HTMLElement {
  return screen.getByTestId(`correlate-condition-lead-${rowIndex}`);
}

function classTokens(element: Element): Array<string> {
  return (element.getAttribute("class") || "")
    .split(/\s+/)
    .filter((token: string): boolean => {
      return token.length > 0;
    });
}

function observableCondition(value: string): CorrelationCondition {
  return {
    field: CorrelationFieldKey.Observable,
    operator: CorrelationOperator.Equals,
    value,
  };
}

const severityCondition: CorrelationCondition = {
  field: CorrelationFieldKey.Severity,
  operator: CorrelationOperator.Equals,
  value: OcsfSeverity.High,
};

afterEach(() => {
  jest.restoreAllMocks();
  cleanup();
  for (const key of Object.keys(mockTranslations)) {
    delete mockTranslations[key];
  }
});

describe("CorrelateFilterBuilder", () => {
  test("renders the default observable row with a text value input", () => {
    renderHarness();
    expect(screen.getByTestId("correlate-condition-row-0")).toBeInTheDocument();
    expect(
      screen.getByTestId("correlate-condition-value-0"),
    ).toBeInTheDocument();
    // Single row → no connector toggle yet.
    expect(screen.queryByTestId("correlate-connector-and")).toBeNull();
  });

  test("typing a value emits the updated condition", () => {
    const onChangeSpy: MockFunction = renderHarness();
    fireEvent.change(screen.getByTestId("correlate-condition-value-0"), {
      target: { value: "wb-ubuntu-03" },
    });
    expect(onChangeSpy).toHaveBeenCalledWith(
      [
        {
          field: CorrelationFieldKey.Observable,
          operator: CorrelationOperator.Equals,
          value: "wb-ubuntu-03",
        },
      ],
      "and",
    );
  });

  test("Add condition appends a default row and reveals the connector toggle", () => {
    const onChangeSpy: MockFunction = renderHarness();
    fireEvent.click(screen.getByTestId("correlate-add-condition"));

    expect(screen.getByTestId("correlate-condition-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("correlate-connector-and")).toBeInTheDocument();
    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [getDefaultCorrelationCondition(), getDefaultCorrelationCondition()],
      "and",
    );
  });

  test("deleting a row removes exactly that row", () => {
    const onChangeSpy: MockFunction = renderHarness([
      {
        field: CorrelationFieldKey.Observable,
        operator: CorrelationOperator.Equals,
        value: "keep-me",
      },
      {
        field: CorrelationFieldKey.PrincipalUser,
        operator: CorrelationOperator.Equals,
        value: "delete-me",
      },
    ]);

    fireEvent.click(screen.getByTestId("correlate-condition-delete-1"));

    expect(screen.queryByTestId("correlate-condition-row-1")).toBeNull();
    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [
        {
          field: CorrelationFieldKey.Observable,
          operator: CorrelationOperator.Equals,
          value: "keep-me",
        },
      ],
      "and",
    );
  });

  test("switching the connector to OR emits and restyles the badge", () => {
    const onChangeSpy: MockFunction = renderHarness([
      getDefaultCorrelationCondition(),
      getDefaultCorrelationCondition(),
    ]);

    fireEvent.click(screen.getByTestId("correlate-connector-or"));

    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [getDefaultCorrelationCondition(), getDefaultCorrelationCondition()],
      "or",
    );
    // The between-row badge now reads OR.
    expect(
      within(screen.getByTestId("correlate-condition-row-1")).getByText("OR"),
    ).toBeInTheDocument();
  });

  test("switching the field resets the value and keeps a compatible operator", () => {
    const onChangeSpy: MockFunction = renderHarness([
      {
        field: CorrelationFieldKey.Observable,
        operator: CorrelationOperator.Contains,
        value: "ubuntu",
      },
    ]);

    const fieldCombobox: HTMLElement = rowComboboxes(0)[0] as HTMLElement;
    selectOption(fieldCombobox, "Principal Host");

    // "contains" is offered on Principal Host too, so it survives.
    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [
        {
          field: CorrelationFieldKey.PrincipalHost,
          operator: CorrelationOperator.Contains,
          value: "",
        },
      ],
      "and",
    );
  });

  test("switching to a field that lacks the operator falls back to the field's first operator", () => {
    const onChangeSpy: MockFunction = renderHarness([
      {
        field: CorrelationFieldKey.Observable,
        operator: CorrelationOperator.StartsWith,
        value: "192.168.",
      },
    ]);

    const fieldCombobox: HTMLElement = rowComboboxes(0)[0] as HTMLElement;
    selectOption(fieldCombobox, "Severity");

    // Severity only offers is / is not.
    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [
        {
          field: CorrelationFieldKey.Severity,
          operator: CorrelationOperator.Equals,
          value: "",
        },
      ],
      "and",
    );
  });

  test("severity value renders a dropdown with the OCSF vocabulary", () => {
    const onChangeSpy: MockFunction = renderHarness([
      {
        field: CorrelationFieldKey.Severity,
        operator: CorrelationOperator.Equals,
        value: "",
      },
    ]);

    /*
     * The value editor is a react-select dropdown (not a text input): the
     * row has three comboboxes — field, operator, value.
     */
    const comboboxes: Array<HTMLElement> = rowComboboxes(0);
    expect(comboboxes).toHaveLength(3);

    selectOption(comboboxes[2] as HTMLElement, OcsfSeverity.Critical);

    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [
        {
          field: CorrelationFieldKey.Severity,
          operator: CorrelationOperator.Equals,
          value: OcsfSeverity.Critical,
        },
      ],
      "and",
    );
  });

  test("operator dropdown only offers the field's vocabulary", () => {
    renderHarness([
      {
        field: CorrelationFieldKey.Severity,
        operator: CorrelationOperator.Equals,
        value: "",
      },
    ]);

    const operatorCombobox: HTMLElement = rowComboboxes(0)[1] as HTMLElement;
    fireEvent.keyDown(operatorCombobox, { key: "ArrowDown" });

    expect(screen.getByText("is not")).toBeInTheDocument();
    expect(screen.queryByText("contains")).toBeNull();
    expect(screen.queryByText("starts with")).toBeNull();
  });

  test("event class renders a free-text autocomplete seeded with the OCSF class names", () => {
    const onChangeSpy: MockFunction = renderHarness([
      {
        field: CorrelationFieldKey.EventClass,
        operator: CorrelationOperator.Equals,
        value: "",
      },
    ]);

    /*
     * Event Class is suggestions-not-dropdown on purpose: classes outside
     * the curated OCSF table keep source-derived names, so the value must
     * stay free text — an AutocompleteTextInput (a real INPUT that types
     * freely; it also exposes role=combobox for its suggestion menu, so
     * the row carries three comboboxes).
     */
    expect(rowComboboxes(0)).toHaveLength(3);
    const valueInput: HTMLElement = screen.getByTestId(
      "correlate-condition-value-0",
    );
    expect(valueInput.tagName).toBe("INPUT");
    expect(valueInput).toHaveAttribute("placeholder", "Authentication");

    fireEvent.change(valueInput, { target: { value: "Auth" } });
    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [
        {
          field: CorrelationFieldKey.EventClass,
          operator: CorrelationOperator.Equals,
          value: "Auth",
        },
      ],
      "and",
    );

    // Typing surfaces the matching curated suggestion.
    fireEvent.focus(valueInput);
    expect(screen.getByText("Authentication")).toBeInTheDocument();
  });

  test("message field starts on its first operator (contains) and offers no equality", () => {
    renderHarness([
      {
        field: CorrelationFieldKey.Message,
        operator: CorrelationOperator.Contains,
        value: "",
      },
    ]);

    const operatorCombobox: HTMLElement = rowComboboxes(0)[1] as HTMLElement;
    fireEvent.keyDown(operatorCombobox, { key: "ArrowDown" });

    expect(screen.getByText("does not contain")).toBeInTheDocument();
    expect(screen.queryByText(/^is$/)).toBeNull();
  });
});

describe("CorrelateFilterBuilder layout", () => {
  test("the container uses the roomier p-4 panel", () => {
    renderHarness();
    const builder: HTMLElement = screen.getByTestId("correlate-filter-builder");
    expect(classTokens(builder)).toEqual(
      expect.arrayContaining([
        "rounded-lg",
        "border",
        "border-gray-200",
        "bg-gray-50",
        "p-4",
        "space-y-3",
      ]),
    );
    expect(classTokens(builder)).not.toContain("p-3");
  });

  test("row 0 leads with a 'Where' label that only shows from md up", () => {
    renderHarness();
    const lead: HTMLElement = leadCell(0);

    expect(
      within(screen.getByTestId("correlate-condition-row-0")).getByText(
        "Where",
      ),
    ).toBeInTheDocument();
    expect(lead).toHaveTextContent("Where");
    // Stacked rows on small screens: the cell collapses instead of a gap.
    expect(classTokens(lead)).toEqual(
      expect.arrayContaining([
        "max-md:hidden",
        "md:block",
        "md:w-14",
        "shrink-0",
      ]),
    );
    expect(isVisibleAtWidth(lead, PHONE_WIDTH_IN_PX)).toBe(false);
    expect(isVisibleAtWidth(lead, TABLET_WIDTH_IN_PX)).toBe(true);
    /*
     * `max-md:hidden`, never the bare `hidden`: a foreign
     * `.hidden { display: none !important }` rule on the page would beat
     * `md:block` and drop the label from every width, leaving the first row
     * without its "Where" and the dropdowns out of line with the rows below.
     */
    expect(classTokens(lead)).not.toContain("hidden");
    expect(
      isVisibleAtWidth(lead, LAPTOP_WIDTH_IN_PX, {
        withForeignHiddenRule: true,
      }),
    ).toBe(true);
    // The first row never carries a connector badge.
    expect(
      elementsWithOwnText(
        screen.getByTestId("correlate-condition-row-0"),
        "AND",
      ),
    ).toHaveLength(0);
    expect(
      elementsWithOwnText(
        screen.getByTestId("correlate-condition-row-0"),
        "OR",
      ),
    ).toHaveLength(0);
  });

  test("the leading cell is the first child of each row so the dropdowns align", () => {
    renderHarness([observableCondition("a"), observableCondition("b")]);
    for (const rowIndex of [0, 1]) {
      const row: HTMLElement = screen.getByTestId(
        `correlate-condition-row-${rowIndex}`,
      );
      expect(row.firstElementChild).toBe(leadCell(rowIndex));
      expect(classTokens(leadCell(rowIndex))).toEqual(
        expect.arrayContaining(["shrink-0", "md:w-14"]),
      );
    }
  });

  test("rows after the first carry exactly one AND badge and no 'Where'", () => {
    renderHarness([
      observableCondition("a"),
      observableCondition("b"),
      observableCondition("c"),
    ]);

    for (const rowIndex of [1, 2]) {
      const row: HTMLElement = screen.getByTestId(
        `correlate-condition-row-${rowIndex}`,
      );
      const badges: Array<Element> = elementsWithOwnText(row, "AND");
      expect(badges).toHaveLength(1);
      expect(elementsWithOwnText(row, "OR")).toHaveLength(0);
      expect(within(row).queryByText("Where")).toBeNull();
      expect(leadCell(rowIndex)).toContainElement(badges[0] as HTMLElement);
      // Badge is readable now: text-xs, not the old 10px.
      expect(classTokens(badges[0] as Element)).toEqual(
        expect.arrayContaining([
          "text-xs",
          "bg-indigo-50",
          "text-indigo-600",
          "border-indigo-200",
        ]),
      );
      expect(classTokens(badges[0] as Element)).not.toContain("text-[10px]");
    }
    // "Where" is rendered once, for the first row only.
    expect(screen.getAllByText("Where")).toHaveLength(1);
  });

  test("an OR chain labels every later row OR with the amber badge", () => {
    renderHarness(
      [
        observableCondition("a"),
        observableCondition("b"),
        observableCondition("c"),
      ],
      "or",
    );

    for (const rowIndex of [1, 2]) {
      const row: HTMLElement = screen.getByTestId(
        `correlate-condition-row-${rowIndex}`,
      );
      const badges: Array<Element> = elementsWithOwnText(row, "OR");
      expect(badges).toHaveLength(1);
      expect(elementsWithOwnText(row, "AND")).toHaveLength(0);
      expect(classTokens(badges[0] as Element)).toEqual(
        expect.arrayContaining([
          "text-xs",
          "bg-amber-50",
          "text-amber-700",
          "border-amber-200",
        ]),
      );
      // amber-600 on amber-50 is too faint for small bold text.
      expect(classTokens(badges[0] as Element)).not.toContain("text-amber-600");
      expect(classTokens(badges[0] as Element)).not.toContain(
        "text-indigo-600",
      );
    }
  });

  test("the OR badge matches the OR toggle's amber-700 text", () => {
    renderHarness([observableCondition("a"), observableCondition("b")], "or");

    const badge: Element = elementsWithOwnText(leadCell(1), "OR")[0] as Element;
    const toggle: HTMLElement = screen.getByTestId("correlate-connector-or");
    const amberTextClass: RegExp = /^text-amber-\d+$/;
    const amberText: (element: Element) => Array<string> = (
      element: Element,
    ): Array<string> => {
      return classTokens(element).filter((token: string): boolean => {
        return amberTextClass.test(token);
      });
    };

    expect(amberText(badge)).toEqual(["text-amber-700"]);
    expect(amberText(toggle)).toEqual(["text-amber-700"]);
  });

  test("toggling back to AND drops the amber badge classes", () => {
    renderHarness([observableCondition("a"), observableCondition("b")], "or");

    fireEvent.click(screen.getByTestId("correlate-connector-and"));

    const badge: Element = elementsWithOwnText(
      leadCell(1),
      "AND",
    )[0] as Element;

    expect(classTokens(badge)).toEqual(
      expect.arrayContaining([
        "bg-indigo-50",
        "text-indigo-600",
        "border-indigo-200",
      ]),
    );
    for (const token of classTokens(badge)) {
      expect(token).not.toMatch(/amber/);
    }
  });

  test("toggling the connector relabels every badge in place", () => {
    renderHarness([
      observableCondition("a"),
      observableCondition("b"),
      observableCondition("c"),
    ]);

    fireEvent.click(screen.getByTestId("correlate-connector-or"));
    expect(leadCell(1)).toHaveTextContent(/^OR$/);
    expect(leadCell(2)).toHaveTextContent(/^OR$/);
    expect(screen.getByTestId("correlate-connector-or")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("correlate-connector-and")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(screen.getByTestId("correlate-connector-and"));
    expect(leadCell(1)).toHaveTextContent(/^AND$/);
    expect(leadCell(2)).toHaveTextContent(/^AND$/);
  });

  test("deleting the first row promotes the next one to 'Where'", () => {
    const onChangeSpy: MockFunction = renderHarness([
      observableCondition("drop-me"),
      observableCondition("keep-me"),
    ]);

    fireEvent.click(screen.getByTestId("correlate-condition-delete-0"));

    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [observableCondition("keep-me")],
      "and",
    );
    expect(screen.queryByTestId("correlate-condition-row-1")).toBeNull();
    expect(leadCell(0)).toHaveTextContent("Where");
    expect(screen.queryByText("AND")).toBeNull();
    // A single row hides the connector toggle again.
    expect(screen.queryByTestId("correlate-connector-and")).toBeNull();
  });

  test("the connector row keeps its labels and test ids", () => {
    renderHarness([observableCondition("a"), observableCondition("b")]);
    expect(screen.getByText("Match")).toBeInTheDocument();
    expect(screen.getByTestId("correlate-connector-and")).toHaveTextContent(
      /^All conditions$/,
    );
    expect(screen.getByTestId("correlate-connector-or")).toHaveTextContent(
      /^Any condition$/,
    );
  });

  test("severity rows keep exactly three comboboxes with the leading cell in place", () => {
    renderHarness([severityCondition, severityCondition, severityCondition]);
    for (const rowIndex of [0, 1, 2]) {
      expect(rowComboboxes(rowIndex)).toHaveLength(3);
    }
  });

  test("a plain text row has field and operator comboboxes plus one text box", () => {
    renderHarness([observableCondition("alice")]);
    const row: HTMLElement = screen.getByTestId("correlate-condition-row-0");
    expect(rowComboboxes(0)).toHaveLength(2);
    expect(within(row).getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByTestId("correlate-condition-value-0")).toHaveAttribute(
      "aria-label",
      "Condition 1 value",
    );
  });

  test("no new element repeats an operator label", () => {
    renderHarness([
      observableCondition("a"),
      {
        field: CorrelationFieldKey.Observable,
        operator: CorrelationOperator.NotEquals,
        value: "b",
      },
      {
        field: CorrelationFieldKey.Message,
        operator: CorrelationOperator.Contains,
        value: "c",
      },
      {
        field: CorrelationFieldKey.PrincipalIp,
        operator: CorrelationOperator.StartsWith,
        value: "10.",
      },
    ]);

    const builder: HTMLElement = screen.getByTestId("correlate-filter-builder");
    /*
     * Each operator label may appear only as the selected value of its own
     * operator dropdown, never in the leading cell, hint or footer.
     */
    expect(elementsWithOwnText(builder, "is")).toHaveLength(1);
    expect(elementsWithOwnText(builder, "is not")).toHaveLength(1);
    expect(elementsWithOwnText(builder, "contains")).toHaveLength(1);
    expect(elementsWithOwnText(builder, "starts with")).toHaveLength(1);
    for (const label of ["is", "is not", "contains", "starts with"]) {
      for (const rowIndex of [0, 1, 2, 3]) {
        expect(leadCell(rowIndex)).not.toHaveTextContent(
          new RegExp(`^${label}$`),
        );
      }
      expect(
        screen.getByTestId("correlate-builder-footer"),
      ).not.toHaveTextContent(new RegExp(`\\b${label}\\b`));
    }
  });

  test("the delete button keeps its numbered accessible name", () => {
    renderHarness([observableCondition("a"), observableCondition("b")]);
    expect(screen.getByTestId("correlate-condition-delete-0")).toHaveAttribute(
      "aria-label",
      "Remove condition 1",
    );
    expect(screen.getByTestId("correlate-condition-delete-1")).toHaveAttribute(
      "aria-label",
      "Remove condition 2",
    );
  });
});

/*
 * A row always has a field and an operator, so those two dropdowns show no
 * clear (x) control: clearing one could only be undone. The severity value
 * dropdown stays clearable, because an empty value is a real draft state.
 */
describe("CorrelateFilterBuilder clearable dropdowns", () => {
  type DropdownPart = "field" | "operator" | "value";

  function combobox(rowIndex: number, part: DropdownPart): HTMLElement {
    return within(
      screen.getByTestId(`correlate-condition-row-${rowIndex}`),
    ).getByRole("combobox", { name: `Condition ${rowIndex + 1} ${part}` });
  }

  // The react-select control that holds this row's dropdown.
  function selectControl(rowIndex: number, part: DropdownPart): HTMLElement {
    const control: HTMLElement | null = combobox(rowIndex, part).closest(
      ".ou-select__control",
    );
    expect(control).not.toBeNull();
    return control as HTMLElement;
  }

  function clearIndicator(
    rowIndex: number,
    part: DropdownPart,
  ): HTMLElement | null {
    return selectControl(rowIndex, part).querySelector<HTMLElement>(
      ".ou-select__clear-indicator",
    );
  }

  function selectedText(rowIndex: number, part: DropdownPart): string | null {
    const single: HTMLElement | null = selectControl(
      rowIndex,
      part,
    ).querySelector<HTMLElement>(".ou-select__single-value");
    return single ? single.textContent : null;
  }

  const criticalSeverity: CorrelationCondition = {
    field: CorrelationFieldKey.Severity,
    operator: CorrelationOperator.NotEquals,
    value: OcsfSeverity.Critical,
  };

  const ROWS: Array<{ name: string; condition: CorrelationCondition }> = [
    { name: "a plain text row", condition: observableCondition("alice") },
    { name: "a severity row with a value", condition: criticalSeverity },
    {
      name: "a severity row without a value",
      condition: { ...criticalSeverity, value: "" },
    },
    {
      name: "an event class row",
      condition: {
        field: CorrelationFieldKey.EventClass,
        operator: CorrelationOperator.Contains,
        value: "Auth",
      },
    },
    {
      name: "a message row",
      condition: {
        field: CorrelationFieldKey.Message,
        operator: CorrelationOperator.NotContains,
        value: "cron",
      },
    },
  ];

  test.each(ROWS)(
    "$name shows its field and operator with no clear control",
    ({ condition }: { condition: CorrelationCondition }) => {
      renderHarness([condition]);

      for (const part of ["field", "operator"] as Array<DropdownPart>) {
        // A value is selected, which is when react-select would offer x.
        expect(selectedText(0, part)).not.toBeNull();
        expect(clearIndicator(0, part)).toBeNull();
        expect(
          selectControl(0, part).querySelector(
            ".ou-select__dropdown-indicator",
          ),
        ).not.toBeNull();
      }
    },
  );

  test("the severity value dropdown keeps its clear control", () => {
    renderHarness([criticalSeverity]);

    expect(selectedText(0, "field")).toBe("Severity");
    expect(selectedText(0, "operator")).toBe("is not");
    expect(selectedText(0, "value")).toBe(OcsfSeverity.Critical);
    expect(clearIndicator(0, "value")).not.toBeNull();

    // The only clear control in the row is the value's.
    const row: HTMLElement = screen.getByTestId("correlate-condition-row-0");
    const indicators: Array<Element> = Array.from(
      row.querySelectorAll(".ou-select__clear-indicator"),
    );
    expect(indicators).toHaveLength(1);
    expect(selectControl(0, "value")).toContainElement(
      indicators[0] as HTMLElement,
    );
  });

  test("an empty severity value has nothing to clear until one is picked", () => {
    const onChangeSpy: MockFunction = renderHarness([
      { ...criticalSeverity, value: "" },
    ]);

    expect(selectedText(0, "value")).toBeNull();
    expect(clearIndicator(0, "value")).toBeNull();

    selectOption(combobox(0, "value"), OcsfSeverity.Low);

    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [{ ...criticalSeverity, value: OcsfSeverity.Low }],
      "and",
    );
    expect(selectedText(0, "value")).toBe(OcsfSeverity.Low);
    expect(clearIndicator(0, "value")).not.toBeNull();
    expect(clearIndicator(0, "field")).toBeNull();
    expect(clearIndicator(0, "operator")).toBeNull();
  });

  test("clearing the severity value empties only the value", () => {
    const onChangeSpy: MockFunction = renderHarness([
      observableCondition("alice"),
      criticalSeverity,
    ]);

    // react-select clears on a primary-button mousedown.
    fireEvent.mouseDown(clearIndicator(1, "value") as HTMLElement, {
      button: 0,
    });

    expect(onChangeSpy).toHaveBeenCalledTimes(1);
    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [observableCondition("alice"), { ...criticalSeverity, value: "" }],
      "and",
    );
    expect(selectedText(1, "value")).toBeNull();
    expect(clearIndicator(1, "value")).toBeNull();
    // The field and operator are untouched.
    expect(selectedText(1, "field")).toBe("Severity");
    expect(selectedText(1, "operator")).toBe("is not");
    expect(screen.getByTestId("correlate-condition-value-0")).toHaveValue(
      "alice",
    );
  });

  test("Backspace never clears a field or an operator", () => {
    const onChangeSpy: MockFunction = renderHarness([
      criticalSeverity,
      observableCondition("alice"),
    ]);

    for (const rowIndex of [0, 1]) {
      for (const part of ["field", "operator"] as Array<DropdownPart>) {
        fireEvent.keyDown(combobox(rowIndex, part), {
          key: "Backspace",
          code: "Backspace",
        });
        fireEvent.keyDown(combobox(rowIndex, part), {
          key: "Delete",
          code: "Delete",
        });
      }
    }

    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(selectedText(0, "field")).toBe("Severity");
    expect(selectedText(0, "operator")).toBe("is not");
    expect(selectedText(1, "field")).toBe("Observable");
    expect(selectedText(1, "operator")).toBe("is");
  });

  test("Backspace in the severity value dropdown clears the value", () => {
    const onChangeSpy: MockFunction = renderHarness([criticalSeverity]);

    fireEvent.keyDown(combobox(0, "value"), {
      key: "Backspace",
      code: "Backspace",
    });

    expect(onChangeSpy).toHaveBeenCalledTimes(1);
    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [{ ...criticalSeverity, value: "" }],
      "and",
    );
    expect(selectedText(0, "value")).toBeNull();
  });

  test("a non-clearable field can still be switched, and stays non-clearable", () => {
    const onChangeSpy: MockFunction = renderHarness([
      observableCondition("alice"),
    ]);

    selectOption(combobox(0, "field"), "Severity");

    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [
        {
          field: CorrelationFieldKey.Severity,
          operator: CorrelationOperator.Equals,
          value: "",
        },
      ],
      "and",
    );
    expect(selectedText(0, "field")).toBe("Severity");
    expect(clearIndicator(0, "field")).toBeNull();
    expect(clearIndicator(0, "operator")).toBeNull();
    // The new value dropdown starts empty, so it has nothing to clear yet.
    expect(clearIndicator(0, "value")).toBeNull();
  });

  test("a non-clearable operator can still be switched", () => {
    const onChangeSpy: MockFunction = renderHarness([criticalSeverity]);

    selectOption(combobox(0, "operator"), "is");

    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [{ ...criticalSeverity, operator: CorrelationOperator.Equals }],
      "and",
    );
    expect(selectedText(0, "operator")).toBe("is");
    expect(clearIndicator(0, "operator")).toBeNull();
    // Changing the operator keeps the value and its clear control.
    expect(selectedText(0, "value")).toBe(OcsfSeverity.Critical);
    expect(clearIndicator(0, "value")).not.toBeNull();
  });
});

describe("CorrelateFilterBuilder empty state", () => {
  test("zero conditions shows the empty hint and no rows", () => {
    renderHarness([]);
    const hint: HTMLElement = screen.getByTestId("correlate-builder-empty");
    expect(hint.tagName).toBe("P");
    expect(hint).toHaveTextContent("No conditions yet. Add one to start.");
    expect(classTokens(hint)).toEqual(
      expect.arrayContaining([
        "border-dashed",
        "border-gray-300",
        "text-gray-500",
        "text-center",
      ]),
    );
    expect(screen.getByTestId("correlate-filter-builder")).toContainElement(
      hint,
    );
    expect(screen.queryByTestId("correlate-condition-row-0")).toBeNull();
    expect(screen.queryByTestId("correlate-connector-and")).toBeNull();
    expect(screen.queryByText("Where")).toBeNull();
    expect(screen.getByTestId("correlate-add-condition")).toBeInTheDocument();
  });

  test("the hint is absent once there is a condition", () => {
    renderHarness();
    expect(screen.queryByTestId("correlate-builder-empty")).toBeNull();
  });

  test("adding a condition to an empty builder replaces the hint with a default row", () => {
    const onChangeSpy: MockFunction = renderHarness([]);
    fireEvent.click(screen.getByTestId("correlate-add-condition"));

    expect(onChangeSpy).toHaveBeenCalledTimes(1);
    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [getDefaultCorrelationCondition()],
      "and",
    );
    expect(screen.queryByTestId("correlate-builder-empty")).toBeNull();
    expect(screen.getByTestId("correlate-condition-row-0")).toBeInTheDocument();
    expect(leadCell(0)).toHaveTextContent("Where");
  });

  test("deleting the last row brings the hint back", () => {
    const onChangeSpy: MockFunction = renderHarness();
    fireEvent.click(screen.getByTestId("correlate-condition-delete-0"));
    expect(onChangeSpy).toHaveBeenLastCalledWith([], "and");
    expect(screen.getByTestId("correlate-builder-empty")).toBeInTheDocument();
  });
});

describe("CorrelateFilterBuilder footer", () => {
  test("Add condition is a small NORMAL button with no OUTLINE leftovers", () => {
    renderHarness();
    const addButton: HTMLElement = screen.getByTestId(
      "correlate-add-condition",
    );
    const tokens: Array<string> = classTokens(addButton);

    expect(addButton.tagName).toBe("BUTTON");
    expect(addButton).toHaveAttribute("type", "button");
    expect(addButton).toHaveTextContent("Add condition");
    // NORMAL look.
    expect(tokens).toEqual(
      expect.arrayContaining(["bg-white", "border-gray-300", "text-gray-700"]),
    );
    // Small size.
    expect(tokens).toEqual(expect.arrayContaining(["px-2", "py-1"]));
    // None of the OUTLINE style.
    expect(tokens).not.toContain("btn-outline-secondary");
    expect(tokens).not.toContain("background-very-light-Gray500-on-hover");
    expect(tokens).not.toContain("ml-1");
  });

  test("the add button sits in a footer row that neutralises Button margins and widths", () => {
    renderHarness();
    const footer: HTMLElement = screen.getByTestId("correlate-builder-footer");
    expect(footer).toContainElement(
      screen.getByTestId("correlate-add-condition"),
    );
    expect(screen.getByTestId("correlate-filter-builder")).toContainElement(
      footer,
    );
    expect(classTokens(footer)).toEqual(
      expect.arrayContaining([
        "flex",
        "flex-col",
        "sm:flex-row",
        "sm:items-center",
        "sm:justify-between",
        "border-t",
        "border-gray-200",
        "pt-3",
        "[&_button]:ml-0",
        /*
         * Button is w-full until md; once the footer is a row the parent's
         * footerAction must not stretch across it either.
         */
        "[&_button]:sm:w-auto",
      ]),
    );
    // Footer is the builder's last block, below every row.
    expect(
      screen.getByTestId("correlate-filter-builder").lastElementChild,
    ).toBe(footer);
  });

  test("footerAction renders inside the builder footer after Add condition", () => {
    const onAction: MockFunction = getJestMockFunction();
    renderHarness(undefined, undefined, {
      footerAction: (
        <button
          type="button"
          data-testid="footer-action"
          onClick={() => {
            onAction();
          }}
        >
          Correlate
        </button>
      ),
    });

    const builder: HTMLElement = screen.getByTestId("correlate-filter-builder");
    const footer: HTMLElement = screen.getByTestId("correlate-builder-footer");
    const action: HTMLElement = screen.getByTestId("footer-action");

    expect(builder).toContainElement(action);
    expect(footer).toContainElement(action);
    expect(footer.lastElementChild).toBe(action);
    expect(
      screen
        .getByTestId("correlate-add-condition")
        .compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  test("footerAction is shown even when the builder has no conditions", () => {
    renderHarness([], undefined, {
      footerAction: <span data-testid="footer-action">Go</span>,
    });
    expect(screen.getByTestId("correlate-builder-footer")).toContainElement(
      screen.getByTestId("footer-action"),
    );
  });

  test("without footerAction the footer holds only the add button", () => {
    renderHarness();
    const footer: HTMLElement = screen.getByTestId("correlate-builder-footer");
    expect(footer.children).toHaveLength(1);
    expect(within(footer).getAllByRole("button")).toHaveLength(1);
  });

  test("Add condition still appends a default row after existing ones", () => {
    const onChangeSpy: MockFunction = renderHarness([
      observableCondition("alice"),
      severityCondition,
    ]);
    fireEvent.click(screen.getByTestId("correlate-add-condition"));
    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [
        observableCondition("alice"),
        severityCondition,
        getDefaultCorrelationCondition(),
      ],
      "and",
    );
    expect(leadCell(2)).toHaveTextContent(/^AND$/);
  });

  test("Add condition keeps an OR connector", () => {
    const onChangeSpy: MockFunction = renderHarness(
      [observableCondition("a"), observableCondition("b")],
      "or",
    );
    fireEvent.click(screen.getByTestId("correlate-add-condition"));
    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [
        observableCondition("a"),
        observableCondition("b"),
        getDefaultCorrelationCondition(),
      ],
      "or",
    );
    expect(leadCell(2)).toHaveTextContent(/^OR$/);
  });
});

describe("CorrelateFilterBuilder Enter to submit", () => {
  test("Enter in a plain value input calls onSubmit", () => {
    const onSubmit: MockFunction = getJestMockFunction();
    const onChangeSpy: MockFunction = renderHarness(
      [observableCondition("alice")],
      undefined,
      { onSubmit: onSubmit as () => void },
    );

    fireEvent.keyDown(screen.getByTestId("correlate-condition-value-0"), {
      key: "Enter",
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    // Submitting is not an edit.
    expect(onChangeSpy).not.toHaveBeenCalled();
  });

  test("Enter works from any plain row, not only the first", () => {
    const onSubmit: MockFunction = getJestMockFunction();
    renderHarness(
      [observableCondition("a"), observableCondition("b")],
      undefined,
      { onSubmit: onSubmit as () => void },
    );

    fireEvent.keyDown(screen.getByTestId("correlate-condition-value-1"), {
      key: "Enter",
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("other keys do not submit", () => {
    const onSubmit: MockFunction = getJestMockFunction();
    renderHarness([observableCondition("alice")], undefined, {
      onSubmit: onSubmit as () => void,
    });

    const input: HTMLElement = screen.getByTestId(
      "correlate-condition-value-0",
    );
    fireEvent.keyDown(input, { key: "a" });
    fireEvent.keyDown(input, { key: "Tab" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("typing then pressing Enter emits the edit before submitting", () => {
    const onSubmit: MockFunction = getJestMockFunction();
    const onChangeSpy: MockFunction = renderHarness(
      [observableCondition("")],
      undefined,
      { onSubmit: onSubmit as () => void },
    );

    const input: HTMLElement = screen.getByTestId(
      "correlate-condition-value-0",
    );
    fireEvent.change(input, { target: { value: "wb-ubuntu-03" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [observableCondition("wb-ubuntu-03")],
      "and",
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(
      (onChangeSpy.mock.invocationCallOrder[0] as number) <
        (onSubmit.mock.invocationCallOrder[0] as number),
    ).toBe(true);
  });

  test("Enter without onSubmit is harmless", () => {
    const onChangeSpy: MockFunction = renderHarness([
      observableCondition("alice"),
    ]);
    const input: HTMLElement = screen.getByTestId(
      "correlate-condition-value-0",
    );

    expect(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    }).not.toThrow();
    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(input).toHaveValue("alice");
    expect(screen.getByTestId("correlate-condition-row-0")).toBeInTheDocument();
  });

  test("Enter in the event-class autocomplete does not submit", () => {
    const onSubmit: MockFunction = getJestMockFunction();
    renderHarness(
      [
        {
          field: CorrelationFieldKey.EventClass,
          operator: CorrelationOperator.Equals,
          value: "Auth",
        },
      ],
      undefined,
      { onSubmit: onSubmit as () => void },
    );

    /*
     * Enter there belongs to the suggestion menu; only plain text editors
     * are wired to submit.
     */
    fireEvent.keyDown(screen.getByTestId("correlate-condition-value-0"), {
      key: "Enter",
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("CorrelateFilterBuilder translation", () => {
  test("labels go through the translator while AND/OR stay literal", () => {
    mockTranslations["Where"] = "Donde";
    mockTranslations["Match"] = "Coincidir";
    mockTranslations["All conditions"] = "Todas las condiciones";
    mockTranslations["Any condition"] = "Cualquier condicion";
    mockTranslations["AND"] = "Y";
    mockTranslations["OR"] = "O";

    renderHarness([observableCondition("a"), observableCondition("b")]);

    expect(leadCell(0)).toHaveTextContent(/^Donde$/);
    expect(screen.getByText("Coincidir")).toBeInTheDocument();
    expect(screen.getByTestId("correlate-connector-and")).toHaveTextContent(
      /^Todas las condiciones$/,
    );
    expect(screen.getByTestId("correlate-connector-or")).toHaveTextContent(
      /^Cualquier condicion$/,
    );
    expect(leadCell(1)).toHaveTextContent(/^AND$/);

    fireEvent.click(screen.getByTestId("correlate-connector-or"));
    expect(leadCell(1)).toHaveTextContent(/^OR$/);
  });

  test("the empty hint and delete labels are translated, number kept outside", () => {
    mockTranslations["No conditions yet. Add one to start."] =
      "Aun no hay condiciones.";
    mockTranslations["Remove condition"] = "Quitar condicion";

    renderHarness([]);
    expect(screen.getByTestId("correlate-builder-empty")).toHaveTextContent(
      /^Aun no hay condiciones\.$/,
    );

    fireEvent.click(screen.getByTestId("correlate-add-condition"));
    expect(screen.getByTestId("correlate-condition-delete-0")).toHaveAttribute(
      "aria-label",
      "Quitar condicion 1",
    );
  });
});

describe("CorrelateFilterBuilder dark mode", () => {
  /*
   * Only colour classes listed under html.dark in Theme.css follow the
   * theme; anything else stays light on a dark page.
   */
  test("uses only colour classes the dark theme remaps", () => {
    const themeCss: string = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
      "utf8",
    );
    const colourClass: RegExp = /^(bg|border|text)-(white|[a-z]+-\d{2,3})$/;
    const used: Set<string> = new Set<string>();

    const scenarios: Array<{
      conditions: Array<CorrelationCondition>;
      connector: CorrelationConnector;
    }> = [
      { conditions: [], connector: "and" },
      {
        conditions: [
          observableCondition("a"),
          severityCondition,
          {
            field: CorrelationFieldKey.EventClass,
            operator: CorrelationOperator.Equals,
            value: "",
          },
        ],
        connector: "and",
      },
      {
        conditions: [observableCondition("a"), observableCondition("b")],
        connector: "or",
      },
    ];

    for (const scenario of scenarios) {
      renderHarness(scenario.conditions, scenario.connector);
      const builder: HTMLElement = screen.getByTestId(
        "correlate-filter-builder",
      );
      for (const element of [
        builder,
        ...Array.from(builder.querySelectorAll("*")),
      ]) {
        for (const token of classTokens(element)) {
          if (colourClass.test(token)) {
            used.add(token);
          }
        }
      }
      cleanup();
    }

    expect(used.size).toBeGreaterThan(0);
    expect(used.has("bg-amber-50")).toBe(true);
    expect(used.has("text-amber-700")).toBe(true);
    expect(used.has("border-amber-200")).toBe(true);
    expect(used.has("text-amber-600")).toBe(false);
    expect(used.has("border-gray-300")).toBe(true);

    for (const token of Array.from(used)) {
      expect({
        token: token,
        remapped: new RegExp(`\\.${token}(?![\\w-])`).test(themeCss),
      }).toEqual({ token: token, remapped: true });
    }
  });

  test("the connector toggle's ring and hover colours are remapped too", () => {
    const themeCss: string = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
      "utf8",
    );
    const colourClass: RegExp =
      /^(?:([a-z-]+):)?(bg|border|text|ring)-(white|[a-z]+-\d{2,3})$/;
    const trailingShade: RegExp = /\d+$/;
    const used: Set<string> = new Set<string>();

    for (const connector of ["and", "or"] as Array<CorrelationConnector>) {
      renderHarness(
        [observableCondition("a"), observableCondition("b")],
        connector,
      );
      // The connector row is markup the builder owns outright.
      const connectorRow: HTMLElement = screen.getByTestId(
        "correlate-connector-and",
      ).parentElement?.parentElement as HTMLElement;
      for (const element of [
        connectorRow,
        ...Array.from(connectorRow.querySelectorAll("*")),
      ]) {
        for (const token of classTokens(element)) {
          if (colourClass.test(token)) {
            used.add(token);
          }
        }
      }
      cleanup();
    }

    expect(used.has("ring-indigo-200")).toBe(true);
    expect(used.has("ring-amber-200")).toBe(true);
    expect(used.has("hover:bg-gray-50")).toBe(true);

    for (const token of Array.from(used)) {
      /*
       * Plain utilities are remapped as class selectors; variant utilities
       * (hover:, focus-visible:) by exact or shade-prefix attribute selectors.
       */
      const remapped: boolean = token.includes(":")
        ? themeCss.includes(`[class~="${token}"]`) ||
          themeCss.includes(`[class*="${token.replace(trailingShade, "")}"]`)
        : new RegExp(`\\.${token}(?![\\w-])`).test(themeCss);
      expect({ token: token, remapped: remapped }).toEqual({
        token: token,
        remapped: true,
      });
    }
  });

  test("renders no inline colour styles of its own", () => {
    renderHarness([observableCondition("a"), observableCondition("b")]);
    const builder: HTMLElement = screen.getByTestId("correlate-filter-builder");
    for (const element of [
      builder,
      screen.getByTestId("correlate-builder-footer"),
      leadCell(0),
      leadCell(1),
    ]) {
      expect(element.getAttribute("style")).toBeNull();
    }
  });
});
