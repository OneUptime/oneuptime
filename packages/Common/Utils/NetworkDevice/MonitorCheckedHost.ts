import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import {
  isDeviceAddressMonitorType,
  isDeviceUrlMonitorType,
} from "../Monitor/DeviceMonitorTemplateUtil";
import DeviceUrlTarget from "../Monitor/DeviceUrlTarget";
import DeviceWebUiUtil from "./DeviceWebUiUtil";

/*
 * THE ONE HOST A MONITOR CHECKS, FOR TELLING WHICH NETWORK DEVICE IT IS OF
 * (OneUptime issue #9545).
 *
 * A Ping, IP, Port or NTP monitor checks an address; a Website, API or SSL
 * Certificate monitor checks a URL, on a host. When a person creates one on
 * the address of a network device - and only one device in the project has
 * that address - the monitor is tied to that device
 * (Monitor.networkDeviceId), so the device's pages list it and the duplicate
 * check sees it. This reads which host that is.
 *
 * One host or none: a monitor whose steps check two hosts checks no single
 * device, and a host written as a variable ({{monitorSecrets.host}}) is not
 * known until the check runs. A port someone typed after an address is left
 * off, and an IPv6 address loses its brackets, so the host reads as a
 * device's address is written. Compared with a device's address as
 * isSameHost says.
 *
 * Pure: the server looks the host up among the devices
 * (Server/Utils/NetworkDevice/MonitorDeviceLink), and the backfill and the
 * tests read it the same way.
 */

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

// The host one step checks, as written, or empty.
function readStepHost(
  step: MonitorStep,
  monitorType: MonitorType | string,
): string {
  const destination: unknown = step.data?.monitorDestination;

  if (!destination) {
    return "";
  }

  if (isDeviceUrlMonitorType(monitorType)) {
    return destination instanceof URL
      ? DeviceUrlTarget.readHost(destination)
      : "";
  }

  const text: string = String(destination).trim();

  if (!text || text.includes("{{")) {
    return "";
  }

  return DeviceWebUiUtil.getHost(text);
}

/*
 * The host every step of the monitor checks, or empty when the monitor is
 * not a kind that checks a host, checks none, or checks more than one.
 */
export function getMonitorCheckedHost(data: {
  monitorType: MonitorType | string | null | undefined;
  monitorSteps: MonitorSteps | JSONObject | null | undefined;
}): string {
  const monitorType: string = String(data.monitorType || "");

  if (
    !isDeviceAddressMonitorType(monitorType) &&
    !isDeviceUrlMonitorType(monitorType)
  ) {
    return "";
  }

  let host: string = "";

  for (const step of readSteps(data.monitorSteps)) {
    const stepHost: string = readStepHost(step, monitorType);

    if (!stepHost) {
      return "";
    }

    if (host && !isSameHost(host, stepHost)) {
      return "";
    }

    host = host || stepHost;
  }

  return host;
}

/*
 * Whether two hosts are the same as an address is written: a name in any
 * case ("Core-SW-01" is "core-sw-01"), an IPv6 address in brackets or not.
 */
export function isSameHost(first: string, second: string): boolean {
  const normalize: (host: string) => string = (host: string): string => {
    return DeviceWebUiUtil.getHost(host).toLowerCase();
  };

  const firstHost: string = normalize(first);

  return Boolean(firstHost) && firstHost === normalize(second);
}

/*
 * The spellings a device's address may be stored under for this host, to
 * look the device up by: as written, and lower-cased.
 */
export function getHostLookupValues(host: string): Array<string> {
  const bare: string = DeviceWebUiUtil.getHost(host);

  if (!bare) {
    return [];
  }

  return Array.from(new Set<string>([bare, bare.toLowerCase()]));
}
