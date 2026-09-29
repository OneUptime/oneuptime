import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import CorrelateFilterChips from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateFilterChips";
import {
  CorrelationCondition,
  CorrelationConnector,
  CorrelationFieldKey,
  CorrelationFilter,
  CorrelationOperator,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/SecurityEventCorrelation";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";

/*
 * The applied-filter chips on Security Events → Correlate: one removable
 * chip per condition with the AND/OR connector spelled out between them, a
 * long value capped with its full text on hover, 24px remove targets, and
 * "Clear all" whenever anything is applied.
 */

/*
 * Identity translations by default; tests register entries to prove which
 * strings go through useTranslateValue, and every key asked for is recorded.
 */
const mockTranslations: Record<string, string> = {};
const mockTranslationKeys: Array<string> = [];

/*
 * When set, lookups go to this real i18next instance (with the options the
 * component passed) instead of the table above.
 */
const mockI18n: { current: i18n | null } = { current: null };

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: Record<string, unknown>): string => {
          mockTranslationKeys.push(key);
          if (mockI18n.current) {
            return String(
              options
                ? mockI18n.current.t(key, options)
                : mockI18n.current.t(key),
            );
          }
          return mockTranslations[key] ?? key;
        },
      };
    },
  };
});

const DASHBOARD_LOCALES: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

// The flat, English-keyed strings of a Dashboard locale file.
function readFlatLocale(language: string): Record<string, string> {
  const parsed: Record<string, unknown> = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") {
      flat[key] = value;
    }
  }
  return flat;
}

interface RenderResult {
  onRemoveCondition: MockFunction;
  onClearAll: MockFunction;
  container: HTMLElement;
  rerenderWith: (filter: CorrelationFilter) => void;
}

function renderChips(
  conditions: Array<CorrelationCondition>,
  connector: CorrelationConnector = "and",
): RenderResult {
  const onRemoveCondition: MockFunction = getJestMockFunction();
  const onClearAll: MockFunction = getJestMockFunction();

  const buildElement: (filter: CorrelationFilter) => React.ReactElement = (
    filter: CorrelationFilter,
  ): React.ReactElement => {
    return (
      <CorrelateFilterChips
        filter={filter}
        onRemoveCondition={onRemoveCondition as (index: number) => void}
        onClearAll={onClearAll as () => void}
      />
    );
  };

  const { container, rerender } = render(
    buildElement({ conditions, connector }),
  );

  return {
    onRemoveCondition,
    onClearAll,
    container,
    rerenderWith: (filter: CorrelationFilter): void => {
      rerender(buildElement(filter));
    },
  };
}

function classTokens(element: Element): Array<string> {
  return (element.getAttribute("class") || "")
    .split(/\s+/)
    .filter((token: string): boolean => {
      return token.length > 0;
    });
}

