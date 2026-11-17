import RunCron from "../../Utils/Cron";
import EncryptColumnInPlace from "../../Utils/EncryptColumnInPlace";
import PresentedKeysProtection from "../../Utils/PresentedKeysProtection";
import { EVERY_FIFTEEN_MINUTE, EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import DataMigrationService from "Common/Server/Services/DataMigrationService";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";

/*
 * Protects, in place, the keys and tokens presented to OneUptime that were
 * stored as written (#9012): a day after the upgrade wrote their lookup
 * hashes - once no server of the release before, which compares a key as
 * written, can still be running - each is encrypted, or hashed, where it
 * is. Until then each run writes the lookup hashes of the keys a server of
 * the release before made or changed meanwhile. Once every key is
 * protected, a run does nothing (PresentedKeysProtection).
 *
 * Every 15 minutes, and at startup: one run at a time (CronLock), each
 * bounded by its time limit - what is left waits for the next.
 */
RunCron(
  "PresentedKeys:ProtectAtRest",
  {
    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_FIFTEEN_MINUTE,
    runOnStartup: true,
    timeoutInMS: 10 * 60 * 1000,
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    try {
      await PresentedKeysProtection.run({
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
        `PresentedKeys:ProtectAtRest: protecting the keys presented to OneUptime at rest failed; the next run tries again, and every key keeps working meanwhile: ${EncryptColumnInPlace.describeError(err)}`,
      );
    }
  },
);
