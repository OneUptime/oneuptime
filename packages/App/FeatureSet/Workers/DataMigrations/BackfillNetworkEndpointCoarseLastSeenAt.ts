import DataMigrationBase from "./DataMigrationBase";
import NetworkEndpointService, {
  CoarseLastSeenAtBackfillPage,
} from "Common/Server/Services/NetworkEndpointService";
import logger from "Common/Server/Utils/Logger";

/*
 * NetworkEndpoint.coarseLastSeenAt (#8092), added by the schema migration
 * AddNetworkEndpointCoarseLastSeenAt: lastSeenAt a day at a time, the column
 * the age-out of discovered devices (DiscoveredDeviceAgeOut) now finds its
 * candidates by, so a walk's refresh of lastSeenAt changes no indexed column
 * and can be a HOT update.
 *
 * Every endpoint a walk still sees gets it on its next refresh, within 15
 * minutes. The ones nothing sees any more - exactly the ones the age-out is
 * for - would never get it, so this copies lastSeenAt into it for every live
 * endpoint that was seen and has none, a page at a time by id
 * (NetworkEndpointService.backfillCoarseLastSeenAtPage). Until it has run,
 * the age-out does not find those rows, so it keeps them: it removes less
 * while this runs, never more.
 *
 * Postgres only. Safe to run twice at once: a row is written only while it
 * still has no coarseLastSeenAt, checked again on the row being written, so
 * two runs - or a run and a walk - never write one row twice. A page that
 * fails is tried again; one that keeps failing stops the run, which is not
 * recorded as done, so the next boot carries on from the rows still to write.
 */

export const PAGE_SIZE: number = 1000;

// Tries one page gets, so a lock timeout against a walk is not the end.
export const PAGE_ATTEMPTS: number = 3;

export default class BackfillNetworkEndpointCoarseLastSeenAt extends DataMigrationBase {
  public constructor() {
    super("BackfillNetworkEndpointCoarseLastSeenAt");
  }

  public override async migrate(): Promise<void> {
    let afterId: string | undefined = undefined;
    let written: number = 0;
    let pages: number = 0;

    while (true) {
      const page: CoarseLastSeenAtBackfillPage = await this.readPage(afterId);
      written += page.written;
      pages++;

      if (page.read < PAGE_SIZE || !page.lastId) {
        break;
      }

      afterId = page.lastId;
    }

    logger.info(
      `BackfillNetworkEndpointCoarseLastSeenAt: coarseLastSeenAt written for ${written} endpoints, in ${pages} pages.`,
    );
  }

  public override async rollback(): Promise<void> {
    // The column goes with the schema migration's down(); nothing to undo here.
    return;
  }

  private async readPage(
    afterId: string | undefined,
  ): Promise<CoarseLastSeenAtBackfillPage> {
    for (let attempt: number = 1; ; attempt++) {
      try {
        return await NetworkEndpointService.backfillCoarseLastSeenAtPage({
          afterId: afterId,
          limit: PAGE_SIZE,
        });
      } catch (err) {
        if (attempt >= PAGE_ATTEMPTS) {
          throw err;
        }

        logger.warn(
          `BackfillNetworkEndpointCoarseLastSeenAt: a page after ${afterId ?? "the first id"} failed (attempt ${attempt} of ${PAGE_ATTEMPTS}); trying it again.`,
        );
        logger.warn(err);
      }
    }
  }
}
