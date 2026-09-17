import BadDataException from "../../../Types/Exception/BadDataException";
import {
  CompiledGrokPattern,
  GrokValue,
  MAX_GROK_INPUT_LENGTH,
  clearGrokCompileCache,
  compileGrokPattern,
  compileGrokPatternCached,
  matchGrokPattern,
  parseWithGrokPattern,
} from "../../../Utils/Grok/Grok";
import GrokPatterns, {
  getGrokPatternNames,
} from "../../../Utils/Grok/GrokPatterns";

/*
 * The grok engine behind the LogPipeline GrokParser processor
 * (OneUptime/oneuptime#2515). It runs once per ingested log record
 * against text the customer's users control, so both halves matter: it
 * has to extract what a user's pattern says it extracts, and it has to
 * refuse anything that would let a pattern or an input run away with the
 * ingest worker.
 */

describe("Grok - reference forms", () => {
  it("captures a named field", () => {
    expect(parseWithGrokPattern("%{WORD:verb}", "GET /index.html")).toEqual({
      verb: "GET",
    });
  });

  it("matches without capturing when no field name is given", () => {
    expect(
      parseWithGrokPattern("%{WORD} %{WORD:second}", "hello world"),
    ).toEqual({ second: "world" });
  });

  it("mixes literal regex with grok references", () => {
    expect(
      parseWithGrokPattern(
        "^\\[%{LOGLEVEL:level}\\] %{GREEDYDATA:message}$",
        "[ERROR] disk is full",
      ),
    ).toEqual({ level: "ERROR", message: "disk is full" });
  });

  it("is unanchored, like Logstash", () => {
    expect(
      parseWithGrokPattern("%{IPV4:client_ip}", "request from 10.0.1.5 ok"),
    ).toEqual({ client_ip: "10.0.1.5" });
  });

  it("returns null when the pattern does not match", () => {
    expect(
      parseWithGrokPattern("%{IPV4:client_ip}", "no address here"),
    ).toBeNull();
  });

  it("returns an empty object for a pattern that matches but captures nothing", () => {
    expect(parseWithGrokPattern("%{WORD}", "hello")).toEqual({});
  });

  it("expands nested references, keeping the sub-pattern's own field names", () => {
    // SYSLOGBASE names timestamp / logsource / program / pid internally.
    const parsed: Record<string, GrokValue> | null = parseWithGrokPattern(
      "%{SYSLOGBASE} %{GREEDYDATA:message}",
      "Oct 12 14:03:21 web-01 sshd[1234]: connection closed",
    );

    expect(parsed).toEqual({
      timestamp: "Oct 12 14:03:21",
      logsource: "web-01",
      program: "sshd",
      pid: "1234",
      message: "connection closed",
    });
  });
});

describe("Grok - type coercion", () => {
  it("coerces int / integer / long to a number", () => {
    expect(parseWithGrokPattern("%{NUMBER:status:int}", "status 404")).toEqual({
      status: 404,
    });
    expect(
      parseWithGrokPattern("%{NUMBER:status:integer}", "status 404"),
    ).toEqual({ status: 404 });
    expect(parseWithGrokPattern("%{NUMBER:bytes:long}", "bytes 1024")).toEqual({
      bytes: 1024,
    });
  });

  it("coerces float / double / number to a number", () => {
    expect(
      parseWithGrokPattern("%{NUMBER:duration:float}", "took 12.5ms"),
    ).toEqual({ duration: 12.5 });
    expect(
      parseWithGrokPattern("%{NUMBER:duration:double}", "took 12.5ms"),
    ).toEqual({ duration: 12.5 });
  });

  it("keeps a negative number's sign", () => {
    expect(
      parseWithGrokPattern("%{NUMBER:delta:float}", "delta -3.25"),
    ).toEqual({ delta: -3.25 });
  });

  it("coerces booleans from the usual spellings", () => {
    expect(parseWithGrokPattern("%{WORD:cached:boolean}", "true")).toEqual({
      cached: true,
    });
    expect(parseWithGrokPattern("%{WORD:cached:bool}", "no")).toEqual({
      cached: false,
    });
    expect(parseWithGrokPattern("%{WORD:cached:boolean}", "1")).toEqual({
      cached: true,
    });
  });

  it("leaves a value that is not recognisably boolean as text", () => {
    expect(parseWithGrokPattern("%{WORD:cached:boolean}", "maybe")).toEqual({
      cached: "maybe",
    });
  });

  it("defaults to string when no type is given", () => {
    expect(parseWithGrokPattern("%{NUMBER:status}", "status 404")).toEqual({
      status: "404",
    });
  });

  it("rejects an unknown type at compile time", () => {
    expect(() => {
      return compileGrokPattern("%{WORD:foo:datetime}");
    }).toThrow(BadDataException);
  });
});

