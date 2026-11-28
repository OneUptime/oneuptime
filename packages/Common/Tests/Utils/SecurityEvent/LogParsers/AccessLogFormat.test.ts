import { describe, expect, test } from "@jest/globals";
import {
  ACCESS_LOG_VARIABLES,
  AccessLogEscape,
  AccessLogFormat,
  AccessLogFormatProblemKind,
  AccessLogFormatReading,
  KNOWN_ACCESS_LOG_FORMATS,
  KnownAccessLogFormat,
  MAX_ACCESS_LOG_FORMAT_LENGTH,
  getAccessLogFormatError,
  readAccessLogFields,
  readAccessLogFormat,
} from "../../../../Utils/SecurityEvent/LogParsers/AccessLogFormat";

/*
 * #11048: AN ACCESS LOG READ BY THE PROJECT'S OWN FORMAT.
 *
 * A project gives its nginx log_format - the directive from nginx.conf,
 * ingress-nginx's log-format-upstream, or the format as text - and each
 * line in it is read field by field, so $http_x_forwarded_for is read
 * wherever the format puts it. These suites hold what is read of what a
 * person gives, and of real nginx and ingress-nginx lines: every field
 * where the format says, no field a client wrote taken for another, and
 * no line that is not in the format read as one.
 */

// nginx's own main format, as nginx.conf writes it.
const NGINX_MAIN: string = KNOWN_ACCESS_LOG_FORMATS.find(
  (known: KnownAccessLogFormat): boolean => {
    return known.key === "nginx-main";
  },
)!.text;

const INGRESS_NGINX: string = KNOWN_ACCESS_LOG_FORMATS.find(
  (known: KnownAccessLogFormat): boolean => {
    return known.key === "ingress-nginx-upstreaminfo";
  },
)!.text;

// The issue's own format: X-Forwarded-For, then the request's duration.
const TIMED: string = `log_format timed '$remote_addr - $remote_user [$time_local] "$request" '
                 '$status $body_bytes_sent "$http_referer" '
                 '"$http_user_agent" "$http_x_forwarded_for" $request_time';`;

function formatOf(text: string): AccessLogFormat {
  const reading: AccessLogFormatReading = readAccessLogFormat(text);

  expect(reading.problem).toBeNull();
  expect(reading.format).not.toBeNull();

  return reading.format!;
}

function fieldsOf(line: string, text: string): Record<string, string> | null {
  const fields: Map<string, string> | null = readAccessLogFields(
    line,
    formatOf(text),
  );

  return fields ? Object.fromEntries(fields) : null;
}

