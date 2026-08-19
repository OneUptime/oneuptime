import SideOver, {
  ComponentProps,
} from "../../../UI/Components/SideOver/SideOver";
import "@testing-library/jest-dom";
import { resetPageScrollLockForTesting } from "../../../UI/Utils/PageScrollLock";
import { act, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The panel mounts parked off the right edge and slides in on the next
 * animation frame, so anything asserting the settled look has to let that
 * frame run first — the same choreography Modal.test.tsx flushes.
 */
type FlushEntranceFrameFunction = () => Promise<void>;

const flushEntranceFrame: FlushEntranceFrameFunction =
  async (): Promise<void> => {
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  };

type GetPanelFunction = () => HTMLElement;

const getPanel: GetPanelFunction = (): HTMLElement => {
  return screen.getByTestId("side-over-layer").firstElementChild as HTMLElement;
};

describe("SideOver entrance motion", () => {
  const childElement: ReactElement = <div key={0}>child element</div>;

  const props: ComponentProps = {
    title: "title",
    description: "description",
    onClose: jest.fn(),
    onSubmit: jest.fn(),
    children: childElement,
  };

  beforeEach(() => {
    resetPageScrollLockForTesting();
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  });

  afterEach(() => {
    jest.clearAllMocks();
    resetPageScrollLockForTesting();
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  });

  test("the panel mounts parked off the right edge with a transform transition", () => {
    render(<SideOver {...props} />);

    const panel: HTMLElement = getPanel();

    expect(panel).toHaveClass("translate-x-full");
    expect(panel).toHaveClass(
      "transition-transform",
      "duration-200",
      "ease-out",
      "motion-reduce:transition-none",
    );

    // The layout contract the rest of the suite pins is untouched.
    expect(panel).toHaveClass("pointer-events-auto", "w-full");
  });

  test("after the entrance frame the panel has settled with no lingering transform", async () => {
    render(<SideOver {...props} />);

    await flushEntranceFrame();

    /*
     * A settled panel carries no transform class at all: a lingering
     * translate would make it the containing block for position:fixed
     * descendants — the same invariant Modal pins.
     */
    expect(getPanel().className).not.toMatch(/(^|\s)(sm:)?(scale|translate)-/);
  });

  test("the close button eases colour changes and carries a focus-visible ring", () => {
    render(<SideOver {...props} />);

    const closeButton: HTMLElement = screen.getByTestId("close-button");

    expect(closeButton).toHaveClass(
      "transition-colors",
      "duration-150",
      "focus:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-indigo-500",
      "focus-visible:ring-offset-2",
    );
  });
});
