import Monitor from "../../Models/DatabaseModels/Monitor";
import { JSONObject } from "../../Types/JSON";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import { isDeviceAddressMonitorType } from "./DeviceMonitorTemplateUtil";

/*
 * WHEN A MONITOR FOR A NETWORK DEVICE IS A DUPLICATE (OneUptime issues #9509
 * and #9510).
 *
 * OneUptime gives a discovered device a monitor from a template in three
 * places: an import from a scan's Review Results, Add to monitoring on the
 * Discovered Devices list, and an auto import rule. Each one used to ask only
 * one question before it created the monitor: does this device already have a
 * monitor from THIS template? Monitor's unique (device, template) index
 * answers it in the database too. Anything else came out twice: a second
 * Ping template, or the same template again after its first monitor lost its
 * link to it (the template was deleted, or the monitor unlinked from it), gave
 * the device a second Ping monitor - the same name, type and labels - while
 * the Devices list still showed one device.
 *
 * So a monitor OneUptime is about to make for a device duplicates one the
 * device already has when:
 *
 *   1. it is made from the same template - any kind of monitor; or
 *   2. it is a Ping, IP, Port or NTP monitor, and the device already has a
 *      monitor of that same kind that checks the same thing on it: any Ping
 *      monitor, any IP monitor, a Port monitor on one of the same ports, an
 *      NTP monitor on one of the same ports (123 when a step names none) -
 *      from another template, from none, or bound to the device as its
 *      health monitor.
 *
 * And nothing else is one, on purpose. A monitor of another kind is a
 * different check (a Ping monitor beside a Network Device one), and so is a
 * Port monitor on another port (SSH beside HTTPS). Two Network Device
 * monitors from different templates are two different alert sets - alert
 * policies give one device a monitor per policy that covers it - so for
 * Network Device monitors only the template decides.
 *
 * "The device's monitors" are the ones that belong to it: made for it
 * (Monitor.autoProvisionedNetworkDeviceId) or bound to it
 * (NetworkDevice.monitorId) - what its own pages list. A monitor that
 * happens to check the same address is not one of them: two sites may both
 * have a 10.0.0.5, and a monitor nothing ties to the device is not drawn on
 * its pages either.
 *
 * Pure: the server reads the device's monitors
 * (Server/Utils/NetworkDevice/DeviceMonitorDuplicateCheck) and asks this.
 */

/*
 * What one of a device's monitors is, as far as duplicates go: what it is
 * called and checks, and the template it came from.
 */
export interface DeviceMonitorFacts {
  id: string;
  name: string;
  monitorType: string;
  monitorTemplateId?: string | undefined;
  /*
   * What it checks on the device, for the kinds that can check it more than
   * once (getDeviceMonitorCheckKeys): the ports of a Port or NTP monitor, one
   * key for a Ping or IP monitor, none for any other kind.
   */
  checkKeys: Array<string>;
}

// The monitor about to be made, in the same terms.
export interface DeviceMonitorCandidate {
  monitorType: string;
  monitorTemplateId?: string | undefined;
  checkKeys: Array<string>;
}

// The port an NTP step asks on when it names none.
export const NTP_DEFAULT_PORT: number = 123;

/*
 * The one thing a Ping or IP monitor of a device checks: the device itself.
 * Its address is the device's, so two of them check the same thing.
 */
export const DEVICE_ADDRESS_CHECK_KEY: string = "address";

function readSteps(
  monitorSteps: MonitorSteps | JSONObject | null | undefined,
): Array<MonitorStep> {
  if (!monitorSteps) {
    return [];
  }

  try {
    const steps: MonitorSteps =
      monitorSteps instanceof MonitorSteps
        ? monitorSteps
        : MonitorSteps.fromJSON(monitorSteps as JSONObject);

    return steps.data?.monitorStepsInstanceArray || [];
  } catch {
    return [];
  }
}

function readStepPort(step: MonitorStep): number | null {
  const port: number = Number(step.data?.monitorDestinationPort?.toNumber?.());

  return Number.isInteger(port) && port > 0 ? port : null;
}

