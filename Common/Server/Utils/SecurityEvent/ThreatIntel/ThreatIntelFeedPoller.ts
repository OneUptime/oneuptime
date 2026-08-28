import ThreatIntelFeed from "../../../../Models/DatabaseModels/ThreatIntelFeed";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { THREAT_INTEL_DEFAULT_VALID_DAYS } from "../../../../Types/SecurityEvent/ThreatIntelConstants";
import StixPatternParser, {
  ParsedIndicatorValue,
} from "../../../../Utils/SecurityEvent/ThreatIntel/StixPatternParser";
import ThreatIntelFeedService from "../../../Services/ThreatIntelFeedService";
import ThreatIntelIndicatorService from "../../../Services/ThreatIntelIndicatorService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ConnectorErrorMessage from "../ConnectorErrorMessage";
import TaxiiClient, { TaxiiObjectsPage } from "./TaxiiClient";
import ThreatIntelEnricher from "./ThreatIntelEnricher";

/*
 * The TAXII feed poller: every enabled feed that is due (per-feed poll
 * interval) fetches new STIX objects from its collection, parses the
 * indicator patterns this platform supports into normalized IOC rows,
 * and upserts them into the ThreatIntelIndicator ClickHouse table.
 *
 * Cursor semantics: added_after tracks the X-TAXII-Date-Added-Last
 * response header — the spec's own resume point — so a large initial
 * sync progresses across ticks (MAX_PAGES_PER_POLL pages per tick) and a
 * timed-out run resumes where it left off. When a server omits the
 * header, a fully drained poll falls back to "now minus a minute of
 * overlap"; redelivered objects are harmless because rows upsert by
 * (identity, version).
 */

// TAXII page size asked for; servers may serve less.
export const TAXII_PAGE_SIZE: number = 500;

/*
 * Pages fetched per feed per tick. Bounds one tick's memory and wall
 * clock against a multi-million-object collection; the cursor carries
 * the sync forward next tick.
 */
export const MAX_PAGES_PER_POLL: number = 10;

/*
 * Overlap when falling back to a time-based cursor, so objects added
 * while the poll ran are never skipped (GoogleSecOpsPoller precedent).
 */
const CURSOR_OVERLAP_IN_MINUTES: number = 1;

export interface StixParseContext {
  projectId: ObjectID;
  feedId: ObjectID;
  feedName: string;
  minimumConfidence: number;
}

export type StixIndicatorOutcome =
  | "ingested"
  | "unsupported"
  | "filtered"
  | "expired"
  | "not-indicator";

export interface StixIndicatorParseResult {
  outcome: StixIndicatorOutcome;
  rows: Array<JSONObject>;
}

export interface FeedPollResult {
  pages: number;
  objectsFetched: number;
  indicatorRowsIngested: number;
  unsupportedPatterns: number;
  filteredByConfidence: number;
  expiredSkipped: number;
  drained: boolean;
}

