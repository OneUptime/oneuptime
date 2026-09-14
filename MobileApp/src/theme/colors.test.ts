import { describe, expect, test } from "@jest/globals";
import { darkColors, lightColors, type ColorTokens } from "./colors";

function luminance(hex: string): number {
  const values: number[] = [1, 3, 5].map((offset: number) => {
    const channel: number = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
}

function contrast(first: string, second: string): number {
  const values: number[] = [luminance(first), luminance(second)].sort(
    (a: number, b: number) => {
      return b - a;
    },
  );
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

const palettes: Array<[string, ColorTokens]> = [
  ["light", lightColors],
  ["dark", darkColors],
];

describe.each(palettes)(
  "the %s palette",
  (_name: string, colors: ColorTokens) => {
    const surfaces: string[] = [
      colors.backgroundPrimary,
      colors.backgroundSecondary,
      colors.backgroundElevated,
      colors.backgroundTertiary,
    ];

    test.each(surfaces)(
      "body, secondary, helper and link text meet 4.5:1 on %s",
      (surface: string) => {
        for (const foreground of [
          colors.textPrimary,
          colors.textSecondary,
          colors.textTertiary,
          colors.actionPrimary,
        ]) {
          expect(contrast(foreground, surface)).toBeGreaterThanOrEqual(4.5);
        }
      },
    );

    test("filled control labels meet 4.5:1 on every fill that carries one", () => {
      for (const fill of [
        colors.actionPrimary,
        colors.actionPrimaryPressed,
        colors.actionDestructive,
        colors.stateAcknowledged,
        colors.stateResolved,
        colors.statusSuccess,
        colors.statusError,
      ]) {
        expect(contrast(colors.textInverse, fill)).toBeGreaterThanOrEqual(4.5);
      }
    });

    test.each([
      ["severityCritical", "severityCriticalBg"],
      ["severityMajor", "severityMajorBg"],
      ["severityMinor", "severityMinorBg"],
      ["severityWarning", "severityWarningBg"],
      ["severityInfo", "severityInfoBg"],
      ["oncallActive", "oncallActiveBg"],
      ["oncallInactive", "oncallInactiveBg"],
      ["statusError", "statusErrorBg"],
      ["statusSuccess", "statusSuccessBg"],
      ["statusWarning", "statusWarningBg"],
      ["statusInfo", "statusInfoBg"],
      ["accentCyan", "accentCyanBg"],
      ["actionPrimary", "cardAccent"],
    ] as Array<[keyof ColorTokens, keyof ColorTokens]>)(
      "%s text is readable on its %s tint",
      (foreground: keyof ColorTokens, background: keyof ColorTokens) => {
        expect(
          contrast(colors[foreground], colors[background]),
        ).toBeGreaterThanOrEqual(4.5);
      },
    );

    test("status colours stay readable as text directly on a card", () => {
      for (const status of [
        colors.statusError,
        colors.statusSuccess,
        colors.statusWarning,
        colors.statusInfo,
        colors.severityCritical,
        colors.severityMajor,
      ]) {
        expect(
          contrast(status, colors.backgroundElevated),
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    test("cards are visibly distinct from the canvas behind them", () => {
      expect(colors.backgroundElevated).not.toBe(colors.backgroundPrimary);
      expect(colors.borderSubtle).not.toBe(colors.backgroundElevated);
    });
  },
);

describe("the two palettes", () => {
  test("define exactly the same tokens, so no screen reads undefined in one mode", () => {
    expect(Object.keys(darkColors).sort()).toEqual(
      Object.keys(lightColors).sort(),
    );
  });

  test("are genuinely different where it matters", () => {
    expect(darkColors.backgroundPrimary).not.toBe(
      lightColors.backgroundPrimary,
    );
    expect(darkColors.textPrimary).not.toBe(lightColors.textPrimary);
    expect(luminance(darkColors.backgroundPrimary)).toBeLessThan(
      luminance(lightColors.backgroundPrimary),
    );
  });

  test("every hex token is a valid six-digit colour", () => {
    for (const colors of [lightColors, darkColors]) {
      for (const [key, value] of Object.entries(colors)) {
        if (value.startsWith("#")) {
          expect(`${key}=${value}`).toMatch(/[=]#[0-9A-Fa-f]{6}$/);
        } else {
          expect(`${key}=${value}`).toMatch(/[=](transparent|rgba\(.+\))$/);
        }
      }
    }
  });
});
