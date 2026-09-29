/**
 * Unit tests for the MCP transport compatibility layer (GitHub issue #3695).
 *
 * These cover the pure negotiation helpers. The HTTP-level regressions they
 * protect against are exercised end-to-end in RouteHandler.test.ts.
 */

import { describe, it, expect } from "@jest/globals";
import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import {
  KNOWN_PROTOCOL_VERSIONS,
  NORMALIZED_ACCEPT_HEADER,
  ProtocolNegotiationOutcome,
  ProtocolNegotiationResult,
  ResponseFormat,
  AcceptNegotiationResult,
  HeaderMutableRequest,
  getLatestSupportedProtocolVersion,
  isInitializeRequestBody,
  negotiateProtocolVersion,
  negotiateResponseFormat,
  readHeaderValue,
  readSingleValueHeader,
  removeRequestHeader,
  sanitizeForLog,
  setRequestHeader,
} from "../Utils/TransportNegotiation";

/** The exact version Claude's MCP client sent in the bug report. */
const CLIENT_VERSION_FROM_ISSUE: string = "2026-07-28";

describe("KNOWN_PROTOCOL_VERSIONS", () => {
  it("mirrors the SDK's supported list", () => {
    expect([...KNOWN_PROTOCOL_VERSIONS].sort()).toEqual(
      [...SUPPORTED_PROTOCOL_VERSIONS].sort(),
    );
  });

  it("is sorted oldest first so lexicographic comparison is chronological", () => {
    const sorted: string[] = [...KNOWN_PROTOCOL_VERSIONS].sort();
    expect(KNOWN_PROTOCOL_VERSIONS).toEqual(sorted);
  });

  it("ends at the SDK's latest protocol version", () => {
    expect(KNOWN_PROTOCOL_VERSIONS[KNOWN_PROTOCOL_VERSIONS.length - 1]).toBe(
      LATEST_PROTOCOL_VERSION,
    );
    expect(getLatestSupportedProtocolVersion()).toBe(LATEST_PROTOCOL_VERSION);
  });

  it("is non-empty", () => {
    expect(KNOWN_PROTOCOL_VERSIONS.length).toBeGreaterThan(0);
  });
});

describe("readHeaderValue", () => {
  it("returns a plain string header", () => {
    expect(readHeaderValue("2025-06-18")).toBe("2025-06-18");
  });

  it("trims surrounding whitespace", () => {
    expect(readHeaderValue("  2025-06-18  ")).toBe("2025-06-18");
  });

  it("takes the first value of a repeated header", () => {
    expect(readHeaderValue(["2025-06-18", "2024-11-05"])).toBe("2025-06-18");
  });

  it("treats undefined, empty and whitespace-only values as absent", () => {
    expect(readHeaderValue(undefined)).toBeUndefined();
    expect(readHeaderValue("")).toBeUndefined();
    expect(readHeaderValue("   ")).toBeUndefined();
    expect(readHeaderValue([])).toBeUndefined();
  });
});

