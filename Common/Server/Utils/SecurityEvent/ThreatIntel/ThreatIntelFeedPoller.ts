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
import ThreatIntelIndicatorService, {
  StoredIndicatorVersion,
} from "../../../Services/ThreatIntelIndicatorService";
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
 * sync progresses across successive polls (MAX_PAGES_PER_POLL pages per
 * poll, polls one poll-interval apart) and a timed-out run resumes where
 * it left off. When a server omits the header, an undrained poll saves
 * the envelope's next-page token instead, and a fully drained poll falls
 * back to "now minus a minute of overlap"; redelivered objects are
 * harmless because rows upsert by (identity, version).
 *
 * Deactivations are first-class: revocations and updates whose
 * valid_until has already passed are INGESTED (as newer versions that
 * fail the active predicate), never skipped — skipping them would leave
 * the older, still-active version the argMax winner forever. Values an
 * updated pattern no longer contains are retracted with tombstone
 * versions for the same reason.
 */

// TAXII page size asked for; servers may serve less.
export const TAXII_PAGE_SIZE: number = 500;

/*
 * Pages fetched per feed per poll. Bounds one poll's memory and wall
 * clock against a multi-million-object collection; the cursor carries
 * the sync forward on the feed's next due poll.
 */
export const MAX_PAGES_PER_POLL: number = 10;

/*
 * Overlap when falling back to a time-based cursor, so objects added
 * while the poll ran are never skipped (GoogleSecOpsPoller precedent).
 */
const CURSOR_OVERLAP_IN_MINUTES: number = 1;

/*
 * ClickHouse DateTime64 overflows past 2262 and DateTime past 2106, and
 * feeds use far-future valid_until values (9999-12-31) as a "never
 * expires" idiom. Clamp parsed STIX dates so every row is representable;
 * matching treats a 2100 validUntil as effectively never-expiring anyway.
 */
export const MAX_INDICATOR_DATE_MILLIS: number = Date.UTC(2100, 0, 1);

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
  | "not-indicator";

export interface StixIndicatorParseResult {
  outcome: StixIndicatorOutcome;
  rows: Array<JSONObject>;
  // Set when outcome is "ingested".
  stixId?: string | undefined;
  version?: number | undefined;
  /*
   * True when the object arrives already inactive (revoked, or its
   * valid_until has passed) — ingested to deactivate older versions, and
   * given tombstone retention so it cannot be TTL-dropped before the
   * rows it masks.
   */
  deadOnArrival?: boolean | undefined;
}

export interface FeedPollResult {
  pages: number;
  objectsFetched: number;
  indicatorRowsIngested: number;
  unsupportedPatterns: number;
  filteredByConfidence: number;
  // Revocations and already-expired updates, ingested as deactivations.
  deadOnArrival: number;
  // Tombstones written for values an updated pattern dropped.
  valuesRetracted: number;
  drained: boolean;
}

