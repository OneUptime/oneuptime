import CredentialsAtRest, {
  CredentialsAtRestGroup,
  CredentialsGroupPass,
} from "../../../../FeatureSet/Workers/Utils/CredentialsAtRest";
import { SETTLE_PERIOD_MS } from "Common/Server/Utils/PresentedKey/PresentedKeysAtRest";

/*
 * What the upgrade, and the day after it, do to the values one data
 * migration names (#9266):
 *
 *   - at the upgrade, the data migration runs and changes nothing, so a
 *     server of the release before reads every value as it did;
 *   - a day later, the CredentialsAtRest:EncryptInPlace job makes its pass
 *     over the migration's columns and encrypts each value still stored as
 *     written, in place.
 *
 * encryptInPlaceADayLater is that pass, as the job makes it.
 */

// The job's group of a data migration's columns.
export function credentialsGroupOf(
  migrationName: string,
): CredentialsAtRestGroup {
  const group: CredentialsAtRestGroup | undefined =
    CredentialsAtRest.getGroups().find(
      (candidate: CredentialsAtRestGroup): boolean => {
        return candidate.migrationName === migrationName;
      },
    );

  if (!group) {
    throw new Error(`CredentialsAtRest has no group for ${migrationName}`);
  }

  return group;
}

// The job's pass over a data migration's columns, a day after it ran.
export async function encryptInPlaceADayLater(
  migrationName: string,
): Promise<CredentialsGroupPass> {
  return await credentialsGroupOf(migrationName).pass({
    startedAt: new Date(Date.now() - SETTLE_PERIOD_MS),
  });
}
