import { Blue500, BrightColors } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import HashCode from "Common/Types/HashCode";

/*
 * Deterministic per-user color used across the layer editor: the collapsed
 * layer header shows each user's avatar tinted with this color, and the final
 * schedule calendar colors each user's events with the same value. Keeping the
 * mapping in one place means the avatar in the header and the block in the
 * calendar always match.
 */
export function getColorForUserId(userId: string): string {
  const colorListLength: number = BrightColors.length;
  /*
   * HashCode.fromString may return a negative 32-bit int; abs first so the
   * modulo lands inside the BrightColors array instead of falling through to
   * the Blue500 default for every user with a negative hash.
   */
  const colorIndex: number =
    Math.abs(HashCode.fromString(userId)) % colorListLength;
  return (BrightColors[colorIndex] as Color)?.toString() || Blue500.toString();
}

/*
 * Up-to-two-letter initials for a user's avatar, derived from their name (or
 * email as a fallback). Shared by the collapsed header avatar stack and the
 * on-call users list so the same user always shows the same initials.
 */
export function getUserInitials(name: string, email: string): string {
  const source: string = (name || email || "?").trim();
  const parts: Array<string> = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  }
  return source.substring(0, 2).toUpperCase();
}