describe("negotiateProtocolVersion", () => {
  describe("the reported failure: a client newer than the bundled SDK", () => {
    it("negotiates 2026-07-28 down to the newest version we support", () => {
      const result: ProtocolNegotiationResult = negotiateProtocolVersion(
        CLIENT_VERSION_FROM_ISSUE,
      );

      /*
       * Before the fix this value produced a flat 400 from the SDK transport
       * ("Unsupported protocol version: 2026-07-28"), which the user could only
       * see in container logs.
       */
      expect(result.outcome).toBe(
        ProtocolNegotiationOutcome.DowngradedToSupported,
      );
      expect(result.requestedVersion).toBe(CLIENT_VERSION_FROM_ISSUE);
      expect(result.negotiatedVersion).toBe(LATEST_PROTOCOL_VERSION);
    });

    it("agrees with what the SDK answers during initialize", () => {
      /*
       * The SDK's initialize handler replies to an unknown version with
       * LATEST_PROTOCOL_VERSION. The header negotiation has to land on the same
       * value or the handshake and the follow-up requests would disagree.
       */
      const result: ProtocolNegotiationResult = negotiateProtocolVersion(
        CLIENT_VERSION_FROM_ISSUE,
      );
      expect(result.negotiatedVersion).toBe(
        getLatestSupportedProtocolVersion(),
      );
    });

    it("downgrades any far-future version to the newest supported one", () => {
      for (const version of ["2027-01-01", "2030-12-31", "9999-12-31"]) {
        const result: ProtocolNegotiationResult =
          negotiateProtocolVersion(version);
        expect(result.outcome).toBe(
          ProtocolNegotiationOutcome.DowngradedToSupported,
        );
        expect(result.negotiatedVersion).toBe(LATEST_PROTOCOL_VERSION);
      }
    });
  });

  describe("versions we support are passed through untouched", () => {
    it.each(SUPPORTED_PROTOCOL_VERSIONS)(
      "accepts %s as-is",
      (version: string) => {
        const result: ProtocolNegotiationResult =
          negotiateProtocolVersion(version);

        expect(result.outcome).toBe(ProtocolNegotiationOutcome.Supported);
        expect(result.requestedVersion).toBe(version);
        expect(result.negotiatedVersion).toBe(version);
      },
    );
  });

  describe("versions between two supported ones", () => {
    it("picks the highest supported version at or below the request", () => {
      /*
       * 2025-08-01 sits between 2025-06-18 and 2025-11-25, so the newest
       * version the client can be assumed to understand is 2025-06-18.
       */
      const result: ProtocolNegotiationResult =
        negotiateProtocolVersion("2025-08-01");

      expect(result.outcome).toBe(
        ProtocolNegotiationOutcome.DowngradedToSupported,
      );
      expect(result.negotiatedVersion).toBe("2025-06-18");
    });

    it("never negotiates UP to a version newer than the client asked for", () => {
      const result: ProtocolNegotiationResult =
        negotiateProtocolVersion("2024-12-01");

      expect(result.negotiatedVersion).toBe("2024-11-05");
      expect((result.negotiatedVersion as string) < "2024-12-01").toBe(true);
    });
  });

  describe("no shared version", () => {
    it("reports a version older than everything we speak as unsupported", () => {
      const oldest: string = KNOWN_PROTOCOL_VERSIONS[0] as string;
      const result: ProtocolNegotiationResult =
        negotiateProtocolVersion("2000-01-01");

      expect(result.outcome).toBe(ProtocolNegotiationOutcome.Unsupported);
      expect(result.requestedVersion).toBe("2000-01-01");
      expect(result.negotiatedVersion).toBeUndefined();
      expect("2000-01-01" < oldest).toBe(true);
    });

    it("treats the oldest supported version itself as supported, not unsupported", () => {
      const oldest: string = KNOWN_PROTOCOL_VERSIONS[0] as string;
      const result: ProtocolNegotiationResult =
        negotiateProtocolVersion(oldest);

      expect(result.outcome).toBe(ProtocolNegotiationOutcome.Supported);
      expect(result.negotiatedVersion).toBe(oldest);
    });

    it.each([
      "draft",
      "v1",
      "2025-6-18",
      "20250618",
      "not-a-version",
      "2025-06-18-rc1",
    ])(
      "reports the unparseable value %p as unsupported instead of guessing",
      (version: string) => {
        const result: ProtocolNegotiationResult =
          negotiateProtocolVersion(version);

        expect(result.outcome).toBe(ProtocolNegotiationOutcome.Unsupported);
        expect(result.requestedVersion).toBe(version);
        expect(result.negotiatedVersion).toBeUndefined();
      },
    );
  });

  describe("no version requested", () => {
    /*
     * A blank header is classified the same as an absent one, but the two are
     * NOT the same to the SDK: an empty string is not null, so it fails the
     * SDK's membership check. RouteHandler therefore has to actually REMOVE a
     * blank header rather than pass it through — see the HTTP-level test
     * "an empty MCP-Protocol-Version header is dropped, not rejected".
     */
    it.each([undefined, "", "   "])(
      "reports %p as not requested",
      (header: string | undefined) => {
        const result: ProtocolNegotiationResult =
          negotiateProtocolVersion(header);

        expect(result.outcome).toBe(ProtocolNegotiationOutcome.NotRequested);
        expect(result.requestedVersion).toBeUndefined();
        expect(result.negotiatedVersion).toBeUndefined();
      },
    );
  });

  it("handles a repeated header by using its first value", () => {
    const result: ProtocolNegotiationResult = negotiateProtocolVersion([
      CLIENT_VERSION_FROM_ISSUE,
      "2025-06-18",
    ]);

    expect(result.requestedVersion).toBe(CLIENT_VERSION_FROM_ISSUE);
    expect(result.outcome).toBe(
      ProtocolNegotiationOutcome.DowngradedToSupported,
    );
  });

  it("tolerates surrounding whitespace on a supported version", () => {
    const result: ProtocolNegotiationResult = negotiateProtocolVersion(
      ` ${LATEST_PROTOCOL_VERSION} `,
    );

    expect(result.outcome).toBe(ProtocolNegotiationOutcome.Supported);
    expect(result.negotiatedVersion).toBe(LATEST_PROTOCOL_VERSION);
  });

  it("always returns a supported version when it returns one at all", () => {
    const candidates: Array<string | undefined> = [
      undefined,
      "",
      "2000-01-01",
      "draft",
      "2024-12-01",
      "2025-08-01",
      CLIENT_VERSION_FROM_ISSUE,
      ...SUPPORTED_PROTOCOL_VERSIONS,
    ];

    for (const candidate of candidates) {
      const result: ProtocolNegotiationResult =
        negotiateProtocolVersion(candidate);
      if (result.negotiatedVersion) {
        expect(KNOWN_PROTOCOL_VERSIONS).toContain(result.negotiatedVersion);
      }
    }
  });
});