/*
 * Elements whose OWN text (ignoring descendants) equals the given string, so
 * a connector is counted once rather than once per ancestor.
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

function valueSpan(chipIndex: number): HTMLElement {
  const chip: HTMLElement = screen.getByTestId(
    `correlate-filter-chip-${chipIndex}`,
  );
  const span: HTMLElement | null = chip.querySelector(".font-mono");
  if (!span) {
    throw new Error(`chip ${chipIndex} has no value span`);
  }
  return span;
}

const hostCondition: CorrelationCondition = {
  field: CorrelationFieldKey.PrincipalHost,
  operator: CorrelationOperator.Equals,
  value: "wb-ubuntu-03",
};

const severityCondition: CorrelationCondition = {
  field: CorrelationFieldKey.Severity,
  operator: CorrelationOperator.NotEquals,
  value: OcsfSeverity.High,
};

const messageCondition: CorrelationCondition = {
  field: CorrelationFieldKey.Message,
  operator: CorrelationOperator.Contains,
  value: "failed password",
};

afterEach(() => {
  jest.restoreAllMocks();
  cleanup();
  for (const key of Object.keys(mockTranslations)) {
    delete mockTranslations[key];
  }
  mockTranslationKeys.length = 0;
  mockI18n.current = null;
});

describe("CorrelateFilterChips rendering", () => {
  test("renders nothing for zero conditions", () => {
    const { container, onClearAll, onRemoveCondition } = renderChips([]);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("correlate-filter-chips")).toBeNull();
    expect(screen.queryByTestId("correlate-filter-clear-all")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(onClearAll).not.toHaveBeenCalled();
    expect(onRemoveCondition).not.toHaveBeenCalled();
  });

  test("collapses to nothing when the filter is emptied on rerender", () => {
    const { container, rerenderWith } = renderChips([
      hostCondition,
      severityCondition,
    ]);
    expect(screen.getByTestId("correlate-filter-chips")).toBeInTheDocument();

    rerenderWith({ conditions: [], connector: "and" });
    expect(container).toBeEmptyDOMElement();
  });

  test("renders one chip per condition with field, operator and value", () => {
    renderChips([hostCondition, severityCondition, messageCondition]);

    const chips: HTMLElement = screen.getByTestId("correlate-filter-chips");
    const chipTestId: RegExp = /^correlate-filter-chip-\d+$/;
    const chipElements: Array<Element> = Array.from(
      chips.querySelectorAll("[data-testid]"),
    ).filter((element: Element): boolean => {
      return chipTestId.test(element.getAttribute("data-testid") || "");
    });
    expect(chipElements).toHaveLength(3);
    expect(screen.queryByTestId("correlate-filter-chip-3")).toBeNull();

    const expectations: Array<[string, string, string]> = [
      ["Principal Host", "is", "wb-ubuntu-03"],
      ["Severity", "is not", OcsfSeverity.High],
      ["Message", "contains", "failed password"],
    ];

    expectations.forEach(
      (
        [fieldLabel, operatorLabel, value]: [string, string, string],
        index: number,
      ): void => {
        const chip: HTMLElement = screen.getByTestId(
          `correlate-filter-chip-${index}`,
        );
        expect(elementsWithOwnText(chip, fieldLabel)).toHaveLength(1);
        expect(elementsWithOwnText(chip, operatorLabel)).toHaveLength(1);
        expect(elementsWithOwnText(chip, value)).toHaveLength(1);
        expect(chip).toHaveTextContent(
          `${fieldLabel} ${operatorLabel} ${value}`,
        );
      },
    );
  });

  test("keeps field, operator and value in reading order inside the chip", () => {
    renderChips([messageCondition]);
    const chip: HTMLElement = screen.getByTestId("correlate-filter-chip-0");
    const parts: Array<string> = Array.from(chip.children).map(
      (child: Element): string => {
        return (child.textContent || "").trim();
      },
    );
    expect(parts).toEqual(["Message", "contains", "failed password", ""]);
    expect(chip.lastElementChild).toBe(
      screen.getByTestId("correlate-filter-chip-remove-0"),
    );
  });

  test("the value span is monospaced, truncated and carries its full value as a title", () => {
    renderChips([hostCondition]);
    const span: HTMLElement = valueSpan(0);

    expect(span).toHaveTextContent(/^wb-ubuntu-03$/);
    expect(span).toHaveAttribute("title", "wb-ubuntu-03");
    expect(classTokens(span)).toEqual(
      expect.arrayContaining(["max-w-[16rem]", "truncate", "font-mono"]),
    );
  });

  test("renders values as literal text", () => {
    const value: string = '<img src=x onerror="alert(1)">';
    renderChips([
      {
        field: CorrelationFieldKey.Observable,
        operator: CorrelationOperator.Equals,
        value,
      },
    ]);
    const span: HTMLElement = valueSpan(0);
    expect(span).toHaveTextContent(value);
    expect(span).toHaveAttribute("title", value);
    expect(span.querySelector("img")).toBeNull();
  });
});

describe("CorrelateFilterChips connectors", () => {
  test("AND sits between chips and never before the first", () => {
    renderChips([hostCondition, severityCondition, messageCondition]);
    const chips: HTMLElement = screen.getByTestId("correlate-filter-chips");

    expect(chips.firstElementChild).toBe(
      screen.getByTestId("correlate-filter-chip-0"),
    );
    expect(elementsWithOwnText(chips, "AND")).toHaveLength(2);
    expect(elementsWithOwnText(chips, "OR")).toHaveLength(0);

    for (const index of [0, 1]) {
      const connector: Element | null = screen.getByTestId(
        `correlate-filter-chip-${index}`,
      ).nextElementSibling;
      expect(connector).not.toBeNull();
      expect((connector as Element).textContent).toBe("AND");
      expect((connector as Element).nextElementSibling).toBe(
        screen.getByTestId(`correlate-filter-chip-${index + 1}`),
      );
    }
  });

  test("OR chains spell OR between chips", () => {
    renderChips([hostCondition, severityCondition, messageCondition], "or");
    const chips: HTMLElement = screen.getByTestId("correlate-filter-chips");

    expect(elementsWithOwnText(chips, "OR")).toHaveLength(2);
    expect(elementsWithOwnText(chips, "AND")).toHaveLength(0);
    expect(chips.firstElementChild).toBe(
      screen.getByTestId("correlate-filter-chip-0"),
    );
  });

  test("a single chip has no connector at all", () => {
    renderChips([hostCondition]);
    const chips: HTMLElement = screen.getByTestId("correlate-filter-chips");
    expect(elementsWithOwnText(chips, "AND")).toHaveLength(0);
    expect(elementsWithOwnText(chips, "OR")).toHaveLength(0);
  });

  test("the connector is readable text-xs semibold, tinted by the connector", () => {
    renderChips([hostCondition, severityCondition]);
    const andConnector: Element = elementsWithOwnText(
      screen.getByTestId("correlate-filter-chips"),
      "AND",
    )[0] as Element;
    expect(classTokens(andConnector)).toEqual(
      expect.arrayContaining(["text-xs", "font-semibold", "text-indigo-600"]),
    );
    expect(classTokens(andConnector)).not.toContain("text-[10px]");
    expect(classTokens(andConnector)).not.toContain("font-bold");
    cleanup();

    renderChips([hostCondition, severityCondition], "or");
    const orConnector: Element = elementsWithOwnText(
      screen.getByTestId("correlate-filter-chips"),
      "OR",
    )[0] as Element;
    expect(classTokens(orConnector)).toEqual(
      expect.arrayContaining(["text-xs", "font-semibold", "text-amber-700"]),
    );
    expect(classTokens(orConnector)).not.toContain("text-indigo-600");
    expect(classTokens(andConnector)).not.toContain("text-amber-700");
  });

  /*
   * amber-600 on white is under 3:1; the OR connector is small bold text,
   * so it uses the darker amber-700 (the same shade as the builder's badge).
   */
  test("the OR connector uses the higher-contrast amber-700, not amber-600", () => {
    renderChips([hostCondition, severityCondition, messageCondition], "or");
    const connectors: Array<Element> = elementsWithOwnText(
      screen.getByTestId("correlate-filter-chips"),
      "OR",
    );

    expect(connectors).toHaveLength(2);
    for (const connector of connectors) {
      expect(classTokens(connector)).toContain("text-amber-700");
      expect(classTokens(connector)).not.toContain("text-amber-600");
      expect(
        classTokens(connector).filter((token: string): boolean => {
          return token.startsWith("text-amber-");
        }),
      ).toEqual(["text-amber-700"]);
    }
  });

  test("rerendering from AND to OR retints every connector", () => {
    const { rerenderWith } = renderChips([
      hostCondition,
      severityCondition,
      messageCondition,
    ]);
    const chips: HTMLElement = screen.getByTestId("correlate-filter-chips");

    for (const connector of elementsWithOwnText(chips, "AND")) {
      expect(classTokens(connector)).toContain("text-indigo-600");
    }

    rerenderWith({
      conditions: [hostCondition, severityCondition, messageCondition],
      connector: "or",
    });

    expect(elementsWithOwnText(chips, "AND")).toHaveLength(0);
    for (const connector of elementsWithOwnText(chips, "OR")) {
      expect(classTokens(connector)).toContain("text-amber-700");
      expect(classTokens(connector)).not.toContain("text-indigo-600");
    }
  });

  test("AND and OR are not translated", () => {
    mockTranslations["AND"] = "Y";
    mockTranslations["OR"] = "O";
    renderChips([hostCondition, severityCondition]);
    expect(
      elementsWithOwnText(screen.getByTestId("correlate-filter-chips"), "AND"),
    ).toHaveLength(1);
    expect(screen.queryByText("Y")).toBeNull();
    expect(mockTranslationKeys).not.toContain("AND");
    expect(mockTranslationKeys).not.toContain("OR");
  });
});

