import useComponentOutsideClick from "../../../UI/Types/UseComponentOutsideClick";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The hook behind almost every popover in the product — NavBar, SideMenu,
 * MoreMenu, ProjectPicker, NotificationBell, the column selector, both
 * saved-views dropdowns — and until now it had no tests of its own. It got
 * them when a change to it shipped a regression that all 4,604 tests in
 * Common/Tests/UI were blind to: a right-click inside an open panel left the
 * "this gesture started inside" flag armed, and the next click that arrived
 * without a mousedown of its own — a keyboard user pressing Enter on a control
 * elsewhere, or code calling element.click() — was swallowed, leaving the
 * panel open over the page.
 *
 * So the cases here are written as a pair of opposing pressures: the drag-out
 * gesture the suppression exists to protect, and every route by which a
 * dismissal must still get through.
 */

const PANEL_TEXT: string = "panel contents";

const Harness: FunctionComponent = (): ReactElement => {
  const { ref, isComponentVisible } = useComponentOutsideClick(true);

  return (
    <div>
      <div ref={ref}>
        {isComponentVisible ? (
          <div>
            <p>{PANEL_TEXT}</p>
            <input aria-label="inside box" />
          </div>
        ) : null}
      </div>
      {/*
       * A real control the user could tab to and activate. It deliberately
       * does nothing of its own, so a test that finds the panel closed after
       * activating it is reading the hook and not this button.
       */}
      <button type="button">outside control</button>
    </div>
  );
};

function isOpen(): boolean {
  return screen.queryByText(PANEL_TEXT) !== null;
}

function insideBox(): HTMLElement {
  return screen.getByLabelText("inside box");
}

function outsideControl(): HTMLElement {
  return screen.getByRole("button", { name: "outside control" });
}

/*
 * A real pointer click always carries detail >= 1; jsdom defaults it to 0,
 * which is the value a keyboard activation or element.click() produces. The
 * distinction is load-bearing here, so it is never left to the default.
 */
function pointerClick(target: HTMLElement | Document): void {
  fireEvent.click(target as HTMLElement, { detail: 1 });
}

describe("useComponentOutsideClick — dismissing on an outside click", () => {
  afterEach(() => {
    cleanup();
  });

  test("a plain click outside closes the component", () => {
    render(<Harness />);

    fireEvent.mouseDown(document.body);
    pointerClick(document.body);

    expect(isOpen()).toBe(false);
  });

  test("a click inside leaves it open", () => {
    render(<Harness />);

    fireEvent.mouseDown(insideBox());
    pointerClick(insideBox());

    expect(isOpen()).toBe(true);
  });
});

describe("useComponentOutsideClick — a drag that leaves the component", () => {
  afterEach(() => {
    cleanup();
  });

  test("selecting text inside and releasing outside does not dismiss", () => {
    render(<Harness />);

    /*
     * The browser fires the click on the common ancestor of press and
     * release, which is outside. Dismissing on that discards whatever the
     * user was selecting — a half-typed search, most often.
     */
    fireEvent.mouseDown(insideBox());
    pointerClick(document.body);

    expect(isOpen()).toBe(true);
  });

  test("the reprieve lasts exactly one click", () => {
    render(<Harness />);

    fireEvent.mouseDown(insideBox());
    pointerClick(document.body);
    expect(isOpen()).toBe(true);

    // The next outside click is nobody's drag, and must land.
    pointerClick(document.body);

    expect(isOpen()).toBe(false);
  });
});

describe("useComponentOutsideClick — presses that never become a click", () => {
  afterEach(() => {
    cleanup();
  });

  test("a right-click inside does not arm the suppression", () => {
    render(<Harness />);

    /*
     * Right and middle presses fire mousedown and then go to contextmenu or
     * auxclick — no click ever arrives to spend the flag. Deliberately NO
     * outside mousedown before the activation below: one of those would reset
     * the flag by itself and the case would pass either way.
     */
    fireEvent.mouseDown(insideBox(), { button: 2 });
    fireEvent.contextMenu(insideBox());

    fireEvent.click(outsideControl(), { detail: 0 });

    expect(isOpen()).toBe(false);
  });

  test("a middle-click inside does not arm the suppression", () => {
    render(<Harness />);

    fireEvent.mouseDown(insideBox(), { button: 1 });

    fireEvent.click(outsideControl(), { detail: 0 });

    expect(isOpen()).toBe(false);
  });

  test("an outside press of its own also clears a stale flag", () => {
    render(<Harness />);

    fireEvent.mouseDown(insideBox(), { button: 2 });
    fireEvent.contextMenu(insideBox());

    /*
     * The second line of defence, and the reason the two cases above avoid it:
     * a fresh press anywhere re-answers "did this gesture start inside", so an
     * ordinary click that follows one is never suppressed.
     */
    fireEvent.mouseDown(document.body);
    pointerClick(document.body);

    expect(isOpen()).toBe(false);
  });

  test("a keyboard-activated control outside still dismisses", () => {
    render(<Harness />);

    // An ordinary primary press inside, whose release never became a click.
    fireEvent.mouseDown(insideBox());

    /*
     * Enter on a focused control dispatches a click with no mousedown and a
     * detail of 0. No press can be responsible for it, so no press may
     * suppress it — this is the case the regression landed on.
     */
    fireEvent.click(outsideControl(), { detail: 0 });

    expect(isOpen()).toBe(false);
  });

  test("a programmatic element.click() outside still dismisses", () => {
    render(<Harness />);

    fireEvent.mouseDown(insideBox());

    // What LogExport does with a temporary anchor to start a download.
    const anchor: HTMLAnchorElement = document.createElement("a");
    document.body.appendChild(anchor);

    // Not a fireEvent, so React needs to be told to flush what it triggers.
    act(() => {
      anchor.click();
    });

    expect(isOpen()).toBe(false);

    anchor.remove();
  });

  test("a press inside whose release never lands leaves nothing armed", () => {
    render(<Harness />);

    // Dragged into a native drag, or the target unmounted mid-gesture.
    fireEvent.mouseDown(insideBox());

    fireEvent.click(outsideControl(), { detail: 0 });

    expect(isOpen()).toBe(false);
  });
});