describe("what a person gives", () => {
  test("nginx's log_format directive, across lines as nginx.conf writes it", () => {
    const format: AccessLogFormat = formatOf(NGINX_MAIN);

    expect(format.pattern).toBe(
      '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" "$http_x_forwarded_for"',
    );
    expect(format.escape).toBe(AccessLogEscape.Default);
    expect(format.connectionVariable).toBe(ACCESS_LOG_VARIABLES.connection);
    expect(format.readsForwardedFor).toBe(true);
  });

  test("the directive's strings alone, as copied from inside it", () => {
    expect(
      formatOf(
        `'$remote_addr - $remote_user [$time_local] "$request" '\n'$status $body_bytes_sent "$http_referer" "$http_user_agent" "$http_x_forwarded_for"';`,
      ).pattern,
    ).toBe(formatOf(NGINX_MAIN).pattern);
  });

  test("the format as one line of text, quotes and all", () => {
    expect(
      formatOf(
        '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" "$http_x_forwarded_for"',
      ).pattern,
    ).toBe(formatOf(NGINX_MAIN).pattern);
  });

  test("ingress-nginx's ConfigMap key and its value", () => {
    const format: AccessLogFormat = formatOf(
      `log-format-upstream: '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" "$http_x_forwarded_for" $request_length $request_time'`,
    );

    expect(format.readsForwardedFor).toBe(true);
    expect(format.pattern.startsWith("$remote_addr - ")).toBe(true);
  });

  test("escape=json and escape=none are read from the directive", () => {
    expect(
      formatOf(
        `log_format json_like escape=json '$remote_addr "$request" "$http_x_forwarded_for"';`,
      ).escape,
    ).toBe(AccessLogEscape.Json);
    expect(
      formatOf(
        `log_format raw escape=none '$remote_addr "$request" "$http_x_forwarded_for"';`,
      ).escape,
    ).toBe(AccessLogEscape.None);
  });

  test("a comment in a pasted block is no part of the format", () => {
    expect(formatOf(`# Behind the load balancer\n${NGINX_MAIN}`).pattern).toBe(
      formatOf(NGINX_MAIN).pattern,
    );
  });

  test("a variable in braces is the variable, and a dollar on its own is text", () => {
    const format: AccessLogFormat = formatOf(
      '${remote_addr} - $ "$request" "${http_x_forwarded_for}"',
    );

    expect(format.readsForwardedFor).toBe(true);
    expect(
      readAccessLogFields(
        '10.0.0.5 - $ "GET / HTTP/1.1" "198.51.100.7"',
        format,
      )?.get(ACCESS_LOG_VARIABLES.forwardedFor),
    ).toBe("198.51.100.7");
  });

  test("with nginx's realip module, the address that really connected is $realip_remote_addr", () => {
    expect(
      formatOf(
        '$realip_remote_addr $remote_addr "$request" "$http_x_forwarded_for"',
      ).connectionVariable,
    ).toBe(ACCESS_LOG_VARIABLES.realConnection);
  });

  test("nothing given is no format, and nothing wrong", () => {
    for (const given of [undefined, null, "", "   \n  "]) {
      expect(readAccessLogFormat(given)).toEqual({
        format: null,
        problem: null,
      });
    }
  });

  test("every format OneUptime offers to start from is one it reads", () => {
    for (const known of KNOWN_ACCESS_LOG_FORMATS) {
      expect({
        key: known.key,
        problem: readAccessLogFormat(known.text).problem,
      }).toEqual({ key: known.key, problem: null });
      expect(known.name.trim()).not.toBe("");
    }

    // nginx's main logs X-Forwarded-For; ingress-nginx's default logs none.
    expect(formatOf(NGINX_MAIN).readsForwardedFor).toBe(true);
    expect(formatOf(INGRESS_NGINX).readsForwardedFor).toBe(false);
  });
});

describe("what is refused, and why", () => {
  test("a format too long to be one", () => {
    expect(
      readAccessLogFormat(
        `$remote_addr ${"x".repeat(MAX_ACCESS_LOG_FORMAT_LENGTH)}`,
      ).problem,
    ).toEqual({
      kind: AccessLogFormatProblemKind.TooLong,
      max: MAX_ACCESS_LOG_FORMAT_LENGTH,
    });
  });

  test("a directive whose quote never closes", () => {
    expect(
      readAccessLogFormat(`log_format main '$remote_addr - "$request"`).problem,
    ).toEqual({ kind: AccessLogFormatProblemKind.NotClosed });
  });

  test("text that names no field", () => {
    expect(readAccessLogFormat("combined").problem).toEqual({
      kind: AccessLogFormatProblemKind.NoField,
    });
  });

  test("a format that does not log the address that connected", () => {
    expect(
      readAccessLogFormat('"$request" $status "$http_x_forwarded_for"').problem,
    ).toEqual({ kind: AccessLogFormatProblemKind.NoConnectionAddress });
  });

  test("an X-Forwarded-For whose end cannot be told: unquoted between two fields a client writes", () => {
    expect(
      readAccessLogFormat(
        '$remote_addr "$request" $http_user_agent $http_x_forwarded_for $http_referer',
      ).problem,
    ).toEqual({
      kind: AccessLogFormatProblemKind.UnclearField,
      variable: ACCESS_LOG_VARIABLES.forwardedFor,
    });
  });

  test("a connection address whose end cannot be told: after a field a client writes, with nothing to close it", () => {
    expect(
      readAccessLogFormat(
        '$remote_user $remote_addr $http_x_forwarded_for "$request"',
      ).problem,
    ).toEqual({
      kind: AccessLogFormatProblemKind.UnclearField,
      variable: ACCESS_LOG_VARIABLES.connection,
    });
  });

  test("each says why in English, for the server's refusal", () => {
    expect(getAccessLogFormatError(NGINX_MAIN)).toBeNull();
    expect(getAccessLogFormatError("")).toBeNull();
    expect(getAccessLogFormatError("combined")).toBe(
      "This is no nginx log format: it names no field, such as $remote_addr.",
    );
    expect(getAccessLogFormatError('"$request" "$http_x_forwarded_for"')).toBe(
      "Your log format must log the address that connected, $remote_addr, so OneUptime can tell whether it was a proxy you trust.",
    );
    expect(
      getAccessLogFormatError(
        '$remote_addr "$request" $http_user_agent $http_x_forwarded_for $http_referer',
      ),
    ).toBe(
      'OneUptime can\'t tell where $http_x_forwarded_for ends in your log format. Put it in quotes, as "$http_x_forwarded_for".',
    );
    expect(getAccessLogFormatError(`log_format main '$remote_addr`)).toBe(
      "A quote in your log format never closes. Paste it as your nginx.conf writes it.",
    );
    expect(
      getAccessLogFormatError(
        `$remote_addr ${"x".repeat(MAX_ACCESS_LOG_FORMAT_LENGTH)}`,
      ),
    ).toBe(
      `Your log format is too long. OneUptime reads one of up to ${MAX_ACCESS_LOG_FORMAT_LENGTH} characters.`,
    );
  });
});

