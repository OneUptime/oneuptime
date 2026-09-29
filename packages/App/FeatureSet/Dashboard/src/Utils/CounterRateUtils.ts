import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";

/*
 * Shared cumulative-counter → per-second-rate math for infrastructure
 * products. Kubernetes uses it for `k8s.node.network.io`, Proxmox for
 * `pve_network_{receive,transmit}_bytes` / `pve_disk_{read,write}_bytes`,
 * Ceph for `ceph_pool_rd/wr[_bytes]`. The product-specific part — how a
 * unique counter series is identified from datapoint attributes — is
 * injected via `getSeriesKey`.
 */

export interface CounterRatePoint {
  x: Date;
  y: number;
}

export interface ComputeCounterRateOptions {
  /*
   * Derives the unique counter-series key for a datapoint from its
   * attributes (e.g. `node|interface` for Kubernetes network IO, the
   * pve `id` label for Proxmox, `pool_id` for Ceph). Return null to
   * skip the datapoint entirely (wrong direction, missing identity).
   */
  getSeriesKey: (attributes: Record<string, unknown>) => string | null;
}

type CounterSample = {
  t: number;
  v: number;
};

const getBucketTimestamp: (p: AggregatedModel) => number = (
  p: AggregatedModel,
): number => {
  const raw: unknown =
    p["timestamp"] !== undefined ? p["timestamp"] : p["time"];
  if (raw instanceof Date) {
    return raw.getTime();
  }
  if (typeof raw === "string" || typeof raw === "number") {
    return new Date(raw).getTime();
  }
  return NaN;
};

/*
 * Convenience series-key builder: joins the given attribute keys'
 * values with `|`. Returns null (skip the point) when every key is
 * empty, so series with no identity never collapse into one bucket.
 */
export const makeSeriesKeyFromAttributes: (
  attributeKeys: Array<string>,
) => (attributes: Record<string, unknown>) => string | null = (
  attributeKeys: Array<string>,
): ((attributes: Record<string, unknown>) => string | null) => {
  return (attributes: Record<string, unknown>): string | null => {
    const parts: Array<string> = attributeKeys.map((key: string): string => {
      return (attributes[key] as string) || "";
    });
    if (
      parts.every((part: string): boolean => {
        return part.length === 0;
      })
    ) {
      return null;
    }
    return parts.join("|");
  };
};

/*
 * Convert a cumulative counter into a per-second rate: delta
 * consecutive buckets per series, clamp counter resets to 0, and sum
 * rates across all series per bucket.
 */
export const computeCounterRate: (
  result: AggregatedResult,
  options: ComputeCounterRateOptions,
) => Array<CounterRatePoint> = (
  result: AggregatedResult,
  options: ComputeCounterRateOptions,
): Array<CounterRatePoint> => {
  const perKey: Map<string, Array<CounterSample>> = new Map();
  for (const p of (result.data || []) as Array<AggregatedModel>) {
    const attrs: Record<string, unknown> =
      (p["attributes"] as Record<string, unknown>) || {};
    const key: string | null = options.getSeriesKey(attrs);
    if (key === null) {
      continue;
    }
    const t: number = getBucketTimestamp(p);
    const v: number = Number(p["value"]);
    if (!Number.isFinite(t) || !Number.isFinite(v)) {
      continue;
    }
    let arr: Array<CounterSample> | undefined = perKey.get(key);
    if (!arr) {
      arr = [];
      perKey.set(key, arr);
    }
    arr.push({ t, v });
  }

  const perBucket: Map<number, number> = new Map();
  for (const arr of perKey.values()) {
    arr.sort((a: CounterSample, b: CounterSample): number => {
      return a.t - b.t;
    });
    for (let i: number = 1; i < arr.length; i++) {
      const prev: CounterSample = arr[i - 1]!;
      const cur: CounterSample = arr[i]!;
      const dtSec: number = (cur.t - prev.t) / 1000;
      if (dtSec <= 0) {
        continue;
      }
      const dv: number = cur.v - prev.v;
      if (!Number.isFinite(dv)) {
        continue;
      }
      const rate: number = Math.max(0, dv) / dtSec;
      perBucket.set(cur.t, (perBucket.get(cur.t) || 0) + rate);
    }
  }

  return Array.from(perBucket.entries())
    .map(([t, y]: [number, number]): CounterRatePoint => {
      return { x: new Date(t), y: y };
    })
    .sort((a: CounterRatePoint, b: CounterRatePoint): number => {
      return a.x.getTime() - b.x.getTime();
    });
};

export default {
  computeCounterRate,
  makeSeriesKeyFromAttributes,
};
