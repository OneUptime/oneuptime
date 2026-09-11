/*
 * The session facts the correlation panel renders, apart from the panel.
 *
 * ReplayManifest.ts builds this object and is pure; the panel that displays
 * it is React. Keeping the shape here means the manifest builder (and the
 * node tests over it) never pull react into their program.
 * ReplayCorrelationPanel.tsx re-exports the name, so callers are unchanged.
 */

export interface ReplaySessionDetails {
  entryUrl: string;
  exitUrl: string;
  browserName: string;
  browserVersion: string;
  osName: string;
  deviceType: string;
  countryCode: string;
  /*
   * null: the manifest did not supply identity - the viewer lacks the
   * identity permission, so the panel must not claim the session is
   * anonymous. "": supplied and empty - the page never called identify().
   */
  identifiedUserLabel: string | null;
  /* Only present when the manifest supplied them (same ACL as the label). */
  identifiedUserTraits?: Record<string, string> | null | undefined;
  /*
   * The pseudonymous identity digest ("" when the page never called
   * identify()) and the recorder's per-browser visitor id ("" from a
   * recorder that predates it). Neither is identity-gated - the list
   * already returns both to every list-capable caller and neither names
   * anyone - and neither is rendered as text: they are what the player
   * hands back to /list to find this person's OTHER sessions, so the
   * viewer can move between them without leaving the playback view
   * (github.com/OneUptime/oneuptime/issues/3705).
   */
  identifiedUserKey: string;
  visitorId: string;
  tags?: Record<string, string> | null | undefined;
  maskingMode: string;
  consentState: string;
  triggerReason: string;
  recorderVersion: string;
  rrwebVersion: string;
  recorderCapabilities?: Array<string> | undefined;
  viewportWidth: number;
  viewportHeight: number;
  clockSkewMs: number;
  payloadBytes: number;
  startTime: string;
  endTime: string;
  durationMs?: number | undefined;
  /* Blank while the session is still open. */
  sealedReason?: string | undefined;
  isFinalized?: boolean | undefined;
  traceIds: Array<string>;
  exceptionFingerprints: Array<string>;
}
