import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import ActiveFilterChips from "../../../UI/Components/LogsViewer/components/ActiveFilterChips";
import { ActiveFilter as LogsActiveFilter } from "../../../UI/Components/LogsViewer/types";
import {
  ACTIVE_FILTER_ARCHIVED_LABEL,
  ACTIVE_FILTER_NOT_FOUND_LABEL,
  getActiveFilterValueText,
} from "../../../UI/Components/TelemetryViewer/ActiveFilterValueText";
import TelemetryActiveFilterChips, {
  FILTER_CHIP_NOT_FOUND_TEST_ID,
} from "../../../UI/Components/TelemetryViewer/components/TelemetryActiveFilterChips";
import { ActiveFilter } from "../../../UI/Components/TelemetryViewer/types";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * AN EXPLORER'S CHIP NAMING A RECORD THAT IS GONE, OR ARCHIVED (#11213).
 *
 * The logs, traces, exceptions and metrics explorers name what a chip
 * filters by from a read of its id. A chip a link or a saved view brought,
 * naming a service, host or cluster deleted since - or out of the reader's
 * reach - read as its raw id. Marked gone by the explorer once every read
 * of it answered nothing, the chip reads "No longer available", in the
 * reader's words, muted; one naming an archived record reads its name
 * marked archived. Either is taken out as any chip is, by its id, which is
 * what it still filters by.
 */

const DELETED_ID: string = "dead0000-0000-4000-8000-00000000dead";

const english: Translator = dashboardTranslator("en");

afterEach(() => {
  cleanup();
});

describe("getActiveFilterValueText", () => {
  test.each([
    [
      "a chip whose record is gone",
      { displayValue: DELETED_ID, isNotFound: true },
      "No longer available",
    ],
    [
      "gone wins over archived: there is no record to be archived",
      { displayValue: DELETED_ID, isNotFound: true, isArchived: true },
      "No longer available",
    ],
    [
      "an archived record's",
      { displayValue: "checkout-api", isArchived: true },
      "checkout-api (archived)",
    ],
    ["any other", { displayValue: "checkout-api" }, "checkout-api"],
  ])(
    "%s",
    (
      _case: string,
      filter: Parameters<typeof getActiveFilterValueText>[0],
      expected: string,
    ) => {
      expect(getActiveFilterValueText(filter, english)).toBe(expected);
    },
  );

  test("draws the value with the chip's own text for it, archived or not", () => {
    const toText: (value: string) => string = (value: string): string => {
      return `«${value}»`;
    };

    expect(
      getActiveFilterValueText({ displayValue: "api" }, english, toText),
    ).toBe("«api»");
    expect(
      getActiveFilterValueText(
        { displayValue: "api", isArchived: true },
        english,
        toText,
      ),
    ).toBe("«api» (archived)");
  });

  test.each(DASHBOARD_LANGUAGES)(
    "reads in %s's own words, as every picker of the dashboard says it",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const words: Record<string, string> = readDashboardLocale(language);

      expect(words[ACTIVE_FILTER_NOT_FOUND_LABEL]).toBeTruthy();
      expect(words[ACTIVE_FILTER_ARCHIVED_LABEL]).toContain("{{name}}");

      expect(
        getActiveFilterValueText(
          { displayValue: DELETED_ID, isNotFound: true },
          translator,
        ),
      ).toBe(translator.translateText(ACTIVE_FILTER_NOT_FOUND_LABEL));

      const archived: string = getActiveFilterValueText(
        { displayValue: "checkout-api", isArchived: true },
        translator,
      );

      expect(archived).toContain("checkout-api");
      expect(archived).not.toContain("{{name}}");
      // Never the record's id.
      expect(
        getActiveFilterValueText(
          { displayValue: DELETED_ID, isNotFound: true },
          translator,
        ),
      ).not.toContain(DELETED_ID);
    },
  );
});