describe("real nginx lines in nginx's main format", () => {
  test("a request through the load balancer: every field where the format says", () => {
    expect(
      fieldsOf(
        '10.0.0.5 - - [27/Nov/2026:10:15:33 +0000] "GET /search?q=1%27%20OR%20%271%27%3D%271 HTTP/1.1" 200 1532 "https://shop.example.com/" "Mozilla/5.0 (X11; Linux x86_64)" "203.0.113.7"',
        NGINX_MAIN,
      ),
    ).toEqual({
      remote_addr: "10.0.0.5",
      remote_user: "-",
      time_local: "27/Nov/2026:10:15:33 +0000",
      request: "GET /search?q=1%27%20OR%20%271%27%3D%271 HTTP/1.1",
      status: "200",
      body_bytes_sent: "1532",
      http_referer: "https://shop.example.com/",
      http_user_agent: "Mozilla/5.0 (X11; Linux x86_64)",
      http_x_forwarded_for: "203.0.113.7",
    });
  });

  test("a request that reached the web server directly: no header, nginx's '-'", () => {
    expect(
      fieldsOf(
        '198.51.100.20 - alice [27/Nov/2026:10:15:32 +0000] "GET /index.html HTTP/1.1" 304 0 "-" "curl/8.4.0" "-"',
        NGINX_MAIN,
      ),
    ).toEqual(
      expect.objectContaining({
        remote_addr: "198.51.100.20",
        remote_user: "alice",
        http_x_forwarded_for: "-",
      }),
    );
  });

  test("nginx writes a quote a client sent as \\x22: it stays inside its field", () => {
    expect(
      fieldsOf(
        '10.0.0.5 - - [27/Nov/2026:10:15:33 +0000] "GET / HTTP/1.1" 200 5 "-" "x\\x22 \\x22192.0.2.44" "198.51.100.66"',
        NGINX_MAIN,
      ),
    ).toEqual(
      expect.objectContaining({
        http_user_agent: "x\\x22 \\x22192.0.2.44",
        http_x_forwarded_for: "198.51.100.66",
      }),
    );
  });

  test("a user name a client chose, with brackets and spaces in it, moves no field", () => {
    expect(
      fieldsOf(
        '10.0.0.5 - x [01/Jan/2020:00:00:00 +0000] - [27/Nov/2026:10:15:33 +0000] "GET / HTTP/1.1" 200 5 "-" "curl" "198.51.100.66"',
        NGINX_MAIN,
      ),
    ).toEqual(
      expect.objectContaining({
        remote_addr: "10.0.0.5",
        remote_user: "x [01/Jan/2020:00:00:00 +0000] -",
        time_local: "27/Nov/2026:10:15:33 +0000",
      }),
    );
  });

  test("a header with several hops is read whole, for the walk from the right", () => {
    expect(
      fieldsOf(
        '10.0.0.5 - - [27/Nov/2026:10:15:33 +0000] "GET / HTTP/1.1" 200 5 "-" "curl" "192.0.2.44, 198.51.100.7, 10.0.0.9"',
        NGINX_MAIN,
      )?.["http_x_forwarded_for"],
    ).toBe("192.0.2.44, 198.51.100.7, 10.0.0.9");
  });
});

