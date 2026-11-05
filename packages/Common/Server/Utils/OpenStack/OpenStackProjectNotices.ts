import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import OpenStackProjectNotice from "../../../Models/DatabaseModels/OpenStackProjectNotice";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import { ScheduledMaintenanceFeedEventType } from "../../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Indigo500 } from "../../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OPENSTACK_BLAST_RADIUS_COUNTS,
  OpenStackBlastRadius,
  OpenStackBlastRadiusCount,
  OpenStackBlastRadiusProject,
} from "../../../Types/OpenStack/OpenStackBlastRadius";
import {
  OpenStackMaintenancePart,
  OpenStackMaintenancePartKind,
  readOpenStackMaintenanceParts,
} from "../../../Types/OpenStack/OpenStackMaintenancePart";
import {
  OpenStackProjectNoticeDecision,
  OpenStackProjectNoticeEvent,
  OpenStackProjectNoticeRecipient,
  OpenStackProjectNotTold,
  OpenStackProjectTold,
  countOpenStackProjectsNotTold,
  decideOpenStackProjectNotices,
  getOpenStackNoticePartKey,
  getOpenStackProjectsToDecideFor,
} from "../../../Types/OpenStack/OpenStackProjectNotice";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  describeOpenStackPartToAProject,
  getOpenStackStatusPageServiceOfPart,
} from "../../../Types/OpenStack/OpenStackStatusPageService";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import { OpenStackProjectNoticeFacts } from "../../../Utils/OpenStack/OpenStackProjectNoticeText";
import IncidentFeedService from "../../Services/IncidentFeedService";
import OpenStackProjectNoticeDeliveryService, {
  OpenStackProjectNoticeDeliveryToRecord,
} from "../../Services/OpenStackProjectNoticeDeliveryService";
import OpenStackProjectNoticeService from "../../Services/OpenStackProjectNoticeService";
import OpenStackResourceService from "../../Services/OpenStackResourceService";
import ScheduledMaintenanceFeedService from "../../Services/ScheduledMaintenanceFeedService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import {
  OpenStackAlertContextResult,
  OpenStackSeriesDescription,
} from "./OpenStackAlertContext";
import OpenStackMaintenanceReach from "./OpenStackMaintenanceReach";

/*
 * WRITING DOWN WHO IS TO BE TOLD.
 *
 * Where a monitor opens an incident, and where a maintenance event is made. What this writes is what a
 * worker sends (OpenStackProjectNoticeSender): the opening goes on, one failing here takes nothing with
 * it, and what a project holds on the part is kept as it stood when the part failed.
 *
 * Reads who is told through decideOpenStackProjectNotices and nothing else, the same as a preview does.
 */

export function toOpenStackNoticeRecipient(
  notice: OpenStackProjectNotice,
): OpenStackProjectNoticeRecipient {
  return {
    id: (notice._id || notice.id?.toString() || "").toString(),
    openStackProjectId: notice.openStackProjectId || "",
    email: notice.email?.toString() || null,
    webhookUrl: notice.webhookUrl?.toString() || null,
    statusPageId: notice.statusPageId?.toString() || null,
    isEnabled: notice.isEnabled,
    previewedRecipient: notice.previewedRecipient,
    previewSeenAt: notice.previewSeenAt,
  };
}

function holdingsOf(
  project: OpenStackBlastRadiusProject,
): Partial<Pick<OpenStackBlastRadius, OpenStackBlastRadiusCount>> {
  const holdings: Partial<Pick<OpenStackBlastRadius, OpenStackBlastRadiusCount>> =
    {};
  for (const entry of OPENSTACK_BLAST_RADIUS_COUNTS) {
    if (project[entry.count] > 0) {
      holdings[entry.count] = project[entry.count];
    }
  }
  return holdings;
}

