/*
 * Normalization for the OpenTelemetry `host.ip` resource attribute, which
 * is an ARRAY of every address on every interface — not a single IP.
 *
 * On a Docker host with IPv6 enabled that array grows with the container
 * count: the physical NIC, one address per docker bridge, one per veth,
 * plus an IPv6 link-local per interface. 55 addresses / ~1450 characters
 * has been observed in the wild (issue #3006), and there is no upper
 * bound in the OTel spec.
 *
 * `Host.hostIpAddresses` is a `text` column so the realistic case is
 * stored losslessly. These caps exist only so a pathological (or hostile)
 * collector cannot push an unbounded blob into Postgres on every batch.
 * They sit far above any plausible host, so in practice this function
 * dedupes and joins and nothing else.
 */

/** Maximum number of addresses retained. */
export const MAX_HOST_IP_ADDRESS_COUNT: number = 256;

/** Maximum length of the serialized, comma-separated list. */
export const MAX_HOST_IP_ADDRESSES_LENGTH: number = 10000;

const SEPARATOR: string = ", ";

/**
 * Turn the raw `host.ip` values into the comma-separated string stored in
 * `Host.hostIpAddresses`.
 *
 *   - blank / whitespace-only entries are dropped,
 *   - each entry is trimmed,
 *   - duplicates are removed case-insensitively (IPv6 hex casing is not
 *     stable across resource detectors, so `FE80::1` and `fe80::1` are the
 *     same address),
 *   - source order is preserved — collectors report interfaces in a stable,
 *     meaningful order and reordering would churn the Hosts table column,
 *   - the result is capped by both address count and serialized length.
 *
 * Truncation always drops whole addresses from the tail. A half-written
 * address would be worse than a missing one: it reads as a real address
 * and there is no way for a consumer to tell it was cut.
 *
 * Returns `null` when nothing survives, so callers can leave the column
 * untouched rather than writing an empty string.
 */
export function normalizeHostIpAddresses(
  ipAddresses: Array<string> | null | undefined,
): string | null {
  if (!ipAddresses || ipAddresses.length === 0) {
    return null;
  }

  const seen: Set<string> = new Set<string>();
  const kept: Array<string> = [];
  let serializedLength: number = 0;

  for (const raw of ipAddresses) {
    if (typeof raw !== "string") {
      continue;
    }

    const trimmed: string = raw.trim();
    if (!trimmed) {
      continue;
    }

    const dedupeKey: string = trimmed.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }

    const lengthWithSeparator: number =
      trimmed.length + (kept.length > 0 ? SEPARATOR.length : 0);

    if (serializedLength + lengthWithSeparator > MAX_HOST_IP_ADDRESSES_LENGTH) {
      /*
       * Stop rather than continue: entries are already ordered by the
       * collector, so skipping this one to squeeze in a shorter later one
       * would make the stored list order-dependent on address width.
       */
      break;
    }

    seen.add(dedupeKey);
    kept.push(trimmed);
    serializedLength += lengthWithSeparator;

    if (kept.length >= MAX_HOST_IP_ADDRESS_COUNT) {
      break;
    }
  }

  if (kept.length === 0) {
    return null;
  }

  return kept.join(SEPARATOR);
}
