import Includes from "../../Types/BaseDatabase/Includes";
import Wildcard from "../../Types/BaseDatabase/Wildcard";
import {
  hasWildcard,
  unescapeWildcards,
} from "../../Types/BaseDatabase/WildcardPattern";
import Dictionary from "../../Types/Dictionary";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorType from "../../Types/Monitor/MonitorType";
import { JOURNALD_SYSTEMD_UNIT_ATTRIBUTE } from "../HostCollector/HostCollectorDefaultConfig";
import { readOwnValue, writeOwnValue } from "../LookupTable";

/*
 * WHAT A RESOURCE MONITOR'S LOGS AND TRACES ARE (#10451).
 *
 * A Host, Docker, Podman or IoT Device monitor reads one resource's metrics:
 * the worker narrows each query to its host (resource.host.name), a Docker
 * or Podman host's containers (their runtime, and the monitor's container
 * filters) or an IoT fleet (resource.iot.fleet.name, and the device
 * filters). An incident or alert it opens links to the logs and the traces
 * around the breach. Those links used to carry the metric's own attributes:
 * a Windows service's `name`, a systemd unit's `systemd.unit.active_state`,
 * a disk's `device`, a CPU's `state`. No log line or span carries them (in a
 * traces search `name` is the span's name), so the logs link of a Windows
 * service's incident asked for logs whose own `name` is the service, and
 * neither link named the host.
 *
 * A resource's logs and traces are what its own Logs and Traces pages show,
 * and the links now keep, of what the monitor read, what those pages filter
 * by:
 *
 *              logs                                  traces
 *   Host       resource.host.name                    resource.host.name
 *              systemd.unit.name (a systemd unit's)
 *   Docker     resource.host.name,                   resource.host.name
 *              resource.container.runtime
 *   Podman     resource.host.name,                   resource.host.name
 *              resource.container.runtime
 *   IoT        resource.iot.fleet.name               resource.iot.fleet.name
 *
 * A systemd unit's journal lines name the unit (systemd.unit.name), by the
 * name the systemd receiver gives its state (resource.systemd.unit.name), so
 * a unit's logs are its lines on its host (HostCollectorDefaultConfig, as
 * the unit's own page reads them). Nothing a Windows service writes names
 * it, so its logs are its host's.
 *
 * A container's name and image are on its metrics only - the agents'
 * filelog receiver writes a line's container id, and an application's span
 * carries its own resource - and so are an IoT device's id and type. A link
 * cannot narrow to them, and says so (notCarried). The metric's other
 * attributes describe the metric, not the resource, and are left out.
 *
 * A Metrics monitor is none of these: a span-derived metric shares its
 * spans' attributes, so its links keep the metric's own (getScope is null).
 *
 * Pure: the evaluator builds the links with it, and its tests read it.
 */

export enum ResourceSignal {
  Logs = "Logs",
  Traces = "Traces",
}

export interface ResourceSignalScope {
  // The signal's attribute filters, as it stores them.
  attributes: Dictionary<string>;
  /*
   * The metric attributes the monitor narrowed its reads by that the signal
   * cannot: a container's name, an IoT device's id. Each once, in the
   * order they were found.
   */
  notCarried: Array<string>;
}

interface ResourceSignalDefinition {
  /*
   * What the worker adds to every query it reads for the step, from the
   * step (monitorHost, monitorDocker, monitorPodman, monitorIoT): what a
   * read says of the resource when the read itself is not at hand.
   */
  getStepScope: (monitorStep: MonitorStep | undefined) => Dictionary<string>;
  // For each signal: metric attribute -> the signal's attribute.
  carried: Record<ResourceSignal, Dictionary<string>>;
  // The narrowing neither signal carries.
  metricsOnly: Array<string>;
}

export const HOST_NAME_ATTRIBUTE: string = "resource.host.name";
export const CONTAINER_RUNTIME_ATTRIBUTE: string = "resource.container.runtime";
export const CONTAINER_NAME_ATTRIBUTE: string = "resource.container.name";
export const CONTAINER_IMAGE_ATTRIBUTE: string =
  "resource.container.image.name";
export const SYSTEMD_UNIT_METRIC_ATTRIBUTE: string =
  "resource.systemd.unit.name";
