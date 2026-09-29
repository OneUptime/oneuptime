import zlib from "zlib";
import {
  SESSION_REPLAY_CONTENT_TYPE,
  SESSION_REPLAY_LEGACY_CONTENT_TYPE,
  SESSION_REPLAY_WIRE_VERSION,
} from "../../../Types/Rum/SessionReplay";
import SessionReplayWireEncoding from "../../../Utils/Rum/SessionReplayWireEncoding";

/*
 * Would a web application firewall let a session-replay chunk through?
 *
 * A customer on Azure Front Door (managed ruleset DRS 2.1, which Microsoft
 * baselines on OWASP CRS 3.3.2) had every chunk refused. Their log showed
 * 920420 "Request content type is not allowed by policy" on the vendor
 * content type, then 949110 "Inbound Anomaly Score Exceeded" at 5. Fixing
 * the content type alone would only have moved the refusal to the next
 * rule: 921110 reads the raw body of an unparsed request and, URL-decoded,
 * a frame's envelope plus the newline that ends it looks like an HTTP
 * request line for a url such as /search/gadget+case.
 *
 * This suite pins both. The rule data below is copied from the CRS 3.3.2
 * release (and 4.x for the allowlist), and the transforms follow
 * ModSecurity's implementation, so what is asserted is what the firewall
 * does rather than a paraphrase of it. Every "passes" assertion has a
 * matching "the old encoding was refused" assertion, so none of them can
 * pass vacuously on a model of the rule that never matches anything.
 *
 * The same request shapes were also replayed through Coraza v3 with the
 * CRS 3.3.2 rules at paranoia levels 1 and 2 when this was written: the
 * old chunks were blocked by exactly these rules, the new ones by nothing.
 */

/* REQUEST-901-INITIALIZATION.conf, rule 901162, CRS v3.3.2. */
const CRS_3_3_ALLOWED_REQUEST_CONTENT_TYPE: string =
  "|application/x-www-form-urlencoded| |multipart/form-data| |multipart/related| |text/xml| |application/xml| |application/soap+xml| |application/x-amf| |application/json| |application/cloudevents+json| |application/cloudevents-batch+json| |application/octet-stream| |application/csp-report| |application/xss-auditor-report| |text/plain|";

/* The same rule in CRS v4.x. */
const CRS_4_ALLOWED_REQUEST_CONTENT_TYPE: string =
  "|application/x-www-form-urlencoded| |multipart/form-data| |multipart/related| |text/xml| |application/xml| |application/soap+xml| |application/json| |application/cloudevents+json| |application/cloudevents-batch+json|";

