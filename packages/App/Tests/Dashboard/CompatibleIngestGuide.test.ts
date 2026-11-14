import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { isCompatibleIngestPath } from "Common/Types/Telemetry/CompatibleIngest";
import {
  COMPATIBLE_INGEST_GUIDES,
  CompatibleIngestEndpoint,
  CompatibleIngestGuideCopy,
  CompatibleIngestMethod,
  CompatibleIngestSnippet,
  SentryRuntime,
  getCompatibleIngestEndpointValue,
  getCompatibleIngestGuide,
  getCompatibleIngestGuides,
  getCompatibleIngestSnippets,
  getFluentBitHost,
  getHostAndPort,
  getSentryDsn,
  getUndashedKey,
  isCompatibleIngestMethod,
} from "../../FeatureSet/Dashboard/src/Components/Telemetry/CompatibleIngestGuide";

/*
 * The Setup Guide's "Already using another tool?" ways (issue #6797): each
 * product's guide lists the tools that fill it, every snippet carries the
 * install's own URL and the picked key in the form the tool needs (a DSN a
 * Sentry SDK accepts, a 32-hex Datadog API key), a host with a port is
 * split where a tool takes them apart, and every URL is one the App serves.
 */

const KEY: string = "6b4a1d5c-0c5e-4a8f-9a30-1f1f2b7d1e11";
const UNDASHED: string = "6b4a1d5c0c5e4a8f9a301f1f2b7d1e11";

const CLOUD: CompatibleIngestEndpoint = {
  protocol: "https",
  host: "oneuptime.com",
  key: KEY,
};

const LOCAL: CompatibleIngestEndpoint = {
  protocol: "http",
  host: "localhost:3000",
  key: KEY,
};

const PLACEHOLDER: CompatibleIngestEndpoint = {
  protocol: "https",
  host: "<YOUR_ONEUPTIME_HOST>",
  key: "<YOUR_ONEUPTIME_TOKEN>",
};

const codeOf: (
  method: CompatibleIngestMethod,
  endpoint: CompatibleIngestEndpoint,
  runtime?: SentryRuntime,
) => string = (
  method: CompatibleIngestMethod,
  endpoint: CompatibleIngestEndpoint,
  runtime?: SentryRuntime,
): string => {
  return getCompatibleIngestSnippets(method, endpoint, {
    sentryRuntime: runtime,
  })
    .map((snippet: CompatibleIngestSnippet): string => {
      return snippet.code;
    })
    .join("\n---\n");
};

/*
 * Sentry's JavaScript SDK's DSN parser (@sentry/core dsn.ts): a DSN it
 * refuses disables the SDK, so the guide's DSN must pass it - a public key
 * of word characters only, and a numeric project ID.
 */
const SENTRY_DSN_REGEX: RegExp =
  /^(?:(\w+):)\/\/(?:(\w+)(?::(\w+)?)?@)((?:\[[:.%\w]+\]|[\w.-]+))(?::(\d+))?\/(.+)/;

describe("which product's Setup Guide lists which way", () => {
  test.each<[string, Array<CompatibleIngestMethod>]>([
    [
      "logs",
      [
        CompatibleIngestMethod.Loki,
        CompatibleIngestMethod.SplunkHec,
        CompatibleIngestMethod.Datadog,
      ],
    ],
    [
      "metrics",
      [
        CompatibleIngestMethod.Prometheus,
        CompatibleIngestMethod.SplunkHec,
        CompatibleIngestMethod.Datadog,
      ],
    ],
    ["traces", [CompatibleIngestMethod.Sentry]],
    ["exceptions", [CompatibleIngestMethod.Sentry]],
    ["profiles", []],
  ])("%s", (signal: string, expected: Array<CompatibleIngestMethod>) => {
    expect(
      getCompatibleIngestGuides(signal).map(
        (guide: CompatibleIngestGuideCopy): CompatibleIngestMethod => {
          return guide.method;
        },
      ),
    ).toEqual(expected);
  });

  test("every way has the words its card and steps draw", () => {
    for (const guide of COMPATIBLE_INGEST_GUIDES) {
      expect(guide.label).not.toBe("");
      expect(guide.description).not.toBe("");
      expect(guide.endpointLabel).not.toBe("");
      expect(guide.configureDescription).not.toBe("");
      expect(guide.notes.length).toBeGreaterThanOrEqual(2);
      expect(guide.dataTestId).toMatch(/^compatible-ingest-/);
      expect(getCompatibleIngestGuide(guide.method)).toBe(guide);
      expect(isCompatibleIngestMethod(guide.method)).toBe(true);
    }

    expect(isCompatibleIngestMethod("opentelemetry")).toBe(false);
    expect(isCompatibleIngestMethod("fluentbit")).toBe(false);
  });
});

