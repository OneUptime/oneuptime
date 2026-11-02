/*
 * THE EXCEPTION EACH FINGERPRINT OF AN OCCURRENCE COUNTS ON.
 *
 * A span, a log, a security event or a session replay names an exception by
 * the fingerprint of its occurrence, and the occurrences of an exception
 * merged into another keep their own (TelemetryExceptionMerge). One request
 * answers for a batch of them (POST /telemetry-exception/by-fingerprints):
 * each fingerprint with the exceptions it counts on - its own, or the one it
 * was merged into - that the reader may read
 * (TelemetryExceptionService.findByOccurrenceFingerprints). Shared by the
 * server, which writes it, and the Dashboard, which reads it back
 * defensively.
 */

// The most fingerprints one request asks about: as many as a session replay's header keeps.
export const MAX_EXCEPTION_FINGERPRINT_LOOKUP: number = 100;

// The longest fingerprint asked about. Ingest's are 64 hexadecimal characters.
export const MAX_EXCEPTION_FINGERPRINT_LENGTH: number = 256;

// One fingerprint asked about, and an exception it counts on.
export interface ExceptionOfFingerprint {
  // The fingerprint asked about, as it was asked.
  fingerprint: string;
  telemetryExceptionId: string;
  exceptionType: string | null;
  message: string | null;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * The answer's entries, in its order, leaving out any that is not one: a
 * fingerprint without an exception, or an exception without an id.
 */
export function readExceptionsOfFingerprints(
  value: unknown,
): Array<ExceptionOfFingerprint> {
  const exceptions: unknown =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)["exceptions"]
      : undefined;

  if (!Array.isArray(exceptions)) {
    return [];
  }

  const read: Array<ExceptionOfFingerprint> = [];

  for (const entry of exceptions) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;
    const fingerprint: string = readText(record["fingerprint"]);
    const telemetryExceptionId: string = readText(
      record["telemetryExceptionId"],
    );

    if (!fingerprint || !telemetryExceptionId) {
      continue;
    }

    read.push({
      fingerprint,
      telemetryExceptionId,
      exceptionType: readText(record["exceptionType"]) || null,
      message: readText(record["message"]) || null,
    });
  }

  return read;
}
