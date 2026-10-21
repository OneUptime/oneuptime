import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../Models/DatabaseModels/MonitorTemplate";
import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import Hostname from "../../Types/API/Hostname";
import URL from "../../Types/API/URL";
import BadDataException from "../../Types/Exception/BadDataException";
import IP from "../../Types/IP/IP";
import { JSONObject } from "../../Types/JSON";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import ObjectID from "../../Types/ObjectID";
import { buildPingMonitorDestination } from "../NetworkDiscovery/PingMonitorBuilder";
import MonitorTemplateCustomFieldUtil from "./MonitorTemplateCustomFieldUtil";
import NetworkDeviceMonitorTemplateUtil from "./NetworkDeviceMonitorTemplateUtil";

/*
 * A MONITOR FOR ONE NETWORK DEVICE, FROM A TEMPLATE (OneUptime issue #5145).
 *
 * A discovery import gives every device it brings in one monitor from a
 * template the person picks. Two kinds of template can do that, because
 * two kinds of monitor can check a device:
 *
 *   - A Network Device template: its monitor reads the device's own polls -
 *     the ping and SNMP walk the device's probe already does - and its steps
 *     name the device (NetworkDeviceMonitorTemplateUtil binds them).
 *   - A Ping, IP or Port template: its monitor checks the device's ADDRESS
 *     itself, from a probe, on the template's own schedule. The template's
 *     steps name some address it was designed against; every step of the
 *     device's monitor checks the device's address instead, and keeps the
 *     rest of the step as the template has it - the port a Port template
 *     knocks on, timeouts, retries and every criterion.
 *
 * Until #5145 the import offered Network Device templates only, so a
 * customer's own Ping template never showed. Templates of any other type
 * stay out: a Website, API or SSL Certificate template checks a URL, a DNS
 * template a name, a telemetry template a query - none of them has an
 * address to point at the device.
 *
 * Both kinds of monitor carry the same provenance: the template they were
 * made from and the device they were made for (autoProvisionedNetworkDeviceId).
 * That is what finds a device's monitor again instead of making a second
 * one (Monitor's unique (device, template) index), what deletes it with its
 * device, and what tells a template sync that an address monitor's address
 * is the device's, not the template's (keepTargetAddress).
 *
 * Pure: no database and no permission work, like the Network Device util.
 * The caller persists what it builds through MonitorService and chooses the
 * probes that run an address monitor.
 */

// Templates whose monitors check an address: a device's monitor checks its own.
export const DEVICE_ADDRESS_MONITOR_TYPES: ReadonlyArray<MonitorType> = [
  MonitorType.Ping,
  MonitorType.IP,
  MonitorType.Port,
];

/*
 * Every kind of template a device can be given a monitor from: one that
 * reads the device's polls, then the ones that check its address. The order
 * is the order the import lists them in.
 */
export const DEVICE_MONITOR_TEMPLATE_TYPES: ReadonlyArray<MonitorType> = [
  MonitorType.NetworkDevice,
  ...DEVICE_ADDRESS_MONITOR_TYPES,
];

export function isDeviceAddressMonitorType(
  monitorType: MonitorType | string | null | undefined,
): monitorType is MonitorType {
  return (DEVICE_ADDRESS_MONITOR_TYPES as ReadonlyArray<string>).includes(
    String(monitorType || ""),
  );
}

export function isDeviceMonitorTemplateType(
  monitorType: MonitorType | string | null | undefined,
): monitorType is MonitorType {
  return (DEVICE_MONITOR_TEMPLATE_TYPES as ReadonlyArray<string>).includes(
    String(monitorType || ""),
  );
}

/*
 * The refusal for a template no device's monitor can be made from, said
 * the same way wherever a template is picked for devices.
 */
export const DEVICE_MONITOR_TEMPLATE_TYPE_REFUSAL: string =
  "Pick a Network Device, Ping, IP or Port monitor template: a monitor made from any other kind cannot check a device.";

type MonitorDestination = URL | IP | Hostname;

export interface BuildDeviceMonitorData {
  template: MonitorTemplate;
  networkDevice: NetworkDevice;
}

