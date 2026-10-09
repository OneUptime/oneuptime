import RunCron from "../../Utils/Cron";
import { EVERY_HOUR, EVERY_MINUTE } from "Common/Utils/CronTime";
import PacketCaptureService from "Common/Server/Services/PacketCaptureService";
import logger from "Common/Server/Utils/Logger";

/*
 * The two clocks of a packet capture, run as jobs because no probe is there
 * to run them:
 *
 *   - every minute, captures nobody will finish are failed with the reason:
 *     one its probe did not pick up within five minutes (disconnected, or
 *     captures turned off), one its probe stopped naming (restarted, lost its
 *     connection), and one past its duration and upload grace. Without this
 *     a capture would sit Pending or Running for ever, holding one of its
 *     probe's two capture slots.
 *   - every hour, captures older than the retention period are deleted with
 *     their files: a capture holds the traffic itself, so it is kept for the
 *     investigation, not for ever.
 */
RunCron(
  "PacketCapture:FailStaleCaptures",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    try {
      const failed: number = await PacketCaptureService.failStaleCaptures();

      if (failed > 0) {
        logger.info(`PacketCapture: failed ${failed} stale capture(s).`);
      }
    } catch (error) {
      logger.error("PacketCapture: the stale capture sweep failed.");
      logger.error(error);
    }
  },
);

RunCron(
  "PacketCapture:DeleteExpiredCaptures",
  { schedule: EVERY_HOUR, runOnStartup: false },
  async () => {
    try {
      const deleted: number =
        await PacketCaptureService.deleteExpiredCaptures();

      if (deleted > 0) {
        logger.info(
          `PacketCapture: deleted ${deleted} expired capture(s) and their files.`,
        );
      }
    } catch (error) {
      logger.error("PacketCapture: the retention sweep failed.");
      logger.error(error);
    }
  },
);
