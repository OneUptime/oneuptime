import { describe, expect, test } from "@jest/globals";
import {
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
} from "../../../../Types/SecurityCase/SecurityConnection";
import {
  getMitreTactic,
  getMitreTechnique,
} from "../../../../Types/SecurityEvent/MitreAttack";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import { SECURITY_LOG_SOURCE_ATTRIBUTE } from "../../../../Types/SecurityEvent/SecurityLogFormat";
import {
  SECURITY_TELEMETRY_SCANNED_KINDS,
  SECURITY_TELEMETRY_SIGNALS,
  SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE,
  SECURITY_TELEMETRY_SIGNAL_SOURCES,
  SECURITY_TELEMETRY_SOURCES,
  SECURITY_TELEMETRY_SOURCE_KINDS,
  SecurityTelemetrySignal,
  SecurityTelemetrySourceDefinition,
  SecurityTelemetrySourceKind,
  getSecurityTelemetrySourceDefinition,
  isSecurityTelemetryScannedKind,
  isSecurityTelemetrySignal,
  isSecurityTelemetrySourceKind,
} from "../../../../Types/SecurityEvent/SecurityTelemetrySource";
import {
  MAX_TELEMETRY_ATTRIBUTE_LENGTH,
  MAX_TELEMETRY_EVENT_MESSAGE_LENGTH,
  SECURITY_TELEMETRY_SIGNAL_ATTACK,
  buildTelemetrySecurityEvent,
  cutTelemetryText,
} from "../../../../Utils/SecurityEvent/TelemetryScan/TelemetrySecurityEvent";

/*
 * The shape every telemetry source's events share, and the catalog of
 * sources and signals they come from.
 */

describe("the telemetry sources", () => {
  test("are five, each with its own service and product, from OneUptime", () => {
    expect(SECURITY_TELEMETRY_SOURCE_KINDS).toEqual([
      SecurityTelemetrySourceKind.Traces,
      SecurityTelemetrySourceKind.NetworkFlows,
      SecurityTelemetrySourceKind.AuditLog,
      SecurityTelemetrySourceKind.RumSessions,
      SecurityTelemetrySourceKind.CloudAudit,
    ]);

    const services: Set<string> = new Set();
    const products: Set<string> = new Set();

    for (const definition of SECURITY_TELEMETRY_SOURCES) {
      expect(definition.vendorName).toBe("OneUptime");
      expect(definition.serviceName.startsWith("OneUptime ")).toBe(true);
      services.add(definition.serviceName);
      products.add(definition.productName);
    }

    expect(services.size).toBe(SECURITY_TELEMETRY_SOURCES.length);
    expect(products.size).toBe(SECURITY_TELEMETRY_SOURCES.length);
    // "Your logs" keeps its own service.
    expect(services.has("OneUptime Logs")).toBe(false);
  });

  test("the telemetry scan reads the first four; cloud audit logs come with each cloud account's read", () => {
    expect(SECURITY_TELEMETRY_SCANNED_KINDS).toEqual([
      SecurityTelemetrySourceKind.Traces,
      SecurityTelemetrySourceKind.NetworkFlows,
      SecurityTelemetrySourceKind.AuditLog,
      SecurityTelemetrySourceKind.RumSessions,
    ]);
    expect(
      isSecurityTelemetryScannedKind(SecurityTelemetrySourceKind.CloudAudit),
    ).toBe(false);
    expect(isSecurityTelemetryScannedKind("logs")).toBe(false);
    expect(
      getSecurityTelemetrySourceDefinition(
        SecurityTelemetrySourceKind.CloudAudit,
      ).serviceName,
    ).toBe("OneUptime Cloud Audit Logs");
    // No signal of the telemetry scan's is a cloud audit log's: its records are the cloud's own.
    expect(
      Object.values(SECURITY_TELEMETRY_SIGNAL_SOURCES).includes(
        SecurityTelemetrySourceKind.CloudAudit,
      ),
    ).toBe(false);
  });

  test("a kind is one of them, and nothing else is", () => {
    for (const kind of SECURITY_TELEMETRY_SOURCE_KINDS) {
      expect(isSecurityTelemetrySourceKind(kind)).toBe(true);
      expect(getSecurityTelemetrySourceDefinition(kind).kind).toBe(kind);
    }

    expect(isSecurityTelemetrySourceKind("logs")).toBe(false);
    expect(isSecurityTelemetrySourceKind(undefined)).toBe(false);
  });

  test("every signal belongs to one source, and has its ATT&CK reading", () => {
    for (const signal of SECURITY_TELEMETRY_SIGNALS) {
      expect(isSecurityTelemetrySignal(signal)).toBe(true);
      expect(SECURITY_TELEMETRY_SOURCE_KINDS).toContain(
        SECURITY_TELEMETRY_SIGNAL_SOURCES[signal],
      );
      expect(SECURITY_TELEMETRY_SIGNAL_ATTACK[signal]).toBeDefined();
    }

    expect(isSecurityTelemetrySignal("not-a-signal")).toBe(false);
  });

  test("every ATT&CK id a signal names is one the bundled version knows", () => {
    for (const signal of SECURITY_TELEMETRY_SIGNALS) {
      for (const tactic of SECURITY_TELEMETRY_SIGNAL_ATTACK[signal].tactics) {
        expect([signal, tactic, Boolean(getMitreTactic(tactic))]).toEqual([
          signal,
          tactic,
          true,
        ]);
      }

      for (const technique of SECURITY_TELEMETRY_SIGNAL_ATTACK[signal]
        .techniques) {
        expect([
          signal,
          technique,
          Boolean(getMitreTechnique(technique)),
        ]).toEqual([signal, technique, true]);
      }
    }
  });
});