describe("the URL each tool is pointed at", () => {
  test.each<[CompatibleIngestMethod, string]>([
    [
      CompatibleIngestMethod.Prometheus,
      "https://oneuptime.com/telemetry/prometheus/api/v1/write",
    ],
    [
      CompatibleIngestMethod.Loki,
      "https://oneuptime.com/telemetry/loki/api/v1/push",
    ],
    [
      CompatibleIngestMethod.SplunkHec,
      "https://oneuptime.com/telemetry/services/collector",
    ],
    [CompatibleIngestMethod.Datadog, "https://oneuptime.com/telemetry/datadog"],
    [
      CompatibleIngestMethod.Sentry,
      `https://${UNDASHED}@oneuptime.com/telemetry/sentry/1`,
    ],
  ])("%s: %s", (method: CompatibleIngestMethod, expected: string) => {
    expect(getCompatibleIngestEndpointValue(method, CLOUD)).toBe(expected);
  });

  test("every URL a tool posts to is one the App's body parsers leave to its endpoint", () => {
    expect(isCompatibleIngestPath("/telemetry/prometheus/api/v1/write")).toBe(
      true,
    );
    expect(isCompatibleIngestPath("/telemetry/loki/api/v1/push")).toBe(true);
    // A HEC client adds /event (or the Docker driver /event/1.0) to the URL.
    expect(isCompatibleIngestPath("/telemetry/services/collector/event")).toBe(
      true,
    );
    expect(isCompatibleIngestPath("/services/collector/event/1.0")).toBe(true);
    // The Agent adds its routes to dd_url; logs go to /api/v2/logs on the host.
    expect(isCompatibleIngestPath("/telemetry/datadog/api/v2/series")).toBe(
      true,
    );
    expect(isCompatibleIngestPath("/api/v2/logs")).toBe(true);
  });

  test("the App's routers serve those paths", () => {
    const read: (file: string) => string = (file: string): string => {
      return fs.readFileSync(
        path.resolve(__dirname, "../../FeatureSet/Telemetry/API", file),
        "utf8",
      );
    };

    expect(read("PrometheusRemoteWrite.ts")).toContain(
      '"/prometheus/api/v1/write"',
    );
    expect(read("Loki.ts")).toContain('"/loki/api/v1/push"');
    expect(read("SplunkHec.ts")).toContain('"/services/collector/event/1.0"');
    expect(read("Datadog.ts")).toContain('"/datadog/api/v2/series"');
    expect(read("Datadog.ts")).toContain('"/api/v2/logs"');
    expect(read("Sentry.ts")).toContain(
      '"/sentry/api/:sentryProjectId/envelope"',
    );
  });
});

