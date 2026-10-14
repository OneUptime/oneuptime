import LogSearchBar from "../../../UI/Components/LogsViewer/components/LogSearchBar";
import TelemetrySearchBar from "../../../UI/Components/TelemetryViewer/components/TelemetrySearchBar";
import {
  ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID,
  ATTRIBUTE_VALUES_RETRY_TEST_ID,
} from "../../../UI/Components/TelemetryViewer/components/AttributeValuesLoadError";
import {
  TelemetryLoadError,
  TelemetryLoadErrorKind,
} from "../../../UI/Utils/Telemetry/TelemetryLoadError";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The `@key:` dropdown's states (issue #4708), in the logs search bar and in
 * the other explorers' (traces, exceptions, metrics, security events):
 *
 *   - while the values load: "Loading values for <key>..." - one sentence the
 *     translator can word whole, never an English string glued to the key;
 *   - when they could not load: which key, why in a word, that a value can
 *     still be typed, and Try again - where before the dropdown vanished and
 *     read as "this key has no values";
 *   - nothing at all when there is nothing to say.
 */

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  attributeSuggestions?: Array<string> | undefined;
  valueSuggestions?: Record<string, Array<string>> | undefined;
  onFieldValueSelect?: ((fieldKey: string, value: string) => void) | undefined;
  isAttributesLoading?: boolean | undefined;
  isValuesLoading?: boolean | undefined;
  valuesError?: TelemetryLoadError | undefined;
  onRetryValues?: (() => void) | undefined;
}

const BARS: Array<{
  name: string;
  Bar: React.ComponentType<SearchBarProps>;
}> = [
  {
    name: "the logs search bar",
    Bar: LogSearchBar as unknown as React.ComponentType<SearchBarProps>,
  },
  {
    name: "the explorers' search bar",
    Bar: TelemetrySearchBar as unknown as React.ComponentType<SearchBarProps>,
  },
];

const TIMED_OUT: TelemetryLoadError = {
  kind: TelemetryLoadErrorKind.TimedOut,
  message:
    "This query took longer than 10 seconds and was stopped before it finished.",
};

const FAILED: TelemetryLoadError = {
  kind: TelemetryLoadErrorKind.Failed,
  message: "Network Error",
};

afterEach(() => {
  cleanup();
});

function renderBar(
  Bar: React.ComponentType<SearchBarProps>,
  props: Partial<SearchBarProps>,
): { input: HTMLElement; onChange: MockFunction; onSubmit: MockFunction } {
  const onChange: MockFunction = getJestMockFunction();
  const onSubmit: MockFunction = getJestMockFunction();

  render(
    <Bar
      value=""
      onChange={onChange as unknown as (value: string) => void}
      onSubmit={onSubmit as unknown as () => void}
      attributeSuggestions={["exception.message", "env"]}
      {...props}
    />,
  );

  const input: HTMLElement = screen.getByRole("textbox");
  fireEvent.focus(input);

  return { input, onChange, onSubmit };
}

describe.each(BARS)(
  "$name",
  ({ Bar }: { Bar: React.ComponentType<SearchBarProps> }) => {
    test("while the values load, it says whose", () => {
      renderBar(Bar, {
        value: "@exception.message:",
        isValuesLoading: true,
      });

      expect(
        screen.getByText("Loading values for exception.message..."),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId(ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID),
      ).toBeNull();
    });

    test("values that took too long: which key, why, that a value can still be typed, and Try again", () => {
      const onRetryValues: MockFunction = getJestMockFunction();

      renderBar(Bar, {
        value: "@exception.message:",
        valuesError: TIMED_OUT,
        onRetryValues: onRetryValues as unknown as () => void,
      });

      const error: HTMLElement = screen.getByTestId(
        ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID,
      );

      expect(error).toHaveAttribute("role", "status");
      expect(error).toHaveAttribute("data-kind", "timed-out");
      expect(error).toHaveTextContent(
        "Values for exception.message took too long to load.",
      );
      expect(error).toHaveTextContent(
        "You can still type a value and press Enter.",
      );
      // The server's sentence is about searches; the picker words its own.
      expect(error).not.toHaveTextContent("Try a shorter time range");

      fireEvent.click(
        within(error).getByTestId(ATTRIBUTE_VALUES_RETRY_TEST_ID),
      );

      expect(onRetryValues).toHaveBeenCalledTimes(1);
    });

    test("values that failed for another reason say they could not load", () => {
      renderBar(Bar, {
        value: "@env:prod",
        valuesError: FAILED,
        onRetryValues: jest.fn(),
      });

      const error: HTMLElement = screen.getByTestId(
        ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID,
      );

      expect(error).toHaveAttribute("data-kind", "failed");
      expect(error).toHaveTextContent("Could not load values for env.");
    });

    test("Try again keeps the focus in the search box", () => {
      const { input } = renderBar(Bar, {
        value: "@env:",
        valuesError: FAILED,
        onRetryValues: jest.fn(),
      });

      input.focus();

      const retry: HTMLElement = screen.getByTestId(
        ATTRIBUTE_VALUES_RETRY_TEST_ID,
      );
      const pressed: boolean = fireEvent.mouseDown(retry);

      // The press was not allowed to move the focus.
      expect(pressed).toBe(false);
      expect(document.activeElement).toBe(input);
    });

    test("without a way to try again, there is no button", () => {
      renderBar(Bar, { value: "@env:", valuesError: FAILED });

      expect(
        screen.getByTestId(ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID),
      ).toBeInTheDocument();
      expect(screen.queryByTestId(ATTRIBUTE_VALUES_RETRY_TEST_ID)).toBeNull();
    });

    test("Enter still applies the value typed, error or not", () => {
      const onFieldValueSelect: MockFunction = getJestMockFunction();
      const { input } = renderBar(Bar, {
        value: "@env:production",
        valuesError: TIMED_OUT,
        onFieldValueSelect: onFieldValueSelect as unknown as (
          fieldKey: string,
          value: string,
        ) => void,
      });

      fireEvent.keyDown(input, { key: "Enter" });

      expect(onFieldValueSelect).toHaveBeenCalledWith("env", "production");
    });

    test("while loading, the error of an earlier try is not shown", () => {
      renderBar(Bar, {
        value: "@env:",
        isValuesLoading: true,
        valuesError: FAILED,
      });

      expect(
        screen.queryByTestId(ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID),
      ).toBeNull();
      expect(screen.getByText("Loading values for env...")).toBeInTheDocument();
    });

    test("an error is said only in value mode, never under the key list", () => {
      renderBar(Bar, { value: "@env", valuesError: FAILED });

      expect(
        screen.queryByTestId(ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID),
      ).toBeNull();
    });

    test("values that are here are listed, and no error is said", () => {
      renderBar(Bar, {
        value: "@env:",
        valueSuggestions: { env: ["production", "staging"] },
      });

      expect(screen.getByText("production")).toBeInTheDocument();
      expect(screen.getByText("staging")).toBeInTheDocument();
      expect(
        screen.queryByTestId(ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID),
      ).toBeNull();
    });

    test("no values, no error, not loading: no dropdown at all", () => {
      renderBar(Bar, { value: "@env:" });

      expect(screen.queryByText("Loading values for env...")).toBeNull();
      expect(
        screen.queryByTestId(ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID),
      ).toBeNull();
    });
  },
);