describe("Grok - capture semantics", () => {
  it("drops captures that did not participate in the match", () => {
    const parsed: Record<string, GrokValue> | null = parseWithGrokPattern(
      "%{WORD:verb}(?: %{NUMBER:status:int})?",
      "GET",
    );

    expect(parsed).toEqual({ verb: "GET" });
    expect(parsed).not.toHaveProperty("status");
  });

  it("drops empty captures", () => {
    expect(parseWithGrokPattern("a%{SPACE:gap}b", "ab")).toEqual({});
  });

  it("keeps the first branch that actually matched when a name repeats", () => {
    expect(
      parseWithGrokPattern(
        "(?:%{IPV4:host}|%{HOSTNAME:host})",
        "web-01 online",
      ),
    ).toEqual({ host: "web-01" });
  });

  it("does not leak internal group names", () => {
    const parsed: Record<string, GrokValue> | null = parseWithGrokPattern(
      "%{WORD:verb}",
      "GET",
    );

    expect(Object.keys(parsed as Record<string, GrokValue>)).toEqual(["verb"]);
  });
});

describe("Grok - pattern library", () => {
  it("parses a combined Apache access log line", () => {
    const line: string =
      '10.0.0.7 - frank [10/Oct/2023:13:55:36 -0700] "GET /apache_pb.gif HTTP/1.0" 200 2326 "http://example.com/start.html" "Mozilla/5.0"';

    expect(parseWithGrokPattern("%{COMBINEDAPACHELOG}", line)).toEqual({
      clientip: "10.0.0.7",
      ident: "-",
      auth: "frank",
      timestamp: "10/Oct/2023:13:55:36 -0700",
      verb: "GET",
      request: "/apache_pb.gif",
      httpversion: "1.0",
      response: "200",
      bytes: "2326",
      referrer: '"http://example.com/start.html"',
      agent: '"Mozilla/5.0"',
    });
  });

  it("parses an ISO8601 timestamped application line", () => {
    expect(
      parseWithGrokPattern(
        "%{TIMESTAMP_ISO8601:timestamp} %{LOGLEVEL:level} %{JAVACLASS:logger} - %{GREEDYDATA:message}",
        "2023-10-10T13:55:36.123Z WARN com.example.svc.Worker - queue is backing up",
      ),
    ).toEqual({
      timestamp: "2023-10-10T13:55:36.123Z",
      level: "WARN",
      logger: "com.example.svc.Worker",
      message: "queue is backing up",
    });
  });

  it("matches IPv6 addresses", () => {
    expect(
      parseWithGrokPattern(
        "%{IP:client_ip}",
        "from 2001:db8::8a2e:370:7334 ok",
      ),
    ).toEqual({ client_ip: "2001:db8::8a2e:370:7334" });
  });

  it("matches email addresses, UUIDs and MAC addresses", () => {
    expect(
      parseWithGrokPattern(
        "%{EMAILADDRESS:email}",
        "user: jane.doe@example.com",
      ),
    ).toEqual({ email: "jane.doe@example.com" });

    expect(
      parseWithGrokPattern(
        "%{UUID:request_id}",
        "rid=123e4567-e89b-12d3-a456-426614174000",
      ),
    ).toEqual({ request_id: "123e4567-e89b-12d3-a456-426614174000" });

    expect(parseWithGrokPattern("%{MAC:mac}", "mac 00:1A:2B:3C:4D:5E")).toEqual(
      {
        mac: "00:1A:2B:3C:4D:5E",
      },
    );
  });

  it("matches quoted strings and URIs", () => {
    expect(
      parseWithGrokPattern("%{QS:quoted}", 'said "hello world" once'),
    ).toEqual({ quoted: '"hello world"' });

    expect(
      parseWithGrokPattern(
        "%{URI:url}",
        "fetching https://example.com/a/b?c=1 now",
      ),
    ).toEqual({ url: "https://example.com/a/b?c=1" });
  });

  it("rejects an out-of-range IPv4 octet", () => {
    expect(parseWithGrokPattern("%{IPV4:ip}", "999.1.1.1")).toBeNull();
  });

  it("every library definition compiles on its own", () => {
    for (const name of getGrokPatternNames()) {
      expect(() => {
        return compileGrokPattern(`%{${name}}`);
      }).not.toThrow();
    }
  });

  it("no library definition uses a capturing group", () => {
    for (const [name, definition] of Object.entries(GrokPatterns)) {
      /*
       * The engine reads captures back by group NAME and injects those
       * names itself, so a bare "(" in a definition would burn a capture
       * slot on every record for nothing. Escapes and character classes
       * are stripped first - "\\(" and "[(]" are literal parentheses.
       */
      const withoutEscapes: string = definition.replace(/\\./g, "");
      const withoutCharacterClasses: string = withoutEscapes.replace(
        /\[[^\]]*\]/g,
        "",
      );
      const capturing: RegExpMatchArray | null =
        withoutCharacterClasses.match(/\((?!\?)/);

      expect([name, capturing]).toEqual([name, null]);
    }
  });
});

