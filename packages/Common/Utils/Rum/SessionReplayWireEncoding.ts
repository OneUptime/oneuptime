/*
 * Byte-level encoding of a session-replay chunk POST, chosen so that a web
 * application firewall between the customer's page and OneUptime lets it
 * through.
 *
 * Customers route the recorder through their own edge (Azure Front Door,
 * Application Gateway, Cloudflare, a ModSecurity or Coraza proxy), and those
 * edges run the OWASP Core Rule Set or a ruleset baselined on it. Two of its
 * rules decide whether a chunk arrives at all:
 *
 *  - 920420 refuses any Content-Type outside a short allowlist. That is why
 *    SESSION_REPLAY_CONTENT_TYPE is application/octet-stream - see its note.
 *    An octet-stream body also selects no body processor, so the firewall
 *    never turns the envelope's URLs or trait values into ARGS for the
 *    injection rules, the way it does for an OTLP/JSON request.
 *
 *  - 921110 ("HTTP Request Smuggling Attack") still reads the RAW body of a
 *    request no processor parsed. After t:urlDecodeUni, t:htmlEntityDecode
 *    and t:lowercase it looks for
 *
 *      <method>\s+(?:/|\w)[^\s]*(?:\s+http/\d|[\r\n])
 *
 *    where <method> is get, post, put, head, copy, move, lock, track, trace,
 *    patch, delete, options, connect and a few more, matched INSIDE words:
 *    "target", "budget", "widget", "input", "ahead", "remove", "block".
 *
 *    A frame is `<envelope JSON>\n<payload>`, and that newline is the [\r\n]
 *    the rule wants. An envelope whose url was /search/gadget+case reads,
 *    decoded, `...gadget case","routes":[...]...}\n`: the word, whitespace,
 *    a run with no whitespace in it, then the frame's own newline - and the
 *    whole chunk is blocked. So is an identified user called "Bridget
 *    Jones", a path with a %20 in it, or a %0A anywhere in the body.
 *
 * The rule ends either on a line break or on `http/<digit>`. This file
 * leaves it neither:
 *
 *  1. No transform can DECODE a line break out of the body. Every `%` and
 *     `&` inside a JSON string goes out as its \uXXXX escape, so there is
 *     nothing for t:urlDecodeUni (%0a, %u000d, ...) or t:htmlEntityDecode
 *     (&#10;, &#x0d;, ...) to decode, and JSON text never contains a literal
 *     CR or LF. Applied to the envelope AND to every event of the payload -
 *     the uncompressed terminal flush is plain JSON too.
 *
 *  2. The only line breaks left are the frame separators, and every one of
 *     them has a SPACE in front of it. A match ending there needs a run of
 *     non-whitespace characters right before the newline; the space makes
 *     that run empty. Without it, whatever precedes the newline - the
 *     envelope, and through it the tail of the previous frame's payload,
 *     which is text with spaces in it - is exactly such a run.
 *
 *  3. The slash of every `http/` goes out as JSON's own `\/` escape, so a
 *     page that shows an HTTP request line - API documentation printing
 *     "GET /v1/users HTTP/1.1", recorded verbatim under the default masking
 *     mode - cannot match through the rule's other ending. With `%` and `&`
 *     escaped nothing can decode a slash back in front of the digit.
 *
 * (1) and (2) are each insufficient alone, and the tests hold all three.
 * Whitespace itself is left alone on purpose: with nothing left to end on
 * it cannot complete a match, and escaping it would grow trait values and
 * DOM text by a sixth or more against the envelope cap and the keepalive
 * quota.
 *
 * A gzip payload is opaque bytes and can contain anything; measured against
 * CRS 3.3.2, random and real compressed payloads match nothing.
 *
 * None of this changes what the server reads. JSON.parse decodes \uXXXX to
 * the same characters and ignores the space before the newline, and the
 * envelope parser has always sliced up to the first 0x0A and parsed that -
 * so every server version accepts these frames, and this server still
 * accepts frames from recorders that predate them.
 *
 * This file must stay dependency-free: it is bundled into the browser
 * recorder as well as imported by the server. The mobile recorder cannot
 * import it at all (it is published into customer apps without Common), so
 * it carries a copy that its ContractParity test holds to this one.
 */

/*
 * What ends every envelope line: a space, then the 0x0A separator the
 * parser splits on. The space is load-bearing - see (2) above.
 */
export const SESSION_REPLAY_ENVELOPE_TERMINATOR: string = " \n";

/*
 * `%`, `&`, and the slash of `http/` in any case. No lookbehind: the
 * recorder still loads on browsers that cannot parse one.
 */
const ESCAPED_SEQUENCES: RegExp = /[%&]|(http)\//gi;

export default class SessionReplayWireEncoding {
  /*
   * The complete header line of one frame: the envelope as escaped JSON,
   * then SESSION_REPLAY_ENVELOPE_TERMINATOR. The payload bytes follow it
   * directly.
   *
   * Byte budgets on the envelope (the recorder's 7 KB, the parser's 8 KB)
   * are measured on THIS string: each `%` and `&` is six bytes here.
   *
   * `unknown` rather than the envelope type: the browser and the mobile
   * recorder each have their own, and the E2E helpers build theirs loose.
   * Anything JSON.stringify turns into an object is a valid argument.
   */
  public static encodeEnvelopeLine(envelope: unknown): string {
    return (
      SessionReplayWireEncoding.escapeJson(JSON.stringify(envelope)) +
      SESSION_REPLAY_ENVELOPE_TERMINATOR
    );
  }

  /*
   * Rewrite every `%` and `&` in a JSON text as "\u0025" / "\u0026", and
   * every `http/` as `http\/`. The result parses to exactly the same value.
   *
   * A plain global replace is exact for JSON.stringify output: `%`, `&` and
   * `http/` can only appear inside a string literal, where "\u0025" and "%"
   * - or "\/" and "/" - are the same string, and a backslash there is always
   * the first half of an escape pair that none of these characters belongs
   * to. It is also idempotent, since none of the escapes contains what it
   * replaces.
   *
   * The recorder applies it where it serialises each event rather than on
   * the way out, so every byte budget downstream - the flush threshold, the
   * keepalive split, the request cap - measures what is actually sent.
   */
  public static escapeJson(json: string): string {
    return json.replace(
      ESCAPED_SEQUENCES,
      (match: string, http: string | undefined): string => {
        if (http !== undefined) {
          return `${http}\\/`;
        }

        return match === "%" ? "\\u0025" : "\\u0026";
      },
    );
  }
}
