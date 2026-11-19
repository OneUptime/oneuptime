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
import DeviceUrlTarget from "./DeviceUrlTarget";
import MonitorTemplateCustomFieldUtil from "./MonitorTemplateCustomFieldUtil";
import NetworkDeviceMonitorTemplateUtil from "./NetworkDeviceMonitorTemplateUtil";

/*
 * A MONITOR FOR ONE NETWORK DEVICE, FROM A TEMPLATE (OneUptime issue #5145).
 *
 * A discovery import gives every device it brings in one monitor from a
 * template the person picks, and so does an auto import rule for every host
 * it imports (issue #9510). Three kinds of template can do that, because
 * three kinds of monitor can check a device:
 *
 *   - A Network Device template: its monitor reads the device's own polls -
 *     the ping and SNMP walk the device's probe already does - and its steps
 *     name the device (NetworkDeviceMonitorTemplateUtil binds them).
 *   - A Ping, IP, Port or NTP template: its monitor checks the device's
 *     ADDRESS itself, from a probe, on the template's own schedule. The
 *     template's steps name some address it was designed against; every
 *     step of the device's monitor checks the device's address instead, and
 *     keeps the rest of the step as the template has it - the port a Port or
 *     NTP template asks on, timeouts, retries and every criterion.
 *   - A Website, API or SSL Certificate template (issue #9546): its monitor
 *     checks a URL on the device - its web UI, a status page, the
 *     certificate a printer or a camera serves. Each step's URL is the
 *     template's with the device's address as its host, and the scheme,
 *     port, path and query as the template wrote them (DeviceUrlTarget), so
 *     the template decides where on each device to look.
 *
 * The last two are the TARGET kinds (DEVICE_TARGET_MONITOR_TYPES): their
 * monitors check the device from a probe, at its address, rather than read
 * what its polls found. Until #5145 the import offered Network Device
 * templates only, so a customer's own Ping template never showed, and an
 * auto import rule did the same until #9510; Website, API and SSL
 * Certificate templates followed with #9546. Templates of any other type
 * stay out: a DNS or Domain template checks a name, a database template a
 * connection with its own credentials, a telemetry template a query, a
 * Manual or Incoming Request template checks nothing at all - none of them
 * has an address the device's can stand in for.
 *
 * Every kind of monitor carries the same provenance: the template it was
 * made from and the device it was made for (autoProvisionedNetworkDeviceId).
 * That is what finds a device's monitor again instead of making a second one
 * (Monitor's unique (device, template) index), what deletes it with its
 * device, what lists it on the device's own page, and what tells a template
 * sync that a target monitor's address is the device's, not the
 * template's (keepTargetAddress).
 *
 * Pure: no database and no permission work, like the Network Device util.
 * The caller persists what it builds through MonitorService and chooses the
 * probes that run a target monitor.
 */

// Templates whose monitors check an address: a device's monitor checks its own.
export const DEVICE_ADDRESS_MONITOR_TYPES: ReadonlyArray<MonitorType> = [
  MonitorType.Ping,
  MonitorType.IP,
  MonitorType.Port,
  MonitorType.NTP,
];

/*
 * Templates whose monitors check a URL (issue #9546): a device's monitor
 * checks the template's URL with the device's address as its host.
 */
export const DEVICE_URL_MONITOR_TYPES: ReadonlyArray<MonitorType> = [
  MonitorType.Website,
  MonitorType.API,
  MonitorType.SSLCertificate,
];

/*
 * Every kind whose monitor checks a device from a probe, at the device's
 * address: the address kinds, then the URL kinds. A Network Device monitor
 * reads the device's polls instead, and is the one kind not here.
 */
export const DEVICE_TARGET_MONITOR_TYPES: ReadonlyArray<MonitorType> = [
  ...DEVICE_ADDRESS_MONITOR_TYPES,
  ...DEVICE_URL_MONITOR_TYPES,
];

/*
 * Every kind of template a device can be given a monitor from: the one that
 * reads the device's polls, then the ones that check its address, then the
 * ones that check a URL on it. The order is the order the import lists
 * them in.
 */
