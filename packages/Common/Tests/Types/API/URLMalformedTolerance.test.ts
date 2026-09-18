import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * A status page went blank because ONE footer link, saved years earlier by a
 * looser validator as "https://tel:3136361710/", no longer parsed. The value
 * was hydrated by the column transformer during findBy, so the throw escaped
 * the query and 400'd the whole /master-page config endpoint — the page never
 * got its config and sat on "Loading..." forever.
 *
 * The rule these tests pin: reads tolerate a value that no longer validates,
 * writes never accept one. A single bad legacy row may degrade itself and
 * nothing else.
 */

interface Transformer {
  to: (value: unknown) => unknown;
  from: (value: unknown) => unknown;
}

const transformer: Transformer = URL.getDatabaseTransformer() as Transformer;

/*
 * Values the old character-allowlist Hostname accepted and the current
 * structural one does not. Every one of these can already be sitting in a
 * customer's database.
 */
const legacyUnparseableValues: Array<string> = [
  // The value that actually took the status page down.
  "https://tel:3136361710/",
  // Ports that are not ports.
  "https://host:99999999/",
  "https://example.com:notaport/",
  // Hosts that are not hosts.
  "https://-leading-dash.example.com/",
  "https://trailing-dash-.example.com/",
  "https:// /",
  "https://exa mple.com/",
];

describe("URL — reads tolerate a value that no longer parses", () => {
  test.each(legacyUnparseableValues)(
    "fromStringLenient(%s) does not throw",
    (raw: string) => {
      expect(() => {
        return URL.fromStringLenient(raw);
      }).not.toThrow();
    },
  );

  test.each(legacyUnparseableValues)(
    "fromStringLenient(%s) flags the value as malformed",
    (raw: string) => {
      expect(URL.fromStringLenient(raw).isMalformed()).toBe(true);
    },
  );

  test.each(legacyUnparseableValues)(
    "fromStringLenient(%s) preserves the value verbatim",
    (raw: string) => {
      // The link still renders as exactly what it always was.
      expect(URL.fromStringLenient(raw).toString()).toBe(raw);
    },
  );

  test.each(legacyUnparseableValues)(
    "the column transformer reads %s without throwing",
    (raw: string) => {
      let result: URL | null = null;

      expect(() => {
        result = transformer.from(raw) as URL;
      }).not.toThrow();

      expect(result).toBeInstanceOf(URL);
      expect((result as unknown as URL).toString()).toBe(raw);
    },
  );

  test("fromString stays strict — leniency is opt-in, on read paths only", () => {
    for (const raw of legacyUnparseableValues) {
      expect(() => {
        return URL.fromString(raw);
      }).toThrow(BadDataException);
    }
  });
});

describe("URL — a malformed value exposes no host", () => {
  /*
   * The security property that makes leniency safe: nothing can read a
   * hostname off a malformed URL and turn it into a request target. The
   * outbound guards (SSRFProtection) re-parse the raw string with the WHATWG
   * parser and never trusted this type's parse anyway.
   */
  test.each(legacyUnparseableValues)(
    "%s yields no hostname and no opaque value",
    (raw: string) => {
      const url: URL = URL.fromStringLenient(raw);

      expect(url.hostname).toBeUndefined();
      expect(url.opaqueValue).toBe("");
    },
  );

  test("a malformed URL reports the https default protocol", () => {
    expect(URL.fromStringLenient("https://tel:3136361710/").protocol).toBe(
      Protocol.HTTPS,
    );
  });

  test("removeQueryString on a malformed URL does not throw", () => {
    const url: URL = URL.fromStringLenient("https://tel:3136361710/?a=1");

    expect(() => {
      return url.removeQueryString();
    }).not.toThrow();
    expect(url.removeQueryString().isMalformed()).toBe(true);
  });
});

describe("URL — writes stay strict", () => {
  test.each(legacyUnparseableValues)(
    "the column transformer refuses to write back %s",
    (raw: string) => {
      const malformed: URL = URL.fromStringLenient(raw);

      expect(() => {
        return transformer.to(malformed);
      }).toThrow(BadDataException);
    },
  );

  test("a client cannot invent a malformed URL and have it persisted", () => {
    /*
     * fromJSON is lenient so the browser can render a legacy link — but the
     * value it produces is still refused on the way back into the database.
     */
    const fromClient: URL = URL.fromJSON({
      _type: "URL",
      value: "https://tel:3136361710/",
    });

    expect(fromClient.isMalformed()).toBe(true);
    expect(() => {
      return transformer.to(fromClient);
    }).toThrow(BadDataException);
  });

  test("a raw malformed string is refused on write too", () => {
    expect(() => {
      return transformer.to("https://tel:3136361710/");
    }).toThrow(BadDataException);
  });

  test("the write error names the offending value", () => {
    expect(() => {
      return transformer.to(URL.fromStringLenient("https://tel:3136361710/"));
    }).toThrow("URL https://tel:3136361710/ is not in valid format.");
  });

  test("valid URLs still write normally", () => {
    expect(transformer.to(URL.fromString("https://example.com/privacy"))).toBe(
      "https://example.com/privacy",
    );
    expect(transformer.to(URL.fromString("tel:+13136361710"))).toBe(
      "tel:+13136361710",
    );
  });
});

