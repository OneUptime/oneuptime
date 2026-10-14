import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * What a telemetry explorer shows where its results would be when the read
 * behind them did not come back (issue #4707).
 *
 * A search that took too long used to show "Server Error" in place of the
 * whole explorer; the chart and the filter counts just vanished. Pinned here
 * for the one component every explorer uses for it:
 *
 *   - a search stopped at the time limit says it took too long and what to
 *     try, in the reader's language — the API's English sentence is not shown;
 *   - any other failure says what the server said, or a fallback;
 *   - the list, chart and counts each have their own title;
 *   - Try again is one click that runs the read again, and only appears when
 *     there is something to run.
 */

let dictionary: Record<string, string> = {};

/*
 * The arrow wrapper is load bearing: jest.mock is hoisted above the compiled
 * requires, so `dictionary` is read when a component renders, not when the
 * factory runs.
 */
jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined) => {
          return value ? dictionary[value] ?? value : value;
        },
        translateValue: (value: unknown) => {
          return value;
        },
      };
    },
  };
});

import TelemetryLoadErrorMessage, {
  TELEMETRY_LOAD_ERROR_RETRY_TEST_ID,
  TELEMETRY_LOAD_ERROR_TEST_ID,
} from "../../../../UI/Components/TelemetryViewer/components/TelemetryLoadErrorMessage";
import {
  TelemetryLoadError,
  TelemetryLoadErrorKind,
} from "../../../../UI/Utils/Telemetry/TelemetryLoadError";

const TIME_LIMIT_SENTENCE: string =
  "This query took longer than 45 seconds and was stopped before it finished. Try a shorter time range or more specific filters.";

const TIMED_OUT: TelemetryLoadError = {
  kind: TelemetryLoadErrorKind.TimedOut,
  message: TIME_LIMIT_SENTENCE,
};

const FAILED: TelemetryLoadError = {
  kind: TelemetryLoadErrorKind.Failed,
  message: "Invalid attribute key: http.route!",
};

const ADVICE: string =
  "It was stopped before it finished. Try a shorter time range or more specific filters.";

function readDashboardLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "../../../../../App/FeatureSet/Dashboard/src/Locales",
        `${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
}

function message(): HTMLElement {
  return screen.getByTestId(TELEMETRY_LOAD_ERROR_TEST_ID);
}

function retryButton(): HTMLElement | null {
  return screen.queryByTestId(TELEMETRY_LOAD_ERROR_RETRY_TEST_ID);
}

beforeEach(() => {
  dictionary = {};
});

afterEach(() => {
  cleanup();
});

describe("a search that took too long", () => {
  test("says so and what to try, as an alert where the rows go", () => {
    render(<TelemetryLoadErrorMessage error={TIMED_OUT} subject="search" />);

    expect(message()).toHaveAttribute("role", "alert");
    expect(message()).toHaveAttribute("data-kind", "timed-out");
    expect(message()).toHaveTextContent("This search took too long");
    expect(message()).toHaveTextContent(ADVICE);
  });

  test("REGRESSION: never reads as a server error", () => {
    render(<TelemetryLoadErrorMessage error={TIMED_OUT} subject="search" />);

    expect(message().textContent).not.toMatch(/server error/i);
    expect(message().textContent).not.toContain("could not finish");
  });

  test("words it for the reader rather than repeating the API's English sentence", () => {
    render(<TelemetryLoadErrorMessage error={TIMED_OUT} subject="search" />);

    expect(message()).not.toHaveTextContent(TIME_LIMIT_SENTENCE);
  });

  test("a German reader reads it in German, from the Dashboard's de.json", () => {
    dictionary = readDashboardLocale("de");

    render(
      <TelemetryLoadErrorMessage
        error={TIMED_OUT}
        subject="search"
        onRetry={() => {}}
      />,
    );

    expect(message()).toHaveTextContent(
      dictionary["This search took too long"]!,
    );
    expect(message()).toHaveTextContent(dictionary[ADVICE]!);
    expect(retryButton()).toHaveTextContent(dictionary["Try again"]!);
    expect(message()).not.toHaveTextContent("This search took too long");
  });

  test("defaults to the search's wording", () => {
    render(<TelemetryLoadErrorMessage error={TIMED_OUT} />);

    expect(message()).toHaveTextContent("This search took too long");
  });
});

describe("any other failure", () => {
  test("says the search could not finish, in the server's words", () => {
    render(<TelemetryLoadErrorMessage error={FAILED} subject="search" />);

    expect(message()).toHaveAttribute("data-kind", "failed");
    expect(message()).toHaveTextContent("This search could not finish");
    expect(message()).toHaveTextContent("Invalid attribute key: http.route!");
    expect(message()).not.toHaveTextContent("took too long");
  });

  test("says something when the server said nothing", () => {
    render(
      <TelemetryLoadErrorMessage
        error={{ kind: TelemetryLoadErrorKind.Failed, message: "" }}
        subject="search"
      />,
    );

    expect(message()).toHaveTextContent(
      "Something went wrong. Try again in a moment.",
    );
  });
});

describe("each read has its own title", () => {
  test.each([
    {
      subject: "chart" as const,
      timedOut: "This chart took too long to load",
      failed: "This chart could not load",
      advice: ADVICE,
    },
    {
      subject: "counts" as const,
      timedOut: "Filter counts took too long",
      failed: "Filter counts could not load",
      advice: "Try a shorter time range or more specific filters.",
    },
  ])(
    "$subject: '$timedOut' / '$failed'",
    ({
      subject,
      timedOut,
      failed,
      advice,
    }: {
      subject: "chart" | "counts";
      timedOut: string;
      failed: string;
      advice: string;
    }) => {
      const view: ReturnType<typeof render> = render(
        <TelemetryLoadErrorMessage error={TIMED_OUT} subject={subject} />,
      );

      expect(message()).toHaveTextContent(timedOut);
      expect(message()).toHaveTextContent(advice);

      view.rerender(
        <TelemetryLoadErrorMessage error={FAILED} subject={subject} />,
      );

      expect(message()).toHaveTextContent(failed);
      expect(message()).toHaveTextContent("Invalid attribute key: http.route!");
    },
  );
});

describe("Try again", () => {
  test.each(["list", "chart", "note"] as const)(
    "is one click that runs the read again (%s)",
    (variant: "list" | "chart" | "note") => {
      const onRetry: MockFunction = getJestMockFunction();

      render(
        <TelemetryLoadErrorMessage
          error={TIMED_OUT}
          variant={variant}
          onRetry={() => {
            onRetry();
          }}
        />,
      );

      expect(retryButton()).toHaveTextContent("Try again");
      expect(retryButton()).toHaveAttribute("type", "button");

      fireEvent.click(retryButton()!);

      expect(onRetry).toHaveBeenCalledTimes(1);
    },
  );

  test("is not offered when there is nothing to run", () => {
    render(<TelemetryLoadErrorMessage error={TIMED_OUT} />);

    expect(retryButton()).not.toBeInTheDocument();
  });
});

describe("the sidebar's note", () => {
  test("is a status, not an alert: the page still works without the counts", () => {
    render(
      <TelemetryLoadErrorMessage
        error={TIMED_OUT}
        subject="counts"
        variant="note"
      />,
    );

    expect(message()).toHaveAttribute("role", "status");
    expect(message()).toHaveTextContent("Filter counts took too long");
  });
});
