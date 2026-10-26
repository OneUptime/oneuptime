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

function countBy(values: Array<string>): Array<{ value: string; count: number }> {
  const counts: Map<string, number> = new Map();

  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }

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

export function summarizeCloudAccountResources(
  resources: Array<{ type: string; region: string }>,
): CloudAccountResourceSummary {
  const typed: Array<string> = resources
    .map((resource: { type: string; region: string }): string => {
      return resource.type.trim();
    })
    .filter((type: string): boolean => {
      return type.length > 0;
    });
  const placed: Array<string> = resources
    .map((resource: { type: string; region: string }): string => {
      return resource.region.trim();
    })
    .filter((region: string): boolean => {
      return region.length > 0;
    });

  return {
    resourceCount: resources.length,
    types: countBy(typed)
      .slice(0, CLOUD_ACCOUNT_SUMMARY_MAX_ENTRIES)
      .map((entry: { value: string; count: number }): CloudAccountTypeCount => {
        return { type: entry.value, count: entry.count };
      }),
    regions: countBy(placed)
      .slice(0, CLOUD_ACCOUNT_SUMMARY_MAX_ENTRIES)
      .map(
        (entry: { value: string; count: number }): CloudAccountRegionCount => {
          return { region: entry.value, count: entry.count };
        },
      ),
  };
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
    ? (record["types"] as Array<unknown>)
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
        }) as Array<CloudAccountTypeCount>
    : [];

  const regions: Array<CloudAccountRegionCount> = Array.isArray(
    record["regions"],
  )
    ? (record["regions"] as Array<unknown>)
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
        }) as Array<CloudAccountRegionCount>
    : [];

  return {
    resourceCount: Number.isFinite(count) && count > 0 ? count : 0,
    types,
    regions,
  };
}