describe("Grok - compile errors are actionable", () => {
  it("rejects an empty pattern", () => {
    expect(() => {
      return compileGrokPattern("   ");
    }).toThrow("Grok pattern cannot be empty.");
  });

  it("rejects an unknown pattern name", () => {
    expect(() => {
      return compileGrokPattern("%{NOSUCHPATTERN:foo}");
    }).toThrow('Unknown grok pattern "%{NOSUCHPATTERN}"');
  });

  it("rejects an invalid field name", () => {
    expect(() => {
      return compileGrokPattern("%{WORD:my field}");
    }).toThrow(BadDataException);
  });

  it("rejects invalid raw regex", () => {
    expect(() => {
      return compileGrokPattern("%{WORD:verb} (unclosed");
    }).toThrow(BadDataException);
  });

  it("rejects an over-long pattern", () => {
    expect(() => {
      return compileGrokPattern(`%{WORD:verb}${"x".repeat(4000)}`);
    }).toThrow("cannot be longer than");
  });
});

describe("Grok - runaway guards", () => {
  it("rejects a circular pattern reference instead of hanging", () => {
    expect(() => {
      return compileGrokPattern("%{A_PATTERN:x}", {
        A_PATTERN: "%{B_PATTERN}",
        B_PATTERN: "%{A_PATTERN}",
      });
    }).toThrow("refers to itself");
  });

  it("rejects a self-referencing pattern", () => {
    expect(() => {
      return compileGrokPattern("%{SELF:x}", { SELF: "a%{SELF}" });
    }).toThrow("refers to itself");
  });

  it("rejects nesting deeper than the depth ceiling", () => {
    const deep: Record<string, string> = {};

    for (let i: number = 0; i < 30; i++) {
      deep[`LEVEL${i}`] = `%{LEVEL${i + 1}}`;
    }

    deep["LEVEL30"] = "x";

    expect(() => {
      return compileGrokPattern("%{LEVEL0:x}", deep);
    }).toThrow("levels deep");
  });

  it("rejects a pattern that expands past the source-length ceiling", () => {
    /*
     * Each level doubles, so this blows the size ceiling long before the
     * depth one - the guard that has to hold for a pattern which is
     * shallow but explosive.
     */
    const doubling: Record<string, string> = { WIDE10: "x" };

    for (let i: number = 0; i < 10; i++) {
      doubling[`WIDE${i}`] = `%{WIDE${i + 1}}%{WIDE${i + 1}}`;
    }

    expect(() => {
      return compileGrokPattern("%{WIDE0:x}", doubling);
    }).toThrow(BadDataException);
  });

  it("rejects a pattern capturing more fields than the ceiling allows", () => {
    const many: string = new Array(120)
      .fill(null)
      .map((_unused: null, index: number) => {
        return `%{WORD:field_${index}}`;
      })
      .join(" ");

    expect(() => {
      return compileGrokPattern(many);
    }).toThrow("captures more than");
  });

  it("refuses to run against an input over the length ceiling", () => {
    const compiled: CompiledGrokPattern = compileGrokPattern("%{WORD:first}");

    expect(matchGrokPattern(compiled, "hello")).toEqual({ first: "hello" });
    expect(
      matchGrokPattern(compiled, "a".repeat(MAX_GROK_INPUT_LENGTH + 1)),
    ).toBeNull();
  });

  it("returns null for an empty input", () => {
    const compiled: CompiledGrokPattern =
      compileGrokPattern("%{GREEDYDATA:all}");

    expect(matchGrokPattern(compiled, "")).toBeNull();
  });
});

