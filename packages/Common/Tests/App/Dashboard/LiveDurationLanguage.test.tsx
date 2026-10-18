import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

/*
 * The Incidents, Alerts and Scheduled Maintenance lists' Duration (and the
 * event pages' own) in the reader's language. It was English in every
 * language: "1 day, 7 hours" under "Dauer" in a German list. LiveDuration
 * now says its units with the language's own unit names, plurals and list,
 * and "less than a minute" with the Dashboard's own translation.
 */

let language: string = "de";

const TRANSLATIONS: Record<string, Record<string, string>> = {
  de: { "less than a minute": "weniger als eine Minute" },
  ru: { "less than a minute": "меньше минуты" },
};

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        language: language,
        translateString: (value: string | undefined): string | undefined => {
          if (value === undefined) {
            return undefined;
          }

          return TRANSLATIONS[language]?.[value] ?? value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import LiveDuration from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/LiveDuration";

// Declared ten days, twenty-three hours and thirty-one minutes before NOW.
const DECLARED: Date = new Date("2026-10-05T06:04:00.000Z");
const NOW: Date = new Date("2026-10-16T05:35:00.000Z");

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
  cleanup();
  language = "de";
});

describe("a Duration in the reader's language", () => {
  test("German: the two largest units in a list, the whole duration under the pointer", () => {
    render(<LiveDuration startDate={DECLARED} isCompact={true} />);

    const duration: HTMLElement = screen.getByTestId("live-duration");

    expect(duration).toHaveTextContent("10 Tage, 23 Stunden");
    expect(duration).toHaveAttribute(
      "title",
      "10 Tage, 23 Stunden und 31 Minuten",
    );
    expect(duration.textContent).not.toContain("days");
  });

  test("Russian: the language's own plurals", () => {
    language = "ru";

    render(
      <LiveDuration
        startDate={DECLARED}
        endDate={new Date(DECLARED.getTime() + 21 * 24 * 60 * 60 * 1000)}
        isCompact={true}
      />,
    );

    expect(screen.getByTestId("live-duration")).toHaveTextContent("21 день");
  });

  test("under a minute: the Dashboard's own words for it", () => {
    render(
      <LiveDuration
        startDate={DECLARED}
        endDate={new Date(DECLARED.getTime() + 30 * 1000)}
        isCompact={true}
      />,
    );

    expect(screen.getByTestId("live-duration")).toHaveTextContent(
      "weniger als eine Minute",
    );
  });

  test("English is word for word what it was", () => {
    language = "en";

    render(<LiveDuration startDate={DECLARED} isCompact={true} />);

    const duration: HTMLElement = screen.getByTestId("live-duration");

    expect(duration).toHaveTextContent("10 days, 23 hours");
    expect(duration).toHaveAttribute("title", "10 days, 23 hours, 31 minutes");
  });
});
