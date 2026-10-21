import DataMigrationBase from "./DataMigrationBase";
import FileService from "Common/Server/Services/FileService";
import logger from "Common/Server/Utils/Logger";

/*
 * A public note is shown on a status page only with the incident, episode or
 * scheduled maintenance event it belongs to, so the images in it are public
 * only while that record is shown (PublishedImages). Notes used to make their
 * images public whatever their record showed - an image in a public note of a
 * private or hidden incident was public, and kept the incident's own
 * description or postmortem image public when it held the same one. This
 * makes each such image private again: every image a private incident or
 * episode holds, and every image in a public note of a record no status page
 * shows - unless a published record still shows it, or it is an icon
 * (FileService.hideImagesOfHiddenRecords).
 *
 * Postgres-only. Never makes a file public. Idempotent, and safe to run twice
 * at once: it moves only public files such a record holds and nothing
 * published shows.
 */
export default class HideImagesOfHiddenRecordNotes extends DataMigrationBase {
  public constructor() {
    super("HideImagesOfHiddenRecordNotes");
  }

  public override async migrate(): Promise<void> {
    const madePrivate: number = await FileService.hideImagesOfHiddenRecords();

    logger.info(
      `HideImagesOfHiddenRecordNotes: made ${madePrivate} image(s) of public notes and records no status page shows private.`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: which files were public before is not kept, and the
     * rule this sets is the one every write keeps from now on.
     */
    return;
  }
}