describe("negotiateResponseFormat", () => {
  it("streams SSE when the client explicitly accepts it (spec-compliant clients)", () => {
    const result: AcceptNegotiationResult = negotiateResponseFormat(
      "application/json, text/event-stream",
    );

    expect(result.format).toBe(ResponseFormat.ServerSentEvents);
    expect(result.requestedAccept).toBe("application/json, text/event-stream");
  });

  it("streams SSE when the client accepts only text/event-stream", () => {
    expect(negotiateResponseFormat("text/event-stream").format).toBe(
      ResponseFormat.ServerSentEvents,
    );
  });

  describe("the reported failure: clients that do not ask for text/event-stream", () => {
    it("answers a JSON-only client with JSON instead of 406", () => {
      const result: AcceptNegotiationResult =
        negotiateResponseFormat("application/json");

      expect(result.format).toBe(ResponseFormat.Json);
    });

    it("answers a wildcard Accept with JSON instead of 406", () => {
      expect(negotiateResponseFormat("*/*").format).toBe(ResponseFormat.Json);
    });

    it("answers a missing Accept header with JSON (RFC 9110: anything goes)", () => {
      expect(negotiateResponseFormat(undefined).format).toBe(
        ResponseFormat.Json,
      );
      expect(negotiateResponseFormat("").format).toBe(ResponseFormat.Json);
    });

    it("accepts an application/* wildcard", () => {
      expect(negotiateResponseFormat("application/*").format).toBe(
        ResponseFormat.Json,
      );
    });
  });

  it("ignores q-values and other media type parameters", () => {
    expect(
      negotiateResponseFormat("application/json;q=0.9, text/event-stream;q=0.8")
        .format,
    ).toBe(ResponseFormat.ServerSentEvents);

    expect(
      negotiateResponseFormat("application/json; charset=utf-8").format,
    ).toBe(ResponseFormat.Json);
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    expect(negotiateResponseFormat("  TEXT/EVENT-STREAM  ").format).toBe(
      ResponseFormat.ServerSentEvents,
    );
    expect(negotiateResponseFormat("Application/JSON").format).toBe(
      ResponseFormat.Json,
    );
  });

  it("handles a repeated Accept header by using its first value", () => {
    expect(
      negotiateResponseFormat(["application/json", "text/html"]).format,
    ).toBe(ResponseFormat.Json);
  });

  it("reports a client that accepts neither media type as unacceptable", () => {
    const result: AcceptNegotiationResult = negotiateResponseFormat(
      "text/html, application/xml",
    );

    expect(result.format).toBe(ResponseFormat.Unacceptable);
    expect(result.requestedAccept).toBe("text/html, application/xml");
  });

  it("does not mistake text/html for text/event-stream", () => {
    expect(negotiateResponseFormat("text/html").format).toBe(
      ResponseFormat.Unacceptable,
    );
  });

  it("exposes a normalized header that satisfies the SDK's own check", () => {
    expect(NORMALIZED_ACCEPT_HEADER).toContain("application/json");
    expect(NORMALIZED_ACCEPT_HEADER).toContain("text/event-stream");
  });
});

