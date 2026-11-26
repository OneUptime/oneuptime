import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  ClientAddressTrust,
  TrustedProxies,
  readClaimedClientAddress,
  readClientAddressTrust,
  toTrustedProxies,
} from "../../../Utils/SecurityEvent/ClientAddressTrust";
import WebAttackLogParser, {
  getSqlInjectionMarkers,
} from "../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import { applyRequestAssessment } from "../../../Utils/SecurityEvent/RequestFollowUp";
import {
  RequestTraceAssessment,
  RequestTraceSpan,
  assessRequestTrace,
} from "../../../Utils/SecurityEvent/RequestOutcome";
import { logLine } from "./LogParsers/LogParserFixtures";

/*
 * FOLLOWING A REQUEST NEVER BLAMES AN ADDRESS ITS SENDER WROTE (#10416).
 *
 * A log line written inside a traced request takes the client its trace
 * names - from the server span that answered it. That span's client.address
 * is what instrumentation read from X-Forwarded-For, so it is a claim: the
 * event takes the connection's own address, or one a trusted proxy
 * forwarded, and keeps the claim beside it, never as its principalIp.
 */

const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

// An application's line inside the request: no address of its own.
const APPLICATION_LINE: string = "WARN rejected /static/../../etc/passwd";

function eventFrom(
  body: string,
  attributes: Record<string, string> = {},
): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse({
    ...logLine(body, attributes),
    traceId: TRACE_ID,
    spanId: "00f067aa0ba902b7",
  });

  expect(events).toHaveLength(1);

  return events[0]!;
}

function serverSpan(attributes: Record<string, string>): RequestTraceSpan {
  return {
    spanId: "aaaaaaaaaaaaaaaa",
    parentSpanId: "",
    name: "GET /static",
    kind: "SPAN_KIND_SERVER",
    statusCode: 0,
    durationMs: 4,
    attributes: {
      "http.request.method": "GET",
      "http.response.status_code": "404",
      "url.path": "/static/../../etc/passwd",
      ...attributes,
    },
  };
}

function follow(
  event: NormalizedSecurityEvent,
  attributes: Record<string, string>,
  trustedProxies?: TrustedProxies,
): RequestTraceAssessment {
  const assessment: RequestTraceAssessment = assessRequestTrace({
    spans: [
      serverSpan(attributes),
      {
        spanId: "00f067aa0ba902b7",
        parentSpanId: "aaaaaaaaaaaaaaaa",
        name: "router",
        kind: "SPAN_KIND_INTERNAL",
        statusCode: 0,
        durationMs: 1,
        attributes: {},
      },
    ],
    exceptions: [],
    eventSpanId: "00f067aa0ba902b7",
    sqlMarkers: getSqlInjectionMarkers(),
    requestText: event.targetResource,
    trustedProxies,
  });

  applyRequestAssessment(event, assessment);

  return assessment;
}

describe("following a request into its trace", () => {
  test("a server span that only claims its client names no address: the claim is kept, as claimed", () => {
    const event: NormalizedSecurityEvent = eventFrom(APPLICATION_LINE);
    const assessment: RequestTraceAssessment = follow(event, {
      "client.address": "192.0.2.44",
    });

    expect(assessment.clientAddress).toBe("");
    expect(event.principalIp).toBe("");
    expect(event.observables).not.toContain("192.0.2.44");
    expect(
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddress],
    ).toBeUndefined();
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.Claimed);
    expect(readClaimedClientAddress(event)).toEqual({
      address: "192.0.2.44",
      scrubbedKind: null,
      from: "client.address",
      isOnlyAddress: true,
    });
  });

  test("a public peer that is no trusted proxy is the client, and what client.address said a claim", () => {
    const event: NormalizedSecurityEvent = eventFrom(APPLICATION_LINE);

    follow(event, {
      "network.peer.address": "203.0.113.7",
      "client.address": "192.0.2.44",
    });

    expect(event.principalIp).toBe("203.0.113.7");
    expect(event.observables).toContain("203.0.113.7");
    expect(event.observables).not.toContain("192.0.2.44");
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.Peer);
    expect(readClaimedClientAddress(event)?.address).toBe("192.0.2.44");
  });

  test("through a private load balancer that the app records X-Forwarded-For behind, the hop it appended is the client", () => {
    const event: NormalizedSecurityEvent = eventFrom(APPLICATION_LINE);

    follow(event, {
      "network.peer.address": "10.0.0.5",
      "client.address": "192.0.2.44",
      "http.request.header.x-forwarded-for": '["192.0.2.44, 203.0.113.7"]',
    });

    expect(event.principalIp).toBe("203.0.113.7");
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.TrustedProxy);
    expect(readClaimedClientAddress(event)?.address).toBe("192.0.2.44");
  });

  test("through a private load balancer with no recorded header, nothing is verified", () => {
    const event: NormalizedSecurityEvent = eventFrom(APPLICATION_LINE);

    follow(event, {
      "network.peer.address": "10.0.0.5",
      "client.address": "192.0.2.44",
    });

    expect(event.principalIp).toBe("");
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.Claimed);
    expect(readClaimedClientAddress(event)?.isOnlyAddress).toBe(true);
  });

  test("an edge the project trusts vouches for the address it forwarded", () => {
    const cloudflare: TrustedProxies = toTrustedProxies("172.64.0.0/13");
    const event: NormalizedSecurityEvent = eventFrom(APPLICATION_LINE);

    follow(
      event,
      {
        "network.peer.address": "172.70.38.12",
        "client.address": "198.51.100.23",
        "http.request.header.x-forwarded-for": "198.51.100.23",
      },
      cloudflare,
    );

    expect(event.principalIp).toBe("198.51.100.23");
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.TrustedProxy);
    expect(readClaimedClientAddress(event)).toBeNull();
  });

  test("an access log line keeps its own client: the trace's claim is kept beside it", () => {
    const event: NormalizedSecurityEvent = eventFrom(
      '203.0.113.40 - - [20/Nov/2026:10:00:05 +0000] "GET /static/../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.5.0"',
    );

    expect(event.principalIp).toBe("203.0.113.40");

    follow(event, { "client.address": "192.0.2.44" });

    expect(event.principalIp).toBe("203.0.113.40");
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.Peer);
    expect(readClaimedClientAddress(event)?.address).toBe("192.0.2.44");
  });

  test("a line whose own attributes only claimed an address takes the address its trace verifies", () => {
    const event: NormalizedSecurityEvent = eventFrom(APPLICATION_LINE, {
      "client.address": "192.0.2.44",
    });

    expect(event.principalIp).toBe("");
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.Claimed);

    follow(event, {
      "network.peer.address": "203.0.113.7",
      "client.address": "192.0.2.44",
    });

    expect(event.principalIp).toBe("203.0.113.7");
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.Peer);
    expect(readClaimedClientAddress(event)?.address).toBe("192.0.2.44");
  });
});
