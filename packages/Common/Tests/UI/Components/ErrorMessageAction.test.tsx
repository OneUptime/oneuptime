import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

/*
 * ErrorMessage is what an empty table draws, as well as a failed one. An
 * empty list that can be added to now passes the "Create X" button as the
 * message's `action`, and that button takes the Refresh link's place:
 * reloading a list that has just loaded empty only shows the same nothing
 * again, and an underlined "Refresh?" under "No monitors yet." read like the
 * load had failed.
 *
 * Everything else about the refresh control (a real, focusable button - see
 * ErrorMessageRefreshControl.test.tsx) is unchanged when there is no action.
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

describe("ErrorMessage action", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders the action under the message", () => {
    render(
      <ErrorMessage
        message="No monitors yet."
        action={<button data-testid="create-first">Create Monitor</button>}
      />,
    );

    const action: HTMLElement = screen.getByTestId("empty-action");

    expect(screen.getByText("No monitors yet.")).toBeInTheDocument();
    expect(action).toContainElement(screen.getByTestId("create-first"));
  });

  test("the action takes the Refresh link's place", () => {
    render(
      <ErrorMessage
        message="No monitors yet."
        onRefreshClick={() => {}}
        action={<button data-testid="create-first">Create Monitor</button>}
      />,
    );

    expect(screen.getByTestId("create-first")).toBeInTheDocument();
    expect(screen.queryByTestId("refresh-button")).toBeNull();
    expect(screen.queryByText("Refresh?")).toBeNull();
  });

  test("the action is live, and does not refresh", () => {
    let creates: number = 0;
    let refreshes: number = 0;

    render(
      <ErrorMessage
        message="No monitors yet."
        onRefreshClick={() => {
          refreshes++;
        }}
        action={
          <button
            data-testid="create-first"
            onClick={() => {
              creates++;
            }}
          >
            Create Monitor
          </button>
        }
      />,
    );

    fireEvent.click(screen.getByTestId("create-first"));

    expect(creates).toBe(1);
    expect(refreshes).toBe(0);
  });

  test("an element message gets the action too", () => {
    render(
      <ErrorMessage
        message={<span data-testid="rich-message">Nothing here yet.</span>}
        action={<button data-testid="create-first">Create Monitor</button>}
      />,
    );

    expect(screen.getByTestId("rich-message")).toBeInTheDocument();
    expect(screen.getByTestId("create-first")).toBeInTheDocument();
  });

  test("without an action, the Refresh link is exactly as before", () => {
    let refreshes: number = 0;

    render(
      <ErrorMessage
        message="Something went wrong"
        onRefreshClick={() => {
          refreshes++;
        }}
      />,
    );

    const refresh: HTMLElement = screen.getByTestId("refresh-button");

    expect(screen.queryByTestId("empty-action")).toBeNull();
    expect(refresh.tagName).toBe("BUTTON");
    expect(refresh).toHaveAttribute("type", "button");
    expect(refresh).toHaveTextContent("Refresh?");

    fireEvent.click(refresh);

    expect(refreshes).toBe(1);
  });

  test("with neither, only the message is drawn", () => {
    const { container } = render(<ErrorMessage message="Nothing here" />);

    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.queryByTestId("empty-action")).toBeNull();
    expect(screen.queryByTestId("refresh-button")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
