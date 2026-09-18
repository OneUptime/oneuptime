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

  it("is reachable from the keyboard when it is an action rather than a link", () => {
    /*
     * An action row has no href, so Link renders it as a role="button" with a
     * tab stop. Losing that would make the row mouse-only — a poor trade for a
     * row whose whole subject is the keyboard.
     */
    const onClick: MockFunction = getJestMockFunction();
    const { container } = render(
      <IconDropdownItem
        title="Keyboard shortcuts"
        icon={IconProp.Keyboard}
        onClick={onClick}
      />,
    );

    const row: HTMLElement = container.querySelector("a") as HTMLElement;

    expect(row).toHaveAttribute("role", "button");
    expect(row).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(row, { key: "Enter" });

    expect(onClick).toHaveBeenCalled();
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
