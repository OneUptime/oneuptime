import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../Models/DatabaseModels/MonitorTemplate";
import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import ObjectID from "../../Types/ObjectID";

/*
 * Materialises a project MonitorTemplate for one discovered NetworkDevice.
 *
 * A Network Device template necessarily contains a concrete device id today:
 * the ordinary template form uses the same required step editor as a Monitor.
 * That id is only a design-time placeholder when the template is used by
 * discovery automation. Every step is therefore cloned and rebound here; the
 * template object must never be mutated, because the same instance can serve a
 * whole discovered estate.
 *
 * This utility deliberately performs no database or permission work. Callers
 * remain responsible for fetching a template with its labels, then persisting
 * the returned Monitor through MonitorService so tenant, billing, reference,
 * rule-engine, and audit hooks still run.
 */

/*
 * The widest name a provisioned monitor may carry.
 *
 * Monitor.name is varchar(100), but the real ceiling is the SLUG: Monitor is
 * @SlugifyColumn("name", "slug") and Slug.getSlug appends a dash plus ten
 * random digits into its own varchar(100), and the create path THROWS on
 * overflow rather than truncating. A name that fills the name column
 * therefore produces a 111-character slug and fails the insert — the monitor
 * is counted into `monitorsFailed` and the device silently never gets one.
 *
 * 88 leaves exactly the slug's 11-character tail, the same cap
 * MAX_PING_MONITOR_NAME_LENGTH uses on the other provisioning path. Device
 * names arrive clamped to 80 by DiscoveredDeviceBuilder, so this only bites a
 * device renamed by hand or a long template suffix.
 */
export const MAX_PROVISIONED_MONITOR_NAME_LENGTH: number = 88;

/*
 * What sits between the device's own identity and the template's default
 * monitor name when the template supplies one.
 */
const MONITOR_NAME_SEPARATOR: string = " - ";

type NetworkDeviceId = ObjectID | string | null | undefined;

export interface RebindNetworkDeviceMonitorStepsData {
  monitorSteps: MonitorSteps | undefined;
  networkDeviceId: NetworkDeviceId;
}

export interface BuildSyncedNetworkDeviceMonitorStepsData {
  templateMonitorSteps: MonitorSteps | undefined;
  currentMonitorSteps: MonitorSteps | undefined;
  fallbackNetworkDeviceId?: NetworkDeviceId;
}

export interface BuildMonitorFromTemplateData {
  template: MonitorTemplate;
  networkDevice: NetworkDevice;
}

export default class NetworkDeviceMonitorTemplateUtil {
  /**
   * Deep-clone a Network Device monitor's steps and point every step at the
   * supplied device. The source MonitorSteps and every nested object remain
   * untouched.
   */
  public static rebindMonitorSteps(
    data: RebindNetworkDeviceMonitorStepsData,
  ): MonitorSteps {
    const networkDeviceId: string =
      data.networkDeviceId?.toString().trim() || "";

    if (!networkDeviceId) {
      throw new BadDataException(
        "Network Device ID is required to bind monitor template steps.",
      );
    }

    this.validateMonitorSteps(data.monitorSteps, "Monitor template");

    const clonedSteps: MonitorSteps = MonitorSteps.clone(data.monitorSteps!);

    for (const step of clonedSteps.data!.monitorStepsInstanceArray) {
      if (!step.data?.networkDeviceMonitor) {
        throw new BadDataException(
          "Monitor template contains a Network Device step without Network Device configuration.",
        );
      }

      step.data.networkDeviceMonitor.networkDeviceId = networkDeviceId;
    }

    return clonedSteps;
  }

  /**
   * Clone freshly-edited template steps for a linked Monitor while retaining
   * that Monitor's instance-specific device. Multiple steps may reference the
   * same device. More than one distinct binding is rejected because choosing
   * one would silently retarget alerting; when no current binding survives, a
   * persisted auto-provisioning marker can be supplied as the fallback.
   */
  public static buildSyncedMonitorSteps(
    data: BuildSyncedNetworkDeviceMonitorStepsData,
  ): MonitorSteps {
    const currentDeviceIds: Set<string> = new Set<string>();

    for (const step of data.currentMonitorSteps?.data
      ?.monitorStepsInstanceArray || []) {
      const currentDeviceId: string | undefined =
        step.data?.networkDeviceMonitor?.networkDeviceId?.trim() || undefined;

      if (currentDeviceId) {
        currentDeviceIds.add(currentDeviceId);
      }
    }

    if (currentDeviceIds.size > 1) {
      throw new BadDataException(
        "Linked Network Device monitor must have exactly one distinct Network Device binding.",
      );
    }

    const preservedNetworkDeviceId: string =
      Array.from(currentDeviceIds)[0] ||
      data.fallbackNetworkDeviceId?.toString().trim() ||
      "";

    if (!preservedNetworkDeviceId) {
      throw new BadDataException(
        "Linked Network Device monitor has no Network Device binding to preserve.",
      );
    }

    return this.rebindMonitorSteps({
      monitorSteps: data.templateMonitorSteps,
      networkDeviceId: preservedNetworkDeviceId,
    });
  }

