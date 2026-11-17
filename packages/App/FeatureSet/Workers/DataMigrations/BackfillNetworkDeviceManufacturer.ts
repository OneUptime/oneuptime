import DataMigrationBase from "./DataMigrationBase";
import NetworkDeviceService, {
  ManufacturerBackfillPage,
} from "Common/Server/Services/NetworkDeviceService";
import logger from "Common/Server/Utils/Logger";

/*
 * NetworkDevice.manufacturer (issue #9363), added by the schema migration
 * AddNetworkDeviceManufacturer: the maker a device's Vendor / Model column,
 * its page and its Inventory item name it by, kept on the device so the
 * Devices, Archived and site lists can filter and sort by it.
 *
 * A device created or changed from now on has it. This works it out for
 * every device that exists, a page at a time by id, archived ones included
 * (NetworkDeviceService.backfillManufacturerPage, which writes each device
 * with refreshManufacturer). Until it has run, a device it has not reached
 * is found by no Vendor filter: the lists show it as before.
 *
 * Postgres only. Safe to run twice at once: a device's maker is written only
 * while the device still holds what it was worked out from, so two runs - or
 * a run and a poll - never store a maker worked out from details the device
 * no longer has, and a second run finds nothing left to write. A page that
 * fails is tried again; one that keeps failing stops the run, which is not
 * recorded as done, so the next boot does it again.
 */

export const PAGE_SIZE: number = 500;

// Tries one page gets, so a lock timeout against a poll is not the end.
export const PAGE_ATTEMPTS: number = 3;

export default class BackfillNetworkDeviceManufacturer extends DataMigrationBase {
  public constructor() {
    super("BackfillNetworkDeviceManufacturer");
  }

  public override async migrate(): Promise<void> {
    let afterId: string | undefined = undefined;
    let read: number = 0;
    let written: number = 0;
    let pages: number = 0;

    while (true) {
      const page: ManufacturerBackfillPage = await this.readPage(afterId);
      read += page.read;
      written += page.written;
      pages++;

      if (page.read < PAGE_SIZE || !page.lastId) {
        break;
      }

      afterId = page.lastId;
    }

    logger.info(
      `BackfillNetworkDeviceManufacturer: the maker of ${read} network devices worked out, ${written} written, in ${pages} pages.`,
    );
  }

  public override async rollback(): Promise<void> {
    // The column goes with the schema migration's down(); nothing to undo here.
    return;
  }

  private async readPage(
    afterId: string | undefined,
  ): Promise<ManufacturerBackfillPage> {
    for (let attempt: number = 1; ; attempt++) {
      try {
        return await NetworkDeviceService.backfillManufacturerPage({
          afterId: afterId,
          limit: PAGE_SIZE,
        });
      } catch (err) {
        if (attempt >= PAGE_ATTEMPTS) {
          throw err;
        }

        logger.warn(
          `BackfillNetworkDeviceManufacturer: a page after ${afterId ?? "the first id"} failed (attempt ${attempt} of ${PAGE_ATTEMPTS}); trying it again.`,
        );
        logger.warn(err);
      }
    }
  }
}
