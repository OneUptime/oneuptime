import Permission, { PermissionHelper } from "Common/Types/Permission";

/*
 * A permission Session Replay's copy asks a reader to get, by the title the
 * roles screen gives it: "List Session Replays", "Watch Session Replays",
 * "Edit RUM Application" (Common/Types/Permission.ts).
 *
 * The copy names it through a {{permission}} placeholder rather than in its
 * own words. The roles screen draws a permission's title as written, in
 * every language, so a sentence that worded the name itself sent readers
 * looking for a permission that is not on that screen: it asked for a "Read
 * Session Replay" permission that never existed, and some languages
 * translated "Edit RUM Application" while others kept it in English
 * (#6635). Filled from the catalogue, the sentence names exactly what a
 * project admin finds there, and a renamed permission renames the sentence
 * with it.
 *
 * React-free, so a module App's tests load (SessionReplayHealthError) can
 * import it.
 */
export function getSessionReplayPermissionTitle(
  permission: Permission,
): string {
  try {
    return PermissionHelper.getTitle(permission);
  } catch {
    // A permission without props is a programming error; its value still names it.
    return String(permission);
  }
}

/*
 * The grant that reads who a session's end user is: the reference the page
 * passed to identify(), and its traits. The server serves them only to a
 * project owner or admin, or to a role with this permission
 * (SESSION_REPLAY_IDENTITY_PERMISSIONS in Common/Server/API/TelemetryAPI.ts),
 * and the roles screen lists it as "Watch Session Replays". Every line that
 * says the identity is hidden names it by that title (#7096): "the identity
 * permission" is on no roles screen, so a reader who wanted to see who a
 * session belongs to had no way to find which grant gives it.
 */
export const SESSION_REPLAY_IDENTITY_PERMISSION: Permission =
  Permission.ReadRumSessionReplayPayload;

// "Watch Session Replays": the identity grant, by the roles screen's title.
export function getSessionReplayIdentityPermissionTitle(): string {
  return getSessionReplayPermissionTitle(SESSION_REPLAY_IDENTITY_PERMISSION);
}
