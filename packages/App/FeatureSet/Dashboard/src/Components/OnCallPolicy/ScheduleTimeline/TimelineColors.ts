import { getColorForUserId } from "../OnCallScheduleLayer/LayerUserColors";

/*
 * A person's colour on the timeline: the same per-user colour the layer
 * editor uses, except near-black. The shared palette starts with pure black,
 * which on the timeline only ever appears as a translucent tint, a border and
 * a swatch - all of which vanish on the dark-mode surface. It is lifted to a
 * mid slate that reads on both white and slate backgrounds.
 */

export const NEAR_BLACK_REPLACEMENT: string = "#64748b"; // slate-500

const HEX_COLOR: RegExp = /^#?([0-9a-fA-F]{6})$/;

export function getTimelineColor(color: string): string {
  const match: RegExpExecArray | null = HEX_COLOR.exec(color.trim());

  if (!match || !match[1]) {
    return color;
  }

  const hex: string = match[1];
  const red: number = parseInt(hex.slice(0, 2), 16);
  const green: number = parseInt(hex.slice(2, 4), 16);
  const blue: number = parseInt(hex.slice(4, 6), 16);

  const luminance: number = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance < 0.15 ? NEAR_BLACK_REPLACEMENT : color;
}

export function getTimelineColorForUserId(userId: string): string {
  return getTimelineColor(getColorForUserId(userId));
}
