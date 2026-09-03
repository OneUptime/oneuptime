import PingMonitorSeedIds from "./PingMonitorSeedIds";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  MonitorCriteriaSeedIds,
  PingMonitorOrigin,
  buildPingMonitorForAddress,
} from "Common/Utils/NetworkDiscovery/PingMonitorBuilder";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * "Create a Ping monitor for this device and bind it" — the one client-side
 * sequence three surfaces share:
 *
 *   - the device create form, when "Create a Ping monitor" is ticked;
 *   - the "Create Ping Monitor" button on a device's Overview and Monitors
 *     pages (which creates the monitor through the monitor form and then
 *     only needs the bind half, `bindMonitorToDevice`);
 *   - the device list's bulk "Create Ping Monitors" action.
 *
 * Discovery import has its own copy of the create half (Discovery.tsx,
 * createPingMonitorForHost) because it attaches the SCAN's probe and creates
 * the monitor before the device exists; it is left alone on purpose.
 *
 * ORDER OF OPERATIONS. The device already exists on every path here, so the
 * monitor is created first and then bound. Binding re-stamps the device with
 * the monitor's current status through NetworkDeviceService.onUpdateSuccess,
 * so the status pill resolves on the next render rather than waiting for the
 * monitor's next status CHANGE (OneUptime/oneuptime#3392). A monitor whose
 * bind then fails is deleted again: a monitor is billable and plan-limited,
 * and one that reports on nothing is exactly the orphan an operator cannot
 * see the reason for.
 *
 * WHAT A FRESH MONITOR SAYS. MonitorService stamps a new monitor with the
 * project's operational status at create time, before any probe has
 * checked the address, so the device reads Up the moment it is bound. The
 * success copy below therefore says the monitor was created and bound and
 * when its first REAL result will land; it never claims the device has been
 * verified reachable.
 */

export interface ProvisionPingMonitorData {
  deviceId: ObjectID;
  deviceName: string;
  // The device's hostname column: an IP or a name, whatever the operator typed.
  address: string;
  /*
   * Probe ids to attach. EMPTY means "let the server pick the project's
   * defaults": the server treats an explicit empty `probes` selection as "no
   * probes at all" (MonitorService.getSelectedProbeIdsFromMiscDataProps),
   * which would create a monitor nothing ever evaluates — so an empty list is
   * translated into no `probes` key rather than an empty one.
   */
  probeIds: Array<string>;
  origin: PingMonitorOrigin;
  /*
   * Resolved once by a caller that provisions in bulk; resolved here when
   * omitted. They describe the project, not the device.
   */
  seedIds?: MonitorCriteriaSeedIds | undefined;
}

export interface ProvisionedPingMonitor {
  monitorId: ObjectID;
  monitorName: string;
}

/**
 * What the operator is told after a successful provision. Shared so the
 * create form, the device page and the bulk action say the same thing — and
 * so a test can pin that none of them claims the device was verified.
 *
 * It no longer says the device "carries the monitor's starting status". That
 * was true when a device's status came from a monitor; under probe polling
 * the device already has a status of its own from its probe's first poll,
 * and the monitor is there to raise incidents. Saying otherwise would tell
 * an operator to go and look at the wrong thing while they wait.
 */
export function pingMonitorProvisionedMessage(monitorName: string): string {
  return `Ping monitor "${monitorName}" was created for this device and will raise incidents when the ping fails. Its first result lands within the monitor's interval. The device's own status still comes from its probe's poll.`;
}

/**
 * The miscDataProps a monitor create carries for a probe selection.
 *
 * Exported so the "empty means default probes" rule is pinned in one place:
 * `[]` is truthy, ModelForm forwards any truthy override value, and the
 * server honours an explicit empty selection as "attach nothing".
 */
export function probeMiscDataProps(probeIds: Array<string>): JSONObject {
  const cleaned: Array<string> = probeIds
    .map((probeId: string): string => {
      return String(probeId || "").trim();
    })
    .filter((probeId: string): boolean => {
      return probeId.length > 0;
    });

  return cleaned.length > 0 ? { probes: cleaned } : {};
}

/**
 * Remove a monitor created moments ago whose bind then failed. Swallows its
 * own errors: the operator needs the bind failure, not a second message
 * about the cleanup of it. A monitor that survives this is visible and
 * deletable in the monitor list.
 */
export async function deleteMonitorQuietly(monitorId: ObjectID): Promise<void> {
  try {
    await ModelAPI.deleteItem<Monitor>({
      modelType: Monitor,
      id: monitorId,
    });
  } catch {
    // Intentionally ignored - see above.
  }
}

/**
 * Point a device at a monitor. The server validates that the monitor
 * belongs to the device's project and re-stamps the device's status.
 */
export async function bindMonitorToDevice(data: {
  deviceId: ObjectID;
  monitorId: ObjectID;
}): Promise<void> {
  await ModelAPI.updateById<NetworkDevice>({
    modelType: NetworkDevice,
    id: data.deviceId,
    data: {
      monitorId: data.monitorId.toString(),
    },
  });
}

/**
 * Create a Ping monitor on the device's address and bind it to the device.
 *
 * Throws a BadDataException whose message names what failed and what to do
 * about it; a monitor that was created but could not be bound has already
 * been deleted again by the time the error reaches the caller.
 */
export async function provisionPingMonitorForDevice(
  data: ProvisionPingMonitorData,
): Promise<ProvisionedPingMonitor> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    throw new BadDataException(
      "No project is selected, so a Ping monitor cannot be created.",
    );
  }

  const seedIds: MonitorCriteriaSeedIds =
    data.seedIds || (await PingMonitorSeedIds.resolve());

  const monitor: Monitor = buildPingMonitorForAddress({
    projectId: projectId,
    address: data.address,
    deviceName: data.deviceName,
    seedIds: seedIds,
    origin: data.origin,
  });

  const response: HTTPResponse<
    JSONObject | JSONArray | Monitor | Array<Monitor>
  > = await ModelAPI.create<Monitor>({
    model: monitor,
    modelType: Monitor,
    miscDataProps: probeMiscDataProps(data.probeIds),
  });

  /*
   * `?? undefined` rather than a bare `?.id`: BaseModel.id is `ObjectID |
   * null`, and the annotation below refuses `null` under strictNullChecks.
   */
  const createdMonitorId: ObjectID | undefined =
    (response.data as Monitor | undefined)?.id ?? undefined;

  if (!createdMonitorId) {
    throw new BadDataException(
      "The Ping monitor was created but the server did not return its id, so it could not be bound to this device. Bind it under the device's Settings.",
    );
  }

  try {
    await bindMonitorToDevice({
      deviceId: data.deviceId,
      monitorId: createdMonitorId,
    });
  } catch (err) {
    await deleteMonitorQuietly(createdMonitorId);

    throw new BadDataException(
      `The Ping monitor was created but could not be bound to this device, so it was removed again: ${API.getFriendlyMessage(
        err,
      )}`,
    );
  }

  return {
    monitorId: createdMonitorId,
    monitorName: monitor.name || "",
  };
}