describe("Grok - compiled patterns are reusable", () => {
  it("does not carry match state between calls", () => {
    const compiled: CompiledGrokPattern = compileGrokPattern("%{WORD:word}");

    expect(compiled.regex.global).toBe(false);
    expect(compiled.regex.sticky).toBe(false);

    for (let i: number = 0; i < 5; i++) {
      expect(matchGrokPattern(compiled, "alpha beta")).toEqual({
        word: "alpha",
      });
    }
  });
});

describe("Grok - library patterns stay linear on hostile input", () => {
  /*
   * These run once per ingested record against text a customer's users
   * control, and a backtracking regex cannot be interrupted once it
   * starts. Every library definition is written so each repetition
   * consumes at least one character; this is the check that nobody adds
   * an `(a*)*`-shaped one later. Thresholds are deliberately loose - the
   * failure mode being caught is seconds-to-forever, not milliseconds.
   */
  const HOSTILE_LINES: Array<[string, string]> = [
    ["%{COMBINEDAPACHELOG}", `10.0.0.7 - - [${"a".repeat(4000)}`],
    ["%{URI:url}", `https://example.com/${"a/".repeat(2000)}`],
    ["%{PATH:path}", `/${"a/".repeat(2000)}`],
    ["%{IPV6:ip}", `${"1:".repeat(2000)}z`],
    ["%{QS:quoted}", `"${"\\".repeat(2000)}`],
    ["%{EMAILADDRESS:email}", `${"a.".repeat(2000)}@`],
    ["%{TIMESTAMP_ISO8601:ts}", `${"2023-10-10T13:55:".repeat(500)}x`],
    ["%{HOSTNAME:host}", `${"a.".repeat(2000)}!`],
  ];

  it.each(HOSTILE_LINES)(
    "%s finishes quickly on input built to make it backtrack",
    (pattern: string, input: string) => {
      const compiled: CompiledGrokPattern = compileGrokPattern(pattern);
      const startedAt: number = Date.now();

      matchGrokPattern(compiled, input);

      expect(Date.now() - startedAt).toBeLessThan(2000);
    },
  );

  it("stays quick across a whole batch of records", () => {
    const compiled: CompiledGrokPattern = compileGrokPattern(
      "%{COMBINEDAPACHELOG}",
    );
    const line: string =
      '10.0.0.7 - frank [10/Oct/2023:13:55:36 -0700] "GET /a HTTP/1.0" 200 23 "-" "-"';

    const startedAt: number = Date.now();

    for (let i: number = 0; i < 2000; i++) {
      matchGrokPattern(compiled, line);
    }

    expect(Date.now() - startedAt).toBeLessThan(2000);
  });
});

describe("Grok - compile cache", () => {
  beforeEach(() => {
    clearGrokCompileCache();
  });

  it("returns the same compiled instance for the same pattern text", () => {
    const first: CompiledGrokPattern = compileGrokPatternCached("%{WORD:verb}");
    const second: CompiledGrokPattern =
      compileGrokPatternCached("%{WORD:verb}");

    expect(second).toBe(first);
  });

  it("re-throws for a pattern that failed to compile, without recompiling", () => {
    expect(() => {
      return compileGrokPatternCached("%{NOSUCHPATTERN}");
    }).toThrow(BadDataException);

    expect(() => {
      return compileGrokPatternCached("%{NOSUCHPATTERN}");
    }).toThrow(BadDataException);
  });

  it("stays bounded", () => {
    for (let i: number = 0; i < 600; i++) {
      compileGrokPatternCached(`%{WORD:field_${i}}`);
    }

    // The oldest entries were evicted, so this recompiles into a new object.
    const recompiled: CompiledGrokPattern =
      compileGrokPatternCached("%{WORD:field_0}");

    expect(recompiled).not.toBe(compileGrokPatternCached("%{WORD:field_599}"));
    expect(recompiled.captures).toHaveLength(1);
  });
});
