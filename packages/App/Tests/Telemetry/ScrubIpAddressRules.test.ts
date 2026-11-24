import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import SessionReplayScrubService, {
  CompiledScrubRule,
} from "../../FeatureSet/Telemetry/Services/SessionReplayScrubService";
import TraceScrubRuleService, {
  ExceptionContent,
} from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import {
  CoveringScrubRule,
  findCoveringScrubRule,
  isFindingScrubbed,
} from "Common/Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import { toTraceScanSpan } from "Common/Server/Utils/SecurityEvent/TelemetryScan/TraceSecurityScan";
import ScrubHashToken from "Common/Server/Utils/Telemetry/ScrubHashToken";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubField from "Common/Types/Log/LogScrubField";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import ObjectID from "Common/Types/ObjectID";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import {
  ScrubRegExp,
  scrubRegExpFromBuiltIn,
} from "Common/Types/Telemetry/ScrubRule";
import TraceScrubAction from "Common/Types/Trace/TraceScrubAction";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import TraceScrubPatternType from "Common/Types/Trace/TraceScrubPatternType";
import {
  findSensitiveValues,
  TextMatch,
} from "Common/Utils/DataSecurity/TextScanner";
import {
  buildTraceSecurityEvents,
  readMetadataCallOf,
  SSRF_TARGET_ATTRIBUTE,
} from "Common/Utils/SecurityEvent/TelemetryScan/TraceSignals";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * IP ADDRESS RULES HIDE PUBLIC IPV4 AND IPV6 ADDRESSES, AND KEEP PRIVATE
 * ONES (#10393); A HASH RULE LEAVES ITS PROJECT'S KEYED TOKEN (#10394).
 *
 * Through the log and trace scrub engines as ingest runs them - each field
 * a rule scope reaches, plain text and JSON text - and then through what
 * reads the stored record: Security Events' trace scan, which finds
 * server-side request forgery by 169.254.169.254 in a request's URL, and
 * Data Security, whose IP address finding a rule must in fact hide when it
 * says the finding is scrubbed.
 * ---------------------------------------------------------------------------
 */

type GetRegexForPattern = (
  patternType: string,
  customRegex?: string,
) => ScrubRegExp | null;

// What a test reads of a spy: its calls, and clearing them.
type SpyLike = {
  mock: { calls: Array<Array<unknown>> };
  mockClear: () => void;
};

const PROJECT_ID: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000d10393",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000d20393",
);

// What Data Security calls an IP address, and an IPv4 one written as IPv6.
const PUBLIC_ADDRESSES: Array<string> = [
  "8.8.8.8",
  "2001:4860:4860::8888",
  "::ffff:8.8.8.8",
];

// What is no one's: private, loopback, the cloud metadata address, link-local.
const KEPT_ADDRESSES: Array<string> = [
  "10.0.0.12",
  "127.0.0.1",
  "169.254.169.254",
  "fe80::1",
];

const IPV4_MASK: string = "***.***.***.***";
const IPV6_MASK: string = "****:****:****:****:****:****:****:****";

function regexOf(service: unknown, patternType: string): ScrubRegExp {
  const regex: ScrubRegExp | null = (
    service as { getRegexForPattern: GetRegexForPattern }
  ).getRegexForPattern(patternType);

  expect(regex).not.toBeNull();

  return regex as ScrubRegExp;
}

function logRules(
  action: string,
  fields: string = LogScrubField.Both,
  patternType: string = LogScrubPatternType.IPAddress,
  projectId: ObjectID = PROJECT_ID,
): never {
  const rule: LogScrubRule = new LogScrubRule();
  rule.name = "Scrub IP addresses";
  rule.projectId = projectId;
  rule.patternType = patternType;
  rule.scrubAction = action;
  rule.fieldsToScrub = fields;

  return [
    { rule: rule, regex: regexOf(LogScrubRuleService, patternType) },
  ] as never;
}

