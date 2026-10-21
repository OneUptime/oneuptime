import crypto from "crypto";
import ThreatIntelFeed from "../../../../Models/DatabaseModels/ThreatIntelFeed";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  THREAT_INTEL_LIST_INDICATOR_ID,
  THREAT_INTEL_LIST_MAX_INDICATORS,
  THREAT_INTEL_LIST_VALID_DAYS,
} from "../../../../Types/SecurityEvent/ThreatIntelFeedType";
import IndicatorListParser, {
  IndicatorListParseResult,
} from "../../../../Utils/SecurityEvent/ThreatIntel/IndicatorListParser";
import { ParsedIndicatorValue } from "../../../../Utils/SecurityEvent/ThreatIntel/StixPatternParser";
import ThreatIntelIndicatorService from "../../../Services/ThreatIntelIndicatorService";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../DataSource/HttpFetch";
import {
  buildIndicatorRow,
  INDICATOR_INSERT_BATCH_SIZE,
} from "./IndicatorRows";

/*
 * A list feed's poll: download the list (one IP address, domain, URL or file
 * hash a line - abuse.ch's Feodo Tracker, the Emerging Threats blocklists,
 * the Tor exit nodes, a team's own list), read it with IndicatorListParser,
 * and keep the feed's indicators the same as the list:
 *
 *   - every value on the list is written as the latest version of its
 *     indicator, valid for THREAT_INTEL_LIST_VALID_DAYS;
 *   - every value the feed holds that the list no longer has is let go: a
 *     newer, revoked version, so it stops matching at once.
 *
 * A list that has not changed since the last write is not written again
 * until half its validity has passed, so an hourly poll of an unchanged
 * list costs one download. The feed's cursor keeps the list's hash and when
 * it was written (sha256:<hex>@<ISO date>).
 *
 * The address is a person's choice, so the download goes through
 * DataSourceHttpFetch: the egress guard checks and pins the address, no
 * redirect is followed, and the response is capped in size and time.
 */

export type ListFetchLike = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

export const THREAT_INTEL_LIST_REQUEST_TIMEOUT_IN_MS: number = 60 * 1000;

// The longest list address a feed stores (ThreatIntelFeed.listUrl).
export const THREAT_INTEL_LIST_URL_MAX_LENGTH: number = 500;

export interface ListFeedPollResult {
  // Lines that were not empty or a comment.
  lines: number;
  // Indicators on the list now.
  indicators: number;
  duplicates: number;
  unsupported: number;
  overLimit: number;
  // The list is the one last written, so nothing was written.
  unchanged: boolean;
  // Values the feed held that the list no longer has.
  letGo: number;
  // The feed's new cursor, when the list was written; undefined keeps the one it has.
  cursor?: string | undefined;
}

export interface ListCursor {
  hash: string;
  writtenAt: Date;
}

export function readListCursor(cursor: string | undefined): ListCursor | null {
  if (!cursor || !cursor.startsWith("sha256:")) {
    return null;
  }

  const at: number = cursor.indexOf("@");

  if (at === -1) {
    return null;
  }

  const hash: string = cursor.slice("sha256:".length, at);
  const writtenAt: Date = new Date(cursor.slice(at + 1));

  if (hash.length !== 64 || Number.isNaN(writtenAt.getTime())) {
    return null;
  }

  return { hash, writtenAt };
}

export function writeListCursor(cursor: ListCursor): string {
  return `sha256:${cursor.hash}@${cursor.writtenAt.toISOString()}`;
}

// A list's hash: the values it holds, so a list re-sorted or re-commented is the same list.
export function hashListValues(values: Array<ParsedIndicatorValue>): string {
  const hash: crypto.Hash = crypto.createHash("sha256");

  for (const key of values
    .map((value: ParsedIndicatorValue): string => {
      return `${value.type}|${value.value}`;
    })
    .sort()) {
    hash.update(key);
    hash.update("\n");
  }

  return hash.digest("hex");
}

/*
 * A web page is not a list: a list's address that answers with a sign-in
 * page or an error page would otherwise read as a list of nothing and let
 * every indicator go.
 */