// One page object's ingest identity, for reconciliation.
interface PageObjectInfo {
  stixId: string;
  version: number;
  values: Set<string>;
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
        nextPageToken: true,
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
         * SecOps poller and the detection engine. The saved page token is
         * cleared too: a failing fetch is how an expired token surfaces,
         * and the added_after cursor restarts the window cleanly.
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
                  nextPageToken: null as unknown as string,
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
      deadOnArrival: 0,
      valuesRetracted: 0,
      drained: false,
    };

    let dateAddedLast: string | null = null;
    /*
     * A poll interrupted mid-pagination resumes from the saved token
     * (paired with the unchanged added_after cursor), so header-less
     * servers still make progress across polls.
     */
    let nextToken: string | undefined = feed.nextPageToken || undefined;
    let resumeToken: string | null = null;

    while (result.pages < MAX_PAGES_PER_POLL) {
      const page: TaxiiObjectsPage = await client.fetchIndicatorObjects({
        limit: TAXII_PAGE_SIZE,
        addedAfter: feed.cursor || undefined,
        next: nextToken,
      });

      result.pages++;
      result.objectsFetched += page.objects.length;

      const pageRows: Array<JSONObject> = [];
      const pageObjects: Array<PageObjectInfo> = [];

      for (const stixObject of page.objects) {
        const parsed: StixIndicatorParseResult = this.parseStixIndicator(
          stixObject,
          context,
          endTime,
        );

        switch (parsed.outcome) {
          case "ingested":
            pageRows.push(...parsed.rows);
            pageObjects.push({
              stixId: parsed.stixId!,
              version: parsed.version!,
              values: new Set<string>(
                parsed.rows.map((row: JSONObject): string => {
                  return String(row["indicatorValue"]);
                }),
              ),
            });
            if (parsed.deadOnArrival) {
              result.deadOnArrival++;
            }
            break;
          case "unsupported":
            result.unsupportedPatterns++;
            break;
          case "filtered":
            result.filteredByConfidence++;
            break;
          default:
            break;
        }
      }

      if (pageRows.length > 0) {
        const retracted: number = await this.reconcileWithStoredVersions({
          context,
          pageRows,
          pageObjects,
          now: endTime,
        });

        await ThreatIntelIndicatorService.insertJsonRows(pageRows);
        result.indicatorRowsIngested += pageRows.length - retracted;
        result.valuesRetracted += retracted;
      }

      if (page.dateAddedLast) {
        dateAddedLast = page.dateAddedLast;
      }

      if (!page.more) {
        result.drained = true;
        resumeToken = null;
        break;
      }

      if (!page.next) {
        /*
         * The server says more pages exist but gave no next token; only
         * the added_after cursor (when the server sends the header) can
         * resume the sync.
         */
        resumeToken = null;
        break;
      }

      nextToken = page.next;
      // If the page cap ends the loop, this is the first unfetched page.
      resumeToken = page.next;
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

    /*
     * The page token is persisted only when it is the sole resume point:
     * an advanced header cursor supersedes it (tokens pair with the
     * added_after they were issued under), and a drained poll needs none.
     */
    const persistedNextToken: string | null =
      !result.drained && !dateAddedLast && resumeToken ? resumeToken : null;

    await ThreatIntelFeedService.updateOneById({
      id: feed.id,
      data: {
        lastPolledAt: endTime,
        ...(newCursor ? { cursor: newCursor } : {}),
        nextPageToken: persistedNextToken as unknown as string,
        lastError: null as unknown as string,
        lastPollSummary: this.buildPollSummary(result, {
          hasCursor: Boolean(newCursor),
          hasToken: Boolean(persistedNextToken),
        }),
      },
      props: {
        isRoot: true,
      },
    });

    if (result.indicatorRowsIngested > 0 || result.valuesRetracted > 0) {
      /*
       * New or retracted indicators change what the ingest-time enricher
       * should match; drop its per-project caches so the next batch sees
       * the change.
       */
      ThreatIntelEnricher.invalidateProjectCache(feed.projectId);
    }

    return result;
  }

  /*
   * One STIX object -> zero or more ThreatIntelIndicator rows (one per
   * IOC value in the pattern; multi-value OR patterns fan out with the
   * same stixId). Exported for tests.
   *
   * Deactivations are ingested, not skipped: a revocation, and an update
   * whose valid_until already passed, must land as a NEWER version so it
   * wins the argMax over the older, still-active row it supersedes. Such
   * dead-on-arrival rows get tombstone retention (at least a year out)
   * so partition-granular TTL can never drop the tombstone before the
   * row it masks.
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
     * the moment someone sets a minimum. Revocations bypass it entirely —
     * they are retractions, not new claims, and filtering one out would
     * leave the indicator it retracts active forever.
     */
    if (
      !revoked &&
      context.minimumConfidence > 0 &&
      confidence > 0 &&
      confidence < context.minimumConfidence
    ) {
      return { outcome: "filtered", rows: [] };
    }

    const validFrom: Date = this.clampToClickhouseRange(
      this.parseStixDate(stixObject["valid_from"]) ||
        this.parseStixDate(stixObject["created"]) ||
        now,
    );

    const validUntil: Date = this.clampToClickhouseRange(
      this.parseStixDate(stixObject["valid_until"]) ||
        OneUptimeDate.addRemoveDays(validFrom, THREAT_INTEL_DEFAULT_VALID_DAYS),
    );

    const deadOnArrival: boolean =
      revoked || !OneUptimeDate.isAfter(validUntil, now);

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

    /*
     * Live rows expire a day after their validity; dead-on-arrival rows
     * are tombstones whose whole job is masking older versions, so they
     * must outlive anything they could be masking — a year from now is
     * the ceiling any earlier version's default window can reach, and
     * reconcileWithStoredVersions raises it further when a stored
     * version's retention is later still.
     */
    const retentionDate: Date = deadOnArrival
      ? this.laterOf(
          OneUptimeDate.addRemoveDays(validUntil, 1),
          OneUptimeDate.addRemoveDays(now, THREAT_INTEL_DEFAULT_VALID_DAYS + 1),
        )
      : OneUptimeDate.addRemoveDays(validUntil, 1);

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

    return { outcome: "ingested", rows, stixId, version, deadOnArrival };
  }

  /*
   * Pre-ingest reconciliation against what the table already stores for
   * this page's STIX objects. Two jobs, one query:
   *
   *  - RETENTION MONOTONICITY: a superseding version must never land in
   *    an earlier retention partition than a version it masks, or a TTL
   *    part-drop would delete the winner and resurrect the loser. Every
   *    new row's retentionDate is raised to its object's stored ceiling.
   *
   *  - VALUE RETRACTION: an update that drops a value from a multi-value
   *    pattern leaves that value's identity with the old version as its
   *    argMax winner forever. A tombstone row (revoked, the update's
   *    version) is appended for each stored value the newer pattern no
   *    longer contains.
   *
   * Mutates pageRows in place (appending tombstones); returns how many
   * tombstones were appended.
   */
  private static async reconcileWithStoredVersions(data: {
    context: StixParseContext;
    pageRows: Array<JSONObject>;
    pageObjects: Array<PageObjectInfo>;
    now: Date;
  }): Promise<number> {
    const { context, pageRows, pageObjects, now } = data;

    if (pageObjects.length === 0) {
      return 0;
    }

    // Newest version per stixId in this page — the retraction basis.
    const newestByStixId: Map<string, PageObjectInfo> = new Map<
      string,
      PageObjectInfo
    >();

    for (const info of pageObjects) {
      const existing: PageObjectInfo | undefined = newestByStixId.get(
        info.stixId,
      );

      if (!existing || info.version > existing.version) {
        newestByStixId.set(info.stixId, info);
      }
    }

    const stored: Array<StoredIndicatorVersion> =
      await ThreatIntelIndicatorService.findLatestVersionsByStixIds({
        projectId: context.projectId,
        feedId: context.feedId,
        stixIds: Array.from(newestByStixId.keys()),
      });

    if (stored.length === 0) {
      return 0;
    }

    const retentionCeilingByStixId: Map<string, Date> = new Map<string, Date>();

    for (const storedVersion of stored) {
      const storedRetention: Date | null = this.parseStixDate(
        storedVersion.retentionDate,
      );

      if (!storedRetention) {
        continue;
      }

      const ceiling: Date | undefined = retentionCeilingByStixId.get(
        storedVersion.stixId,
      );

      if (!ceiling || storedRetention.getTime() > ceiling.getTime()) {
        retentionCeilingByStixId.set(storedVersion.stixId, storedRetention);
      }
    }

    for (const row of pageRows) {
      const ceiling: Date | undefined = retentionCeilingByStixId.get(
        String(row["stixId"]),
      );

      if (!ceiling) {
        continue;
      }

      const own: Date | null = this.parseStixDate(String(row["retentionDate"]));

      if (own && ceiling.getTime() > own.getTime()) {
        row["retentionDate"] = OneUptimeDate.toClickhouseDateTime(ceiling);
      }
    }

    let retracted: number = 0;

    for (const storedVersion of stored) {
      const newest: PageObjectInfo | undefined = newestByStixId.get(
        storedVersion.stixId,
      );

      if (
        !newest ||
        storedVersion.version >= newest.version ||
        newest.values.has(storedVersion.indicatorValue)
      ) {
        continue;
      }

      const storedRetention: Date =
        this.parseStixDate(storedVersion.retentionDate) || now;

      const tombstoneRetention: Date = this.laterOf(
        storedRetention,
        OneUptimeDate.addRemoveDays(now, THREAT_INTEL_DEFAULT_VALID_DAYS + 1),
      );

      pageRows.push({
        _id: ObjectID.generateTimeOrdered().toString(),
        createdAt: OneUptimeDate.toClickhouseDateTime(now),
        projectId: context.projectId.toString(),
        feedId: context.feedId.toString(),
        feedName: context.feedName,
        stixId: storedVersion.stixId,
        indicatorType: storedVersion.indicatorType,
        indicatorValue: storedVersion.indicatorValue,
        indicatorName: storedVersion.indicatorName,
        confidence: storedVersion.confidence,
        stixLabels: [],
        // Carried through verbatim — already ClickHouse-formatted.
        validFrom: storedVersion.validFrom,
        validUntil: storedVersion.validUntil,
        revoked: true,
        version: newest.version,
        retentionDate: OneUptimeDate.toClickhouseDateTime(tombstoneRetention),
      } satisfies JSONObject);

      retracted++;
    }

    return retracted;
  }

  private static parseStixDate(value: unknown): Date | null {
    if (typeof value !== "string" || value.trim() === "") {
      return null;
    }

    const parsed: Date = new Date(value);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private static clampToClickhouseRange(date: Date): Date {
    if (date.getTime() > MAX_INDICATOR_DATE_MILLIS) {
      return new Date(MAX_INDICATOR_DATE_MILLIS);
    }

    return date;
  }

  private static laterOf(first: Date, second: Date): Date {
    return first.getTime() >= second.getTime() ? first : second;
  }

  private static buildPollSummary(
    result: FeedPollResult,
    resume: { hasCursor: boolean; hasToken: boolean },
  ): string {
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

    if (result.deadOnArrival > 0) {
      parts.push(
        `${result.deadOnArrival} already inactive (revoked or expired) ingested as deactivations`,
      );
    }

    if (result.valuesRetracted > 0) {
      parts.push(
        `retracted ${result.valuesRetracted} value${
          result.valuesRetracted === 1 ? "" : "s"
        } dropped by updated patterns`,
      );
    }

    if (!result.drained) {
      if (resume.hasCursor) {
        parts.push(
          "more pages remain; the next poll continues from the cursor",
        );
      } else if (resume.hasToken) {
        parts.push(
          "more pages remain; the next poll continues from the saved page token",
        );
      } else {
        parts.push(
          "more pages remain but the server provided no resume point (no next token or X-TAXII-Date-Added-Last header); the next poll retries this window",
        );
      }
    }

    return `${parts.join(", ")}.`;
  }
}
