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

/*
 * A second, much smaller pair of caps for the Inventory item's `host.ip`
 * descriptive attribute (issue #3866).
 *
 * The caps above are sized for `Host.hostIpAddresses`, a dedicated `text`
 * column that is the lossless record of every address. The Inventory
 * attribute is a different thing: a CMDB summary rendered as one row in a
 * definition list next to a copy button, inside a `jsonb` bag that is
 * merged additively on every reconcile. Ten thousand characters is not an
 * attribute there, it is a wall — and it would push the whole bag out of
 * line in Postgres for no gain.
 *
 * 512 characters holds roughly twenty IPv4 or fourteen IPv6 addresses,
 * which is every real machine's set of interfaces. Truncation still drops
 * whole addresses from the tail, and the full list remains one click away
 * on the host's Network card. For a host that sends `host.ip` as an OTLP
 * array and stays below these caps the two surfaces are byte-identical,
 * which is the property worth keeping.
 *
 * They can diverge for a producer that sends `host.ip` as one
 * comma-separated SCALAR — the `env` detector's only option. The Host
 * column reader (`OtelIngestBaseService.getStringArrayAttribute`) treats
 * that whole string as a single address, while the inventory attribute
 * splits it. Splitting is the more useful reading of the two, and the
 * Host column's behaviour predates this, so the divergence is left alone
 * rather than changing what an existing column stores.
 */
export const MAX_INVENTORY_HOST_IP_ADDRESS_COUNT: number = 32;
export const MAX_INVENTORY_HOST_IP_ADDRESSES_LENGTH: number = 512;

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
 *
 * `options` overrides the caps for callers that store the list somewhere
 * narrower than the Host column — pass
 * `MAX_INVENTORY_HOST_IP_ADDRESS_COUNT` /
 * `MAX_INVENTORY_HOST_IP_ADDRESSES_LENGTH` for the Inventory attribute.
 * Everything else about the result is identical, so a host below both
 * cap sets serializes to the same string either way.
 */
export function normalizeHostIpAddresses(
  ipAddresses: Array<string> | null | undefined,
  options?: {
    maxCount?: number | undefined;
    maxLength?: number | undefined;
  },
): string | null {
  if (!ipAddresses || ipAddresses.length === 0) {
    return null;
  }

  const maxCount: number = options?.maxCount ?? MAX_HOST_IP_ADDRESS_COUNT;
  const maxLength: number = options?.maxLength ?? MAX_HOST_IP_ADDRESSES_LENGTH;

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

    if (serializedLength + lengthWithSeparator > maxLength) {
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

    if (kept.length >= maxCount) {
      break;
    }
  }

  if (kept.length === 0) {
    return null;
  }

  return kept.join(SEPARATOR);
}
