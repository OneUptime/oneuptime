import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import { ComponentProps as ErrorMessageTextProps } from "../../../../UI/Components/ErrorMessage/ErrorMessageText";
import TableEmptyState, {
  TABLE_EMPTY_STATE_TEST_ID,
  TableEmptyStateKind,
} from "../../../../UI/Components/Table/TableEmptyState";
import {
  getUnexplainedServerErrorMessage,
  UNEXPLAINED_ERROR_MESSAGES,
} from "../../../../Types/Exception/UnexplainedError";

/*
 * A table's sentence under its title is drawn by the piece every error's
 * words are drawn with (ErrorMessageText, #7570), not by a copy of it: an
 * error nobody explained says why and what to do next, with the reference
 * to give - and not what failed, which the title says (hideWhatFailed) -
 * and any other sentence is in the reader's language, set apart where it
 * reads the other way from the page. TableEmptyState kept a copy of that
 * choice, which could drift from the one the lists, the Templates menu and
 * the notes feed read. What the sentence looks like is pinned by
 * TableEmptyStateComponent, ServerAnswersReadAsWritten and
 * ErrorExplanation's tests, unchanged; this pins whose output it is.
 *
 * ErrorMessageText here is the real one, drawn inside a marker that notes
 * what it was given.
 */

const mockErrorWordsProps: Array<ErrorMessageTextProps> = [];

jest.mock("../../../../UI/Components/ErrorMessage/ErrorMessageText", () => {
  const actual: {
    default: (props: ErrorMessageTextProps) => ReactElement;
  } = jest.requireActual(
    "../../../../UI/Components/ErrorMessage/ErrorMessageText",
  ) as { default: (props: ErrorMessageTextProps) => ReactElement };
  const ActualErrorMessageText: (props: ErrorMessageTextProps) => ReactElement =
    actual.default;

  return {
    __esModule: true,
    default: (props: ErrorMessageTextProps): ReactElement => {
      mockErrorWordsProps.push(props);
      return (
        <span data-testid="shared-error-words">
          <ActualErrorMessageText {...props} />
        </span>
      );
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

const ROOT: string = TABLE_EMPTY_STATE_TEST_ID;

const REFERENCE: string = "a1b2c3d4";

afterEach(() => {
  cleanup();
  mockErrorWordsProps.length = 0;
});

const renderFailedTable: (description: string | ReactElement) => HTMLElement = (
  description: string | ReactElement,
): HTMLElement => {
  render(
    <TableEmptyState
      kind={TableEmptyStateKind.Error}
      title="Couldn't load this node"
      description={description}
    />,
  );

  return screen.getByTestId(`${ROOT}-description`);
};

// Whatever the sentence is, ErrorMessageText is what draws it, and all of it.
const expectSharedWords: (
  sentence: HTMLElement,
  description: string | ReactElement,
) => HTMLElement = (
  sentence: HTMLElement,
  description: string | ReactElement,
): HTMLElement => {
  const words: HTMLElement = within(sentence).getByTestId("shared-error-words");

  expect(sentence.childNodes).toHaveLength(1);
  expect(sentence.firstChild).toBe(words);
  expect(mockErrorWordsProps.length).toBeGreaterThan(0);

  for (const props of mockErrorWordsProps) {
    expect(props.message).toBe(description);
    expect(props.hideWhatFailed).toBe(true);
    expect(props.whatFailed).toBeUndefined();
    // Its reference's row is where it always was, at the lines' start.
    expect(props.isCentered).toBeUndefined();
  }

  return words;
};

describe("a table's sentence under its title", () => {
  test.each([
    [
      "a failure the server could not explain, with its reference",
      getUnexplainedServerErrorMessage(REFERENCE),
    ],
    ["a failure the server did not explain", UNEXPLAINED_ERROR_MESSAGES.server],
  ])(
    "for %s, is ErrorMessageText's explanation, with what failed left to the title",
    (_: string, description: string) => {
      const words: HTMLElement = expectSharedWords(
        renderFailedTable(description),
        description,
      );

      expect(within(words).getByTestId("error-explanation")).toBeVisible();
      expect(within(words).queryByTestId("error-what-failed")).toBeNull();
    },
  );

  test("for words of their own, is ErrorMessageText's line", () => {
    const description: string = "Ask your administrator for access.";

    const words: HTMLElement = expectSharedWords(
      renderFailedTable(description),
      description,
    );

    expect(words).toHaveTextContent(description);
    expect(within(words).queryByTestId("error-explanation")).toBeNull();
  });

  test("for a sentence drawn as an element, is ErrorMessageText's, which draws it as it is", () => {
    const description: ReactElement = (
      <span data-testid="own-sentence">Nothing here yet.</span>
    );

    const words: HTMLElement = expectSharedWords(
      renderFailedTable(description),
      description,
    );

    expect(within(words).getByTestId("own-sentence")).toBeVisible();
  });

  test("is not drawn at all when there is none", () => {
    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No monitors yet."
      />,
    );

    expect(screen.queryByTestId(`${ROOT}-description`)).toBeNull();
    expect(mockErrorWordsProps).toHaveLength(0);
  });
});
