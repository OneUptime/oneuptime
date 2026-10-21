import DataMigrationBase from "./DataMigrationBase";
import FileService from "Common/Server/Services/FileService";
import logger from "Common/Server/Utils/Logger";

/*
 * A private incident or incident episode is never shown on a status page
 * (StatusPageVisibility), and the images in its description, postmortem
 * and custom fields are not public while it is private (PublishedImages).
 * One stored private with Visible on Status Page still on had them made
 * public as if it were shown; the schema migration
 * HidePrivateIncidentsFromStatusPages switches that visibility off, and
 * this makes each such image private again - unless a published record
 * still shows it, or it is an icon (FileService.hideImagesOfPrivateRecords).
 *
 * Postgres-only. Idempotent, and safe to run twice at once: it moves only
 * public files a private record holds and nothing published shows.
 */
export default class HideImagesOfPrivateIncidents extends DataMigrationBase {
  public constructor() {
    super("HideImagesOfPrivateIncidents");
  }

  public override async migrate(): Promise<void> {
    const madePrivate: number = await FileService.hideImagesOfPrivateRecords();

    logger.info(
      `HideImagesOfPrivateIncidents: made ${madePrivate} image(s) of private incidents and episodes private.`,
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
