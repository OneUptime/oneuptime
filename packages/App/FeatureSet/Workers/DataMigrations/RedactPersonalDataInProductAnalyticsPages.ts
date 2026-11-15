import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import { MaterializeInBackgroundOptions } from "./MaterializeAttributeValuesIndex";
import RumProductAnalyticsEvent from "Common/Models/AnalyticsModels/RumProductAnalyticsEvent";
import MetricService from "Common/Server/Services/MetricService";
import {
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";
import { ProductAnalyticsEventKind } from "Common/Types/Rum/ProductAnalyticsEvents";

/*
 * Issue #8197: the product analytics ingest stored the page a client sent
 * as it was sent, trusting the browser recorder to have scrubbed it. A
 * client that did not - the application's own code posting with its
 * ingestion key, a recorder of its own - could store
 * "/users/someone@example.com" or "/reset/<uuid>" in
 * RumProductAnalyticsEventV1, kept for PRODUCT_ANALYTICS_RETENTION_MONTHS
 * and shown to everyone who can read the application's analytics. The
 * ingest now scrubs every page as Session Replay scrubs the addresses it
 * keeps (toProductAnalyticsPage); this scrubs the rows stored before.
 *
 * Two mutations, queued in the background (MaterializeInBackgroundOptions),
 * on the local storage table, ON CLUSTER:
 *
 *   1. DELETE the page views named by a page with an identifier in it. A
 *      page view's page is its name, and the name is in the table's sort
 *      key, which ClickHouse never updates; a copy could not be written in
 *      its place either without a second copy when two processes run this
 *      at once (Docs/migrations/README.md). Only a client that did not scrub
 *      sent one: the browser recorder has always scrubbed its pages.
 *   2. UPDATE the page of every other event (a session's start, a track()
 *      call) with an identifier in it, redacting each such segment, so the
 *      event stays and its page names no one.
 *
 * Which segment holds an identifier is UrlScrubber.scrubPath's rule, spelled
 * in SQL (PAGE_SEGMENT_IDENTIFIER_PATTERN), on the segment decoded as the
 * scrubber decodes it (DECODED_SEGMENT_SQL). It is held to ASCII, which the
 * scrubber's uuid, object id, digit and token rules are already, so it reads
 * the same in every ClickHouse - whether its match() counts bytes or
 * characters - and never takes for an identifier a segment the scrubber
 * keeps: that segment is one a recorder sent, and its page view would be
 * deleted. An email with letters beyond ASCII in it is left where it is;
 * the reads name every page as the ingest stores it now
 * (toProductAnalyticsPage), so it is shown scrubbed all the same.
 *
 * Safe to run twice, at once too: what it deletes or rewrites no longer
 * matches. A row an ingest worker from before the upgrade still writes
 * during a rolling upgrade, after this ran, is not caught.
 */

/*
 * A segment, decoded, that UrlScrubber.scrubPath redacts: a uuid, a 24-hex
 * object id, an email (in ASCII), nine digits or more, or a token of 32 or
 * more letters, digits, "_" and "-". The email's parts are any printable
 * ASCII but "@" and "/" (`[!-.0-?A-~]`), as the scrubber's `[^@\s/]` reads
 * ASCII, at the lengths it allows. A ClickHouse string literal: "\\." is
 * the regular expression's "\.".
 */
export const PAGE_SEGMENT_IDENTIFIER_PATTERN: string =
  "^(?:[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}|[0-9A-Fa-f]{24}|[!-.0-?A-~]{1,64}@[!-.0-?A-~]{1,253}\\\\.[!-.0-?A-~]{1,63}|[0-9]{9,}|[A-Za-z0-9_-]{32,})$";

/*
 * A segment (`segment`, a lambda argument) as the scrubber reads it:
 * decoded, unless an escape in it is cut short ("%zz", "%4"), where the
 * scrubber's decodeURIComponent throws and it reads the segment as written.
 */
export const DECODED_SEGMENT_SQL: string =
  "if(match(segment, '%[0-9A-Fa-f]?([^0-9A-Fa-f]|$)'), segment, decodeURLComponent(segment))";

const IS_IDENTIFIER_SQL: string = `match(${DECODED_SEGMENT_SQL}, '${PAGE_SEGMENT_IDENTIFIER_PATTERN}')`;

/* Whether the path in `column` has a segment the scrubber redacts. */
export function hasIdentifierSegmentSql(column: string): string {
  return `arrayExists(segment -> ${IS_IDENTIFIER_SQL}, splitByChar('/', ${column}))`;
}

/* The path in `column` with each such segment "[redacted]". */
export function redactedPathSql(column: string): string {
  return `arrayStringConcat(arrayMap(segment -> if(${IS_IDENTIFIER_SQL}, '[redacted]', segment), splitByChar('/', ${column})), '/')`;
}

export default class RedactPersonalDataInProductAnalyticsPages extends DataMigrationBase {
  public constructor() {
    super("RedactPersonalDataInProductAnalyticsPages");
  }

  public static getStorageTable(): string {
    return getStorageTableName(new RumProductAnalyticsEvent().tableName);
  }

  public static getDeletePageViewsStatement(): string {
    return `ALTER TABLE ${RedactPersonalDataInProductAnalyticsPages.getStorageTable()}${onClusterClause()} DELETE WHERE kind = '${ProductAnalyticsEventKind.Page}' AND ${hasIdentifierSegmentSql("name")}`;
  }

  public static getRedactPagesStatement(): string {
    return `ALTER TABLE ${RedactPersonalDataInProductAnalyticsPages.getStorageTable()}${onClusterClause()} UPDATE page = ${redactedPathSql("page")} WHERE kind != '${ProductAnalyticsEventKind.Page}' AND ${hasIdentifierSegmentSql("page")}`;
  }

  public override async migrate(): Promise<void> {
    const storageTable: string =
      RedactPersonalDataInProductAnalyticsPages.getStorageTable();

    /*
     * Boot and the migrate Job create the analytics tables before data
     * migrations run, so a table that does not exist has no rows.
     */
    if (!(await ClickHouseMigrationUtil.tableExists(storageTable))) {
      logger.info(
        `RedactPersonalDataInProductAnalyticsPages: ${storageTable} does not exist; nothing to redact.`,
      );
      return;
    }

    /*
     * Not caught: a mutation that could not be queued fails the migration,
     * so the runner tries it again on the next boot rather than record as
     * done a table that still holds what it was meant to scrub.
     */
    await MetricService.execute(
      RedactPersonalDataInProductAnalyticsPages.getDeletePageViewsStatement(),
      MaterializeInBackgroundOptions,
    );

    await MetricService.execute(
      RedactPersonalDataInProductAnalyticsPages.getRedactPagesStatement(),
      MaterializeInBackgroundOptions,
    );

    logger.info(
      `RedactPersonalDataInProductAnalyticsPages: queued the redaction of ${storageTable}; it runs in the background (system.mutations).`,
    );
  }

  public override async rollback(): Promise<void> {
    // Nothing to give back: what was redacted named a person.
    return;
  }
}
