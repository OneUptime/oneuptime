import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import WebAttackLogParser from "../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import { applyRequestAssessment } from "../../../Utils/SecurityEvent/RequestFollowUp";
import { RequestTraceAssessment } from "../../../Utils/SecurityEvent/RequestOutcome";
import {
  HiddenClientAddress,
  ScrubbedAddressKind,
  ScrubbedAddressPlace,
  readHiddenClientAddress,
} from "../../../Utils/SecurityEvent/ScrubbedAddress";
import { IPV4_ADDRESS_MASK as SCRUB_IPV4_MASK } from "../../../Utils/Telemetry/ScrubIpAddress";
import { logLine } from "./LogParsers/LogParserFixtures";

/*
 * Following a log line's request into its trace reads the client's address
 * from the span that answered it (#10397). Where a trace scrub rule hid it,
 * an event that names no address says a scrub rule hid it - in the trace.
 * Where the trace names the address a log rule hid, the event names it and
 * says nothing is hidden. An event that already says a log rule hid its
 * address keeps saying so, and one that names its address keeps it.
 */

const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

function eventFrom(body: string): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse({
    ...logLine(body),
    traceId: TRACE_ID,
    spanId: "00f067aa0ba902b7",
  });

  expect(events).toHaveLength(1);

  return events[0]!;
}

function assessment(clientAddress: string): RequestTraceAssessment {
  return {
    outcome: SecurityEventRequestOutcome.Rejected,
    serverSpanId: "aaaaaaaaaaaaaaaa",
    statusCode: 404,
    method: "get",
    url: "/static/../../etc/passwd",
    route: "",
    clientAddress,
    userAgent: "curl/8.5.0",
    userId: "",
    durationMs: 3,
    exception: undefined,
    database: undefined,
    requestedDelaySeconds: 0,
  };
}

// An application's line inside the request: no address of its own.
const APPLICATION_LINE: string = "WARN rejected /static/../../etc/passwd";

// An access log line whose address a log rule hid.
const SCRUBBED_ACCESS_LINE: string =
  '[REDACTED] - - [20/Nov/2026:10:00:05 +0000] "GET /static/../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.5.0"';

describe("following a request whose client address a scrub rule hid", () => {
  test("an event with no address says a trace rule hid it, when the trace's span holds what the rule left", () => {
    for (const [scrubbed, kind, value] of [
      ["[REDACTED]", ScrubbedAddressKind.Redacted, "[REDACTED]"],
      [SCRUB_IPV4_MASK, ScrubbedAddressKind.Masked, SCRUB_IPV4_MASK],
      [
        "[HASHED:3f9a1c0e7b2d4a68]",
        ScrubbedAddressKind.Hashed,
        "[HASHED:3f9a1c0e7b2d4a68]",
      ],
      ["::ffff:[REDACTED]", ScrubbedAddressKind.Redacted, "[REDACTED]"],
    ] as ReadonlyArray<[string, ScrubbedAddressKind, string]>) {
      const event: NormalizedSecurityEvent = eventFrom(APPLICATION_LINE);

      expect(readHiddenClientAddress(event)).toBeNull();

      applyRequestAssessment(event, assessment(scrubbed));

      expect({ scrubbed, principalIp: event.principalIp }).toEqual({
        scrubbed,
        principalIp: "",
      });
      expect(readHiddenClientAddress(event)).toEqual({
        kind,
        value,
        place: ScrubbedAddressPlace.SpanAttributes,
        signal: "trace",
        ruleId: "",
        ruleName: "",
      } as HiddenClientAddress);
      expect(event.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddress]).toBe(
        undefined,
      );
      expect(event.observables).not.toContain(scrubbed);
    }
  });

  test("the trace names the address a log rule hid: the event names it, and nothing is hidden", () => {
    const event: NormalizedSecurityEvent = eventFrom(SCRUBBED_ACCESS_LINE);

    expect(readHiddenClientAddress(event)?.place).toBe(
      ScrubbedAddressPlace.LogBody,
    );

    applyRequestAssessment(event, assessment("203.0.113.7"));

    expect(event.principalIp).toBe("203.0.113.7");
    expect(event.observables).toContain("203.0.113.7");
    expect(readHiddenClientAddress(event)).toBeNull();
    expect(
      Object.keys(event.attributes).filter((key: string): boolean => {
        return key.startsWith("oneuptime.request.client_address");
      }),
    ).toEqual([]);
  });

  test("an event that says a log rule hid its address keeps saying so when the trace's is hidden too", () => {
    const event: NormalizedSecurityEvent = eventFrom(SCRUBBED_ACCESS_LINE);

    applyRequestAssessment(event, assessment(SCRUB_IPV4_MASK));

    expect(readHiddenClientAddress(event)).toEqual(
      expect.objectContaining({
        kind: ScrubbedAddressKind.Redacted,
        value: "[REDACTED]",
        place: ScrubbedAddressPlace.LogBody,
      }),
    );
  });

  test("an event that names its address keeps it, and says nothing is hidden", () => {
    const event: NormalizedSecurityEvent = eventFrom(
      '203.0.113.41 - - [20/Nov/2026:10:00:05 +0000] "GET /static/../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.5.0"',
    );

    applyRequestAssessment(event, assessment("[REDACTED]"));

    expect(event.principalIp).toBe("203.0.113.41");
    expect(readHiddenClientAddress(event)).toBeNull();
    expect(
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressHidden],
    ).toBe(undefined);
  });

  test("a trace with no client address, or a host name for one, says nothing of a hidden one", () => {
    for (const clientAddress of ["", "app.internal", "[Redacted]"]) {
      const event: NormalizedSecurityEvent = eventFrom(APPLICATION_LINE);

      applyRequestAssessment(event, assessment(clientAddress));

      expect({ clientAddress, hidden: readHiddenClientAddress(event) }).toEqual(
        { clientAddress, hidden: null },
      );
    }
  });
});
