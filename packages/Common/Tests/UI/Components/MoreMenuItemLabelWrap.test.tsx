import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import IconProp from "../../../Types/Icon/IconProp";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import React from "react";

/*
 * A menu is a fixed 14rem wide (MoreMenu's PORTALED_MENU_WIDTH), so a long
 * label takes two lines: "Assign to Someone Else" needs 168px of the 166px
 * an item with an icon has, and most languages need more. The label wraps
 * balanced - "Assign to / Someone Else" - instead of leaving its last word
 * alone on the second line.
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
