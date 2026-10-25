import MoreMenu from "../../../UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import MoreMenuSection from "../../../UI/Components/MoreMenu/MoreMenuSection";
import IconProp from "../../../Types/Icon/IconProp";
import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import React from "react";

/*
 * A menu is a fixed 14rem wide (MoreMenu's PORTALED_MENU_WIDTH), so a long
 * label takes two lines: "Assign to Someone Else" needs 168px of the 166px
 * an item with an icon has, and most languages need more. The label wraps
 * balanced - "Assign to / Someone Else" - instead of leaving its last word
 * alone on the second line. And an item reads in either direction: in
 * Persian its mark sits on the right, with the gap still between the mark
 * and the label.
 */

afterEach(() => {
  cleanup();
});

describe("MoreMenuItem label", () => {
  test("wraps into balanced lines, keeping its weight", () => {
    render(
      <MoreMenuItem
        text="Assign to Someone Else"
        icon={IconProp.UserPlus}
        onClick={() => {}}
      />,
    );

    const label: HTMLElement = screen.getByText("Assign to Someone Else");

    expect(label).toHaveClass("text-balance", "font-medium");
    expect(
      screen.getByRole("menuitem", { name: "Assign to Someone Else" }),
    ).toContainElement(label);
  });

  test("reads in either direction: the gap sits between the mark and the label, and lines start where reading starts", () => {
    render(
      <>
        <MoreMenuItem
          text="Assign to Someone Else"
          icon={IconProp.UserPlus}
          onClick={() => {}}
        />
        <MoreMenuItem
          text="Unchecked"
          isIconSpaceReserved={true}
          onClick={() => {}}
        />
      </>,
    );

    const item: HTMLElement = screen.getByRole("menuitem", {
      name: "Assign to Someone Else",
    });

    /*
     * Logical, not left/right: in Persian the mark is on the right, and a
     * right margin put its gap on the menu's edge, the mark against the label.
     */
    expect(item).toHaveClass("text-start");
    expect(item).not.toHaveClass("text-left");

    const marks: Array<Element> = [
      // Icon puts its classes on the svg itself.
      item.querySelector("svg")!,
      screen
        .getByRole("menuitem", { name: "Unchecked" })
        .querySelector('span[aria-hidden="true"]')!,
    ];

    for (const mark of marks) {
      expect(mark).toHaveClass("me-2.5");
      expect(mark).not.toHaveClass("mr-2.5");
    }
  });

  test("the open menu aligns its section headings to the reading start too", async () => {
    render(
      <MoreMenu ariaLabel="More case actions" isMenuPortaled={true}>
        {[
          <MoreMenuSection key="priority" title="Set priority">
            <MoreMenuItem text="Critical" onClick={() => {}} />
          </MoreMenuSection>,
          <MoreMenuItem
            key="assign"
            text="Assign to Someone Else"
            icon={IconProp.UserPlus}
            onClick={() => {}}
          />,
        ]}
      </MoreMenu>,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "More case actions" }),
      );
    });

    const menu: HTMLElement = await screen.findByRole("menu");

    // A Persian "Set priority" heading sits over its items, on the right.
    expect(menu).toHaveClass("text-start");
    expect(menu).not.toHaveClass("text-left");
  });

  test("a destructive or locked item's label wraps the same way", () => {
    render(
      <>
        <MoreMenuItem
          text="Delete Case"
          icon={IconProp.Trash}
          isDestructive={true}
          onClick={() => {}}
        />
        <MoreMenuItem
          text="Assign to Someone Else"
          icon={IconProp.UserPlus}
          isDisabled={true}
          tooltip="You do not have permission to update this Security Case."
          onClick={() => {}}
        />
      </>,
    );

    expect(screen.getByText("Delete Case")).toHaveClass("text-balance");
    expect(screen.getByText("Assign to Someone Else")).toHaveClass(
      "text-balance",
    );
  });
});