describe("the formats #10548 left out, each read once given", () => {
  test("X-Forwarded-For before $request_time (the issue's own)", () => {
    expect(
      fieldsOf(
        '10.0.0.5 - - [27/Nov/2026:10:15:33 +0000] "GET /?id=1 HTTP/1.1" 200 512 "-" "curl/8.0" "198.51.100.7" 0.004',
        TIMED,
      ),
    ).toEqual(
      expect.objectContaining({
        http_user_agent: "curl/8.0",
        http_x_forwarded_for: "198.51.100.7",
        request_time: "0.004",
      }),
    );
  });

  test("X-Forwarded-For before the user agent", () => {
    expect(
      fieldsOf(
        '10.0.0.5 [27/Nov/2026:10:15:33 +0000] "GET / HTTP/1.1" 200 "198.51.100.7" "curl/8.0"',
        '$remote_addr [$time_local] "$request" $status "$http_x_forwarded_for" "$http_user_agent"',
      ),
    ).toEqual(
      expect.objectContaining({
        http_x_forwarded_for: "198.51.100.7",
        http_user_agent: "curl/8.0",
      }),
    );
  });

  test("X-Forwarded-For unquoted at the end: the rest of the line", () => {
    expect(
      fieldsOf(
        '10.0.0.5 "GET / HTTP/1.1" 200 192.0.2.44, 198.51.100.7',
        '$remote_addr "$request" $status $http_x_forwarded_for',
      )?.["http_x_forwarded_for"],
    ).toBe("192.0.2.44, 198.51.100.7");
  });

  test("X-Forwarded-For unquoted before a field with no spaces: up to that field", () => {
    expect(
      fieldsOf(
        '10.0.0.5 192.0.2.44, 198.51.100.7 0.004 "GET / HTTP/1.1"',
        '$remote_addr $http_x_forwarded_for $request_time "$request"',
      ),
    ).toEqual(
      expect.objectContaining({
        http_x_forwarded_for: "192.0.2.44, 198.51.100.7",
        request_time: "0.004",
      }),
    );
  });

  test("with $upstream_addr, $host and a request id after it", () => {
    expect(
      fieldsOf(
        '10.0.0.5 - - [27/Nov/2026:10:15:33 +0000] "GET / HTTP/1.1" 200 5 "-" "curl" "198.51.100.7" "10.0.0.7:8080, 10.0.0.8:8080" "shop.example.com" "8f14e45fceea167a5a36dedd4bea2543"',
        '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" "$http_x_forwarded_for" "$upstream_addr" "$host" "$request_id"',
      ),
    ).toEqual(
      expect.objectContaining({
        http_x_forwarded_for: "198.51.100.7",
        upstream_addr: "10.0.0.7:8080, 10.0.0.8:8080",
        host: "shop.example.com",
        request_id: "8f14e45fceea167a5a36dedd4bea2543",
      }),
    );
  });

  test("X-Real-IP beside X-Forwarded-For: each its own field, never the other", () => {
    expect(
      fieldsOf(
        '10.0.0.5 "GET / HTTP/1.1" "192.0.2.44" "198.51.100.7"',
        '$remote_addr "$request" "$http_x_real_ip" "$http_x_forwarded_for"',
      ),
    ).toEqual({
      remote_addr: "10.0.0.5",
      request: "GET / HTTP/1.1",
      http_x_real_ip: "192.0.2.44",
      http_x_forwarded_for: "198.51.100.7",
    });
  });
});

