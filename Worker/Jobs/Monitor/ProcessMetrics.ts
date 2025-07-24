import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { EVERY_FIFTEEN_SECOND } from "Common/Utils/CronTime";
import logger from "Common/Server/Utils/Logger";
import Redis from "Common/Server/Infrastructure/Redis";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";

// Background job to process monitor metrics that have been queued
// This allows monitor status changes to happen immediately without waiting for metric storage

RunCron(
  "Monitor:ProcessQueuedMetrics",
  { schedule: EVERY_FIFTEEN_SECOND, runOnStartup: false },
  async () => {
    try {
      // Process metrics from Redis queue
      const metricsToProcess = await Redis.lpop("monitor:metrics:queue", 100);
      
      if (!metricsToProcess || metricsToProcess.length === 0) {
        return;
      }

      logger.info(`Processing ${metricsToProcess.length} queued monitor metrics`);

      for (const metricData of metricsToProcess) {
        try {
          const parsedData = JSON.parse(metricData);
          
          
          // Process the metric data
          await MonitorResourceUtil.saveMonitorMetrics(parsedData);
          
        } catch (err) {
          logger.error("Failed to process queued metric:", err);
          // Could implement retry logic here
        }
      }
      
    } catch (err) {
      logger.error("Error processing monitor metrics queue:", err);
    }
  },
);
