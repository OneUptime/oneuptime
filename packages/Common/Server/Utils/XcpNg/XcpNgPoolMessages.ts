import XcpNgPoolFeedService from "../../Services/XcpNgPoolFeedService";
import XcpNgPoolService from "../../Services/XcpNgPoolService";
import XcpNgResourceService from "../../Services/XcpNgResourceService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import XcpNgPool from "../../../Models/DatabaseModels/XcpNgPool";
import { XcpNgPoolFeedEventType } from "../../../Models/DatabaseModels/XcpNgPoolFeed";
import XcpNgResource from "../../../Models/DatabaseModels/XcpNgResource";
import {
  Blue500,
  Gray500,
  Red500,
  Yellow500,
} from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import {
  XCP_NG_MAX_MESSAGES_PER_COLLECTION,
  XcpNgPoolMessage,
} from "../../../Types/XcpNg/XcpNgProbeCollection";
import { XcpNgTelemetryUtil } from "../../../Types/XcpNg/XcpNgTelemetry";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";

/*
 * THE MESSAGES XAPI WRITES FOR A POOL, ON ITS FEED (#10999).
 *
 * A pool read through its own XAPI hands the server what XAPI told its
 * operators since the last read (message.get_since, with a watermark the
 * connection keeps, so a probe restart neither loses nor repeats one): a VM
 * that crashed, a host HA lost, a storage repository that failed to plug,
 * a threshold ALARM. Each lands on its pool's feed, at the moment XAPI
 * wrote it, with what it is about - the host, VM or storage repository by
 * its name in the pool's inventory - and its priority (1 the most severe):
 * red for 1 and 2, amber for 3, quiet for 4 and 5, as XAPI ranks them.
 *
 * Alerts from these messages are #10997's: its templates read the same
 * shape (XcpNgPoolMessage), from Xen Orchestra's REST API as from XAPI.
 * Only the pools the connection reads are written to.
 */

// The words of an XAPI object class, as a person reads them.
const CLASS_WORDS: Record<string, string> = {
  VM: "VM",
  Host: "host",
  SR: "storage repository",
  Pool: "pool",
  VDI: "virtual disk",
  VMPP: "protection policy",
  VMSS: "snapshot schedule",
  PVS_proxy: "PVS proxy",
  Certificate: "certificate",
};

export function getXcpNgMessageColor(priority: number): Color {
  if (priority <= 2) {
    return Red500;
  }

  if (priority === 3) {
    return Yellow500;
  }

  return priority === 4 ? Blue500 : Gray500;
}

/*
 * The feed line of one message: its name, its priority, what it is about
 * and the start of what XAPI wrote.
 */
export function getXcpNgMessageFeedLine(data: {
  message: XcpNgPoolMessage;
  objectName?: string | null | undefined;
}): { feedInfo: MarkdownText; moreInformation: MarkdownText | null } {
  const what: string =
    CLASS_WORDS[data.message.objectClass] ||
    (data.message.objectClass || "object").toLowerCase();
  const about: string = data.objectName || data.message.objectUuid || "";

  // What XAPI wrote is reported text: escaped, so nothing in it acts.
  const feedInfo: MarkdownText = about
    ? mdText`📨 XAPI message ${FeedMarkdown.code(
        data.message.name,
      )} (priority ${String(data.message.priority)}) about ${what} ${about}.`
    : mdText`📨 XAPI message ${FeedMarkdown.code(
        data.message.name,
      )} (priority ${String(data.message.priority)}).`;

  const body: string = (data.message.body || "").trim();

  return {
    feedInfo: feedInfo,
    moreInformation: body ? FeedMarkdown.multilineText(body) : null,
  };
}