  /**
   * Build (but do not persist) the Monitor managed for one discovered device.
   */
  public static buildMonitor(data: BuildMonitorFromTemplateData): Monitor {
    const monitorTemplate: MonitorTemplate = data.template;
    const networkDevice: NetworkDevice = data.networkDevice;

    const monitorTemplateId: ObjectID | null = monitorTemplate.id;
    if (!monitorTemplateId) {
      throw new BadDataException(
        "Monitor template ID is required to provision a Network Device monitor.",
      );
    }

    const networkDeviceId: ObjectID | null = networkDevice.id;
    if (!networkDeviceId) {
      throw new BadDataException(
        "Network Device ID is required to provision a monitor.",
      );
    }

    if (!monitorTemplate.projectId) {
      throw new BadDataException(
        "Monitor template project ID is required to provision a Network Device monitor.",
      );
    }

    if (!networkDevice.projectId) {
      throw new BadDataException(
        "Network Device project ID is required to provision a monitor.",
      );
    }

    if (
      monitorTemplate.projectId.toString() !==
      networkDevice.projectId.toString()
    ) {
      throw new BadDataException(
        "Monitor template and Network Device must belong to the same project.",
      );
    }

    if (monitorTemplate.monitorType !== MonitorType.NetworkDevice) {
      throw new BadDataException(
        `Monitor template must have type "${MonitorType.NetworkDevice}" to provision a Network Device monitor.`,
      );
    }

    this.validateMonitorSteps(monitorTemplate.monitorSteps, "Monitor template");

    const monitor: Monitor = new Monitor();
    monitor.projectId = new ObjectID(networkDevice.projectId.toString());
    monitor.name = this.buildDeviceIdentifiableName({
      monitorTemplate,
      networkDevice,
    });
    if (monitorTemplate.monitorDescription !== undefined) {
      monitor.description = monitorTemplate.monitorDescription;
    }
    monitor.monitorType = MonitorType.NetworkDevice;
    monitor.monitorSteps = this.rebindMonitorSteps({
      monitorSteps: monitorTemplate.monitorSteps,
      networkDeviceId,
    });
    if (monitorTemplate.monitoringInterval !== undefined) {
      monitor.monitoringInterval = monitorTemplate.monitoringInterval;
    }
    if (monitorTemplate.minimumProbeAgreement !== undefined) {
      monitor.minimumProbeAgreement = monitorTemplate.minimumProbeAgreement;
    }
    if (monitorTemplate.customFields !== undefined) {
      monitor.customFields = this.cloneCustomFields(
        monitorTemplate.customFields,
      );
    }
    if (monitorTemplate.labels !== undefined) {
      monitor.labels = [...monitorTemplate.labels];
    }
    monitor.monitorTemplateId = new ObjectID(monitorTemplateId.toString());
    monitor.autoProvisionedNetworkDeviceId = new ObjectID(
      networkDeviceId.toString(),
    );

    return monitor;
  }

  public static validateMonitorSteps(
    monitorSteps: MonitorSteps | JSONObject | undefined,
    subject: string = "Network Device monitor",
  ): void {
    const normalizedSteps: MonitorSteps = this.normalizeMonitorSteps(
      monitorSteps,
      subject,
    );

    if (
      !Array.isArray(normalizedSteps.data?.monitorStepsInstanceArray) ||
      normalizedSteps.data.monitorStepsInstanceArray.length === 0
    ) {
      throw new BadDataException(`${subject} monitor steps are required.`);
    }

    for (const step of normalizedSteps.data.monitorStepsInstanceArray) {
      if (!step.data?.networkDeviceMonitor) {
        throw new BadDataException(
          `${subject} contains a Network Device step without Network Device configuration.`,
        );
      }
    }
  }

