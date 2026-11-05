import { JSONArray, JSONObject } from "../JSON";
import {
  OPENSTACK_HOST_FAILURE_RESOURCE_CLASSES,
  OpenStackCapacityResource,
  OpenStackHostFailureResource,
} from "./OpenStackCapacity";
import {
  OPENSTACK_CAPACITY_RESOURCE_IPV4,
  OPENSTACK_CAPACITY_RESOURCE_STORAGE_BYTES,
  OpenStackCapacityFlavorRow,
  OpenStackCapacityForecastRow,
  OpenStackCapacityForecastScope,
  OpenStackCapacityPool,
  OpenStackCapacitySnapshot,
  OpenStackCapacityZone,
  isOpenStackFlavorOffered,
} from "./OpenStackCapacitySnapshot";
import { OpenStackServiceType } from "./OpenStackResourceKind";

/*
 * WHAT THE ALERT TEMPLATES READ, WRITTEN FROM THE SNAPSHOT.
 *
 * Whether a flavor fits, whether a zone can lose a host and when something fills up take every
 * host and flavor to work out, and no series a cloud sends says any of it: no exporter series has a
 * zone or a flavor's count in it. So OneUptime writes these itself from each cloud's snapshot, on
 * the Placement scrape's two minutes, through the same ingest as everything else, so its bill and
 * retention are the cloud's. They stop when the cloud stops reporting, so silence stays silence.
 *
 * Only what can be said is written. A forecast with not enough history has no series, and a flavor
 * too large for every host has none, because nothing can ever change about it: a template compares
 * what is there, and a series that goes away reads as recovered.
 */
export const OPENSTACK_CAPACITY_ALLOCATED_SERIES: string =
  "openstack_capacity_allocated";
export const OPENSTACK_CAPACITY_TOTAL_SERIES: string =
  "openstack_capacity_total";
export const OPENSTACK_CAPACITY_DAYS_UNTIL_FULL_SERIES: string =
  "openstack_capacity_days_until_full";
export const OPENSTACK_CAPACITY_FLAVOR_FITS_SERIES: string =
  "openstack_capacity_flavor_fits";
export const OPENSTACK_CAPACITY_CAN_LOSE_A_HOST_SERIES: string =
  "openstack_capacity_can_lose_a_host";

// What one forecast's series are told apart by.
export const OPENSTACK_CAPACITY_SCOPE_LABEL: string = "capacity_scope";
export const OPENSTACK_CAPACITY_NAME_LABEL: string = "capacity_name";
export const OPENSTACK_CAPACITY_ID_LABEL: string = "capacity_id";
export const OPENSTACK_CAPACITY_RESOURCE_LABEL: string = "resourcetype";

export const OPENSTACK_CAPACITY_SERIES_LABELS: ReadonlyArray<string> = [
  OPENSTACK_CAPACITY_SCOPE_LABEL,
  OPENSTACK_CAPACITY_NAME_LABEL,
  OPENSTACK_CAPACITY_ID_LABEL,
  OPENSTACK_CAPACITY_RESOURCE_LABEL,
];

const SCOPE_NAME: string = "oneuptime-openstack-capacity";

function attribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

interface Labels {
  regionName: string | null;
  labels: Record<string, string | null>;
}

function dataPoint(data: Labels & { value: number; now: Date }): JSONObject {
  const attributes: Array<JSONObject> = [];

  for (const key of Object.keys(data.labels)) {
    const value: string | null = data.labels[key] as string | null;

    // An empty label is no label: what the collector does, and what a query reads back as "".
    if (value) {
      attributes.push(attribute(key, value));
    }
  }

  if (data.regionName) {
    attributes.push(attribute("openstack.region.name", data.regionName));
  }

  attributes.push(
    attribute("openstack_service", OpenStackServiceType.Placement),
  );

  return {
    attributes,
    timeUnixNano: `${data.now.getTime()}000000`,
    asDouble: data.value,
  };
}

/*
 * What a forecast reads back, and how it finds its way home: one key per thing that fills up. The
 * series are written with these and history is read by them, so the two can't disagree.
 */
