import crypto from "crypto";
import ChangeEventService from "../../Services/ChangeEventService";
import OpenStackCloudFeedService from "../../Services/OpenStackCloudFeedService";
import OpenStackResourceService, {
  OpenStackStateChange,
} from "../../Services/OpenStackResourceService";
import GlobalCache from "../../Infrastructure/GlobalCache";
import OpenStackCloudFeed, {
  OpenStackCloudFeedEventType,
} from "../../../Models/DatabaseModels/OpenStackCloudFeed";
import { Red500 } from "../../../Types/BrandColors";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackEventImportance,
  OpenStackEventOutcome,
} from "../../../Utils/OpenStack/OpenStackNotifications";
import logger from "../Logger";
import {
  DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS,
  buildChangeEventDbRow,
} from "../Telemetry/ChangeEventRow";
import TelemetryFanInWriter, {
  FanInSubmitResult,
} from "../Telemetry/TelemetryFanInWriter";
import {
  OpenStackRecordedEvent,
  buildOpenStackChangeEntry,
  buildOpenStackFeedLine,
  buildOpenStackFeedSummaryLine,
  chooseOpenStackFeedEvents,
} from "./OpenStackEventEntries";

/*
 * WHERE AN OPENSTACK EVENT GOES ONCE ITS LOG IS STORED.
 *
 *   - A change event, for what is worth a marker: the part's charts and Feed tab, and a
 *     suspect for OneUptime AI (OpenStackEventEntries).
 *   - A line on the cloud's feed, bounded (FEED_LINES_PER_HOUR).
 *   - OpenStackResource.stateChangedAt, with when it really happened rather than when
 *     the next scrape noticed. A part the scrape has not seen yet is remembered for a
 *     little while and written when it does: an instance that failed to build is new to
 *     the inventory, and its failure is exactly what should be dated right.
 *
 * Best effort, as every inventory write on the log path is: the logs are already stored,
 * and nothing here ever fails the batch. A batch BullMQ runs again writes its change
 * events once (the insert's own token) and its feed lines once (FEED_NAMESPACE).
 */

const FEED_NAMESPACE: string = "openstack-event-feed";
const FEED_RETRY_MEMORY_IN_SECONDS: number = 24 * 60 * 60;

// The most lines one batch and one hour put on a cloud's feed.
export const OPENSTACK_FEED_LINES_PER_BATCH: number = 25;
export const OPENSTACK_FEED_LINES_PER_HOUR: number = 300;

const PENDING_NAMESPACE: string = "openstack-event-pending-state";
// Long enough for the scrape of the slowest service to come round twice.
const PENDING_TTL_IN_SECONDS: number = 15 * 60;
const MAX_PENDING_STATE_CHANGES: number = 500;

export interface OpenStackEventBufferEntry {
  cloudName: string;
  events: Array<OpenStackRecordedEvent>;
}

function readEventKey(recorded: OpenStackRecordedEvent): string {
  const { event } = recorded;

  return (
    event.messageId ||
    `${event.type}/${(event.part && event.part.id) || ""}/${recorded.time.getTime()}`
  );
}

function hashOf(values: Array<string>): string {
  return crypto.createHash("sha256").update(values.join("\n")).digest("hex");
}

// The newest change of each part, as the update wants it.
export function toOpenStackStateChanges(
  events: Array<OpenStackRecordedEvent>,
): Array<OpenStackStateChange> {
  const newest: Map<string, OpenStackStateChange> = new Map();

  for (const recorded of events) {
    const { event } = recorded;

    if (!event.movesState || !event.part) {
      continue;
    }

    const isService: boolean =
      event.part.kind === OpenStackResourceKind.Service;
    const change: OpenStackStateChange = {
      kind: event.part.kind,
      externalId: isService ? "" : event.part.id,
      binary: isService ? event.part.binary : "",
      host: isService ? event.host : "",
      at: recorded.time,
    };
    const key: string = `${change.kind}/${change.externalId}/${change.binary}/${change.host}`;
    const known: OpenStackStateChange | undefined = newest.get(key);

    if (!known || known.at.getTime() < change.at.getTime()) {
      newest.set(key, change);
    }
  }

  return Array.from(newest.values());
}

