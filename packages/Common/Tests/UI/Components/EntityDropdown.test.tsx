import EntityDropdown from "../../../UI/Components/EntityDropdown/EntityDropdown";
import {
  DROPDOWN_MENU_Z_INDEX,
  DropdownOption,
} from "../../../UI/Components/Dropdown/Dropdown";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
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

  /*
   * Found in Code's UI review: a dialog that opens on a dropdown with the
   * focus (Code's Add context > Incident) scales in, so the menu was placed
   * against the dialog's smaller, moving frame - and on a page where the
   * dialog's width class had not been styled yet, against a frame half as
   * wide again, the list running out past the dialog. The menu now follows
   * its control when a transition ends and when the control's size changes.
   */
  describe("follows its control after it opens", () => {
    const originalResizeObserver: typeof window.ResizeObserver | undefined =
      window.ResizeObserver;

    afterEach(() => {
      Object.defineProperty(window, "ResizeObserver", {
        configurable: true,
        writable: true,
        value: originalResizeObserver,
      });
    });

    const controlOf: (input: HTMLInputElement) => HTMLElement = (
      input: HTMLInputElement,
    ): HTMLElement => {
      const control: HTMLElement | null =
        input.parentElement?.parentElement || null;

      if (!control) {
        throw new Error("EntityDropdown control was not rendered.");
      }

      return control;
    };

    const nextFrames: () => Promise<void> = async (): Promise<void> => {
      await act(async () => {
        await new Promise((resolve: (value: unknown) => void) => {
          setTimeout(resolve, 50);
        });
      });
    };

    test("a dialog that scaled in: the menu moves to where the field rests", async () => {
      setViewport(1000, 800);
      render(<EntityDropdown ariaLabel="Team" options={options} />);

      const input: HTMLInputElement = screen.getByRole("combobox", {
        name: "Team",
      }) as HTMLInputElement;
      const rect: SpyInstance<() => DOMRect> = jest
        .spyOn(controlOf(input), "getBoundingClientRect")
        .mockReturnValue(makeRect(130, 210, 300, 38));
      fireEvent.focus(input);

      const menu: HTMLElement = screen.getByTestId("entity-dropdown-menu");
      expect(menu.style.width).toBe("300px");

      // The dialog's scale-in ends; its field is where it rests.
      rect.mockReturnValue(makeRect(120, 200, 320, 40));
      fireEvent(
        document.body,
        new Event("transitionend", { bubbles: true, cancelable: false }),
      );
      await nextFrames();

      expect(menu.style.left).toBe("120px");
      expect(menu.style.width).toBe("320px");
      expect(menu.style.top).toBe("244px");
    });

    test("a control whose size changes: the menu takes its new width", async () => {
      const observed: Array<() => void> = [];
      const targets: Array<Element> = [];
      const disconnects: Array<number> = [];

      class FakeResizeObserver {
        public constructor(callback: () => void) {
          observed.push(callback);
        }

        // The test calls the callback itself, as a resize would.
        public observe(target: Element): void {
          targets.push(target);
        }

        public disconnect(): void {
          disconnects.push(1);
        }
      }

      Object.defineProperty(window, "ResizeObserver", {
        configurable: true,
        writable: true,
        value: FakeResizeObserver,
      });

      setViewport(1000, 800);
      render(<EntityDropdown ariaLabel="Team" options={options} />);

      const input: HTMLInputElement = screen.getByRole("combobox", {
        name: "Team",
      }) as HTMLInputElement;
      const rect: SpyInstance<() => DOMRect> = jest
        .spyOn(controlOf(input), "getBoundingClientRect")
        .mockReturnValue(makeRect(120, 200, 480, 40));
      fireEvent.focus(input);

      const menu: HTMLElement = screen.getByTestId("entity-dropdown-menu");
      expect(menu.style.width).toBe("480px");
      // It watches the control itself.
      expect(observed.length).toBeGreaterThan(0);
      expect(targets).toContain(controlOf(input));

      // The page's styles arrive: the field narrows to the dialog's width.
      rect.mockReturnValue(makeRect(120, 200, 320, 40));
      act(() => {
        observed[observed.length - 1]!();
      });
      await nextFrames();
      expect(menu.style.width).toBe("320px");

      // Closed, it stops watching.
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByTestId("entity-dropdown-menu")).toBeNull();
      expect(disconnects.length).toBeGreaterThan(0);
    });
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

    /*
     * A chip shows the whole name, wrapping inside it: cut at 14rem, two
     * picks that differ only at their end ("checkout-api-eu-west-1" and
     * "...-eu-west-2") read the same.
     */
    test("a chip of a multi-select shows its whole name, never cut short", () => {
      const longName: string =
        "Kubernetes Cluster: production-checkout-api-eu-west-1";

      render(
        <EntityDropdown
          ariaLabel="Team"
          isMultiSelect={true}
          onChange={getJestMockFunction()}
          options={[...options, { value: "long", label: longName }]}
          value={["members", "long"]}
        />,
      );

      const name: HTMLElement = screen.getByText(longName);
      const chip: HTMLElement = name.parentElement as HTMLElement;

      // Named for tests that read a chip: its name is the whole label.
      expect(chip).toHaveAttribute("data-testid", "entity-dropdown-chip");
      expect(name).toHaveAttribute("data-testid", "entity-dropdown-chip-label");

      expect(name).not.toHaveClass("truncate");
      expect(name.className).not.toContain("max-w-[14rem]");
      expect(name).toHaveClass("min-w-0", "[overflow-wrap:anywhere]");
      // The chip is never wider than the row of chips.
      expect(chip).toHaveClass("inline-flex", "max-w-full");
      // And it still has its Remove.
      expect(
        screen.getByRole("button", { name: `Remove ${longName}` }),
      ).toBeInTheDocument();
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

  /*
   * An option with a line beside its name - a code repository's GitHub
   * organization/name beside the name it is called. The name and the line
   * used to shrink alike, so on a phone a short name beside a long line was
   * cut first: "infra" read "in..." beside
   * "acme-platform-engineering/terraform-infrastr...". The name takes the
   * row now, and the line never more than half of it; the browser suite
   * (E2E AutoRemediationRules) measures it at 390px.
   */
  describe("an option's name and the line beside it", () => {
    test("the name takes the row; the line keeps at most half of it, cut short first", () => {
      render(
        <EntityDropdown
          ariaLabel="Team"
          isMultiSelect={true}
          options={[
            {
              value: "infra",
              label: "infra",
              description:
                "acme-platform-engineering/terraform-infrastructure-live",
            },
          ]}
        />,
      );

      fireEvent.focus(screen.getByRole("combobox", { name: "Team" }));

      const option: HTMLElement = screen.getByRole("option", {
        name: /^infra/,
      });
      const spans: Array<HTMLElement> = Array.from(
        option.querySelectorAll(":scope > span"),
      ) as Array<HTMLElement>;
      expect(spans).toHaveLength(2);
      const name: HTMLElement = spans[0]!;
      const line: HTMLElement = spans[1]!;

      expect(name).toHaveTextContent("infra");
      expect(name.className.split(" ")).toEqual(
        expect.arrayContaining(["min-w-0", "flex-1", "truncate"]),
      );

      expect(line).toHaveTextContent(
        "acme-platform-engineering/terraform-infrastructure-live",
      );
      expect(line.className.split(" ")).toEqual(
        expect.arrayContaining(["max-w-[50%]", "flex-none", "truncate"]),
      );
      // It no longer pushes itself away from a name that shrinks with it.
      expect(line.className.split(" ")).not.toContain("ml-auto");
    });

    test("an option with no line is its name alone, taking the row", () => {
      render(<EntityDropdown ariaLabel="Team" options={options} />);

      fireEvent.focus(screen.getByRole("combobox", { name: "Team" }));

      const spans: Array<Element> = Array.from(
        screen
          .getByRole("option", { name: "Members" })
          .querySelectorAll(":scope > span"),
      );

      expect(spans).toHaveLength(1);
      expect(spans[0]!.className.split(" ")).toEqual(
        expect.arrayContaining(["min-w-0", "flex-1", "truncate"]),
      );
    });
  });
});
