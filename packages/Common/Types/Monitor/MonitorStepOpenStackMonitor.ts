import AggregatedResult from "../BaseDatabase/AggregatedResult";
import Dictionary from "../Dictionary";
import { JSONObject } from "../JSON";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import RollingTime from "../RollingTime/RollingTime";

/*
 * The resource attribute the OpenStack agent stamps on every batch, which is
 * what an OpenStack monitor always reads through. One cloud is one Keystone.
 */
export const OPENSTACK_CLOUD_RESOURCE_ATTRIBUTE: string =
  "resource.openstack.cloud.name";

/*
 * The exporter's series do not say which region they are from: the agent reads
 * one clouds.yaml entry per region and its collector stamps this on every
 * datapoint (agents/OpenStackAgent/otel-collector-config.yaml).
 */
export const OPENSTACK_REGION_ATTRIBUTE: string = "openstack.region.name";

/*
 * What an OpenStack monitor can be narrowed to. Each one is equality on the
 * exporter label it maps to, and openstack-exporter does not spell a label the
 * same way on every series: see getOpenStackFilterAttributes.
 */
export interface OpenStackResourceFilters {
  // → `openstack.region.name`, on every series.
  regionName?: string | undefined;
  /*
   * → `availability_zone` on hypervisors, instances, volumes and Neutron agents,
   * and `zone` on Nova's and Cinder's own workers.
   */
  availabilityZone?: string | undefined;
  /*
   * → `hostname` on workers, hypervisors and Placement's providers, and
   * `hypervisor_hostname` on instances. As each series spells it: Nova's workers
   * say the short host name, and hypervisors, Placement and instances the full one.
   */
  hypervisorName?: string | undefined;
  // → `service`: a worker's binary, such as nova-compute or cinder-volume.
  serviceName?: string | undefined;
  /*
   * → `tenant_id` on Nova's and Cinder's series and on Neutron's networks and
   * subnets, and `project_id` on floating IPs, routers and address availability.
   */
  projectId?: string | undefined;
}

/*
 * The labels each filter can read, first choice first. A series carries at most
 * one of each, so its own label list says which applies.
 */
const FILTER_LABELS: ReadonlyArray<{
  filter: keyof OpenStackResourceFilters;
  labels: ReadonlyArray<string>;
}> = [
  { filter: "availabilityZone", labels: ["availability_zone", "zone"] },
  { filter: "hypervisorName", labels: ["hostname", "hypervisor_hostname"] },
  { filter: "serviceName", labels: ["service"] },
  { filter: "projectId", labels: ["tenant_id", "project_id"] },
];

/*
 * `typeof` rather than truthiness: step JSON is not schema-checked, so a filter
 * written by the API or an import can be a number or an object, and neither is an
 * equality a query can run.
 */
function readFilterValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return value.trim() || undefined;
}

/*
 * The equality filters a monitor's resource filters put on one series.
 *
 * The region is on every series. The rest narrow only a series that carries the
 * label, so a project filter does not empty `openstack_nova_up`, which a step needs
 * to tell a part that went away from a cloud that went quiet. A series the catalogue
 * does not know (one someone queries by hand) takes each filter's first label.
 */
export function getOpenStackFilterAttributes(data: {
  resourceFilters: OpenStackResourceFilters | undefined;
  // The labels the series carries; undefined when the catalogue does not know it.
  seriesLabels: ReadonlyArray<string> | undefined;
}): Dictionary<string> {
  const attributes: Dictionary<string> = {};
  const filters: OpenStackResourceFilters = data.resourceFilters || {};
  const regionName: string | undefined = readFilterValue(filters.regionName);

  if (regionName) {
    attributes[OPENSTACK_REGION_ATTRIBUTE] = regionName;
  }

  for (const { filter, labels } of FILTER_LABELS) {
    const value: string | undefined = readFilterValue(filters[filter]);

    if (!value) {
      continue;
    }

    const label: string | undefined = data.seriesLabels
      ? labels.find((candidate: string): boolean => {
          return data.seriesLabels!.includes(candidate);
        })
      : labels[0];

    if (label) {
      attributes[label] = value;
    }
  }

  return attributes;
}

/*
 * The labels one series names differently from the series it has to line up with.
 *
 * A criteria judges one series at a time, and two queries are the same series when
 * their group-by labels match. Whether a network is external is only on
 * `openstack_neutron_network`, which calls its id `id`, and how full it is only on
 * `openstack_neutron_network_ip_availabilities_*`, which call it `network_id`. So
 * this series is grouped by its own label and its rows then carry the common one.
 */
const SERIES_LABEL_ALIASES: Readonly<Dictionary<Readonly<Dictionary<string>>>> =
  {
    openstack_neutron_network: { network_id: "id", network_name: "name" },
  };

// The group-by keys to read one metric by: its own spelling of each.
export function getOpenStackGroupByKeysForMetric(data: {
  metricName: string;
  groupByAttributeKeys: Array<string>;
}): Array<string> {
  const aliases: Readonly<Dictionary<string>> | undefined =
    SERIES_LABEL_ALIASES[data.metricName];

  if (!aliases) {
    return data.groupByAttributeKeys;
  }

  return data.groupByAttributeKeys.map((key: string): string => {
    return aliases[key] || key;
  });
}

// One metric's rows with its own labels copied to the keys the others group by.
export function alignOpenStackSeriesLabels(data: {
  metricName: string;
  aggregatedResult: AggregatedResult;
}): AggregatedResult {
  const aliases: Readonly<Dictionary<string>> | undefined =
    SERIES_LABEL_ALIASES[data.metricName];

  if (!aliases) {
    return data.aggregatedResult;
  }

  for (const row of data.aggregatedResult.data) {
    const attributes: JSONObject | undefined = (row as unknown as JSONObject)[
      "attributes"
    ] as JSONObject | undefined;

    if (!attributes) {
      continue;
    }

    for (const key of Object.keys(aliases)) {
      attributes[key] = attributes[aliases[key]!]!;
    }
  }

  return data.aggregatedResult;
}

export default interface MonitorStepOpenStackMonitor {
  // The `openstack.cloud.name` the agent stamps, which is OpenStackCloud.name.
  cloudIdentifier: string;
  /*
   * The cloud's row id. Bound on every write and read by the worker, so a rename
   * keeps the monitor on its cloud (InfrastructureResourceBinding).
   */
  resourceId?: string | undefined;
  resourceFilters: OpenStackResourceFilters;
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
}

export class MonitorStepOpenStackMonitorUtil {
  public static getDefault(): MonitorStepOpenStackMonitor {
    return {
      cloudIdentifier: "",
      resourceFilters: {},
      metricViewConfig: {
        queryConfigs: [],
        formulaConfigs: [],
      },
      /*
       * The agent collects compute, network, volume and placement every 2
       * minutes and identity and image every 5, so anything shorter than 15
       * minutes holds too few collections of something for "All Values" to mean
       * a duration.
       */
      rollingTime: RollingTime.Past15Minutes,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepOpenStackMonitor {
    return json as any as MonitorStepOpenStackMonitor;
  }

  public static toJSON(monitor: MonitorStepOpenStackMonitor): JSONObject {
    return monitor as any as JSONObject;
  }
}