describe("isInitializeRequestBody", () => {
  it("recognizes a single initialize request", () => {
    expect(
      isInitializeRequestBody({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: CLIENT_VERSION_FROM_ISSUE },
      }),
    ).toBe(true);
  });

  it("recognizes an initialize request inside a JSON-RPC batch", () => {
    expect(
      isInitializeRequestBody([
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      ]),
    ).toBe(true);
  });

  it("rejects other JSON-RPC methods", () => {
    expect(
      isInitializeRequestBody({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    ).toBe(false);
    expect(
      isInitializeRequestBody({ jsonrpc: "2.0", id: 1, method: "tools/call" }),
    ).toBe(false);
  });

  it("does not throw on missing or malformed bodies", () => {
    expect(isInitializeRequestBody(undefined)).toBe(false);
    expect(isInitializeRequestBody(null)).toBe(false);
    expect(isInitializeRequestBody("initialize")).toBe(false);
    expect(isInitializeRequestBody([])).toBe(false);
    expect(isInitializeRequestBody([null, undefined])).toBe(false);
    expect(isInitializeRequestBody({ method: 42 })).toBe(false);
  });
});

/*
 * The MCP SDK rebuilds the request it validates from Node's `rawHeaders` array,
 * not from Express's parsed `headers` map. A negotiated value that only landed
 * in `headers` would be invisible to it — which is exactly how the first
 * attempt at this fix failed — so both views have to stay in sync.
 */
describe("request header rewriting", () => {
  function makeRequest(rawHeaders: string[]): HeaderMutableRequest {
    const headers: Record<string, string | string[] | undefined> = {};
    for (let index: number = 0; index < rawHeaders.length; index += 2) {
      headers[(rawHeaders[index] as string).toLowerCase()] = rawHeaders[
        index + 1
      ] as string;
    }
    return { headers, rawHeaders: [...rawHeaders] };
  }

  describe("setRequestHeader", () => {
    it("updates both the parsed map and rawHeaders", () => {
      const req: HeaderMutableRequest = makeRequest([
        "Content-Type",
        "application/json",
        "MCP-Protocol-Version",
        "2026-07-28",
      ]);

      setRequestHeader(req, "mcp-protocol-version", "2025-11-25");

      expect(req.headers["mcp-protocol-version"]).toBe("2025-11-25");
      expect(req.rawHeaders).toContain("2025-11-25");
      expect(req.rawHeaders).not.toContain("2026-07-28");
    });

    it("matches the existing header case-insensitively", () => {
      const req: HeaderMutableRequest = makeRequest([
        "AcCePt",
        "application/json",
      ]);

      setRequestHeader(req, "accept", NORMALIZED_ACCEPT_HEADER);

      expect(req.rawHeaders).not.toContain("application/json");
      expect(req.headers["accept"]).toBe(NORMALIZED_ACCEPT_HEADER);
    });

    it("adds the header when the request did not carry one", () => {
      const req: HeaderMutableRequest = makeRequest([
        "Content-Type",
        "application/json",
      ]);

      setRequestHeader(req, "Accept", NORMALIZED_ACCEPT_HEADER);

      expect(req.headers["accept"]).toBe(NORMALIZED_ACCEPT_HEADER);
      expect(req.rawHeaders).toEqual([
        "Content-Type",
        "application/json",
        "Accept",
        NORMALIZED_ACCEPT_HEADER,
      ]);
    });

    it("collapses a repeated header into a single value", () => {
      const req: HeaderMutableRequest = makeRequest([
        "Accept",
        "text/html",
        "Accept",
        "application/xml",
      ]);

      setRequestHeader(req, "Accept", NORMALIZED_ACCEPT_HEADER);

      expect(
        (req.rawHeaders as string[]).filter((entry: string) => {
          return entry.toLowerCase() === "accept";
        }),
      ).toHaveLength(1);
      expect(req.rawHeaders).not.toContain("text/html");
      expect(req.rawHeaders).not.toContain("application/xml");
    });

    it("leaves unrelated headers untouched", () => {
      const req: HeaderMutableRequest = makeRequest([
        "Content-Type",
        "application/json",
        "x-api-key",
        "secret",
        "Accept",
        "*/" + "*",
      ]);

      setRequestHeader(req, "Accept", NORMALIZED_ACCEPT_HEADER);

      expect(req.headers["content-type"]).toBe("application/json");
      expect(req.headers["x-api-key"]).toBe("secret");
      expect(req.rawHeaders).toContain("secret");
    });

    it("does not throw when the request has no rawHeaders", () => {
      const req: HeaderMutableRequest = { headers: {} };

      expect(() => {
        return setRequestHeader(req, "Accept", NORMALIZED_ACCEPT_HEADER);
      }).not.toThrow();
      expect(req.headers["accept"]).toBe(NORMALIZED_ACCEPT_HEADER);
    });
  });

  describe("removeRequestHeader", () => {
    it("removes the header from both views", () => {
      const req: HeaderMutableRequest = makeRequest([
        "MCP-Protocol-Version",
        "not-a-version",
        "Content-Type",
        "application/json",
      ]);

      removeRequestHeader(req, "mcp-protocol-version");

      expect(req.headers["mcp-protocol-version"]).toBeUndefined();
      expect(req.rawHeaders).toEqual(["Content-Type", "application/json"]);
    });

    it("removes every copy of a repeated header", () => {
      const req: HeaderMutableRequest = makeRequest([
        "MCP-Protocol-Version",
        "a",
        "MCP-Protocol-Version",
        "b",
        "Content-Type",
        "application/json",
      ]);

      removeRequestHeader(req, "MCP-Protocol-Version");

      expect(req.rawHeaders).toEqual(["Content-Type", "application/json"]);
    });

    it("is a no-op when the header is absent", () => {
      const req: HeaderMutableRequest = makeRequest([
        "Content-Type",
        "application/json",
      ]);

      removeRequestHeader(req, "mcp-protocol-version");

      expect(req.rawHeaders).toEqual(["Content-Type", "application/json"]);
    });
  });
});

/*
 * Boundary and property coverage added after an adversarial audit of the fix
 * (issue #3695). The audit confirmed two real defects that the original suite
 * missed — a blank version header and the `text/*` media range — so these
 * exercise the surrounding space rather than just the two known cases.
 */
describe("negotiateProtocolVersion — boundary and property coverage", () => {
  /** Shift a YYYY-MM-DD version by whole days without using Date.now(). */
  function shiftDays(version: string, days: number): string {
    const parts: string[] = version.split("-");
    const shifted: Date = new Date(
      Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + days),
    );
    return shifted.toISOString().slice(0, 10);
  }

  describe("one day either side of every supported version", () => {
    it.each(SUPPORTED_PROTOCOL_VERSIONS)(
      "a version one day after %s never negotiates above it",
      (version: string) => {
        const result: ProtocolNegotiationResult = negotiateProtocolVersion(
          shiftDays(version, 1),
        );

        expect(result.outcome).toBe(
          ProtocolNegotiationOutcome.DowngradedToSupported,
        );
        // The day after X is still only guaranteed to understand X.
        expect(result.negotiatedVersion).toBe(version);
      },
    );

    it.each(SUPPORTED_PROTOCOL_VERSIONS)(
      "a version one day before %s never negotiates up to it",
      (version: string) => {
        const result: ProtocolNegotiationResult = negotiateProtocolVersion(
          shiftDays(version, -1),
        );

        if (result.negotiatedVersion) {
          expect(result.negotiatedVersion < version).toBe(true);
        } else {
          // Only legitimate below the oldest version we speak.
          expect(version).toBe(KNOWN_PROTOCOL_VERSIONS[0]);
          expect(result.outcome).toBe(ProtocolNegotiationOutcome.Unsupported);
        }
      },
    );
  });

  describe("syntactically valid but nonsensical dates", () => {
    it.each(["0000-00-00", "2025-13-45", "2025-99-99", "9999-99-99"])(
      "handles %s without throwing and never invents a version",
      (version: string) => {
        const result: ProtocolNegotiationResult =
          negotiateProtocolVersion(version);

        if (result.negotiatedVersion) {
          expect(KNOWN_PROTOCOL_VERSIONS).toContain(result.negotiatedVersion);
          expect(result.negotiatedVersion <= version).toBe(true);
        } else {
          expect(result.outcome).toBe(ProtocolNegotiationOutcome.Unsupported);
        }
      },
    );
  });

  it("never returns a version newer than the client asked for, over a wide sweep", () => {
    const probes: string[] = [];
    for (const year of ["2023", "2024", "2025", "2026", "2027"]) {
      for (const month of ["01", "06", "11", "12"]) {
        for (const day of ["01", "15", "28"]) {
          probes.push(`${year}-${month}-${day}`);
        }
      }
    }

    for (const probe of probes) {
      const result: ProtocolNegotiationResult = negotiateProtocolVersion(probe);

      if (result.negotiatedVersion) {
        // The core safety property: we never claim a version the client did not.
        expect(result.negotiatedVersion <= probe).toBe(true);
        expect(KNOWN_PROTOCOL_VERSIONS).toContain(result.negotiatedVersion);
      }
    }
  });

  it("does not mutate the exported version list (it is served in HTTP responses)", () => {
    const before: string[] = [...KNOWN_PROTOCOL_VERSIONS];

    negotiateProtocolVersion("2026-07-28");
    negotiateProtocolVersion("2000-01-01");
    negotiateProtocolVersion("banana");
    negotiateProtocolVersion(LATEST_PROTOCOL_VERSION);

    expect(KNOWN_PROTOCOL_VERSIONS).toEqual(before);
  });

  it("round-trips every supported version unchanged", () => {
    for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
      const result: ProtocolNegotiationResult =
        negotiateProtocolVersion(version);
      expect(result.negotiatedVersion).toBe(version);
      expect(result.outcome).toBe(ProtocolNegotiationOutcome.Supported);
    }
  });
});

