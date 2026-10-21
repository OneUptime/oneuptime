import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import ThreatIntelFeed from "../../../../Models/DatabaseModels/ThreatIntelFeed";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  THREAT_INTEL_GOOGLE_SECOPS_INDICATOR_ID,
  THREAT_INTEL_GOOGLE_SECOPS_MAX_MATCHES,
  THREAT_INTEL_GOOGLE_SECOPS_MAX_WINDOW_IN_DAYS,
  THREAT_INTEL_GOOGLE_SECOPS_VALID_DAYS,
} from "../../../../Types/SecurityEvent/ThreatIntelFeedType";
import SecurityEventConnectionService from "../../../Services/SecurityEventConnectionService";
import ThreatIntelIndicatorService from "../../../Services/ThreatIntelIndicatorService";
import GoogleSecOpsClient, {
  FetchLike,
  GoogleSecOpsIocMatchesResult,
} from "../Connectors/GoogleSecOps/GoogleSecOpsClient";
import {
  SecurityConnectorSettings,
  readSettingString,
} from "../Connectors/Types";
import {
  GoogleSecOpsIoc,
  mergeGoogleSecOpsIocs,
  readGoogleSecOpsIocMatch,
} from "./GoogleSecOpsIocMatch";
import {
  buildIndicatorRow,
  INDICATOR_INSERT_BATCH_SIZE,
} from "./IndicatorRows";

/*
 * A Google SecOps feed's poll: the indicators of compromise Google SecOps's
 * threat intelligence (Mandiant's and the feeds the instance applies) found
 * in the events it holds, read through one of the project's Google SecOps
 * connections, become indicators OneUptime matches the rest of the
 * project's events against - the sign-ins, flows and endpoint events Google
 * SecOps never saw.
 *
 * Each poll reads the IOC matches of a window of match time, from the last
 * poll's end (less a quarter hour, so a match Google SecOps records late is
 * not missed) to now, at most THREAT_INTEL_GOOGLE_SECOPS_MAX_WINDOW_IN_DAYS
 * back. A matched artifact stays an active indicator for
 * THREAT_INTEL_GOOGLE_SECOPS_VALID_DAYS after Google SecOps last saw it, or
 * until its feed says it stops being active. One an analyst muted in Google
 * SecOps is let go here too.
 */

export const GOOGLE_SECOPS_IOC_WINDOW_OVERLAP_IN_MINUTES: number = 15;

export interface GoogleSecOpsFeedPollResult {
  // IOC matches Google SecOps answered with.
  matches: number;
  // Distinct indicators written as active.
  indicators: number;
  // Muted in Google SecOps: let go.
  muted: number;
  // Below the feed's minimum confidence: left out.
  filtered: number;
  // About something OneUptime cannot match (an asset, a URL path).
  unsupported: number;
  // Google SecOps had more matches in the window than one poll reads.
  moreAvailable: boolean;
  windowStart: Date;
  windowEnd: Date;
  // The feed's new cursor: the end of the window read.
  cursor: string;
}

export interface GoogleSecOpsIocReader {
  searchEnterpriseIocMatches(data: {
    startTime: Date;
    endTime: Date;
    maxMatches: number;
  }): Promise<GoogleSecOpsIocMatchesResult>;
}

export type GoogleSecOpsIocReaderFactory = (
  settings: SecurityConnectorSettings,
) => GoogleSecOpsIocReader;

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

export default class GoogleSecOpsIndicatorSource {
  public static createReader(
    settings: SecurityConnectorSettings,
    fetchImplementation?: FetchLike | undefined,
  ): GoogleSecOpsIocReader {
    return new GoogleSecOpsClient({
      region: readSettingString(settings.config, "region"),
      instanceResourceName: readSettingString(
        settings.config,
        "instanceResourceName",
      ),
      serviceAccountJson: readSettingString(
        settings.secrets,
        "serviceAccountJson",
      ),
      fetchImplementation,
    });
  }

  /*
   * The connection a feed reads through: the project's own, and a Google
   * SecOps one. Each way it can be missing is said in the words the feed's
   * last error shows.
   */
  public static async loadConnection(
    feed: ThreatIntelFeed,
  ): Promise<SecurityEventConnection> {
    if (!feed.securityEventConnectionId) {
      throw new BadDataException(
        "This Google SecOps feed has no connection. Edit the feed and choose the Google SecOps connection it reads through.",
      );
    }

    const connection: SecurityEventConnection | null =
      await SecurityEventConnectionService.findOneById({
        id: feed.securityEventConnectionId,
        select: {
          _id: true,
          projectId: true,
          provider: true,
          name: true,
        },
        props: { isRoot: true },
      });

    if (
      !connection ||
      connection.projectId?.toString() !== feed.projectId?.toString()
    ) {
      throw new BadDataException(
        "The Google SecOps connection this feed read through was deleted. Edit the feed and choose another connection.",
      );
    }

    if (connection.provider !== SecurityEventConnectorProvider.GoogleSecOps) {
      throw new BadDataException(
        "The connection this feed reads through is not a Google SecOps connection. Edit the feed and choose a Google SecOps connection.",
      );
    }

    return connection;
  }

