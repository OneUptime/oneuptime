import { Clipboard } from "react-native";

/*
 * The one place the app writes to the clipboard.
 *
 * React Native still ships a core `Clipboard`, but it is deprecated in favour
 * of `@react-native-clipboard/clipboard`, which is a native module the app
 * does not carry (every extra native module is another EAS build). Keeping
 * the access behind this function means the day the core one is removed there
 * is exactly one line to change, and until then callers get a boolean instead
 * of an exception when the module is missing on a build.
 *
 * Nothing secret goes through here. A calendar link is a capability token,
 * but it is one the user is about to paste into Google Calendar anyway - the
 * clipboard is its intended destination, unlike a recovery code (see
 * BackupCodesScreen, which uses the share sheet for exactly that reason).
 */
export function copyToClipboard(text: string): boolean {
  try {
    Clipboard.setString(text);
    return true;
  } catch {
    return false;
  }
}