/* REQUEST-920-PROTOCOL-ENFORCEMENT.conf, rule 920470 (negated). */
const CRS_920470_LEGAL_CONTENT_TYPE: RegExp =
  /^[\w/.+-]+(?:\s?;\s?(?:action|boundary|charset|type|start(?:-info)?)\s?=\s?['"\w.()+,/:=?<>@-]+)*$/;

/* REQUEST-921-PROTOCOL-ATTACK.conf, rule 921110, CRS v3.3.2. */
const CRS_921110_SOURCE: string =
  "(?:get|post|head|options|connect|put|delete|trace|track|patch|propfind|propatch|mkcol|copy|move|lock|unlock)\\s+(?:\\/|\\w)[^\\s]*(?:\\s+http\\/\\d|[\\r\\n])";

/*
 * ModSecurity's recommended body-processor selection (rules 200000 and
 * 200001) plus its built-in URLENCODED and MULTIPART types. A body that
 * selects none of them is never split into ARGS; only rules that name
 * REQUEST_BODY read it, and they read it raw.
 */
const BODY_PROCESSORS: Array<{ name: string; contentType: RegExp }> = [
  { name: "XML", contentType: /^(?:application(?:\/soap\+|\/)|text\/)xml/ },
  { name: "JSON", contentType: /^application\/json/ },
  { name: "URLENCODED", contentType: /^application\/x-www-form-urlencoded/ },
  { name: "MULTIPART", contentType: /^multipart\/form-data/ },
];

function selectBodyProcessor(contentType: string): string | null {
  const lowered: string = contentType.toLowerCase();

  for (const processor of BODY_PROCESSORS) {
    if (processor.contentType.test(lowered)) {
      return processor.name;
    }
  }

  return null;
}

/*
 * Rule 920420: the Content-Type up to the first `;` or whitespace,
 * lowercased and wrapped in pipes, must be @within the allowlist.
 */
function isContentTypeAllowed(contentType: string, allowlist: string): boolean {
  const match: RegExpMatchArray | null = contentType.match(/^[^;\s]+/);

  if (!match) {
    return true;
  }

  return allowlist.includes(`|${match[0].toLowerCase()}|`);
}

function hexValue(text: string): number {
  return parseInt(text, 16);
}

/*
 * t:urlDecodeUni as ModSecurity v2 implements it without a unicode map:
 * %XX is that byte, %uXXXX is its low byte (full-width ASCII U+FF01-U+FF5E
 * folds to ASCII), `+` is a space, and anything malformed is left as-is.
 */
function urlDecodeUni(input: string): string {
  return input.replace(
    /%u([0-9a-fA-F]{4})|%([0-9a-fA-F]{2})|\+/g,
    (whole: string, unicode?: string, hex?: string): string => {
      if (whole === "+") {
        return " ";
      }

      if (unicode) {
        const code: number = hexValue(unicode);

        if ((code & 0xff00) === 0xff00 && (code & 0xff) >= 0x01) {
          if ((code & 0xff) <= 0x5e) {
            return String.fromCharCode((code & 0xff) + 0x20);
          }
        }

        return String.fromCharCode(code & 0xff);
      }

      return String.fromCharCode(hexValue(hex as string));
    },
  );
}

/*
 * t:htmlEntityDecode: numeric entities (decimal or hex, `;` optional)
 * become their low byte, and the handful of named ones ModSecurity knows.
 */
function htmlEntityDecode(input: string): string {
  const named: Record<string, string> = {
    quot: '"',
    amp: "&",
    lt: "<",
    gt: ">",
    nbsp: "\u00a0",
  };

  return input
    .replace(
      /&#[xX]([0-9a-fA-F]+);?/g,
      (_whole: string, hex: string): string => {
        return String.fromCharCode(hexValue(hex) & 0xff);
      },
    )
    .replace(/&#([0-9]+);?/g, (_whole: string, decimal: string): string => {
      return String.fromCharCode(parseInt(decimal, 10) & 0xff);
    })
    .replace(
      /&(quot|amp|lt|gt|nbsp);/gi,
      (whole: string, name: string): string => {
        return named[name.toLowerCase()] ?? whole;
      },
    );
}

/*
 * Does rule 921110 match this request body?
 *
 * Evaluated twice. Once over the bytes as ModSecurity sees them (one
 * character per byte), and once over the UTF-8 decoded text, for an engine
 * that is Unicode-aware. JavaScript's \s is the broader of the two - it
 * includes U+00A0 and the Unicode spaces that PCRE's byte-mode \s does
 * not - so passing here is a stricter bar than passing the real rule.
 */
function matches921110(body: Uint8Array): string | null {
  const views: Array<string> = [
    Buffer.from(body).toString("latin1"),
    Buffer.from(body).toString("utf8"),
  ];

  for (const view of views) {
    const transformed: string = htmlEntityDecode(
      urlDecodeUni(view),
    ).toLowerCase();

    const match: RegExpMatchArray | null = transformed.match(
      new RegExp(CRS_921110_SOURCE),
    );

    if (match) {
      return match[0];
    }
  }

  return null;
}

/* A seeded PRNG, so the fuzzing below is the same on every run. */
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

function buildEnvelope(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    v: SESSION_REPLAY_WIRE_VERSION,
    appIdentifier: "backoffice-web",
    sessionId: "0123456789abcdef0123456789abcdef",
    tabId: "fedcba9876543210",
    chunkIndex: 0,
    sessionStartUnixMs: 1_790_000_000_000,
    clientSendUnixMs: 1_790_000_015_000,
    chunkStartOffsetMs: 0,
    chunkEndOffsetMs: 15_000,
    eventCount: 2,
    hasFullSnapshot: true,
    isFinal: false,
    recorderKind: "dom",
    schemaVersion: 1,
    rrwebVersion: "2.0.0-alpha.18",
    recorderVersion: "1.0.0",
    maskingMode: "MaskAllText",
    consentState: "Granted",
    triggerReason: "sampled",
    payloadEncoding: "gzip",
    payloadBytes: 0,
    url: "https://backoffice.example.com/deliveries",
    routes: ["https://backoffice.example.com/deliveries"],
    signals: {
      errorCount: 0,
      rageClickCount: 0,
      deadClickCount: 0,
      errorClickCount: 0,
      refreshRageCount: 0,
      routeCount: 1,
    },
    fidelityNotices: [],
    droppedEvents: 0,
    flushFailures: 0,
    ...overrides,
  };
}

