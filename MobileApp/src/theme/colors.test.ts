import { lightColors as darkColors } from "./colors";

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

describe("readable text on every solid app surface", () => {
  const surfaces: string[] = [
    darkColors.backgroundPrimary,
    darkColors.backgroundSecondary,
    darkColors.backgroundElevated,
    darkColors.backgroundTertiary,
  ];
  const foregrounds: string[] = [
    darkColors.textPrimary,
    darkColors.textSecondary,
    darkColors.textTertiary,
    darkColors.actionPrimary,
  ];
  test.each(surfaces)(
    "body, secondary, helper and link text meet 4.5:1 on %s",
    (surface: string) => {
      for (const foreground of foregrounds) {
        expect(contrast(foreground, surface)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
  test.each([
    darkColors.actionPrimary,
    darkColors.stateAcknowledged,
    darkColors.stateResolved,
  ])("action button labels meet 4.5:1 on %s", (background: string) => {
    expect(contrast(background, darkColors.textInverse)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  test.each([
    [darkColors.severityCritical, darkColors.severityCriticalBg],
    [darkColors.severityMajor, darkColors.severityMajorBg],
    [darkColors.severityMinor, darkColors.severityMinorBg],
    [darkColors.severityWarning, darkColors.severityWarningBg],
    [darkColors.severityInfo, darkColors.severityInfoBg],
    [darkColors.oncallActive, darkColors.oncallActiveBg],
    [darkColors.oncallInactive, darkColors.oncallInactiveBg],
    [darkColors.statusError, darkColors.statusErrorBg],
    [darkColors.accentCyan, darkColors.accentCyanBg],
  ])(
    "status text %s is readable on its %s tint",
    (foreground: string, background: string) => {
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