  public static getReferencedNetworkDeviceIds(
    monitorSteps: MonitorSteps | JSONObject | undefined,
  ): Set<string> {
    this.validateMonitorSteps(monitorSteps);
    const normalizedSteps: MonitorSteps = this.normalizeMonitorSteps(
      monitorSteps,
      "Network Device monitor",
    );
    const ids: Set<string> = new Set();

    for (const step of normalizedSteps.data!.monitorStepsInstanceArray) {
      const networkDeviceId: string =
        step.data!.networkDeviceMonitor!.networkDeviceId?.trim() || "";
      if (networkDeviceId) {
        ids.add(networkDeviceId);
      }
    }

    return ids;
  }

  public static assertMonitorStepsBoundToNetworkDevice(data: {
    monitorSteps: MonitorSteps | JSONObject | undefined;
    networkDeviceId: ObjectID | string;
  }): void {
    const expectedId: string = data.networkDeviceId.toString();
    const referencedIds: Set<string> = this.getReferencedNetworkDeviceIds(
      data.monitorSteps,
    );

    if (referencedIds.size !== 1 || !referencedIds.has(expectedId)) {
      throw new BadDataException(
        "An auto-provisioned Network Device monitor cannot be retargeted. Delete it and create a manual monitor for a different device instead.",
      );
    }
  }

  private static normalizeMonitorSteps(
    monitorSteps: MonitorSteps | JSONObject | undefined,
    subject: string,
  ): MonitorSteps {
    if (monitorSteps instanceof MonitorSteps) {
      return monitorSteps;
    }

    if (!monitorSteps) {
      throw new BadDataException(`${subject} monitor steps are required.`);
    }

    try {
      return MonitorSteps.fromJSON(monitorSteps);
    } catch {
      throw new BadDataException(`${subject} monitor steps are invalid.`);
    }
  }

  private static buildDeviceIdentifiableName(data: {
    monitorTemplate: MonitorTemplate;
    networkDevice: NetworkDevice;
  }): string {
    const networkDeviceId: string = data.networkDevice.id!.toString();
    const deviceIdentity: string =
      data.networkDevice.name?.trim() ||
      data.networkDevice.hostname?.trim() ||
      `Network Device ${networkDeviceId}`;
    const templateMonitorName: string =
      data.monitorTemplate.monitorName?.trim() || "";

    /*
     * The suffix is OPT-IN (issue #3486). A template with no default monitor
     * name names its monitors after the device and nothing else, because the
     * alternative — the old `|| "Monitor"` fallback — was an invented suffix
     * on an estate the operator never asked to have suffixed. A template that
     * DOES carry a name keeps the composed form, which is what tells two
     * templates apart on the same device.
     */
    const composedName: string = templateMonitorName
      ? `${deviceIdentity}${MONITOR_NAME_SEPARATOR}${templateMonitorName}`
      : deviceIdentity;

    const truncatedName: string = this.truncateWithoutSplittingSurrogatePair(
      composedName,
      MAX_PROVISIONED_MONITOR_NAME_LENGTH,
    );

    /*
     * The device identity leads, so a cap reached inside the separator leaves
     * the name trailing " ", " -" or " - " — a suffix that is visibly half
     * there. Everything that survived such a cut IS the device identity, so
     * return that rather than the remnant. Checked by LENGTH rather than by
     * trailing characters, so a device genuinely named "Router A -" keeps its
     * own trailing hyphen when nothing was cut at all.
     */
    if (
      truncatedName.length > deviceIdentity.length &&
      truncatedName.length <=
        deviceIdentity.length + MONITOR_NAME_SEPARATOR.length
    ) {
      return deviceIdentity;
    }

    return truncatedName;
  }

  private static truncateWithoutSplittingSurrogatePair(
    value: string,
    maximumLength: number,
  ): string {
    if (value.length <= maximumLength) {
      return value;
    }

    const truncated: string = value.substring(0, maximumLength);
    const finalCodeUnit: number = truncated.charCodeAt(truncated.length - 1);

    // A cut between an astral character's UTF-16 surrogate pair is invalid.
    if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
      return truncated.substring(0, truncated.length - 1);
    }

    return truncated;
  }

  private static cloneCustomFields(customFields: JSONObject): JSONObject {
    return JSONFunctions.deserialize(JSONFunctions.serialize(customFields));
  }
}