export default class ThreatIntelFeedPoller {
  @CaptureSpan()
  public static async pollAllDueFeeds(): Promise<void> {
    const feeds: Array<ThreatIntelFeed> = await ThreatIntelFeedService.findBy({
      query: {
        isEnabled: true,
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        apiRootUrl: true,
        collectionId: true,
        apiToken: true,
        basicAuthUsername: true,
        basicAuthPassword: true,
        minimumConfidence: true,
        pollIntervalInMinutes: true,
        lastPolledAt: true,
        cursor: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    const now: Date = OneUptimeDate.getCurrentDate();

    for (const feed of feeds) {
      const intervalInMinutes: number = Math.max(
        1,
        feed.pollIntervalInMinutes || 60,
      );

      if (feed.lastPolledAt) {
        const dueAt: Date = OneUptimeDate.addRemoveMinutes(
          feed.lastPolledAt,
          intervalInMinutes,
        );

        if (OneUptimeDate.isAfter(dueAt, now)) {
          continue;
        }
      }

      try {
        await this.pollFeed(feed);
      } catch (error) {
        logger.error(
          `ThreatIntelFeedPoller: error polling feed ${feed.id?.toString()}:`,
        );
        logger.error(error);

        /*
         * Best-effort bookkeeping that must never take the loop down
         * with it — the ConnectorErrorMessage discipline shared with the
         * SecOps poller and the detection engine.
         */
        if (feed.id) {
          const feedId: ObjectID = feed.id;

          await ConnectorErrorMessage.recordFailure({
            label: `ThreatIntelFeedPoller: feed ${feedId.toString()}`,
            write: async (): Promise<void> => {
              await ThreatIntelFeedService.updateOneById({
                id: feedId,
                data: {
                  lastPolledAt: OneUptimeDate.getCurrentDate(),
                  lastError: ConnectorErrorMessage.toMessage(error),
                },
                props: {
                  isRoot: true,
                },
              });
            },
          });
        }
      }
    }
  }

  @CaptureSpan()
  public static async pollFeed(
    feed: ThreatIntelFeed,
    clientOverride?: TaxiiClient | undefined,
  ): Promise<FeedPollResult> {
    if (!feed.id || !feed.projectId || !feed.apiRootUrl || !feed.collectionId) {
      throw new Error(
        "Threat intel feed is missing id, projectId, API root URL, or collection ID.",
      );
    }

    const client: TaxiiClient =
      clientOverride ||
      new TaxiiClient({
        apiRootUrl: feed.apiRootUrl,
        collectionId: feed.collectionId,
        apiToken: feed.apiToken,
        basicAuthUsername: feed.basicAuthUsername,
        basicAuthPassword: feed.basicAuthPassword,
      });

    const context: StixParseContext = {
      projectId: feed.projectId,
      feedId: feed.id,
      feedName: feed.name || "",
      minimumConfidence: Math.max(0, feed.minimumConfidence || 0),
    };

    const endTime: Date = OneUptimeDate.getCurrentDate();

    const result: FeedPollResult = {
      pages: 0,
      objectsFetched: 0,
      indicatorRowsIngested: 0,
      unsupportedPatterns: 0,
      filteredByConfidence: 0,
      expiredSkipped: 0,
      drained: false,
    };

    let dateAddedLast: string | null = null;
    let nextToken: string | undefined = undefined;

    while (result.pages < MAX_PAGES_PER_POLL) {
      const page: TaxiiObjectsPage = await client.fetchIndicatorObjects({
        limit: TAXII_PAGE_SIZE,
        addedAfter: feed.cursor || undefined,
        next: nextToken,
      });

      result.pages++;
      result.objectsFetched += page.objects.length;

      const pageRows: Array<JSONObject> = [];

      for (const stixObject of page.objects) {
        const parsed: StixIndicatorParseResult = this.parseStixIndicator(
          stixObject,
          context,
          endTime,
        );

        switch (parsed.outcome) {
          case "ingested":
            pageRows.push(...parsed.rows);
            break;
          case "unsupported":
            result.unsupportedPatterns++;
            break;
          case "filtered":
            result.filteredByConfidence++;
            break;
          case "expired":
            result.expiredSkipped++;
            break;
          default:
            break;
        }
      }

      if (pageRows.length > 0) {
        await ThreatIntelIndicatorService.insertJsonRows(pageRows);
        result.indicatorRowsIngested += pageRows.length;
      }

      if (page.dateAddedLast) {
        dateAddedLast = page.dateAddedLast;
      }

      if (!page.more) {
        result.drained = true;
        break;
      }

      if (!page.next) {
        /*
         * The server says more pages exist but gave no next token; the
         * added_after cursor (or its time fallback below) resumes the
         * sync next tick.
         */
        break;
      }

      nextToken = page.next;
    }

    /*
     * Cursor: the header cursor when the server provided one; a
     * time-based fallback only when the collection was fully drained
     * (advancing past unfetched pages would skip objects forever).
     */
    let newCursor: string | undefined = undefined;

    if (dateAddedLast) {
      newCursor = dateAddedLast;
    } else if (result.drained) {
      newCursor = OneUptimeDate.addRemoveMinutes(
        endTime,
        -CURSOR_OVERLAP_IN_MINUTES,
      ).toISOString();
    }

    await ThreatIntelFeedService.updateOneById({
      id: feed.id,
      data: {
        lastPolledAt: endTime,
        ...(newCursor ? { cursor: newCursor } : {}),
        lastError: null as unknown as string,
        lastPollSummary: this.buildPollSummary(result),
      },
      props: {
        isRoot: true,
      },
    });

    if (result.indicatorRowsIngested > 0) {
      /*
       * New indicators change what the ingest-time enricher should
       * match; drop its per-project caches so the next batch sees them.
       */
      ThreatIntelEnricher.invalidateProjectCache(feed.projectId);
    }

    return result;
  }

  /*
   * One STIX object -> zero or more ThreatIntelIndicator rows (one per
   * IOC value in the pattern; multi-value OR patterns fan out with the
   * same stixId). Exported for tests.
   */
  public static parseStixIndicator(
    stixObject: JSONObject,
    context: StixParseContext,
    now: Date,
  ): StixIndicatorParseResult {
    if (stixObject["type"] !== "indicator") {
      return { outcome: "not-indicator", rows: [] };
    }

    const stixId: string = String(stixObject["id"] || "").trim();
    const patternType: string = String(stixObject["pattern_type"] || "stix");

    if (!stixId || patternType !== "stix") {
      return { outcome: "unsupported", rows: [] };
    }

    const values: Array<ParsedIndicatorValue> | null = StixPatternParser.parse(
      String(stixObject["pattern"] || ""),
    );

    if (values === null) {
      return { outcome: "unsupported", rows: [] };
    }

    const revoked: boolean = stixObject["revoked"] === true;

    const rawConfidence: number = Number(stixObject["confidence"]);
    const confidence: number = Number.isFinite(rawConfidence)
      ? Math.min(100, Math.max(0, Math.trunc(rawConfidence)))
      : 0;

    /*
     * Unscored indicators (confidence 0) always pass the filter: a feed
     * that does not score its indicators should not be silently empty
     * the moment someone sets a minimum.
     */
    if (
      context.minimumConfidence > 0 &&
      confidence > 0 &&
      confidence < context.minimumConfidence
    ) {
      return { outcome: "filtered", rows: [] };
    }

    const validFrom: Date =
      this.parseStixDate(stixObject["valid_from"]) ||
      this.parseStixDate(stixObject["created"]) ||
      now;

    const validUntil: Date =
      this.parseStixDate(stixObject["valid_until"]) ||
      OneUptimeDate.addRemoveDays(validFrom, THREAT_INTEL_DEFAULT_VALID_DAYS);

    if (!revoked && !OneUptimeDate.isAfter(validUntil, now)) {
      return { outcome: "expired", rows: [] };
    }

    const version: number = (
      this.parseStixDate(stixObject["modified"]) ||
      this.parseStixDate(stixObject["created"]) ||
      now
    ).getTime();

    const labels: Array<string> = Array.isArray(stixObject["labels"])
      ? (stixObject["labels"] as Array<unknown>)
          .filter((label: unknown): boolean => {
            return typeof label === "string" && label.trim() !== "";
          })
          .map((label: unknown): string => {
            return String(label);
          })
      : [];

    const indicatorName: string = String(stixObject["name"] || "");

    const retentionDate: Date = OneUptimeDate.addRemoveDays(validUntil, 1);

    const rows: Array<JSONObject> = values.map(
      (value: ParsedIndicatorValue): JSONObject => {
        return {
          _id: ObjectID.generateTimeOrdered().toString(),
          createdAt: OneUptimeDate.toClickhouseDateTime(now),
          projectId: context.projectId.toString(),
          feedId: context.feedId.toString(),
          feedName: context.feedName,
          stixId: stixId,
          indicatorType: value.type,
          indicatorValue: value.value,
          indicatorName: indicatorName,
          confidence: confidence,
          stixLabels: labels,
          validFrom: OneUptimeDate.toClickhouseDateTime64(validFrom),
          validUntil: OneUptimeDate.toClickhouseDateTime64(validUntil),
          revoked: revoked,
          version: version,
          retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
        } satisfies JSONObject;
      },
    );

    return { outcome: "ingested", rows };
  }

  private static parseStixDate(value: unknown): Date | null {
    if (typeof value !== "string" || value.trim() === "") {
      return null;
    }

    const parsed: Date = new Date(value);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private static buildPollSummary(result: FeedPollResult): string {
    const parts: Array<string> = [
      `Fetched ${result.objectsFetched} STIX object${
        result.objectsFetched === 1 ? "" : "s"
      } across ${result.pages} page${result.pages === 1 ? "" : "s"}`,
      `ingested ${result.indicatorRowsIngested} indicator value${
        result.indicatorRowsIngested === 1 ? "" : "s"
      }`,
    ];

    if (result.unsupportedPatterns > 0) {
      parts.push(`skipped ${result.unsupportedPatterns} unsupported patterns`);
    }

    if (result.filteredByConfidence > 0) {
      parts.push(`${result.filteredByConfidence} below minimum confidence`);
    }

    if (result.expiredSkipped > 0) {
      parts.push(`${result.expiredSkipped} already expired`);
    }

    if (!result.drained) {
      parts.push("more pages remain; the next poll continues from the cursor");
    }

    return `${parts.join(", ")}.`;
  }
}