describe("Sentry's DSN", () => {
  test("is one Sentry's JavaScript SDK accepts, and its SDKs post where OneUptime listens", () => {
    const dsn: string = getSentryDsn(CLOUD);
    const match: RegExpMatchArray | null = dsn.match(SENTRY_DSN_REGEX);

    expect(match).not.toBeNull();
    expect(match![2]).toBe(UNDASHED);
    expect(match![4]).toBe("oneuptime.com");

    // The SDK splits the path into its prefix and a numeric project ID ...
    const dsnPath: string = match![6]!;
    const projectId: string = dsnPath.split("/").pop()!;
    const prefix: string = dsnPath.split("/").slice(0, -1).join("/");

    expect(projectId).toMatch(/^\d+$/);

    // ... and posts to <prefix>/api/<project>/envelope/.
    expect(
      isCompatibleIngestPath(`/${prefix}/api/${projectId}/envelope/`),
    ).toBe(true);
  });

  test("keeps a host's port", () => {
    expect(getSentryDsn(LOCAL)).toBe(
      `http://${UNDASHED}@localhost:3000/telemetry/sentry/1`,
    );
    expect(getSentryDsn(LOCAL).match(SENTRY_DSN_REGEX)![5]).toBe("3000");
  });

  test("a browser app gets the browser SDK; a server one Node, Python and the environment", () => {
    const browser: Array<CompatibleIngestSnippet> = getCompatibleIngestSnippets(
      CompatibleIngestMethod.Sentry,
      CLOUD,
      { sentryRuntime: SentryRuntime.Browser },
    );

    expect(browser).toHaveLength(1);
    expect(browser[0]!.code).toContain("@sentry/browser");

    const server: Array<CompatibleIngestSnippet> = getCompatibleIngestSnippets(
      CompatibleIngestMethod.Sentry,
      CLOUD,
      { sentryRuntime: SentryRuntime.Server },
    );

    expect(
      server.map((snippet: CompatibleIngestSnippet): string => {
        return snippet.label;
      }),
    ).toEqual(["Node.js", "Python", "Environment variables"]);

    for (const snippet of [...browser, ...server]) {
      expect(snippet.code).toContain(getSentryDsn(CLOUD));
      // The release's name is the service, and the guide names it my-service.
      expect(snippet.code).toContain("my-service@1.0.0");
    }
  });
});

