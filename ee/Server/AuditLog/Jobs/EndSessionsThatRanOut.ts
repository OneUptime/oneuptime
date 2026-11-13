import RunCron from "App/FeatureSet/Workers/Utils/Cron";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
/*
 * IsBillingEnabled is read inside the function body only: the compiled
 * CommonJS reads the live module binding at call time, which is what lets a
 * test pin billing by mocking EnvironmentConfig.
 */
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import UserSessionService from "Common/Server/Services/UserSessionService";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import { SessionLengths } from "Common/Types/UserSession/SessionLength";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";

/*
 * Every five minutes: the sessions that have run out and that nobody has
 * ended yet are ended (UserSessionService.endSessionsThatRanOut), so that
 * each one's Session Timeout is in its person's projects' audit logs within
 * minutes of happening (issue #6762) - not whenever its browser or app next
 * comes back, which for a closed laptop or an uninstalled app is never.
 *
 * Only sessions that are past saving: a refresh token that ran out (30 days
 * without use), and a session length a master admin set. A session past
 * its idle timeout alone is decided at its next renewal, which hears from
 * the browser how long its person has really been away.
 *
 * Only where something records the ends: on OneUptime Cloud, where any
 * project may be on the Enterprise plan, and on a self-hosted installation
 * whose license includes audit logs. Elsewhere the run does nothing; each
 * session is refused at its next refresh all the same.
 *
 * The name is part of the contract with core's EnterpriseLoader, which gives
 * a placeholder to any enterprise job ee does not register: it must never
 * change.
 */
export const END_SESSIONS_THAT_RAN_OUT_JOB_NAME: string =
  "AuditLog:EndSessionsThatRanOut";

export const END_SESSIONS_THAT_RAN_OUT_JOB_TIMEOUT_IN_MS: number =
  OneUptimeDate.convertMinutesToMilliseconds(4);

// Whether ending sessions would record anything here.
export const isRecordingSessionEnds: () => boolean = (): boolean => {
  if (IsBillingEnabled) {
    return true;
  }

  return EnterpriseEdition.isFeatureActive(EnterpriseFeature.AuditLogs);
};

/*
 * One run: how many sessions it ended, or 0 when it had nothing to record
 * them in. Throws when the session lengths cannot be read, so the run fails
 * rather than end sessions by lengths it does not know.
 */
export const endSessionsThatRanOut: () => Promise<number> =
  async (): Promise<number> => {
    if (!isRecordingSessionEnds()) {
      return 0;
    }

    const lengths: SessionLengths | null =
      await EnterpriseEdition.getUserSessionLengths();

    return await UserSessionService.endSessionsThatRanOut(lengths);
  };

RunCron(
  END_SESSIONS_THAT_RAN_OUT_JOB_NAME,
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: END_SESSIONS_THAT_RAN_OUT_JOB_TIMEOUT_IN_MS,
  },
  async (): Promise<void> => {
    try {
      const ended: number = await endSessionsThatRanOut();

      if (ended > 0) {
        logger.debug(
          `${END_SESSIONS_THAT_RAN_OUT_JOB_NAME}: ended ${ended} session(s) that ran out.`,
        );
      }
    } catch (error) {
      logger.error(`${END_SESSIONS_THAT_RAN_OUT_JOB_NAME}: the run failed:`);
      logger.error(error);
    }
  },
);