export function getOpenStackCapacitySeriesKey(data: {
  regionName: string | null;
  scope: string | null;
  name: string | null;
  id: string | null;
  resourceClass: string | null;
}): string {
  return JSON.stringify([
    data.regionName || "",
    data.scope || "",
    data.name || "",
    data.id || "",
    data.resourceClass || "",
  ]);
}

export interface OpenStackCapacitySeriesRow {
  key: string;
  regionName: string | null;
  scope: OpenStackCapacityForecastScope;
  name: string;
  id: string;
  resourceClass: string;
  allocated: number;
  capacity: number;
}

/*
 * Everything a snapshot says fills up. Allocated counts what lost and disabled hosts hold, because
 * those instances exist: so a host going away doesn't read as a cloud shrinking, and what counts
 * it out is capacity, which only ever counts what can give.
 */
export function getOpenStackCapacitySeriesRows(
  snapshot: Pick<OpenStackCapacitySnapshot, "zones" | "pools">,
): Array<OpenStackCapacitySeriesRow> {
  const rows: Array<OpenStackCapacitySeriesRow> = [];

  for (const zone of snapshot.zones as Array<OpenStackCapacityZone>) {
    for (const resource of zone.resources as Array<OpenStackCapacityResource>) {
      rows.push({
        key: getOpenStackCapacitySeriesKey({
          regionName: zone.regionName,
          scope: "zone",
          name: zone.name,
          id: "",
          resourceClass: resource.resourceClass,
        }),
        regionName: zone.regionName,
        scope: "zone",
        name: zone.name,
        id: "",
        resourceClass: resource.resourceClass,
        allocated: resource.used + resource.usedOnOtherHosts,
        capacity: resource.capacity,
      });
    }
  }

  for (const pool of snapshot.pools as Array<OpenStackCapacityPool>) {
    const resourceClass: string =
      pool.kind === "external-ip-pool"
        ? OPENSTACK_CAPACITY_RESOURCE_IPV4
        : OPENSTACK_CAPACITY_RESOURCE_STORAGE_BYTES;

    rows.push({
      key: getOpenStackCapacitySeriesKey({
        regionName: pool.regionName,
        scope: pool.kind,
        name: pool.name,
        id: pool.id,
        resourceClass,
      }),
      regionName: pool.regionName,
      scope: pool.kind,
      name: pool.name,
      id: pool.id,
      resourceClass,
      allocated: pool.used,
      capacity: pool.capacity,
    });
  }

  return rows;
}

/*
 * Whether Flavor Can No Longer Be Placed has a say in this flavor. Not one nobody can ask for, not
 * one too large for every host, which was never going to be placed, and not one whose only room is
 * on a host someone disabled: planned work never pages.
 */
export function isOpenStackFlavorWatched(
  flavor: OpenStackCapacityFlavorRow,
): boolean {
  return (
    isOpenStackFlavorOffered(flavor) &&
    !flavor.isTooLargeForEveryHost &&
    !flavor.isOnlyOnDisabledHosts
  );
}

