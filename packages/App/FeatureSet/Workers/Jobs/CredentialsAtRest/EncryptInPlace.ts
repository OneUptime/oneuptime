import RunCron from "../../Utils/Cron";
import CredentialsAtRest, {
  CREDENTIALS_AT_REST_JOB_NAME,
} from "../../Utils/CredentialsAtRest";
import EncryptColumnInPlace from "../../Utils/EncryptColumnInPlace";
import { EVERY_FIFTEEN_MINUTE, EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import DataMigrationService from "Common/Server/Services/DataMigrationService";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";

/*
 * Encrypts, in place, the credentials the upgrade left as written (#9266):
 * a day after each data migration that names them ran - once no server of
 * the release before, which reads them as they are stored, can still be
 * running - each value still stored as written is encrypted where it is,
 * those that server saved meanwhile too. Once every value of a migration's
 * columns is encrypted, a run does nothing for them (CredentialsAtRest).
 *
 * Every 15 minutes, and at startup: one run at a time (CronLock), each
 * bounded by its time limit - what is left waits for the next.
 */
RunCron(
  CREDENTIALS_AT_REST_JOB_NAME,
  {
    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_FIFTEEN_MINUTE,
    runOnStartup: true,
    timeoutInMS: 10 * 60 * 1000,
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    try {
      await CredentialsAtRest.run({
        runner: DataMigrationService.getRepository().manager,
        now: OneUptimeDate.getCurrentDate(),
        deadline: deadline,
      });
    } catch (err) {
      /*
       * Described, never logged whole: a driver's error carries its
       * statement's parameters (EncryptColumnInPlace.describeError).
       */
      logger.error(
        `${CREDENTIALS_AT_REST_JOB_NAME}: encrypting the credentials stored as written failed; the next run tries again, and every credential keeps working meanwhile: ${EncryptColumnInPlace.describeError(err)}`,
      );
    }
  },
);
