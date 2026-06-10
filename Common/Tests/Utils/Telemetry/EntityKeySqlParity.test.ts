import { keyForHost } from "../../../Utils/Telemetry/EntityKey";
import { describe, expect, test } from "@jest/globals";

/*
 * Pins keyForHost against the ClickHouse SQL formula used by the
 * RekeyMetricHostRollupToEntityKey migration to backfill
 * MetricItemAggMV1mByHostV2 from the old hostIdentifier-keyed rollup:
 *
 *   substring(lower(hex(SHA256(concat(
 *     projectId, '|host|host.name=', lower(trimBoth(hostIdentifier))
 *   )))), 1, 16)
 *
 * The expected values below are the literal outputs of that SQL run on a
 * live ClickHouse (25.7) — if keyForHost's canonicalization, preimage
 * layout, hash, or slice length ever drifts, this fails loudly and the
 * backfilled rollup rows stop matching ingest-stamped hostEntityKeys.
 *
 * (Hostnames containing '\\', '|' or '=' are escaped by keyForHost but
 * not by the SQL — a documented, vanishingly-rare caveat of the backfill,
 * deliberately not pinned here.)
 */
describe("keyForHost — parity with the migration's SQL key computation", () => {
  test("matches ClickHouse-computed keys for representative hostnames", () => {
    // [projectId, raw hostIdentifier, SQL-computed key from live ClickHouse]
    const vectors: Array<[string, string, string]> = [
      // Mixed case + trailing whitespace exercise canonicalization.
      ["proj-123", "Web-Server-01 ", "dba90fb9cca1242e"],
      [
        "8f3c2a1e-0000-4a4a-9c9c-aabbccddeeff",
        "ip-10-0-1-23.ec2.internal",
        "7f5d90eeeeb0b48b",
      ],
      ["proj-xyz", "NODE.example.COM", "8825a6c0687b16d9"],
    ];

    for (const [projectId, hostIdentifier, sqlKey] of vectors) {
      expect(keyForHost(projectId, hostIdentifier)).toBe(sqlKey);
    }
  });
});
