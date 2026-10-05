import Button, { ButtonStyleType } from "../../../UI/Components/Button/Button";
import Checkbox from "../../../UI/Components/Checkbox/Checkbox";
import Input from "../../../UI/Components/Input/Input";
import Dropdown from "../../../UI/Components/Dropdown/Dropdown";
import SimpleLogViewer from "../../../UI/Components/SimpleLogViewer/SimpleLogViewer";
import ValueTextField from "../../../UI/Components/Workflow/ValuePicker/ValueTextField";
import RecurringViewElement from "../../../UI/Components/Events/RecurringViewElement";
import IpAddressList from "../../../UI/Components/IpAddressList/IpAddressList";
import TelemetryResultTotal, {
  TELEMETRY_RESULT_TOTAL_TEST_ID,
} from "../../../UI/Components/TelemetryViewer/components/TelemetryResultTotal";
import CodeEditor from "../../../UI/Components/CodeEditor/CodeEditor";
import ResetTimeRangeZoomButton, {
  RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
} from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TimeRangeZoomProvider } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { getTimeRangeLabel } from "../../../UI/Components/Date/TimeRangePickerDropdown";
import { getFilterPlaceholder } from "../../../UI/Components/Filters/FilterPlaceholder";
import { getLockedFilterChipAriaLabel } from "../../../UI/Components/TelemetryViewer/components/LockedFilterChip";
import {
  formatHiddenFacetCount,
  getFacetNoMatchesText,
  getHiddenFacetEmptyStateText,
} from "../../../UI/Components/TelemetryViewer/FacetVisibility";
import {
  ResultTotalStatus,
  ResultTotalUnavailableReason,
} from "../../../UI/Utils/Telemetry/ResultTotal";
import { createTranslator } from "../../../UI/Utils/TranslateTemplate";
import IconProp from "../../../Types/Icon/IconProp";
import CodeType from "../../../Types/Code/CodeType";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import PositiveNumber from "../../../Types/PositiveNumber";
import TimeRange from "../../../Types/Time/TimeRange";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * Shared components put their own words, and the text props they are handed,
 * on the screen in the reader's language: an icon button's and a checkbox's
 * accessible names, an error under a field, the sentences with a number or a
 * name in them. Sentences built outside React (a facet's empty state, a
 * locked filter's accessible name) come from the same global instance.
 *
 * German has the sentences; Russian shows that the count picks the plural
 * form (21 and 31 take the "one" form there); French has the words but not
 * the sentences, which then stay wholly English.
 */

const GERMAN: Record<string, string> = {
  // Text props a component translates itself
  Close: "Schließen",
  "Select all rows": "Alle Zeilen auswählen",
  "Name is required.": "Der Name ist erforderlich.",
  Comparison: "Vergleich",
  "Choose a comparison.": "Wählen Sie einen Vergleich.",
  "Workflow Execution Log": "Workflow-Ausführungsprotokoll",
  "Pick a value with { } or type one":
    "Wählen Sie einen Wert mit { } oder geben Sie einen ein",
  "Value to check": "Zu prüfender Wert",
  "Pick or type the value to check.":
    "Wählen oder geben Sie den zu prüfenden Wert ein.",
  // Counts
  "{{count}} Days": "{{count}} Tage",
  "{{count}} Days_one": "{{count}} Tag",
  "{{count}} addresses": "{{count}} Adressen",
  "{{count}} addresses_one": "{{count}} Adresse",
  Public: "Öffentlich",
  "Reachable from the internet.": "Aus dem Internet erreichbar.",
  "{{count}} {{itemsName}}": "{{count}} {{itemsName}}",
  "{{count}} {{itemsName}}_one": "{{count}} {{itemName}}",
  "{{count}}+ {{itemsName}}": "{{count}}+ {{itemsName}}",
  spans: "Spans",
  span: "Span",
  "Too many to count in time. Narrow the time range for an exact total.":
    "Zu viele, um sie rechtzeitig zu zählen. Grenzen Sie den Zeitraum ein.",
  "Counting {{itemsName}}…": "{{itemsName}} werden gezählt…",
  // The code editor's status bar
  "Valid {{language}} · {{count}} lines":
    "Gültiges {{language}} · {{count}} Zeilen",
  "Valid {{language}} · {{count}} lines_one":
    "Gültiges {{language}} · {{count}} Zeile",
  "Ln {{line}}, Col {{column}}": "Z. {{line}}, Sp. {{column}}",
  // Zoom
  "Reset zoom": "Zoom zurücksetzen",
  "Go back to {{range}}, the time range before the zoom":
    "Zurück zu {{range}}, dem Zeitraum vor dem Zoom",
  "Past 30 Minutes": "Letzte 30 Minuten",
  // Telemetry sentences built outside React
  "{{key}}: {{value}}, locked filter": "{{key}}: {{value}}, gesperrter Filter",
  "{{key}}: {{value}}, locked filter matching any of {{count}} values":
    "{{key}}: {{value}}, gesperrter Filter für einen von {{count}} Werten",
  "{{key}}: {{value}}, locked filter matching any of {{count}} values_one":
    "{{key}}: {{value}}, gesperrter Filter für {{count}} Wert",
  Service: "Dienst",
  "{{count}} empty filters hidden": "{{count}} leere Filter ausgeblendet",
  "{{count}} empty filters hidden_one": "{{count}} leerer Filter ausgeblendet",
  "No matches for “{{search}}”": "Keine Treffer für „{{search}}“",
  "No {{itemsName}} in this project": "Keine {{itemsName}} in diesem Projekt",
  "Docker Hosts": "Docker-Hosts",
  "Filter by {{field}}": "Nach {{field}} filtern",
  Monitor: "Monitor",
};

const RUSSIAN: Record<string, string> = {
  "{{count}} Days": "Дней: {{count}}",
  "{{count}} Days_one": "{{count}} день",
  "{{count}} {{itemsName}}": "{{itemsName}}: {{count}}",
  "{{count}} {{itemsName}}_one": "Всего {{count}} {{itemName}}",
  spans: "спанов",
  span: "спан",
  "{{key}}: {{value}}, locked filter matching any of {{count}} values":
    "{{key}}: {{value}}, закреплённый фильтр, значений: {{count}}",
  "{{key}}: {{value}}, locked filter matching any of {{count}} values_one":
    "{{key}}: {{value}}, закреплённый фильтр, {{count}} значение",
};

// The words without the sentences they go in.
const FRENCH_WORDS_ONLY: Record<string, string> = {
  "Past 30 Minutes": "30 dernières minutes",
  "Docker Hosts": "Hôtes Docker",
  Service: "Service",
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: false,
    resources: {
      de: { translation: GERMAN },
      ru: { translation: RUSSIAN },
      fr: { translation: FRENCH_WORDS_ONLY },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("de");
});

afterEach(() => {
  cleanup();
});

type NoopFunction = () => void;

const noop: NoopFunction = (): void => {};

describe("text props a shared component translates itself", () => {
  test("an icon button's and a checkbox's accessible names", () => {
    render(
      <>
        <Button
          buttonStyle={ButtonStyleType.ICON}
          icon={IconProp.Close}
          ariaLabel="Close"
          onClick={noop}
        />
        <Checkbox ariaLabel="Select all rows" hoverText="Select all rows" />
      </>,
    );

    expect(
      screen.getByRole("button", { name: "Schließen" }),
    ).toBeInTheDocument();

    const checkbox: HTMLElement = screen.getByRole("checkbox", {
      name: "Alle Zeilen auswählen",
    });

    expect(checkbox).toHaveAttribute("title", "Alle Zeilen auswählen");
  });

  test("the error under a box and a dropdown, and the dropdown's name", () => {
    render(
      <>
        <Input value="" error="Name is required." />
        <Dropdown
          options={[{ label: "contains", value: "contains" }]}
          ariaLabel="Comparison"
          error="Choose a comparison."
        />
      </>,
    );

    expect(screen.getByText("Der Name ist erforderlich.")).toBeInTheDocument();
    expect(screen.getByText("Wählen Sie einen Vergleich.")).toBeInTheDocument();
    expect(screen.getByLabelText("Vergleich")).toBeInTheDocument();
  });

  test("a log's heading", () => {
    render(
      <SimpleLogViewer title="Workflow Execution Log">
        {"Step 1 ran."}
      </SimpleLogViewer>,
    );

    expect(
      screen.getByText("Workflow-Ausführungsprotokoll"),
    ).toBeInTheDocument();
  });

  test("a workflow value box's placeholder, name and error", () => {
    render(
      <ValueTextField
        value=""
        onChange={noop}
        multiline={false}
        placeholder="Pick a value with { } or type one"
        ariaLabel="Value to check"
        error="Pick or type the value to check."
      />,
    );

    expect(
      screen.getByText(
        "Wählen Sie einen Wert mit { } oder geben Sie einen ein",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Zu prüfender Wert")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Wählen oder geben Sie den zu prüfenden Wert ein.",
    );
  });
});

describe("a count picks the plural form", () => {
  type MakeRecurringFunction = (days: number) => Recurring;

  const everyDays: MakeRecurringFunction = (days: number): Recurring => {
    const recurring: Recurring = new Recurring();
    recurring.intervalType = EventInterval.Day;
    recurring.intervalCount = new PositiveNumber(days);
    return recurring;
  };

  test("a rotation's interval", async () => {
    const { rerender } = render(<RecurringViewElement value={everyDays(1)} />);

    expect(screen.getByText("1 Tag")).toBeInTheDocument();

    rerender(<RecurringViewElement value={everyDays(2)} />);

    expect(screen.getByText("2 Tage")).toBeInTheDocument();

    cleanup();
    await i18next.changeLanguage("ru");

    render(<RecurringViewElement value={everyDays(21)} />);

    expect(screen.getByText("21 день")).toBeInTheDocument();
  });

  test("an address list's sections", () => {
    render(<IpAddressList text="8.8.8.8, 1.1.1.1" />);

    expect(screen.getByText("Öffentlich")).toBeInTheDocument();
    expect(screen.getByText("2 Adressen")).toBeInTheDocument();
    expect(
      screen.getByText("Aus dem Internet erreichbar."),
    ).toBeInTheDocument();
  });

  test("a result total: the number written the reader's way, in its sentence", () => {
    const { rerender } = render(
      <TelemetryResultTotal
        total={{ status: ResultTotalStatus.Exact, count: 1234 }}
        rowsThroughPage={50}
        itemLabel="spans"
      />,
    );

    expect(
      screen.getByTestId(TELEMETRY_RESULT_TOTAL_TEST_ID),
    ).toHaveTextContent(/^1\.234 Spans$/);

    rerender(
      <TelemetryResultTotal
        total={{ status: ResultTotalStatus.Exact, count: 1 }}
        rowsThroughPage={1}
        itemLabel="spans"
      />,
    );

    expect(
      screen.getByTestId(TELEMETRY_RESULT_TOTAL_TEST_ID),
    ).toHaveTextContent(/^1 Span$/);

    rerender(
      <TelemetryResultTotal
        total={{
          status: ResultTotalStatus.Unavailable,
          unavailableReason: ResultTotalUnavailableReason.TooManyToCount,
        }}
        rowsThroughPage={50}
        itemLabel="spans"
      />,
    );

    expect(
      screen.getByTestId(TELEMETRY_RESULT_TOTAL_TEST_ID),
    ).toHaveTextContent(
      "50+ Spans · Zu viele, um sie rechtzeitig zu zählen. Grenzen Sie den Zeitraum ein.",
    );

    rerender(
      <TelemetryResultTotal
        total={{ status: ResultTotalStatus.Counting }}
        rowsThroughPage={0}
        itemLabel="spans"
      />,
    );

    expect(
      screen.getByTestId(TELEMETRY_RESULT_TOTAL_TEST_ID),
    ).toHaveTextContent("Spans werden gezählt…");
  });

  test("21 takes the 'one' form in Russian, 5 its general form", async () => {
    await i18next.changeLanguage("ru");

    const { rerender } = render(
      <TelemetryResultTotal
        total={{ status: ResultTotalStatus.Exact, count: 21 }}
        rowsThroughPage={21}
        itemLabel="spans"
      />,
    );

    expect(
      screen.getByTestId(TELEMETRY_RESULT_TOTAL_TEST_ID),
    ).toHaveTextContent(/^Всего 21 спан$/);

    rerender(
      <TelemetryResultTotal
        total={{ status: ResultTotalStatus.Exact, count: 5 }}
        rowsThroughPage={5}
        itemLabel="spans"
      />,
    );

    expect(
      screen.getByTestId(TELEMETRY_RESULT_TOTAL_TEST_ID),
    ).toHaveTextContent(/^спанов: 5$/);
  });

  test("the code editor's status bar", () => {
    render(<CodeEditor type={CodeType.JSON} value={'{\n  "a": 1\n}'} />);

    expect(screen.getByTestId("code-editor-status")).toHaveTextContent(
      /^Gültiges JSON · 3 Zeilen$/,
    );
    expect(screen.getByTestId("code-editor-cursor")).toHaveTextContent(
      "Z. 1, Sp. 1",
    );
  });
});

describe("a name in the middle of a sentence", () => {
  type RenderResetFunction = () => void;

  const renderReset: RenderResetFunction = (): void => {
    render(
      <TimeRangeZoomProvider
        zoom={{
          isZoomed: true,
          rangeBeforeZoom: {
            range: TimeRange.PAST_THIRTY_MINS,
            startAndEndDate: new InBetween<Date>(
              new Date("2026-09-20T00:00:00.000Z"),
              new Date("2026-09-20T00:30:00.000Z"),
            ),
          },
          zoomToTimeRange: noop,
          resetZoom: noop,
        }}
      >
        <ResetTimeRangeZoomButton />
      </TimeRangeZoomProvider>,
    );
  };

  test("the range a zoom goes back to, by the name the picker gives it", () => {
    expect(getTimeRangeLabel(TimeRange.PAST_THIRTY_MINS)).toBe(
      "Past 30 Minutes",
    );
    // A range with no preset is named by itself.
    expect(getTimeRangeLabel(TimeRange.CUSTOM)).toBe(TimeRange.CUSTOM);

    renderReset();

    const reset: HTMLElement = screen.getByTestId(
      RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
    );

    expect(reset).toHaveAccessibleName("Zoom zurücksetzen");
    expect(reset).toHaveAttribute(
      "title",
      "Zurück zu Letzte 30 Minuten, dem Zeitraum vor dem Zoom",
    );
  });

  test("a locale with the range's name but not the sentence keeps it all English", async () => {
    await i18next.changeLanguage("fr");

    renderReset();

    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toHaveAttribute(
      "title",
      "Go back to Past 30 Minutes, the time range before the zoom",
    );
  });

  test("a locked filter's accessible name, with and without a scope", async () => {
    expect(getLockedFilterChipAriaLabel("Service", "checkout")).toBe(
      "Dienst: checkout, gesperrter Filter",
    );
    expect(getLockedFilterChipAriaLabel("Service", "checkout", false, 1)).toBe(
      "Dienst: checkout, gesperrter Filter für 1 Wert",
    );
    expect(getLockedFilterChipAriaLabel("Service", "checkout", false, 3)).toBe(
      "Dienst: checkout, gesperrter Filter für einen von 3 Werten",
    );

    await i18next.changeLanguage("ru");

    expect(getLockedFilterChipAriaLabel("Service", "checkout", false, 31)).toBe(
      "Service: checkout, закреплённый фильтр, 31 значение",
    );
  });

  test("a facet's empty states", async () => {
    expect(formatHiddenFacetCount(1)).toBe("1 leerer Filter ausgeblendet");
    expect(formatHiddenFacetCount(4)).toBe("4 leere Filter ausgeblendet");
    expect(getFacetNoMatchesText("  checkout ")).toBe(
      "Keine Treffer für „checkout“",
    );
    expect(getHiddenFacetEmptyStateText("Docker Hosts")).toBe(
      "Keine Docker-Hosts in diesem Projekt",
    );

    await i18next.changeLanguage("fr");

    // The noun alone is not enough: without the sentence it stays English.
    expect(getHiddenFacetEmptyStateText("Docker Hosts")).toBe(
      "No Docker Hosts in this project",
    );
  });
});

describe("a filter's placeholder", () => {
  const GERMAN_LOOKUP: (text: string) => string | undefined = (
    text: string,
  ): string | undefined => {
    return GERMAN[text];
  };

  test("the field's name goes into the reader's sentence", () => {
    expect(
      getFilterPlaceholder(createTranslator(GERMAN_LOOKUP, "de"), "Monitor"),
    ).toBe("Nach Monitor filtern");
  });

  test("English, filled straight in, where nothing is set up", () => {
    expect(getFilterPlaceholder(createTranslator(undefined), "Monitor")).toBe(
      "Filter by Monitor",
    );
  });
});