describe("real ingress-nginx lines", () => {
  const UPSTREAMINFO_LINE: string =
    '10.244.0.1 - - [27/Nov/2026:10:15:32 +0000] "GET /api/v1/items?id=1\' OR \'1\'=\'1 HTTP/1.1" 404 19 "-" "curl/8.4.0" 532 0.002 [default-shop-80] [] 10.244.1.15:8080 19 0.002 404 c3f5a1f9e1b0d2a4e6f8a0b2c4d6e8f0';

  test("its default upstreaminfo: the connection, the request, the status and the user agent", () => {
    expect(fieldsOf(UPSTREAMINFO_LINE, INGRESS_NGINX)).toEqual(
      expect.objectContaining({
        remote_addr: "10.244.0.1",
        request: "GET /api/v1/items?id=1' OR '1'='1 HTTP/1.1",
        status: "404",
        body_bytes_sent: "19",
        http_user_agent: "curl/8.4.0",
        request_length: "532",
        request_time: "0.002",
      }),
    );
  });

  test("of the fields that cannot be told apart, none is read: never guessed at", () => {
    const fields: Record<string, string> | null = fieldsOf(
      UPSTREAMINFO_LINE,
      INGRESS_NGINX,
    );

    for (const variable of [
      "proxy_upstream_name",
      "proxy_alternative_upstream_name",
      "upstream_addr",
      "upstream_status",
      "req_id",
    ]) {
      expect(fields).not.toHaveProperty(variable);
    }
  });

  test("with X-Forwarded-For added to its format, as people run it behind a load balancer", () => {
    expect(
      fieldsOf(
        '10.244.0.1 - - [27/Nov/2026:10:15:32 +0000] "GET / HTTP/1.1" 404 19 "-" "curl/8.4.0" "192.0.2.44, 198.51.100.7" 532 0.002 [default-shop-80] [] 10.244.1.15:8080 19 0.002 404 c3f5',
        `log-format-upstream: '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" "$http_x_forwarded_for" $request_length $request_time [$proxy_upstream_name] [$proxy_alternative_upstream_name] $upstream_addr $upstream_response_length $upstream_response_time $upstream_status $req_id'`,
      )?.["http_x_forwarded_for"],
    ).toBe("192.0.2.44, 198.51.100.7");
  });
});

describe("a line that is not in the format is not read as one", () => {
  test.each([
    [
      "one quoted field too many",
      '10.0.0.5 - - [27/Nov/2026:10:15:33 +0000] "GET / HTTP/1.1" 200 5 "-" "curl" "198.51.100.7" "0.004"',
    ],
    [
      "one too few",
      '10.0.0.5 - - [27/Nov/2026:10:15:33 +0000] "GET / HTTP/1.1" 200 5 "-" "curl"',
    ],
    [
      "a status that is no status",
      '10.0.0.5 - - [27/Nov/2026:10:15:33 +0000] "GET / HTTP/1.1" OK 5 "-" "curl" "198.51.100.7"',
    ],
    [
      "a time that is no time",
      '10.0.0.5 - - [yesterday] "GET / HTTP/1.1" 200 5 "-" "curl" "198.51.100.7"',
    ],
    [
      "a first field that is no address",
      'web-1 - - [27/Nov/2026:10:15:33 +0000] "GET / HTTP/1.1" 200 5 "-" "curl" "198.51.100.7"',
    ],
    [
      "a syslog header before it",
      'Nov 27 10:15:33 web-1 nginx: 10.0.0.5 - - [27/Nov/2026:10:15:33 +0000] "GET / HTTP/1.1" 200 5 "-" "curl" "198.51.100.7"',
    ],
    [
      "another log altogether",
      "Failed password for root from 203.0.113.7 port 22 ssh2",
    ],
    [
      "a JSON line",
      '{"remote_addr":"10.0.0.5","request":"GET / HTTP/1.1","http_x_forwarded_for":"198.51.100.7"}',
    ],
  ])("%s", (_what: string, line: string) => {
    expect(fieldsOf(line, NGINX_MAIN)).toBeNull();
  });

  test("a variable logged twice with two values is no line of the format", () => {
    expect(
      fieldsOf(
        '10.0.0.5 "GET / HTTP/1.1" 10.0.0.6',
        '$remote_addr "$request" $remote_addr',
      ),
    ).toBeNull();
    expect(
      fieldsOf(
        '10.0.0.5 "GET / HTTP/1.1" 10.0.0.5',
        '$remote_addr "$request" $remote_addr',
      ),
    ).toEqual({ remote_addr: "10.0.0.5", request: "GET / HTTP/1.1" });
  });
});

