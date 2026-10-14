/*
 * What the status pages of a blocked project say to the team.
 *
 * A master admin blocks a project (Project.isBlocked, Admin Dashboard >
 * Projects) to take it offline, most often for abuse. Its status pages then
 * answer every public request as a page that does not exist would
 * (STATUS_PAGE_NOT_FOUND_MESSAGE), and their subscribers are sent nothing -
 * no incident or maintenance updates, no announcements, no reports, no
 * subscription confirmations - as an archived page's are not: the unsubscribe
 * link every message carries would lead to a page that is not there. The
 * team still sees the pages in the dashboard, where the reasons below are
 * given. Only a master admin can unblock the project.
 */

/*
 * A test report or a manual send from the dashboard, and a notification the
 * subscriber jobs did not send, for a page of a blocked project.
 */
export const STATUS_PAGE_OF_BLOCKED_PROJECT_SENDS_NOTHING_MESSAGE: string =
  "This project has been blocked, so its status pages send nothing to their subscribers. Please contact your administrator.";

// Adding a subscriber to a page of a blocked project.
export const STATUS_PAGE_OF_BLOCKED_PROJECT_NO_NEW_SUBSCRIBERS_MESSAGE: string =
  "This project has been blocked, so its status pages take no new subscribers. Please contact your administrator.";
