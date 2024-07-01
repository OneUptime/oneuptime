import OneUptimeDate from "Common/Types/Date";
import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ProbeService from "CommonServer/Services/ProbeService";
import logger from "CommonServer/Utils/Logger";
import Probe, { ProbeConnectionStatus } from "Model/Models/Probe";

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
        projectId: true,
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

        let connectionStatus: ProbeConnectionStatus =
          ProbeConnectionStatus.Connected;

        if (!probe.lastAlive) {
          connectionStatus = ProbeConnectionStatus.Disconnected;
        }

        if (
          probe.lastAlive &&
          OneUptimeDate.getDifferenceInMinutes(
            OneUptimeDate.getCurrentDate(),
            probe.lastAlive,
          ) > 2
        ) {
          connectionStatus = ProbeConnectionStatus.Disconnected;
        } else {
          connectionStatus = ProbeConnectionStatus.Connected;
        }

        if (!probe.lastAlive) {
          connectionStatus = ProbeConnectionStatus.Disconnected;
        }

        let shouldUpdateConnectionStatus: boolean = false;

        if (probe.connectionStatus !== connectionStatus) {
          shouldUpdateConnectionStatus = true;
        }

        if (!shouldUpdateConnectionStatus) {
          continue; // no need to update the connection status.
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
        }
      } catch (error) {
        logger.error(error);
      }
    }
  },
);
