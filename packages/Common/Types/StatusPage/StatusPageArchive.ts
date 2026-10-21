/*
 * What an archived status page says, to its visitors and to the team.
 *
 * An archived status page is offline: every public route answers as if the
 * page did not exist (so a visitor cannot tell "archived" from "never
 * existed"), and its subscribers are sent nothing - no incident or
 * maintenance updates, no announcements, no reports. The team still sees
 * and edits it in the dashboard, where the reasons below are given in full.
 */

// What a visitor (or a public API call) gets for an archived page.
export const STATUS_PAGE_NOT_FOUND_MESSAGE: string = "Status Page not found";

// A test report or a manual send from the dashboard for an archived page.
export const STATUS_PAGE_ARCHIVED_SENDS_NOTHING_MESSAGE: string =
  "This status page is archived, so it sends nothing to its subscribers. Unarchive it first.";

// Adding a subscriber to an archived page.
export const STATUS_PAGE_ARCHIVED_NO_NEW_SUBSCRIBERS_MESSAGE: string =
  "This status page is archived, so it takes no new subscribers. Unarchive it first.";
