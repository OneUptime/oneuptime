import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import Button from "../../../UI/Components/Button/Button";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * Button and MoreMenuItem have both accepted a `tooltip` for a long time, and
 * on a disabled control it did nothing at all. That is the one case where the
 * tooltip carries the whole message: a locked button with no explanation is
 * indistinguishable from a broken one.
 *
 * Two separate mechanisms conspired against it. A disabled form control
 * dispatches no pointer events and cannot be focused, so neither of tippy's
 * triggers ever fires; and tippy's own show() bails out early when its
 * reference element carries a `disabled` attribute. The fix needs both halves:
 * a hoverable, focusable wrapper to act as the reference, and
 * `pointer-events-none` on the button so hit-testing lands on that wrapper
 * instead of on the control that swallows events.
 *
 * These tests are the regression guard for both halves. Deleting either one
 * makes the "renders the tooltip" cases fail.
 *
 * Notes on asserting tippy under jsdom, learned the hard way:
 *   - the tooltip is portalled to document.body, so query with `screen`,
 *     never the render container;
 *   - the box stays data-state="hidden" because the animation never completes
 *     under jsdom - assert presence, not that attribute;
 *   - aria-describedby is not yet on the trigger immediately after mouseenter.
 */

describe("tooltips on disabled controls", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Button", () => {
    test("shows its tooltip on hover when enabled", () => {
      render(
        <Button
          dataTestId="btn"
          title="Create Monitor"
          tooltip="Some reason"
        />,
      );

      fireEvent.mouseEnter(screen.getByTestId("btn"));

      expect(screen.getByRole("tooltip")).toHaveTextContent("Some reason");
    });

    /*
     * The core assertion of the whole change. Before the fix this found no
     * tooltip at all: hovering a disabled button produced nothing, not even a
     * tippy root element.
     */
    test("shows its tooltip on hover when DISABLED", () => {
      render(
        <Button
          dataTestId="btn"
          title="Create Monitor"
          disabled={true}
          tooltip="You do not have permission to create this Monitor."
        />,
      );

      fireEvent.mouseEnter(screen.getByTestId("btn-disabled-wrapper"));

      expect(screen.getByRole("tooltip")).toHaveTextContent(
        "You do not have permission to create this Monitor.",
      );
    });

    /*
     * Half two of the fix. Without pointer-events-none the wrapper is never
     * hovered in a real browser, because the button on top of it eats the
     * pointer without dispatching anything. jsdom does not hit-test, so this
     * has to be asserted on the class directly.
     */
    test("takes a disabled button out of hit-testing so the wrapper can be hovered", () => {
      render(
        <Button
          dataTestId="btn"
          title="Create Monitor"
          disabled={true}
          tooltip="You do not have permission to create this Monitor."
        />,
      );

      expect(screen.getByTestId("btn")).toHaveClass("pointer-events-none");
    });

    test("keeps a disabled button reachable by keyboard for the tooltip", () => {
      render(
        <Button
          dataTestId="btn"
          title="Create Monitor"
          disabled={true}
          tooltip="You do not have permission to create this Monitor."
        />,
      );

      // A disabled button is out of the tab order; the wrapper stands in.
      expect(screen.getByTestId("btn-disabled-wrapper")).toHaveAttribute(
        "tabindex",
        "0",
      );

      fireEvent.focus(screen.getByTestId("btn-disabled-wrapper"));

      expect(screen.getByRole("tooltip")).toBeInTheDocument();
    });

    test("still marks the button disabled to assistive technology", () => {
      render(
        <Button
          dataTestId="btn"
          title="Create Monitor"
          disabled={true}
          tooltip="Nope"
        />,
      );

      const button: HTMLElement = screen.getByTestId("btn");

      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
    });

    test("does not fire onClick while disabled", () => {
      let clicked: boolean = false;

      render(
        <Button
          dataTestId="btn"
          title="Create Monitor"
          disabled={true}
          tooltip="Nope"
          onClick={() => {
            clicked = true;
          }}
        />,
      );

      fireEvent.click(screen.getByTestId("btn"));

      expect(clicked).toBe(false);
    });

    /*
     * isLoading hard-disables the button too, so it hits exactly the same
     * dead-tooltip path.
     */
    test("shows its tooltip while loading", () => {
      render(
        <Button
          dataTestId="btn"
          title="Saving"
          isLoading={true}
          tooltip="Working on it"
        />,
      );

      fireEvent.mouseEnter(screen.getByTestId("btn-disabled-wrapper"));

      expect(screen.getByRole("tooltip")).toHaveTextContent("Working on it");
    });

    /*
     * The enabled path is by far the most common one - 200-odd call sites - and
     * must keep rendering the bare button with no extra wrapper around it,
     * because layout in several places depends on the button being the direct
     * child of its flex container.
     */
    test("does not wrap an enabled button", () => {
      render(<Button dataTestId="btn" title="Create" tooltip="Hello" />);

      expect(screen.queryByTestId("btn-disabled-wrapper")).toBeNull();
    });

    test("does not wrap a disabled button that has nothing to say", () => {
      render(<Button dataTestId="btn" title="Create" disabled={true} />);

      expect(screen.queryByTestId("btn-disabled-wrapper")).toBeNull();
      expect(screen.getByTestId("btn")).not.toHaveClass("pointer-events-none");
    });
  });

  describe("MoreMenuItem", () => {
    /*
     * Header buttons that do not fit spill into a More menu, and bulk actions
     * live there permanently - so a locked Delete is just as likely to be seen
     * as a MoreMenuItem as it is as a Button.
     */
    test("shows its tooltip on hover when disabled", () => {
      render(
        <MoreMenuItem
          text="Delete"
          icon={IconProp.Trash}
          isDisabled={true}
          tooltip="You do not have permission to delete this Monitor."
          onClick={() => {}}
        />,
      );

      fireEvent.mouseEnter(screen.getByRole("menuitem").parentElement!);

      expect(screen.getByRole("tooltip")).toHaveTextContent(
        "You do not have permission to delete this Monitor.",
      );
    });

    test("takes a disabled item out of hit-testing", () => {
      render(
        <MoreMenuItem
          text="Delete"
          isDisabled={true}
          tooltip="Nope"
          onClick={() => {}}
        />,
      );

      expect(screen.getByRole("menuitem")).toHaveClass("pointer-events-none");
    });

    test("does not fire onClick while disabled", () => {
      let clicked: boolean = false;

      render(
        <MoreMenuItem
          text="Delete"
          isDisabled={true}
          tooltip="Nope"
          onClick={() => {
            clicked = true;
          }}
        />,
      );

      fireEvent.click(screen.getByRole("menuitem"));

      expect(clicked).toBe(false);
    });

    test("renders an enabled item unwrapped and clickable", () => {
      let clicked: boolean = false;

      render(
        <MoreMenuItem
          text="Delete"
          onClick={() => {
            clicked = true;
          }}
        />,
      );

      fireEvent.click(screen.getByRole("menuitem"));

      expect(clicked).toBe(true);
      expect(screen.getByRole("menuitem")).not.toHaveClass(
        "pointer-events-none",
      );
    });
  });
});
