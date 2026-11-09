import "@testing-library/jest-dom";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import FilterButtons, {
  FilterButtonOption,
} from "../../../UI/Components/FilterButtons/FilterButtons";
import TabElement from "../../../UI/Components/Tabs/Tab";
import FacetSectionHeader from "../../../UI/Components/TelemetryViewer/components/FacetSectionHeader";
import NotificationBell from "../../../UI/Components/HeaderAlert/NotificationBell/NotificationBell";
import { NotificationItem } from "../../../UI/Components/HeaderAlert/NotificationBell/NotificationItem";
import { HeaderAlertType } from "../../../UI/Components/HeaderAlert/HeaderAlert";
import HeaderIconDropdownButton from "../../../UI/Components/Header/HeaderIconDropdownButton";
import ProgressButtonItem from "../../../UI/Components/ProgressButtons/ProgressButtonItem";
import CommandPalette, {
  RESULT_COUNT_SENTENCE,
} from "../../../UI/Components/CommandPalette/CommandPalette";
import { resetPageScrollLockForTesting } from "../../../UI/Utils/PageScrollLock";
import Color from "../../../Types/Color";
import { getNumberLocale } from "../../../Types/DateLanguage";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * THE SHARED COMPONENTS' COUNTS IN THE READER'S DIGITS.
 *
 * A filter button's chip ("Critical 3" - the Recommendations pages' severity
 * filter), a tab's count, a telemetry facet's selected count, the
 * notification bell, a header button's badge and a stepper's step number
 * were drawn as JavaScript writes a number: "3" beside a Persian page's
 * words, where every other count on the page reads "۳" (#6150's review).
 * Each is written the way the reader's language writes a number now -
 * Persian digits in Persian, "1.234" in German - and English reads exactly
 * as it did. The command palette's screen-reader line is one sentence in
 * the reader's language, never a number glued to an English word.
 *
 * Each language here is its own i18next instance, reached through
 * I18nextProvider only, so nothing leaks into the instance other suites in
 * this worker use. The CountsInReaderDigitsGuard holds every shared
 * component to the rule; this suite shows the readers what they get.
 */

const LATIN_DIGIT: RegExp = /[0-9]/;

// The digits Arabic is not written with here: ٠ to ٩.
const ARABIC_INDIC_DIGIT: RegExp = /[\u{0660}-\u{0669}]/u;

const languages: Record<string, i18n> = {};

beforeAll(async () => {
  const resources: Record<string, Record<string, string>> = {
    en: {},
    de: {},
    fa: {
      Critical: "بحرانی",
      Warning: "هشدار",
      [RESULT_COUNT_SENTENCE.other]: "{{count}} نتیجه",
      [`${RESULT_COUNT_SENTENCE.other}_one`]: "{{count}} نتیجه",
    },
    // Arabic as the Dashboard words it (Locales/ar.json).
    ar: {
      Critical: "حرجة",
      Warning: "تحذير",
    },
  };

  for (const language of Object.keys(resources)) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { [language]: { translation: resources[language]! } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    languages[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

function draw(language: string, element: ReactElement): void {
  render(
    <I18nextProvider i18n={languages[language]!}>{element}</I18nextProvider>,
  );
}

/*
 * What a reader of `language` reads for `count`: in its own digits, as
 * Persian is, or in Latin ones where OneUptime writes the language with
 * them, as Arabic is (Locales/ARABIC.md).
 */
function inDigitsOf(language: string, count: number): string {
  return count.toLocaleString(getNumberLocale(language));
}

const SEVERITY_OPTIONS: Array<FilterButtonOption> = [
  { label: "All severities", value: "all" },
  { label: "Critical", value: "critical", badge: 3 },
  { label: "Warning", value: "warning", badge: 1234 },
];

function drawSeverityFilter(language: string): void {
  draw(
    language,
    <FilterButtons
      options={SEVERITY_OPTIONS}
      selectedValue="all"
      onSelect={() => {}}
      dataTestId="severity"
    />,
  );
}

describe("a filter button's count", () => {
  test("on a Persian page a chip's count is in Persian digits beside its Persian word", () => {
    drawSeverityFilter("fa");

    const critical: HTMLElement = screen.getByTestId("severity-critical");

    expect(critical).toHaveTextContent("بحرانی");
    expect(critical).toHaveTextContent("۳");
    expect(critical.textContent).not.toMatch(LATIN_DIGIT);
  });

  test("on a Persian page a large count is grouped the Persian way", () => {
    drawSeverityFilter("fa");

    const warning: HTMLElement = screen.getByTestId("severity-warning");

    expect(warning).toHaveTextContent(inDigitsOf("fa", 1234));
    expect(warning.textContent).not.toMatch(LATIN_DIGIT);
  });

  test("in English a count reads as it did, grouped with a comma", () => {
    drawSeverityFilter("en");

    expect(screen.getByTestId("severity-critical")).toHaveTextContent(
      "Critical3",
    );
    expect(screen.getByTestId("severity-warning")).toHaveTextContent(
      "Warning1,234",
    );
  });

  test("in German a large count is grouped with a point, as German writes it", () => {
    drawSeverityFilter("de");

    expect(screen.getByTestId("severity-warning")).toHaveTextContent("1.234");
  });

  /*
   * Arabic is written with Latin digits here, as its figures in ids, logs
   * and typed values are: a chip beside an Arabic word reads "3", never
   * the Arabic-Indic "٣", and a large count is grouped as Arabic groups it.
   */
  test("on an Arabic page a chip's count is in the Latin digits Arabic is written with", () => {
    drawSeverityFilter("ar");

    const critical: HTMLElement = screen.getByTestId("severity-critical");
    const warning: HTMLElement = screen.getByTestId("severity-warning");

    expect(critical).toHaveTextContent("حرجة");
    expect(critical).toHaveTextContent("3");
    expect(warning).toHaveTextContent(inDigitsOf("ar", 1234));
    expect(`${critical.textContent}${warning.textContent}`).not.toMatch(
      ARABIC_INDIC_DIGIT,
    );
  });

  test("an option with no count, or a count of nothing, has no chip", () => {
    draw(
      "fa",
      <FilterButtons
        options={[
          { label: "All severities", value: "all" },
          { label: "Critical", value: "critical", badge: 0 },
        ]}
        selectedValue="all"
        onSelect={() => {}}
        dataTestId="severity"
      />,
    );

    expect(screen.getByTestId("severity-critical").textContent).toBe("بحرانی");
    expect(screen.getByTestId("severity-all").textContent).toBe(
      "All severities",
    );
  });
});

describe("a tab's count", () => {
  function drawTab(language: string, countBadge: number): void {
    draw(
      language,
      <TabElement
        tab={{ name: "Incidents", countBadge, children: <div /> }}
        isSelected={true}
      />,
    );
  }

  test("in Persian digits on a Persian page", () => {
    drawTab("fa", 12);

    const tab: HTMLElement = screen.getByRole("tab");

    expect(tab).toHaveTextContent("۱۲");
    expect(tab.textContent).not.toMatch(LATIN_DIGIT);
  });

  test("as before in English", () => {
    drawTab("en", 12);

    expect(screen.getByRole("tab")).toHaveTextContent("Incidents12");
  });

  test("a count of nothing is no count", () => {
    drawTab("fa", 0);

    expect(screen.getByRole("tab").textContent).toBe("Incidents");
  });
});

describe("a telemetry facet's selected count", () => {
  function drawFacet(language: string, activeCount: number): void {
    draw(
      language,
      <FacetSectionHeader
        title="Service"
        activeCount={activeCount}
        isExpanded={true}
        onToggle={() => {}}
      />,
    );
  }

  test("in Persian digits on a Persian page", () => {
    drawFacet("fa", 2);

    expect(screen.getByText("۲")).toBeInTheDocument();
    expect(screen.queryByText("2")).toBeNull();
  });

  test("as before in English", () => {
    drawFacet("en", 2);

    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("the notification bell's count", () => {
  function items(count: number): Array<NotificationItem> {
    return Array.from({ length: count }, (_: unknown, index: number) => {
      return {
        id: `item-${index}`,
        icon: IconProp.Alert,
        title: `Item ${index}`,
        count: 1,
        alertType: HeaderAlertType.ERROR,
      };
    });
  }

  function drawBell(language: string, count: number): HTMLElement {
    draw(
      language,
      <div data-testid="bell">
        <NotificationBell items={items(count)} onItemClick={() => {}} />
      </div>,
    );

    return screen.getByTestId("bell");
  }

  test("in Persian digits on a Persian page", () => {
    const bell: HTMLElement = drawBell("fa", 12);

    expect(within(bell).getByText("۱۲")).toBeInTheDocument();
    expect(bell.textContent).not.toMatch(LATIN_DIGIT);
  });

  test("past ninety-nine it reads 99+, in the reader's digits", () => {
    const bell: HTMLElement = drawBell("fa", 100);

    expect(within(bell).getByText(`${inDigitsOf("fa", 99)}+`)).toBeVisible();
    expect(bell.textContent).not.toMatch(LATIN_DIGIT);
  });

  test("in English it reads as before", () => {
    const bell: HTMLElement = drawBell("en", 100);

    expect(within(bell).getByText("99+")).toBeInTheDocument();
  });
});

describe("a header button's badge", () => {
  function drawButton(language: string, badge: number): HTMLElement {
    draw(
      language,
      <div data-testid="header-button">
        <HeaderIconDropdownButton
          name="Notifications"
          icon={IconProp.Notification}
          badge={badge}
          showDropdown={false}
        />
      </div>,
    );

    return screen.getByTestId("header-button");
  }

  test("in Persian digits on a Persian page", () => {
    const button: HTMLElement = drawButton("fa", 4);

    expect(within(button).getByText("۴")).toBeInTheDocument();
    expect(button.textContent).not.toMatch(LATIN_DIGIT);
  });

  test("a count of nothing draws nothing - never a bare 0 beside the button", () => {
    const button: HTMLElement = drawButton("en", 0);

    expect(button.textContent).not.toContain("0");
  });
});

describe("a stepper's step number", () => {
  function drawStep(language: string, isCurrentStep: boolean): void {
    draw(
      language,
      <ol>
        <ProgressButtonItem
          id="step-2"
          title="Monitors"
          color={new Color("#4f46e5")}
          stepCount={2}
          isCurrentStep={isCurrentStep}
          isLastStep={true}
          onClick={() => {}}
        />
      </ol>,
    );
  }

  test.each([true, false])(
    "in Persian digits on a Persian page (current step: %s)",
    (isCurrentStep: boolean) => {
      drawStep("fa", isCurrentStep);

      expect(screen.getByText("۲")).toBeInTheDocument();
      expect(screen.queryByText("2")).toBeNull();
    },
  );

  test("as before in English", () => {
    drawStep("en", true);

    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("the command palette's result count", () => {
  afterEach(() => {
    resetPageScrollLockForTesting();
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  });

  function drawPalette(language: string): void {
    draw(
      language,
      <CommandPalette
        commands={[
          { id: "home", title: "Home", category: "Go", onSelect: () => {} },
          {
            id: "monitors",
            title: "Monitors",
            category: "Go",
            onSelect: () => {},
          },
          {
            id: "incidents",
            title: "Incidents",
            category: "Go",
            onSelect: () => {},
          },
        ]}
        isOpen={true}
        onClose={() => {}}
      />,
    );
  }

  test("a screen reader hears one Persian sentence with a Persian count", async () => {
    drawPalette("fa");

    await act(async () => {
      await Promise.resolve();
    });

    const line: HTMLElement = screen.getByTestId(
      "command-palette-result-count",
    );

    expect(line.textContent).toBe(`${inDigitsOf("fa", 3)} نتیجه`);
    expect(line.textContent).not.toMatch(LATIN_DIGIT);
  });

  test("in English the sentence reads as it did", async () => {
    drawPalette("en");

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("command-palette-result-count").textContent).toBe(
      "3 results",
    );
  });
});
