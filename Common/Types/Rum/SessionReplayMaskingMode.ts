/*
 * How aggressively the browser recorder masks page content before an
 * event ever leaves the end user's device.
 *
 * Masking is applied at capture, in the browser, BEFORE compression and
 * BEFORE the chunk is posted. The server never sees unmasked content, so
 * a leak cannot be repaired retroactively — which is why the default is
 * the strict mode rather than the useful-looking one.
 */
enum SessionReplayMaskingMode {
  /*
   * Default. Every text node and every input value is replaced with a
   * fixed-length placeholder at capture time. Playback shows layout,
   * interaction and shape — a wireframe — but no readable copy.
   */
  MaskAllText = "MaskAllText",

  /*
   * Input values only; static page text is recorded verbatim. Produces a
   * far more useful debugging artifact and matches what every competitor
   * defaults to, but any PII rendered into the page (order ids, email
   * addresses in a header, an error banner quoting user data) is
   * recorded. Surfaced in the UI as the explicitly less-safe option.
   */
  MaskInputsOnly = "MaskInputsOnly",
}

export default SessionReplayMaskingMode;
