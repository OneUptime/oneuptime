import IconDropdownItem from "../../../UI/Components/Header/IconDropdown/IconDropdownItem";
import KeyboardShortcut from "../../../UI/Components/KeyboardShortcut/KeyboardShortcut";
import URL from "../../../Types/API/URL";
import IconProp from "../../../Types/Icon/IconProp";
import { describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Help menu's rows are the mouse-driven way into things that also have
 * keyboard shortcuts, so a row has to be able to show its own keycap without
 * losing the behaviour every other row has: a link that navigates, or an
 * action that runs and stays reachable from the keyboard.
 */

describe("IconDropdownItem", () => {
  it("renders its title", () => {
    const { getByText } = render(
      <IconDropdownItem title="Keyboard shortcuts" icon={IconProp.Keyboard} />,
    );

    expect(getByText("Keyboard shortcuts")).toBeInTheDocument();
  });

  it("renders a trailing keycap when one is given", () => {
    const { container, getByText } = render(
      <IconDropdownItem
        title="Keyboard shortcuts"
        icon={IconProp.Keyboard}
        rightElement={<KeyboardShortcut keys={["?"]} />}
      />,
    );

    expect(getByText("Keyboard shortcuts")).toBeInTheDocument();
    expect(container.querySelector("kbd")).toHaveTextContent("?");
  });

  it("renders no trailing element when none is given", () => {
    const { container } = render(
      <IconDropdownItem title="Contact support" icon={IconProp.Email} />,
    );

    expect(container.querySelector("kbd")).toBeNull();
  });

  it("runs its action when clicked", () => {
    const onClick: MockFunction = getJestMockFunction();
    const { getByText } = render(
      <IconDropdownItem
        title="Keyboard shortcuts"
        icon={IconProp.Keyboard}
        onClick={onClick}
      />,
    );

    fireEvent.click(getByText("Keyboard shortcuts"));

    expect(onClick).toHaveBeenCalled();
  });

  /*
   * A row of a header menu is a menu item (#7237): the menu's arrow keys
   * move the focus to it (tabindex -1), and Enter runs an action. It was a
   * role="button" with a tab stop of its own, in a role="menu" that then
   * held no menu item for a screen reader to find.
   */
  it("is a menu item the menu's keys reach when it is an action rather than a link", () => {
    const onClick: MockFunction = getJestMockFunction();
    const { container, getByRole } = render(
      <IconDropdownItem
        title="Keyboard shortcuts"
        icon={IconProp.Keyboard}
        onClick={onClick}
      />,
    );

    const row: HTMLElement = container.querySelector("a") as HTMLElement;

    expect(getByRole("menuitem", { name: "Keyboard shortcuts" })).toBe(row);
    expect(row).toHaveAttribute("tabindex", "-1");
    expect(row).not.toHaveAttribute("href");

    fireEvent.keyDown(row, { key: "Enter" });

    expect(onClick).toHaveBeenCalled();
  });

  it("is a menu item that keeps its link when given a url: a new tab still opens it", () => {
    const { getByRole } = render(
      <IconDropdownItem
        title="Documentation"
        icon={IconProp.Book}
        openInNewTab={true}
        url={URL.fromString("https://oneuptime.com/docs")}
      />,
    );

    const row: HTMLElement = getByRole("menuitem", { name: "Documentation" });

    expect(row.tagName).toBe("A");
    expect(row).toHaveAttribute("href", "https://oneuptime.com/docs");
    expect(row).toHaveAttribute("target", "_blank");
    expect(row).toHaveAttribute("tabindex", "-1");
  });

  it("shows where the keyboard's focus is, as the pointer's hover does, with a ring", () => {
    const { getByRole } = render(
      <IconDropdownItem
        title="Glossary"
        icon={IconProp.BookOpen}
        onClick={getJestMockFunction()}
      />,
    );

    expect(getByRole("menuitem", { name: "Glossary" })).toHaveClass(
      "hover:bg-gray-50",
      "focus-visible:bg-gray-50",
      "focus-visible:ring-2",
    );
  });

  it("still renders a real link when given a url", () => {
    const { container } = render(
      <IconDropdownItem
        title="Contact support"
        icon={IconProp.Email}
        url={URL.fromString("mailto:support@oneuptime.com")}
      />,
    );

    expect(container.querySelector("a")).toHaveAttribute(
      "href",
      "mailto:support@oneuptime.com",
    );
  });
});
