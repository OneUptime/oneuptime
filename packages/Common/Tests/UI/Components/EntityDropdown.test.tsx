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
    expect(onChange).toHaveBeenCalledWith("members", {
      selectedOptions: [{ value: "members", label: "Members" }],
      previousOptions: [],
    });
    expect(screen.queryByTestId("entity-dropdown-menu")).toBeNull();
  });

  /*
   * What the pick was, as the list showed it: a form fills in a name after
   * the record picked (a status page resource's display name follows its
   * monitor) without asking the server for the record again, and can tell
   * the name of what was picked before from one somebody typed.
   */
  describe("tells onChange what the pick changed", () => {
    test("a new pick, and the one it replaced", () => {
      const onChange: MockFunction = getJestMockFunction();
      render(
        <EntityDropdown
          ariaLabel="Team"
          onChange={onChange}
          options={options}
          value="members"
        />,
      );

      // A single-select showing its value opens from the value.
      fireEvent.click(screen.getByRole("button", { name: /Members/ }));
      fireEvent.click(screen.getByRole("option", { name: "Admins" }));

      expect(onChange).toHaveBeenCalledWith("admins", {
        selectedOptions: [{ value: "admins", label: "Admins" }],
        previousOptions: [{ value: "members", label: "Members" }],
      });
    });

    test("a cleared pick: nothing picked now, and what was picked before", () => {
      const onChange: MockFunction = getJestMockFunction();
      render(
        <EntityDropdown
          ariaLabel="Team"
          onChange={onChange}
          options={options}
          value="admins"
        />,
      );

      fireEvent.click(
        screen.getAllByRole("button", { name: "Clear selection" })[0]!,
      );

      expect(onChange).toHaveBeenCalledWith(null, {
        selectedOptions: [],
        previousOptions: [{ value: "admins", label: "Admins" }],
      });
    });

    test("a removed chip of a multi-select: the rest, and all of them before", () => {
      const onChange: MockFunction = getJestMockFunction();
      render(
        <EntityDropdown
          ariaLabel="Team"
          isMultiSelect={true}
          onChange={onChange}
          options={options}
          value={["members", "admins"]}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Remove Members" }));

      expect(onChange).toHaveBeenCalledWith(["admins"], {
        selectedOptions: [{ value: "admins", label: "Admins" }],
        previousOptions: [
          { value: "members", label: "Members" },
          { value: "admins", label: "Admins" },
        ],
      });
    });

    /*
     * An id the list has no label for yet is no name: it is left out rather
     * than handed over as its own label.
     */
    test("never hands over a raw id as a label", () => {
      const onChange: MockFunction = getJestMockFunction();
      render(
        <EntityDropdown
          ariaLabel="Team"
          onChange={onChange}
          options={options}
          value="an-id-the-list-does-not-know"
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: /an-id-the-list-does-not-know/ }),
      );
      fireEvent.click(screen.getByRole("option", { name: "Members" }));

      expect(onChange).toHaveBeenCalledWith("members", {
        selectedOptions: [{ value: "members", label: "Members" }],
        previousOptions: [],
      });
    });
  });
});