describe("negotiateResponseFormat — media ranges and malformed input", () => {
  it("treats the text/* media range as accepting the event stream", () => {
    /*
     * Regression: text/* is a range that covers text/event-stream, but the
     * first version of this fix matched only exact tokens, so a text/* client
     * got a 406 while an application/* client was served.
     */
    expect(negotiateResponseFormat("text/*").format).toBe(
      ResponseFormat.ServerSentEvents,
    );
  });

  it("prefers the event stream when the client names both ranges", () => {
    expect(negotiateResponseFormat("application/*, text/*").format).toBe(
      ResponseFormat.ServerSentEvents,
    );
  });

  it.each([
    "application/json, text/event-stream",
    "text/event-stream, application/json",
    "text/event-stream;q=1.0, application/json;q=0.9",
    "  text/event-stream  ,  application/json  ",
    "APPLICATION/JSON, TEXT/EVENT-STREAM",
  ])(
    "orders and casings of a compliant Accept all stream SSE: %s",
    (header: string) => {
      expect(negotiateResponseFormat(header).format).toBe(
        ResponseFormat.ServerSentEvents,
      );
    },
  );

  it.each([
    ",",
    ",,,",
    ";",
    ";;",
    " , ; , ",
    "application/json;",
    ";q=0.9",
    "/",
    "text/",
    "/event-stream",
  ])("never throws on the malformed Accept header %p", (header: string) => {
    expect(() => {
      return negotiateResponseFormat(header);
    }).not.toThrow();
  });

  it("does not mistake a type that merely contains the token as the token", () => {
    // "application/vnd.text/event-stream+json" is not text/event-stream.
    expect(
      negotiateResponseFormat("application/vnd.text/event-stream+json").format,
    ).not.toBe(ResponseFormat.ServerSentEvents);
  });

  it("handles an absurdly long Accept header without throwing", () => {
    const header: string = new Array(500)
      .fill("application/octet-stream")
      .join(", ");

    expect(() => {
      return negotiateResponseFormat(header);
    }).not.toThrow();
    expect(negotiateResponseFormat(header).format).toBe(
      ResponseFormat.Unacceptable,
    );
  });

  it("always returns one of the three declared formats", () => {
    const probes: Array<string | undefined> = [
      undefined,
      "",
      "   ",
      "*/*",
      "text/*",
      "application/*",
      "application/json",
      "text/event-stream",
      "text/html",
      ",",
      "application/json;q=0",
      "not a media type at all",
    ];

    for (const probe of probes) {
      const format: ResponseFormat = negotiateResponseFormat(probe).format;
      expect([
        ResponseFormat.Json,
        ResponseFormat.ServerSentEvents,
        ResponseFormat.Unacceptable,
      ]).toContain(format);
    }
  });
});

