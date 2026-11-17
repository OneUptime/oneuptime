import PresentedKeysInPlace, {
  PresentedKeyTarget,
  PresentedKeysPass,
} from "./PresentedKeysInPlace";
import DataMigration from "Common/Models/DatabaseModels/DataMigration";
import DataMigrationService from "Common/Server/Services/DataMigrationService";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import PresentedKeysAtRest, {
  LOOKUP_HASH_MIGRATION_NAME,
  PROTECTED_AT_REST_MARKER,
  SETTLE_PERIOD_MS,
  SqlRunner,
} from "Common/Server/Utils/PresentedKey/PresentedKeysAtRest";

// Where a run of the protection stopped.
export enum PresentedKeysProtectionOutcome {
  // The keys are all protected: nothing left to do, ever.
  AlreadyProtected = "already-protected",
  // The lookup hashes have not been written yet: the upgrade has not run.
  NotUpgradedYet = "not-upgraded-yet",
  // Lookup hashes written; the release before may still be running.
  Waiting = "waiting",
  // Every key protected, and recorded so.
  Protected = "protected",
  // Some keys protected; the rest wait for the next run.
  NotDoneYet = "not-done-yet",
}

/*
 * THE PRESENTEDKEYS:PROTECTATREST JOB, A RUN OF IT (#9012).
 *
 * The keys presented to OneUptime that were stored as written - a probe's
 * key, a monitor's secret key, a SCIM bearer token - are protected in two
 * steps, so a server of the release before, which compares a key as
 * written, keeps checking every key while an upgrade rolls out
 * (PresentedKeysAtRest):
 *
 *   - every run writes the lookup hash of each key stored as written
 *     (PresentedKeysInPlace.writeLookupHashes): the keys a server of the
 *     release before made or changed since the upgrade's own pass
 *     (HashPresentedKeysForLookup) are found by their hash too;
 *   - once SETTLE_PERIOD_MS has gone by since that pass, it encrypts or
 *     hashes each key stored as written, in place
 *     (PresentedKeysInPlace.protect), and once none is left, records
 *     PROTECTED_AT_REST_MARKER: from then on no key a request presents is
 *     looked up as written, and every run after this does nothing.
 *
 * Bounded by the run's deadline: what is left waits for the next run.
 */
export default class PresentedKeysProtection {
  public static async run(data: {
    runner: SqlRunner;
    now: Date;
    deadline?: JobDeadline | undefined;
    targets?: Array<PresentedKeyTarget> | undefined;
    settlePeriodInMs?: number | undefined;
  }): Promise<PresentedKeysProtectionOutcome> {
    if (
      await PresentedKeysAtRest.getExecutedAt(
        data.runner,
        PROTECTED_AT_REST_MARKER,
      )
    ) {
      return PresentedKeysProtectionOutcome.AlreadyProtected;
    }

    const lookupHashesWrittenAt: Date | null =
      await PresentedKeysAtRest.getExecutedAt(
        data.runner,
        LOOKUP_HASH_MIGRATION_NAME,
      );

    if (!lookupHashesWrittenAt) {
      return PresentedKeysProtectionOutcome.NotUpgradedYet;
    }

    const targets: Array<PresentedKeyTarget> =
      data.targets || PresentedKeysInPlace.getTargets();

    for (const target of targets) {
      await PresentedKeysInPlace.writeLookupHashes({
        migrationName: "PresentedKeys:ProtectAtRest",
        target: target,
        deadline: data.deadline,
      });
    }

    const settlePeriodInMs: number = data.settlePeriodInMs ?? SETTLE_PERIOD_MS;

    if (
      data.now.getTime() - lookupHashesWrittenAt.getTime() <
      settlePeriodInMs
    ) {
      return PresentedKeysProtectionOutcome.Waiting;
    }

    let isDone: boolean = true;

    for (const target of targets) {
      const pass: PresentedKeysPass = await PresentedKeysInPlace.protect({
        migrationName: "PresentedKeys:ProtectAtRest",
        target: target,
        deadline: data.deadline,
      });

      if (pass.failed > 0 || pass.isCutShort) {
        isDone = false;
      }
    }

    // Only once a read finds nothing left anywhere: a write may have raced.
    for (const target of targets) {
      if (!isDone) {
        break;
      }

      if (await PresentedKeysInPlace.hasKeysStoredAsWritten(target)) {
        isDone = false;
      }
    }

    if (!isDone) {
      return PresentedKeysProtectionOutcome.NotDoneYet;
    }

    await PresentedKeysProtection.recordProtected(data.runner, data.now);

    logger.info(
      "Every key and token presented to OneUptime is now kept encrypted, or as its hash (#9012).",
    );

    return PresentedKeysProtectionOutcome.Protected;
  }

  /*
   * Records that every key is protected (PROTECTED_AT_REST_MARKER), once:
   * two runs at once record it once.
   */
  public static async recordProtected(
    runner: SqlRunner,
    now: Date,
  ): Promise<void> {
    if (
      await PresentedKeysAtRest.getExecutedAt(runner, PROTECTED_AT_REST_MARKER)
    ) {
      return;
    }

    const marker: DataMigration = new DataMigration();
    marker.name = PROTECTED_AT_REST_MARKER;
    marker.executed = true;
    marker.executedAt = now;

    await DataMigrationService.create({
      data: marker,
      props: {
        isRoot: true,
      },
    });
  }
}
