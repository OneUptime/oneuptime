import RunCron from "../../Utils/Cron";
import runMonitorSweep from "../../Utils/MonitorSweep";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import MonitorService from "Common/Server/Services/MonitorService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import NetworkDeviceStalePoll from "Common/Server/Utils/Monitor/NetworkDeviceStalePoll";
import OneUptimeDate from "Common/Types/Date";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";

/*
 * A Network Device monitor is evaluated on each poll of its device and on
 * each trap, and on nothing else: when the polls stopped, it kept the status
 * of its last poll and "Device unreachable" never fired. Every five minutes
 * this evaluates each monitor whose device has gone three polling intervals
 * (at least ten minutes) without a poll as a poll that found the device
 * unreachable, saying why none came (NetworkDeviceStalePoll). The next real
 * poll evaluates it again.
 */

export const JOB_NAME: string = "NetworkDeviceMonitor:CheckStalePolls";

const deviceOf: (
  monitor: Monitor,
  deviceId: string,
) => Promise<NetworkDevice | null> = async (
  monitor: Monitor,
  deviceId: string,
): Promise<NetworkDevice | null> => {
  return await NetworkDeviceService.findOneBy({
    query: {
      _id: new ObjectID(deviceId),
      projectId: monitor.projectId!,
    },
    select: {
      _id: true,
      lastPolledAt: true,
      pollingIntervalInMinutes: true,
      isPollingEnabled: true,
      probeId: true,
      hostname: true,
      monitoringMethod: true,
      createdAt: true,
    },
    props: {
      isRoot: true,
    },
  });
};

// Evaluates the steps of one monitor whose device has stopped being polled.
export const checkMonitorForStalePolls: (
  monitor: Monitor,
) => Promise<void> = async (monitor: Monitor): Promise<void> => {
  if (!monitor.id || !monitor.projectId) {
    return;
  }

  const steps: Array<MonitorStep> = (
    monitor.monitorSteps?.data?.monitorStepsInstanceArray || []
  ).filter((step: MonitorStep): boolean => {
    return Boolean(
      step.data?.networkDeviceMonitor?.networkDeviceId &&
        NetworkDeviceStalePoll.canSayUnreachable(step),
    );
  });

  for (const step of steps) {
    const deviceId: string = step.data!.networkDeviceMonitor!.networkDeviceId!;

    try {
      const device: NetworkDevice | null = await deviceOf(monitor, deviceId);
      const now: Date = OneUptimeDate.getCurrentDate();

      const staleReason: string | undefined =
        NetworkDeviceStalePoll.getStaleReason({
          device: device,
          monitorCreatedAt: monitor.createdAt,
          now: now,
        });

      if (!staleReason) {
        continue;
      }

      /*
       * A poll that found the device unreachable, and says why: no walk and
       * no ping ran, so walk-based criteria see "not evaluated". Network
       * Device monitors are not probe monitors (no MonitorProbe row is read
       * or written), so the device's probe is named only when it has one.
       */
      const response: ProbeMonitorResponse = {
        projectId: monitor.projectId,
        monitorId: monitor.id,
        monitorStepId: step.id,
        ...(device?.probeId ? { probeId: device.probeId } : {}),
        isOnline: false,
        failureCause: staleReason,
        monitoredAt: now,
        ingestedAt: now,
      } as ProbeMonitorResponse;

      await MonitorResourceUtil.monitorResource(response);
    } catch (err) {
      logger.error(
        `${JOB_NAME}: could not check monitor ${monitor.id.toString()} for device ${deviceId}:`,
      );
      logger.error(err);
    }
  }
};

RunCron(
  JOB_NAME,
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async () => {
    try {
      await runMonitorSweep({
        jobName: JOB_NAME,
        queries: [
          {
            monitorType: MonitorType.NetworkDevice,
            ...MonitorService.getEnabledMonitorQuery(),
            project: {
              ...ProjectService.getActiveProjectStatusQuery(),
            },
          },
        ],
        select: {
          _id: true,
          projectId: true,
          createdAt: true,
          monitorSteps: true,
        },
        processMonitor: checkMonitorForStalePolls,
      });
    } catch (err) {
      logger.error(`Error in ${JOB_NAME}`);
      logger.error(err);
    }
  },
);
