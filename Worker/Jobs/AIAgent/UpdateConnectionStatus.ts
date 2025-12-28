import OneUptimeDate from "Common/Types/Date";
import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AIAgentService from "Common/Server/Services/AIAgentService";
import logger from "Common/Server/Utils/Logger";
import AIAgent, {
  AIAgentConnectionStatus,
} from "Common/Models/DatabaseModels/AIAgent";

RunCron(
  "AIAgent:UpdateConnectionStatus",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    logger.debug("Checking AIAgent:UpdateConnectionStatus");

    const aiAgents: Array<AIAgent> = await AIAgentService.findAllBy({
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
    });

    logger.debug(`Found ${aiAgents.length} AI agents`);

    logger.debug(aiAgents);

    for (const aiAgent of aiAgents) {
      try {
        // if the lastAlive is more than 2 minutes old, then set the connection status to false

        if (!aiAgent.id) {
          continue;
        }

        let connectionStatus: AIAgentConnectionStatus =
          AIAgentConnectionStatus.Connected;

        if (!aiAgent.lastAlive) {
          connectionStatus = AIAgentConnectionStatus.Disconnected;
        }

        if (
          aiAgent.lastAlive &&
          OneUptimeDate.getDifferenceInMinutes(
            OneUptimeDate.getCurrentDate(),
            aiAgent.lastAlive,
          ) > 2
        ) {
          connectionStatus = AIAgentConnectionStatus.Disconnected;
        } else {
          connectionStatus = AIAgentConnectionStatus.Connected;
        }

        if (!aiAgent.lastAlive) {
          connectionStatus = AIAgentConnectionStatus.Disconnected;
        }

        let shouldUpdateConnectionStatus: boolean = false;

        if (aiAgent.connectionStatus !== connectionStatus) {
          shouldUpdateConnectionStatus = true;
        }

        if (!shouldUpdateConnectionStatus) {
          continue; // no need to update the connection status.
        }

        // now update the connection status
        aiAgent.connectionStatus = connectionStatus;

        if (shouldUpdateConnectionStatus) {
          await AIAgentService.updateOneById({
            id: aiAgent.id!,
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
