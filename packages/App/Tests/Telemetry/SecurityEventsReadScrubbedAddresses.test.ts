import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import ScrubHashToken from "Common/Server/Utils/Telemetry/ScrubHashToken";
import { JSONObject } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubField from "Common/Types/Log/LogScrubField";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import ObjectID from "Common/Types/ObjectID";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import { clearLinearRegExpCache } from "Common/Utils/LinearRegExp/PatternCache";
import WebAttackLogParser from "Common/Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import {
  AddressScrubRule,
  HiddenClientAddress,
  ScrubbedAddressKind,
  ScrubbedAddressPlace,
  findScrubRuleThatHid,
  readHiddenClientAddress,
} from "Common/Utils/SecurityEvent/ScrubbedAddress";
import {
  TraceScanSpan,
  buildTraceSecurityEvents,
} from "Common/Utils/SecurityEvent/TelemetryScan/TraceSignals";
import {
  IPV4_ADDRESS_MASK,
  IPV6_ADDRESS_MASK,
} from "Common/Utils/Telemetry/ScrubIpAddress";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * SECURITY EVENTS READS WHAT THE SCRUB ENGINES LEAVE OF AN ADDRESS (#10397).
 *
 * A web attack's log line and the server span of its request, scrubbed by
 * the engines ingest runs - LogScrubRuleService and TraceScrubRuleService,
 * with an IP Address rule compiled through each one's real
 * getRegexForPattern, as #10393 and #10394 left them - and then read by
 * Security Events as "Your logs" and the trace scan read the stored record.
 * For each action the rule takes, the event names no address, says a scrub
 * rule hid it, and keeps what the engine left: "[REDACTED]", the IPv4 or
 * IPv6 mask, or the project's keyed token - the token the address vault
 * will look up (#10395), which is ScrubHashToken.ofIpAddress's however the
 * address was written. An address the rule keeps - a private one, since
 * #10393 - is the event's address, as it always was.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000a10397",
);
const RULE_ID: string = "0193b0a1-0000-7000-8000-0000000a1397";

type GetRegexForPattern = (
  patternType: string,
  customRegex?: string,
) => ScrubRegExp | null;

interface CompiledRule {
  rule: LogScrubRule | TraceScrubRule;
  regex: ScrubRegExp;
}

function compile(
  service: unknown,
  rule: LogScrubRule | TraceScrubRule,
  data: { action: string; fields: string },
): CompiledRule {
  rule.id = new ObjectID(RULE_ID);
  rule.name = "Scrub IP addresses";
  // A Hash rule hashes with its project's key, as the rules ingest loads do.
  rule.projectId = PROJECT_ID;
  rule.patternType = LogScrubPatternType.IPAddress;
  rule.scrubAction = data.action;
  rule.fieldsToScrub = data.fields;

  const regex: ScrubRegExp | null = (
    service as { getRegexForPattern: GetRegexForPattern }
  ).getRegexForPattern(LogScrubPatternType.IPAddress);

  expect(regex).not.toBeNull();

  return { rule, regex: regex as ScrubRegExp };
}

// The rule as the scans read it to name the rule that hid an address.
function asAddressScrubRule(compiled: CompiledRule): AddressScrubRule {
  return {
    id: RULE_ID,
    name: compiled.rule.name || "",
    patternType: compiled.rule.patternType || "",
    scrubAction: compiled.rule.scrubAction || "",
    fieldsToScrub: compiled.rule.fieldsToScrub || "",
  };
}

// What each action leaves of an address, as the engines make it.
function expectedValue(action: string, address: string): string {
  switch (action) {
    case LogScrubAction.Mask:
      return address.includes(":") && !address.startsWith("::ffff:")
        ? IPV6_ADDRESS_MASK
        : IPV4_ADDRESS_MASK;
    case LogScrubAction.Hash:
      return ScrubHashToken.ofIpAddress({ projectId: PROJECT_ID, address });
    default:
      return "[REDACTED]";
  }
}

const KIND_OF_ACTION: Record<string, ScrubbedAddressKind> = {
  [LogScrubAction.Redact]: ScrubbedAddressKind.Redacted,
  [LogScrubAction.Mask]: ScrubbedAddressKind.Masked,
  [LogScrubAction.Hash]: ScrubbedAddressKind.Hashed,
};

const ACTIONS: ReadonlyArray<string> = [
  LogScrubAction.Redact,
  LogScrubAction.Mask,
  LogScrubAction.Hash,
];

// Public addresses, which an IP Address rule hides: IPv4, IPv6, and IPv4 an IPv6 socket wrote.
const PUBLIC_ADDRESSES: ReadonlyArray<string> = [
  "203.0.113.7",
  "8.8.8.8",
  "2001:4860:4860::8888",
  "::ffff:8.8.8.8",
];

function accessLogLine(address: string): string {
  return `${address} - - [20/Nov/2026:10:00:05 +0000] "GET /static/../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.5.0"`;
}

function scrubLogLine(data: {
  body: string;
  attributes?: JSONObject;
  action: string;
  fields?: string;
}): { row: JSONObject; compiled: CompiledRule } {
  const compiled: CompiledRule = compile(
    LogScrubRuleService,
    new LogScrubRule(),
    {
      action: data.action,
      fields: data.fields || LogScrubField.Both,
    },
  );
  const row: JSONObject = LogScrubRuleService.scrubLog(
    { body: data.body, attributes: data.attributes || {} },
    [compiled] as never,
  );

  return { row, compiled };
}

function parseLogRow(row: JSONObject): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse({
    body: row["body"] as string,
    attributes: (row["attributes"] as JSONObject) || {},
    time: new Date("2026-11-20T10:00:05.000Z"),
    logId: "0193b0a1-0000-7000-8000-00000000b001",
  });

  expect(events).toHaveLength(1);

  return events[0]!;
}