function toJson(change: OpenStackStateChange): JSONObject {
  return {
    kind: change.kind,
    externalId: change.externalId,
    binary: change.binary,
    host: change.host,
    at: change.at.toISOString(),
  };
}

function fromJson(value: unknown): OpenStackStateChange | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const json: JSONObject = value as JSONObject;
  const at: Date = new Date(String(json["at"]));

  if (typeof json["kind"] !== "string" || Number.isNaN(at.getTime())) {
    return null;
  }

  return {
    kind: json["kind"] as OpenStackResourceKind,
    externalId: String(json["externalId"] || ""),
    binary: String(json["binary"] || ""),
    host: String(json["host"] || ""),
    at,
  };
}

export default class OpenStackEventRecorder {
  // One batch's events of one cloud. Never throws.
  public static async record(data: {
    projectId: ObjectID;
    cloudId: ObjectID;
    entry: OpenStackEventBufferEntry;
  }): Promise<void> {
    const changes: Array<OpenStackRecordedEvent> = data.entry.events.filter(
      (recorded: OpenStackRecordedEvent): boolean => {
        return recorded.event.importance === OpenStackEventImportance.Change;
      },
    );

    await this.attempt("change events", data.cloudId, async (): Promise<void> => {
      await this.writeChangeEvents({
        projectId: data.projectId,
        cloudId: data.cloudId,
        cloudName: data.entry.cloudName,
        events: changes,
      });
    });

    await this.attempt("feed lines", data.cloudId, async (): Promise<void> => {
      await this.writeFeedLines({
        projectId: data.projectId,
        cloudId: data.cloudId,
        events: changes,
      });
    });

    await this.attempt("state changes", data.cloudId, async (): Promise<void> => {
      await this.writeStateChanges({
        projectId: data.projectId,
        cloudId: data.cloudId,
        events: data.entry.events,
      });
    });
  }

