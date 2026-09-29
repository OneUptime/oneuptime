import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Tooltip from "../../../UI/Components/Tooltip/Tooltip";

/*
 * Where a rich tooltip is mounted. Tippy mounts an INTERACTIVE tooltip inside
 * the trigger's parent, which is right for tooltips with links in them but
 * wrong inside an overflow-clipped container (the schedule timeline's
 * scrolling grid): the popup is cut off by its own ancestor. interactive={false}
 * opts out, which mounts it on <body>.
 */

async function hover(trigger: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(trigger);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Tooltip - interactive", () => {
  test("a rich tooltip is interactive and mounts beside its trigger by default", async () => {
    render(
      <div data-testid="clipping-host" style={{ overflow: "hidden" }}>
        <Tooltip richContent={<div>Rich body</div>}>
          <button type="button">Open</button>
        </Tooltip>
      </div>,
    );

    await hover(screen.getByRole("button", { name: "Open" }));

    expect(screen.getByTestId("clipping-host")).toContainElement(
      screen.getByText("Rich body"),
    );
  });

  test("interactive={false} mounts the rich tooltip on the body", async () => {
    render(
      <div data-testid="clipping-host" style={{ overflow: "hidden" }}>
        <Tooltip richContent={<div>Rich body</div>} interactive={false}>
          <button type="button">Open</button>
        </Tooltip>
      </div>,
    );

    await hover(screen.getByRole("button", { name: "Open" }));

    const content: HTMLElement = screen.getByText("Rich body");

    expect(screen.getByTestId("clipping-host")).not.toContainElement(content);
    expect(document.body).toContainElement(content);
  });

  test("the same holds for a lazy tooltip", async () => {
    render(
      <div data-testid="clipping-host" style={{ overflow: "hidden" }}>
        <Tooltip
          lazy={true}
          interactive={false}
          richContent={<div>Lazy body</div>}
        >
          <button type="button">Open lazily</button>
        </Tooltip>
      </div>,
    );

    await hover(screen.getByRole("button", { name: "Open lazily" }));

    const content: HTMLElement = screen.getByText("Lazy body");

    expect(screen.getByTestId("clipping-host")).not.toContainElement(content);
  });
});
