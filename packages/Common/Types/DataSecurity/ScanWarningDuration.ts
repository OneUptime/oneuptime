/*
 * A SCAN WARNING'S DURATION, AS A SCAN STORES IT (#10930).
 *
 * A scan writes each of its warnings in English and stores it with the scan
 * (ScanWarnings' writeScanWarning): a duration in it is "2 minutes" or "6
 * seconds", whole minutes as minutes and anything else as seconds. That
 * English is read as it was written: by the API, the MCP server and
 * OneUptime AI, and by the Dashboard, which matches the sentence back to its
 * template and the duration back to milliseconds here, then draws it in the
 * reader's words with the number held to its unit (formatScanDuration). So
 * it keeps the plain space every warning stored before was written with,
 * which the reading back matches; NumbersKeepTheirUnitsInCodeGuard lists
 * this file for it. The writer, the reader and a template's pattern are kept
 * here together, as they must agree.
 */

/*
 * "2 minutes", "6 seconds": a duration as a warning writes it in English,
 * whole minutes as minutes and anything else as seconds, at least one.
 */
export function describeScanDuration(milliseconds: number): string {
  const seconds: number = Math.max(1, Math.round(milliseconds / 1000));

  if (seconds % 60 === 0) {
    const minutes: number = seconds / 60;

    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }

  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

// A duration as describeScanDuration wrote it, back in milliseconds; null for anything else.
export function readScanDuration(text: string): number | null {
  const match: RegExpMatchArray | null = text.match(
    /^([0-9]{1,9}) (second|seconds|minute|minutes)$/,
  );

  if (!match) {
    return null;
  }

  const amount: number = Number(match[1]);

  return match[2]!.startsWith("minute") ? amount * 60_000 : amount * 1000;
}

// A duration in a template's pattern: what describeScanDuration writes, captured whole.
export const SCAN_DURATION_PATTERN: string =
  "([0-9]{1,9} (?:seconds|second|minutes|minute))";