export default class DeviceMonitorTemplateUtil {
  /*
   * What a monitor of this type checks for a device at this address: an IP
   * address, or a host name for a Ping or Port monitor. An IP monitor
   * checks an IP address only, so a device whose address is a name cannot
   * have one - said in a sentence that names the address and what would
   * work, since it is read in the import's list of failures.
   */
  public static buildDestination(data: {
    address: string;
    monitorType: MonitorType;
  }): IP | Hostname {
    const address: string = (data.address || "").trim();

    if (!address) {
      throw new BadDataException(
        "This device has no address, so a monitor cannot check it.",
      );
    }

    if (!isDeviceAddressMonitorType(data.monitorType)) {
      throw new BadDataException(
        `A ${data.monitorType} monitor does not check an address.`,
      );
    }

    if (data.monitorType === MonitorType.IP && !IP.isIP(address)) {
      throw new BadDataException(
        `An IP monitor checks an IP address, and this device's address "${address}" is a name. Use a Ping template for it.`,
      );
    }

    return buildPingMonitorDestination(address);
  }

  /*
   * A copy of the steps with every step checking the address. The steps
   * handed in are never changed: one template serves a whole estate.
   */
  public static retargetMonitorSteps(data: {
    monitorSteps: MonitorSteps | undefined;
    address: string;
    monitorType: MonitorType;
  }): MonitorSteps {
    const destination: IP | Hostname = this.buildDestination({
      address: data.address,
      monitorType: data.monitorType,
    });

    return this.withDestination(data.monitorSteps, (): MonitorDestination => {
      return this.copyDestination(destination);
    });
  }

  /*
   * The address an address monitor checks: its first step's destination,
   * as written (an IP, or a host name without a port). Null when no step
   * has one.
   */
  public static readTargetAddress(
    monitorSteps: MonitorSteps | JSONObject | null | undefined,
  ): string | null {
    const destination: MonitorDestination | null =
      this.readTargetDestination(monitorSteps);

    if (!destination) {
      return null;
    }

    if (destination instanceof Hostname) {
      return destination.hostname || null;
    }

    return destination.toString() || null;
  }

  /*
   * The template's steps for a monitor a discovery import made for a
   * device, as a template sync writes them: the template's criteria and
   * settings, still checking the address this monitor checks. Without it,
   * one press of "Sync Criteria" would point every device's monitor at the
   * template's own address.
   */
  public static keepTargetAddress(data: {
    templateMonitorSteps: MonitorSteps | undefined;
    currentMonitorSteps: MonitorSteps | JSONObject | undefined;
  }): MonitorSteps {
    const destination: MonitorDestination | null = this.readTargetDestination(
      data.currentMonitorSteps,
    );

    if (!destination) {
      throw new BadDataException(
        "This monitor was made for a network device but checks no address, so a sync cannot tell which address to keep. Set its destination to the device's address, then sync again.",
      );
    }

    return this.withDestination(
      data.templateMonitorSteps,
      (): MonitorDestination => {
        return this.copyDestination(destination);
      },
    );
  }

  /*
   * What a monitor carrying a device's provenance must be: a Network Device
   * monitor whose steps name that device, or an address monitor every step
   * of which checks an address. Anything else is refused - provenance is
   * what deletes a monitor with its device, and a monitor that checks
   * nothing of the device's must not go with it.
   */
  public static assertProvenanceFits(data: {
    monitorType: MonitorType | string | null | undefined;
    monitorSteps: MonitorSteps | JSONObject | undefined;
    networkDeviceId: ObjectID | string;
  }): void {
    if (data.monitorType === MonitorType.NetworkDevice) {
      NetworkDeviceMonitorTemplateUtil.assertMonitorStepsBoundToNetworkDevice({
        monitorSteps: data.monitorSteps,
        networkDeviceId: data.networkDeviceId,
      });
      return;
    }

    if (!isDeviceAddressMonitorType(data.monitorType)) {
      throw new BadDataException(
        "Only Network Device, Ping, IP and Port monitors can carry auto-provisioning provenance.",
      );
    }

    const steps: Array<MonitorStep> = this.readSteps(data.monitorSteps);

    if (
      steps.length === 0 ||
      steps.some((step: MonitorStep): boolean => {
        return !step.data?.monitorDestination;
      })
    ) {
      throw new BadDataException(
        "A Ping, IP or Port monitor made for a network device must check the device's address in every step.",
      );
    }
  }

