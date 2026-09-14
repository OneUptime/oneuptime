/*
 * What causes a session to be uploaded — the single decision that drives
 * the cost, storage and privacy-exposure profile of the whole feature.
 *
 * Always is the default. Replay earns its keep on the sessions where
 * NOTHING threw: the checkout nobody completed, the form everybody
 * abandoned, the support call about a page that "looked wrong". A
 * recorder that only uploads failures answers half the questions people
 * open a session list to ask, and - worse - makes the other half look
 * broken, because a session with no recording is indistinguishable from
 * a feature that does not work.
 */
enum SessionReplayCaptureTrigger {
  /*
   * Default. Upload every sampled session from its first event, whether
   * or not anything goes wrong. The sample percentage (100 by default) is
   * the dial for cost: halve it and you halve both the bytes stored and
   * the end-user data at rest.
   */
  Always = "Always",

  /*
   * Upload only on error / unhandled rejection / 5xx response /
   * frustration signal, plus whatever the sample percentage picks up.
   *
   * The recorder holds a rolling in-memory buffer and uploads it
   * retroactively when something goes wrong, so a recording exists for
   * very nearly every FAILED session while costing roughly 15x less than
   * recording everyone. Choose it when storage or data minimisation
   * matters more than being able to watch an ordinary session.
   */
  OnErrorOrFrustration = "OnErrorOrFrustration",
}

export default SessionReplayCaptureTrigger;
