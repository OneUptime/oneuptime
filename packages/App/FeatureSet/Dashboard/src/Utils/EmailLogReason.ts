/*
 * Why an email of the project went or did not, as its Email Log words it.
 *
 * The rule lives in Common (Common/UI/Utils/EmailLogReason), because the
 * Admin Dashboard's lists of a project's people say Email Not Sent too
 * (#9518). This module keeps the Dashboard's own import path for it: the
 * Email Logs table reads it from here.
 */
export * from "Common/UI/Utils/EmailLogReason";