  private static async attempt(
    what: string,
    cloudId: ObjectID,
    write: () => Promise<void>,
  ): Promise<void> {
    try {
      await write();
    } catch (error) {
      logger.warn(
        `OpenStack ${what} could not be recorded for cloud ${cloudId.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private static async writeChangeEvents(data: {
    projectId: ObjectID;
    cloudId: ObjectID;
    cloudName: string;
    events: Array<OpenStackRecordedEvent>;
  }): Promise<void> {
    if (data.events.length === 0) {
      return;
    }

    const rows: Array<JSONObject> = data.events.map(
      (recorded: OpenStackRecordedEvent): JSONObject => {
        return buildChangeEventDbRow({
          parsed: buildOpenStackChangeEntry({
            recorded,
            cloudId: data.cloudId,
            cloudName: data.cloudName,
          }),
          projectId: data.projectId,
          // Project-wide, as a cloud account's are: see OpenStackEventEntries.
          serviceMetadata: null,
          retentionDays: DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS,
        });
      },
    );

    const submission: FanInSubmitResult = await TelemetryFanInWriter.submit(
      ChangeEventService,
      rows,
    );

    await submission.flushed;
  }

  private static async writeFeedLines(data: {
    projectId: ObjectID;
    cloudId: ObjectID;
    events: Array<OpenStackRecordedEvent>;
  }): Promise<void> {
    if (data.events.length === 0) {
      return;
    }

    /*
     * A batch BullMQ runs again holds the same notifications, and a feed has no token
     * that would drop its second line.
     */
    const isFirstTime: boolean = await GlobalCache.setStringIfNotExists(
      FEED_NAMESPACE,
      `${data.cloudId.toString()}:${hashOf(data.events.map(readEventKey))}`,
      "1",
      { expiresInSeconds: FEED_RETRY_MEMORY_IN_SECONDS },
    );

    if (!isFirstTime) {
      return;
    }

    const selection: {
      chosen: Array<OpenStackRecordedEvent>;
      leftOut: number;
    } = chooseOpenStackFeedEvents(data.events, OPENSTACK_FEED_LINES_PER_BATCH);

    for (const recorded of selection.chosen) {
      const allowed: number | null = await GlobalCache.incrementIfBelow(
        FEED_NAMESPACE,
        `hour:${data.cloudId.toString()}`,
        {
          limit: OPENSTACK_FEED_LINES_PER_HOUR,
          expiresInSeconds: 60 * 60,
        },
      );

      if (allowed === null) {
        return;
      }

      await OpenStackCloudFeedService.createOpenStackCloudFeedItem({
        openStackCloudId: data.cloudId,
        projectId: data.projectId,
        openStackCloudFeedEventType: OpenStackCloudFeedEventType.LifecycleEvent,
        feedInfoInMarkdown: buildOpenStackFeedLine(recorded).toString(),
        displayColor:
          recorded.event.outcome === OpenStackEventOutcome.Failed
            ? Red500
            : undefined,
        postedAt: recorded.time,
      });
    }

    if (selection.leftOut > 0) {
      await OpenStackCloudFeedService.createOpenStackCloudFeedItem({
        openStackCloudId: data.cloudId,
        projectId: data.projectId,
        openStackCloudFeedEventType: OpenStackCloudFeedEventType.LifecycleEvent,
        feedInfoInMarkdown: buildOpenStackFeedSummaryLine(
          selection.leftOut,
        ).toString(),
      });
    }
  }

  private static async writeStateChanges(data: {
    projectId: ObjectID;
    cloudId: ObjectID;
    events: Array<OpenStackRecordedEvent>;
  }): Promise<void> {
    const changes: Array<OpenStackStateChange> = toOpenStackStateChanges(
      data.events,
    );

    if (changes.length === 0) {
      return;
    }

    const unmatched: Array<OpenStackStateChange> =
      await OpenStackResourceService.recordStateChanges({
        projectId: data.projectId,
        openStackCloudId: data.cloudId,
        changes,
      });

    if (unmatched.length === 0) {
      return;
    }

    /*
     * Parts the scrape has not told the inventory about yet. Kept apart from one writer
     * to the next by nothing but last-one-wins: losing one costs a date a scrape's
     * length late, which is what every part had before this.
     */
    const key: string = data.cloudId.toString();
    const pending: unknown = await GlobalCache.getJSONArray(
      PENDING_NAMESPACE,
      key,
    );
    const known: Array<JSONObject> = Array.isArray(pending)
      ? (pending as Array<JSONObject>)
      : [];

    await GlobalCache.setJSON(
      PENDING_NAMESPACE,
      key,
      [...known, ...unmatched.map(toJson)].slice(-MAX_PENDING_STATE_CHANGES),
      { expiresInSeconds: PENDING_TTL_IN_SECONDS },
    );
  }

  /*
   * After a scrape wrote the inventory: the state changes of parts it has just told the
   * inventory about. What still matches nothing is left for the next one, until it ages
   * out. Never throws: this runs on the metrics path.
   */
  public static async applyPendingStateChanges(data: {
    projectId: ObjectID;
    cloudId: ObjectID;
  }): Promise<void> {
    await this.attempt(
      "pending state changes",
      data.cloudId,
      async (): Promise<void> => {
        const key: string = data.cloudId.toString();
        const pending: unknown = await GlobalCache.getJSONArray(
          PENDING_NAMESPACE,
          key,
        );

        if (!Array.isArray(pending) || pending.length === 0) {
          return;
        }

        const changes: Array<OpenStackStateChange> = [];

        for (const value of pending) {
          const change: OpenStackStateChange | null = fromJson(value);

          if (change) {
            changes.push(change);
          }
        }

        const unmatched: Array<OpenStackStateChange> =
          await OpenStackResourceService.recordStateChanges({
            projectId: data.projectId,
            openStackCloudId: data.cloudId,
            changes,
          });

        if (unmatched.length === 0) {
          await GlobalCache.deleteKey(PENDING_NAMESPACE, key);
          return;
        }

        const now: Date = OneUptimeDate.getCurrentDate();

        await GlobalCache.setJSON(
          PENDING_NAMESPACE,
          key,
          unmatched
            .filter((change: OpenStackStateChange): boolean => {
              return (
                now.getTime() - change.at.getTime() <
                PENDING_TTL_IN_SECONDS * 1000
              );
            })
            .map(toJson),
          { expiresInSeconds: PENDING_TTL_IN_SECONDS },
        );
      },
    );
  }
}

// Only so a test can name the feed's model without reading the service.
export { OpenStackCloudFeed };
