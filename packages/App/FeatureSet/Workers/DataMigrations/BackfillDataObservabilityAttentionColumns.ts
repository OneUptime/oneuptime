import DataMigrationBase from "./DataMigrationBase";
import DataObservabilityAttentionBackfill, {
  AttentionBackfillPage,
} from "Common/Server/Utils/DataObservability/DataObservabilityAttentionBackfill";
import logger from "Common/Server/Utils/Logger";

/*
 * DataAsset.lateAt, DataPipeline.lateAt and DataCheck.health and
 * healthRank, added by the schema migration
 * AddDataObservabilityAttentionColumnsAndPipelineOwners1809184550000 (#6550,
 * #6552, #6554): when a table or a pipeline is late without a change or a
 * run, and how a check stands now, kept on the row so Tables, Checks and the
 * menu's count read them on the server.
 *
 * A table collected, a pipeline run or a check run from now on has them.
 * This gives every row that exists its value, a page at a time by id
 * (DataObservabilityAttentionBackfill), by the same rules. Until it has run,
 * a row it has not reached is not called late by the Late filter, and a
 * check it has not reached is listed after the others; each one's next
 * collection, run or alert writes it too.
 *
 * Postgres only. Safe to run twice at once: each page writes what the row's
 * own columns say at that moment. A page that fails is tried again; one that
 * keeps failing stops the run, which is not recorded as done, so the next
 * boot does it again.
 */

export const PAGE_SIZE: number = 500;

// Tries one page gets, so a lock timeout against a collection is not the end.
export const PAGE_ATTEMPTS: number = 3;

// Where a page starts, and how many rows it reads.
interface PageArgs {
  afterId?: string | undefined;
  limit: number;
}

type PageReader = (data: PageArgs) => Promise<AttentionBackfillPage>;

export default class BackfillDataObservabilityAttentionColumns extends DataMigrationBase {
  public constructor() {
    super("BackfillDataObservabilityAttentionColumns");
  }

  public override async migrate(): Promise<void> {
    await this.walk("tables", (data: PageArgs) => {
      return DataObservabilityAttentionBackfill.backfillAssetPage(data);
    });
    await this.walk("pipelines", (data: PageArgs) => {
      return DataObservabilityAttentionBackfill.backfillPipelinePage(data);
    });
    await this.walk("checks", (data: PageArgs) => {
      return DataObservabilityAttentionBackfill.backfillCheckPage(data);
    });
  }

  public override async rollback(): Promise<void> {
    // The columns go with the schema migration's down(); nothing to undo here.
    return;
  }

  private async walk(what: string, readPage: PageReader): Promise<void> {
    let afterId: string | undefined = undefined;
    let read: number = 0;
    let written: number = 0;
    let pages: number = 0;

    while (true) {
      const page: AttentionBackfillPage = await this.readPage(
        what,
        readPage,
        afterId,
      );
      read += page.read;
      written += page.written;
      pages++;

      if (page.read < PAGE_SIZE || !page.lastId) {
        break;
      }

      afterId = page.lastId;
    }

    logger.info(
      `BackfillDataObservabilityAttentionColumns: ${read} ${what} read, ${written} written, in ${pages} pages.`,
    );
  }

  private async readPage(
    what: string,
    readPage: PageReader,
    afterId: string | undefined,
  ): Promise<AttentionBackfillPage> {
    for (let attempt: number = 1; ; attempt++) {
      try {
        return await readPage({ afterId: afterId, limit: PAGE_SIZE });
      } catch (err) {
        if (attempt >= PAGE_ATTEMPTS) {
          throw err;
        }

        logger.warn(
          `BackfillDataObservabilityAttentionColumns: a page of ${what} after ${afterId ?? "the first id"} failed (attempt ${attempt} of ${PAGE_ATTEMPTS}); trying it again.`,
        );
        logger.warn(err);
      }
    }
  }
}