export default class OpenStackProjectNotices {
  public static async readNotices(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }): Promise<Array<OpenStackProjectNotice>> {
    return await OpenStackProjectNoticeService.findBy({
      query: {
        projectId: data.projectId,
        openStackCloudId: data.openStackCloudId,
      },
      select: {
        _id: true,
        openStackProjectId: true,
        email: true,
        webhookUrl: true,
        statusPageId: true,
        isEnabled: true,
        previewedRecipient: true,
        previewSeenAt: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });
  }

  // Which of these projects the inventory holds now. Asked only of those a recipient is waiting on.
  public static async readExistingProjects(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    openStackProjectIds: ReadonlyArray<string>;
  }): Promise<Set<string>> {
    if (data.openStackProjectIds.length === 0) {
      return new Set();
    }

    const rows: Array<OpenStackResource> =
      await OpenStackResourceService.findBy({
        query: {
          projectId: data.projectId,
          openStackCloudId: data.openStackCloudId,
          kind: OpenStackResourceKind.Project,
          externalId: QueryHelper.any([...data.openStackProjectIds]),
        },
        select: { externalId: true },
        skip: 0,
        limit: data.openStackProjectIds.length,
        props: { isRoot: true },
      });

    return new Set(
      rows.map((row: OpenStackResource): string => {
        return row.externalId || "";
      }),
    );
  }

  // The one answer: a preview, a page and a send all come through here.
  public static async decide(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    radius: OpenStackBlastRadius | null;
    ownerProjectId?: string | null | undefined;
  }): Promise<OpenStackProjectNoticeDecision> {
    const notices: Array<OpenStackProjectNotice> = await this.readNotices(data);
    const recipients: Array<OpenStackProjectNoticeRecipient> = notices.map(
      toOpenStackNoticeRecipient,
    );
    const waiting: Set<string> = new Set(
      recipients.map((notice: OpenStackProjectNoticeRecipient): string => {
        return notice.openStackProjectId;
      }),
    );

    return decideOpenStackProjectNotices({
      radius: data.radius,
      ownerProjectId: data.ownerProjectId,
      notices: recipients,
      existingProjectIds: await this.readExistingProjects({
        projectId: data.projectId,
        openStackCloudId: data.openStackCloudId,
        openStackProjectIds: getOpenStackProjectsToDecideFor({
          radius: data.radius,
          ownerProjectId: data.ownerProjectId,
        })
          .map((project: OpenStackBlastRadiusProject): string => {
            return project.projectId;
          })
          .filter((id: string): boolean => {
            return waiting.has(id);
          }),
      }),
    });
  }

  // What the operator reads of who was told: short, however many projects a host holds.
  public static describeDecision(
    decision: OpenStackProjectNoticeDecision,
  ): MarkdownText | null {
    const withRecipients: Array<OpenStackProjectNotTold> =
      decision.notTold.filter((project: OpenStackProjectNotTold): boolean => {
        return project.recipientCount > 0;
      });

    if (decision.told.length === 0 && withRecipients.length === 0) {
      return null;
    }

    const lines: Array<MarkdownText> = [];
    const told: Map<string, number> = new Map();
    const names: Map<string, string> = new Map();

    for (const one of decision.told) {
      const id: string = one.project.projectId;
      told.set(id, (told.get(id) || 0) + 1);
      names.set(id, one.project.name || id);
    }

    for (const [id, count] of told.entries()) {
      lines.push(
        mdText`Will tell ${names.get(id) || id}: ${count} ${count === 1 ? "recipient" : "recipients"}.`,
      );
    }

    for (const { reason, count } of countOpenStackProjectsNotTold(
      withRecipients,
    )) {
      lines.push(
        mdText`Will not tell ${count} ${count === 1 ? "project" : "projects"}: ${reason}.`,
      );
    }

    return mdText`**OpenStack project notices:**\n\n${FeedMarkdown.bulletList(lines)}`;
  }

  private static factsFor(data: {
    told: OpenStackProjectTold;
    event: OpenStackProjectNoticeEvent;
    partKind: string;
    partName?: string | null | undefined;
    partExternalId?: string | null | undefined;
    regionName?: string | null | undefined;
    zoneName?: string | null | undefined;
    occurredAt: Date;
    startsAt?: Date | null | undefined;
    endsAt?: Date | null | undefined;
  }): OpenStackProjectNoticeFacts {
    return {
      event: data.event,
      projectId: data.told.project.projectId,
      projectName: data.told.project.name,
      partKind: data.partKind,
      service:
        getOpenStackStatusPageServiceOfPart({
          kind: data.partKind,
          name: data.partName,
          externalId: data.partExternalId,
        }) || null,
      partWords: describeOpenStackPartToAProject({
        kind: data.partKind,
        name: data.partName,
        externalId: data.partExternalId,
      }),
      regionName: data.regionName || null,
      zoneName: data.zoneName || null,
      holdings: holdingsOf(data.told.project),
      occurredAt: data.occurredAt.toISOString(),
      startsAt: data.startsAt ? new Date(data.startsAt).toISOString() : null,
      endsAt: data.endsAt ? new Date(data.endsAt).toISOString() : null,
    };
  }

  /*
   * An incident on a part: once the part is known and its reach read. A series that names no part is
   * about nothing a project would recognise, and a private incident stays between its people.
   */
  public static async recordForIncident(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    isPrivate?: boolean | undefined;
    series: OpenStackSeriesDescription;
  }): Promise<void> {
    try {
      const context: OpenStackAlertContextResult | undefined =
        data.series.context;
      const openStackCloudId: ObjectID | null = data.series.openStackCloudId;

      if (!context || !openStackCloudId || !context.partKind || data.isPrivate) {
        return;
      }

      const decision: OpenStackProjectNoticeDecision = await this.decide({
        projectId: data.projectId,
        openStackCloudId,
        radius: context.radius,
        ownerProjectId: context.projectId,
      });

      const partKey: string = getOpenStackNoticePartKey({
        kind: context.partKind,
        externalId: context.partExternalId,
        name: context.partName,
        regionName: context.partRegionName,
      });
      const occurredAt: Date = OneUptimeDate.getCurrentDate();

      await OpenStackProjectNoticeDeliveryService.recordIfNew(
        decision.told.map(
          (
            told: OpenStackProjectTold,
          ): OpenStackProjectNoticeDeliveryToRecord => {
            return {
              projectId: data.projectId,
              openStackCloudId,
              openStackProjectNoticeId: told.notice.id,
              openStackProjectId: told.project.projectId,
              event: OpenStackProjectNoticeEvent.IncidentOpened,
              dedupeKey: `incident:${data.incidentId.toString()}:opened`,
              partKey,
              incidentId: data.incidentId,
              facts: this.factsFor({
                told,
                event: OpenStackProjectNoticeEvent.IncidentOpened,
                partKind: context.partKind!,
                partName: context.partName,
                partExternalId: context.partExternalId,
                regionName: context.partRegionName,
                occurredAt,
              }) as unknown as JSONObject,
            };
          },
        ),
      );

      const line: MarkdownText | null = this.describeDecision(decision);

      if (line) {
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: data.incidentId,
          projectId: data.projectId,
          incidentFeedEventType: IncidentFeedEventType.SubscriberNotificationSent,
          displayColor: Indigo500,
          feedInfoInMarkdown: line.toString(),
        });
      }
    } catch (error) {
      logger.error(
        `Could not write down who to tell about an OpenStack incident: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // A maintenance event on a host or a zone: one notice for a project however many parts it names.
  public static async recordForMaintenance(data: {
    projectId: ObjectID;
    scheduledMaintenanceId: ObjectID;
    openStackParts: unknown;
    startsAt?: Date | null | undefined;
    endsAt?: Date | null | undefined;
  }): Promise<void> {
    const parts: Array<OpenStackMaintenancePart> =
      readOpenStackMaintenanceParts(data.openStackParts);

    try {
      const byCloud: Map<string, Array<OpenStackMaintenancePart>> = new Map();

      for (const part of parts) {
        byCloud.set(part.openStackCloudId, [
          ...(byCloud.get(part.openStackCloudId) || []),
          part,
        ]);
      }

      for (const [cloudId, partsOfCloud] of byCloud.entries()) {
        const openStackCloudId: ObjectID = new ObjectID(cloudId);
        const radius: OpenStackBlastRadius =
          await OpenStackMaintenanceReach.read({
            projectId: data.projectId,
            openStackCloudId,
            parts: partsOfCloud,
          });
        const decision: OpenStackProjectNoticeDecision = await this.decide({
          projectId: data.projectId,
          openStackCloudId,
          radius,
        });
        const first: OpenStackMaintenancePart = partsOfCloud[0]!;
        const isOneZone: boolean =
          partsOfCloud.length === 1 &&
          first.kind === OpenStackMaintenancePartKind.AvailabilityZone;
        const occurredAt: Date = OneUptimeDate.getCurrentDate();

        await OpenStackProjectNoticeDeliveryService.recordIfNew(
          decision.told.map(
            (
              told: OpenStackProjectTold,
            ): OpenStackProjectNoticeDeliveryToRecord => {
              return {
                projectId: data.projectId,
                openStackCloudId,
                openStackProjectNoticeId: told.notice.id,
                openStackProjectId: told.project.projectId,
                event: OpenStackProjectNoticeEvent.MaintenancePlanned,
                dedupeKey: `maintenance:${data.scheduledMaintenanceId.toString()}:planned`,
                partKey: `maintenance:${data.scheduledMaintenanceId.toString()}`,
                scheduledMaintenanceId: data.scheduledMaintenanceId,
                facts: this.factsFor({
                  told,
                  event: OpenStackProjectNoticeEvent.MaintenancePlanned,
                  partKind: isOneZone
                    ? OpenStackMaintenancePartKind.AvailabilityZone
                    : OpenStackResourceKind.Hypervisor,
                  regionName: first.regionName,
                  zoneName: isOneZone ? first.name : null,
                  occurredAt,
                  startsAt: data.startsAt,
                  endsAt: data.endsAt,
                }) as unknown as JSONObject,
              };
            },
          ),
        );

        const line: MarkdownText | null = this.describeDecision(decision);

        if (line) {
          await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem(
            {
              scheduledMaintenanceId: data.scheduledMaintenanceId,
              projectId: data.projectId,
              scheduledMaintenanceFeedEventType:
                ScheduledMaintenanceFeedEventType.SubscriberNotificationSent,
              displayColor: Indigo500,
              feedInfoInMarkdown: line.toString(),
            },
          );
        }
      }
    } catch (error) {
      logger.error(
        `Could not write down who to tell about an OpenStack maintenance event: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
