import Pill from "../../../UI/Components/Pill/Pill";
import {
  getContrastRatio,
  getPillColors,
  parseColor,
  PillColors,
  PillThemeColors,
  composite,
} from "../../../UI/Components/Pill/PillColors";
import {
  getPillToneColor,
  PILL_TONE_COLORS,
  PillTone,
} from "../../../UI/Components/Pill/PillTone";
import StatusBadge, {
  STATUS_BADGE_TONES,
  StatusBadgeType,
} from "../../../UI/Components/StatusBadge/StatusBadge";
import Badge, {
  BADGE_TONES,
  BadgeType,
} from "../../../UI/Components/Badge/Badge";
import { Gray500, Green, Red } from "../../../Types/BrandColors";
import { RGB } from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import * as React from "react";
import { describe, expect, test } from "@jest/globals";

/*
 * ONE CHIP, A FEW TONES (#9137).
 *
 * A Pill, a StatusBadge and a menu's count Badge draw the same idea - how
 * something is doing - so they share one set of tones and one look. These
 * hold the tones' contrast in both themes, the Paused tone's calm hollow dot,
 * and the two older components drawing through the Pill's colours.
 */

const SURFACES: Record<"light" | "dark", Array<RGB>> = {
  light: [
    { red: 255, green: 255, blue: 255 },
    { red: 249, green: 250, blue: 251 },
  ],
  dark: [
    { red: 15, green: 23, blue: 42 },
    { red: 23, green: 32, blue: 51 },
    { red: 30, green: 41, blue: 59 },
  ],
};

function textContrast(tone: PillThemeColors, surface: RGB): number {
  const match: RegExpMatchArray = tone.backgroundColor.match(
    /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/,
  )!;
  const wash: RGB = composite(
    { red: Number(match[1]), green: Number(match[2]), blue: Number(match[3]) },
    Number(match[4]),
    surface,
  );

  return getContrastRatio(parseColor(tone.textColor)!, wash);
}

const ALL_TONES: Array<PillTone> = Object.values(PillTone);

