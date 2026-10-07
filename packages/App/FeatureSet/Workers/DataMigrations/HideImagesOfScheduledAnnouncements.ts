import DataMigrationBase from "./DataMigrationBase";
import FileService from "Common/Server/Services/FileService";
import logger from "Common/Server/Utils/Logger";

/*
 * An announcement shows its description - and the images in it - from the
 * time it is shown on (Start Showing Announcement At), so its images are
 * public from then on and private before (PublishedImages). Announcements
 * used to make their images public when they were created, scheduled for
 * later or not. This makes each such image private until its announcement
 * is shown: every public image, addressed by its token, an announcement
 * whose time to be shown has not come holds, of the announcement's own
 * project - unless a published record shows it now, or it is an icon
 * (FileService.hideImagesNotShownYet). The first request for one once the
 * announcement is shown makes it public again.
 *
 * Postgres-only. Never makes a file public. Idempotent, and safe to run
 * twice at once: it moves only public files such an announcement holds and
 * nothing published shows.
 */
export default class HideImagesOfScheduledAnnouncements extends DataMigrationBase {
  public constructor() {
    super("HideImagesOfScheduledAnnouncements");
  }

  public override async migrate(): Promise<void> {
    const madePrivate: number = await FileService.hideImagesNotShownYet();

    logger.info(
      `HideImagesOfScheduledAnnouncements: made ${madePrivate} image(s) of announcements scheduled for later private until they are shown.`,
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
