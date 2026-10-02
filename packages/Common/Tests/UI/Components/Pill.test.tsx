import Pill, { PillSize } from "../../../UI/Components/Pill/Pill";
import {
  getPillColors,
  PillColors,
} from "../../../UI/Components/Pill/PillColors";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import Color from "../../../Types/Color";
import { Black, Gray500, Green, Red } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import * as React from "react";
import { describe, expect, test } from "@jest/globals";

/*
 * The pill is a soft badge: a dot in the caller's colour, a pale wash of it,
 * a hairline ring and a readable shade of it for the text (PillColors.ts
 * works those out and has the contrast tests). What is held here is the
 * wiring: the light theme's colours inline, the dark theme's as the custom
 * properties Theme.css swaps in, and the props that shape the pill.
 */

function getPill(): HTMLElement {
  return screen.getByTestId("pill");
}

function getDot(): HTMLElement {
  return within(getPill()).getByTestId("pill-dot");
}

describe("<Pill />", () => {
  test("renders its text and nothing else as text", () => {
    render(<Pill text="Love" color={new Color("#807149")} />);

    // Callers match on the exact text; the dot must not add any.
    expect(getPill().textContent).toBe("Love");
  });

  describe("sizes", () => {
    test.each([
      [PillSize.Small, "10px"],
      [PillSize.Normal, "13px"],
      [PillSize.Large, "15px"],
      [PillSize.ExtraLarge, "18px"],
    ])("%s sets the font size to %s", (size: PillSize, fontSize: string) => {
      render(<Pill text="Love" color={new Color("#807149")} size={size} />);

      expect(getPill()).toHaveStyle({ fontSize });
    });

    test("is Normal when no size is given", () => {
      render(<Pill text="Love" color={new Color("#807149")} />);

      expect(getPill().style.fontSize).toBe(PillSize.Normal);
    });

    test("spaces itself in em, so every size is the same pill scaled", () => {
      render(<Pill text="Love" color={new Color("#807149")} />);

      expect(getPill().className).toMatch(/\bpx-\[[\d.]+em\]/);
      expect(getPill().className).toMatch(/\bpy-\[[\d.]+em\]/);
      expect(getDot().className).toMatch(/\bh-\[[\d.]+em\]/);
    });
  });

  describe("colours", () => {
    test.each(["#ff0000", "#786598", "#2ab57d", "#ffffff", "#000000"])(
      "paints %s's light colours inline",
      (hex: string) => {
        const colors: PillColors = getPillColors(hex);
        render(<Pill text="Love" color={new Color(hex)} />);

        expect(getPill()).toHaveStyle({
          backgroundColor: colors.light.backgroundColor,
          color: colors.light.textColor,
        });
        expect(getPill().style.boxShadow).toBe(
          `inset 0 0 0 1px ${colors.light.ringColor}`,
        );
        expect(getDot()).toHaveStyle({
          backgroundColor: colors.light.dotColor,
        });
      },
    );

    test("the dot is the caller's colour", () => {
      render(<Pill text="Connected" color={Green} />);

      expect(getDot()).toHaveStyle({ backgroundColor: Green.toString() });
    });

    test("is a tint, not the old solid swatch of the colour", () => {
      render(<Pill text="Disabled" color={Red} />);

      expect(getPill().style.backgroundColor).toMatch(/^rgba\(.+, 0\.\d+\)$/);
      expect(getPill().style.color).not.toBe("rgb(255, 255, 255)");
    });

    test("carries the dark theme's colours for Theme.css", () => {
      const colors: PillColors = getPillColors(Green);
      render(<Pill text="Connected" color={Green} />);

      expect(getPill()).toHaveAttribute("data-ou-pill");
      expect(getPill().style.getPropertyValue("--ou-pill-dark-bg")).toBe(
        colors.dark.backgroundColor,
      );
      expect(getPill().style.getPropertyValue("--ou-pill-dark-text")).toBe(
        colors.dark.textColor,
      );
      expect(getPill().style.getPropertyValue("--ou-pill-dark-shadow")).toBe(
        `inset 0 0 0 1px ${colors.dark.ringColor}`,
      );
      expect(getDot()).toHaveAttribute("data-ou-pill-dot");
      expect(getDot().style.getPropertyValue("--ou-pill-dark-dot")).toBe(
        colors.dark.dotColor,
      );
    });

    test("accepts a colour that arrived as a plain string", () => {
      // API payloads hand some models' colours over unwrapped.
      render(<Pill text="Love" color={"#2ab57d" as unknown as Color} />);

      expect(getDot()).toHaveStyle({ backgroundColor: "#2ab57d" });
    });

    test("falls back to gray when the colour is missing", () => {
      render(<Pill text="Love" color={undefined as unknown as Color} />);

      expect(getDot()).toHaveStyle({ backgroundColor: Gray500.toString() });
    });

    test("falls back to gray, rather than throwing, on a colour it cannot read", () => {
      // The old pill threw from Color.shouldUseDarkText and took the page down.
      expect(() => {
        render(<Pill text="Love" color={new Color("teal")} />);
      }).not.toThrow();

      expect(getDot()).toHaveStyle({ backgroundColor: Gray500.toString() });
    });
  });

  describe("style", () => {
    test("is merged in, and wins over the computed colours", () => {
      render(
        <Pill
          text="Love"
          color={Green}
          style={{
            backgroundColor: "rgb(1, 2, 3)",
            color: "rgb(4, 5, 6)",
            marginRight: "5px",
          }}
        />,
      );

      expect(getPill()).toHaveStyle({
        backgroundColor: "rgb(1, 2, 3)",
        color: "rgb(4, 5, 6)",
        marginRight: "5px",
      });
    });

    test("an overridden colour is the dark theme's too, so it wins there", () => {
      render(
        <Pill
          text="Love"
          color={Green}
          style={{
            backgroundColor: "rgb(1, 2, 3)",
            color: "rgb(4, 5, 6)",
            boxShadow: "none",
          }}
        />,
      );

      expect(getPill().style.getPropertyValue("--ou-pill-dark-bg")).toBe(
        "rgb(1, 2, 3)",
      );
      expect(getPill().style.getPropertyValue("--ou-pill-dark-text")).toBe(
        "rgb(4, 5, 6)",
      );
      expect(getPill().style.getPropertyValue("--ou-pill-dark-shadow")).toBe(
        "none",
      );
    });

    test("a size in style beats the size prop, as before", () => {
      render(
        <Pill
          text="Love"
          color={Green}
          size={PillSize.Small}
          style={{ fontSize: "20px" }}
        />,
      );

      expect(getPill()).toHaveStyle({ fontSize: "20px" });
    });
  });

  describe("minimal", () => {
    test("is a neutral outline with the colour only in its dot", () => {
      render(<Pill text="Acknowledged" color={Red} isMinimal={true} />);

      expect(getPill()).toHaveClass(
        "text-gray-700",
        "ring-1",
        "ring-inset",
        "ring-gray-200",
      );
      expect(getPill().style.backgroundColor).toBe("");
      expect(getPill().style.color).toBe("");
      expect(getPill()).not.toHaveAttribute("data-ou-pill");
      expect(getDot()).toHaveStyle({ backgroundColor: Red.toString() });
      expect(getDot().style.getPropertyValue("--ou-pill-dark-dot")).toBe(
        getPillColors(Red).dark.dotColor,
      );
    });

    test("honours size, which it used to ignore", () => {
      render(
        <Pill
          text="Acknowledged"
          color={Red}
          isMinimal={true}
          size={PillSize.Small}
        />,
      );

      expect(getPill()).toHaveStyle({ fontSize: "10px" });
    });

    test("honours icon, which it used to ignore", () => {
      const { container } = render(
        <Pill
          text="Secret"
          color={Gray500}
          isMinimal={true}
          icon={IconProp.Lock}
        />,
      );

      expect(container.querySelector("svg")).not.toBeNull();
      expect(screen.queryByTestId("pill-dot")).toBeNull();
    });

    test("honours style, which it used to ignore", () => {
      render(
        <Pill
          text="Acknowledged"
          color={Red}
          isMinimal={true}
          style={{ marginRight: "5px" }}
        />,
      );

      expect(getPill()).toHaveStyle({ marginRight: "5px" });
    });

    test("is still the pill test id", () => {
      render(<Pill text="Acknowledged" color={Black} isMinimal={true} />);

      expect(getPill()).toHaveTextContent(/^Acknowledged$/);
    });
  });

  describe("icon", () => {
    test("renders the icon in place of the dot", () => {
      const { container } = render(
        <Pill text="Love" color={new Color("#807149")} icon={IconProp.Label} />,
      );

      /*
       * The icon renders an inline <svg>. (It no longer uses the invalid
       * role="icon" ARIA role, which was removed for WCAG 4.1.2 compliance.)
       */
      expect(container.querySelector("svg")).not.toBeNull();
      expect(screen.queryByTestId("pill-dot")).toBeNull();
      expect(getPill().textContent).toBe("Love");
    });

    test("sizes the icon to the text", () => {
      const { container } = render(
        <Pill text="Enabled" color={Green} icon={IconProp.Check} />,
      );

      expect(container.querySelector("svg")).toHaveClass("h-[1em]", "w-[1em]");
    });
  });

  describe("the dot", () => {
    test("is hidden from assistive technology", () => {
      render(<Pill text="Love" color={Green} />);

      expect(getDot()).toHaveAttribute("aria-hidden", "true");
    });
  });

  describe("long text", () => {
    function setWidths(
      element: HTMLElement,
      widths: { scrollWidth: number; clientWidth: number },
    ): void {
      Object.defineProperty(element, "scrollWidth", {
        configurable: true,
        value: widths.scrollWidth,
      });
      Object.defineProperty(element, "clientWidth", {
        configurable: true,
        value: widths.clientWidth,
      });
    }

    function getText(): HTMLElement {
      return screen.getByText("Disabled — telemetry refused");
    }

    test("stays on one line and ellipsizes inside its container", () => {
      render(<Pill text="Disabled — telemetry refused" color={Red} />);

      expect(getPill()).toHaveClass("max-w-full");
      expect(getText()).toHaveClass("truncate", "min-w-0");
    });

    test("shows its whole text on hover when it is cut short", () => {
      render(<Pill text="Disabled — telemetry refused" color={Red} />);
      setWidths(getText(), { scrollWidth: 240, clientWidth: 120 });

      fireEvent.mouseEnter(getText());

      expect(getText()).toHaveAttribute(
        "title",
        "Disabled — telemetry refused",
      );
    });

    test("adds no hover text when it fits", () => {
      render(<Pill text="Disabled — telemetry refused" color={Red} />);
      setWidths(getText(), { scrollWidth: 120, clientWidth: 120 });

      fireEvent.mouseEnter(getText());

      expect(getText()).not.toHaveAttribute("title");
    });

    test("drops the hover text once it fits again", () => {
      render(<Pill text="Disabled — telemetry refused" color={Red} />);
      setWidths(getText(), { scrollWidth: 240, clientWidth: 120 });
      fireEvent.mouseEnter(getText());

      setWidths(getText(), { scrollWidth: 240, clientWidth: 240 });
      fireEvent.mouseEnter(getText());

      expect(getText()).not.toHaveAttribute("title");
    });

    test("leaves hover to the tooltip when there is one", () => {
      render(
        <Pill
          text="Disabled — telemetry refused"
          color={Red}
          tooltip="Ingestion with this key is refused."
        />,
      );
      setWidths(getText(), { scrollWidth: 240, clientWidth: 120 });

      fireEvent.mouseEnter(getText());

      expect(getText()).not.toHaveAttribute("title");
    });
  });

  describe("tooltip", () => {
    test("wraps the pill without changing it", () => {
      render(<Pill text="Private" color={Red} tooltip="Owners only" />);

      expect(getPill()).toHaveTextContent(/^Private$/);
      expect(getPill()).toHaveAttribute("data-ou-pill");
    });
  });
});
