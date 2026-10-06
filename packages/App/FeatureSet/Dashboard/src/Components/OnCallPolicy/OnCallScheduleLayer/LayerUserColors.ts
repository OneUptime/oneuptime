import { getMarkColor } from "Common/UI/Components/ColorPicker/ColorValue";
import { pickColorForName } from "Common/Utils/DistinctColor";

/*
 * A person's colour on the on-call screens.
 *
 * Every person has one colour, and it is the same wherever they are drawn:
 * their avatar in a layer's header, in the on-call users list and in the Add
 * user dialog, the rotation summary, the final schedule's calendar, summary
 * and overrides card, and the Schedule Timeline - so a reader can follow one
 * person from card to card without reading names. It is worked out from the
 * person's user id each time it is drawn and never stored: nothing is saved,
 * and nothing has to be migrated when the palette changes.
 *
 * The colours are Utils/DistinctColor's palette, the one OneUptime picks a new
 * label's or state's colour from: no black and no grey, every colour at least
 * 3:1 against both the light and the dark card, and no two of one hue family.
 * The list used before (BrandColors.BrightColors) starts with black and holds
 * a grey, so one person in twenty was drawn black - an avatar that vanished on
 * the dark theme - and another one in twenty grey, which reads as a disabled
 * account.
 */
export function getColorForUserId(userId: string): string {
  /*
   * Ids are compared the way the database writes them, so the same person
   * cannot come out two colours on two cards that spell their id differently.
   */
  return pickColorForName(userId.trim().toLowerCase()).toString();
}

export interface UserAvatarStyle {
  backgroundColor: string;
  color: string;
}

/*
 * An initials avatar: the person's colour behind, and initials in the mark
 * colour that reads on it (getMarkColor, white on every palette colour). Given
 * inline as a pair, so the avatar is the same on the light and the dark theme
 * and no card can pair a person's colour with initials that fade into it.
 */
export function getUserAvatarStyle(userId: string): UserAvatarStyle {
  const backgroundColor: string = getColorForUserId(userId);

  return { backgroundColor, color: getMarkColor(backgroundColor) };
}

/*
 * Up-to-two-letter initials for a user's avatar, derived from their name (or
 * email as a fallback). Shared by every avatar on the on-call screens so the
 * same user always shows the same initials.
 */
export function getUserInitials(name: string, email: string): string {
  const source: string = (name || email || "?").trim();
  const parts: Array<string> = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  }
  return source.substring(0, 2).toUpperCase();
}