describe("PillTone", () => {
  test.each(ALL_TONES)(
    "the %s tone's text reads at 4.5:1 or better in both themes",
    (tone: PillTone) => {
      const colors: PillColors = getPillColors(getPillToneColor(tone));

      for (const surface of SURFACES.light) {
        expect(textContrast(colors.light, surface)).toBeGreaterThanOrEqual(4.5);
      }

      for (const surface of SURFACES.dark) {
        expect(textContrast(colors.dark, surface)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  test("a choice is never drawn in a broken thing's red: Paused is grey", () => {
    expect(PILL_TONE_COLORS[PillTone.Paused]).toBe(Gray500);
    expect(PILL_TONE_COLORS[PillTone.Paused]).not.toBe(
      PILL_TONE_COLORS[PillTone.Danger],
    );
    // The colours pages already passed for these states, so nothing shifts.
    expect(PILL_TONE_COLORS[PillTone.Success]).toBe(Green);
    expect(PILL_TONE_COLORS[PillTone.Danger]).toBe(Red);
  });

  test("no tone and no colour is Neutral", () => {
    expect(getPillToneColor(undefined)).toBe(Gray500);
    render(<Pill text="Default" />);
    expect(screen.getByTestId("pill")).toHaveAttribute("data-tone", "neutral");
  });
});

describe("<Pill tone />", () => {
  test("paints its tone's colours, light inline and dark for Theme.css", () => {
    render(<Pill text="Failed" tone={PillTone.Danger} />);
    const pill: HTMLElement = screen.getByTestId("pill");
    const colors: PillColors = getPillColors(Red);

    expect(pill).toHaveAttribute("data-tone", "danger");
    expect(pill).toHaveAttribute("data-ou-pill", "");
    expect(pill.style.color).not.toBe("");
    expect(pill.style.getPropertyValue("--ou-pill-dark-text")).toBe(
      colors.dark.textColor,
    );
  });

  test("a colour someone picked wins over a tone, and is no tone", () => {
    render(<Pill text="Network" tone={PillTone.Danger} color={Green} />);
    const pill: HTMLElement = screen.getByTestId("pill");

    expect(pill).not.toHaveAttribute("data-tone");
    expect(pill.style.getPropertyValue("--ou-pill-dark-text")).toBe(
      getPillColors(Green).dark.textColor,
    );
  });

  test("Paused draws a hollow dot, a light that is off, swapped in the dark theme", () => {
    render(<Pill text="Disabled" tone={PillTone.Paused} />);
    const dot: HTMLElement = within(screen.getByTestId("pill")).getByTestId(
      "pill-dot",
    );

    expect(dot).toHaveAttribute("data-hollow", "true");
    expect(dot).toHaveAttribute("data-ou-pill-hollow-dot", "");
    expect(dot).not.toHaveAttribute("data-ou-pill-dot");
    expect(dot.style.backgroundColor).toBe("transparent");
    expect(dot.style.boxShadow).toContain("inset");
    expect(dot.style.getPropertyValue("--ou-pill-dark-dot")).toBe(
      getPillColors(Gray500).dark.dotColor,
    );
  });

  test("other tones draw a filled dot", () => {
    render(<Pill text="Enabled" tone={PillTone.Success} />);
    const dot: HTMLElement = screen.getByTestId("pill-dot");

    expect(dot).toHaveAttribute("data-ou-pill-dot", "");
    expect(dot).not.toHaveAttribute("data-hollow");
  });

  test("a tag can leave its dot out; an icon still shows", () => {
    const { container } = render(
      <>
        <Pill text="Beta" isDotHidden={true} dataTestId="tag" />
        <Pill
          text="Connected"
          tone={PillTone.Success}
          icon={IconProp.Check}
          isDotHidden={true}
          dataTestId="with-icon"
        />
      </>,
    );

    expect(screen.queryByTestId("pill-dot")).toBeNull();
    expect(screen.getByTestId("with-icon").querySelector("svg")).not.toBeNull();
    expect(container.querySelector('[data-testid="tag"]')).not.toBeNull();
  });

  test("takes a class for where it sits and a test id", () => {
    render(
      <Pill
        text="Ready"
        tone={PillTone.Info}
        className="ml-auto flex-shrink-0"
        dataTestId="ready"
      />,
    );
    const pill: HTMLElement = screen.getByTestId("ready");

    expect(pill).toHaveClass("ml-auto", "flex-shrink-0", "rounded-full");
  });
});

describe("<StatusBadge /> is a Pill", () => {
  test.each(Object.values(StatusBadgeType))(
    "%s draws the Pill's tone",
    (type: StatusBadgeType) => {
      render(<StatusBadge text="State" type={type} />);
      const pill: HTMLElement = screen.getByTestId("pill");

      expect(pill).toHaveAttribute("data-tone", STATUS_BADGE_TONES[type]);
      // No gradient of its own any more.
      expect(pill.className).not.toContain("bg-gradient");
    },
  );

  test("no type is Neutral; a long one-line badge ends in ... in a flex row", () => {
    render(<StatusBadge text="Waiting for its first check" isOneLine={true} />);
    const pill: HTMLElement = screen.getByTestId("pill");

    expect(pill).toHaveAttribute("data-tone", "neutral");
    expect(pill).toHaveClass("min-w-0", "max-w-full");
    expect(within(pill).getByTestId("pill-text")).toHaveClass("truncate");
  });

  test("a badge of a few words wraps between them, never inside one", () => {
    render(<StatusBadge text="Partially degraded" />);

    expect(screen.getByTestId("pill-text")).toHaveClass(
      "[overflow-wrap:break-word]",
    );
  });
});

describe("<Badge /> counts in the Pill's tones", () => {
  test.each([
    [BadgeType.DANGER, PillTone.Danger],
    [BadgeType.WARNING, PillTone.Warning],
    [BadgeType.SUCCESS, PillTone.Success],
    [BadgeType.NEUTRAL, PillTone.Neutral],
    [BadgeType.PAUSED, PillTone.Paused],
  ])("badge type %s is the %s tone", (type: BadgeType, tone: PillTone) => {
    expect(BADGE_TONES[type]).toBe(tone);
    render(<Badge id="count" badgeCount={3} badgeType={type} />);
    const badge: HTMLElement = screen.getByTestId("count");

    expect(badge).toHaveAttribute("data-tone", tone);
    expect(badge).toHaveAttribute("data-ou-pill", "");
    expect(badge.className).not.toContain("bg-gradient");
    expect(badge.className).not.toContain("shadow");
    expect(badge.style.getPropertyValue("--ou-pill-dark-text")).toBe(
      getPillColors(getPillToneColor(tone)).dark.textColor,
    );
  });
});
