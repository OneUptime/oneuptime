/*
 * Why a session was uploaded at all.
 *
 * The recorder keeps a rolling in-memory buffer and, in the default
 * capture mode, uploads nothing until one of these fires. Storing the
 * reason lets the read side explain *why* a recording exists, and lets
 * analytics un-bias counts against the sample percentage in force at
 * capture time.
 */
enum SessionReplayTriggerReason {
  /* An uncaught error or unhandled promise rejection was observed. */
  Error = "error",

  /* A rage click, dead click, error click or refresh-rage was observed. */
  Frustration = "frustration",

  /* Picked up by the deterministic sample percentage, nothing went wrong. */
  Sampled = "sampled",

  /* The host page called OneUptimeReplay.captureSession() explicitly. */
  Manual = "manual",

  /*
   * A performance budget was blown: LCP, a main-thread long task, or an
   * instrumented request over the application's configured budget. Slow
   * sessions get recordings the same way broken ones do.
   */
  Performance = "performance",
}

export default SessionReplayTriggerReason;
