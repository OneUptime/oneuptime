import { ScheduledMaintenanceFeedEventType } from "../../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Indigo500 } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenStackBlastRadius,
  getEmptyOpenStackBlastRadius,
  isOpenStackBlastRadiusEmpty,
  mergeOpenStackBlastRadii,
} from "../../../Types/OpenStack/OpenStackBlastRadius";
import {
  OpenStackMaintenancePart,
  OpenStackMaintenancePartKind,
  readOpenStackMaintenanceParts,
} from "../../../Types/OpenStack/OpenStackMaintenancePart";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import OpenStackResourceService from "../../Services/OpenStackResourceService";
import ScheduledMaintenanceFeedService from "../../Services/ScheduledMaintenanceFeedService";
import logger from "../Logger";
import OpenStackAlertContext from "./OpenStackAlertContext";
import OpenStackMaintenanceParts from "./OpenStackMaintenanceParts";

/*
 * WHAT A MAINTENANCE EVENT ON A HOST OR A ZONE TAKES WITH IT.
 *
 * "Which of my projects does this touch?" is asked before the work starts, so the event answers it
 * when it is made, by the same blast radius an incident on the host reads. In its feed rather than its
 * description: a description goes on status pages, and this names projects.
 *
 * Never in the way of the event: if any of this fails, the event is still made.
 */
export default class OpenStackMaintenanceReach {
  // One answer for all of a cloud's parts: a project on two of them is one project.
  public static async read(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    parts: ReadonlyArray<OpenStackMaintenancePart>;
  }): Promise<OpenStackBlastRadius> {
    const radii: Array<OpenStackBlastRadius> = [];

    for (const part of data.parts) {
      const hostNames: Array<string> =
        part.kind === OpenStackMaintenancePartKind.AvailabilityZone
          ? await OpenStackMaintenanceParts.readHostsOfZone({
              projectId: data.projectId,
              openStackCloudId: data.openStackCloudId,
              zoneName: part.name,
              regionName: part.regionName,
            })
          : [part.name];

      for (const hostName of hostNames) {
        radii.push(
          await OpenStackResourceService.getBlastRadius({
            projectId: data.projectId,
            openStackCloudId: data.openStackCloudId,
            part: {
              kind: OpenStackResourceKind.Hypervisor,
              name: hostName,
              hypervisorName: hostName,
              regionName: part.regionName,
            },
            includeEveryProject: true,
          }),
        );
      }
    }

    return radii.length > 0
      ? mergeOpenStackBlastRadii(radii)
      : getEmptyOpenStackBlastRadius(true);
  }

  public static async nameInFeed(data: {
    projectId: ObjectID;
    scheduledMaintenanceId: ObjectID;
    openStackParts: unknown;
  }): Promise<void> {
    const parts: Array<OpenStackMaintenancePart> =
      readOpenStackMaintenanceParts(data.openStackParts);

    if (parts.length === 0) {
      return;
    }

    try {
      for (const cloudId of OpenStackMaintenanceParts.getCloudsWithParts(
        parts,
      )) {
        const radius: OpenStackBlastRadius = await this.read({
          projectId: data.projectId,
          openStackCloudId: new ObjectID(cloudId),
          parts: parts.filter((part: OpenStackMaintenancePart): boolean => {
            return part.openStackCloudId === cloudId;
          }),
        });

        const lines: string = isOpenStackBlastRadiusEmpty(radius)
          ? mdText`**What this affects:** OpenStack holds nothing of any project on these parts now.`.toString()
          : OpenStackAlertContext.toMarkdown({
              radius,
              projectId: null,
              projectName: null,
              domainId: null,
              partKind: OpenStackResourceKind.Hypervisor,
            });

        await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem(
          {
            scheduledMaintenanceId: data.scheduledMaintenanceId,
            projectId: data.projectId,
            scheduledMaintenanceFeedEventType:
              ScheduledMaintenanceFeedEventType.ScheduledMaintenanceUpdated,
            displayColor: Indigo500,
            feedInfoInMarkdown: lines,
          },
        );
      }
    } catch (error) {
      logger.error(
        `Could not name what an OpenStack maintenance event affects: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