export function looksLikeWebPage(text: string): boolean {
  const start: string = text.slice(0, 512).trimStart().toLowerCase();

  return start.startsWith("<!doctype html") || start.startsWith("<html");
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

export default class ThreatIntelListSource {
  // Save-time checks a list's address passes before the egress guard sees it.
  public static validateListUrl(url: string): void {
    let parsed: URL;

    try {
      parsed = new URL(url || "");
    } catch {
      throw new BadDataException(
        "List URL must be a valid address, e.g. https://feodotracker.abuse.ch/downloads/ipblocklist_recommended.txt",
      );
    }

    if (parsed.protocol !== "https:") {
      throw new BadDataException("List URL must start with https://.");
    }

    if (parsed.username || parsed.password) {
      throw new BadDataException(
        "List URL must not hold a user name or password: everyone who can see the feed can see its address.",
      );
    }

    if (url.length > THREAT_INTEL_LIST_URL_MAX_LENGTH) {
      throw new BadDataException(
        `List URL must be at most ${THREAT_INTEL_LIST_URL_MAX_LENGTH} characters.`,
      );
    }
  }

  public static async download(
    url: string,
    fetchImplementation?: ListFetchLike | undefined,
  ): Promise<string> {
    const fetch: ListFetchLike =
      fetchImplementation ||
      ((request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> => {
        return DataSourceHttpFetch.fetch(request);
      });

    const response: DataSourceHttpResponse = await fetch({
      method: "GET",
      url,
      headers: {
        Accept: "text/plain, text/csv;q=0.9, */*;q=0.5",
      },
      timeoutInMs: THREAT_INTEL_LIST_REQUEST_TIMEOUT_IN_MS,
      egressOptions: {
        targetLabel: "Threat intel list",
      },
    });

    return response.bodyText || "";
  }

  public static async poll(
    feed: ThreatIntelFeed,
    options: {
      fetchImplementation?: ListFetchLike | undefined;
      now?: Date | undefined;
    } = {},
  ): Promise<ListFeedPollResult> {
    if (!feed.id || !feed.projectId || !feed.listUrl) {
      throw new BadDataException(
        "This list feed has no list URL. Edit the feed and add the address of the list.",
      );
    }

    const now: Date = options.now || OneUptimeDate.getCurrentDate();
    const text: string = await this.download(
      feed.listUrl,
      options.fetchImplementation,
    );

    if (looksLikeWebPage(text)) {
      throw new BadDataException(
        "The list URL answered with a web page, not a list of indicators. Check the address: it should download a text file with one IP address, domain, URL or file hash a line.",
      );
    }

    const parsed: IndicatorListParseResult = IndicatorListParser.parse(text, {
      maxValues: THREAT_INTEL_LIST_MAX_INDICATORS,
    });

    if (parsed.values.length === 0 && parsed.unsupported > 0) {
      throw new BadDataException(
        `The list has ${plural(parsed.unsupported, "line", "lines")} but no IP address, domain, URL or file hash OneUptime can match. Check that the address downloads a list with one indicator a line.`,
      );
    }

    const result: ListFeedPollResult = {
      lines: parsed.lines,
      indicators: parsed.values.length,
      duplicates: parsed.duplicates,
      unsupported: parsed.unsupported,
      overLimit: parsed.overLimit,
      unchanged: false,
      letGo: 0,
    };

    const hash: string = hashListValues(parsed.values);
    const previous: ListCursor | null = readListCursor(feed.cursor);
    const refreshAfterInMs: number =
      (THREAT_INTEL_LIST_VALID_DAYS * 24 * 60 * 60 * 1000) / 2;

    if (
      previous &&
      previous.hash === hash &&
      now.getTime() - previous.writtenAt.getTime() < refreshAfterInMs &&
      previous.writtenAt.getTime() <= now.getTime()
    ) {
      result.unchanged = true;
      return result;
    }

    const projectId: ObjectID = feed.projectId;
    const feedId: ObjectID = feed.id;
    const version: number = now.getTime();
    const validUntil: Date = OneUptimeDate.addRemoveDays(
      now,
      THREAT_INTEL_LIST_VALID_DAYS,
    );
    // Later than any version this feed wrote before (each kept a day past its validity).
    const retentionDate: Date = OneUptimeDate.addRemoveDays(validUntil, 1);
    const confidence: number = feed.indicatorConfidence || 0;

    const held: Array<{ indicatorValue: string; indicatorType: string }> =
      await ThreatIntelIndicatorService.findActiveValuesForFeed({
        projectId,
        feedId,
        stixId: THREAT_INTEL_LIST_INDICATOR_ID,
        now,
        limit: THREAT_INTEL_LIST_MAX_INDICATORS * 2,
      });

    const onList: Set<string> = new Set<string>(
      parsed.values.map((value: ParsedIndicatorValue): string => {
        return value.value;
      }),
    );

    const rows: Array<JSONObject> = parsed.values.map(
      (value: ParsedIndicatorValue): JSONObject => {
        return buildIndicatorRow({
          projectId,
          feedId,
          feedName: feed.name || "",
          stixId: THREAT_INTEL_LIST_INDICATOR_ID,
          indicatorType: value.type,
          indicatorValue: value.value,
          indicatorName: "",
          confidence,
          labels: [],
          validFrom: now,
          validUntil,
          revoked: false,
          version,
          retentionDate,
          now,
        });
      },
    );

    for (const value of held) {
      if (onList.has(value.indicatorValue)) {
        continue;
      }

      rows.push(
        buildIndicatorRow({
          projectId,
          feedId,
          feedName: feed.name || "",
          stixId: THREAT_INTEL_LIST_INDICATOR_ID,
          indicatorType: value.indicatorType,
          indicatorValue: value.indicatorValue,
          indicatorName: "",
          confidence,
          labels: [],
          validFrom: now,
          validUntil: now,
          revoked: true,
          version,
          retentionDate,
          now,
        }),
      );

      result.letGo++;
    }

    for (
      let index: number = 0;
      index < rows.length;
      index += INDICATOR_INSERT_BATCH_SIZE
    ) {
      await ThreatIntelIndicatorService.insertJsonRows(
        rows.slice(index, index + INDICATOR_INSERT_BATCH_SIZE),
      );
    }

    result.cursor = writeListCursor({ hash, writtenAt: now });

    return result;
  }

  // What a poll did, in the words the feed's Last poll shows.
  public static describeResult(result: ListFeedPollResult): string {
    const parts: Array<string> = [
      result.unchanged
        ? `The list has not changed: ${plural(result.indicators, "indicator", "indicators")}`
        : `Read ${plural(result.indicators, "indicator", "indicators")} from the list`,
    ];

    if (result.letGo > 0) {
      parts.push(
        `let go of ${plural(result.letGo, "indicator", "indicators")} no longer on it`,
      );
    }

    if (result.unsupported > 0) {
      parts.push(
        `skipped ${plural(result.unsupported, "line", "lines")} OneUptime cannot match (an address range or a word)`,
      );
    }

    if (result.overLimit > 0) {
      parts.push(
        `left out ${plural(result.overLimit, "indicator", "indicators")} past the first ${THREAT_INTEL_LIST_MAX_INDICATORS.toLocaleString("en-US")}`,
      );
    }

    return `${parts.join(", ")}.`;
  }
}