/*
 * What a client writes never moves a field: a server that does not escape
 * quotes (escape=none, Express's morgan) lets a request add a quote, and
 * the line then has more quotes than the format, and fits no more.
 */
describe("a quote a client wrote", () => {
  const UNESCAPED: string = `log_format raw escape=none '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" "$http_x_forwarded_for"';`;

  test("as morgan writes it, unescaped: the line fits the format no more, and nothing is read", () => {
    expect(
      fieldsOf(
        '10.0.0.5 - - [27/Nov/2026:10:15:33 +0000] "GET / HTTP/1.1" 200 5 "-" "x" "192.0.2.44" "198.51.100.66"',
        UNESCAPED,
      ),
    ).toBeNull();
  });

  test("in the header itself, unescaped: the same", () => {
    expect(
      fieldsOf(
        '10.0.0.5 - - [27/Nov/2026:10:15:33 +0000] "GET / HTTP/1.1" 200 5 "-" "curl" "192.0.2.44" "x, 198.51.100.66"',
        UNESCAPED,
      ),
    ).toBeNull();
  });

  test("a line of the format with nothing added is read, unescaped or not", () => {
    expect(
      fieldsOf(
        '10.0.0.5 - - [27/Nov/2026:10:15:33 +0000] "GET / HTTP/1.1" 200 5 "-" "curl" "198.51.100.66"',
        UNESCAPED,
      )?.["http_x_forwarded_for"],
    ).toBe("198.51.100.66");
  });

  test('escape=json writes it as \\" and a backslash as \\\\: inside their fields', () => {
    const JSON_ESCAPED: string = `log_format j escape=json '$remote_addr "$http_user_agent" "$http_x_forwarded_for"';`;

    expect(
      fieldsOf('10.0.0.5 "x\\" \\"192.0.2.44" "198.51.100.66"', JSON_ESCAPED),
    ).toEqual({
      remote_addr: "10.0.0.5",
      http_user_agent: 'x\\" \\"192.0.2.44',
      http_x_forwarded_for: "198.51.100.66",
    });
    expect(
      fieldsOf('10.0.0.5 "agent\\\\" "198.51.100.66"', JSON_ESCAPED)?.[
        "http_user_agent"
      ],
    ).toBe("agent\\\\");
  });

  test("an Apache-escaped quote in a line given as nginx's: no line of the format", () => {
    expect(
      fieldsOf(
        '10.0.0.5 - - [27/Nov/2026:10:15:33 +0000] "GET / HTTP/1.1" 200 5 "-" "x\\" \\"192.0.2.44" "198.51.100.66"',
        NGINX_MAIN,
      ),
    ).toBeNull();
  });
});

describe("what a scrub rule left of an address", () => {
  test("in the connection's field: read, for the client reading to say it was hidden", () => {
    expect(
      fieldsOf(
        '[REDACTED] - - [27/Nov/2026:10:15:33 +0000] "GET / HTTP/1.1" 200 5 "-" "curl" "-"',
        NGINX_MAIN,
      )?.["remote_addr"],
    ).toBe("[REDACTED]");
  });
});

describe("the cost of a line", () => {
  test("a line of thousands of quotes is refused at the first quote too many", () => {
    const format: AccessLogFormat = formatOf(NGINX_MAIN);
    const line: string = `10.0.0.5 ${'"" '.repeat(50000)}`;

    expect(readAccessLogFields(line, format)).toBeNull();
  });

  test("a long user agent is one field, read in one pass", () => {
    const agent: string = "A".repeat(15000);

    expect(
      fieldsOf(
        `10.0.0.5 - - [27/Nov/2026:10:15:33 +0000] "GET / HTTP/1.1" 200 5 "-" "${agent}" "198.51.100.7"`,
        NGINX_MAIN,
      )?.["http_user_agent"],
    ).toBe(agent);
  });
});
