import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import UserService from "../../Services/UserService";

/*
 * Shared formatting for the infrastructure and catalog resource feeds
 * (Kubernetes clusters, Docker / Podman hosts, Docker Swarm / Proxmox / Ceph
 * clusters, servers, cloud resources and catalog services).
 *
 * These resources come into existence two very different ways - somebody adds
 * one by hand, or ingest registers one the first moment telemetry mentions it -
 * and the overview page cannot tell you which happened. That is exactly the
 * question the feed exists to answer, so the wording for it lives here once
 * rather than nine times over.
 */

/*
 * Columns whose change is worth a feed entry.
 *
 * Deliberately a whitelist. Every one of these resources is written on each
 * heartbeat (lastSeenAt, otelCollectorStatus, agentVersion, and the rollup
 * counters like nodeCount / containersRunning), so a blacklist would let the
 * next counter column added to any of the nine models silently start posting
 * a feed item every 60 seconds per resource.
 */
export const MEANINGFUL_UPDATE_COLUMNS: Array<string> = [
  "name",
  "description",
  "labels",
  "isArchived",
  "retainTelemetryDataForDays",
  "telemetryRetentionConfig",
];

export interface ResourceFeedMarkdown {
  feedInfoInMarkdown: string;
  moreInformationInMarkdown: string;
}

export default class ResourceFeedUtil {
  /**
   * The subset of an update payload that a human would want to see on the
   * feed. Empty means the write was ingest bookkeeping and no feed item
   * should be posted at all.
   */
  public static getUpdatedColumnsWorthRecording(
    updateData: JSONObject | undefined,
  ): Array<string> {
    if (!updateData) {
      return [];
    }

    return Object.keys(updateData).filter((column: string) => {
      return MEANINGFUL_UPDATE_COLUMNS.includes(column);
    });
  }

  /**
   * True when this update is an archive/restore rather than an edit. Archive
   * and restore get their own event types because they are the two changes
   * that take a resource out of - and back into - everyday views.
   */
  public static isArchiveChange(updateData: JSONObject | undefined): boolean {
    return Boolean(updateData) && "isArchived" in (updateData as JSONObject);
  }

  /**
   * Markdown for the "this resource was created" feed item, including who
   * created it and whether it was registered automatically from telemetry.
   *
   * The distinction is drawn on whether a user is attached to the create:
   * ingest creates these rows with root props and no acting user, while every
   * dashboard, API and Terraform create carries one.
   */
  public static async getCreatedFeedMarkdown(data: {
    resourceTypeName: string;
    resourceMarkdownLink: string;
    projectId: ObjectID;
    createdByUserId?: ObjectID | undefined;
    identifierName?: string | undefined;
    identifierValue?: string | undefined;
    description?: string | undefined;
  }): Promise<ResourceFeedMarkdown> {
    const details: Array<string> = [];

    if (data.identifierName && data.identifierValue) {
      details.push(`**${data.identifierName}**: \`${data.identifierValue}\``);
    }

    if (data.description) {
      details.push(`**Description**: ${data.description}`);
    }

    if (data.createdByUserId) {
      const userMarkdown: string = await UserService.getUserMarkdownString({
        userId: data.createdByUserId,
        projectId: data.projectId,
      });

      return {
        feedInfoInMarkdown: `🚀 ${data.resourceMarkdownLink} was created by **${userMarkdown}**.`,
        moreInformationInMarkdown: [
          `**Created by**: ${userMarkdown}`,
          `**How it was created**: Added by a user, from the OneUptime dashboard or through the OneUptime API.`,
          `**Automatically created from telemetry**: No.`,
          ...details,
        ].join("\n\n"),
      };
    }

    return {
      feedInfoInMarkdown: `🤖 ${data.resourceMarkdownLink} was created automatically by OneUptime the first time telemetry for it arrived.`,
      moreInformationInMarkdown: [
        `**Created by**: No user. OneUptime created this ${data.resourceTypeName} on its own.`,
        `**How it was created**: A OneUptime agent or OpenTelemetry collector reported data for a ${data.resourceTypeName} that did not exist in this project yet, so it was registered automatically so the data had somewhere to land.`,
        `**Automatically created from telemetry**: Yes.`,
        ...details,
      ].join("\n\n"),
    };
  }

  /**
   * Markdown for the "this resource was edited" feed item. `columns` comes
   * from getUpdatedColumnsWorthRecording, so it never names an ingest column.
   */
  public static getUpdatedFeedMarkdown(data: {
    resourceMarkdownLink: string;
    columns: Array<string>;
  }): ResourceFeedMarkdown {
    return {
      feedInfoInMarkdown: `📝 ${data.resourceMarkdownLink} was updated.`,
      moreInformationInMarkdown: `**Updated fields**: ${data.columns
        .map((column: string) => {
          return `\`${column}\``;
        })
        .join(", ")}`,
    };
  }
}
