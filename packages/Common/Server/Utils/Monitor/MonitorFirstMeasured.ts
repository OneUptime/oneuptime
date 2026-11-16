import MonitorService from "../../Services/MonitorService";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OneUptimeDate from "../../../Types/Date";
import IncomingEmailMonitorRequest from "../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ServerMonitorResponse from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";
import DataToProcess from "./DataToProcess";

/*
 * THE FIRST TIME SOMETHING MEASURES A MONITOR (issue #8899).
 *
 * Monitor.firstMeasuredAt is empty while nothing has measured the monitor,
 * and the Monitors list, the Monitor List widget and status pages read that
 * to say it is waiting for its first check instead of drawing the
 * operational status every monitor is created in
 * (Utils/Monitor/MonitorFirstCheck).
 *
 * MonitorResourceUtil.monitorResource is where every probe result, incoming
 * request, email, server report and evaluation (telemetry, a network
 * device's poll or trap, a Probe Status monitor's minute) is accepted for a
 * monitor, once it has passed every refusal: archived, monitoring off,
 * paused, project blocked, a probe that is not the monitor's own. It reads
 * firstMeasuredAt with the monitor and, while it is empty, stamps it here.
 *
 * What is not a measurement: a heartbeat sweep's evaluation of what has NOT
 * arrived. The incoming request, incoming email and server sweeps judge a
 * monitor from the last arrival they hold - from its creation when there
 * is none - so a monitor no heartbeat ever reached can be judged Offline
 * (a status it shows as it is), but is still waiting for its first.
 *
 * The stamp is one statement, written once in the monitor's life: guarded
 * on the column still being empty, so two first results stamp it once, and
 * skipping a row another writer holds rather than queueing behind it - the
 * Monitor row is written by every heartbeat. A stamp that is skipped or
 * fails is taken again by the next measurement, which reads the column
 * again. It never fails the result it is stamped for.
 */
export default class MonitorFirstMeasured {
  // What monitorResource reads the monitor with, for stampIfFirst.
  public static readonly SELECT: { firstMeasuredAt: true } = {
    firstMeasuredAt: true,
  };

  /*
   * Whether this result measured the monitor: anything but a heartbeat
   * sweep's re-evaluation of the arrival it already held.
   */
  public static isMeasurement(dataToProcess: DataToProcess): boolean {
    if (
      (dataToProcess as IncomingMonitorRequest)
        .onlyCheckForIncomingRequestReceivedAt === true
    ) {
      return false;
    }

    if (
      (dataToProcess as IncomingEmailMonitorRequest)
        .onlyCheckForIncomingEmailReceivedAt === true
    ) {
      return false;
    }

    if (
      (dataToProcess as ServerMonitorResponse).onlyCheckRequestReceivedAt ===
      true
    ) {
      return false;
    }

    return true;
  }

  /*
   * Stamps firstMeasuredAt now, if this result is a measurement and the
   * monitor (read with SELECT) has none yet. True when it was written.
   */
  public static async stampIfFirst(data: {
    monitor: Pick<Monitor, "id" | "firstMeasuredAt">;
    dataToProcess: DataToProcess;
  }): Promise<boolean> {
    if (data.monitor.firstMeasuredAt || !data.monitor.id) {
      return false;
    }

    if (!MonitorFirstMeasured.isMeasurement(data.dataToProcess)) {
      return false;
    }

    return await MonitorFirstMeasured.stamp({
      monitorId: data.monitor.id,
      at: OneUptimeDate.getCurrentDate(),
    });
  }

  /*
   * A manual monitor is stamped when it is created: nothing will ever
   * measure it, and its status is the one a person sets, from the start
   * (Monitor.firstMeasuredAt). Any other type waits for its first result.
   */
  public static async stampManualMonitorOnCreate(data: {
    monitorId: ObjectID;
    monitorType: MonitorType | undefined;
    createdAt: Date | undefined;
  }): Promise<boolean> {
    if (data.monitorType !== MonitorType.Manual) {
      return false;
    }

    /*
     * Waits for the row rather than skipping it: a monitor is created once,
     * and nothing else will stamp a manual one if this does not.
     */
    return await MonitorFirstMeasured.stamp({
      monitorId: data.monitorId,
      at: data.createdAt || OneUptimeDate.getCurrentDate(),
      isWaitingForTheRow: true,
    });
  }

  private static async stamp(data: {
    monitorId: ObjectID;
    at: Date;
    isWaitingForTheRow?: boolean | undefined;
  }): Promise<boolean> {
    try {
      if (data.isWaitingForTheRow) {
        await MonitorService.updateColumnsByIdWithoutHooks({
          id: data.monitorId,
          data: {
            firstMeasuredAt: data.at,
          },
          // Once: a monitor another result stamped first keeps that time.
          expectedData: {
            firstMeasuredAt: null,
          } as any,
          // Bookkeeping, not a change anyone made to the monitor.
          skipUpdateDateColumn: true,
        });
        return true;
      }

      /*
       * Never queues behind another writer of the row (a heartbeat, a
       * status change): a stamp skipped is taken by the next result.
       */
      return await MonitorService.updateColumnsByIdIfUnlockedWithoutHooks({
        id: data.monitorId,
        data: {
          firstMeasuredAt: data.at,
        },
        expectedData: {
          firstMeasuredAt: null,
        } as any,
        skipUpdateDateColumn: true,
      });
    } catch (err) {
      logger.error(
        `Could not record that monitor ${data.monitorId.toString()} has been measured. The next result records it.`,
      );
      logger.error(err);
      return false;
    }
  }
}