export function buildOpenStackCapacityResourceMetrics(data: {
  cloudName: string;
  now: Date;
  snapshot: OpenStackCapacitySnapshot;
}): JSONArray {
  const { snapshot, now } = data;

  const scopeLabels: (row: {
    scope: string;
    name: string;
    id: string;
    resourceClass: string;
  }) => Record<string, string | null> = (row: {
    scope: string;
    name: string;
    id: string;
    resourceClass: string;
  }): Record<string, string | null> => {
    return {
      [OPENSTACK_CAPACITY_SCOPE_LABEL]: row.scope,
      [OPENSTACK_CAPACITY_NAME_LABEL]: row.name,
      [OPENSTACK_CAPACITY_ID_LABEL]: row.id,
      [OPENSTACK_CAPACITY_RESOURCE_LABEL]: row.resourceClass,
    };
  };

  const rows: Array<OpenStackCapacitySeriesRow> =
    getOpenStackCapacitySeriesRows(snapshot);

  const allocated: Array<JSONObject> = rows.map(
    (row: OpenStackCapacitySeriesRow): JSONObject => {
      return dataPoint({
        regionName: row.regionName,
        labels: scopeLabels(row),
        value: row.allocated,
        now,
      });
    },
  );

  const total: Array<JSONObject> = rows.map(
    (row: OpenStackCapacitySeriesRow): JSONObject => {
      return dataPoint({
        regionName: row.regionName,
        labels: scopeLabels(row),
        value: row.capacity,
        now,
      });
    },
  );

  const daysUntilFull: Array<JSONObject> = [];

  for (const row of snapshot.forecasts as Array<OpenStackCapacityForecastRow>) {
    const days: number | null =
      row.forecast.state === "full"
        ? 0
        : row.forecast.state === "days"
          ? row.forecast.days
          : null;

    if (days !== null) {
      daysUntilFull.push(
        dataPoint({
          regionName: row.regionName,
          labels: scopeLabels({
            scope: row.scope,
            name: row.name,
            id: row.id,
            resourceClass: row.resourceClass,
          }),
          value: days,
          now,
        }),
      );
    }
  }

  const flavorFits: Array<JSONObject> = snapshot.flavors
    .filter(isOpenStackFlavorWatched)
    .map((flavor: OpenStackCapacityFlavorRow): JSONObject => {
      return dataPoint({
        regionName: flavor.regionName,
        labels: {
          flavor_id: flavor.id,
          flavor: flavor.name,
          source: flavor.source,
        },
        value: flavor.fits,
        now,
      });
    });

  const canLoseAHost: Array<JSONObject> = [];

  for (const zone of snapshot.zones as Array<OpenStackCapacityZone>) {
    if (
      zone.headroom.state !== "can-lose-a-host" &&
      zone.headroom.state !== "cannot-lose-a-host"
    ) {
      continue;
    }

    for (const resource of zone.headroom
      .resources as Array<OpenStackHostFailureResource>) {
      if (
        OPENSTACK_HOST_FAILURE_RESOURCE_CLASSES.includes(resource.resourceClass)
      ) {
        canLoseAHost.push(
          dataPoint({
            regionName: zone.regionName,
            labels: {
              availability_zone: zone.name,
              [OPENSTACK_CAPACITY_RESOURCE_LABEL]: resource.resourceClass,
            },
            value: resource.shortBy > 0 ? 0 : 1,
            now,
          }),
        );
      }
    }
  }

  const gauge: (
    name: string,
    description: string,
    points: Array<JSONObject>,
  ) => JSONObject = (
    name: string,
    description: string,
    points: Array<JSONObject>,
  ): JSONObject => {
    return { name, description, gauge: { dataPoints: points } };
  };

  const metrics: Array<JSONObject> = [
    gauge(
      OPENSTACK_CAPACITY_ALLOCATED_SERIES,
      "What is allocated of what fills up: a zone's resource class, an external network's IPv4 addresses, or a storage pool's bytes.",
      allocated,
    ),
    gauge(
      OPENSTACK_CAPACITY_TOTAL_SERIES,
      "What can be allocated of it, from the hosts that can give.",
      total,
    ),
    gauge(
      OPENSTACK_CAPACITY_DAYS_UNTIL_FULL_SERIES,
      "How many days until it is full, at its growth over the last week. Absent with too little history to tell.",
      daysUntilFull,
    ),
    gauge(
      OPENSTACK_CAPACITY_FLAVOR_FITS_SERIES,
      "How many more of a flavor fit, counted host by host.",
      flavorFits,
    ),
    gauge(
      OPENSTACK_CAPACITY_CAN_LOSE_A_HOST_SERIES,
      "1 when a zone could lose its largest host and still fit what runs on it.",
      canLoseAHost,
    ),
  ].filter((metric: JSONObject): boolean => {
    return (
      ((metric["gauge"] as JSONObject)["dataPoints"] as Array<JSONObject>)
        .length > 0
    );
  });

  if (metrics.length === 0) {
    return [];
  }

  return [
    {
      resource: {
        attributes: [attribute("openstack.cloud.name", data.cloudName)],
      },
      scopeMetrics: [{ scope: { name: SCOPE_NAME }, metrics }],
    },
  ];
}
