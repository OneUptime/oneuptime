import OneUptimeDate from "Common/Types/Date";
import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ProbeService from "CommonServer/Services/ProbeService";
import logger from "CommonServer/Utils/Logger";
import Probe, { ProbeStatus } from "Model/Models/Probe";
import MonitorProbe from "Model/Models/MonitorProbe";
import MonitorProbeService from "CommonServer/Services/MonitorProbeService";

RunCron(
  "Probe:UpdateConnectionStatus",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    logger.debug("Checking Probe:UpdateConnectionStatus");

    const probes: Array<Probe> = await ProbeService.findBy({
      query: {},
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        lastAlive: true,
        connectionStatus: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
    });

    logger.debug(`Found ${probes.length} incoming request monitors`);

    logger.debug(probes);

    for (const probe of probes) {
      try {
        // if the lastAlive is more than 2 minutes old, then set the connection status to false

        if (!probe.id) {
          continue;
        }

        let connectionStatus: ProbeStatus = ProbeStatus.Connected;

        if (!probe.lastAlive) {
          connectionStatus = ProbeStatus.Disconnected;
        }

        if (
          probe.lastAlive &&
          OneUptimeDate.getDifferenceInMinutes(
            OneUptimeDate.getCurrentDate(),
            probe.lastAlive,
          ) > 2
        ) {
          connectionStatus = ProbeStatus.Disconnected;
        } else {
          connectionStatus = ProbeStatus.Connected;
        }

        let shouldNotifyProbeOwner: boolean = false;
        let shouldUpdateConnectionStatus: boolean = false;

        if (
          probe.connectionStatus &&
          probe.connectionStatus !== connectionStatus
        ) {
          shouldNotifyProbeOwner = true;
        }

        if (probe.connectionStatus !== connectionStatus) {
          shouldUpdateConnectionStatus = true;
        }

        // now update the connection status
        probe.connectionStatus = connectionStatus;

        if (shouldUpdateConnectionStatus) {
          await ProbeService.updateOneById({
            id: probe.id!,
            data: {
              connectionStatus: connectionStatus,
            },
            props: {
              isRoot: true,
            },
          });

          const monitorsWithThisProbe: Array<MonitorProbe> =
            await MonitorProbeService.findBy({
              query: {
                probeId: probe.id,
                isEnabled: true,
              },
              props: {
                isRoot: true,
              },
              select: {
                _id: true,
                monitorId: true,
              },
              limit: LIMIT_MAX,
              skip: 0,
            });

          if (shouldNotifyProbeOwner) {
            // notify the probe owner
          }
        }
      } catch (error) {
        logger.error(error);
      }
    }
  },
);
