/*
 * Text and input masking for session replay.
 *
 * Applied in the browser, before an event is buffered — the server never
 * receives the unmasked value, so nothing here can be repaired after the
 * fact.
 *
 * The central correctness point: rrweb's built-in mask replaces a value
 * with `'*'.repeat(value.length)`, which preserves the exact character
 * count. For a password, a one-time code, or a card number that is a
 * length oracle — it narrows a password search space, and it identifies a
 * 16-digit PAN as a PAN. So this module never emits length-preserving
 * output for input values.
 *
 * Must stay dependency-free — this is bundled into the browser recorder.
 */

const MASK_CHARACTER: string = "•";

/*
 * Input values collapse to a constant-width block regardless of input
 * length. Three characters is enough to render as "something was typed
 * here" without hinting at how much.
 */
const FIXED_INPUT_MASK_LENGTH: number = 3;

/*
 * Static text nodes get bucketed rather than fixed width, because a
 * paragraph collapsed to three characters destroys the layout that makes
 * a wireframe replay readable at all. The bucket leaks only which of
 * three coarse size classes the text fell into.
 */
const TEXT_BUCKET_SHORT_MAX: number = 8;
const TEXT_BUCKET_MEDIUM_MAX: number = 32;

const TEXT_BUCKET_SHORT_LENGTH: number = 4;
const TEXT_BUCKET_MEDIUM_LENGTH: number = 16;
const TEXT_BUCKET_LONG_LENGTH: number = 40;

/*
 * autocomplete tokens that mark a field as high-sensitivity regardless of
 * its input type. A "show password" toggle flips type="password" to
 * type="text", so type alone is not a durable signal — see
 * isStickySensitiveAutocomplete and the recorder's per-node WeakSet.
 */
const SENSITIVE_AUTOCOMPLETE_TOKENS: Array<string> = [
  "current-password",
  "new-password",
  "one-time-code",
  "cc-number",
  "cc-csc",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
  "cc-name",
];

/*
 * Input types whose *value* is masked in every mode. Kept separate from
 * the mode-dependent set so a MaskInputsOnly application still cannot
 * leak a password.
 */
const ALWAYS_SENSITIVE_INPUT_TYPES: Array<string> = ["password"];

export default class Masking {
  /*
   * Mask an input value. Constant width — never derived from the input
   * length. Returns the mask even for an empty value so that "field was
   * cleared" and "field was never touched" are not distinguishable in a
   * way that leaks.
   */
  public static maskInputValue(): string {
    return MASK_CHARACTER.repeat(FIXED_INPUT_MASK_LENGTH);
  }

  /*
   * Mask a static text node, preserving a coarse size class so layout
   * survives. Whitespace-only text is returned untouched: masking it
   * would collapse spacing without protecting anything.
   */
  public static maskText(value: string): string {
    if (!value) {
      return value;
    }

    if (value.trim().length === 0) {
      return value;
    }

    const length: number = value.trim().length;

    let maskedLength: number = TEXT_BUCKET_LONG_LENGTH;

    if (length <= TEXT_BUCKET_SHORT_MAX) {
      maskedLength = TEXT_BUCKET_SHORT_LENGTH;
    } else if (length <= TEXT_BUCKET_MEDIUM_MAX) {
      maskedLength = TEXT_BUCKET_MEDIUM_LENGTH;
    }

    return MASK_CHARACTER.repeat(maskedLength);
  }

  /*
   * True when a file input's value must be blanked. Always true: the DOM
   * value of a file input is `C:\fakepath\<real filename>`, and filenames
   * are routinely personal ("passport-scan.pdf", "payslip-march.pdf").
   * The recorder records that a file was chosen, never which one.
   */
  public static maskFileInputValue(): string {
    return "";
  }

  /* Does this input type carry a value that must be masked in every mode? */
  public static isAlwaysSensitiveInputType(inputType: string): boolean {
    return ALWAYS_SENSITIVE_INPUT_TYPES.includes(
      (inputType || "").toLowerCase(),
    );
  }

  /*
   * Does this autocomplete attribute mark the field as permanently
   * sensitive? Once true for a node, the recorder keeps masking it even
   * if the attribute or the input type later changes, and suppresses the
   * type mutation itself so playback cannot reveal the switch.
   */
  public static isStickySensitiveAutocomplete(
    autocompleteValue: string,
  ): boolean {
    if (!autocompleteValue) {
      return false;
    }

    /*
     * autocomplete accepts space-separated tokens with optional section
     * and billing/shipping prefixes ("section-payment billing cc-number"),
     * so every token is checked rather than the whole string compared.
     */
    const tokens: Array<string> = autocompleteValue
      .toLowerCase()
      .split(/\s+/)
      .filter((token: string): boolean => {
        return token.length > 0;
      });

    return tokens.some((token: string): boolean => {
      return SENSITIVE_AUTOCOMPLETE_TOKENS.includes(token);
    });
  }

  /*
   * Quantise an input event timestamp into coarse buckets.
   *
   * A masked password field still leaks inter-keystroke timing, which is
   * a published side channel for inferring typed content. Bucketing the
   * timestamps removes the signal while keeping playback smooth enough
   * that typing still looks like typing.
   */
  public static quantiseTimestamp(
    timestampMs: number,
    bucketMs: number = 250,
  ): number {
    if (!Number.isFinite(timestampMs) || bucketMs <= 0) {
      return timestampMs;
    }

    return Math.floor(timestampMs / bucketMs) * bucketMs;
  }
}
