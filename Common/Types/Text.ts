export default class Text {
  public static convertBase64ToHex(textInBase64: string): string {
    if (!textInBase64) {
      return textInBase64;
    }

    if (!this.isBase64(textInBase64)) {
      return textInBase64;
    }

    const hex: string = Buffer.from(textInBase64, "base64").toString("hex");
    return hex;
  }

  /**
   * Matches an OTLP id already in hex form: 16 chars (8-byte span id)
   * or 32 chars (16-byte trace/profile id).
   */
  private static readonly OTLP_HEX_ID_REGEX: RegExp =
    /^(?:[0-9a-fA-F]{16}|[0-9a-fA-F]{32})$/;

  /**
   * Convert an OTLP wire id (trace / span / profile id) to lowercase hex.
   *
   * OTLP/protobuf carries ids as bytes, which protobuf decoders render
   * as base64 strings — but OTLP/JSON carries the SAME fields as hex
   * strings (32 chars for trace ids, 16 for span ids). Hex strings also
   * satisfy the base64 alphabet, so feeding them to convertBase64ToHex
   * would silently decode them into garbage bytes. Length disambiguates
   * safely: the base64 form of an 8/16-byte id is always 12/24 chars,
   * so a 16- or 32-char hex-only string can never be a base64 id.
   */
  public static convertOtlpIdToHex(value: string | undefined): string {
    if (!value) {
      return "";
    }

    if (Text.OTLP_HEX_ID_REGEX.test(value)) {
      return value.toLowerCase();
    }

    try {
      return Text.convertBase64ToHex(value);
    } catch {
      return "";
    }
  }

  public static getLetterFromAByNumber(number: number): string {
    return String.fromCharCode("a".charCodeAt(0) + number);
  }

  public static getNextLowercaseLetter(letter: string): string {
    const charCode: number = letter.charCodeAt(0);
    const nextLetter: string = String.fromCharCode(charCode + 1).toString();
    return nextLetter;
  }

  public static fromPascalCaseToDashes(text: string): string {
    let result: string = text.replace(/([A-Z])/g, " $1");
    result = result.trim();
    result = result.replace(/\s+/g, "-");
    return result.toLowerCase();
  }

  /*
   * Space out a PascalCase identifier for display: "MaskAllText" becomes
   * "Mask All Text".
   *
   * Casing is preserved rather than lowercased, so acronyms survive
   * ("OIDCProvider" -> "OIDC Provider" and not "Oidc Provider"). Text that
   * is already spaced is returned unchanged, which makes this safe to
   * apply to an enum whose values are a mix of both.
   *
   * LIMITATION, and the reason callers must opt in rather than getting
   * this for free: a case boundary inside a single word is
   * indistinguishable from a word boundary, so proper nouns and
   * initialisms that embed one come out wrong - "GitHub" -> "Git Hub",
   * "NodeJS" -> "Node JS", "IPv4Address" -> "I Pv4 Address". Do not use
   * this on values that are product names, identifiers, or anything else
   * that is not simply English words concatenated.
   */
  public static fromPascalCaseToReadable(text: string): string {
    if (!text) {
      return text;
    }

    return (
      text
        // "maskAll" / "v2Recorder" -> "mask All" / "v2 Recorder"
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        // "OIDCProvider" -> "OIDC Provider"; the run keeps its own casing.
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim()
    );
  }

  public static getFirstWord(text: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    const textArr: Array<string> = text.split(" ");

    let firstIndex: number = 0;

    while (firstIndex < textArr.length && !textArr[firstIndex]) {
      firstIndex++;
    }

    return textArr[firstIndex] || text;
  }

  public static getLastWord(text: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    const textArr: Array<string> = text.split(" ");

    let lastIndex: number = textArr.length - 1;

    while (lastIndex >= 0 && !textArr[lastIndex]) {
      lastIndex--;
    }

    return textArr[lastIndex] || text;
  }

  public static trimStartUntilThisWord(text: string, word: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    const index: number = text.indexOf(word);
    if (index === -1) {
      return text;
    }

    return text.substring(index);
  }

  public static trimUpQuotesFromStartAndEnd(text: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    if (text.startsWith('"') && !text.endsWith('"')) {
      text = text.substring(1);
    }

    if (text.endsWith('"') && !text.startsWith('"')) {
      text = text.substring(0, text.length - 1);
    }

    // check for single quotes

    if (text.startsWith("'") && !text.endsWith("'")) {
      text = text.substring(1);
    }

    if (text.endsWith("'") && !text.startsWith("'")) {
      text = text.substring(0, text.length - 1);
    }

    return text;
  }

  public static trimEndUntilThisWord(text: string, word: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    const index: number = text.lastIndexOf(word);
    if (index === -1) {
      return text;
    }

    return text.substring(0, index + word.length);
  }

  public static isBase64(text: string): boolean {
    if (!text || typeof text !== "string") {
      return false;
    }

    // Remove data URI prefix if present (e.g., data:image/jpeg;base64,)
    const base64String: string = text.replace(/^data:[^;]+;base64,/, "");

    // Check if string is empty after removing prefix
    if (!base64String) {
      return false;
    }

    // Base64 string length should be a multiple of 4
    if (base64String.length % 4 !== 0) {
      return false;
    }

    // Improved regex for Base64 validation
    const regex: RegExp = /^[A-Za-z0-9+/]*={0,2}$/;
    return regex.test(base64String);
  }

  public static extractBase64FromDataUri(text: string): string {
    if (!text || typeof text !== "string") {
      return text;
    }

    // Check if it's a data URI
    if (text.startsWith("data:")) {
      const base64Index: number = text.indexOf(";base64,");
      if (base64Index !== -1) {
        return text.substring(base64Index + 8); // 8 is length of ';base64,'
      }
    }

    // Return original string if not a data URI
    return text;
  }

  public static extractMimeTypeFromDataUri(text: string): string | null {
    if (!text || typeof text !== "string") {
      return null;
    }

    // Check if it's a data URI
    if (text.startsWith("data:")) {
      const mimeTypeEnd: number = text.indexOf(";");
      if (mimeTypeEnd !== -1) {
        return text.substring(5, mimeTypeEnd); // 5 is length of 'data:'
      }
    }

    return null;
  }

  /*
   * Cryptographically secure random bytes, or null if this runtime has no
   * CSPRNG at all.
   *
   * `globalThis.crypto` is the Web Crypto API: present in every browser, and a
   * global in Node since 19. It is used here rather than `require("crypto")`
   * because this file is bundled into the dashboard as well as the server, so
   * it cannot reach for a Node built-in.
   */
  private static getSecureRandomBytes(byteCount: number): Uint8Array | null {
    const webCrypto: { getRandomValues?: (array: Uint8Array) => Uint8Array } =
      (
        globalThis as unknown as {
          crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
        }
      ).crypto || {};

    if (typeof webCrypto.getRandomValues !== "function") {
      return null;
    }

    return webCrypto.getRandomValues(new Uint8Array(byteCount));
  }

  /*
   * Draw `length` characters uniformly at random from `characters`.
   *
   * TWO properties here are load-bearing, and this used to have neither:
   *
   * 1. The source is a CSPRNG. Math.random is a fast non-cryptographic PRNG
   *    (xorshift128+ in V8) whose entire internal state can be recovered from
   *    a handful of observed outputs and then run forwards AND backwards. For
   *    a value used as a secret that is worse than a short code: an attacker
   *    who sees one generated value predicts the next one exactly, with no
   *    guessing at all.
   *
   * 2. The draw is unbiased. `byte % n` is only uniform when n divides 256.
   *    Rejection sampling discards the short tail of the byte range instead of
   *    folding it, which is what keeps a k-character code at its full
   *    k * log2(n) bits of entropy.
   *
   * The Math.random fallback survives ONLY for the case where no CSPRNG exists
   * at all, which is unreachable on any supported runtime. It is there so the
   * non-secret callers - SQL alias suffixes in QueryHelper and friends, which
   * run on every query - cannot be broken by an exotic environment. Secrets
   * must NOT come through here: notification-channel codes go through
   * Common/Server/Utils/VerificationCode.ts, which throws rather than
   * downgrading.
   */
  private static generateRandomString(
    length: number,
    characters: string,
  ): string {
    const charactersLength: number = characters.length;

    /*
     * The largest multiple of charactersLength that fits in a byte. Bytes at
     * or above it are thrown away rather than folded - that is the whole of
     * the rejection sampling, and skipping it is what biases the result.
     */
    const unbiasedCeiling: number = 256 - (256 % charactersLength);

    let result: string = "";

    while (result.length < length) {
      const remaining: number = length - result.length;

      /*
       * Over-draw a little so a rejected byte usually does not cost a second
       * trip into the CSPRNG. With a 10-character alphabet fewer than 3% of
       * bytes are rejected, so one pass almost always finishes the job.
       */
      const bytes: Uint8Array | null = Text.getSecureRandomBytes(
        remaining + Math.ceil(remaining / 4) + 4,
      );

      if (!bytes) {
        while (result.length < length) {
          result += characters.charAt(
            Math.floor(Math.random() * charactersLength),
          );
        }

        return result;
      }

      for (let i: number = 0; i < bytes.length; i++) {
        if (result.length >= length) {
          break;
        }

        const byte: number | undefined = bytes[i];

        if (byte === undefined || byte >= unbiasedCeiling) {
          continue;
        }

        result += characters.charAt(byte % charactersLength);
      }
    }

    return result;
  }

  public static generateRandomText(length?: number): string {
    return Text.generateRandomString(
      length || 10,
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    );
  }

  public static trimLines(text: string): string {
    return text
      .split("\n")
      .map((line: string) => {
        return line.trim();
      })
      .join("\n");
  }

  /*
   * The alphabet used to be the string "12134567890" - eleven characters, with
   * "1" written twice and every digit therefore NOT equally likely. Combined
   * with Math.random that made a six-digit code both biased and predictable.
   * Both halves are fixed in generateRandomString above.
   */
  public static generateRandomNumber(length?: number): string {
    return Text.generateRandomString(length || 10, "0123456789");
  }

  public static convertNumberToWords(num: number): string {
    const words: Array<string> = [
      "first",
      "second",
      "third",
      "fourth",
      "fifth",
      "sixth",
      "seventh",
      "eighth",
      "ninth",
      "tenth",
      "eleventh",
      "twelfth",
      "thirteenth",
      "fourteenth",
      "fifteenth",
      "sixteenth",
      "seventeenth",
      "eighteenth",
      "nineteenth",
      "twentieth",
    ];

    if (num <= 20) {
      return words[num - 1]!;
    }

    if (num % 10 === 0) {
      return `${words[19]} ${words[num / 10 - 2]}`;
    }

    return `${words[19]} ${words[Math.floor(num / 10) - 2]}-${
      words[(num % 10) - 1]
    }`;
  }

  public static uppercaseFirstLetter(word: string): string {
    if (word.length > 0) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }
    return word;
  }

  public static fromDashesToPascalCase(word: string): string {
    let tempWord: string = word.replace(/-/g, " ");
    tempWord = tempWord.replace(/\b\w/g, (m: string): string => {
      return m.toUpperCase();
    });
    return tempWord;
  }

  public static pascalCaseToDashes(word: string): string {
    let tempWord: string = word.replace(/[A-Z]/g, (m: string): string => {
      return "-" + m.toLowerCase();
    });
    while (tempWord.includes(" ")) {
      tempWord = tempWord.replace(" ", "-");
    }

    if (tempWord.startsWith("-")) {
      tempWord = this.replaceAt(0, tempWord, " ");
    }

    if (tempWord.endsWith("-")) {
      tempWord = this.replaceAt(tempWord.length - 1, tempWord, " ");
    }

    return tempWord.toLowerCase().trim();
  }

  public static replaceAt(
    index: number,
    word: string,
    replacement: string,
  ): string {
    return (
      word.substring(0, index) +
      replacement +
      word.substring(index + replacement.length)
    );
  }

  public static replaceAll(
    sentence: string,
    search: string,
    replaceBy: string,
  ): string {
    return sentence.split(search).join(replaceBy);
  }

  public static truncate(
    value: string | null | undefined,
    maxLength: number,
  ): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (maxLength <= 0) {
      return "";
    }

    return value.length > maxLength ? value.slice(0, maxLength) : value;
  }
}
