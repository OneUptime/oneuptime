import LogSearchBar from "../../../UI/Components/LogsViewer/components/LogSearchBar";
import TelemetrySearchBar from "../../../UI/Components/TelemetryViewer/components/TelemetrySearchBar";
import {
  ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID,
  ATTRIBUTE_VALUES_RETRY_TEST_ID,
} from "../../../UI/Components/TelemetryViewer/components/AttributeValuesLoadError";
import { ATTRIBUTE_VALUES_EMPTY_TEST_ID } from "../../../UI/Components/TelemetryViewer/components/AttributeValuesEmpty";
import { ATTRIBUTE_KEY_IN_SENTENCE_TEST_ID } from "../../../UI/Components/TelemetryViewer/components/AttributeKeySentence";
import { SEARCH_SUGGESTIONS_TEST_ID } from "../../../UI/Components/TelemetryViewer/components/TelemetrySearchSuggestions";
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
 *   - when the lookup found none: "No values to suggest for <key> in this
 *     time range.", until the reader types a value of their own - where
 *     before the loading line simply vanished;
 *   - the key in each of those sentences drawn as typed, in monospace, the
 *     way the search box and the value rows draw it;
 *   - Try again within reach of the keyboard: the down arrow selects it and
 *     Enter presses it, the focus never leaving the search box;
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
  hasNoValues?: boolean | undefined;
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
): {
  input: HTMLElement;
  onChange: MockFunction;
  onSubmit: MockFunction;
  rerender: (next: Partial<SearchBarProps>) => void;
} {
  const onChange: MockFunction = getJestMockFunction();
  const onSubmit: MockFunction = getJestMockFunction();

  const element: (next: Partial<SearchBarProps>) => React.ReactElement = (
    next: Partial<SearchBarProps>,
  ): React.ReactElement => {
    return (
      <Bar
        value=""
        onChange={onChange as unknown as (value: string) => void}
        onSubmit={onSubmit as unknown as () => void}
        attributeSuggestions={["exception.message", "env"]}
        {...next}
      />
    );
  };

  const rendered: ReturnType<typeof render> = render(element(props));

  const input: HTMLElement = screen.getByRole("textbox");
  fireEvent.focus(input);

  return {
    input,
    onChange,
    onSubmit,
    rerender: (next: Partial<SearchBarProps>): void => {
      rendered.rerender(element(next));
    },
  };
}

function dropdown(): HTMLElement {
  return screen.getByTestId(SEARCH_SUGGESTIONS_TEST_ID);
}

// The key a sentence of the dropdown names, as it is drawn.
function keyInSentence(container: HTMLElement): HTMLElement {
  return within(container).getByTestId(ATTRIBUTE_KEY_IN_SENTENCE_TEST_ID);
}