function span(attributes: JSONObject): TraceScanSpan {
  return {
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    parentSpanId: "",
    sessionId: "",
    name: "GET /download",
    kind: "SPAN_KIND_SERVER",
    durationMs: 12,
    startTime: new Date("2026-11-20T10:00:00.000Z"),
    serviceId: "0193b0a1-0000-7000-8000-00000000c001",
    serviceType: "OpenTelemetry",
    isLlmSpan: false,
    llmUserMessagePreview: "",
    llmUserId: "",
    llmSystem: "",
    llmRequestModel: "",
    llmOperation: "",
    attributes: attributes as Record<string, string>,
  };
}

function scrubSpanAttributes(data: {
  attributes: JSONObject;
  action: string;
  fields?: string;
}): { attributes: JSONObject; compiled: CompiledRule } {
  const compiled: CompiledRule = compile(
    TraceScrubRuleService,
    new TraceScrubRule(),
    { action: data.action, fields: data.fields || TraceScrubField.All },
  );
  const row: JSONObject = TraceScrubRuleService.scrubSpan(
    {
      name: "GET /download",
      attributes: data.attributes,
      events: [],
      links: [],
    },
    [compiled] as never,
  );

  return { attributes: row["attributes"] as JSONObject, compiled };
}

beforeEach(() => {
  clearLinearRegExpCache();
});

