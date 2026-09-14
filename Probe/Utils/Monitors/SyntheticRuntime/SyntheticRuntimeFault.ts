/*
 * A synthetic check has three places it can fail, and only one of them is the
 * tenant's:
 *
 *   1. The probe's own runtime -- launching the browser, opening the internal
 *      controller page, booting the sandbox. Nothing tenant-authored has run
 *      yet and the monitored site has not been contacted.
 *   2. The tenant's script -- it threw, timed out, or returned too much data.
 *   3. The monitored site -- reachable through (2) as a Playwright error.
 *
 * Only (2) and (3) say anything about the tenant's service. (1) is ours, and
 * reporting it as a script error is what makes a probe hiccup look like the
 * customer's page failing: the monitor goes down, an incident opens, and the
 * message they are handed is a Playwright stack trace pointing at an internal
 * `synthetic-runtime.oneuptime.invalid` URL they have never heard of.
 *
 * This error marks case (1) so it can survive the worker IPC boundary (see
 * WorkerProtocol's failure envelope), be logged as our fault rather than
 * theirs, and be retried once before anyone is paged.
 */
export const SYNTHETIC_RUNTIME_FAULT_KIND: "probe-runtime" =
  "probe-runtime" as const;

export type SyntheticRuntimeFaultKind = typeof SYNTHETIC_RUNTIME_FAULT_KIND;

export default class SyntheticRuntimeFault extends Error {
  public readonly kind: SyntheticRuntimeFaultKind =
    SYNTHETIC_RUNTIME_FAULT_KIND;

  /*
   * The underlying Playwright/browser error, kept for the probe's own logs.
   * It is deliberately NOT folded into `message`: `message` is what the tenant
   * reads on their monitor, and it must stay free of internal URLs and
   * internal file paths.
   */
  public readonly internalDetail: string | undefined;

  public constructor(data: { message: string; internalDetail?: unknown }) {
    super(data.message);
    this.name = "SyntheticRuntimeFault";
    this.internalDetail = describeInternalDetail(data.internalDetail);
  }
}

function describeInternalDetail(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value instanceof Error) {
    return value.stack || value.message;
  }
  return String(value);
}

export function isSyntheticRuntimeFault(
  value: unknown,
): value is SyntheticRuntimeFault {
  /*
   * Structural rather than `instanceof`: the fault is re-created from the IPC
   * failure envelope in the parent process, so the constructor identity that
   * threw it in the child is long gone by the time anyone asks.
   */
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === SYNTHETIC_RUNTIME_FAULT_KIND
  );
}