describe.each(BARS)(
  "$name",
  ({ Bar }: { Bar: React.ComponentType<SearchBarProps> }) => {
    test("while the values load, it says whose, the key drawn as typed", () => {
      renderBar(Bar, {
        value: "@exception.message:",
        isValuesLoading: true,
      });

      expect(dropdown()).toHaveTextContent(
        "Loading values for exception.message...",
      );

      const key: HTMLElement = keyInSentence(dropdown());
      expect(key.tagName).toBe("CODE");
      expect(key).toHaveClass("font-mono");
      expect(key).toHaveTextContent("exception.message");

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
      expect(keyInSentence(error).tagName).toBe("CODE");
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
      expect(keyInSentence(error)).toHaveTextContent("env");
    });

    test("Try again sits with the hint under the sentence, not at the far end of the row", () => {
      renderBar(Bar, {
        value: "@env:",
        valuesError: TIMED_OUT,
        onRetryValues: jest.fn(),
      });

      const retry: HTMLElement = screen.getByTestId(
        ATTRIBUTE_VALUES_RETRY_TEST_ID,
      );
      const hint: HTMLElement = screen.getByText(
        "You can still type a value and press Enter.",
      );

      // The hint and the button share one line that wraps, under the words.
      expect(retry.parentElement).toBe(hint.parentElement);
      expect(retry.parentElement).toHaveClass("flex-wrap");
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

    test("the down arrow selects Try again and Enter presses it, the focus staying in the box", () => {
      const onRetryValues: MockFunction = getJestMockFunction();
      const onFieldValueSelect: MockFunction = getJestMockFunction();
      const { input, onSubmit } = renderBar(Bar, {
        value: "@env:",
        valuesError: TIMED_OUT,
        onRetryValues: onRetryValues as unknown as () => void,
        onFieldValueSelect: onFieldValueSelect as unknown as (
          fieldKey: string,
          value: string,
        ) => void,
      });

      input.focus();

      const retry: HTMLElement = screen.getByTestId(
        ATTRIBUTE_VALUES_RETRY_TEST_ID,
      );
      expect(retry).toHaveAttribute("data-selected", "false");

      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(
        screen.getByTestId(ATTRIBUTE_VALUES_RETRY_TEST_ID),
      ).toHaveAttribute("data-selected", "true");

      fireEvent.keyDown(input, { key: "Enter" });

      expect(onRetryValues).toHaveBeenCalledTimes(1);
      // Enter pressed Try again, and nothing else.
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onFieldValueSelect).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(input);
      expect(
        screen.getByTestId(ATTRIBUTE_VALUES_RETRY_TEST_ID),
      ).toHaveAttribute("data-selected", "false");
    });

    test("the up arrow puts Try again down again, and Enter then applies the typed value", () => {
      const onRetryValues: MockFunction = getJestMockFunction();
      const onFieldValueSelect: MockFunction = getJestMockFunction();
      const { input } = renderBar(Bar, {
        value: "@env:production",
        valuesError: TIMED_OUT,
        onRetryValues: onRetryValues as unknown as () => void,
        onFieldValueSelect: onFieldValueSelect as unknown as (
          fieldKey: string,
          value: string,
        ) => void,
      });

      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowUp" });

      expect(
        screen.getByTestId(ATTRIBUTE_VALUES_RETRY_TEST_ID),
      ).toHaveAttribute("data-selected", "false");

      fireEvent.keyDown(input, { key: "Enter" });

      expect(onRetryValues).not.toHaveBeenCalled();
      expect(onFieldValueSelect).toHaveBeenCalledWith("env", "production");
    });

    test("typing on puts a selected Try again down again", () => {
      const onRetryValues: MockFunction = getJestMockFunction();
      const { input, rerender } = renderBar(Bar, {
        value: "@env:",
        valuesError: TIMED_OUT,
        onRetryValues: onRetryValues as unknown as () => void,
      });

      fireEvent.keyDown(input, { key: "ArrowDown" });
      rerender({
        value: "@env:p",
        valuesError: TIMED_OUT,
        onRetryValues: onRetryValues as unknown as () => void,
      });

      expect(
        screen.getByTestId(ATTRIBUTE_VALUES_RETRY_TEST_ID),
      ).toHaveAttribute("data-selected", "false");
    });

    test("without a way to try again, there is no button, and the arrows select nothing", () => {
      const onFieldValueSelect: MockFunction = getJestMockFunction();
      const { input } = renderBar(Bar, {
        value: "@env:prod",
        valuesError: FAILED,
        onFieldValueSelect: onFieldValueSelect as unknown as (
          fieldKey: string,
          value: string,
        ) => void,
      });

      expect(
        screen.getByTestId(ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID),
      ).toBeInTheDocument();
      expect(screen.queryByTestId(ATTRIBUTE_VALUES_RETRY_TEST_ID)).toBeNull();

      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(onFieldValueSelect).toHaveBeenCalledWith("env", "prod");
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
      expect(dropdown()).toHaveTextContent("Loading values for env...");
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
      expect(screen.queryByTestId(ATTRIBUTE_VALUES_EMPTY_TEST_ID)).toBeNull();
    });

    test("a key whose lookup found no values says so, with the hint, instead of vanishing", () => {
      renderBar(Bar, {
        value: "@exception.message:",
        valueSuggestions: { "exception.message": [] },
        hasNoValues: true,
      });

      const empty: HTMLElement = screen.getByTestId(
        ATTRIBUTE_VALUES_EMPTY_TEST_ID,
      );

      expect(empty).toHaveAttribute("role", "status");
      expect(empty).toHaveTextContent(
        "No values to suggest for exception.message in this time range.",
      );
      expect(empty).toHaveTextContent(
        "You can still type a value and press Enter.",
      );
      expect(keyInSentence(empty).tagName).toBe("CODE");
      // Nothing to try again: the lookup worked.
      expect(screen.queryByTestId(ATTRIBUTE_VALUES_RETRY_TEST_ID)).toBeNull();
      // One message, not the old "No matching values" line under it.
      expect(dropdown()).not.toHaveTextContent("No matching values");
    });

    test("once a value of the reader's own is typed, the no-values line steps aside, and Enter applies it", () => {
      const onFieldValueSelect: MockFunction = getJestMockFunction();
      const { input } = renderBar(Bar, {
        value: "@env:canary",
        valueSuggestions: { env: [] },
        hasNoValues: true,
        onFieldValueSelect: onFieldValueSelect as unknown as (
          fieldKey: string,
          value: string,
        ) => void,
      });

      expect(screen.queryByTestId(ATTRIBUTE_VALUES_EMPTY_TEST_ID)).toBeNull();
      expect(screen.queryByTestId(SEARCH_SUGGESTIONS_TEST_ID)).toBeNull();

      fireEvent.keyDown(input, { key: "Enter" });

      expect(onFieldValueSelect).toHaveBeenCalledWith("env", "canary");
    });

    test("the no-values line is never said while loading, beside an error, under the key list or beside values", () => {
      const { rerender } = renderBar(Bar, {
        value: "@env:",
        isValuesLoading: true,
        hasNoValues: true,
      });

      expect(screen.queryByTestId(ATTRIBUTE_VALUES_EMPTY_TEST_ID)).toBeNull();

      rerender({ value: "@env:", valuesError: FAILED, hasNoValues: true });
      expect(screen.queryByTestId(ATTRIBUTE_VALUES_EMPTY_TEST_ID)).toBeNull();
      expect(
        screen.getByTestId(ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID),
      ).toBeInTheDocument();

      rerender({ value: "@en", hasNoValues: true });
      expect(screen.queryByTestId(ATTRIBUTE_VALUES_EMPTY_TEST_ID)).toBeNull();

      rerender({
        value: "@env:",
        valueSuggestions: { env: ["production"] },
        hasNoValues: true,
      });
      expect(screen.queryByTestId(ATTRIBUTE_VALUES_EMPTY_TEST_ID)).toBeNull();
      expect(screen.getByText("production")).toBeInTheDocument();
    });

    test("a key too long for the dropdown wraps inside it, in every line that names it", () => {
      const longKey: string =
        "k8s.deployment.annotations.kubectl.kubernetes.io/last-applied-configuration";
      const { rerender } = renderBar(Bar, {
        value: `@${longKey}:`,
        isValuesLoading: true,
      });

      // The loading line's words may shrink below the key's length, and break.
      const loadingWords: HTMLElement = keyInSentence(dropdown())
        .parentElement as HTMLElement;
      expect(loadingWords).toHaveClass("min-w-0", "break-words");

      rerender({
        value: `@${longKey}:`,
        valuesError: TIMED_OUT,
        onRetryValues: jest.fn(),
      });
      expect(
        keyInSentence(
          screen.getByTestId(ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID),
        ).closest("p"),
      ).toHaveClass("break-words");

      rerender({
        value: `@${longKey}:`,
        valueSuggestions: { [longKey]: [] },
        hasNoValues: true,
      });
      expect(
        keyInSentence(
          screen.getByTestId(ATTRIBUTE_VALUES_EMPTY_TEST_ID),
        ).closest("p"),
      ).toHaveClass("break-words");
    });

    test("no values, no error, not loading, nothing found: no dropdown at all", () => {
      renderBar(Bar, { value: "@env:" });

      expect(screen.queryByTestId(SEARCH_SUGGESTIONS_TEST_ID)).toBeNull();
      expect(
        screen.queryByTestId(ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID),
      ).toBeNull();
    });
  },
);
