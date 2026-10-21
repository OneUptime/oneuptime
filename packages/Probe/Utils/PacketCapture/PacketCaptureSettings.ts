import {
  HARD_MAX_PACKET_CAPTURE_LIMITS,
  PACKET_CAPTURE_MAX_DURATION_IN_SECONDS,
  PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB,
  PACKET_CAPTURE_MIN_DURATION_IN_SECONDS,
  PACKET_CAPTURE_MIN_FILE_SIZE_IN_MB,
  PacketCaptureLimits,
  PacketCaptureLimitsUtil,
} from "Common/Types/PacketCapture/PacketCaptureLimits";

/*
 * Whether this probe may capture packets, and how much, as whoever runs it
 * decided - in the probe's environment, where the dashboard cannot change
 * it:
 *
 *   PROBE_PACKET_CAPTURE_ENABLED=true                  turn captures on (off by default)
 *   PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS=600   lower the longest capture
 *   PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB=10        lower the largest file
 *
 * Off unless it says exactly "true": a capture records the traffic itself,
 * so a probe never starts capturing because of a typo. The maximums can only
 * LOWER the hard ones every probe holds to (Types/PacketCapture/
 * PacketCaptureLimits); a value above them, or one that is not a number,
 * leaves the hard maximum, and one below the minimum is raised to it - with
 * a line in the probe's log either way.
 */

export const PACKET_CAPTURE_ENABLED_ENV_VAR: string =
  "PROBE_PACKET_CAPTURE_ENABLED";

export const PACKET_CAPTURE_MAX_DURATION_ENV_VAR: string =
  "PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS";

export const PACKET_CAPTURE_MAX_FILE_SIZE_ENV_VAR: string =
  "PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB";

export interface PacketCaptureSettings {
  isEnabled: boolean;
  limits: PacketCaptureLimits;
  // What the probe's log should say about values it could not use as given.
  warnings: Array<string>;
}

type Environment = Record<string, string | undefined>;

function readMaximum(data: {
  env: Environment;
  name: string;
  min: number;
  max: number;
  warnings: Array<string>;
}): number {
  const raw: string | undefined = data.env[data.name];

  if (raw === undefined || raw.trim() === "") {
    return data.max;
  }

  const value: number = Number(raw.trim());

  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    data.warnings.push(
      `${data.name}="${raw}" is not a whole number, so the maximum of ${data.max} is used.`,
    );
    return data.max;
  }

  if (value > data.max) {
    data.warnings.push(
      `${data.name}=${value} is above the maximum every probe holds to, so ${data.max} is used.`,
    );
    return data.max;
  }

  if (value < data.min) {
    data.warnings.push(
      `${data.name}=${value} is below the minimum, so ${data.min} is used.`,
    );
    return data.min;
  }

  return value;
}

/*
 * The line the probe logs at startup, so whoever runs it can see whether
 * captures are on without opening the dashboard.
 */
export function describePacketCaptureSettings(
  settings: PacketCaptureSettings,
): string {
  if (!settings.isEnabled) {
    return `Packet capture is off. Set ${PACKET_CAPTURE_ENABLED_ENV_VAR}=true to let the dashboard start packet captures on this probe.`;
  }

  return `Packet capture is on: captures of up to ${PacketCaptureLimitsUtil.describeDuration(settings.limits.maxDurationInSeconds)} and ${settings.limits.maxFileSizeInMB} MB can be started on this probe from the dashboard.`;
}

export function readPacketCaptureSettings(
  env: Environment,
): PacketCaptureSettings {
  const warnings: Array<string> = [];

  const isEnabled: boolean =
    (env[PACKET_CAPTURE_ENABLED_ENV_VAR] || "").trim().toLowerCase() === "true";

  return {
    isEnabled: isEnabled,
    limits: {
      maxDurationInSeconds: readMaximum({
        env: env,
        name: PACKET_CAPTURE_MAX_DURATION_ENV_VAR,
        min: PACKET_CAPTURE_MIN_DURATION_IN_SECONDS,
        max: PACKET_CAPTURE_MAX_DURATION_IN_SECONDS,
        warnings: warnings,
      }),
      maxPackets: HARD_MAX_PACKET_CAPTURE_LIMITS.maxPackets,
      maxFileSizeInMB: readMaximum({
        env: env,
        name: PACKET_CAPTURE_MAX_FILE_SIZE_ENV_VAR,
        min: PACKET_CAPTURE_MIN_FILE_SIZE_IN_MB,
        max: PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB,
        warnings: warnings,
      }),
    },
    warnings: isEnabled ? warnings : [],
  };
}
