/*
 * What causes a session to be uploaded — the single decision that drives
 * the cost, storage and privacy-exposure profile of the whole feature.
 *
 * OnErrorOrFrustration is the observability-native default: the recorder
 * holds a rolling buffer and only uploads when something actually went
 * wrong, so a recording exists for very nearly every failed session
 * while costing roughly 15x less than recording everyone.
 */
enum SessionReplayCaptureTrigger {
  /*
   * Default. Upload only on error / unhandled rejection / 5xx response /
   * frustration signal, plus whatever the sample percentage picks up.
   */
  OnErrorOrFrustration = "OnErrorOrFrustration",

  /*
   * Upload every sampled session from its first event, whether or not
   * anything goes wrong. What users migrating from a marketing-analytics
   * tool expect to find. Materially more expensive and materially more
   * end-user data at rest.
   */
  Always = "Always",
}

export default SessionReplayCaptureTrigger;
