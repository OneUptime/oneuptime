import DataMigrationBase from "./DataMigrationBase";
import FileService from "Common/Server/Services/FileService";
import logger from "Common/Server/Utils/Logger";

/*
 * A file is public exactly while a record shows it to everyone - an image
 * in a public note, an announcement, a postmortem or an incident's or a
 * maintenance event's description on a status page, a status page's own
 * text - or while it is a probe's or an AI agent's icon (PublishedImages,
 * FileService.makeStoredIconsPublic). Files from before that rule are set
 * to it once, here:
 *
 *   - an image a published record of its own project shows becomes public:
 *     public notes and announcements posted before notes made their images
 *     public, and descriptions on status pages, which never did, show their
 *     images again;
 *   - a public file nothing published shows becomes private: a file uploaded
 *     through the API while uploads still started public is no longer served
 *     to anyone who has its address. An image a published record shows by
 *     its id, an image an incident's custom fields send out, and every icon
 *     stay public, so nothing a status page shows today breaks.
 *
 * Postgres-only. Idempotent, and safe to run twice at once: each statement
 * moves only files that are not yet where they belong.
 */
export default class SetFileVisibilityFromPublishedRecords extends DataMigrationBase {
  public constructor() {
    super("SetFileVisibilityFromPublishedRecords");
  }

  public override async migrate(): Promise<void> {
    const moved: { madePublic: number; madePrivate: number } =
      await FileService.setVisibilityFromPublishedRecords();

    logger.info(
      `SetFileVisibilityFromPublishedRecords: made ${moved.madePublic} image(s) a published record shows public, and ${moved.madePrivate} file(s) nothing published shows private.`,
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