describe("each tool's own configuration", () => {
  test("Prometheus and Grafana Alloy send the key as a bearer token", () => {
    const code: string = codeOf(CompatibleIngestMethod.Prometheus, CLOUD);

    expect(code).toContain("remote_write:");
    expect(code).toContain(
      "url: https://oneuptime.com/telemetry/prometheus/api/v1/write",
    );
    expect(code).toContain(`credentials: ${KEY}`);
    expect(code).toContain('prometheus.remote_write "oneuptime"');
    expect(code).toContain(`bearer_token = "${KEY}"`);
  });

  test("Loki's clients: Promtail, Alloy, and Fluent Bit with the host and port apart", () => {
    const cloud: string = codeOf(CompatibleIngestMethod.Loki, CLOUD);

    expect(cloud).toContain(
      "url: https://oneuptime.com/telemetry/loki/api/v1/push",
    );
    expect(cloud).toContain('loki.write "oneuptime"');
    expect(cloud).toMatch(/Host\s+oneuptime\.com/);
    expect(cloud).toMatch(/Port\s+443/);
    expect(cloud).toMatch(/Tls\s+On/);
    expect(cloud).toMatch(/Uri\s+\/telemetry\/loki\/api\/v1\/push/);
    expect(cloud).toMatch(new RegExp(`Http_Passwd\\s+${KEY}`));

    const local: string = codeOf(CompatibleIngestMethod.Loki, LOCAL);

    expect(local).toMatch(/Host\s+localhost\n/);
    expect(local).toMatch(/Port\s+3000/);
    expect(local).toMatch(/Tls\s+Off/);
  });

  test("an IPv6 host: Fluent Bit gets the bare address, which it can resolve, and Datadog keeps the brackets host:port needs", () => {
    const ipv6: CompatibleIngestEndpoint = {
      protocol: "https",
      host: "[::1]:8443",
      key: KEY,
    };

    // Fluent Bit 3.2.10 on "[::1]": "Misformatted domain name", nothing sent.
    expect(codeOf(CompatibleIngestMethod.Loki, ipv6)).toMatch(
      /Host\s+::1\n\s+Port\s+8443\n/,
    );
    expect(getFluentBitHost(ipv6)).toBe("::1");
    expect(getFluentBitHost(CLOUD)).toBe("oneuptime.com");
    expect(getFluentBitHost(LOCAL)).toBe("localhost");
    expect(codeOf(CompatibleIngestMethod.Datadog, ipv6)).toContain(
      "logs_dd_url: [::1]:8443",
    );
  });

  test("Splunk HEC: the Docker driver gets the bare origin, as it adds the path itself", () => {
    const code: string = codeOf(CompatibleIngestMethod.SplunkHec, CLOUD);

    expect(code).toContain("--log-opt splunk-url=https://oneuptime.com \\");
    expect(code).toContain(`--log-opt splunk-token=${KEY}`);
    expect(code).toContain(
      "endpoint: https://oneuptime.com/telemetry/services/collector",
    );
    expect(code).toContain(
      "curl https://oneuptime.com/telemetry/services/collector/event",
    );
    expect(code).toContain(`Authorization: Splunk ${KEY}`);
  });

  test("Datadog: a 32-hex API key, dd_url with its path, and logs_dd_url as host:port", () => {
    const cloud: string = codeOf(CompatibleIngestMethod.Datadog, CLOUD);

    expect(cloud).toContain(`api_key: ${UNDASHED}`);
    expect(cloud).toContain(`DD_API_KEY=${UNDASHED}`);
    // Datadog API keys are 32 hex digits; the Agent is given one.
    expect(UNDASHED).toMatch(/^[0-9a-f]{32}$/);
    expect(cloud).toContain("dd_url: https://oneuptime.com/telemetry/datadog");
    expect(cloud).toContain("logs_dd_url: oneuptime.com:443");
    expect(cloud).toContain("DD_LOGS_CONFIG_LOGS_DD_URL=oneuptime.com:443");
    expect(cloud).not.toContain("logs_no_ssl");
    // What OneUptime does not read from the Agent yet is turned off.
    expect(cloud).toContain("DD_APM_ENABLED=false");

    const local: string = codeOf(CompatibleIngestMethod.Datadog, LOCAL);

    expect(local).toContain("logs_dd_url: localhost:3000");
    expect(local).toContain("logs_no_ssl: true");
    expect(local).toContain("DD_LOGS_CONFIG_LOGS_NO_SSL=true");
  });

  test("before a key is picked, every snippet keeps the placeholder", () => {
    for (const guide of COMPATIBLE_INGEST_GUIDES) {
      expect(codeOf(guide.method, PLACEHOLDER)).toContain(
        "<YOUR_ONEUPTIME_TOKEN>",
      );
      expect(codeOf(guide.method, PLACEHOLDER)).toContain(
        "<YOUR_ONEUPTIME_HOST>",
      );
    }
  });

  test("every snippet names the service my-service, which the guide swaps for the service's own name", () => {
    for (const method of [
      CompatibleIngestMethod.Loki,
      CompatibleIngestMethod.SplunkHec,
      CompatibleIngestMethod.Sentry,
    ]) {
      expect(codeOf(method, CLOUD)).toContain("my-service");
    }
  });
});

describe("helpers", () => {
  test("getUndashedKey writes a UUID as 32 hex digits and leaves anything else", () => {
    expect(getUndashedKey(KEY)).toBe(UNDASHED);
    expect(getUndashedKey(KEY.toUpperCase())).toBe(UNDASHED);
    expect(getUndashedKey("<YOUR_ONEUPTIME_TOKEN>")).toBe(
      "<YOUR_ONEUPTIME_TOKEN>",
    );
  });

  test.each<[CompatibleIngestEndpoint, { hostname: string; port: string }]>([
    [CLOUD, { hostname: "oneuptime.com", port: "443" }],
    [LOCAL, { hostname: "localhost", port: "3000" }],
    [
      { protocol: "http", host: "oneuptime.internal", key: KEY },
      { hostname: "oneuptime.internal", port: "80" },
    ],
    [
      { protocol: "https", host: "[::1]:8443", key: KEY },
      { hostname: "[::1]", port: "8443" },
    ],
  ])(
    "getHostAndPort(%o)",
    (
      endpoint: CompatibleIngestEndpoint,
      expected: { hostname: string; port: string },
    ) => {
      expect(getHostAndPort(endpoint)).toEqual(expected);
    },
  );
});