  /*
   * The one monitor a device gets from a template, of either kind - built,
   * not persisted. A Network Device template is the Network Device util's
   * to build; an address template is built here, the same way: named after
   * the device, the template's interval, probe agreement, labels and custom
   * fields, linked to the template and the device.
   */
  public static buildMonitor(data: BuildDeviceMonitorData): Monitor {
    const template: MonitorTemplate = data.template;

    if (template.monitorType === MonitorType.NetworkDevice) {
      return NetworkDeviceMonitorTemplateUtil.buildMonitor(data);
    }

    if (!isDeviceAddressMonitorType(template.monitorType)) {
      throw new BadDataException(DEVICE_MONITOR_TEMPLATE_TYPE_REFUSAL);
    }

    const device: NetworkDevice = data.networkDevice;
    const templateId: ObjectID | null = template.id;

    if (!templateId) {
      throw new BadDataException(
        "Monitor template ID is required to make a monitor for a device.",
      );
    }

    if (!device.id) {
      throw new BadDataException(
        "Network Device ID is required to make a monitor for it.",
      );
    }

    if (!template.projectId || !device.projectId) {
      throw new BadDataException(
        "The monitor template and the network device must both belong to a project.",
      );
    }

    if (template.projectId.toString() !== device.projectId.toString()) {
      throw new BadDataException(
        "Monitor template and Network Device must belong to the same project.",
      );
    }

    if (this.readSteps(template.monitorSteps).length === 0) {
      throw new BadDataException("Monitor template monitor steps are required.");
    }

    const monitor: Monitor = new Monitor();
    monitor.projectId = new ObjectID(device.projectId.toString());
    monitor.name = NetworkDeviceMonitorTemplateUtil.buildDeviceIdentifiableName(
      {
        monitorTemplate: template,
        networkDevice: device,
      },
    );

    if (template.monitorDescription !== undefined) {
      monitor.description = template.monitorDescription;
    }

    monitor.monitorType = template.monitorType;
    monitor.monitorSteps = this.retargetMonitorSteps({
      monitorSteps: template.monitorSteps,
      address: device.hostname || "",
      monitorType: template.monitorType,
    });

    if (template.monitoringInterval !== undefined) {
      monitor.monitoringInterval = template.monitoringInterval;
    }

    if (template.minimumProbeAgreement !== undefined) {
      monitor.minimumProbeAgreement = template.minimumProbeAgreement;
    }

    if (template.customFields !== undefined) {
      monitor.customFields = MonitorTemplateCustomFieldUtil.clone(
        template.customFields,
      );
    }

    if (template.labels !== undefined) {
      monitor.labels = [...template.labels];
    }

    monitor.monitorTemplateId = new ObjectID(templateId.toString());
    monitor.autoProvisionedNetworkDeviceId = new ObjectID(
      device.id.toString(),
    );

    return monitor;
  }

  /*
   * The ports a Port template's steps knock on, in step order and each
   * once: what the import says each device's monitor checks.
   */
  public static readPorts(
    monitorSteps: MonitorSteps | JSONObject | null | undefined,
  ): Array<number> {
    const ports: Array<number> = [];

    for (const step of this.readSteps(monitorSteps)) {
      const port: number = Number(
        step.data?.monitorDestinationPort?.toNumber?.(),
      );

      if (Number.isInteger(port) && port > 0 && !ports.includes(port)) {
        ports.push(port);
      }
    }

    return ports;
  }

  private static readSteps(
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

  private static readTargetDestination(
    monitorSteps: MonitorSteps | JSONObject | null | undefined,
  ): MonitorDestination | null {
    for (const step of this.readSteps(monitorSteps)) {
      const destination: MonitorDestination | undefined =
        step.data?.monitorDestination;

      if (destination && destination.toString().trim()) {
        return destination;
      }
    }

    return null;
  }

  private static withDestination(
    monitorSteps: MonitorSteps | undefined,
    destinationFor: () => MonitorDestination,
  ): MonitorSteps {
    if (this.readSteps(monitorSteps).length === 0) {
      throw new BadDataException("Monitor template monitor steps are required.");
    }

    const cloned: MonitorSteps = MonitorSteps.clone(monitorSteps!);

    for (const step of cloned.data!.monitorStepsInstanceArray) {
      step.setMonitorDestination(destinationFor());
    }

    return cloned;
  }

  // A copy, so no two steps (or monitors) share one destination object.
  private static copyDestination(
    destination: MonitorDestination,
  ): MonitorDestination {
    if (destination instanceof IP) {
      return IP.fromString(destination.toString());
    }

    if (destination instanceof Hostname) {
      return Hostname.fromJSON(destination.toJSON());
    }

    return URL.fromJSON(destination.toJSON());
  }
}
