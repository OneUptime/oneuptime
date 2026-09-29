import EntityDropdown from "../../../UI/Components/EntityDropdown/EntityDropdown";
import {
  DROPDOWN_MENU_Z_INDEX,
  DropdownOption,
} from "../../../UI/Components/Dropdown/Dropdown";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("EntityDropdown", () => {
  const options: Array<DropdownOption> = [
    { value: "members", label: "Members" },
    { value: "admins", label: "Admins" },
  ];
  const originalInnerHeight: number = window.innerHeight;
  const originalInnerWidth: number = window.innerWidth;

  const setViewport: (width: number, height: number) => void = (
    width: number,
    height: number,
  ): void => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: width,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: height,
    });
  };

  const makeRect: (
    left: number,
    top: number,
    width: number,
    height: number,
  ) => DOMRect = (
    left: number,
    top: number,
    width: number,
    height: number,
  ): DOMRect => {
    return {
      bottom: top + height,
      height,
      left,
      right: left + width,
      top,
      width,
      x: left,
      y: top,
      toJSON: (): Record<string, never> => {
        return {};
      },
    } as DOMRect;
  };

  const openDropdownAt: (rect: DOMRect) => HTMLInputElement = (
    rect: DOMRect,
  ): HTMLInputElement => {
    const input: HTMLInputElement = screen.getByRole("combobox", {
      name: "Team",
    }) as HTMLInputElement;
    const control: HTMLElement | null =
      input.parentElement?.parentElement || null;

    if (!control) {
      throw new Error("EntityDropdown control was not rendered.");
    }

    jest.spyOn(control, "getBoundingClientRect").mockReturnValue(rect);
    fireEvent.focus(input);

    return input;
  };

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    setViewport(originalInnerWidth, originalInnerHeight);
  });

  test("positions its fixed menu below the control above modal surfaces", () => {
    setViewport(1000, 800);
    render(<EntityDropdown ariaLabel="Team" options={options} />);

    openDropdownAt(makeRect(120, 200, 320, 40));

    const menu: HTMLElement = screen.getByTestId("entity-dropdown-menu");

    expect(menu.classList.contains("fixed")).toBe(true);
    expect(menu.style.top).toBe("244px");
    expect(menu.style.bottom).toBe("");
    expect(menu.style.left).toBe("120px");
    expect(menu.style.width).toBe("320px");
    expect(menu.style.maxHeight).toBe("384px");
    expect(menu.style.visibility).toBe("visible");
    expect(menu.style.zIndex).toBe(String(DROPDOWN_MENU_Z_INDEX));
  });

  test("flips its menu above a control near the modal footer", () => {
    setViewport(1000, 600);
    render(<EntityDropdown ariaLabel="Team" options={options} />);

    openDropdownAt(makeRect(120, 520, 320, 40));

    const menu: HTMLElement = screen.getByTestId("entity-dropdown-menu");

    expect(menu.style.top).toBe("");
    expect(menu.style.bottom).toBe("84px");
    expect(menu.style.maxHeight).toBe("384px");
    expect(menu.style.visibility).toBe("visible");
  });

  test("selects an option from the fixed menu", () => {
    const onChange: MockFunction = getJestMockFunction();
    setViewport(1000, 800);
    render(
      <EntityDropdown ariaLabel="Team" onChange={onChange} options={options} />,
    );

    openDropdownAt(makeRect(120, 200, 320, 40));
    fireEvent.click(screen.getByRole("option", { name: "Members" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("members");
    expect(screen.queryByTestId("entity-dropdown-menu")).toBeNull();
  });
});