function traceRules(
  action: string,
  fields: string = TraceScrubField.All,
  patternType: string = TraceScrubPatternType.IPAddress,
): never {
  const rule: TraceScrubRule = new TraceScrubRule();
  rule.name = "Scrub IP addresses";
  rule.projectId = PROJECT_ID;
  rule.patternType = patternType;
  rule.scrubAction = action;
  rule.fieldsToScrub = fields;

  return [
    { rule: rule, regex: regexOf(TraceScrubRuleService, patternType) },
  ] as never;
}

// What a rule of PROJECT_ID leaves of an address, under each action.
function expectedOf(address: string, action: string): string {
  if (action === LogScrubAction.Redact) {
    return "[REDACTED]";
  }

  if (action === LogScrubAction.Mask) {
    return address.includes(".") ? IPV4_MASK : IPV6_MASK;
  }

  return ScrubHashToken.ofIpAddress({ projectId: PROJECT_ID, address });
}

const ACTIONS: Array<string> = [
  LogScrubAction.Redact,
  LogScrubAction.Mask,
  LogScrubAction.Hash,
];

const CASES: Array<[string, string]> = ACTIONS.flatMap(
  (action: string): Array<[string, string]> => {
    return PUBLIC_ADDRESSES.map((address: string): [string, string] => {
      return [address, action];
    });
  },
);

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the log engine", () => {
  test.each(CASES)(
    "hides %s under %s in the body and the attributes",
    (address: string, action: string) => {
      const row: JSONObject = LogScrubRuleService.scrubLog(
        {
          body: `request from ${address} done`,
          attributes: {
            "client.address": address,
            "http.request.header.x-forwarded-for": [address, "10.0.0.1"],
          },
        },
        logRules(action),
      );
      const hidden: string = expectedOf(address, action);

      expect(row["body"]).toBe(`request from ${hidden} done`);
      expect(row["attributes"]).toEqual({
        "client.address": hidden,
        "http.request.header.x-forwarded-for": [hidden, "10.0.0.1"],
      });
    },
  );

  test.each(KEPT_ADDRESSES)(
    "keeps %s in the body and the attributes, under every action",
    (address: string) => {
      for (const action of ACTIONS) {
        const row: JSONObject = LogScrubRuleService.scrubLog(
          {
            body: `request from ${address} done`,
            attributes: { "client.address": address },
          },
          logRules(action),
        );

        expect(row).toEqual({
          body: `request from ${address} done`,
          attributes: { "client.address": address },
        });
      }
    },
  );

  test("keeps a structured body JSON: a public address hidden in it, a private one kept", () => {
    const body: string = JSON.stringify({
      client: "2001:4860:4860::8888",
      peer: "10.0.0.12",
      url: "http://169.254.169.254/latest/meta-data/",
      n: 1,
    });
    const row: JSONObject = LogScrubRuleService.scrubLog(
      { body: body, attributes: {} },
      logRules(LogScrubAction.Redact),
    );

    expect(JSON.parse(row["body"] as string)).toEqual({
      client: "[REDACTED]",
      peer: "10.0.0.12",
      url: "http://169.254.169.254/latest/meta-data/",
      n: 1,
    });
  });

  test("keeps an attribute's JSON text JSON, its public address hidden", () => {
    const row: JSONObject = LogScrubRuleService.scrubLog(
      {
        body: "",
        attributes: {
          "http.request.body": JSON.stringify({ ip: "203.0.113.7", n: 2 }),
        },
      },
      logRules(LogScrubAction.Redact),
    );

    expect(
      JSON.parse(
        (row["attributes"] as JSONObject)["http.request.body"] as string,
      ),
    ).toEqual({ ip: "[REDACTED]", n: 2 });
  });

  test("an address with a port in brackets keeps its brackets and port; one with a zone its zone", () => {
    const row: JSONObject = LogScrubRuleService.scrubLog(
      {
        body: "dial [2001:db8::1]:443 via 2001:db8::2%eth0 and fe80::1%eth0",
        attributes: {},
      },
      logRules(LogScrubAction.Redact),
    );

    expect(row["body"]).toBe(
      "dial [[REDACTED]]:443 via [REDACTED]%eth0 and fe80::1%eth0",
    );
  });

  test("a Body Only rule leaves the attributes, an Attributes Only rule the body", () => {
    const record: () => JSONObject = (): JSONObject => {
      return {
        body: "from 203.0.113.7",
        attributes: { "client.address": "203.0.113.7" },
      };
    };

    expect(
      LogScrubRuleService.scrubLog(
        record(),
        logRules(LogScrubAction.Redact, LogScrubField.Body),
      ),
    ).toEqual({
      body: "from [REDACTED]",
      attributes: { "client.address": "203.0.113.7" },
    });
    expect(
      LogScrubRuleService.scrubLog(
        record(),
        logRules(LogScrubAction.Redact, LogScrubField.Attributes),
      ),
    ).toEqual({
      body: "from 203.0.113.7",
      attributes: { "client.address": "[REDACTED]" },
    });
  });
});