describe("the traces, exceptions and metrics chip row", () => {
  const goneChip: ActiveFilter = {
    facetKey: "primaryEntityId",
    value: DELETED_ID,
    displayKey: "Service",
    displayValue: DELETED_ID,
    isNotFound: true,
  };

  test("a chip whose record is gone reads No longer available, muted, never its id", () => {
    render(
      <TelemetryActiveFilterChips
        filters={[goneChip]}
        onRemove={jest.fn()}
        onClearAll={jest.fn()}
      />,
    );

    const value: HTMLElement = screen.getByTestId(
      FILTER_CHIP_NOT_FOUND_TEST_ID,
    );

    expect(value).toHaveTextContent("No longer available");
    expect(value.className).toContain("italic");
    expect(screen.queryByText(DELETED_ID)).not.toBeInTheDocument();
    expect(
      screen.getByTitle("Remove Service: No longer available"),
    ).toBeInTheDocument();
  });

  test("it is taken out by its id, as it was saved", () => {
    const onRemove: MockFunction = getJestMockFunction();

    render(
      <TelemetryActiveFilterChips
        filters={[goneChip]}
        onRemove={onRemove as never}
        onClearAll={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle("Remove Service: No longer available"));

    expect(onRemove).toHaveBeenCalledWith("primaryEntityId", DELETED_ID);
  });

  test("a chip naming an archived record reads its name, marked archived", () => {
    render(
      <TelemetryActiveFilterChips
        filters={[
          {
            facetKey: "primaryEntityId",
            value: "a1000000-0000-4000-8000-0000000000a2",
            displayKey: "Service",
            displayValue: "wbkiosk-legacy",
            isArchived: true,
          },
        ]}
        onRemove={jest.fn()}
        onClearAll={jest.fn()}
      />,
    );

    expect(screen.getByText("wbkiosk-legacy (archived)")).toBeInTheDocument();
    expect(
      screen.queryByTestId(FILTER_CHIP_NOT_FOUND_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a chip left as it was reads its value, unmarked", () => {
    render(
      <TelemetryActiveFilterChips
        filters={[{ ...goneChip, isNotFound: undefined }]}
        onRemove={jest.fn()}
        onClearAll={jest.fn()}
      />,
    );

    expect(screen.getByText(DELETED_ID)).toBeInTheDocument();
    expect(
      screen.queryByTestId(FILTER_CHIP_NOT_FOUND_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a locked chip whose record is gone reads so too", () => {
    render(
      <TelemetryActiveFilterChips
        filters={[{ ...goneChip, readOnly: true }]}
        onRemove={jest.fn()}
        onClearAll={jest.fn()}
      />,
    );

    expect(screen.getByText(/No longer available/)).toBeInTheDocument();
    expect(screen.queryByText(DELETED_ID)).not.toBeInTheDocument();
  });
});

describe("the logs chip row", () => {
  const goneChip: LogsActiveFilter = {
    facetKey: "primaryEntityId",
    value: DELETED_ID,
    displayKey: "Service",
    displayValue: DELETED_ID,
    isNotFound: true,
  };

  test("a chip whose record is gone reads No longer available, and is taken out by its id", () => {
    const onRemove: MockFunction = getJestMockFunction();

    render(
      <ActiveFilterChips
        filters={[goneChip]}
        onRemove={onRemove as never}
        onClearAll={jest.fn()}
      />,
    );

    expect(screen.getByTestId(FILTER_CHIP_NOT_FOUND_TEST_ID)).toHaveTextContent(
      "No longer available",
    );
    expect(screen.queryByText(DELETED_ID)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Remove Service: No longer available"));

    expect(onRemove).toHaveBeenCalledWith("primaryEntityId", DELETED_ID);
  });

  test("a chip leaving out a record that is gone reads so in its excluded colours", () => {
    render(
      <ActiveFilterChips
        filters={[{ ...goneChip, facetKey: "!primaryEntityId" }]}
        onRemove={jest.fn()}
        onClearAll={jest.fn()}
      />,
    );

    expect(screen.getByTestId(FILTER_CHIP_NOT_FOUND_TEST_ID)).toHaveTextContent(
      "No longer available",
    );
    expect(screen.getByTestId("excluded-filter-chip")).toBeInTheDocument();
  });

  test("a chip naming an archived host reads its name, marked archived", () => {
    render(
      <ActiveFilterChips
        filters={[
          {
            facetKey: "hostId",
            value: "b2000000-0000-4000-8000-0000000000b2",
            displayKey: "Host",
            displayValue: "db-old",
            isArchived: true,
          },
        ]}
        onRemove={jest.fn()}
        onClearAll={jest.fn()}
      />,
    );

    expect(screen.getByText("db-old (archived)")).toBeInTheDocument();
    expect(
      screen.getByTitle("Remove Host: db-old (archived)"),
    ).toBeInTheDocument();
  });

  test("a locked scope chip whose record is gone reads so, never its id", () => {
    render(
      <ActiveFilterChips
        filters={[{ ...goneChip, readOnly: true }]}
        onRemove={jest.fn()}
        onClearAll={jest.fn()}
      />,
    );

    expect(screen.getByText(/No longer available/)).toBeInTheDocument();
    expect(screen.queryByText(DELETED_ID)).not.toBeInTheDocument();
  });
});
