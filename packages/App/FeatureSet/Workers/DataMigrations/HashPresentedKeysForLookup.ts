import DataMigrationBase from "./DataMigrationBase";
import PresentedKeysInPlace, {
  PresentedKeyTarget,
} from "../Utils/PresentedKeysInPlace";
import { LOOKUP_HASH_MIGRATION_NAME } from "Common/Server/Utils/PresentedKey/PresentedKeysAtRest";

/*
 * The lookup hashes of the keys presented to OneUptime that were stored as
 * written (#9012).
 *
 * A telemetry ingestion key, a monitor's three keys and a workflow's webhook
 * and email keys are each kept encrypted now, and a request that presents
 * one finds its record by the key's lookup hash, kept beside it
 * (TableColumnMetadata.lookupHashColumn). Every key stored before has no
 * hash yet: this writes each one's, in place (PresentedKeysInPlace
 * .writeLookupHashes), and changes no key. So a server of the release before
 * - which compares a key as written, and may still be running while the
 * upgrade rolls out - keeps checking every key, and this release's finds
 * every key by its hash from now on. Until the hashes are written, a key is
 * found as it was written.
 *
 * When this ran starts the wait (PresentedKeysAtRest.SETTLE_PERIOD_MS)
 * after which the PresentedKeys:ProtectAtRest job encrypts, or hashes, the
 * keys stored as written, in place: by then no server of the release
 * before can still be comparing them.
 *
 * Paged, idempotent, and safe to run twice at once: each write lands only
 * while the row still holds the key read. No key is in any statement's
 * parameters, nor in the log.
 */
export default class HashPresentedKeysForLookup extends DataMigrationBase {
  public constructor() {
    super(LOOKUP_HASH_MIGRATION_NAME);
  }

  public override async migrate(): Promise<void> {
    for (const target of HashPresentedKeysForLookup.getTargets()) {
      await PresentedKeysInPlace.writeLookupHashes({
        migrationName: this.name,
        target: target,
      });
    }
  }

  // The columns whose keys a request names its record by alone.
  public static getTargets(): Array<PresentedKeyTarget> {
    return PresentedKeysInPlace.getTargets().filter(
      (target: PresentedKeyTarget): boolean => {
        return Boolean(target.lookupHashColumn);
      },
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
