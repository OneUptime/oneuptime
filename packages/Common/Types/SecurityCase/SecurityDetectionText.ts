/*
 * HOW MUCH OF A TEXT A DETECTION KEEPS.
 *
 * A detection's and its case's text columns - a title, a fingerprint, the
 * value a rule grouped on, a rule's name, an event's uid - keep at most
 * SECURITY_DETECTION_TEXT_LIMIT characters: a longer text is recorded cut
 * short, ending in an ellipsis (SecurityCaseIngest). What reads a recorded
 * value back as a match - the case reading a detection's events again by
 * its group (SecurityCaseMatches, #9939) - matches a cut-short value by its
 * start.
 *
 * Shared by the server, which records and reads them. Free of anything
 * server-only.
 */

export const SECURITY_DETECTION_TEXT_LIMIT: number = 480;

const CUT_SHORT_MARK: string = "…";

// A text as a detection keeps it: whole, or cut short to the limit, ending in an ellipsis.
export function cutShortDetectionText(text: string): string {
  return text.length > SECURITY_DETECTION_TEXT_LIMIT
    ? `${text.slice(0, SECURITY_DETECTION_TEXT_LIMIT - 1)}${CUT_SHORT_MARK}`
    : text;
}

/*
 * The start of a recorded text that was cut short - all of it but the
 * ellipsis - or null for a text kept whole.
 */
export function getCutShortDetectionTextStart(text: string): string | null {
  return text.length === SECURITY_DETECTION_TEXT_LIMIT &&
    text.endsWith(CUT_SHORT_MARK)
    ? text.slice(0, -CUT_SHORT_MARK.length)
    : null;
}
