import SessionReplayWireEncoding, {
  SESSION_REPLAY_ENVELOPE_TERMINATOR,
} from "../../../Utils/Rum/SessionReplayWireEncoding";

/*
 * The encoding exists for what a firewall sees (SessionReplayWafCompatibility
 * covers that). These tests cover the other side of the bargain: that the
 * server, and anything else that JSON.parses a frame, reads back exactly
 * what the recorder meant, and that the bytes are accounted for honestly.
 */

/* Split a frame the way SessionReplayEnvelopeParser does. */
function parseLikeTheServer(line: string): unknown {
  const bytes: Buffer = Buffer.from(line, "utf8");
  const newline: number = bytes.indexOf(0x0a);

  return JSON.parse(bytes.subarray(0, newline).toString("utf-8"));
}

function mulberry32(seed: number): () => number {
  let state: number = seed >>> 0;

  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t: number = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("SessionReplayWireEncoding", () => {
  describe("escapeJson", () => {
    test("escapes %, & and the slash of http/, and nothing else", () => {
      expect(
        SessionReplayWireEncoding.escapeJson(
          JSON.stringify({ url: "https://x.example.com/a%20b?c=1&d=2" }),
        ),
      ).toBe('{"url":"https://x.example.com/a\\u002520b?c=1\\u0026d=2"}');

      expect(
        SessionReplayWireEncoding.escapeJson(
          JSON.stringify({ text: "GET /v1/users HTTP/1.1 or Http/2" }),
        ),
      ).toBe('{"text":"GET /v1/users HTTP\\/1.1 or Http\\/2"}');
    });

    test("leaves https://, http: and a bare slash alone", () => {
      const json: string = JSON.stringify({
        a: "https://example.com/path/to",
        b: "http://example.com",
        c: "a/b",
      });

      expect(SessionReplayWireEncoding.escapeJson(json)).toBe(json);
    });

    test("returns text with nothing to escape unchanged", () => {
      const json: string = JSON.stringify({
        type: 3,
        data: { texts: [{ id: 1, value: "Pending deliveries" }] },
      });

      expect(SessionReplayWireEncoding.escapeJson(json)).toBe(json);
    });

    test("never touches whitespace, numbers or a + in an exponent", () => {
      const json: string = JSON.stringify({ big: 1e21, small: 1e-7, s: "a b" });

      expect(json).toContain("1e+21");
      expect(SessionReplayWireEncoding.escapeJson(json)).toBe(json);
    });

    test("is idempotent", () => {
      const json: string = JSON.stringify({
        v: "%26 & HTTP/1.1 http/2 %%&&",
      });

      const once: string = SessionReplayWireEncoding.escapeJson(json);

      expect(SessionReplayWireEncoding.escapeJson(once)).toBe(once);
    });

    test("the result parses to the same value, for keys as well as values", () => {
      const value: unknown = {
        "100%": "50% & more",
        "a&b": ["http/1.0", "HTTP/2", "%0a", "&#10;"],
        nested: { deeper: { text: "\\% already escaped? \\& no" } },
        backslashThenSlash: "\\http/1",
        unicode: "日本 — 😀 %E6%97%A5",
      };

      expect(
        JSON.parse(SessionReplayWireEncoding.escapeJson(JSON.stringify(value))),
      ).toEqual(value);
    });

    test("fuzz: round-trips arbitrary strings built from the risky characters", () => {
      const alphabet: Array<string> = [
        "%",
        "&",
        "+",
        "http/",
        "HTTP/",
        "\\",
        '"',
        "/",
        " ",
        "\n",
        "\r",
        "\t",
        "\u0000",
        "\u2028",
        "\ud83d",
        "😀",
        "a",
        "0",
        "#",
        ";",
        "u",
      ];

      const random: () => number = mulberry32(42);

      for (let iteration: number = 0; iteration < 2000; iteration++) {
        let text: string = "";
        const length: number = Math.floor(random() * 24);

        for (let index: number = 0; index < length; index++) {
          text += alphabet[Math.floor(random() * alphabet.length)];
        }

        const value: unknown = { [text]: [text, { text: text }] };
        const escaped: string = SessionReplayWireEncoding.escapeJson(
          JSON.stringify(value),
        );

        expect(JSON.parse(escaped)).toEqual(value);
        expect(escaped).not.toMatch(/[%&]|http\//i);
      }
    });
  });

  describe("encodeEnvelopeLine", () => {
    const envelope: Record<string, unknown> = {
      v: 1,
      appIdentifier: "backoffice-web",
      sessionId: "0123456789abcdef0123456789abcdef",
      url: "https://backoffice.example.com/search/gadget+case?q=REDACTED&r=REDACTED",
      meta: {
        entryUrl: "https://backoffice.example.com/%E6%97%A5%E6%9C%AC",
        identifiedUserTraits: { name: "Bridget Jones", plan: "Budget & Co" },
      },
    };

    test("ends in a space and exactly one newline", () => {
      const line: string =
        SessionReplayWireEncoding.encodeEnvelopeLine(envelope);

      expect(SESSION_REPLAY_ENVELOPE_TERMINATOR).toBe(" \n");
      expect(line.endsWith(" \n")).toBe(true);
      expect(line.indexOf("\n")).toBe(line.length - 1);
    });

    test("parses back to the envelope when split the way the server splits it", () => {
      expect(
        parseLikeTheServer(
          SessionReplayWireEncoding.encodeEnvelopeLine(envelope),
        ),
      ).toEqual(envelope);
    });

    test("contains no %, & or http/ anywhere", () => {
      const line: string =
        SessionReplayWireEncoding.encodeEnvelopeLine(envelope);

      expect(line).not.toMatch(/[%&]|http\//i);
    });

    test("never carries a newline from a value into the line", () => {
      const line: string = SessionReplayWireEncoding.encodeEnvelopeLine({
        note: "line one\nline two\r\n",
      });

      expect(line.split("\n")).toHaveLength(2);
      expect(parseLikeTheServer(line)).toEqual({
        note: "line one\nline two\r\n",
      });
    });

    test("is the escaped JSON.stringify plus the terminator, so byte counts are predictable", () => {
      const line: string =
        SessionReplayWireEncoding.encodeEnvelopeLine(envelope);

      expect(line).toBe(
        SessionReplayWireEncoding.escapeJson(JSON.stringify(envelope)) + " \n",
      );

      /* Five extra bytes per % and &, one per http/, two for the terminator. */
      const plain: string = JSON.stringify(envelope);
      const percentsAndAmpersands: number = (plain.match(/[%&]/g) || []).length;

      expect(Buffer.byteLength(line, "utf8")).toBe(
        Buffer.byteLength(plain, "utf8") + 5 * percentsAndAmpersands + 2,
      );
    });
  });
});