  // The window one poll reads: from the cursor (less the overlap) to now, a week back at most.
  public static windowFor(
    cursor: string | undefined,
    now: Date,
  ): { start: Date; end: Date } {
    const earliest: Date = OneUptimeDate.addRemoveDays(
      now,
      -THREAT_INTEL_GOOGLE_SECOPS_MAX_WINDOW_IN_DAYS,
    );
    const previousEnd: Date | null = cursor ? new Date(cursor) : null;
    let start: Date =
      previousEnd && !Number.isNaN(previousEnd.getTime())
        ? OneUptimeDate.addRemoveMinutes(
            previousEnd,
            -GOOGLE_SECOPS_IOC_WINDOW_OVERLAP_IN_MINUTES,
          )
        : earliest;

    if (start.getTime() < earliest.getTime()) {
      start = earliest;
    }

    if (start.getTime() >= now.getTime()) {
      start = OneUptimeDate.addRemoveMinutes(
        now,
        -GOOGLE_SECOPS_IOC_WINDOW_OVERLAP_IN_MINUTES,
      );
    }

    return { start, end: now };
  }

  public static async poll(
    feed: ThreatIntelFeed,
    options: {
      readerFactory?: GoogleSecOpsIocReaderFactory | undefined;
      now?: Date | undefined;
    } = {},
  ): Promise<GoogleSecOpsFeedPollResult> {
    if (!feed.id || !feed.projectId) {
      throw new BadDataException("Threat intel feed is missing id or project.");
    }

    const connection: SecurityEventConnection = await this.loadConnection(feed);
    const settings: SecurityConnectorSettings =
      await SecurityEventConnectionService.getConnectorSettings(connection);
    const reader: GoogleSecOpsIocReader = options.readerFactory
      ? options.readerFactory(settings)
      : this.createReader(settings);

    const now: Date = options.now || OneUptimeDate.getCurrentDate();
    const window: { start: Date; end: Date } = this.windowFor(feed.cursor, now);

    const answer: GoogleSecOpsIocMatchesResult =
      await reader.searchEnterpriseIocMatches({
        startTime: window.start,
        endTime: window.end,
        maxMatches: THREAT_INTEL_GOOGLE_SECOPS_MAX_MATCHES,
      });

    const result: GoogleSecOpsFeedPollResult = {
      matches: answer.matches.length,
      indicators: 0,
      muted: 0,
      filtered: 0,
      unsupported: 0,
      moreAvailable: answer.moreDataAvailable,
      windowStart: window.start,
      windowEnd: window.end,
      cursor: window.end.toISOString(),
    };

    const read: Array<GoogleSecOpsIoc> = [];

    for (const match of answer.matches) {
      const ioc: GoogleSecOpsIoc | null = readGoogleSecOpsIocMatch(match);

      if (!ioc) {
        result.unsupported++;
        continue;
      }

      read.push(ioc);
    }

    const projectId: ObjectID = feed.projectId;
    const feedId: ObjectID = feed.id;
    const version: number = now.getTime();
    const minimumConfidence: number = Math.max(0, feed.minimumConfidence || 0);
    // Later than any version this feed wrote before, and than every validity it writes now.
    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      now,
      THREAT_INTEL_GOOGLE_SECOPS_VALID_DAYS + 1,
    );

    const rows: Array<JSONObject> = [];

    for (const ioc of mergeGoogleSecOpsIocs(read)) {
      if (
        !ioc.muted &&
        minimumConfidence > 0 &&
        ioc.confidence > 0 &&
        ioc.confidence < minimumConfidence
      ) {
        result.filtered++;
        continue;
      }

      const lastSeen: Date =
        ioc.lastSeen && ioc.lastSeen.getTime() <= now.getTime()
          ? ioc.lastSeen
          : now;
      let validUntil: Date = OneUptimeDate.addRemoveDays(
        lastSeen,
        THREAT_INTEL_GOOGLE_SECOPS_VALID_DAYS,
      );

      if (ioc.activeUntil && ioc.activeUntil.getTime() < validUntil.getTime()) {
        validUntil = ioc.activeUntil;
      }

      const validFrom: Date =
        ioc.firstSeen && ioc.firstSeen.getTime() <= now.getTime()
          ? ioc.firstSeen
          : now;

      if (ioc.muted) {
        result.muted++;
      } else {
        result.indicators++;
      }

      rows.push(
        buildIndicatorRow({
          projectId,
          feedId,
          feedName: feed.name || "",
          stixId: THREAT_INTEL_GOOGLE_SECOPS_INDICATOR_ID,
          indicatorType: ioc.type,
          indicatorValue: ioc.value,
          indicatorName: ioc.name,
          confidence: ioc.confidence,
          labels: ioc.labels,
          validFrom,
          validUntil: ioc.muted ? now : validUntil,
          revoked: ioc.muted,
          version,
          retentionDate,
          now,
        }),
      );
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

    return result;
  }

  // What a poll did, in the words the feed's Last poll shows.
  public static describeResult(result: GoogleSecOpsFeedPollResult): string {
    const parts: Array<string> = [
      `Read ${plural(result.indicators, "indicator", "indicators")} Google SecOps found in your events (${plural(result.matches, "match", "matches")})`,
    ];

    if (result.muted > 0) {
      parts.push(
        `let go of ${plural(result.muted, "indicator", "indicators")} muted in Google SecOps`,
      );
    }

    if (result.filtered > 0) {
      parts.push(`${result.filtered} below the minimum confidence`);
    }

    if (result.unsupported > 0) {
      parts.push(
        `skipped ${plural(result.unsupported, "match", "matches")} OneUptime cannot match`,
      );
    }

    if (result.moreAvailable) {
      parts.push(
        `Google SecOps had more than ${THREAT_INTEL_GOOGLE_SECOPS_MAX_MATCHES.toLocaleString("en-US")} matches, so the most recent were read`,
      );
    }

    return `${parts.join(", ")}.`;
  }
}
