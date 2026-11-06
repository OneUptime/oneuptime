import { JSONObject, JSONValue } from "../JSON";
import { isOpenStackQuotaAtLine, percentOf } from "./OpenStackHealthRules";

/*
 * WHAT A PROJECT MAY USE AND HAS USED, AS ITS KEYSTONE ROW HOLDS IT.
 *
 * The exporter reads these once per project on every scrape, so the agent leaves them
 * off by default and most clouds have none. Pure, so the scan that writes them, the
 * rules that judge them and the pages that show them all read one shape.
 *
 * One fact per resource per region, because a quota belongs to a region's Nova, Cinder
 * or Neutron and a project row belongs to the whole cloud, and because `facts` merges
 * key by key: each service's scrape arrives alone, so a single `quota` fact would be
 * replaced whole by whichever arrived last.
 */

export enum OpenStackQuotaResource {
  Instances = "instances",
  Cores = "cores",
  RamMib = "ramMib",
  Gigabytes = "gigabytes",
  Networks = "networks",
  Ports = "ports",
  FloatingIps = "floatingIps",
}

// In the order a person reads them, what a project runs before what it runs on.
export const OPENSTACK_QUOTA_RESOURCES: ReadonlyArray<OpenStackQuotaResource> =
  [
    OpenStackQuotaResource.Instances,
    OpenStackQuotaResource.Cores,
    OpenStackQuotaResource.RamMib,
    OpenStackQuotaResource.Gigabytes,
    OpenStackQuotaResource.Networks,
    OpenStackQuotaResource.Ports,
    OpenStackQuotaResource.FloatingIps,
  ];

export const OPENSTACK_QUOTA_FACT_PREFIX: string = "quota:";

/*
 * Three readings of an hourly scrape, the slowest anyone is likely to give these. Past
 * this nobody is reading them any more, usually because someone turned them off again,
 * and facts are never deleted: without this a project would stay at its quota for good.
 */
export const OPENSTACK_QUOTA_STALE_MINUTES: number = 180;

// The region a reading from a scrape that named none is filed under, as `regional` does.
const NO_REGION: string = "default";

export function getOpenStackQuotaFactKey(
  resource: OpenStackQuotaResource,
  regionName: string | null | undefined,
): string {
  return `${OPENSTACK_QUOTA_FACT_PREFIX}${resource}:${regionName || NO_REGION}`;
}

export interface OpenStackProjectQuota {
  resource: OpenStackQuotaResource;
  regionName: string;
  used: number;
  // -1 means no limit.
  limit: number;
  // Null with no limit to be a share of.
  percent: number | null;
  isAtLine: boolean;
  observedAt: Date | null;
  // Read too long ago to say anything about now: see OPENSTACK_QUOTA_STALE_MINUTES.
  isStale: boolean;
}

function isResource(value: string): value is OpenStackQuotaResource {
  return (OPENSTACK_QUOTA_RESOURCES as ReadonlyArray<string>).includes(value);
}

function finiteNumber(value: JSONValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/*
 * The readings a project row holds, in OPENSTACK_QUOTA_RESOURCES order, then by region.
 * Anything that is not a whole reading is left out rather than guessed at: a page saying
 * nothing about a quota is right, and a page saying "0 of 0" is not.
 */
export function getOpenStackProjectQuotas(
  facts: JSONObject | null | undefined,
  now: Date,
): Array<OpenStackProjectQuota> {
  const quotas: Array<OpenStackProjectQuota> = [];

  for (const key of Object.keys(facts || {})) {
    if (!key.startsWith(OPENSTACK_QUOTA_FACT_PREFIX)) {
      continue;
    }

    const rest: string = key.substring(OPENSTACK_QUOTA_FACT_PREFIX.length);
    const separator: number = rest.indexOf(":");
    if (separator <= 0) {
      continue;
    }

    const resource: string = rest.substring(0, separator);
    const reading: JSONValue | undefined = facts?.[key];
    if (
      !isResource(resource) ||
      !reading ||
      typeof reading !== "object" ||
      Array.isArray(reading)
    ) {
      continue;
    }

    const used: number | null = finiteNumber((reading as JSONObject)["used"]);
    const limit: number | null = finiteNumber((reading as JSONObject)["limit"]);
    if (used === null || limit === null) {
      continue;
    }

    const observedAtText: JSONValue | undefined = (reading as JSONObject)[
      "observedAt"
    ];
    const observedAt: Date | null =
      typeof observedAtText === "string" ? new Date(observedAtText) : null;
    const hasObservedAt: boolean = Boolean(
      observedAt && !isNaN(observedAt.getTime()),
    );
    const isStale: boolean =
      !hasObservedAt ||
      now.getTime() - observedAt!.getTime() >
        OPENSTACK_QUOTA_STALE_MINUTES * 60 * 1000;

    quotas.push({
      resource,
      regionName: rest.substring(separator + 1),
      used,
      limit,
      percent: percentOf(used, limit),
      isAtLine: !isStale && isOpenStackQuotaAtLine({ used, limit }),
      observedAt: hasObservedAt ? observedAt : null,
      isStale,
    });
  }

  return quotas.sort(
    (first: OpenStackProjectQuota, second: OpenStackProjectQuota): number => {
      return (
        OPENSTACK_QUOTA_RESOURCES.indexOf(first.resource) -
          OPENSTACK_QUOTA_RESOURCES.indexOf(second.resource) ||
        first.regionName.localeCompare(second.regionName)
      );
    },
  );
}

/*
 * What a project row needs for the SQL to pick it: the same line as
 * isOpenStackQuotaAtLine, over every fact, on a fresh reading. Each number is checked
 * to be one before it is cast, because one bad value must not fail a whole page.
 */
export function getOpenStackQuotaAtLineSql(data: {
  linePercent: number;
  observedSinceParam: string;
}): string {
  return `EXISTS (
    SELECT 1 FROM jsonb_each("facts") AS fact
    WHERE fact.key LIKE '${OPENSTACK_QUOTA_FACT_PREFIX}%'
      AND CASE
        WHEN jsonb_typeof(fact.value) = 'object'
          AND jsonb_typeof(fact.value->'used') = 'number'
          AND jsonb_typeof(fact.value->'limit') = 'number'
          AND jsonb_typeof(fact.value->'observedAt') = 'string'
        THEN (fact.value->>'limit')::numeric > 0
          AND (fact.value->>'used')::numeric * 100 >= (fact.value->>'limit')::numeric * ${data.linePercent}
          AND fact.value->>'observedAt' >= ${data.observedSinceParam}
        ELSE FALSE
      END
  )`;
}
