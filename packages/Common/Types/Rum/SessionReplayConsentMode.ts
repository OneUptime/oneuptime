/*
 * Whether the recorder needs an explicit consent grant from the host
 * page before it may upload anything.
 *
 * In RequireExplicit the recorder still *records* into its in-memory
 * ring buffer (so the pre-roll leading up to an error is not lost while
 * a cookie banner is on screen) but uploads nothing until the host page
 * calls grantConsent(). revokeConsent() drops the buffer outright.
 */
enum SessionReplayConsentMode {
  /*
   * Nothing is uploaded until the host page grants consent. Chunks carry
   * their consentState and the ingest worker drops any chunk marked
   * Unknown when the application requires explicit consent, so a
   * recorder that skips the handshake fails closed server-side too. Most
   * EU deployments want this mode; it is not the default because a
   * page that never calls grantConsent() records nothing at all, which
   * is indistinguishable from a broken install on day one.
   */
  RequireExplicit = "RequireExplicit",

  /*
   * Default (RumApplication.sessionReplayConsentMode). The customer
   * asserts they have a lawful basis that does not require a per-session
   * grant (for example an internal admin tool covered by an employment
   * agreement). Uploads begin immediately.
   */
  NotRequired = "NotRequired",
}

export default SessionReplayConsentMode;
