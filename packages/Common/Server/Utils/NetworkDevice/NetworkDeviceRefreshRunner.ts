import NetworkControllerConnection from "../../../Models/DatabaseModels/NetworkControllerConnection";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { NetworkDeviceMonitoringMethodUtil } from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../Types/ObjectID";
import {
  NETWORK_DEVICE_REFRESH_POLL_AT,
  NetworkDeviceRefreshReaders,
  getNetworkDeviceRefreshReaders,
  isNetworkDeviceRefreshPending,
} from "../../../Utils/NetworkDevice/NetworkDeviceRefresh";
import NetworkControllerConnectionService from "../../Services/NetworkControllerConnectionService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import logger from "../Logger";
import NetworkControllerScheduler from "../NetworkController/NetworkControllerScheduler";

/*
 * REFRESH ONE NETWORK DEVICE NOW - the server half of the Refresh button on
 * a device's Inventory card and on its Inventory item's Asset Details card
 * (Utils/NetworkDevice/NetworkDeviceRefresh says what is read, and why
 * discovery scans are not).
 *
 *   1. Its probe, when one polls it: the device goes to the front of the
 *      probe's queue (nextPollAt), so the probe's next fetch - within a
 *      minute - polls it; the poll pipeline copies its Inventory item when
 *      that poll lands (NetworkInventoryUtil).
 *   2. Its controller, when a network controller connection describes it and
 *      is turned on: that connection is read at once (one queued read per
 *      connection at most, however many devices ask), and writes the device's
 *      reading again (NetworkControllerInventory).
 *
 * `refreshRequestedAt` records the ask; both readers compare it with their
 * own last reading. An ask within a minute of one not answered yet is that
 * one: nothing is queued twice, so a double click or two people on one page
 * cost a single poll.
 *
 * A device nothing reads on its own - monitor-backed, without a probe, or
 * with polling off, and no controller describing it - cannot be refreshed,
 * and the answer says why in words the page can show.
 */

export interface NetworkDeviceRefreshAnswer {
  // When the refresh was asked for (ISO, the server's clock).
  requestedAt: string;
  // Its probe reads it within a minute.
  isProbeReading: boolean;
  probeName?: string | undefined;
  // A network controller connection (the Meraki dashboard) reads it again.
  isControllerReading: boolean;
  controllerName?: string | undefined;
  // An earlier ask, not answered yet, is this one.
  wasAlreadyRequested: boolean;
}

export const MONITOR_BACKED_REASON: string =
  "This device is checked by its monitor, so nothing polls it: there is nothing to read again. Its details come from discovery scans of its address.";
export const NO_PROBE_REASON: string =
  "No probe polls this device yet. Pick the probe that reaches it in the device's Settings, then refresh it.";
export const POLLING_OFF_REASON: string =
  "Polling is turned off for this device. Turn it on in the device's Settings to read it again.";

export interface NetworkDeviceRefreshDependencies {
  now?: Date | undefined;
  enqueueControllerRead?:
    | ((connectionId: ObjectID, now: Date) => Promise<void>)
    | undefined;
}

export default class NetworkDeviceRefreshRunner {
  // Why a device cannot be refreshed, in a sentence the page shows.
  public static getCannotRefreshReason(device: NetworkDevice): string {
    if (NetworkDeviceMonitoringMethodUtil.isMonitorBacked(device.monitoringMethod)) {
      return MONITOR_BACKED_REASON;
    }

    if (device.isPollingEnabled === false) {
      return POLLING_OFF_REASON;
    }

    return NO_PROBE_REASON;
  }

  public static async refresh(
    data: {
      projectId: ObjectID;
      deviceId: ObjectID;
    },
    dependencies: NetworkDeviceRefreshDependencies = {},
  ): Promise<NetworkDeviceRefreshAnswer> {
    const now: Date = dependencies.now || new Date();

    const device: NetworkDevice | null = await NetworkDeviceService.findOneBy({
      query: { _id: data.deviceId, projectId: data.projectId },
      select: {
        _id: true,
        projectId: true,
        probeId: true,
        probe: { name: true },
        isPollingEnabled: true,
        monitoringMethod: true,
        hostname: true,
        discoveredDetails: true,
        refreshRequestedAt: true,
        lastPolledAt: true,
      },
      props: { isRoot: true },
    });

    if (!device || !device.id) {
      throw new NotFoundException("This network device does not exist.");
    }

    const readers: NetworkDeviceRefreshReaders =
      getNetworkDeviceRefreshReaders(device);

    /*
     * The connection that describes the device - only when it is still this
     * project's, and turned on: a connection that is off reads nothing.
     */
    let connection: NetworkControllerConnection | null = null;
    const connectionId: string | undefined = readers.controller?.readBy.id;

    if (connectionId && ObjectID.isValidUUID(connectionId)) {
      connection = await NetworkControllerConnectionService.findOneBy({
        query: {
          _id: connectionId,
          projectId: data.projectId,
          isEnabled: true,
        },
        select: { _id: true, name: true },
        props: { isRoot: true },
      });
    }

    if (!readers.isProbePolled && !connection) {
      throw new BadDataException(
        NetworkDeviceRefreshRunner.getCannotRefreshReason(device),
      );
    }

    const answer: (
      requestedAt: Date,
      wasAlreadyRequested: boolean,
      isControllerReading: boolean,
    ) => NetworkDeviceRefreshAnswer = (
      requestedAt: Date,
      wasAlreadyRequested: boolean,
      isControllerReading: boolean,
    ): NetworkDeviceRefreshAnswer => {
      return {
        requestedAt: requestedAt.toISOString(),
        isProbeReading: readers.isProbePolled,
        ...(readers.isProbePolled && device.probe?.name
          ? { probeName: device.probe.name }
          : {}),
        isControllerReading: isControllerReading,
        ...(isControllerReading && connection?.name
          ? { controllerName: connection.name }
          : {}),
        wasAlreadyRequested: wasAlreadyRequested,
      };
    };

    if (
      device.refreshRequestedAt &&
      isNetworkDeviceRefreshPending({
        refreshRequestedAt: device.refreshRequestedAt,
        lastPolledAt: device.lastPolledAt,
        now,
      })
    ) {
      return answer(
        new Date(device.refreshRequestedAt),
        true,
        Boolean(connection),
      );
    }

    await NetworkDeviceService.updateColumnsByIdWithoutHooks({
      id: device.id,
      data: {
        refreshRequestedAt: now,
        ...(readers.isProbePolled
          ? { nextPollAt: NETWORK_DEVICE_REFRESH_POLL_AT }
          : {}),
      } as never,
      /*
       * Never brings a device deleted since the read above back into its
       * probe's queue.
       */
      expectedData: { deletedAt: null } as never,
      skipUpdateDateColumn: true,
    });

    let isControllerReading: boolean = false;

    if (connection?.id) {
      try {
        await (
          dependencies.enqueueControllerRead ||
          ((id: ObjectID, at: Date): Promise<void> => {
            return NetworkControllerScheduler.enqueue(id, at);
          })
        )(connection.id, now);
        isControllerReading = true;
      } catch (error) {
        logger.error(
          `Network device ${device.id.toString()}: a read of its network controller connection could not be queued: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (!readers.isProbePolled && !isControllerReading) {
      throw new BadDataException(
        "The Meraki dashboard could not be asked to read this device again just now. Try again in a minute.",
      );
    }

    return answer(now, false, isControllerReading);
  }
}