describe("the trace engine", () => {
  function spanRow(address: string): JSONObject {
    return {
      name: `GET from ${address}`,
      statusMessage: `refused by ${address}`,
      attributes: { "client.address": address, "net.peer.ip": address },
      events: [
        {
          name: `retrying after ${address} refused`,
          attributes: { "exception.message": `connect ${address} refused` },
        },
      ],
      links: [{ attributes: { "peer.address": address } }],
    };
  }

  test.each(CASES)(
    "hides %s under %s in the name, status message, attributes, events and links",
    (address: string, action: string) => {
      const hidden: string = expectedOf(address, action);

      expect(
        TraceScrubRuleService.scrubSpan(spanRow(address), traceRules(action)),
      ).toEqual({
        name: `GET from ${hidden}`,
        statusMessage: `refused by ${hidden}`,
        attributes: { "client.address": hidden, "net.peer.ip": hidden },
        events: [
          {
            name: `retrying after ${hidden} refused`,
            attributes: { "exception.message": `connect ${hidden} refused` },
          },
        ],
        links: [{ attributes: { "peer.address": hidden } }],
      });
    },
  );

  test.each(KEPT_ADDRESSES)(
    "keeps %s everywhere in a span, under every action",
    (address: string) => {
      for (const action of ACTIONS) {
        expect(
          TraceScrubRuleService.scrubSpan(spanRow(address), traceRules(action)),
        ).toEqual(spanRow(address));
      }
    },
  );

  test("hides a public address in an exception's message, stack trace and type, and keeps a private one", () => {
    const content: ExceptionContent =
      TraceScrubRuleService.scrubExceptionContent(
        {
          message: "connect 2001:4860:4860::8888 refused from 10.0.0.12",
          stackTrace: "at dial (net.js:1) peer=8.8.8.8",
          exceptionType: "ECONNREFUSED ::ffff:8.8.8.8",
          attributes: { "server.address": "8.8.8.8" },
        },
        traceRules(TraceScrubAction.Redact, TraceScrubField.Events),
      );

    expect(content).toEqual({
      message: "connect [REDACTED] refused from 10.0.0.12",
      stackTrace: "at dial (net.js:1) peer=[REDACTED]",
      exceptionType: "ECONNREFUSED [REDACTED]",
      attributes: { "server.address": "[REDACTED]" },
    });
  });

  test("an AI call's messages stay JSON, a public address hidden in them", () => {
    const messages: string = JSON.stringify([
      { role: "user", content: "my server is 2001:db8::7 behind 10.0.0.1" },
    ]);
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      {
        name: "chat",
        attributes: { "gen_ai.input.messages": messages },
        events: [],
        links: [],
      },
      traceRules(TraceScrubAction.Redact),
    );

    expect(
      JSON.parse(
        (row["attributes"] as JSONObject)["gen_ai.input.messages"] as string,
      ),
    ).toEqual([
      { role: "user", content: "my server is [REDACTED] behind 10.0.0.1" },
    ]);
  });
});

