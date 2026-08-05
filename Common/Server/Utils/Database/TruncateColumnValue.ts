import ColumnLength from "../../../Types/Database/ColumnLength";

/*
 * ------------------------------------------------------------------
 * TruncateColumnValue
 *
 * Per-value clamps for bounded varchar columns written by the bulk
 * inventory upsert paths (Kubernetes / Docker / Docker Swarm / Podman /
 * Proxmox / Ceph / IoT).
 *
 * Those services hand-build `INSERT ... ON CONFLICT` statements and
 * flush them in chunks of 500 rows through
 * `getRepository().manager.query(...)`, which bypasses the length
 * validation DatabaseService applies to ordinary CRUD writes. A single
 * value past its column limit raises 22001 ("value too long for type
 * character varying(N)") and aborts the WHOLE multi-row INSERT, so one
 * malformed resource silently drops up to 499 healthy inventory rows
 * with it. Clamping per value keeps the blast radius at one field.
 *
 * Truncation is the last line of defense, not the primary fix: columns
 * that legitimately carry long values (image references, Kubernetes
 * DNS-subdomain names) should be widened in the model + a migration so
 * these clamps effectively never fire.
 * ------------------------------------------------------------------
 */

export function truncateToLength(value: string, maxLength: number): string;
export function truncateToLength(
  value: string | null | undefined,
  maxLength: number,
): string | null;
export function truncateToLength(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value.length <= maxLength) {
    return value;
  }

  const clipped: string = value.substring(0, maxLength);

  /*
   * JS string length counts UTF-16 code units, so a cut at maxLength can
   * land in the middle of a surrogate pair (any astral-plane character:
   * emoji, rare CJK). The orphaned high surrogate is not valid UTF-8 —
   * Node encodes it as U+FFFD on the way to the driver — so drop it.
   * A well-formed string never ends a character on a high surrogate,
   * which makes this check unambiguous. Postgres counts characters, not
   * code units, so clipping by code units is always conservative: the
   * result can only be shorter than the column bound, never longer.
   */
  const lastCodeUnit: number = clipped.charCodeAt(clipped.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    return clipped.substring(0, clipped.length - 1);
  }

  return clipped;
}

/** Clamp to ColumnLength.ShortText — varchar(100). */
export function truncateShortText(value: string): string;
export function truncateShortText(
  value: string | null | undefined,
): string | null;
export function truncateShortText(
  value: string | null | undefined,
): string | null {
  return truncateToLength(value, ColumnLength.ShortText);
}

/** Clamp to ColumnLength.LongText — varchar(500). */
export function truncateLongText(value: string): string;
export function truncateLongText(
  value: string | null | undefined,
): string | null;
export function truncateLongText(
  value: string | null | undefined,
): string | null {
  return truncateToLength(value, ColumnLength.LongText);
}
