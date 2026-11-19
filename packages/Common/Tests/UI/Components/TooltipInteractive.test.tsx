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
 * the trigger's parent, so that Tab reaches its links - and there an
 * overflow-clipped container cut it off: the schedule timeline's scrolling
 * grid, and the owner avatars of a list's first row (#9769). Every tooltip
 * is mounted on <body> now, interactive or not; interactive={false} only
 * makes it hide as the pointer leaves its trigger. Tab still reaches an
 * interactive one's links (TooltipLayer.test).
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
  test("a rich tooltip is interactive by default, and mounts on the body", async () => {
    render(
      <div data-testid="clipping-host" style={{ overflow: "hidden" }}>
        <Tooltip richContent={<div>Rich body</div>}>
          <button type="button">Open</button>
        </Tooltip>
      </div>,
    );

    await hover(screen.getByRole("button", { name: "Open" }));

    const content: HTMLElement = screen.getByText("Rich body");
    const root: HTMLElement | null =
      content.closest<HTMLElement>("[data-tippy-root]");

    expect(screen.getByTestId("clipping-host")).not.toContainElement(content);
    expect(root?.parentElement).toBe(document.body);
    // Interactive: the pointer can move onto it, where Tippy lets it through one that is not.
    expect(root?.style.pointerEvents).not.toBe("none");
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
