import Monitor from "../../../Models/DatabaseModels/Monitor";
import { MonitorFeedEventType } from "../../../Models/DatabaseModels/MonitorFeed";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import URL from "../../../Types/API/URL";
import { Gray500 } from "../../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import NetworkDeviceTieSource, {
  mayOneUptimeChangeTie,
} from "../../../Types/NetworkDevice/NetworkDeviceTieSource";
import ObjectID from "../../../Types/ObjectID";
import { DeviceSeenFrom } from "../../../Utils/NetworkDevice/DeviceAddressScope";
import { getMonitorCheckedHost } from "../../../Utils/NetworkDevice/MonitorCheckedHost";
import {
  MonitorTieChange,
  decideTieAfterProbeChange,
} from "../../../Utils/NetworkDevice/MonitorTieAfterProbes";
import { mdText, MarkdownText } from "../../../Utils/Markdown/FeedMarkdown";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import MonitorFeedService from "../../Services/MonitorFeedService";
import MonitorService from "../../Services/MonitorService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import MonitorDeviceLink from "./MonitorDeviceLink";

/*
 * A MONITOR'S TIE, WORKED OUT AGAIN WHEN ITS PROBES CHANGE (OneUptime issue
 * #9904).
 *
 * Which network device a monitor checks depends on where its probes are:
 * two sites can each have a 10.0.0.5 (issue #9677). A probe added to a
 * monitor, or taken off it (a MonitorProbe row created or deleted), can
 * change the device they see at the address it checks, so the rule is
 * asked again (MonitorDeviceLink.seeDeviceAt) and the tie follows it
 * (Utils/NetworkDevice/MonitorTieAfterProbes): a new match is tied, a tie
 * OneUptime made moves or comes off when it no longer fits, and a person's
 * choice is never changed (Monitor.networkDeviceTieSource).
 *
 * What changed is recorded: on the monitor's feed, saying from what to what
 * and why; in the audit log, as the write is OneUptime's own through
 * MonitorService (a system event, kept when the project stores them); and
 * in the server's log.
 *
 * One monitor at a time, under a lock of its own: two probes added at once
 * are two changes, and the second one's answer, read after both, is the one
 * that stays. The write is a compare-and-set on the tie as it was read, so a
 * person's change meanwhile is never overwritten. Never throws: the probe
 * change it follows is saved already.
 */

export const MONITOR_TIE_LOCK_NAMESPACE: string = "NetworkDeviceTie";

export function monitorTieLockKey(monitorId: ObjectID | string): string {
  return `NetworkDeviceTie:Monitor:${monitorId.toString().toLowerCase()}`;
}

// One evaluation and its write, at most.
export const MONITOR_TIE_LOCK_TIMEOUT_MS: number = 60 * 1000;

// How long one waits for another's, before going on without the lock.
export const MONITOR_TIE_LOCK_ACQUIRE_TIMEOUT_MS: number = 30 * 1000;

// What a monitor is read with to decide its tie.
const MONITOR_TIE_SELECT: {
  _id: true;
  projectId: true;
  name: true;
  monitorType: true;
  monitorSteps: true;
  networkDeviceId: true;
  networkDeviceTieSource: true;
  autoProvisionedNetworkDeviceId: true;
} = {
  _id: true,
  projectId: true,
  name: true,
  monitorType: true,
  monitorSteps: true,
  networkDeviceId: true,
  networkDeviceTieSource: true,
  autoProvisionedNetworkDeviceId: true,
};

// What changed, and why, for whoever records it.
export interface MonitorTieFollowed {
  monitorId: string;
  projectId: string;
  change: MonitorTieChange;
  // The address the monitor checks, or empty when it checks no one address.
  host: string;
  // What its probes see there now, or null for no device at all.
  seen: DeviceSeenFrom<NetworkDevice> | null;
}

export default class MonitorTieOnProbeChange {
  /*
   * Follows the probes of each of these monitors, each once, one after the
   * other. Never throws.
   */
  public static async followProbesOf(
    monitorIds: ReadonlyArray<ObjectID | null | undefined>,
  ): Promise<Array<MonitorTieFollowed>> {
    const followed: Array<MonitorTieFollowed> = [];
    const seen: Set<string> = new Set<string>();

    for (const monitorId of monitorIds) {
      const key: string = monitorId?.toString().toLowerCase() || "";

      if (!monitorId || !key || seen.has(key)) {
        continue;
      }

      seen.add(key);

      try {
        const change: MonitorTieFollowed | null =
          await this.followProbesOfMonitor(monitorId);

        if (change) {
          followed.push(change);
        }
      } catch (err) {
        logger.error(
          `Network device tie: could not work out the tie of monitor ${key} again after its probes changed:`,
        );
        logger.error(err);
      }
    }

    return followed;
  }