export const DEVICE_MONITOR_TEMPLATE_TYPES: ReadonlyArray<MonitorType> = [
  MonitorType.NetworkDevice,
  ...DEVICE_TARGET_MONITOR_TYPES,
];

export function isDeviceAddressMonitorType(
  monitorType: MonitorType | string | null | undefined,
): monitorType is MonitorType {
  return (DEVICE_ADDRESS_MONITOR_TYPES as ReadonlyArray<string>).includes(
    String(monitorType || ""),
  );
}

export function isDeviceUrlMonitorType(
  monitorType: MonitorType | string | null | undefined,
): monitorType is MonitorType {
  return (DEVICE_URL_MONITOR_TYPES as ReadonlyArray<string>).includes(
    String(monitorType || ""),
  );
}

export function isDeviceTargetMonitorType(
  monitorType: MonitorType | string | null | undefined,
): monitorType is MonitorType {
  return (DEVICE_TARGET_MONITOR_TYPES as ReadonlyArray<string>).includes(
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
 * The refusal for a template no device's monitor can be made from, said the
 * same way wherever a template is picked for devices.
 */
export const DEVICE_MONITOR_TEMPLATE_TYPE_REFUSAL: string =
  "Pick a Network Device, Ping, IP, Port, NTP, Website, API or SSL Certificate monitor template: a monitor made from any other kind cannot check a device.";

/*
 * Why a device whose address is a name gets no monitor from an IP template,
 * and what would work. One sentence for every such device, so the import's
 * list of failures shows them as one group (the device's own address is
 * listed under it).
 */
export const IP_MONITOR_NEEDS_IP_ADDRESS: string =
  "An IP monitor checks an IP address, and this device's address is a name. Use a Ping template for it.";

type MonitorDestination = URL | IP | Hostname;

export interface BuildDeviceMonitorData {
  template: MonitorTemplate;
  networkDevice: NetworkDevice;
}

export default class DeviceMonitorTemplateUtil {
  /*
   * What a monitor of this type checks for a device at this address: an IP
   * address, or a host name for a Ping, Port or NTP monitor. An IP monitor
   * checks an IP address only, so a device whose address is a name cannot
   * have one - said in a sentence that says what would work, since it is
   * read in the import's list of failures. The sentence names no address:
   * that list groups its devices by reason and names each device's address
   * under it, so every such device is one group, not one group each.
   */
  public static buildDestination(data: {
    address: string;
    monitorType: MonitorType;
  }): IP | Hostname {
    const address: string = (data.address || "").trim();

    if (!isDeviceAddressMonitorType(data.monitorType)) {
      throw new BadDataException(
        `A ${data.monitorType} monitor does not check an address.`,
      );
    }

    if (!address) {
      throw new BadDataException(
        "This device has no address, so a monitor cannot check it.",
      );
    }

    if (data.monitorType === MonitorType.IP && !IP.isIP(address)) {
      throw new BadDataException(IP_MONITOR_NEEDS_IP_ADDRESS);
    }

    return buildPingMonitorDestination(address);
  }

  /*
   * A copy of the steps with every step checking the device: a Ping, IP,
   * Port or NTP step its address, a Website, API or SSL Certificate step the
   * step's URL with the device's address as its host (DeviceUrlTarget). The
   * steps handed in are never changed: one template serves a whole estate.
   */
  public static retargetMonitorSteps(data: {
    monitorSteps: MonitorSteps | undefined;
    address: string;
    monitorType: MonitorType;
  }): MonitorSteps {
    if (isDeviceUrlMonitorType(data.monitorType)) {
      return this.withUrlHost(data.monitorSteps, data.address);
    }

    const destination: IP | Hostname = this.buildDestination({
      address: data.address,
      monitorType: data.monitorType,
    });

    return this.withDestination(data.monitorSteps, destination);
  }

  /*
   * The template's steps for a monitor a discovery import made for a
   * device, as a template sync writes them: the template's criteria and
   * settings, still checking the device this monitor checks - its address,
   * or, for a Website, API or SSL Certificate monitor, the host of its URL,
   * on the template's scheme, port and path. Without it, one press of "Sync
   * Criteria" would point every device's monitor at the template's own
   * address.
   *
   * The kind is the template's. Left out, it is read from the steps: a
   * template whose steps check URLs is synced the URL way.
   */
  public static keepTargetAddress(data: {
    templateMonitorSteps: MonitorSteps | undefined;
    currentMonitorSteps: MonitorSteps | JSONObject | undefined;
    monitorType?: MonitorType | string | null | undefined;
  }): MonitorSteps {
    const checksUrls: boolean = data.monitorType
      ? isDeviceUrlMonitorType(data.monitorType)
      : this.readTargetDestination(data.templateMonitorSteps) instanceof URL;

    if (checksUrls) {
      const host: string = this.readTargetUrlHost(data.currentMonitorSteps);

      if (!host) {
        throw new BadDataException(
          "This monitor was made for a network device but its URL names no host, so a sync cannot tell which device to keep checking. Set its URL's host to the device's address, then sync again.",
        );
      }

      return this.withUrlHost(data.templateMonitorSteps, host);
    }

    const destination: MonitorDestination | null = this.readTargetDestination(
      data.currentMonitorSteps,
    );

    if (!destination) {
      throw new BadDataException(
        "This monitor was made for a network device but checks no address, so a sync cannot tell which address to keep. Set its destination to the device's address, then sync again.",
      );
    }

    return this.withDestination(data.templateMonitorSteps, destination);
  }

  /*
   * What a monitor carrying a device's provenance must be: a Network Device
   * monitor whose steps name that device, an address monitor every step of
   * which checks an address, or a URL monitor every step of which checks a
   * URL with a host. Anything else is refused - provenance is what deletes a
   * monitor with its device, and a monitor that checks nothing of the
   * device's must not go with it.
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

    if (!isDeviceTargetMonitorType(data.monitorType)) {
      throw new BadDataException(
        "Only Network Device, Ping, IP, Port, NTP, Website, API and SSL Certificate monitors can carry auto-provisioning provenance.",
      );
    }

    const steps: Array<MonitorStep> = this.readSteps(data.monitorSteps);

    if (isDeviceUrlMonitorType(data.monitorType)) {
      if (
        steps.length === 0 ||
        steps.some((step: MonitorStep): boolean => {
          return !DeviceUrlTarget.readHost(this.readStepUrl(step));
        })
      ) {
        throw new BadDataException(
          "A Website, API or SSL Certificate monitor made for a network device must check a URL on the device's address in every step.",
        );
      }

      return;
    }

    if (
      steps.length === 0 ||
      steps.some((step: MonitorStep): boolean => {
        return !step.data?.monitorDestination?.toString().trim();
      })
    ) {
      throw new BadDataException(
        "A Ping, IP, Port or NTP monitor made for a network device must check the device's address in every step.",
      );
    }
  }

  /*
   * The one monitor a device gets from a template, of any kind - built, not
   * persisted. A Network Device template is the Network Device util's to
   * build; a target template (Ping, IP, Port, NTP, Website, API, SSL
   * Certificate) is built here, the same way: named after the device, the
   * template's description, interval, probe agreement, labels and custom
   * fields, linked to the template and the device.
   */
  public static buildMonitor(data: BuildDeviceMonitorData): Monitor {
    const template: MonitorTemplate = data.template;

    if (template.monitorType === MonitorType.NetworkDevice) {
      return NetworkDeviceMonitorTemplateUtil.buildMonitor(data);
    }

    if (!isDeviceTargetMonitorType(template.monitorType)) {
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
      throw new BadDataException(
        "Monitor template monitor steps are required.",
      );
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
    monitor.autoProvisionedNetworkDeviceId = new ObjectID(device.id.toString());

    return monitor;
  }

  /*
   * What a target template must have before a rule may give devices
   * monitors from it (issues #9510, #9546): a step to check each device
   * with; in a Port template, the port each step asks on - a Port monitor
   * with none checks nothing; and in a Website, API or SSL Certificate
   * template, a URL in every step whose host each device's address can take
   * (DeviceUrlTarget.assertTemplateUrl). Said when the rule is saved, rather
   * than by every monitor the rule then fails to make.
   */
  public static assertDeviceTemplateSteps(data: {
    monitorType: MonitorType | string | null | undefined;
    monitorSteps: MonitorSteps | JSONObject | null | undefined;
  }): void {
    if (!isDeviceTargetMonitorType(data.monitorType)) {
      throw new BadDataException(DEVICE_MONITOR_TEMPLATE_TYPE_REFUSAL);
    }

    const steps: Array<MonitorStep> = this.readSteps(data.monitorSteps);

    if (steps.length === 0) {
      throw new BadDataException(
        "This monitor template has no steps, so a monitor made from it would check nothing. Add a step to the template, then pick it again.",
      );
    }

    if (
      data.monitorType === MonitorType.Port &&
      steps.some((step: MonitorStep): boolean => {
        const port: number = Number(
          step.data?.monitorDestinationPort?.toNumber?.(),
        );

        return !Number.isInteger(port) || port <= 0;
      })
    ) {
      throw new BadDataException(
        "Every step of a Port monitor template must name the port it checks. Add the port to the template, then pick it again.",
      );
    }

    if (isDeviceUrlMonitorType(data.monitorType)) {
      for (const step of steps) {
        DeviceUrlTarget.assertTemplateUrl(this.readStepUrl(step));
      }
    }
  }

  /*
   * The URL a Website, API or SSL Certificate template's first step checks,
   * as written: what the import and the rule form show each device's
   * monitor will check, with the device's address in the host's place
   * (DeviceUrlTarget.describeTemplateUrl). Empty when it names none.
   */
  public static readTemplateUrl(
    monitorSteps: MonitorSteps | JSONObject | null | undefined,
  ): string {
    for (const step of this.readSteps(monitorSteps)) {
      const url: string = this.readStepUrl(step);

      if (url) {
        return url;
      }
    }

    return "";
  }

  /*
   * The ports a Port or NTP template's steps ask on, in step order and each
   * once: what the import says each device's monitor checks. An NTP step
   * that names no port asks on 123, and is left out here.
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

  // A step's URL as written, or empty when its destination is not a URL.
  private static readStepUrl(step: MonitorStep): string {
    const destination: MonitorDestination | undefined =
      step.data?.monitorDestination;

    return destination instanceof URL ? destination.toString().trim() : "";
  }

  // The host the first URL any step checks is on: the device's address.
  private static readTargetUrlHost(
    monitorSteps: MonitorSteps | JSONObject | null | undefined,
  ): string {
    for (const step of this.readSteps(monitorSteps)) {
      const host: string = DeviceUrlTarget.readHost(this.readStepUrl(step));

      if (host) {
        return host;
      }
    }

    return "";
  }

  /*
   * A copy of the steps with every step's URL on the device's address
   * (DeviceUrlTarget.buildDeviceUrl). A step that checks no URL is refused:
   * there is nothing of the device's for it to check.
   */
  private static withUrlHost(
    monitorSteps: MonitorSteps | undefined,
    address: string,
  ): MonitorSteps {
    if (!monitorSteps || this.readSteps(monitorSteps).length === 0) {
      throw new BadDataException(
        "Monitor template monitor steps are required.",
      );
    }

    const cloned: MonitorSteps = MonitorSteps.clone(monitorSteps);

    for (const step of cloned.data!.monitorStepsInstanceArray) {
      step.setMonitorDestination(
        DeviceUrlTarget.buildDeviceUrl({
          templateUrl: this.readStepUrl(step),
          address: address,
        }),
      );
    }

    return cloned;
  }

  // The first destination any step names, as the monitor checks it.
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
    destination: MonitorDestination,
  ): MonitorSteps {
    if (!monitorSteps || this.readSteps(monitorSteps).length === 0) {
      throw new BadDataException(
        "Monitor template monitor steps are required.",
      );
    }

    const cloned: MonitorSteps = MonitorSteps.clone(monitorSteps);

    for (const step of cloned.data!.monitorStepsInstanceArray) {
      // A copy each, so no two steps (or monitors) share one object.
      step.setMonitorDestination(this.copyDestination(destination));
    }

    return cloned;
  }

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
