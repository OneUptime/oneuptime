/*
 * The plain log pane.
 *
 * Most of this is long-standing behaviour that had no test; the part that is
 * new is following a log that is still being written, which the workflow run
 * modal turns on while a run goes.
 */

import SimpleLogViewer from "../../../UI/Components/SimpleLogViewer/SimpleLogViewer";
import "@testing-library/jest-dom";
import { RenderResult, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

const CONTENT_HEIGHT_IN_PX: number = 900;

/*
 * jsdom does no layout: scrollHeight is 0 and scrollTop goes nowhere. Both are
 * stood up by hand so "did it scroll to the bottom" is answerable at all.
 */
type ScrollTopSetter = Mock<(value: number) => void>;

let scrollTopSetter: ScrollTopSetter;

const originalScrollTop: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop");
const originalScrollHeight: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");

const logPane: () => HTMLElement = (): HTMLElement => {
  // The scrolling element is the one carrying the max-height.
  const pane: HTMLElement | null = document.querySelector(".overflow-auto");

  if (!pane) {
    throw new Error("Log pane not found");
  }

  return pane as HTMLElement;
};

describe("SimpleLogViewer", () => {
  beforeEach(() => {
    scrollTopSetter = jest.fn<(value: number) => void>();

    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => {
        return CONTENT_HEIGHT_IN_PX;
      },
    });

    Object.defineProperty(HTMLElement.prototype, "scrollTop", {
      configurable: true,
      get: () => {
        return 0;
      },
      set: (value: number) => {
        scrollTopSetter(value);
      },
    });
  });

  afterEach(() => {
    cleanup();

    if (originalScrollTop) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollTop",
        originalScrollTop,
      );
    }

    if (originalScrollHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollHeight",
        originalScrollHeight,
      );
    }
  });

  describe("a log given as text", () => {
    test("puts each line on its own row, numbered from one", () => {
      render(<SimpleLogViewer>{"first\nsecond\nthird"}</SimpleLogViewer>);

      expect(screen.getByText("first")).toBeInTheDocument();
      expect(screen.getByText("second")).toBeInTheDocument();
      expect(screen.getByText("third")).toBeInTheDocument();
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
    });

    test("drops the numbers when asked", () => {
      render(
        <SimpleLogViewer showLineNumbers={false}>
          {"first\nsecond"}
        </SimpleLogViewer>,
      );

      expect(screen.getByText("first")).toBeInTheDocument();
      expect(screen.queryByText("1")).not.toBeInTheDocument();
    });

    /*
     * A blank line still occupies a row — a log's spacing is part of how it
     * reads, and a collapsed row would put the numbers out of step with it.
     */
    test("keeps blank lines", () => {
      render(<SimpleLogViewer>{"first\n\nthird"}</SimpleLogViewer>);

      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });

  describe("a log given as elements", () => {
    test("numbers them the same way", () => {
      render(
        <SimpleLogViewer>
          {[<span key="a">alpha</span>, <span key="b">beta</span>]}
        </SimpleLogViewer>,
      );

      expect(screen.getByText("alpha")).toBeInTheDocument();
      expect(screen.getByText("beta")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
    });

    test("leaves a single element alone", () => {
      render(
        <SimpleLogViewer>
          <span>just this</span>
        </SimpleLogViewer>,
      );

      expect(screen.getByText("just this")).toBeInTheDocument();
      expect(screen.queryByText("1")).not.toBeInTheDocument();
    });
  });

  describe("the frame", () => {
    test("shows a title when given one", () => {
      render(
        <SimpleLogViewer title="Workflow Execution Log">log</SimpleLogViewer>,
      );

      expect(screen.getByText("Workflow Execution Log")).toBeInTheDocument();
    });

    test("has no header without one", () => {
      render(<SimpleLogViewer>log</SimpleLogViewer>);

      expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    });

    test("caps its height", () => {
      render(<SimpleLogViewer height="250px">log</SimpleLogViewer>);

      expect(logPane()).toHaveStyle({ maxHeight: "250px" });
    });

    test("falls back to a default height", () => {
      render(<SimpleLogViewer>log</SimpleLogViewer>);

      expect(logPane()).toHaveStyle({ maxHeight: "400px" });
    });
  });

  describe("following a log that is still being written", () => {
    test("does not move on its own", () => {
      const view: RenderResult = render(
        <SimpleLogViewer>{"one"}</SimpleLogViewer>,
      );

      view.rerender(<SimpleLogViewer>{"one\ntwo"}</SimpleLogViewer>);

      expect(scrollTopSetter).not.toHaveBeenCalled();
    });

    test("jumps to the bottom when asked", () => {
      render(
        <SimpleLogViewer autoScrollToBottom={true}>{"one"}</SimpleLogViewer>,
      );

      expect(scrollTopSetter).toHaveBeenCalledWith(CONTENT_HEIGHT_IN_PX);
    });

    test("stays at the bottom as lines arrive", () => {
      const view: RenderResult = render(
        <SimpleLogViewer autoScrollToBottom={true}>{"one"}</SimpleLogViewer>,
      );

      scrollTopSetter.mockClear();

      view.rerender(
        <SimpleLogViewer autoScrollToBottom={true}>
          {"one\ntwo"}
        </SimpleLogViewer>,
      );

      expect(scrollTopSetter).toHaveBeenCalledWith(CONTENT_HEIGHT_IN_PX);
    });

    test("lets go once the run is over", () => {
      const view: RenderResult = render(
        <SimpleLogViewer autoScrollToBottom={true}>{"one"}</SimpleLogViewer>,
      );

      scrollTopSetter.mockClear();

      view.rerender(
        <SimpleLogViewer autoScrollToBottom={false}>
          {"one\ntwo"}
        </SimpleLogViewer>,
      );

      expect(scrollTopSetter).not.toHaveBeenCalled();
    });
  });
});