export const IOT_FLEET_ATTRIBUTE: string = "resource.iot.fleet.name";
export const IOT_DEVICE_ID_ATTRIBUTE: string = "device.id";
export const IOT_DEVICE_TYPE_ATTRIBUTE: string = "iot.device.type";

const trimmed: (value: unknown) => string = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

// The filters a step sets, its blank ones left out.
const setFilters: (filters: Dictionary<unknown>) => Dictionary<string> = (
  filters: Dictionary<unknown>,
): Dictionary<string> => {
  const scope: Dictionary<string> = {};

  for (const key of Object.keys(filters)) {
    const value: string = trimmed(filters[key]);

    if (value) {
      scope[key] = value;
    }
  }

  return scope;
};

const containerHostDefinition: (runtime: string) => ResourceSignalDefinition = (
  runtime: string,
): ResourceSignalDefinition => {
  return {
    getStepScope: (
      monitorStep: MonitorStep | undefined,
    ): Dictionary<string> => {
      const config:
        | {
            hostIdentifier?: string | undefined;
            containerFilters?:
              | {
                  containerName?: string | undefined;
                  containerImage?: string | undefined;
                }
              | undefined;
          }
        | undefined =
        runtime === "docker"
          ? monitorStep?.data?.dockerMonitor
          : monitorStep?.data?.podmanMonitor;

      return setFilters({
        [HOST_NAME_ATTRIBUTE]: config?.hostIdentifier,
        // Read for every step, whatever it names.
        [CONTAINER_RUNTIME_ATTRIBUTE]: runtime,
        [CONTAINER_NAME_ATTRIBUTE]: config?.containerFilters?.containerName,
        [CONTAINER_IMAGE_ATTRIBUTE]: config?.containerFilters?.containerImage,
      });
    },
    carried: {
      // The host's Docker or Podman Logs page: the host, and its runtime.
      [ResourceSignal.Logs]: {
        [HOST_NAME_ATTRIBUTE]: HOST_NAME_ATTRIBUTE,
        [CONTAINER_RUNTIME_ATTRIBUTE]: CONTAINER_RUNTIME_ATTRIBUTE,
      },
      // No application writes the runtime: its Traces page reads the host.
      [ResourceSignal.Traces]: {
        [HOST_NAME_ATTRIBUTE]: HOST_NAME_ATTRIBUTE,
      },
    },
    metricsOnly: [CONTAINER_NAME_ATTRIBUTE, CONTAINER_IMAGE_ATTRIBUTE],
  };
};

const DEFINITIONS: Partial<Record<MonitorType, ResourceSignalDefinition>> = {
  [MonitorType.Host]: {
    getStepScope: (
      monitorStep: MonitorStep | undefined,
    ): Dictionary<string> => {
      return setFilters({
        [HOST_NAME_ATTRIBUTE]: monitorStep?.data?.hostMonitor?.hostIdentifier,
      });
    },
    carried: {
      [ResourceSignal.Logs]: {
        [HOST_NAME_ATTRIBUTE]: HOST_NAME_ATTRIBUTE,
        [SYSTEMD_UNIT_METRIC_ATTRIBUTE]: JOURNALD_SYSTEMD_UNIT_ATTRIBUTE,
      },
      [ResourceSignal.Traces]: {
        [HOST_NAME_ATTRIBUTE]: HOST_NAME_ATTRIBUTE,
      },
    },
    metricsOnly: [],
  },
  [MonitorType.Docker]: containerHostDefinition("docker"),
  [MonitorType.Podman]: containerHostDefinition("podman"),
  [MonitorType.IoTDevice]: {
    getStepScope: (
      monitorStep: MonitorStep | undefined,
    ): Dictionary<string> => {
      return setFilters({
        [IOT_FLEET_ATTRIBUTE]: monitorStep?.data?.iotMonitor?.fleetIdentifier,
        [IOT_DEVICE_ID_ATTRIBUTE]:
          monitorStep?.data?.iotMonitor?.resourceFilters?.deviceId,
        [IOT_DEVICE_TYPE_ATTRIBUTE]:
          monitorStep?.data?.iotMonitor?.resourceFilters?.deviceType,
      });
    },
    carried: {
      [ResourceSignal.Logs]: { [IOT_FLEET_ATTRIBUTE]: IOT_FLEET_ATTRIBUTE },
      [ResourceSignal.Traces]: { [IOT_FLEET_ATTRIBUTE]: IOT_FLEET_ATTRIBUTE },
    },
    metricsOnly: [IOT_DEVICE_ID_ATTRIBUTE, IOT_DEVICE_TYPE_ATTRIBUTE],
  },
};