export default class XcpNgPoolMessages {
  /*
   * Writes each message to its pool's feed. Best effort, as every feed
   * write is: a message that cannot be written is logged, never thrown -
   * the read it came with is already recorded.
   */
  public static async deliver(data: {
    projectId: ObjectID;
    messages: Array<XcpNgPoolMessage> | undefined;
    // The pools the connection reads now.
    poolIdsToKeep: ReadonlySet<string>;
  }): Promise<number> {
    const messages: Array<XcpNgPoolMessage> = (data.messages || [])
      .filter((message: XcpNgPoolMessage): boolean => {
        return (
          Boolean(message) &&
          typeof message.name === "string" &&
          data.poolIdsToKeep.has(
            XcpNgTelemetryUtil.normalizePoolIdentifier(message.poolId),
          )
        );
      })
      .slice(0, XCP_NG_MAX_MESSAGES_PER_COLLECTION);

    if (messages.length === 0) {
      return 0;
    }

    try {
      const poolIdentifiers: Array<string> = Array.from(
        new Set(
          messages.map((message: XcpNgPoolMessage): string => {
            return XcpNgTelemetryUtil.normalizePoolIdentifier(message.poolId);
          }),
        ),
      );

      const pools: Array<XcpNgPool> = await XcpNgPoolService.findBy({
        query: {
          projectId: data.projectId,
          poolIdentifier: QueryHelper.any(poolIdentifiers),
        },
        select: {
          _id: true,
          poolIdentifier: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const poolIdByIdentifier: Map<string, ObjectID> = new Map();
      for (const pool of pools) {
        if (pool.id && pool.poolIdentifier) {
          poolIdByIdentifier.set(
            XcpNgTelemetryUtil.normalizePoolIdentifier(pool.poolIdentifier),
            pool.id,
          );
        }
      }

      // What each message is about, by its name in the pools' inventory.
      const objectUuids: Array<string> = Array.from(
        new Set(
          messages
            .map((message: XcpNgPoolMessage): string => {
              return (message.objectUuid || "").toLowerCase();
            })
            .filter((uuid: string): boolean => {
              return uuid.length > 0;
            }),
        ),
      );
      const names: Map<string, string> = new Map();

      if (objectUuids.length > 0 && poolIdByIdentifier.size > 0) {
        const resources: Array<XcpNgResource> = await XcpNgResourceService.findBy(
          {
            query: {
              projectId: data.projectId,
              xcpNgPoolId: QueryHelper.any(
                Array.from(poolIdByIdentifier.values()).map(
                  (id: ObjectID): string => {
                    return id.toString();
                  },
                ),
              ),
              externalId: QueryHelper.any(objectUuids),
            },
            select: {
              externalId: true,
              name: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
              isRoot: true,
            },
          },
        );

        for (const resource of resources) {
          if (resource.externalId && resource.name) {
            names.set(resource.externalId.toLowerCase(), resource.name);
          }
        }
      }

      let written: number = 0;

      for (const message of messages) {
        const xcpNgPoolId: ObjectID | undefined = poolIdByIdentifier.get(
          XcpNgTelemetryUtil.normalizePoolIdentifier(message.poolId),
        );

        if (!xcpNgPoolId) {
          continue;
        }

        const line: {
          feedInfo: MarkdownText;
          moreInformation: MarkdownText | null;
        } = getXcpNgMessageFeedLine({
          message: message,
          objectName: names.get((message.objectUuid || "").toLowerCase()),
        });
        const postedAt: Date = new Date(message.timestamp);

        await XcpNgPoolFeedService.createXcpNgPoolFeedItem({
          xcpNgPoolId: xcpNgPoolId,
          projectId: data.projectId,
          xcpNgPoolFeedEventType: XcpNgPoolFeedEventType.XcpNgPoolMessage,
          displayColor: getXcpNgMessageColor(message.priority),
          feedInfoInMarkdown: line.feedInfo.toString(),
          moreInformationInMarkdown: line.moreInformation
            ? line.moreInformation.toString()
            : undefined,
          postedAt: Number.isNaN(postedAt.getTime()) ? undefined : postedAt,
        });

        written++;
      }

      return written;
    } catch (error) {
      logger.error(
        `Could not write XAPI messages to the pool feed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 0;
    }
  }
}