describe("Security Events' trace scan sees the cloud metadata address again (#10393)", () => {
  const SERVICE_ID: string = "0193b0a1-0000-7000-8000-000000d30393";

  // A server span that answered a request naming cloud metadata, as stored.
  function ssrfRequestRow(): JSONObject {
    return {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      parentSpanId: "",
      sessionId: "",
      name: "GET /fetch",
      kind: "SPAN_KIND_SERVER",
      durationUnixNano: "1000000",
      startTime: new Date("2026-11-20T10:15:02.000Z"),
      primaryEntityId: SERVICE_ID,
      primaryEntityType: "OpenTelemetry",
      attributes: {
        "http.request.method": "GET",
        "url.path": "/fetch",
        "url.query": "target=http://169.254.169.254/latest/meta-data/",
        "client.address": "2001:4860:4860::8888",
        "http.response.status_code": "200",
      },
      events: [],
      links: [],
    };
  }

  function ssrfEventsOf(row: JSONObject): Array<NormalizedSecurityEvent> {
    return buildTraceSecurityEvents(toTraceScanSpan(row)).filter(
      (event: NormalizedSecurityEvent): boolean => {
        return event.attributes[SSRF_TARGET_ATTRIBUTE] !== undefined;
      },
    );
  }

  test.each(ACTIONS)(
    "a span whose url.query names 169.254.169.254 is still found as SSRF, in a project with an IP Address rule that %ss",
    (action: string) => {
      const scrubbed: JSONObject = TraceScrubRuleService.scrubSpan(
        ssrfRequestRow(),
        traceRules(action),
      );
      const attributes: JSONObject = scrubbed["attributes"] as JSONObject;

      // The public client address is hidden; the metadata address is kept.
      expect(attributes["client.address"]).toBe(
        expectedOf("2001:4860:4860::8888", action),
      );
      expect(attributes["url.query"]).toBe(
        "target=http://169.254.169.254/latest/meta-data/",
      );

      const events: Array<NormalizedSecurityEvent> = ssrfEventsOf(scrubbed);

      expect(events).toHaveLength(1);
      expect(events[0]!.attributes[SSRF_TARGET_ATTRIBUTE]).toBe(
        "169.254.169.254",
      );
      expect(events[0]!.targetHost).toBe("169.254.169.254");
    },
  );

  test("regression: the old pattern, every dotted quad, hid it and the trace scan went blind", () => {
    const rule: TraceScrubRule = new TraceScrubRule();
    rule.projectId = PROJECT_ID;
    rule.patternType = TraceScrubPatternType.IPAddress;
    rule.scrubAction = TraceScrubAction.Redact;
    rule.fieldsToScrub = TraceScrubField.All;

    const scrubbed: JSONObject = TraceScrubRuleService.scrubSpan(
      ssrfRequestRow(),
      [
        {
          rule: rule,
          regex: scrubRegExpFromBuiltIn(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g),
        },
      ] as never,
    );

    expect((scrubbed["attributes"] as JSONObject)["url.query"]).toBe(
      "target=http://[REDACTED]/latest/meta-data/",
    );
    expect(ssrfEventsOf(scrubbed)).toEqual([]);
  });

  test("the trace's client span that fetched the metadata address keeps it, so the forgery is known to have worked", () => {
    const scrubbed: JSONObject = TraceScrubRuleService.scrubSpan(
      {
        ...ssrfRequestRow(),
        spanId: "00f067aa0ba902b8",
        name: "GET",
        kind: "SPAN_KIND_CLIENT",
        attributes: {
          "url.full":
            "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
          "server.address": "169.254.169.254",
        },
      },
      traceRules(TraceScrubAction.Redact),
    );

    expect(readMetadataCallOf(toTraceScanSpan(scrubbed))).toBe(
      "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    );
  });
});

describe("Data Security's coverage of an IPv6 finding is true (#10393)", () => {
  /*
   * Coverage counts an IP Address rule as covering any IP address finding.
   * That was so for IPv4 only: an IPv6 finding showed as scrubbed, old data
   * waiting for its retention, while new IPv6 addresses arrived in the
   * clear. A record holding the address is now scrubbed by that very rule.
   */
  const LOG_RULE: CoveringScrubRule = {
    id: "rule-log-ip",
    name: "Scrub IP addresses",
    signal: "log",
    patternType: LogScrubPatternType.IPAddress,
    fieldsToScrub: LogScrubField.Both,
  };
  const TRACE_RULE: CoveringScrubRule = {
    id: "rule-trace-ip",
    name: "Scrub IP addresses",
    signal: "trace",
    patternType: TraceScrubPatternType.IPAddress,
    fieldsToScrub: TraceScrubField.All,
  };

  function ipFindings(text: string): Array<TextMatch> {
    return findSensitiveValues(text).filter((match: TextMatch): boolean => {
      return match.dataTypeId === "ip-address";
    });
  }

  test.each([
    ["client 2001:4860:4860::8888 connected"],
    ["client 2a00:1450:4001:81b::200e connected"],
    ["client ::ffff:81.2.69.142 connected"],
  ])(
    "a log body's IPv6 finding in %s is covered, and the rule hides it",
    (body: string) => {
      expect(ipFindings(body)).toHaveLength(1);
      expect(
        isFindingScrubbed(
          { rules: [LOG_RULE] },
          {
            kind: DataStoreKind.TelemetryLogs,
            dataTypeId: "ip-address",
            location: "body",
          },
        ),
      ).toBe(true);

      const row: JSONObject = LogScrubRuleService.scrubLog(
        { body: body, attributes: {} },
        logRules(LogScrubAction.Redact),
      );

      expect(ipFindings(row["body"] as string)).toEqual([]);
    },
  );

  test("a span attribute's IPv6 finding is covered, and the rule hides it", () => {
    const finding: {
      kind: DataStoreKind;
      dataTypeId: string;
      location: string;
    } = {
      kind: DataStoreKind.TelemetryTraces,
      dataTypeId: "ip-address",
      location: "attributes.client.address",
    };

    expect(findCoveringScrubRule({ rules: [TRACE_RULE] }, finding)).toEqual(
      TRACE_RULE,
    );

    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      {
        name: "GET /",
        attributes: { "client.address": "2001:4860:4860::8888" },
        events: [],
        links: [],
      },
      traceRules(TraceScrubAction.Hash),
    );

    expect(
      ipFindings((row["attributes"] as JSONObject)["client.address"] as string),
    ).toEqual([]);
  });

  test("a private address is no finding, so no rule is asked to hide it", () => {
    expect(
      ipFindings("client 10.0.0.12 and fe80::1 and 169.254.169.254"),
    ).toEqual([]);
  });
});