/*
 * One attribute filter's value as the one value a link can carry: a name,
 * a number, a list of one, or a glob that holds no wildcard (the IoT fleet
 * is read case aside, as an escaped glob of its name). Null for anything
 * that matches more than one value, which no exact filter says.
 */
const readSingleValue: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (typeof value === "string") {
    return value.trim() ? value : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value instanceof Includes) {
    return value.values.length === 1 ? readSingleValue(value.values[0]) : null;
  }

  if (value instanceof Wildcard) {
    const glob: string = String(value.values.length === 1 ? value.value : "");

    return glob && !hasWildcard(glob)
      ? readSingleValue(unescapeWildcards(glob))
      : null;
  }

  return null;
};

// Whether an attribute filter holds anything at all.
const isSet: (value: unknown) => boolean = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (value instanceof Includes) {
    return value.values.length > 0;
  }

  return true;
};

export default class MonitorResourceSignalScope {
  // Whether a monitor of this type reads one resource's metrics (above).
  public static isResourceMonitorType(
    monitorType: MonitorType | undefined,
  ): boolean {
    return Boolean(monitorType && DEFINITIONS[monitorType]);
  }

  /*
   * A resource monitor's logs or traces (above), from what it read, the
   * most exact last: the compared query's own attribute filters, what the
   * worker adds to them for the step (its host, runtime and container
   * filters, its fleet and device filters), what the worker says it read
   * the query with (both of those, by the resource's value when it read: a
   * renamed host is read by its new name), and the labels of the series
   * that breached, which name one host of the several a grouped monitor
   * reads. Null for a monitor of any other type.
   */
  public static getScope(input: {
    monitorType: MonitorType | undefined;
    monitorStep?: MonitorStep | undefined;
    signal: ResourceSignal;
    // The compared query's own attribute filters.
    queryAttributes?: Dictionary<unknown> | undefined;
    // The breaching series' labels, for a grouped monitor.
    seriesLabels?: Dictionary<unknown> | undefined;
    // What the worker read each query compared with: one, or a formula's every one.
    readAttributes?: Array<Dictionary<unknown> | undefined> | undefined;
  }): ResourceSignalScope | null {
    const definition: ResourceSignalDefinition | undefined = input.monitorType
      ? DEFINITIONS[input.monitorType]
      : undefined;

    if (!definition) {
      return null;
    }

    const sources: Array<Dictionary<unknown>> = [
      input.queryAttributes || {},
      definition.getStepScope(input.monitorStep),
      ...(input.readAttributes || []).map(
        (attributes: Dictionary<unknown> | undefined): Dictionary<unknown> => {
          return attributes && typeof attributes === "object" ? attributes : {};
        },
      ),
      input.seriesLabels || {},
    ];

    const carried: Dictionary<string> = definition.carried[input.signal];
    const attributes: Dictionary<string> = {};
    const notCarried: Array<string> = [];

    const markNotCarried: (key: string) => void = (key: string): void => {
      if (!notCarried.includes(key)) {
        notCarried.push(key);
      }
    };

    for (const metricKey of Object.keys(carried)) {
      const signalKey: string = carried[metricKey]!;
      let value: string | null = null;
      let isNarrowed: boolean = false;

      for (const source of sources) {
        const sourceValue: unknown = readOwnValue(source, metricKey);

        if (!isSet(sourceValue)) {
          continue;
        }

        isNarrowed = true;
        // The latest source that says one value wins; one that says several clears it.
        value = readSingleValue(sourceValue);
      }

      if (value !== null) {
        writeOwnValue(attributes, signalKey, value);
      } else if (isNarrowed) {
        // Narrowed to several hosts or a pattern: no exact filter says that.
        markNotCarried(metricKey);
      }
    }

    for (const metricKey of definition.metricsOnly) {
      const isNarrowed: boolean = sources.some(
        (source: Dictionary<unknown>): boolean => {
          return isSet(readOwnValue(source, metricKey));
        },
      );

      if (isNarrowed) {
        markNotCarried(metricKey);
      }
    }

    return { attributes, notCarried };
  }
}
