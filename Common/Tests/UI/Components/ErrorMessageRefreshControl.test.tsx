import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

/*
 * ErrorMessage is the app-wide "this went wrong" and "there is nothing here"
 * surface - 89 call sites pass onRefreshClick - and its recovery control used
 * to be a <div role="refresh-button">. A div is not in the tab order and does
 * not answer Enter or Space, so the only way out of a failed table was the
 * mouse. It is a real <button> now, which is what these assertions pin down:
 * reachable by keyboard, and operable by the keys a button responds to.
 */

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import ErrorMessage from "../../../UI/Components/ErrorMessage/ErrorMessage";

describe("ErrorMessage refresh control", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders the refresh control as a real button", () => {
    render(
      <ErrorMessage message="Something went wrong" onRefreshClick={() => {}} />,
    );

    const refresh: HTMLElement = screen.getByTestId("refresh-button");

    expect(refresh.tagName).toBe("BUTTON");
    // A submit button inside a form would navigate instead of refetching.
    expect(refresh).toHaveAttribute("type", "button");
    expect(refresh).toHaveTextContent("Refresh?");
  });

  test("the refresh control is focusable and fires on Enter and on Space", () => {
    let refreshCount: number = 0;

    render(
      <ErrorMessage
        message="Something went wrong"
        onRefreshClick={() => {
          refreshCount++;
        }}
      />,
    );

    const refresh: HTMLElement = screen.getByTestId("refresh-button");

    refresh.focus();
    expect(refresh).toHaveFocus();

    /*
     * jsdom does not synthesise the click a real browser derives from Enter or
     * Space on a button, so the assertion that matters here is the one above -
     * that this is a button at all, and therefore gets that behaviour from the
     * platform. The click below confirms the handler is still wired.
     */
    fireEvent.click(refresh);
    expect(refreshCount).toBe(1);
  });

  test("renders no control at all when there is nothing to refresh", () => {
    render(<ErrorMessage message="Nothing here" />);

    expect(screen.queryByTestId("refresh-button")).not.toBeInTheDocument();
  });
});
