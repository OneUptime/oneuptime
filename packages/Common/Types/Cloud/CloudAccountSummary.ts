/*
 * A cloud account's resources at a glance (CloudAccount.resourceSummary):
 * how many it has, by type and by region, most first. Written by the
 * server whenever the account's resources change, read by its pages.
 */

export interface CloudAccountTypeCount {
  type: string;
  count: number;
}

export interface CloudAccountRegionCount {
  region: string;
  count: number;
}

export interface CloudAccountResourceSummary {
  resourceCount: number;
  types: Array<CloudAccountTypeCount>;
  regions: Array<CloudAccountRegionCount>;
}

// The most entries of each list kept: the rest are counted, not named.
export const CLOUD_ACCOUNT_SUMMARY_MAX_ENTRIES: number = 50;

export function summarizeCloudAccountResources(
  resources: Array<{ type: string; region: string }>,
): CloudAccountResourceSummary {
  return summarizeCloudAccountResourceCounts(
    resources.map(
      (resource: {
        type: string;
        region: string;
      }): CloudAccountResourceCount => {
        return { type: resource.type, region: resource.region, count: 1 };
      },
    ),
  );
}

// How many resources of one type one Region holds, as the database counts them.
export interface CloudAccountResourceCount {
  type: string;
  region: string;
  count: number;
}

/*
 * The summary from counts by type and Region (CloudAccountService counts
 * them in the database, so an account of any size is one small read).
 */
export function summarizeCloudAccountResourceCounts(
  counts: Array<CloudAccountResourceCount>,
): CloudAccountResourceSummary {
  const byType: Map<string, number> = new Map();
  const byRegion: Map<string, number> = new Map();
  let total: number = 0;

  for (const entry of counts) {
    const count: number =
      Number.isFinite(entry.count) && entry.count > 0
        ? Math.floor(entry.count)
        : 0;

    if (count === 0) {
      continue;
    }

    total += count;

    const type: string = entry.type.trim();
    const region: string = entry.region.trim();

    if (type) {
      byType.set(type, (byType.get(type) || 0) + count);
    }

    if (region) {
      byRegion.set(region, (byRegion.get(region) || 0) + count);
    }
  }

  return {
    resourceCount: total,
    types: sortCounts(byType)
      .slice(0, CLOUD_ACCOUNT_SUMMARY_MAX_ENTRIES)
      .map((entry: { value: string; count: number }): CloudAccountTypeCount => {
        return { type: entry.value, count: entry.count };
      }),
    regions: sortCounts(byRegion)
      .slice(0, CLOUD_ACCOUNT_SUMMARY_MAX_ENTRIES)
      .map(
        (entry: { value: string; count: number }): CloudAccountRegionCount => {
          return { region: entry.value, count: entry.count };
        },
      ),
  };
}

function sortCounts(
  counts: Map<string, number>,
): Array<{ value: string; count: number }> {
  return Array.from(counts.entries())
    .map(([value, count]: [string, number]) => {
      return { value, count };
    })
    .sort(
      (
        a: { value: string; count: number },
        b: { value: string; count: number },
      ): number => {
        return b.count - a.count || a.value.localeCompare(b.value);
      },
    );
}

// A stored summary, read back: anything malformed reads as empty.
export function readCloudAccountResourceSummary(
  value: unknown,
): CloudAccountResourceSummary {
  const empty: CloudAccountResourceSummary = {
    resourceCount: 0,
    types: [],
    regions: [],
  };

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return empty;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const count: number = Number(record["resourceCount"]);

  const types: Array<CloudAccountTypeCount> = Array.isArray(record["types"])
    ? ((record["types"] as Array<unknown>)
        .map((entry: unknown): CloudAccountTypeCount | null => {
          const item: Record<string, unknown> =
            entry && typeof entry === "object"
              ? (entry as Record<string, unknown>)
              : {};
          return typeof item["type"] === "string" &&
            Number.isFinite(Number(item["count"]))
            ? { type: item["type"], count: Number(item["count"]) }
            : null;
        })
        .filter((entry: CloudAccountTypeCount | null): boolean => {
          return entry !== null;
        }) as Array<CloudAccountTypeCount>)
    : [];

  const regions: Array<CloudAccountRegionCount> = Array.isArray(
    record["regions"],
  )
    ? ((record["regions"] as Array<unknown>)
        .map((entry: unknown): CloudAccountRegionCount | null => {
          const item: Record<string, unknown> =
            entry && typeof entry === "object"
              ? (entry as Record<string, unknown>)
              : {};
          return typeof item["region"] === "string" &&
            Number.isFinite(Number(item["count"]))
            ? { region: item["region"], count: Number(item["count"]) }
            : null;
        })
        .filter((entry: CloudAccountRegionCount | null): boolean => {
          return entry !== null;
        }) as Array<CloudAccountRegionCount>)
    : [];

  return {
    resourceCount: Number.isFinite(count) && count > 0 ? count : 0,
    types,
    regions,
  };
}
