import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/SecurityBlocklistFeedFetch";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import {
  SECURITY_BLOCKLIST_FEED_FETCH_RETENTION_IN_DAYS,
  SECURITY_BLOCKLIST_FEED_INTERVAL_SAMPLE_SIZE,
} from "../../Types/SecurityBlocklist/SecurityBlocklistFeed";

/*
 * The fetch log of the blocklist feeds (#10345): every time a firewall
 * fetched one, written by the feed's route as it answers and read by the
 * feed's page and by the check that each firewall still reads its feed.
 * Nobody else writes one - the model gives no role a write - and none is
 * kept past 30 days (purgeExpired, every day).
 */

// The most fetches one purge removes at a time.
export const SECURITY_BLOCKLIST_FEED_FETCH_PURGE_BATCH: number = 1000;

// The most batches one purge removes before it leaves the rest to the next day's.
export const SECURITY_BLOCKLIST_FEED_FETCH_PURGE_MAX_BATCHES: number = 500;

// What a fetch records, as the route answers it.
export interface SecurityBlocklistFeedFetchRecord {
  projectId: ObjectID;
  feedId: ObjectID;
  fetchedAt: Date;
  sourceIp: string | null;
  userAgent: string | null;
  file: string;
  authMethod: string;
  usedPreviousSecret: boolean;
  statusCode: number;
  isChanged: boolean;
  entryCount: number;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  // The route's rows name only the feed it read itself.
  protected override checksServerWrites(): boolean {
    return false;
  }

  // Records one fetch. Never throws: a fetch is answered whether or not its line could be written.
  @CaptureSpan()
  public async record(fetch: SecurityBlocklistFeedFetchRecord): Promise<void> {
    const row: Model = new Model();
    row.projectId = fetch.projectId;
    row.securityBlocklistFeedId = fetch.feedId;
    row.fetchedAt = fetch.fetchedAt;
    row.file = fetch.file.slice(0, 100);
    row.authMethod = fetch.authMethod;
    row.usedPreviousSecret = fetch.usedPreviousSecret;
    row.statusCode = fetch.statusCode;
    row.isChanged = fetch.isChanged;
    row.entryCount = fetch.entryCount;

    if (fetch.sourceIp) {
      row.sourceIp = fetch.sourceIp.slice(0, 100);
    }

    if (fetch.userAgent) {
      row.userAgent = fetch.userAgent.slice(0, 500);
    }

    await this.create({ data: row, props: { isRoot: true } });
  }

  // When a feed was fetched lately, the latest first: what its usual interval is worked out from.
  @CaptureSpan()
  public async findLatestFetchTimes(feedId: ObjectID): Promise<Array<Date>> {
    const rows: Array<Model> = await this.findBy({
      query: { securityBlocklistFeedId: feedId },
      select: { _id: true, fetchedAt: true },
      sort: { fetchedAt: SortOrder.Descending },
      skip: 0,
      // Twice the polls the interval reads: a poll can be two fetches (the list and its MD5).
      limit: (SECURITY_BLOCKLIST_FEED_INTERVAL_SAMPLE_SIZE + 1) * 2,
      props: { isRoot: true },
    });

    return rows
      .map((row: Model): Date | null => {
        return row.fetchedAt ? new Date(row.fetchedAt) : null;
      })
      .filter((time: Date | null): time is Date => {
        return time !== null;
      });
  }

  /*
   * Removes every fetch older than the 30 days the log keeps, a batch at a
   * time, by the index on fetchedAt. Answers how many it removed.
   */
  @CaptureSpan()
  public async purgeExpired(now?: Date | undefined): Promise<number> {
    // 30 days as a length of time, whatever zone the server runs in.
    const before: Date = OneUptimeDate.addRemoveDurationInDays(
      now || OneUptimeDate.getCurrentDate(),
      -SECURITY_BLOCKLIST_FEED_FETCH_RETENTION_IN_DAYS,
    );

    let removed: number = 0;

    for (
      let batch: number = 0;
      batch < SECURITY_BLOCKLIST_FEED_FETCH_PURGE_MAX_BATCHES;
      batch++
    ) {
      const count: number = await this.hardDeleteBy({
        query: { fetchedAt: QueryHelper.lessThan(before) },
        limit: SECURITY_BLOCKLIST_FEED_FETCH_PURGE_BATCH,
        skip: 0,
        props: { isRoot: true },
      });

      removed += count;

      if (count < SECURITY_BLOCKLIST_FEED_FETCH_PURGE_BATCH) {
        break;
      }
    }

    return removed;
  }
}

export default new Service();