describe("request header rewriting — adversarial shapes", () => {
  it("survives an odd-length rawHeaders array", () => {
    const req: HeaderMutableRequest = {
      headers: { accept: "application/json" },
      // Malformed on purpose: a trailing name with no value.
      rawHeaders: ["Accept", "application/json", "X-Dangling"],
    };

    expect(() => {
      return setRequestHeader(req, "Accept", NORMALIZED_ACCEPT_HEADER);
    }).not.toThrow();
    expect(req.headers["accept"]).toBe(NORMALIZED_ACCEPT_HEADER);
  });

  it("collapses headers that differ only by case", () => {
    const req: HeaderMutableRequest = {
      headers: { accept: "text/html" },
      rawHeaders: [
        "Accept",
        "text/html",
        "ACCEPT",
        "text/plain",
        "aCcEpT",
        "*/" + "*",
      ],
    };

    setRequestHeader(req, "Accept", NORMALIZED_ACCEPT_HEADER);

    const names: string[] = (req.rawHeaders as string[]).filter(
      (_value: string, index: number) => {
        // rawHeaders alternates name, value — even indexes are the names.
        return index % 2 === 0;
      },
    );
    expect(
      names.filter((name: string) => {
        return name.toLowerCase() === "accept";
      }),
    ).toHaveLength(1);
  });

  it("stays consistent across several rewrites in sequence", () => {
    const req: HeaderMutableRequest = {
      headers: { "mcp-protocol-version": "2026-07-28" },
      rawHeaders: ["MCP-Protocol-Version", "2026-07-28"],
    };

    setRequestHeader(req, "mcp-protocol-version", "2025-11-25");
    setRequestHeader(req, "mcp-protocol-version", "2025-06-18");
    setRequestHeader(req, "mcp-protocol-version", "2024-11-05");

    expect(req.headers["mcp-protocol-version"]).toBe("2024-11-05");
    expect(req.rawHeaders).toEqual(["mcp-protocol-version", "2024-11-05"]);
  });

  it("is idempotent — setting the same value twice changes nothing", () => {
    const req: HeaderMutableRequest = {
      headers: {},
      rawHeaders: ["Content-Type", "application/json"],
    };

    setRequestHeader(req, "Accept", NORMALIZED_ACCEPT_HEADER);
    const afterFirst: string[] = [...(req.rawHeaders as string[])];
    setRequestHeader(req, "Accept", NORMALIZED_ACCEPT_HEADER);

    expect(req.rawHeaders).toEqual(afterFirst);
  });

  it("removes a blank header rather than leaving an empty value behind", () => {
    /*
     * The bug this pins: an empty string is not null to the SDK, so a
     * present-but-blank header still fails its membership check.
     */
    const req: HeaderMutableRequest = {
      headers: { "mcp-protocol-version": "" },
      rawHeaders: ["MCP-Protocol-Version", ""],
    };

    removeRequestHeader(req, "mcp-protocol-version");

    expect(req.rawHeaders).toEqual([]);
    expect("mcp-protocol-version" in req.headers).toBe(false);
  });
});