describe("a web access log line whose client an IP Address rule scrubbed", () => {
  test.each(ACTIONS)(
    "%s: the event names no address, and keeps what the rule left in the line",
    (action: string) => {
      for (const address of PUBLIC_ADDRESSES) {
        const { row, compiled } = scrubLogLine({
          body: accessLogLine(address),
          action,
        });

        // The engine hid the address in the stored line.
        expect(row["body"]).not.toContain(address);

        const event: NormalizedSecurityEvent = parseLogRow(row);
        const hidden: HiddenClientAddress | null =
          readHiddenClientAddress(event);

        expect({ address, principalIp: event.principalIp }).toEqual({
          address,
          principalIp: "",
        });
        expect({ address, hidden }).toEqual({
          address,
          hidden: {
            kind: KIND_OF_ACTION[action],
            value: expectedValue(action, address),
            place: ScrubbedAddressPlace.LogBody,
            signal: "log",
            ruleId: "",
            ruleName: "",
          },
        });
        expect(event.observables).not.toContain(hidden!.value);

        // The project's rule explains it, as the log scan names it.
        expect(
          findScrubRuleThatHid([asAddressScrubRule(compiled)], {
            kind: hidden!.kind,
            place: hidden!.place!,
          })?.id,
        ).toBe(RULE_ID);
      }
    },
  );

  test("a Hash rule's token is the one ofIpAddress makes, however the address was written", () => {
    const tokens: Array<string> = ["8.8.8.8", "::ffff:8.8.8.8"].map(
      (address: string): string => {
        const event: NormalizedSecurityEvent = parseLogRow(
          scrubLogLine({ body: accessLogLine(address), action: "hash" }).row,
        );

        return readHiddenClientAddress(event)!.value;
      },
    );

    expect(tokens[0]).toBe(tokens[1]);
    expect(tokens[0]).toBe(
      ScrubHashToken.ofIpAddress({ projectId: PROJECT_ID, address: "8.8.8.8" }),
    );
  });

  test("an address its attributes held, scrubbed, is said to be hidden in the attributes", () => {
    // The connection's own address: one its sender could not have written (#10416).
    const { row } = scrubLogLine({
      body: "WARN rejected /static/../../etc/passwd",
      attributes: { "network.peer.address": "203.0.113.7" },
      action: "mask",
      fields: LogScrubField.Attributes,
    });

    expect(readHiddenClientAddress(parseLogRow(row))).toEqual(
      expect.objectContaining({
        kind: ScrubbedAddressKind.Masked,
        value: IPV4_ADDRESS_MASK,
        place: ScrubbedAddressPlace.LogAttributes,
      }),
    );
  });

  test("a private address the rule keeps is the event's address, and nothing is hidden", () => {
    for (const address of ["10.0.0.12", "192.168.1.20", "172.16.4.2"]) {
      const { row } = scrubLogLine({
        body: accessLogLine(address),
        action: "redact",
      });
      const event: NormalizedSecurityEvent = parseLogRow(row);

      expect({ address, principalIp: event.principalIp }).toEqual({
        address,
        principalIp: address,
      });
      expect(readHiddenClientAddress(event)).toBeNull();
    }
  });
});

describe("a server span whose client address an IP Address rule scrubbed", () => {
  test.each(ACTIONS)(
    "%s: the event names no address, and keeps what the rule left in the span",
    (action: string) => {
      for (const address of PUBLIC_ADDRESSES) {
        const { attributes, compiled } = scrubSpanAttributes({
          attributes: {
            "url.path": "/download",
            "url.query": "file=../../../../etc/passwd",
            // The connection's own address, which the scan blames (#10416).
            "network.peer.address": address,
          },
          action,
        });

        expect(attributes["network.peer.address"]).not.toBe(address);

        const events: Array<NormalizedSecurityEvent> = buildTraceSecurityEvents(
          span(attributes),
        );

        expect(events).toHaveLength(1);

        const hidden: HiddenClientAddress | null = readHiddenClientAddress(
          events[0]!,
        );

        expect({ address, principalIp: events[0]!.principalIp }).toEqual({
          address,
          principalIp: "",
        });
        expect({ address, hidden }).toEqual({
          address,
          hidden: {
            kind: KIND_OF_ACTION[action],
            value: expectedValue(action, address),
            place: ScrubbedAddressPlace.SpanAttributes,
            signal: "trace",
            ruleId: "",
            ruleName: "",
          },
        });
        expect(
          findScrubRuleThatHid([asAddressScrubRule(compiled)], {
            kind: hidden!.kind,
            place: hidden!.place!,
          })?.id,
        ).toBe(RULE_ID);
      }
    },
  );

  test("a rule that only scrubs span names leaves the address, which the event names", () => {
    const { attributes } = scrubSpanAttributes({
      attributes: {
        "url.path": "/download",
        "url.query": "file=../../../../etc/passwd",
        "network.peer.address": "203.0.113.7",
      },
      action: "redact",
      fields: TraceScrubField.Name,
    });
    const events: Array<NormalizedSecurityEvent> = buildTraceSecurityEvents(
      span(attributes),
    );

    expect(events[0]!.principalIp).toBe("203.0.113.7");
    expect(readHiddenClientAddress(events[0]!)).toBeNull();
  });
});
