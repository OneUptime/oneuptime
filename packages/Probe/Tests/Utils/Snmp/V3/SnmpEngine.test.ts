import SnmpEngine, {
  MAX_SNMP_ENGINE_TIME,
  ResolvedSnmpEngineId,
  SNMP_ENGINE_TIME_EPOCH_MS,
} from "../../../../Utils/Snmp/V3/SnmpEngine";
import { describe, expect, test } from "@jest/globals";

/*
 * The probe's SNMPv3 engine ID is part of every inform sender's setup (on
 * Cisco IOS it is typed in), so it must never change for a probe: not at a
 * restart, an upgrade, a re-created container or pod, or from one replica
 * to the next. Derived from the probe's ID, unless whoever runs the probe
 * set PROBE_SNMP_ENGINE_ID.
 */

const PROBE_ID: string = "6c0ae2b4-9a51-4b1e-8f3f-3f0b1c9f2a11";

describe("the engine ID", () => {
  test("is derived from the probe's ID: the same every time", () => {
    const first: ResolvedSnmpEngineId = SnmpEngine.resolveEngineId({
      probeId: PROBE_ID,
    });
    const second: ResolvedSnmpEngineId = SnmpEngine.resolveEngineId({
      probeId: PROBE_ID,
    });

    expect(first.source).toBe("probe");
    expect(first.engineId.equals(second.engineId)).toBe(true);
  });

  test("is net-snmp's shape: 17 octets, the new-format marker and an enterprise-specific format", () => {
    const engineId: Buffer = SnmpEngine.deriveEngineId(PROBE_ID);

    expect(engineId.length).toBe(17);
    expect(engineId.subarray(0, 5).toString("hex")).toBe("8000b98380");
  });

  test("differs from one probe to another", () => {
    expect(
      SnmpEngine.deriveEngineId(PROBE_ID).equals(
        SnmpEngine.deriveEngineId("6c0ae2b4-9a51-4b1e-8f3f-3f0b1c9f2a12"),
      ),
    ).toBe(false);
  });

  test("does not depend on how the probe's ID is written", () => {
    expect(
      SnmpEngine.deriveEngineId(` ${PROBE_ID.toUpperCase()} `).equals(
        SnmpEngine.deriveEngineId(PROBE_ID),
      ),
    ).toBe(true);
  });

  test("PROBE_SNMP_ENGINE_ID wins, read with 0x and separators as people copy it", () => {
    for (const configured of [
      "80001F8880C71100000000000000",
      "0x80001f8880c71100000000000000",
      "80:00:1F:88:80:C7:11:00:00:00:00:00:00:00",
      "80 00 1F 88 80 C7 11 00 00 00 00 00 00 00",
    ]) {
      const resolved: ResolvedSnmpEngineId = SnmpEngine.resolveEngineId({
        configured: configured,
        probeId: PROBE_ID,
      });

      expect(resolved.source).toBe("configured");
      expect(SnmpEngine.toHex(resolved.engineId)).toBe(
        "80001F8880C71100000000000000",
      );
      expect(resolved.configuredValueIsInvalid).toBeUndefined();
    }
  });

  test("a PROBE_SNMP_ENGINE_ID that is not an engine ID is said and passed over, never fatal", () => {
    for (const configured of [
      "not-hex",
      "8000",
      "80001F8880C7110000000000000",
      "00000000000000",
      "FFFFFFFFFFFF",
      "AB".repeat(33),
    ]) {
      const resolved: ResolvedSnmpEngineId = SnmpEngine.resolveEngineId({
        configured: configured,
        probeId: PROBE_ID,
      });

      expect(resolved.source).toBe("probe");
      expect(resolved.configuredValueIsInvalid).toBe(true);
      expect(
        resolved.engineId.equals(SnmpEngine.deriveEngineId(PROBE_ID)),
      ).toBe(true);
    }
  });

  test("an empty PROBE_SNMP_ENGINE_ID is unset", () => {
    expect(
      SnmpEngine.resolveEngineId({ configured: "   ", probeId: PROBE_ID }),
    ).toEqual({
      engineId: SnmpEngine.deriveEngineId(PROBE_ID),
      source: "probe",
    });
  });

  test("only a probe with no ID yet gets a random one, in the same shape", () => {
    const resolved: ResolvedSnmpEngineId = SnmpEngine.resolveEngineId({
      probeId: null,
    });

    expect(resolved.source).toBe("random");
    expect(resolved.engineId.length).toBe(17);
    expect(resolved.engineId.subarray(0, 5).toString("hex")).toBe("8000b98380");
  });

  test("is written in capitals without separators, as device configurations take it", () => {
    expect(SnmpEngine.toHex(Buffer.from([0x80, 0x00, 0xab, 0x0f, 0x01]))).toBe(
      "8000AB0F01",
    );
  });
});

describe("the engine's time", () => {
  test("is the seconds since 2020: the same across restarts and replicas", () => {
    expect(SnmpEngine.getEngineTime(SNMP_ENGINE_TIME_EPOCH_MS)).toBe(0);
    expect(SnmpEngine.getEngineTime(SNMP_ENGINE_TIME_EPOCH_MS + 1999)).toBe(1);
    expect(SnmpEngine.getEngineTime(Date.UTC(2026, 10, 24, 0, 0, 0))).toBe(
      Math.floor(
        (Date.UTC(2026, 10, 24, 0, 0, 0) - SNMP_ENGINE_TIME_EPOCH_MS) / 1000,
      ),
    );
  });

  test("never goes below 0 or past the RFC's 2^31 - 1", () => {
    expect(SnmpEngine.getEngineTime(0)).toBe(0);
    expect(SnmpEngine.getEngineTime(Date.UTC(2100, 0, 1))).toBe(
      MAX_SNMP_ENGINE_TIME,
    );
  });
});
