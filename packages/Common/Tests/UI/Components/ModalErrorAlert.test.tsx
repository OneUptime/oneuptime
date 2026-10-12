import Modal from "../../../UI/Components/Modal/Modal";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, RenderResult, screen } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * Why a dialog's last action failed - a refusal the server sent back, such as
 * "User is not allowed to create on fileId column of Packet Capture" - is the
 * red alert the Modal draws at the top of its body (ModalBody).
 *
 * Two things kept it from being read. It was drawn flush against the
 * dialog's first block, so on Start Packet Capture the red refusal sat on the
 * yellow notice and the two banners read as one. And it was drawn at the top
 * of a body that may be scrolled down - a long form on a phone, a fold
 * opened - so the button was pressed, its spinner stopped, and nothing
 * seemed to happen. The alert now keeps the gap a dialog's blocks keep, and
 * a new reason brings the top of the body back into view.
 */

const REFUSAL: string =
  "User is not allowed to create on bpfFilter column of Packet Capture. You need one of these permissions: Project Owner, Project Admin, Start Packet Capture.";

const OTHER_REFUSAL: string =
  "This probe is already running 2 packet captures. Wait for one to finish, or stop one, and try again.";

function dialog(error: string | undefined): ReactElement {
  return (
    <Modal
      title="Start Packet Capture"
      submitButtonText="Start Capture"
      onClose={getJestMockFunction()}
      onSubmit={getJestMockFunction()}
      error={error}
    >
      <div data-testid="dialog-notice">A capture holds the traffic itself.</div>
    </Modal>
  );
}

// The body as the person left it: scrolled down to the dialog's buttons.
function scrollBodyDown(top: number = 400): HTMLElement {
  const content: HTMLElement = screen.getByTestId("modal-content");
  content.scrollTop = top;
  return content;
}

type MatchMediaFunction = (query: string) => MediaQueryList;

function preferReducedMotion(reduce: boolean): void {
  const matchMedia: MatchMediaFunction = (query: string): MediaQueryList => {
    return {
      matches: reduce && query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: getJestMockFunction(),
      removeListener: getJestMockFunction(),
      addEventListener: getJestMockFunction(),
      removeEventListener: getJestMockFunction(),
      dispatchEvent: getJestMockFunction(),
    } as unknown as MediaQueryList;
  };

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMedia,
  });
}

// A browser's own smooth scroll, which jsdom lacks.
function giveScrollTo(content: HTMLElement): MockFunction {
  const scrollTo: MockFunction = getJestMockFunction();
  (content as unknown as { scrollTo: MockFunction }).scrollTo = scrollTo;
  return scrollTo;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe("a dialog's error", () => {
  test("is drawn first, above what the dialog holds, as an alert", () => {
    render(dialog(REFUSAL));

    const alert: HTMLElement = screen.getByTestId("modal-error");

    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent(REFUSAL);
    expect(
      alert.compareDocumentPosition(screen.getByTestId("dialog-notice")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("keeps the gap a dialog's blocks keep, never drawn flush against the first of them", () => {
    render(dialog(REFUSAL));

    // 16px, as between the notice and the form under it.
    expect(screen.getByTestId("modal-error")).toHaveClass("mb-4");
  });

  test("draws nothing without an error", () => {
    render(dialog(undefined));

    expect(screen.queryByTestId("modal-error")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a new error on a body scrolled down", () => {
  test("brings the top of the body, where the error is, back into view", () => {
    const view: RenderResult = render(dialog(undefined));
    const content: HTMLElement = scrollBodyDown();

    view.rerender(dialog(REFUSAL));

    expect(content.scrollTop).toBe(0);
    expect(screen.getByTestId("modal-error")).toHaveTextContent(REFUSAL);
  });

  test("scrolls there smoothly where the browser can", () => {
    preferReducedMotion(false);

    const view: RenderResult = render(dialog(undefined));
    const content: HTMLElement = scrollBodyDown();
    const scrollTo: MockFunction = giveScrollTo(content);

    view.rerender(dialog(REFUSAL));

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  test("jumps there at once for someone who asked for less motion", () => {
    preferReducedMotion(true);

    const view: RenderResult = render(dialog(undefined));
    const content: HTMLElement = scrollBodyDown();
    const scrollTo: MockFunction = giveScrollTo(content);

    view.rerender(dialog(REFUSAL));

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });

  test("a different error is brought into view too", () => {
    const view: RenderResult = render(dialog(REFUSAL));
    const content: HTMLElement = scrollBodyDown();

    view.rerender(dialog(OTHER_REFUSAL));

    expect(content.scrollTop).toBe(0);
  });

  test("the same error again, after the dialog cleared it for a new try, is brought into view again", () => {
    const view: RenderResult = render(dialog(REFUSAL));

    // Start Capture clears the error, sends, and is refused again.
    view.rerender(dialog(""));
    const content: HTMLElement = scrollBodyDown();
    view.rerender(dialog(REFUSAL));

    expect(content.scrollTop).toBe(0);
  });
});

describe("the scroll is the person's otherwise", () => {
  test("the same error kept leaves it where they put it", () => {
    const view: RenderResult = render(dialog(REFUSAL));
    const content: HTMLElement = scrollBodyDown(250);

    view.rerender(dialog(REFUSAL));

    expect(content.scrollTop).toBe(250);
  });

  test("an error cleared leaves it where they put it", () => {
    const view: RenderResult = render(dialog(REFUSAL));
    const content: HTMLElement = scrollBodyDown(250);

    view.rerender(dialog(undefined));

    expect(content.scrollTop).toBe(250);
  });

  test("a body already at the top is not scrolled at all", () => {
    const view: RenderResult = render(dialog(undefined));
    const content: HTMLElement = screen.getByTestId("modal-content");
    const scrollTo: MockFunction = giveScrollTo(content);

    view.rerender(dialog(REFUSAL));

    expect(scrollTo).not.toHaveBeenCalled();
    expect(content.scrollTop).toBe(0);
  });
});