describe("URL — leniency does not touch valid values", () => {
  const validValues: Array<string> = [
    "https://example.com/privacy",
    "https://docs.voice.izt.cloud/",
    "http://localhost:5000/api/test",
    "mailto:support@voice.izt.cloud",
    "tel:+13136361710",
    "sms:+15555550123",
    "wss://localhost:5000/api/test",
  ];

  test.each(validValues)("%s is not flagged malformed", (raw: string) => {
    expect(URL.fromStringLenient(raw).isMalformed()).toBe(false);
    expect((transformer.from(raw) as URL).isMalformed()).toBe(false);
  });

  test.each(validValues)("%s parses identically either way", (raw: string) => {
    expect(URL.fromStringLenient(raw).toString()).toBe(
      URL.fromString(raw).toString(),
    );
  });

  test("an empty stored value is still null, not a malformed URL", () => {
    expect(transformer.from("")).toBeNull();
    expect(transformer.from(null)).toBeNull();
  });

  test("undefined is still passed through untouched on write", () => {
    // A column the caller never set must stay undefined so its DEFAULT applies.
    expect(transformer.to(undefined)).toBeUndefined();
  });
});

/*
 * The end-to-end shape of the outage: a status page's footer links, one of
 * which is the bad legacy row. Reading the set must yield every link.
 */
describe("URL — one bad link no longer takes down the page that lists it", () => {
  const storedFooterLinks: Array<{ title: string; link: string }> = [
    { title: "Phone", link: "https://tel:3136361710/" },
    { title: "Email", link: "mailto:support@voice.izt.cloud" },
    { title: "Docs", link: "https://docs.voice.izt.cloud/" },
    { title: "Portal", link: "https://portal.voice.izt.cloud/" },
  ];

  test("hydrating the whole set does not throw", () => {
    expect(() => {
      return storedFooterLinks.map((row: { link: string }) => {
        return transformer.from(row.link);
      });
    }).not.toThrow();
  });

  test("every link survives, including the malformed one", () => {
    const hydrated: Array<URL> = storedFooterLinks.map(
      (row: { link: string }) => {
        return transformer.from(row.link) as URL;
      },
    );

    expect(hydrated).toHaveLength(4);
    expect(
      hydrated.map((url: URL) => {
        return url.toString();
      }),
    ).toEqual([
      "https://tel:3136361710/",
      "mailto:support@voice.izt.cloud",
      "https://docs.voice.izt.cloud/",
      "https://portal.voice.izt.cloud/",
    ]);
  });

  test("only the bad row is degraded", () => {
    const hydrated: Array<URL> = storedFooterLinks.map(
      (row: { link: string }) => {
        return transformer.from(row.link) as URL;
      },
    );

    expect(
      hydrated.map((url: URL) => {
        return url.isMalformed();
      }),
    ).toEqual([true, false, false, false]);
  });

  test("the whole set still serialises to JSON for the browser", () => {
    expect(() => {
      return storedFooterLinks.map((row: { link: string }) => {
        return (transformer.from(row.link) as URL).toJSON();
      });
    }).not.toThrow();
  });

  /*
   * Had the fix stopped at the server, the 400 would simply have become a
   * client-side crash when the browser revived the same value.
   */
  test("and the browser can revive every one of them", () => {
    const revived: Array<URL> = storedFooterLinks.map(
      (row: { link: string }) => {
        return URL.fromJSON((transformer.from(row.link) as URL).toJSON());
      },
    );

    expect(
      revived.map((url: URL) => {
        return url.toString();
      }),
    ).toEqual([
      "https://tel:3136361710/",
      "mailto:support@voice.izt.cloud",
      "https://docs.voice.izt.cloud/",
      "https://portal.voice.izt.cloud/",
    ]);
  });

  /*
   * And the correct value going forward: the same phone link, typed as a real
   * tel: URI, is valid on write and needs no leniency at all.
   */
  test("the same link stored correctly needs no leniency", () => {
    const stored: unknown = transformer.to(URL.fromString("tel:+13136361710"));
    expect(stored).toBe("tel:+13136361710");
    expect((transformer.from(stored) as URL).isMalformed()).toBe(false);
  });
});
