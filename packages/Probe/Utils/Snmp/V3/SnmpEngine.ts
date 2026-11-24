import SnmpTrapReceiverUtil from "Common/Types/Probe/SnmpTrapReceiver";
import crypto from "crypto";

/*
 * THE PROBE'S OWN SNMP ENGINE: its engine ID, boots and time (RFC 3411,
 * RFC 3414 section 2.2), as its SNMPv3 trap receiver announces them.
 *
 * A device sending an SNMPv3 INFORM authenticates and encrypts it with keys
 * localized to the receiver's engine ID, so the receiver's engine ID is part
 * of every inform sender's configuration: Net-SNMP and most stacks discover
 * it, Cisco IOS needs it typed in (`snmp-server engineID remote <probe>
 * <id>`) before the user is created. If it ever changes, every such device
 * stops getting its informs through, without a word. So it never changes:
 *
 *   - PROBE_SNMP_ENGINE_ID, when whoever runs the probe set it (hex, 5 to
 *     32 octets; "0x" and separators are read too) - to keep the engine ID
 *     of a receiver this probe replaces, say;
 *   - otherwise derived from the probe's ID: the same across restarts,
 *     upgrades, a re-created container or pod, and every replica of one
 *     probe - which is what one trap address in front of several replicas
 *     needs. A probe's disk survives none of those, so an ID generated once
 *     and kept on disk would not do.
 *
 * Its shape is net-snmp's own engine IDs': 0x80 0x00 0xB9 0x83 (the RFC 3411
 * "new format" marker and net-snmp's enterprise number), 0x80 (an
 * enterprise-specific format), then 12 octets - a hash of the probe's ID
 * here, where net-snmp draws random ones.
 *
 * BOOTS AND TIME come from the clock: boots is 1 and time is the seconds
 * since 2020-01-01. Both only ever move forward, across restarts too, and
 * replicas agree on them as their clocks agree - so an inform sender's view
 * of the probe's time stays right whichever replica it reaches, and a
 * replayed message is still refused 150 seconds on. (The time reaches its
 * RFC limit of 2^31-1 seconds in 2088.)
 */

const ENGINE_ID_PREFIX: Buffer = Buffer.from("8000B98380", "hex");
const DERIVED_ENGINE_ID_OCTETS: number = 12;

export const SNMP_ENGINE_BOOTS: number = 1;
export const SNMP_ENGINE_TIME_EPOCH_MS: number = Date.UTC(2020, 0, 1);
export const MAX_SNMP_ENGINE_TIME: number = 2147483647;

export type SnmpEngineIdSource = "configured" | "probe" | "random";

export interface ResolvedSnmpEngineId {
  engineId: Buffer;
  source: SnmpEngineIdSource;
  // Set when PROBE_SNMP_ENGINE_ID was given but is not an engine ID.
  configuredValueIsInvalid?: boolean | undefined;
}

export default class SnmpEngine {
  public static deriveEngineId(probeId: string): Buffer {
    const digest: Buffer = crypto
      .createHash("sha256")
      .update(`OneUptime probe SNMP engine ${probeId.trim().toLowerCase()}`)
      .digest();

    return Buffer.concat([
      ENGINE_ID_PREFIX,
      digest.subarray(0, DERIVED_ENGINE_ID_OCTETS),
    ]);
  }

  /*
   * The engine ID to run with: the configured one, the probe's, or - only
   * when the probe somehow has no ID yet - a random one in the same shape.
   * Never throws: a bad PROBE_SNMP_ENGINE_ID is reported and passed over,
   * so it cannot stop the probe.
   */
  public static resolveEngineId(data: {
    configured?: string | null | undefined;
    probeId?: string | null | undefined;
  }): ResolvedSnmpEngineId {
    const configured: string = (data.configured || "").trim();
    let configuredValueIsInvalid: boolean = false;

    if (configured) {
      const normalized: string | null =
        SnmpTrapReceiverUtil.normalizeEngineId(configured);

      if (normalized && SnmpEngine.isUsableEngineId(normalized)) {
        return {
          engineId: Buffer.from(normalized, "hex"),
          source: "configured",
        };
      }

      configuredValueIsInvalid = true;
    }

    const probeId: string = (data.probeId || "").trim();

    if (probeId) {
      return {
        engineId: SnmpEngine.deriveEngineId(probeId),
        source: "probe",
        ...(configuredValueIsInvalid ? { configuredValueIsInvalid: true } : {}),
      };
    }

    return {
      engineId: Buffer.concat([
        ENGINE_ID_PREFIX,
        crypto.randomBytes(DERIVED_ENGINE_ID_OCTETS),
      ]),
      source: "random",
      ...(configuredValueIsInvalid ? { configuredValueIsInvalid: true } : {}),
    };
  }

  // The engine's time at a moment: whole seconds since the epoch above.
  public static getEngineTime(nowMs: number): number {
    const seconds: number = Math.floor(
      (nowMs - SNMP_ENGINE_TIME_EPOCH_MS) / 1000,
    );

    return Math.min(Math.max(seconds, 0), MAX_SNMP_ENGINE_TIME);
  }

  public static toHex(engineId: Buffer): string {
    return engineId.toString("hex").toUpperCase();
  }

  /*
   * RFC 3411 reserves an engine ID of all zeros and one of all 0xFF octets:
   * neither can be configured.
   */
  private static isUsableEngineId(hex: string): boolean {
    return !/^(00)+$/.test(hex) && !/^(FF)+$/.test(hex);
  }
}