describe("a telemetry source's event", () => {
  const build: (
    overrides?: Partial<Parameters<typeof buildTelemetrySecurityEvent>[0]>,
  ) => NormalizedSecurityEvent = (
    overrides: Partial<Parameters<typeof buildTelemetrySecurityEvent>[0]> = {},
  ): NormalizedSecurityEvent => {
    return buildTelemetrySecurityEvent({
      kind: SecurityTelemetrySourceKind.NetworkFlows,
      signal: SecurityTelemetrySignal.PortScan,
      time: new Date("2026-10-27T10:00:00.000Z"),
      eventUid: "flow:port-scan:a:b:w",
      classUid: 4001,
      activityName: "Traffic",
      statusName: "",
      severity: OcsfSeverity.Medium,
      message: "Port scan: a reached 30 ports on b",
      principalIp: " 198.51.100.1 ",
      targetIp: "10.0.0.1",
      attributes: { "network.bytes": 100, empty: "", missing: null },
      ...overrides,
    });
  };

  test("is OCSF, from OneUptime, and says its source and its signal", () => {
    const event: NormalizedSecurityEvent = build();
    const definition: SecurityTelemetrySourceDefinition =
      getSecurityTelemetrySourceDefinition(
        SecurityTelemetrySourceKind.NetworkFlows,
      );

    expect(event.className).toBe("Network Activity");
    expect(event.categoryName).toBe("Network Activity");
    expect(event.severityId).toBe(3);
    expect(event.vendorName).toBe(definition.vendorName);
    expect(event.productName).toBe(definition.productName);
    expect(event.attributes[SECURITY_LOG_SOURCE_ATTRIBUTE]).toBe(
      "network-flows",
    );
    expect(event.attributes[SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE]).toBe(
      "port-scan",
    );
    expect(event.mitreTactics).toEqual(["TA0007"]);
    expect(event.principalIp).toBe("198.51.100.1");
    // Who acted, then what it was aimed at.
    expect(event.observables).toEqual(["198.51.100.1", "10.0.0.1"]);
  });

  test("keeps every attribute as text, and drops the empty ones", () => {
    const event: NormalizedSecurityEvent = build();

    expect(event.attributes["network.bytes"]).toBe("100");
    expect("empty" in event.attributes).toBe(false);
    expect("missing" in event.attributes).toBe(false);
  });

  test("names the record its data was sent under only when it is a real id", () => {
    expect(
      build({
        resourceId: "0192f1a0-0000-7000-8000-00000000c001",
        resourceType: "OpenTelemetry",
      }).attributes[SECURITY_LOG_RESOURCE_ID_ATTRIBUTE],
    ).toBe("0192f1a0-0000-7000-8000-00000000c001");
    expect(
      build({
        resourceId: "0192f1a0-0000-7000-8000-00000000c001",
        resourceType: "OpenTelemetry",
      }).attributes[SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE],
    ).toBe("OpenTelemetry");
    expect(
      SECURITY_LOG_RESOURCE_ID_ATTRIBUTE in
        build({ resourceId: "not-an-id", resourceType: "OpenTelemetry" })
          .attributes,
    ).toBe(false);
  });

  test("cuts a message and an attribute that run long", () => {
    const event: NormalizedSecurityEvent = build({
      message: "m".repeat(5000),
      attributes: { long: "a".repeat(10000) },
    });

    expect(event.message.length).toBe(MAX_TELEMETRY_EVENT_MESSAGE_LENGTH);
    expect(String(event.attributes["long"]).length).toBe(
      MAX_TELEMETRY_ATTRIBUTE_LENGTH,
    );
  });

  test("carries the request it happened in", () => {
    const event: NormalizedSecurityEvent = build({
      traceId: " 4bf92f3577b34da6a3ce929d0e0e4736 ",
      spanId: "00f067aa0ba902b7",
      sessionId: "s-1",
    });

    expect(event.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(event.spanId).toBe("00f067aa0ba902b7");
    expect(event.sessionId).toBe("s-1");
    expect(event.requestOutcome).toBeUndefined();
  });
});

/*
 * A cut never leaves half a character (found by #10663's repair against a
 * real ClickHouse): a cut between the halves of a surrogate pair left a
 * lone half, which ClickHouse refuses as JSON - and with it every event of
 * the insert, so one long prompt or name with an emoji at the cut stopped
 * a source's events.
 */
describe("cutting text", () => {
  function hasLoneSurrogate(text: string): boolean {
    for (let index: number = 0; index < text.length; index++) {
      const code: number = text.charCodeAt(index);

      if (code >= 0xd800 && code <= 0xdbff) {
        const next: number = text.charCodeAt(index + 1);

        if (!(next >= 0xdc00 && next <= 0xdfff)) {
          return true;
        }

        index++;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        return true;
      }
    }

    return false;
  }

  test("never between the halves of an emoji, wherever the cut falls", () => {
    for (let prefix: number = 0; prefix < 6; prefix++) {
      const text: string = `${"a".repeat(prefix)}${"🔑".repeat(20)}`;

      for (let limit: number = 2; limit < 24; limit++) {
        const cut: string = cutTelemetryText(text, limit);

        expect([prefix, limit, hasLoneSurrogate(cut)]).toEqual([
          prefix,
          limit,
          false,
        ]);
        expect(cut.length).toBeLessThanOrEqual(limit);
        expect(cut.endsWith("…")).toBe(true);
      }
    }
  });

  test("text that fits, and text of plain characters, are cut as they always were", () => {
    expect(cutTelemetryText("short", 10)).toBe("short");
    expect(cutTelemetryText("abcdefghij", 5)).toBe("abcd…");
    expect(cutTelemetryText("", 5)).toBe("");
    expect(cutTelemetryText("🔑🔑", 4)).toBe("🔑🔑");
  });

  test("an event's message and attributes with emoji at the limit stay whole characters", () => {
    const event: NormalizedSecurityEvent = buildTelemetrySecurityEvent({
      kind: SecurityTelemetrySourceKind.Traces,
      signal: SecurityTelemetrySignal.PromptInjection,
      time: new Date("2026-11-10T10:00:00.000Z"),
      eventUid: "trace:emoji",
      classUid: 6003,
      activityName: "Read",
      statusName: "Success",
      severity: OcsfSeverity.Medium,
      message: `${"x".repeat(MAX_TELEMETRY_EVENT_MESSAGE_LENGTH - 2)}${"🔑".repeat(5)}`,
      attributes: {
        prompt: `${"y".repeat(MAX_TELEMETRY_ATTRIBUTE_LENGTH - 2)}${"🔑".repeat(5)}`,
      },
    });

    expect(hasLoneSurrogate(event.message)).toBe(false);
    expect(hasLoneSurrogate(String(event.attributes["prompt"]))).toBe(false);
  });
});
