/*
 * The words a feed entry or a channel line says for somebody it has no name
 * to give (FeedPersonName, the rule they are part of). Here on their own so
 * the pure line writers - OnCallChatText, and the docs that quote it - read
 * them without the reads FeedPersonName makes.
 */

// Someone only invited to the project, with no name typed for them (#10616).
export const FEED_INVITEE_UNNAMED: string =
  "someone who hasn't joined the project yet";

/*
 * Somebody a line cannot tell who they are: whether they are only invited
 * could not be read, or OneUptime has no name for them.
 */
export const FEED_NOBODY_NAMED: string = "Somebody";