describe("isInitializeRequestBody — malformed bodies", () => {
  const NON_INITIALIZE_BODIES: Array<[string, unknown]> = [
    ["a bare number", 42],
    ["the bare string", "initialize"],
    ["a boolean", true],
    // An array of arrays: the inner array is not a JSON-RPC message.
    ["a doubly nested batch", [[{ method: "initialize" }]]],
    ["a capitalised key", { Method: "initialize" }],
    ["a non-string method", { method: { toString: "initialize" } }],
    ["initialize buried in params", { params: { method: "initialize" } }],
  ];

  it.each(NON_INITIALIZE_BODIES)(
    "does not treat %s as an initialize request",
    (_label: string, body: unknown) => {
      expect(isInitializeRequestBody(body)).toBe(false);
    },
  );

  it("finds initialize anywhere in a batch", () => {
    expect(
      isInitializeRequestBody([
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { jsonrpc: "2.0", id: 2, method: "initialize", params: {} },
      ]),
    ).toBe(true);
  });
});

describe("sanitizeForLog", () => {
  /*
   * Everything the diagnostics report comes off the network, so a caller must
   * not be able to forge log lines or flood the log through them.
   */
  it("flattens newlines and carriage returns so log lines cannot be forged", () => {
    const forged: string = sanitizeForLog(
      "tools/list\nERROR: fake log line injected",
    );

    expect(forged).not.toContain("\n");
    expect(forged).toContain("fake log line injected");
  });

  it("strips other control characters", () => {
    expect(sanitizeForLog("a\u0000b\u001Fc\u007Fd")).toBe("a b c d");
  });

  it("caps an unbounded value", () => {
    const result: string = sanitizeForLog("x".repeat(5000));

    expect(result.length).toBeLessThan(200);
    expect(result).toContain("truncated");
  });

  it("leaves an ordinary value untouched", () => {
    expect(sanitizeForLog("application/json, text/event-stream")).toBe(
      "application/json, text/event-stream",
    );
  });

  it("maps empty and undefined to an empty string", () => {
    expect(sanitizeForLog(undefined)).toBe("");
    expect(sanitizeForLog("")).toBe("");
  });
});