type LineEncoder = (envelope: Record<string, unknown>) => string;

/* What every recorder wrote before this change. */
const legacyLine: LineEncoder = (envelope: Record<string, unknown>): string => {
  return `${JSON.stringify(envelope)}\n`;
};

const currentLine: LineEncoder = (
  envelope: Record<string, unknown>,
): string => {
  return SessionReplayWireEncoding.encodeEnvelopeLine(envelope);
};

function frame(
  encodeLine: LineEncoder,
  envelope: Record<string, unknown>,
  payload: Uint8Array,
): Uint8Array {
  const header: Buffer = Buffer.from(
    encodeLine({ ...envelope, payloadBytes: payload.length }),
    "utf8",
  );

  return new Uint8Array(Buffer.concat([header, payload]));
}

function concatFrames(frames: Array<Uint8Array>): Uint8Array {
  return new Uint8Array(Buffer.concat(frames));
}

const GZIP_PAYLOAD: Uint8Array = new Uint8Array(
  zlib.gzipSync(
    Buffer.from(
      JSON.stringify([
        {
          type: 4,
          data: { href: "https://backoffice.example.com/", width: 1440 },
          timestamp: 1,
        },
      ]),
    ),
  ),
);

function identityPayload(events: Array<unknown>, escape: boolean): Uint8Array {
  const text: string = `[${events
    .map((event: unknown): string => {
      const json: string = JSON.stringify(event);
      return escape ? SessionReplayWireEncoding.escapeJson(json) : json;
    })
    .join(",")}]`;

  return new Uint8Array(Buffer.from(text, "utf8"));
}

/*
 * Envelope values that, written the old way, make the chunk look like an
 * HTTP request line to rule 921110. Each is something a real page or a
 * real identify() call produces.
 */
const HOSTILE_ENVELOPES: Array<{
  name: string;
  envelope: Record<string, unknown>;
}> = [
  {
    name: "a path with + for a space (gadget+case)",
    envelope: buildEnvelope({
      url: "https://shop.example.com/search/gadget+case",
    }),
  },
  {
    name: "a path with %20 (widget%20list)",
    envelope: buildEnvelope({
      url: "https://shop.example.com/widget%20list",
    }),
  },
  {
    name: "a URL-encoded newline (%0A) in the path",
    envelope: buildEnvelope({
      url: "https://shop.example.com/get%20started%0Anow",
    }),
  },
  {
    name: "a %u-encoded carriage return",
    envelope: buildEnvelope({
      url: "https://shop.example.com/put%u0020it%u000Dback",
    }),
  },
  {
    name: "an identified user called Bridget Jones",
    envelope: buildEnvelope({
      meta: {
        entryUrl: "https://shop.example.com/",
        browserName: "Chrome",
        identifiedUserTraits: { name: "Bridget Jones" },
      },
    }),
  },
  {
    name: "a tag value ending in a method word and a space",
    envelope: buildEnvelope({
      meta: {
        entryUrl: "https://shop.example.com/",
        tags: { plan: "Budget Pro" },
      },
    }),
  },
  {
    name: "an HTML entity newline in a trait",
    envelope: buildEnvelope({
      meta: {
        entryUrl: "https://shop.example.com/",
        identifiedUserTraits: { note: "please get it&#10;today" },
      },
    }),
  },
  {
    name: "an entity newline smuggled through URL encoding (%26%2310%3B)",
    envelope: buildEnvelope({
      url: "https://shop.example.com/target%20x%26%2310%3By",
    }),
  },
  {
    name: "a trait holding an HTTP request line",
    envelope: buildEnvelope({
      meta: {
        entryUrl: "https://shop.example.com/",
        identifiedUserTraits: { lastExample: "GET /v1/users HTTP/1.1" },
      },
    }),
  },
  {
    name: "the query shape from the customer's own span",
    envelope: buildEnvelope({
      url: "https://backoffice.example.com/api/v1/deliveries?page=REDACTED&created_start_date=REDACTED",
      meta: {
        entryUrl: "https://backoffice.example.com/",
        tags: { team: "Dispatch Ahead" },
      },
    }),
  },
];

