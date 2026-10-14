/*
 * THE TIMELINE'S LINE FOR SOMEBODY A PAGE NAMES A SECOND TIME.
 *
 * One escalation rule, or one direct page, can reach the same person more
 * than once: named themselves and as a member of a team it names, a member
 * of two of its teams, on call in two of its schedules. They are paged once.
 * Each further time, the run's timeline records a Skipped line for them with
 * these words, so the run's own page shows every target it went through.
 *
 * The line says nothing a reader has to act on - the person was paged - so
 * the run's Slack and Microsoft Teams message leaves it out
 * (OnCallPolicyRunMessage), and so does the feed of the record a direct page
 * is about (OnCallDutyPolicyExecutionLogTimelineService), where "did not
 * page Jane" under "paged Jane" would read as a page that failed.
 */
export const ALREADY_PAGED_TIMELINE_MESSAGE: string =
  "Skipped because notification sent to this user already.";