describe("readSingleValueHeader", () => {
  /*
   * Node collapses most repeated headers into ONE comma-joined string rather
   * than an array. Treating that whole string as the value made a client which
   * sent MCP-Protocol-Version twice fail the version format check and get a
   * 400 — the exact rejection this fix exists to remove.
   */
  it("takes the first value of a comma-joined repeated header", () => {
    expect(readSingleValueHeader("2026-07-28, 2025-06-18")).toBe("2026-07-28");
  });

  it("takes the first value of an array-shaped repeated header", () => {
    expect(readSingleValueHeader(["2026-07-28", "2025-06-18"])).toBe(
      "2026-07-28",
    );
  });

  it("leaves a single value untouched", () => {
    expect(readSingleValueHeader("2025-11-25")).toBe("2025-11-25");
  });

  it("trims whitespace around each form", () => {
    expect(readSingleValueHeader("  2025-11-25 , 2024-11-05 ")).toBe(
      "2025-11-25",
    );
  });

  it("treats absent, empty and comma-only values as absent", () => {
    expect(readSingleValueHeader(undefined)).toBeUndefined();
    expect(readSingleValueHeader("")).toBeUndefined();
    expect(readSingleValueHeader("   ")).toBeUndefined();
    expect(readSingleValueHeader(",")).toBeUndefined();
    expect(readSingleValueHeader(" , 2025-11-25")).toBeUndefined();
  });
});

describe("negotiateProtocolVersion — repeated headers as Node delivers them", () => {
  it("negotiates a comma-joined duplicate down instead of rejecting it", () => {
    const result: ProtocolNegotiationResult = negotiateProtocolVersion(
      "2026-07-28, 2025-06-18",
    );

    expect(result.outcome).toBe(
      ProtocolNegotiationOutcome.DowngradedToSupported,
    );
    expect(result.negotiatedVersion).toBe(LATEST_PROTOCOL_VERSION);
  });

  it("accepts a comma-joined duplicate of a supported version", () => {
    const result: ProtocolNegotiationResult = negotiateProtocolVersion(
      `${LATEST_PROTOCOL_VERSION}, ${LATEST_PROTOCOL_VERSION}`,
    );

    expect(result.outcome).toBe(ProtocolNegotiationOutcome.Supported);
    expect(result.negotiatedVersion).toBe(LATEST_PROTOCOL_VERSION);
  });
});
