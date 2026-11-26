import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import WebAttackLogParser from "../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import { applyRequestAssessment } from "../../../Utils/SecurityEvent/RequestFollowUp";
import { resolveClientAddress } from "../../../Utils/SecurityEvent/ClientAddressTrust";
import { RequestTraceAssessment } from "../../../Utils/SecurityEvent/RequestOutcome";
import {
  HiddenClientAddress,
  ScrubbedAddressKind,
  ScrubbedAddressPlace,
  isAddressVaultToken,
  nameClientAddressScrubRule,
  readHiddenClientAddress,
} from "../../../Utils/SecurityEvent/ScrubbedAddress";
import { IPV4_ADDRESS_MASK } from "../../../Utils/Telemetry/ScrubIpAddress";
import { logLine } from "./LogParsers/LogParserFixtures";

/*
 * WHICH HIDDEN ADDRESS A FOLLOWED LOG EVENT KEEPS (#10395 on #10397).
 *
 * A log line's client address and its trace's can both be hidden: a log
 * rule's and a trace rule's. The event keeps one of them, and Security
 * Events' address vault can name only a Hash rule's token of today's form.
 * So the event keeps the line's - as #10397 decided - unless the line's
 * holds nothing to look up and the trace's is such a token: then it keeps
 * the trace's, which may still name the address.
 */

const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const TOKEN: string = "[HASHED:01580765cb52614a]";
const OTHER_TOKEN: string = "[HASHED:3f9a1c0e7b2d4a68]";
const LEGACY_TOKEN: string = "[HASHED:8c87b489]";

function eventOfLine(client: string): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse({
    ...logLine(
      `${client} - - [20/Nov/2026:10:00:05 +0000] "GET /static/../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.5.0"`,
    ),
    traceId: TRACE_ID,
    spanId: "00f067aa0ba902b7",
  });

  expect(events).toHaveLength(1);

  return events[0]!;
}

function applicationEvent(): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse({
    ...logLine("WARN rejected /static/../../etc/passwd"),
    traceId: TRACE_ID,
    spanId: "00f067aa0ba902b7",
  });

  return events[0]!;
}

/*
 * A trace whose server span names its client by the connection's own
 * address (the peer), as a scrub rule left it: the address the follow-up
 * reads as verified (ClientAddressTrust, #10416).
 */
function assessment(clientAddress: string): RequestTraceAssessment {
  return {
    outcome: SecurityEventRequestOutcome.Rejected,
    serverSpanId: "aaaaaaaaaaaaaaaa",
    statusCode: 404,
    method: "get",
    url: "/static/../../etc/passwd",
    route: "",
    clientAddress,
    client: resolveClientAddress({ peer: clientAddress }),
    userAgent: "curl/8.5.0",
    userId: "",
    durationMs: 3,
    exception: undefined,
    database: undefined,
    requestedDelaySeconds: 0,
  };
}

function hiddenOf(event: NormalizedSecurityEvent): HiddenClientAddress {
  const hidden: HiddenClientAddress | null = readHiddenClientAddress(event);

  expect(hidden).not.toBeNull();

  return hidden!;
}

describe("a token the address vault can name", () => {
  test("is a Hash rule's token of today's form", () => {
    expect(
      isAddressVaultToken({ kind: ScrubbedAddressKind.Hashed, value: TOKEN }),
    ).toBe(true);
  });

  test.each([
    ["an older 8-hex token", ScrubbedAddressKind.Hashed, LEGACY_TOKEN],
    ["a token in capitals", ScrubbedAddressKind.Hashed, TOKEN.toUpperCase()],
    ["what Redact leaves", ScrubbedAddressKind.Redacted, "[REDACTED]"],
    ["what Mask leaves", ScrubbedAddressKind.Masked, IPV4_ADDRESS_MASK],
    // A token's shape, but the kind says what the rule did.
    ["a mask of a token's shape", ScrubbedAddressKind.Masked, TOKEN],
  ])(
    "is not %s",
    (_label: string, kind: ScrubbedAddressKind, value: string) => {
      expect(isAddressVaultToken({ kind, value })).toBe(false);
    },
  );
});

describe("following a line into its trace, when both hid the client's address", () => {
  test.each([
    ["redacted", "[REDACTED]"],
    ["masked", IPV4_ADDRESS_MASK],
  ])(
    "a line a log rule %s, a trace a Hash rule hashed: the event keeps the trace's token",
    (_label: string, lineClient: string) => {
      const event: NormalizedSecurityEvent = eventOfLine(lineClient);

      applyRequestAssessment(event, assessment(TOKEN));

      expect(hiddenOf(event)).toEqual(
        expect.objectContaining({
          kind: ScrubbedAddressKind.Hashed,
          value: TOKEN,
          place: ScrubbedAddressPlace.SpanAttributes,
          signal: "trace",
        }),
      );
      expect(event.principalIp).toBe("");
    },
  );

  test("a line a Hash rule hashed keeps its own token, whatever the trace's", () => {
    for (const traceClient of [OTHER_TOKEN, "[REDACTED]", IPV4_ADDRESS_MASK]) {
      const event: NormalizedSecurityEvent = eventOfLine(TOKEN);

      applyRequestAssessment(event, assessment(traceClient));

      expect(hiddenOf(event)).toEqual(
        expect.objectContaining({
          kind: ScrubbedAddressKind.Hashed,
          value: TOKEN,
          place: ScrubbedAddressPlace.LogBody,
        }),
      );
    }
  });

  test("an older trace token holds nothing to look up: the line's marker stays", () => {
    const event: NormalizedSecurityEvent = eventOfLine("[REDACTED]");

    applyRequestAssessment(event, assessment(LEGACY_TOKEN));

    expect(hiddenOf(event)).toEqual(
      expect.objectContaining({
        kind: ScrubbedAddressKind.Redacted,
        place: ScrubbedAddressPlace.LogBody,
      }),
    );
  });

  test("a line with no address of its own takes the trace's token", () => {
    const event: NormalizedSecurityEvent = applicationEvent();

    applyRequestAssessment(event, assessment(TOKEN));

    expect(hiddenOf(event)).toEqual(
      expect.objectContaining({
        kind: ScrubbedAddressKind.Hashed,
        value: TOKEN,
        place: ScrubbedAddressPlace.SpanAttributes,
      }),
    );
  });

  test("the marker it replaces goes whole: no rule of the line's is left naming the trace's token", () => {
    const event: NormalizedSecurityEvent = eventOfLine("[REDACTED]");

    nameClientAddressScrubRule(event.attributes, {
      id: "0192f1a0-0000-7000-8000-00000000d101",
      name: "Redact IP addresses",
    });

    applyRequestAssessment(event, assessment(TOKEN));

    expect(
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubRuleId],
    ).toBeUndefined();
    expect(
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubRule],
    ).toBeUndefined();
    expect(hiddenOf(event).ruleId).toBe("");
  });

  test("a trace that names the address still names it, and hides nothing", () => {
    const event: NormalizedSecurityEvent = eventOfLine(TOKEN);

    applyRequestAssessment(event, assessment("203.0.113.7"));

    expect(event.principalIp).toBe("203.0.113.7");
    expect(readHiddenClientAddress(event)).toBeNull();
  });
});