describe("session replay chunks and a CRS-based web application firewall", () => {
  describe("rule 920420: request content type allowlist", () => {
    test("the vendor type chunks used to carry is refused - the customer's log", () => {
      expect(
        isContentTypeAllowed(
          SESSION_REPLAY_LEGACY_CONTENT_TYPE,
          CRS_3_3_ALLOWED_REQUEST_CONTENT_TYPE,
        ),
      ).toBe(false);
      expect(
        isContentTypeAllowed(
          SESSION_REPLAY_LEGACY_CONTENT_TYPE,
          CRS_4_ALLOWED_REQUEST_CONTENT_TYPE,
        ),
      ).toBe(false);
    });

    test("the content type chunks carry now is on the CRS 3.3 allowlist (Azure DRS 2.x)", () => {
      expect(SESSION_REPLAY_CONTENT_TYPE).toBe("application/octet-stream");
      expect(
        isContentTypeAllowed(
          SESSION_REPLAY_CONTENT_TYPE,
          CRS_3_3_ALLOWED_REQUEST_CONTENT_TYPE,
        ),
      ).toBe(true);
    });

    test("an OTLP protobuf content type is refused by the same rule", () => {
      /*
       * Recorded so nobody "fixes" this by switching to protobuf: the
       * types other replay SDKs use are not on the list either.
       */
      expect(
        isContentTypeAllowed(
          "application/x-protobuf",
          CRS_3_3_ALLOWED_REQUEST_CONTENT_TYPE,
        ),
      ).toBe(false);
    });

    test("the header is a legal Content-Type and names no charset (920470, 920480)", () => {
      expect(
        CRS_920470_LEGAL_CONTENT_TYPE.test(SESSION_REPLAY_CONTENT_TYPE),
      ).toBe(true);
      expect(SESSION_REPLAY_CONTENT_TYPE).not.toMatch(/charset/i);
      expect(SESSION_REPLAY_CONTENT_TYPE).not.toContain(";");
    });

    test("the content type selects no body processor, so no envelope value becomes an ARG", () => {
      /*
       * JSON would be parsed and every string in it - URLs, trait values -
       * run through the injection rules; that is the false positive the
       * same customer saw on their OTLP/JSON traces. A body that is not
       * JSON under a JSON content type fails to parse instead (200002).
       */
      expect(selectBodyProcessor(SESSION_REPLAY_CONTENT_TYPE)).toBeNull();
      expect(selectBodyProcessor("application/json")).toBe("JSON");
    });
  });

  describe("rule 921110: HTTP request smuggling, over the raw body", () => {
    test("the model of the rule matches a real request line, and not ordinary text", () => {
      expect(
        matches921110(new Uint8Array(Buffer.from("GET /index.html HTTP/1.1"))),
      ).not.toBeNull();
      expect(
        matches921110(new Uint8Array(Buffer.from("x=get started\nnext"))),
      ).not.toBeNull();
      expect(
        matches921110(new Uint8Array(Buffer.from("get started, no newline"))),
      ).toBeNull();
    });

    for (const hostile of HOSTILE_ENVELOPES) {
      test(`${hostile.name}: refused the old way, passes now`, () => {
        expect(
          matches921110(frame(legacyLine, hostile.envelope, GZIP_PAYLOAD)),
        ).not.toBeNull();

        expect(
          matches921110(frame(currentLine, hostile.envelope, GZIP_PAYLOAD)),
        ).toBeNull();
      });
    }

    test("the escapes alone are not enough: the space before the newline is load-bearing", () => {
      const envelope: Record<string, unknown> = buildEnvelope({
        url: "https://shop.example.com/search/gadget+case",
      });

      const escapedWithoutSpace: LineEncoder = (
        value: Record<string, unknown>,
      ): string => {
        return `${SessionReplayWireEncoding.escapeJson(JSON.stringify(value))}\n`;
      };

      expect(
        matches921110(frame(escapedWithoutSpace, envelope, GZIP_PAYLOAD)),
      ).not.toBeNull();
    });

    test("the space alone is not enough: an encoded newline needs the escapes", () => {
      const envelope: Record<string, unknown> = buildEnvelope({
        url: "https://shop.example.com/get%20started%0Anow",
      });

      const spaceWithoutEscapes: LineEncoder = (
        value: Record<string, unknown>,
      ): string => {
        return `${JSON.stringify(value)} \n`;
      };

      expect(
        matches921110(frame(spaceWithoutEscapes, envelope, GZIP_PAYLOAD)),
      ).not.toBeNull();
    });

    test("a terminal flush of several identity frames passes when the previous payload ends in text", () => {
      /*
       * The payload of frame N sits directly in front of the envelope of
       * frame N+1. Written the old way, the run with no whitespace in it
       * spans that whole envelope and ends on its newline.
       */
      const tail: Array<unknown> = [
        {
          type: 3,
          data: {
            source: 0,
            texts: [{ id: 9, value: "Click to get started" }],
          },
          timestamp: 3,
        },
      ];

      const oldBody: Uint8Array = concatFrames([
        frame(
          legacyLine,
          buildEnvelope({ payloadEncoding: "identity" }),
          identityPayload(tail, false),
        ),
        frame(
          legacyLine,
          buildEnvelope({ chunkIndex: 1, payloadEncoding: "identity" }),
          identityPayload([], false),
        ),
      ]);

      const newBody: Uint8Array = concatFrames([
        frame(
          currentLine,
          buildEnvelope({ payloadEncoding: "identity" }),
          identityPayload(tail, true),
        ),
        frame(
          currentLine,
          buildEnvelope({ chunkIndex: 1, payloadEncoding: "identity" }),
          identityPayload([], true),
        ),
      ]);

      expect(matches921110(oldBody)).not.toBeNull();
      expect(matches921110(newBody)).toBeNull();
    });

    test("an identity payload cannot have a line break decoded out of it", () => {
      const events: Array<unknown> = [
        {
          type: 3,
          data: {
            source: 0,
            attributes: [
              {
                id: 9,
                attributes: {
                  href: "mailto:?subject=Hi&body=Please%20get%20back%0Asoon",
                },
              },
            ],
          },
          timestamp: 3,
        },
        {
          type: 3,
          data: {
            source: 0,
            texts: [{ id: 10, value: "Budget review&#13;due" }],
          },
          timestamp: 4,
        },
        {
          type: 5,
          data: {
            tag: "network",
            payload: {
              url: "https://api.example.com/notes?text=target%20list%0D%0Aitem",
              method: "GET",
            },
          },
          timestamp: 5,
        },
      ];

      const envelope: Record<string, unknown> = buildEnvelope({
        payloadEncoding: "identity",
      });

      expect(
        matches921110(
          frame(legacyLine, envelope, identityPayload(events, false)),
        ),
      ).not.toBeNull();
      expect(
        matches921110(
          frame(currentLine, envelope, identityPayload(events, true)),
        ),
      ).toBeNull();
    });

    test("an identity payload showing an HTTP request line passes", () => {
      /*
       * API documentation, recorded verbatim under the default masking
       * mode. No line break is needed for this one: the rule's other
       * ending is whitespace followed by http/<digit>.
       */
      const events: Array<unknown> = [
        {
          type: 3,
          data: {
            source: 0,
            texts: [{ id: 3, value: "GET /v1/users HTTP/1.1" }],
          },
          timestamp: 3,
        },
      ];

      const envelope: Record<string, unknown> = buildEnvelope({
        payloadEncoding: "identity",
      });

      expect(
        matches921110(
          frame(legacyLine, envelope, identityPayload(events, false)),
        ),
      ).not.toBeNull();
      expect(
        matches921110(
          frame(currentLine, envelope, identityPayload(events, true)),
        ),
      ).toBeNull();
    });

    test("fuzz: no envelope built from hostile fragments ever matches", () => {
      const fragments: Array<string> = [
        "get",
        "post",
        "put",
        "head",
        "copy",
        "move",
        "lock",
        "track",
        "trace",
        "patch",
        "delete",
        "options",
        "connect",
        "target",
        "budget",
        "widget",
        "input",
        "ahead",
        "remove",
        "block",
        " ",
        "  ",
        "+",
        "%20",
        "%0a",
        "%0D",
        "%u000a",
        "%uff0a",
        "&#10;",
        "&#x0a;",
        "&#13",
        "%26%2310%3B",
        "&amp;",
        "\u00a0",
        "\u2028",
        "\u3000",
        "\t",
        "\n",
        "\r",
        "/",
        "x",
        "http/1",
        "HTTP/1.1",
        "Http/2",
        "日本",
        "😀",
      ];

      const random: () => number = mulberry32(0x0a11ce);

      const pick: () => string = (): string => {
        let value: string = "";
        const parts: number = 1 + Math.floor(random() * 8);

        for (let index: number = 0; index < parts; index++) {
          value += fragments[Math.floor(random() * fragments.length)];
        }

        return value;
      };

      let legacyMatches: number = 0;

      for (let iteration: number = 0; iteration < 3000; iteration++) {
        const envelope: Record<string, unknown> = buildEnvelope({
          url: `https://shop.example.com/${pick()}`,
          routes: [`https://shop.example.com/${pick()}`],
          meta: {
            entryUrl: `https://shop.example.com/${pick()}`,
            browserName: pick(),
            identifiedUserTraits: { [pick()]: pick() },
            tags: { [pick()]: pick() },
          },
          fidelityNotices: [pick()],
        });

        if (matches921110(frame(legacyLine, envelope, GZIP_PAYLOAD))) {
          legacyMatches++;
        }

        const current: string | null = matches921110(
          frame(currentLine, envelope, GZIP_PAYLOAD),
        );

        if (current !== null) {
          throw new Error(
            `iteration ${iteration} matched ${JSON.stringify(current)} for ${JSON.stringify(envelope)}`,
          );
        }
      }

      /* The corpus is potent: most of these were refused the old way. */
      expect(legacyMatches).toBeGreaterThan(1000);
    });

    test("fuzz: several frames back to back with text payloads never match", () => {
      const words: Array<string> = [
        "get",
        "started",
        "budget",
        "put",
        "it",
        "back",
        "ahead",
        "%0a",
        "%20",
        "&#10;",
        "+",
        " ",
        "http/1",
        "/",
      ];

      const random: () => number = mulberry32(0xbeef);

      const sentence: () => string = (): string => {
        const parts: Array<string> = [];
        const length: number = 1 + Math.floor(random() * 10);

        for (let index: number = 0; index < length; index++) {
          parts.push(words[Math.floor(random() * words.length)] as string);
        }

        return parts.join(random() < 0.5 ? " " : "");
      };

      for (let iteration: number = 0; iteration < 500; iteration++) {
        const frames: Array<Uint8Array> = [];
        const count: number = 2 + Math.floor(random() * 6);

        for (let index: number = 0; index < count; index++) {
          frames.push(
            frame(
              currentLine,
              buildEnvelope({
                chunkIndex: index,
                payloadEncoding: "identity",
                url: `https://shop.example.com/${sentence()}`,
              }),
              identityPayload(
                [
                  {
                    type: 3,
                    data: { texts: [{ id: index, value: sentence() }] },
                    timestamp: index,
                  },
                ],
                true,
              ),
            ),
          );
        }

        expect(matches921110(concatFrames(frames))).toBeNull();
      }
    });

    test("a gzip payload is opaque: compressed realistic chunks and random bytes do not match", () => {
      const random: () => number = mulberry32(0x5eed);

      for (let iteration: number = 0; iteration < 60; iteration++) {
        const events: Array<unknown> = [];

        for (let index: number = 0; index < 400; index++) {
          events.push({
            type: 3,
            data: {
              source: 0,
              texts: [
                {
                  id: index,
                  value: `Get started with budget ${Math.floor(random() * 1e9)} target input`,
                },
              ],
              href: `https://backoffice.example.com/api/v1/deliveries?page=${index}&status=pending%0A`,
            },
            timestamp: 1_790_000_000_000 + index,
          });
        }

        const compressed: Uint8Array = new Uint8Array(
          zlib.gzipSync(
            Buffer.from(
              SessionReplayWireEncoding.escapeJson(JSON.stringify(events)),
            ),
          ),
        );

        expect(
          matches921110(frame(currentLine, buildEnvelope(), compressed)),
        ).toBeNull();
      }

      const noise: Uint8Array = new Uint8Array(256 * 1024);

      for (let index: number = 0; index < noise.length; index++) {
        noise[index] = Math.floor(random() * 256);
      }

      expect(
        matches921110(frame(currentLine, buildEnvelope(), noise)),
      ).toBeNull();
    });
  });
});
