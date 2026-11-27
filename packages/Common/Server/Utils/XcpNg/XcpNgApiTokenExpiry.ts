import XcpNgConnectionService from "../../Services/XcpNgConnectionService";
import XcpNgPoolFeedService from "../../Services/XcpNgPoolFeedService";
import XcpNgPoolService from "../../Services/XcpNgPoolService";
import logger from "../Logger";
import XcpNgConnection from "../../../Models/DatabaseModels/XcpNgConnection";
import XcpNgPool from "../../../Models/DatabaseModels/XcpNgPool";
import { XcpNgPoolFeedEventType } from "../../../Models/DatabaseModels/XcpNgPoolFeed";
import { Yellow500 } from "../../../Types/BrandColors";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import XcpNgCollectionMethod from "../../../Types/XcpNg/XcpNgCollectionMethod";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";

/*
 * AN XEN ORCHESTRA API TOKEN'S LIFE (#10996).
 *
 * Xen Orchestra's tokens expire - after 30 days unless they were made for
 * longer - and an expired one is simply forgotten, so the first sign would
 * be alarms and backups going quiet. OneUptime reads each saved token's
 * expiry (XenOrchestraClient.readApiToken, at most once an hour) and, two
 * weeks before it, warns on the feed of every pool read through the
 * connection, once per token, with how to make a new one. The connection's
 * page says the same from then on, and a token renewed in Xen Orchestra (a
 * later expiry) may be warned about again.
 */

// Days from now to `date`, rounded up: "in 3 days" on the 3rd day before.
export function getDaysUntil(date: Date, now: Date): number {
  return Math.max(
    0,
    Math.ceil((date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
  );
}

export function getApiTokenExpiryFeedLine(data: {
  connectionName: string;
  expiresAt: Date;
  now: Date;
}): { feedInfo: MarkdownText; moreInformation: MarkdownText } {
  const days: number = getDaysUntil(data.expiresAt, data.now);
  const date: string = data.expiresAt.toISOString().substring(0, 10);

  return {
    feedInfo: mdText`⏳ The Xen Orchestra API token of ${FeedMarkdown.code(
      data.connectionName,
    )} expires on ${date}, in ${String(days)} ${
      days === 1 ? "day" : "days"
    }. Metrics keep coming without it; alarms and backups need it.`,
    moreInformation: mdText`Create a new token for the read-only user in Xen Orchestra - in its user settings, or with ${FeedMarkdown.code(
      "xo-cli create-token",
    )} - and paste it into API Token with Edit Connection on the connection's page in OneUptime (XCP-ng, then Connections).`,
  };
}

export default class XcpNgApiTokenExpiry {
  // Warns about every token that expires within the window, once each.
  public static async warnExpiringTokens(): Promise<number> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const connections: Array<XcpNgConnection> =
      await XcpNgConnectionService.findApiTokensExpiringSoon();
    let warned: number = 0;

    for (const connection of connections) {
      if (
        !connection.id ||
        !connection.projectId ||
        !connection.apiTokenExpiresAt
      ) {
        continue;
      }

      try {
        await XcpNgApiTokenExpiry.warnOne({
          xcpNgConnectionId: connection.id,
          projectId: connection.projectId,
          connectionName: connection.name || "",
          expiresAt: new Date(connection.apiTokenExpiresAt),
          now: now,
        });

        await XcpNgConnectionService.markApiTokenExpiryWarned(connection.id);
        warned++;
      } catch (error) {
        logger.error(
          `Could not warn about the API token of XCP-ng connection ${connection.id.toString()}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return warned;
  }

  private static async warnOne(data: {
    xcpNgConnectionId: ObjectID;
    projectId: ObjectID;
    connectionName: string;
    expiresAt: Date;
    now: Date;
  }): Promise<void> {
    const pools: Array<XcpNgPool> = await XcpNgPoolService.findBy({
      query: {
        projectId: data.projectId,
        xcpNgConnectionId: data.xcpNgConnectionId,
        collectionMethod: XcpNgCollectionMethod.Probe,
      },
      select: {
        _id: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const line: { feedInfo: MarkdownText; moreInformation: MarkdownText } =
      getApiTokenExpiryFeedLine({
        connectionName: data.connectionName,
        expiresAt: data.expiresAt,
        now: data.now,
      });

    for (const pool of pools) {
      if (!pool.id) {
        continue;
      }

      await XcpNgPoolFeedService.createXcpNgPoolFeedItem({
        xcpNgPoolId: pool.id,
        projectId: data.projectId,
        xcpNgPoolFeedEventType: XcpNgPoolFeedEventType.XcpNgPoolUpdated,
        displayColor: Yellow500,
        feedInfoInMarkdown: line.feedInfo.toString(),
        moreInformationInMarkdown: line.moreInformation.toString(),
      });
    }
  }
}
