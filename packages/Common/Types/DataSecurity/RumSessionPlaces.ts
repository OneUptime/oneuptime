/*
 * WHERE A RUM APPLICATION'S SESSIONS KEEP THE TAGS A PAGE GIVES THEM (#11458).
 *
 * A session's tags are what its page hands the session recorder with
 * setTags() and addTag() - in the browser (window.OneUptimeReplay, and the
 * queue's ["setTags", ...] and ["addTag", ...]) and in React Native. They
 * are stored as sent in every masking mode, to be searched for
 * (tag:build=1.2.3), in the session's own tags column, and everyone who can
 * list sessions reads them: a wider audience than the identity ACL over
 * what identify() hands it.
 *
 * A finding in one names it `sessions.tags.<key>`, and every place a
 * session replay store's place is read reads it by this: the scan
 * (TelemetryDataScanner), the records a finding was seen in
 * (TelemetryFindingOccurrences), Scrub It (TelemetryScrubTarget), Fix with
 * AI's front-end places (TelemetryLeakPlaces, TelemetryLeakFix) and the
 * pull request review (TelemetryWriteRules). A leaf, importing nothing, so
 * any of them may read it whichever loads first.
 */
export const RUM_SESSION_TAGS_PREFIX: string = "sessions.tags.";

// The session recorder call a session's tags come from, as a fix names it.
export const RUM_SET_TAGS_CALL: string = "setTags";

// Whether a session replay store's place is one of a session's tags.
export function isRumSessionTagLocation(
  location: string | null | undefined,
): boolean {
  const at: string = (location || "").trim();

  return (
    at.startsWith(RUM_SESSION_TAGS_PREFIX) &&
    at.length > RUM_SESSION_TAGS_PREFIX.length
  );
}

/*
 * The part of a session a place is in, as two places are told the same:
 * its tags (one tag's place, or the tags whole - `sessions.tags` - where
 * code hands them a key it does not spell out), its user's details (the
 * label and traits identify() gives it), or the recorder's attributes.
 * Null for a place that is no session's. Read in any case, as places are
 * compared lower-cased.
 */
export enum RumSessionPart {
  Tags = "Tags",
  User = "User",
  Attributes = "Attributes",
}

export function getRumSessionPart(
  location: string | null | undefined,
): RumSessionPart | null {
  const at: string = (location || "").trim().toLowerCase();

  if (
    at === RUM_SESSION_TAGS_PREFIX.slice(0, -1) ||
    at.startsWith(RUM_SESSION_TAGS_PREFIX)
  ) {
    return RumSessionPart.Tags;
  }

  if (at.startsWith("sessions.identifieduser")) {
    return RumSessionPart.User;
  }

  return at.startsWith("sessions.attributes.")
    ? RumSessionPart.Attributes
    : null;
}
