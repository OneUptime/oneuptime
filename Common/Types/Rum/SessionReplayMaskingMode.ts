/*
 * How aggressively the browser recorder masks page content before an
 * event ever leaves the end user's device.
 *
 * Masking is applied at capture, in the browser, BEFORE compression and
 * BEFORE the chunk is posted. The server never sees unmasked content, so
 * a leak cannot be repaired retroactively — tightening the mode does not
 * scrub recordings that were already taken under a looser one.
 *
 * The three modes are ordered here from most useful to most private,
 * which is also the order they appear in the settings dropdown.
 */
enum SessionReplayMaskingMode {
  /*
   * Default. Only fields that are sensitive by their own markup are
   * masked: password inputs, and inputs whose autocomplete token marks
   * them as a card number, CVC, expiry or one-time code. Everything else
   * — static page text and ordinary input values alike — is recorded
   * verbatim, which is what makes a recording readable enough to debug
   * from.
   *
   * "Sensitive" is decided per node and is STICKY: once a field has ever
   * looked sensitive it stays masked for the life of the page, so a
   * "show password" toggle cannot unmask it. Anything the markup does not
   * declare (an account number rendered into a plain text input, an
   * order id in a heading) is NOT covered — use the mask and block
   * selectors on the application's policy for those.
   */
  MaskSensitiveInputsOnly = "MaskSensitiveInputsOnly",

  /*
   * Every input value is masked, whether or not the field looks
   * sensitive; static page text is still recorded verbatim. Choose this
   * when users type data into your app that the markup does not declare
   * as sensitive.
   */
  MaskInputsOnly = "MaskInputsOnly",

  /*
   * The strictest mode. Every text node and every input value is replaced
   * with a placeholder at capture time. Playback shows layout,
   * interaction and shape — a wireframe — but no readable copy.
   */
  MaskAllText = "MaskAllText",
}

/*
 * Narrow an untrusted value onto the enum.
 *
 * Used by the recorder on a config response, by the gate cache on a stored
 * column, and by the ingest envelope parser on recorder-supplied metadata.
 * All three fail CLOSED: anything unrecognised - a value from a newer
 * server than this build, a tampered response, a corrupted row - becomes
 * MaskAllText rather than the configured default, because the strictest
 * mode is the only one that is never wrong to apply.
 *
 * Must stay dependency-free: this module is bundled into the browser
 * recorder.
 */
export function parseSessionReplayMaskingMode(
  value: unknown,
): SessionReplayMaskingMode {
  switch (value) {
    case SessionReplayMaskingMode.MaskSensitiveInputsOnly:
      return SessionReplayMaskingMode.MaskSensitiveInputsOnly;
    case SessionReplayMaskingMode.MaskInputsOnly:
      return SessionReplayMaskingMode.MaskInputsOnly;
    default:
      return SessionReplayMaskingMode.MaskAllText;
  }
}

/*
 * Does this mode record readable page content? True for everything except
 * the wireframe mode. Drives the "this recording may contain readable
 * content" notice on the player, which must fire for BOTH relaxed modes -
 * keying that notice on a single enum member is how a new mode silently
 * stops warning anyone.
 */
export function doesMaskingModeRecordReadableContent(
  mode: SessionReplayMaskingMode,
): boolean {
  return mode !== SessionReplayMaskingMode.MaskAllText;
}

export default SessionReplayMaskingMode;