/*
 * What a monitor of this kind, with these steps, checks on a device, as keys
 * two monitors share when they check the same thing:
 *
 *   - Ping, IP: one key. A device has one address, so any two check it.
 *   - Port: each port its steps ask on.
 *   - NTP: each port its steps ask on, 123 for a step that names none.
 *   - Any other kind: none. Only its template decides (findDuplicate...).
 */
export function getDeviceMonitorCheckKeys(data: {
  monitorType: MonitorType | string | null | undefined;
  monitorSteps: MonitorSteps | JSONObject | null | undefined;
}): Array<string> {
  const monitorType: string = String(data.monitorType || "");

  if (monitorType === MonitorType.Ping || monitorType === MonitorType.IP) {
    return [DEVICE_ADDRESS_CHECK_KEY];
  }

  if (monitorType !== MonitorType.Port && monitorType !== MonitorType.NTP) {
    return [];
  }

  const keys: Array<string> = [];

  for (const step of readSteps(data.monitorSteps)) {
    const port: number | null =
      readStepPort(step) ??
      (monitorType === MonitorType.NTP ? NTP_DEFAULT_PORT : null);

    if (port !== null && !keys.includes(String(port))) {
      keys.push(String(port));
    }
  }

  return keys;
}

/*
 * A monitor as the rule reads it. Its template id and type are whatever was
 * selected; a monitor read without its steps has no check keys, so it can
 * still be a duplicate by its template, never by what it checks.
 */
export function toDeviceMonitorFacts(monitor: Monitor): DeviceMonitorFacts {
  return {
    id: monitor.id?.toString() || monitor._id?.toString() || "",
    name: monitor.name || "",
    monitorType: String(monitor.monitorType || ""),
    monitorTemplateId: monitor.monitorTemplateId?.toString() || undefined,
    checkKeys: getDeviceMonitorCheckKeys({
      monitorType: monitor.monitorType,
      monitorSteps: monitor.monitorSteps,
    }),
  };
}

/*
 * The monitor a template's monitor for this device would make, in the
 * rule's terms: its type and template, and what its steps check.
 */
export function toDeviceMonitorCandidate(data: {
  monitorType: MonitorType | string | null | undefined;
  monitorTemplateId: { toString(): string } | string | null | undefined;
  monitorSteps: MonitorSteps | JSONObject | null | undefined;
}): DeviceMonitorCandidate {
  return {
    monitorType: String(data.monitorType || ""),
    monitorTemplateId: data.monitorTemplateId
      ? data.monitorTemplateId.toString()
      : undefined,
    checkKeys: getDeviceMonitorCheckKeys({
      monitorType: data.monitorType,
      monitorSteps: data.monitorSteps,
    }),
  };
}

function isSameTemplate(
  candidate: DeviceMonitorCandidate,
  monitor: DeviceMonitorFacts,
): boolean {
  return Boolean(
    candidate.monitorTemplateId &&
      monitor.monitorTemplateId &&
      candidate.monitorTemplateId.toLowerCase() ===
        monitor.monitorTemplateId.toLowerCase(),
  );
}

function checksTheSameThing(
  candidate: DeviceMonitorCandidate,
  monitor: DeviceMonitorFacts,
): boolean {
  if (
    !isDeviceAddressMonitorType(candidate.monitorType) ||
    monitor.monitorType !== candidate.monitorType
  ) {
    return false;
  }

  return candidate.checkKeys.some((key: string): boolean => {
    return monitor.checkKeys.includes(key);
  });
}

/*
 * The monitor of the device's that the candidate would duplicate, or null
 * when it would duplicate none (see the rules at the top). One made from the
 * same template is preferred to one that only checks the same thing; among
 * equals, the first in the order handed in - the server hands them oldest
 * first.
 */
export function findDuplicateDeviceMonitor(data: {
  candidate: DeviceMonitorCandidate;
  monitors: ReadonlyArray<DeviceMonitorFacts>;
}): DeviceMonitorFacts | null {
  const sameTemplate: DeviceMonitorFacts | undefined = data.monitors.find(
    (monitor: DeviceMonitorFacts): boolean => {
      return isSameTemplate(data.candidate, monitor);
    },
  );

  if (sameTemplate) {
    return sameTemplate;
  }

  return (
    data.monitors.find((monitor: DeviceMonitorFacts): boolean => {
      return checksTheSameThing(data.candidate, monitor);
    }) || null
  );
}
