import DataMigrationBase from "./DataMigrationBase";
import AlertEpisodeFeedService from "Common/Server/Services/AlertEpisodeFeedService";
import AlertFeedService from "Common/Server/Services/AlertFeedService";
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import FeedAttachmentLinks, {
  FeedAttachmentLinksRewrite,
} from "Common/Server/Utils/Feed/FeedAttachmentLinks";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";

/*
 * Makes the attachment links of old feed entries work.
 *
 * A note's feed entry links the note's files at the route its API serves
 * them at. The routes took the project id in November 2025 and the feed
 * kept writing the address without it until #4925, so every attachment link
 * stored before then - in the feeds of incidents, alerts, scheduled
 * maintenance events and both kinds of episode - is a 404, and the viewer
 * opens it in a tab of its own. Each such entry is rewritten with
 * FeedAttachmentLinks: the entry's project id goes into the address, and
 * the links of the episodes' private notes, which never had a route,
 * become the files' names, as the feed writes them today.
 *
 * Only entries that mention "/attachment/" are read, a batch at a time, and
 * only those with an old link are written - as root, without hooks, so
 * nothing is posted to Slack or Microsoft Teams again and no workflow runs.
 * Idempotent: a rewritten entry has no old link left. One entry's failure
 * is logged and the rest go on. The messages already posted to Slack and
 * Microsoft Teams are theirs, and keep what they said.
 */

export interface FeedRow {
  id: ObjectID | null;
  projectId?: ObjectID | undefined;
  feedInfoInMarkdown?: string | undefined;
}

// The two calls this makes of each feed's service.
export interface FeedTableService {
  findBy: (args: {
    query: Record<string, unknown>;
    select: Record<string, boolean>;
    sort: Record<string, SortOrder>;
    skip: number;
    limit: number;
    props: { isRoot: boolean };
  }) => Promise<Array<FeedRow>>;
  updateOneById: (args: {
    id: ObjectID;
    data: { feedInfoInMarkdown: string };
    props: { isRoot: boolean; ignoreHooks: boolean };
  }) => Promise<unknown>;
}

export interface FeedTable {
  name: string;
  service: FeedTableService;
}

// The feeds a note's entry is written to: those of the records notes are on.
export const FEEDS_WITH_NOTE_ATTACHMENTS: Array<FeedTable> = [
  {
    name: "IncidentFeed",
    service: IncidentFeedService as unknown as FeedTableService,
  },
  {
    name: "AlertFeed",
    service: AlertFeedService as unknown as FeedTableService,
  },
  {
    name: "ScheduledMaintenanceFeed",
    service: ScheduledMaintenanceFeedService as unknown as FeedTableService,
  },
  {
    name: "IncidentEpisodeFeed",
    service: IncidentEpisodeFeedService as unknown as FeedTableService,
  },
  {
    name: "AlertEpisodeFeed",
    service: AlertEpisodeFeedService as unknown as FeedTableService,
  },
];

// How many entries are read at a time.
export const FEED_ATTACHMENT_LINKS_BATCH_SIZE: number = 500;

export default class RewriteFeedAttachmentLinks extends DataMigrationBase {
  public constructor() {
    super("RewriteFeedAttachmentLinks");
  }

  public override async migrate(): Promise<void> {
    for (const feed of FEEDS_WITH_NOTE_ATTACHMENTS) {
      await this.rewriteFeed(feed);
    }
  }

  private async rewriteFeed(feed: FeedTable): Promise<void> {
    let skip: number = 0;
    let rewrittenEntries: number = 0;

    /*
     * Every entry the query reads still mentions "/attachment/" after it is
     * rewritten, so the pages stay where they were: the next page starts
     * after this one.
     */
    for (;;) {
      let rows: Array<FeedRow> = [];

      try {
        rows = await feed.service.findBy({
          query: {
            feedInfoInMarkdown: QueryHelper.search("/attachment/"),
          },
          select: {
            _id: true,
            projectId: true,
            feedInfoInMarkdown: true,
          },
          sort: {
            createdAt: SortOrder.Ascending,
          },
          skip: skip,
          limit: FEED_ATTACHMENT_LINKS_BATCH_SIZE,
          props: {
            isRoot: true,
          },
        });
      } catch (err) {
        logger.error(
          `RewriteFeedAttachmentLinks: could not read ${feed.name} entries: ${err}`,
        );
        return;
      }

      for (const row of rows) {
        if (!row.id) {
          continue;
        }

        const rewrite: FeedAttachmentLinksRewrite =
          FeedAttachmentLinks.rewriteOldLinks(
            row.feedInfoInMarkdown,
            row.projectId?.toString(),
          );

        if (rewrite.rewritten === 0) {
          continue;
        }

        try {
          await feed.service.updateOneById({
            id: row.id,
            data: {
              feedInfoInMarkdown: rewrite.markdown,
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
          rewrittenEntries++;
        } catch (err) {
          logger.error(
            `RewriteFeedAttachmentLinks: could not rewrite ${feed.name} entry ${row.id.toString()}: ${err}`,
          );
        }
      }

      if (rows.length < FEED_ATTACHMENT_LINKS_BATCH_SIZE) {
        break;
      }

      skip += rows.length;
    }

    logger.info(
      `RewriteFeedAttachmentLinks: rewrote the attachment links of ${rewrittenEntries} ${feed.name} entries.`,
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