describe("one function makes every engine's Hash token (#10394)", () => {
  test("the log, trace and session replay engines hash through ScrubHashToken, with their rule's project", async () => {
    /*
     * Spies that call through, seen by the surface used here: the
     * @jest/globals and @types/jest typings of a spy disagree in this repo.
     */
    const ofValue: SpyLike = jest.spyOn(
      ScrubHashToken,
      "ofValue",
    ) as unknown as SpyLike;
    const ofIpAddress: SpyLike = jest.spyOn(
      ScrubHashToken,
      "ofIpAddress",
    ) as unknown as SpyLike;

    const log: JSONObject = LogScrubRuleService.scrubLog(
      { body: "from 2001:db8::1 as ada@example.com", attributes: {} },
      [
        ...(logRules(LogScrubAction.Hash) as Array<unknown>),
        ...(logRules(
          LogScrubAction.Hash,
          LogScrubField.Both,
          LogScrubPatternType.Email,
        ) as Array<unknown>),
      ] as never,
    );

    expect(log["body"]).toBe(
      `from ${ScrubHashToken.ofIpAddress({ projectId: PROJECT_ID, address: "2001:db8::1" })} as ${ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: "ada@example.com" })}`,
    );
    expect(ofIpAddress).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      address: "2001:db8::1",
    });
    expect(ofValue).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      value: "ada@example.com",
    });

    ofIpAddress.mockClear();

    TraceScrubRuleService.scrubSpan(
      {
        name: "GET",
        attributes: { "client.address": "8.8.8.8" },
        events: [],
        links: [],
      },
      traceRules(TraceScrubAction.Hash),
    );
    TraceScrubRuleService.scrubExceptionContent(
      {
        message: "refused by 8.8.4.4",
        stackTrace: "",
        attributes: {},
      },
      traceRules(TraceScrubAction.Hash, TraceScrubField.Events),
    );

    expect(ofIpAddress).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      address: "8.8.8.8",
    });
    expect(ofIpAddress).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      address: "8.8.4.4",
    });

    ofIpAddress.mockClear();

    const events: Array<JSONValue> = [{ text: "from 9.9.9.9" }];
    const replayRules: Array<CompiledScrubRule> = logRules(
      LogScrubAction.Hash,
    ) as unknown as Array<CompiledScrubRule>;

    await SessionReplayScrubService.scrubEvents(events, replayRules);

    expect(ofIpAddress).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      address: "9.9.9.9",
    });
    expect((events[0] as JSONObject)["text"]).toBe(
      `from ${ScrubHashToken.ofIpAddress({ projectId: PROJECT_ID, address: "9.9.9.9" })}`,
    );
  });

  test("a value hashes alike in a project's logs, spans and recordings, and differently in another project's", async () => {
    const address: string = "2001:4860:4860::8888";
    const log: JSONObject = LogScrubRuleService.scrubLog(
      { body: address, attributes: {} },
      logRules(LogScrubAction.Hash),
    );
    const span: JSONObject = TraceScrubRuleService.scrubSpan(
      { name: address, attributes: {}, events: [], links: [] },
      traceRules(TraceScrubAction.Hash),
    );
    const events: Array<JSONValue> = [{ text: address }];

    await SessionReplayScrubService.scrubEvents(
      events,
      logRules(LogScrubAction.Hash) as unknown as Array<CompiledScrubRule>,
    );

    const otherProject: JSONObject = LogScrubRuleService.scrubLog(
      { body: address, attributes: {} },
      logRules(
        LogScrubAction.Hash,
        LogScrubField.Both,
        LogScrubPatternType.IPAddress,
        OTHER_PROJECT_ID,
      ),
    );

    expect(log["body"]).toMatch(/^\[HASHED:[0-9a-f]{16}\]$/);
    expect(span["name"]).toBe(log["body"]);
    expect((events[0] as JSONObject)["text"]).toBe(log["body"]);
    expect(otherProject["body"]).toMatch(/^\[HASHED:[0-9a-f]{16}\]$/);
    expect(otherProject["body"]).not.toBe(log["body"]);
  });

  test("an IPv4 client is one token however a dual-stack server wrote it", () => {
    const row: JSONObject = LogScrubRuleService.scrubLog(
      {
        body: "",
        attributes: {
          "client.address": "::ffff:203.0.113.7",
          "http.client_ip": "203.0.113.7",
        },
      },
      logRules(LogScrubAction.Hash),
    );
    const attributes: JSONObject = row["attributes"] as JSONObject;

    expect(attributes["client.address"]).toBe(attributes["http.client_ip"]);
  });

  test("a Hash rule whose project is not known redacts: telemetry never stores what a rule was set to hide", () => {
    const rule: LogScrubRule = new LogScrubRule();
    rule.patternType = LogScrubPatternType.IPAddress;
    rule.scrubAction = LogScrubAction.Hash;

    const row: JSONObject = LogScrubRuleService.scrubLog(
      { body: "from 8.8.8.8", attributes: {} },
      [
        { rule: rule, regex: regexOf(LogScrubRuleService, rule.patternType) },
      ] as never,
    );

    expect(row["body"]).toBe("from [REDACTED]");
  });
});
