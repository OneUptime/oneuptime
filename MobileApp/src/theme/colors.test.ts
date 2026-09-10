import { darkColors } from "./colors";

function luminance(hex: string): number {
  const values: number[] = [1, 3, 5].map((offset: number) => {
    const channel: number = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
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
        expect(
          (luminance(foreground) + 0.05) / (luminance(surface) + 0.05),
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
  test.each([
    darkColors.actionPrimary,
    darkColors.stateAcknowledged,
    darkColors.stateResolved,
  ])("action button labels meet 4.5:1 on %s", (background: string) => {
    expect(
      (luminance(background) + 0.05) /
        (luminance(darkColors.backgroundPrimary) + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
