import RuleAddsNothingPill, {
  RULE_ADDS_NOTHING_BUTTON_TEST_ID,
  RULE_ADDS_NOTHING_TEST_ID,
} from "../../../../UI/Components/RuleRun/RuleAddsNothingPill";
import {
  RULE_ADDS_NOTHING_TEXT,
  RULE_ADDS_NOTHING_TOOLTIP,
} from "../../../../UI/Components/RuleRun/RuleAction";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

/*
 * "Adds nothing" says what to do about it to everyone who asks: on hover,
 * on a tap (a phone's card of a rules table, where nothing hovers), on
 * keyboard focus, and to a screen reader as the pill's description. It was
 * a pill with a hover tooltip only (#4968).
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.setTimeout(30000);

afterEach(() => {
  cleanup();
});

describe("the Adds nothing pill", () => {
  test("is still found where it always was, with its words", () => {
    render(<RuleAddsNothingPill />);

    expect(screen.getByTestId(RULE_ADDS_NOTHING_TEST_ID)).toHaveTextContent(
      RULE_ADDS_NOTHING_TEXT,
    );
  });

  test("is a button a keyboard reaches, which a screen reader describes with what to do", () => {
    render(<RuleAddsNothingPill />);

    const button: HTMLElement = within(
      screen.getByTestId(RULE_ADDS_NOTHING_TEST_ID),
    ).getByRole("button", { name: RULE_ADDS_NOTHING_TEXT });

    expect(button).toBe(screen.getByTestId(RULE_ADDS_NOTHING_BUTTON_TEST_ID));
    expect(button).toHaveAccessibleDescription(RULE_ADDS_NOTHING_TOOLTIP);
  });

  test("a tap shows what to do, and keeps it once the finger lifts", async () => {
    render(<RuleAddsNothingPill />);

    const button: HTMLElement = screen.getByTestId(
      RULE_ADDS_NOTHING_BUTTON_TEST_ID,
    );

    fireEvent.mouseDown(button);
    act(() => {
      button.focus();
    });
    fireEvent.mouseUp(button);
    fireEvent.click(button);
    fireEvent.mouseLeave(button);

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      RULE_ADDS_NOTHING_TOOLTIP,
    );
  });
});
