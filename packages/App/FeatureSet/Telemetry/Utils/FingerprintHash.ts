import crypto from "crypto";
import Crypto from "Common/Utils/Crypto";

/*
 * A lone surrogate: a high one with no low after it, or a low one with no
 * high before it. One pass over the text; no backtracking.
 */
const LONE_SURROGATE: RegExp =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/*
 * An exception's fingerprint hash: the SHA-256 of the text in lowercase
 * hex, exactly as Common/Utils/Crypto.getSha256Hash (crypto-js, pure
 * JavaScript) writes it, but by Node's own hash - every exception in a log
 * or a span event is hashed twice at ingest (grouping v1 and v2), and
 * crypto-js spent most of its time converting the text (#6086, a follow-up
 * of #5358).
 *
 * crypto-js reads the text as UTF-8 through encodeURIComponent, which
 * throws a URIError on a lone surrogate. Such a text still goes to
 * crypto-js, so it fails as it always did rather than being fingerprinted
 * now: an exception that was never stored is not stored under a new hash.
 */
export function fingerprintSha256(text: string): string {
  if (LONE_SURROGATE.test(text)) {
    return Crypto.getSha256Hash(text);
  }

  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}