describe("CorrelateFilterChips remove", () => {
  test("clicking a remove button reports that chip's index", () => {
    const { onRemoveCondition, onClearAll } = renderChips([
      hostCondition,
      severityCondition,
      messageCondition,
    ]);

    fireEvent.click(screen.getByTestId("correlate-filter-chip-remove-1"));
    expect(onRemoveCondition).toHaveBeenCalledTimes(1);
    expect(onRemoveCondition).toHaveBeenLastCalledWith(1);

    fireEvent.click(screen.getByTestId("correlate-filter-chip-remove-0"));
    expect(onRemoveCondition).toHaveBeenLastCalledWith(0);

    fireEvent.click(screen.getByTestId("correlate-filter-chip-remove-2"));
    expect(onRemoveCondition).toHaveBeenLastCalledWith(2);

    expect(onRemoveCondition).toHaveBeenCalledTimes(3);
    expect(onClearAll).not.toHaveBeenCalled();
  });

  test("remove buttons are named with their 1-based condition number", () => {
    renderChips([hostCondition, severityCondition]);

    const first: HTMLElement = screen.getByTestId(
      "correlate-filter-chip-remove-0",
    );
    const second: HTMLElement = screen.getByTestId(
      "correlate-filter-chip-remove-1",
    );
    expect(first).toHaveAttribute("aria-label", "Remove condition 1");
    expect(second).toHaveAttribute("aria-label", "Remove condition 2");
    expect(screen.getByRole("button", { name: "Remove condition 2" })).toBe(
      second,
    );
  });

  test("remove buttons are 24px targets with a 12px icon", () => {
    renderChips([hostCondition]);
    const button: HTMLElement = screen.getByTestId(
      "correlate-filter-chip-remove-0",
    );

    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(classTokens(button)).toEqual(
      expect.arrayContaining([
        "h-6",
        "w-6",
        "shrink-0",
        "items-center",
        "justify-center",
        "text-indigo-500",
        "hover:bg-indigo-100",
        "hover:text-indigo-700",
      ]),
    );
    expect(classTokens(button)).not.toContain("h-4");
    expect(classTokens(button)).not.toContain("w-4");

    const icon: SVGElement | null = button.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(classTokens(icon as SVGElement)).toEqual(
      expect.arrayContaining(["h-3", "w-3"]),
    );
    expect(classTokens(icon as SVGElement)).not.toContain("h-2.5");
    // The icon is decorative; the button's aria-label names it.
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  test("remove buttons show a keyboard focus ring", () => {
    renderChips([hostCondition]);
    expect(
      classTokens(screen.getByTestId("correlate-filter-chip-remove-0")),
    ).toEqual(
      expect.arrayContaining([
        "focus-visible:ring-2",
        "focus-visible:ring-indigo-500",
      ]),
    );
  });

  test("the remove label is translated with the number composed outside", () => {
    mockTranslations["Remove condition"] = "Quitar condicion";
    renderChips([hostCondition, severityCondition]);

    expect(
      screen.getByTestId("correlate-filter-chip-remove-1"),
    ).toHaveAttribute("aria-label", "Quitar condicion 2");
    expect(mockTranslationKeys).toContain("Remove condition");
    const numberedKey: RegExp = /^Remove condition \d/;
    expect(
      mockTranslationKeys.some((key: string): boolean => {
        return numberedKey.test(key);
      }),
    ).toBe(false);
  });
});

describe("CorrelateFilterChips clear all", () => {
  test("Clear all shows with a single condition and calls onClearAll", () => {
    const { onClearAll, onRemoveCondition } = renderChips([hostCondition]);
    const clearAll: HTMLElement = screen.getByTestId(
      "correlate-filter-clear-all",
    );

    expect(clearAll.tagName).toBe("BUTTON");
    expect(clearAll).toHaveAttribute("type", "button");
    expect(clearAll).toHaveTextContent(/^Clear all$/);
    expect(screen.getByRole("button", { name: "Clear all" })).toBe(clearAll);

    fireEvent.click(clearAll);
    expect(onClearAll).toHaveBeenCalledTimes(1);
    expect(onRemoveCondition).not.toHaveBeenCalled();
  });

  test("Clear all shows with several conditions, after the last chip", () => {
    renderChips([hostCondition, severityCondition, messageCondition], "or");
    const chips: HTMLElement = screen.getByTestId("correlate-filter-chips");
    const clearAll: HTMLElement = screen.getByTestId(
      "correlate-filter-clear-all",
    );

    expect(screen.getAllByTestId("correlate-filter-clear-all")).toHaveLength(1);
    expect(chips.lastElementChild).toBe(clearAll);
    expect(clearAll.previousElementSibling).toBe(
      screen.getByTestId("correlate-filter-chip-2"),
    );
  });

  test("Clear all is translated", () => {
    mockTranslations["Clear all"] = "Borrar todo";
    renderChips([hostCondition]);
    expect(screen.getByTestId("correlate-filter-clear-all")).toHaveTextContent(
      /^Borrar todo$/,
    );
    expect(mockTranslationKeys).toContain("Clear all");
  });
});

/*
 * The chip body now looks its field and operator words up the same way the
 * builder's dropdowns do, so a translated page shows the same words in the
 * builder and in the applied filter. Values are data and stay as typed.
 */
describe("CorrelateFilterChips field and operator translation", () => {
  const GERMAN: Record<string, string> = {
    "Principal Host": "Hauptrechner",
    is: "ist",
    Severity: "Schweregrad",
    "is not": "ist nicht",
    Message: "Nachricht",
    contains: "enthält",
    // A value that happens to match a key must still not be translated.
    High: "Hoch",
    "wb-ubuntu-03": "übersetzt",
    "failed password": "falsches Passwort",
  };

  function applyGermanLabels(): void {
    for (const [key, value] of Object.entries(GERMAN)) {
      mockTranslations[key] = value;
    }
  }

  test("translates the field and operator words in every chip", () => {
    applyGermanLabels();
    renderChips([hostCondition, severityCondition, messageCondition]);

    const expectations: Array<[string, string, string]> = [
      ["Hauptrechner", "ist", "wb-ubuntu-03"],
      ["Schweregrad", "ist nicht", OcsfSeverity.High],
      ["Nachricht", "enthält", "failed password"],
    ];

    expectations.forEach(
      (
        [fieldLabel, operatorLabel, value]: [string, string, string],
        index: number,
      ): void => {
        const chip: HTMLElement = screen.getByTestId(
          `correlate-filter-chip-${index}`,
        );
        const parts: Array<string> = Array.from(chip.children).map(
          (child: Element): string => {
            return child.textContent || "";
          },
        );

        expect(parts).toEqual([fieldLabel, operatorLabel, value, ""]);
        expect(chip).toHaveTextContent(
          `${fieldLabel} ${operatorLabel} ${value}`,
        );
      },
    );
  });

  test("looks the labels up by their English text", () => {
    renderChips([hostCondition, severityCondition, messageCondition]);

    expect(mockTranslationKeys).toEqual(
      expect.arrayContaining([
        "Principal Host",
        "is",
        "Severity",
        "is not",
        "Message",
        "contains",
      ]),
    );
    // Identity lookups leave the English words in place.
    expect(screen.getByTestId("correlate-filter-chip-1")).toHaveTextContent(
      /^Severity is not High$/,
    );
  });

  test("never translates the condition values or their titles", () => {
    applyGermanLabels();
    renderChips([hostCondition, severityCondition, messageCondition]);

    expect(mockTranslationKeys).not.toContain("wb-ubuntu-03");
    expect(mockTranslationKeys).not.toContain("High");
    expect(mockTranslationKeys).not.toContain("failed password");
    expect(valueSpan(0)).toHaveTextContent(/^wb-ubuntu-03$/);
    expect(valueSpan(0)).toHaveAttribute("title", "wb-ubuntu-03");
    expect(valueSpan(1)).toHaveTextContent(/^High$/);
    expect(valueSpan(2)).toHaveAttribute("title", "failed password");
    expect(screen.queryByText("Hoch")).toBeNull();
    expect(screen.queryByText("übersetzt")).toBeNull();
    expect(screen.queryByText("falsches Passwort")).toBeNull();
  });

  test("keeps AND/OR literal while the labels around them translate", () => {
    applyGermanLabels();
    mockTranslations["AND"] = "UND";
    mockTranslations["OR"] = "ODER";
    renderChips([hostCondition, severityCondition], "or");

    const chips: HTMLElement = screen.getByTestId("correlate-filter-chips");

    expect(elementsWithOwnText(chips, "OR")).toHaveLength(1);
    expect(elementsWithOwnText(chips, "ODER")).toHaveLength(0);
    expect(mockTranslationKeys).not.toContain("OR");
    expect(screen.getByTestId("correlate-filter-chip-0")).toHaveTextContent(
      /^Hauptrechner ist wb-ubuntu-03$/,
    );
    expect(screen.getByTestId("correlate-filter-chip-1")).toHaveTextContent(
      /^Schweregrad ist nicht High$/,
    );
  });

  test("a label with no translation falls back to English", () => {
    mockTranslations["is"] = "ist";
    renderChips([hostCondition]);

    expect(screen.getByTestId("correlate-filter-chip-0")).toHaveTextContent(
      /^Principal Host ist wb-ubuntu-03$/,
    );
  });

  test("the translated labels keep their styling and shrink rules", () => {
    applyGermanLabels();
    renderChips([severityCondition]);

    const chip: HTMLElement = screen.getByTestId("correlate-filter-chip-0");
    const fieldSpan: Element = chip.children[0] as Element;
    const operatorSpan: Element = chip.children[1] as Element;

    expect(fieldSpan.textContent).toBe("Schweregrad");
    expect(classTokens(fieldSpan)).toEqual(
      expect.arrayContaining(["shrink-0", "font-medium", "text-indigo-500"]),
    );
    expect(operatorSpan.textContent).toBe("ist nicht");
    expect(classTokens(operatorSpan)).toEqual(
      expect.arrayContaining(["shrink-0", "italic"]),
    );
  });

  /*
   * End to end with the shipped German locale, through a real i18next
   * instance and the flat-key options useTranslateValue passes. Only
   * labels the locale already carries are asserted here.
   */
  test("uses the Dashboard's German locale for the labels it carries", async () => {
    const german: i18n = createInstance();
    await german.init({
      lng: "de",
      fallbackLng: "de",
      resources: { de: { translation: readFlatLocale("de") } },
      interpolation: { escapeValue: false },
    });
    mockI18n.current = german;

    const carried: Array<CorrelationCondition> = [
      {
        field: CorrelationFieldKey.Observable,
        operator: CorrelationOperator.Equals,
        value: "10.0.0.5",
      },
      {
        field: CorrelationFieldKey.Severity,
        operator: CorrelationOperator.Equals,
        value: OcsfSeverity.High,
      },
      messageCondition,
      {
        field: CorrelationFieldKey.RuleName,
        operator: CorrelationOperator.StartsWith,
        value: "ssh",
      },
    ];

    renderChips(carried);

    const locale: Record<string, string> = readFlatLocale("de");
    const expected: Array<string> = [
      `${locale["Observable"]} ${locale["is"]} 10.0.0.5`,
      `${locale["Severity"]} ${locale["is"]} High`,
      `${locale["Message"]} ${locale["contains"]} failed password`,
      `${locale["Rule Name"]} ${locale["starts with"]} ssh`,
    ];

    expected.forEach((text: string, index: number): void => {
      expect(text).not.toContain("undefined");
      expect(
        screen.getByTestId(`correlate-filter-chip-${index}`),
      ).toHaveTextContent(text);
    });
    // Sanity: the locale really differs from English for these words.
    expect(locale["Severity"]).not.toBe("Severity");
    expect(locale["contains"]).not.toBe("contains");
  });
});

describe("CorrelateFilterChips long values", () => {
  test("a very long value stays capped instead of stretching the row", () => {
    const longValue: string = `${"a1b2c3d4".repeat(64)}.example.internal`;
    renderChips([
      {
        field: CorrelationFieldKey.Observable,
        operator: CorrelationOperator.Contains,
        value: longValue,
      },
      hostCondition,
    ]);

    const chips: HTMLElement = screen.getByTestId("correlate-filter-chips");
    const chip: HTMLElement = screen.getByTestId("correlate-filter-chip-0");
    const span: HTMLElement = valueSpan(0);

    // The wrapper wraps chips onto new lines and may shrink in a flex parent.
    expect(classTokens(chips)).toEqual(
      expect.arrayContaining(["flex", "flex-wrap", "min-w-0"]),
    );
    // The chip never grows past its line.
    expect(classTokens(chip)).toEqual(
      expect.arrayContaining(["inline-flex", "max-w-full", "items-center"]),
    );
    // The value is the part that gives way, with an ellipsis.
    expect(classTokens(span)).toEqual(
      expect.arrayContaining(["min-w-0", "max-w-[16rem]", "truncate"]),
    );
    // Field, operator and remove button keep their size.
    const fieldSpan: Element = chip.children[0] as Element;
    const operatorSpan: Element = chip.children[1] as Element;
    expect(classTokens(fieldSpan)).toContain("shrink-0");
    expect(classTokens(operatorSpan)).toContain("shrink-0");
    expect(
      classTokens(screen.getByTestId("correlate-filter-chip-remove-0")),
    ).toContain("shrink-0");

    // The DOM keeps the whole value; only CSS shortens it.
    expect(span.textContent).toBe(longValue);
    expect(span).toHaveAttribute("title", longValue);
    // The remove target and the next chip are still there.
    expect(
      screen.getByTestId("correlate-filter-chip-remove-0"),
    ).toBeInTheDocument();
    expect(valueSpan(1)).toHaveTextContent(/^wb-ubuntu-03$/);
  });

  test("renders no inline styles that could override the caps", () => {
    renderChips([hostCondition, severityCondition]);
    const chips: HTMLElement = screen.getByTestId("correlate-filter-chips");
    for (const element of [chips, ...Array.from(chips.querySelectorAll("*"))]) {
      const style: string = element.getAttribute("style") || "";
      expect(style).not.toMatch(/width|white-space|overflow/);
    }
  });
});

describe("CorrelateFilterChips dark mode", () => {
  /*
   * Only colour classes listed under html.dark in Theme.css follow the
   * theme; anything else stays light on a dark page.
   */
  test("uses only colour classes the dark theme remaps", () => {
    const themeCss: string = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
      "utf8",
    );
    const colourClass: RegExp =
      /^(?:([a-z-]+):)?(bg|border|text|ring)-(white|[a-z]+-\d{2,3})$/;
    const trailingShade: RegExp = /\d+$/;
    const used: Set<string> = new Set<string>();

    for (const connector of ["and", "or"] as Array<CorrelationConnector>) {
      renderChips([hostCondition, severityCondition], connector);
      const chips: HTMLElement = screen.getByTestId("correlate-filter-chips");
      for (const element of [
        chips,
        ...Array.from(chips.querySelectorAll("*")),
      ]) {
        for (const token of classTokens(element)) {
          if (colourClass.test(token)) {
            used.add(token);
          }
        }
      }
      cleanup();
    }

    expect(used.has("text-amber-700")).toBe(true);
    expect(used.has("text-amber-600")).toBe(false);
    expect(used.has("text-indigo-600")).toBe(true);
    expect(used.has("bg-indigo-50")).toBe(true);
    expect(used.has("hover:bg-indigo-100")).toBe(true);
    expect(used.has("focus-visible:ring-indigo-500")).toBe(true);

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

  test("the dark theme lightens the OR connector's amber-700", () => {
    const themeCss: string = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
      "utf8",
    );
    // The rule that lists .text-amber-700 must be one scoped to html.dark.
    const ruleStart: number = themeCss.search(
      /html\.dark\s*:is\([^)]*\.text-amber-700(?![\w-])/,
    );

    expect(ruleStart).toBeGreaterThanOrEqual(0);

    const ruleBody: string = themeCss.slice(
      themeCss.indexOf("{", ruleStart),
      themeCss.indexOf("}", ruleStart),
    );

    expect(ruleBody).toMatch(/color:\s*#[0-9a-fA-F]{3,6}/);
  });

  test("hover colours on the remove and clear buttons are theme-aware", () => {
    const themeCss: string = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
      "utf8",
    );
    renderChips([hostCondition]);

    // Theme.css remaps these hover utilities by attribute selector.
    expect(themeCss).toContain('[class~="hover:bg-indigo-100"]');
    expect(themeCss).toContain('[class*="hover:text-indigo-"]');
    expect(themeCss).toContain('[class~="hover:text-gray-700"]');

    expect(
      classTokens(screen.getByTestId("correlate-filter-chip-remove-0")),
    ).toEqual(
      expect.arrayContaining(["hover:bg-indigo-100", "hover:text-indigo-700"]),
    );
    expect(
      classTokens(screen.getByTestId("correlate-filter-clear-all")),
    ).toEqual(expect.arrayContaining(["text-gray-500", "hover:text-gray-700"]));
  });
});