  // One monitor's tie, under its lock, or null when nothing changed.
  public static async followProbesOfMonitor(
    monitorId: ObjectID,
  ): Promise<MonitorTieFollowed | null> {
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: monitorTieLockKey(monitorId),
        namespace: MONITOR_TIE_LOCK_NAMESPACE,
        lockTimeout: MONITOR_TIE_LOCK_TIMEOUT_MS,
        acquireTimeout: MONITOR_TIE_LOCK_ACQUIRE_TIMEOUT_MS,
      });
    } catch (err) {
      /*
       * Redis gone, or another evaluation of this monitor stuck: the
       * compare-and-set below still keeps a write from overwriting what
       * changed meanwhile.
       */
      logger.debug(
        `Network device tie: going on without the lock on monitor ${monitorId.toString()}: ${err}`,
      );
    }

    try {
      return await this.followUnlocked(monitorId);
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.error(
            `Network device tie: could not release the lock on monitor ${monitorId.toString()}: ${err}`,
          );
        }
      }
    }
  }

  private static async followUnlocked(
    monitorId: ObjectID,
  ): Promise<MonitorTieFollowed | null> {
    const monitor: Monitor | null = await MonitorService.findOneById({
      id: monitorId,
      select: MONITOR_TIE_SELECT,
      props: { isRoot: true },
    });

    if (!monitor?.id || !monitor.projectId) {
      return null;
    }

    const projectId: ObjectID = monitor.projectId;
    const isMadeForDevice: boolean = Boolean(
      monitor.autoProvisionedNetworkDeviceId,
    );

    // A tie OneUptime may not change asks the rule nothing.
    if (
      isMadeForDevice ||
      !mayOneUptimeChangeTie({
        networkDeviceId: monitor.networkDeviceId,
        tieSource: monitor.networkDeviceTieSource,
      })
    ) {
      return null;
    }

    const host: string = getMonitorCheckedHost({
      monitorType: monitor.monitorType,
      monitorSteps: monitor.monitorSteps,
    });

    const seen: DeviceSeenFrom<NetworkDevice> | null = host
      ? await MonitorDeviceLink.seeDeviceAt({
          projectId: projectId,
          host: host,
          getProbeIds: async (): Promise<Array<ObjectID>> => {
            return await MonitorService.getProbeIdsOfMonitor({
              projectId: projectId,
              monitorId: monitor.id,
            });
          },
        })
      : null;

    const seenDeviceId: string =
      seen?.kind === "device" ? seen.device.id?.toString() || "" : "";

    const change: MonitorTieChange | null = decideTieAfterProbeChange({
      linkedDeviceId: monitor.networkDeviceId,
      tieSource: monitor.networkDeviceTieSource,
      isMadeForDevice: isMadeForDevice,
      seenDeviceId: seenDeviceId,
    });

    if (!change) {
      return null;
    }

    const written: number = await MonitorService.updateBy({
      query: {
        _id: monitor.id,
        projectId: projectId,
        // As it was read: a change meanwhile, a person's above all, stays.
        networkDeviceId: monitor.networkDeviceId
          ? monitor.networkDeviceId
          : QueryHelper.isNull(),
        networkDeviceTieSource: monitor.networkDeviceTieSource
          ? monitor.networkDeviceTieSource
          : QueryHelper.isNull(),
        autoProvisionedNetworkDeviceId: QueryHelper.isNull(),
      },
      data: {
        networkDeviceId:
          change.kind === "untie" ? null : new ObjectID(change.deviceId),
        networkDeviceTieSource: NetworkDeviceTieSource.Automatic,
      } as never,
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    if (!written) {
      return null;
    }

    const followed: MonitorTieFollowed = {
      monitorId: monitor.id.toString(),
      projectId: projectId.toString(),
      change: change,
      host: host,
      seen: seen,
    };

    logger.info(
      `Network device tie: monitor ${followed.monitorId} ${MonitorTieOnProbeChange.describeForLog(change)} after its probes changed${host ? ` (it checks ${host})` : ""}.`,
      {
        projectId: followed.projectId,
        monitorId: followed.monitorId,
      } as LogAttributes,
    );

    await this.recordOnFeed({
      followed: followed,
      monitorName: monitor.name || "",
    });

    return followed;
  }

  public static describeForLog(change: MonitorTieChange): string {
    switch (change.kind) {
      case "tie":
        return `was tied to network device ${change.deviceId}`;
      case "retie":
        return `moved from network device ${change.fromDeviceId} to ${change.deviceId}`;
      case "untie":
        return `was untied from network device ${change.fromDeviceId}`;
    }
  }

  /*
   * The line on the monitor's feed that says what changed and why, with
   * links to the devices. Best effort: the tie is written already.
   */
  private static async recordOnFeed(data: {
    followed: MonitorTieFollowed;
    monitorName: string;
  }): Promise<void> {
    try {
      const projectId: ObjectID = new ObjectID(data.followed.projectId);
      const change: MonitorTieChange = data.followed.change;
      const deviceIds: Array<string> = [
        ...(change.kind === "untie" ? [] : [change.deviceId]),
        ...(change.kind === "tie" ? [] : [change.fromDeviceId]),
      ];

      const names: Map<string, string> = await this.readDeviceNames({
        projectId: projectId,
        deviceIds: deviceIds,
      });

      const deviceLink: (deviceId: string) => Promise<MarkdownText> = async (
        deviceId: string,
      ): Promise<MarkdownText> => {
        const link: URL =
          await NetworkDeviceService.getNetworkDeviceLinkInDashboard(
            projectId,
            new ObjectID(deviceId),
          );
        const name: string = names.get(deviceId) || "a network device";

        return mdText`**[${name}](${link.toString()})**`;
      };

      const markdown: MarkdownText = await this.getFeedMarkdown({
        followed: data.followed,
        deviceLink: deviceLink,
      });

      await MonitorFeedService.createMonitorFeedItem({
        monitorId: new ObjectID(data.followed.monitorId),
        projectId: projectId,
        monitorFeedEventType: MonitorFeedEventType.MonitorUpdated,
        displayColor: Gray500,
        feedInfoInMarkdown: markdown.toString(),
      });
    } catch (err) {
      logger.error(
        `Network device tie: could not record on the feed of monitor ${data.followed.monitorId} that its tie changed:`,
      );
      logger.error(err);
    }
  }

  // The feed's words for what changed, and why.
  public static async getFeedMarkdown(data: {
    followed: MonitorTieFollowed;
    deviceLink: (deviceId: string) => Promise<MarkdownText>;
  }): Promise<MarkdownText> {
    const change: MonitorTieChange = data.followed.change;
    const host: string = data.followed.host;

    if (change.kind === "tie") {
      return mdText`🔗 Tied this monitor to network device ${await data.deviceLink(change.deviceId)}: its probes changed, and that is the device they see at ${host}.`;
    }

    if (change.kind === "retie") {
      return mdText`🔗 Moved this monitor from network device ${await data.deviceLink(change.fromDeviceId)} to ${await data.deviceLink(change.deviceId)}: its probes changed, and that is the device they see at ${host} now.`;
    }

    const from: MarkdownText = await data.deviceLink(change.fromDeviceId);

    if (!host) {
      return mdText`🔗 Untied this monitor from network device ${from}: its probes changed, and it checks no single address.`;
    }

    if (data.followed.seen?.kind === "ambiguous") {
      return mdText`🔗 Untied this monitor from network device ${from}: its probes changed, and they see more than one device at ${host} and cannot tell them apart. Tie it to the right one from that device's page.`;
    }

    return mdText`🔗 Untied this monitor from network device ${from}: its probes changed, and they no longer see that device at ${host}.`;
  }

  private static async readDeviceNames(data: {
    projectId: ObjectID;
    deviceIds: Array<string>;
  }): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map<string, string>();

    if (data.deviceIds.length === 0) {
      return names;
    }

    const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(data.deviceIds),
      },
      select: { _id: true, name: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    for (const device of devices) {
      const id: string = device.id?.toString().toLowerCase() || "";

      if (id && device.name) {
        names.set(id, device.name);
      }
    }

    return names;
  }
}
