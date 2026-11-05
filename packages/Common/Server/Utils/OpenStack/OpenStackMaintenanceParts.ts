import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenStackMaintainedCloud,
  OpenStackMaintainedPart,
  OpenStackMaintenancePart,
  OpenStackMaintenancePartKind,
  getOpenStackMachineOfHost,
  readOpenStackMaintenanceParts,
} from "../../../Types/OpenStack/OpenStackMaintenancePart";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import OpenStackCloudService from "../../Services/OpenStackCloudService";
import OpenStackResourceService from "../../Services/OpenStackResourceService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../Services/ScheduledMaintenanceStateService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";

/*
 * WHICH MACHINES THE PARTS A MAINTENANCE EVENT NAMES COME TO.
 *
 * What MonitorMaintenanceSuppression asks while an event is on, and only then: no event in progress
 * names a part, and this reads nothing. A read that fails silences nothing, because planned work that
 * pages is a nuisance and an outage that does not page is not.
 */
export default class OpenStackMaintenanceParts {
  public static getCloudsWithParts(value: unknown): Set<string> {
    return new Set(
      readOpenStackMaintenanceParts(value).map(
        (part: OpenStackMaintenancePart): string => {
          return part.openStackCloudId;
        },
      ),
    );
  }

  public static async readMaintainedClouds(data: {
    projectId: ObjectID;
    events: ReadonlyArray<{ openStackParts?: unknown }>;
  }): Promise<Array<OpenStackMaintainedCloud> | undefined> {
    const parts: Array<OpenStackMaintenancePart> = data.events.flatMap(
      (event: { openStackParts?: unknown }): Array<OpenStackMaintenancePart> => {
        return readOpenStackMaintenanceParts(event.openStackParts);
      },
    );

    if (parts.length === 0) {
      return undefined;
    }

    try {
      const cloudIds: Array<string> = Array.from(
        new Set(
          parts.map((part: OpenStackMaintenancePart): string => {
            return part.openStackCloudId;
          }),
        ),
      );

      const clouds: Array<OpenStackCloud> = await OpenStackCloudService.findBy({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.any(cloudIds),
        },
        select: { _id: true, name: true },
        skip: 0,
        limit: cloudIds.length,
        props: { isRoot: true },
      });

      const maintained: Array<OpenStackMaintainedCloud> = [];

      for (const cloud of clouds) {
        const cloudId: string = (cloud._id || "").toString().toLowerCase();
        const maintainedParts: Array<OpenStackMaintainedPart> = [];

        for (const part of parts) {
          if (part.openStackCloudId === cloudId) {
            maintainedParts.push({
              regionName: part.regionName,
              hostNames:
                part.kind === OpenStackMaintenancePartKind.AvailabilityZone
                  ? await this.readHostsOfZone({
                      projectId: data.projectId,
                      openStackCloudId: new ObjectID(cloudId),
                      zoneName: part.name,
                      regionName: part.regionName,
                    })
                  : [part.name],
            });
          }
        }

        maintained.push({
          cloudId,
          cloudName: cloud.name || null,
          parts: maintainedParts,
        });
      }

      return maintained;
    } catch (error) {
      logger.error(
        `Could not read the parts of OpenStack clouds under maintenance, so none of them is quiet: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  /*
   * The events in progress that cover one host, for what its page says of a disable: on the host, on the
   * zone it is in, or on the whole cloud. What MonitorMaintenanceSuppression quiets by, from the host's end.
   */
  public static async readEventsCoveringHost(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    hostName: string;
    regionName: string | null;
  }): Promise<Array<{ id: string; title: string }>> {
    const inProgress: Array<ObjectID> =
      await ScheduledMaintenanceStateService.getInProgressScheduledMaintenanceStateIds(
        data.projectId,
      );

    if (inProgress.length === 0) {
      return [];
    }

    const events: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findBy({
        query: {
          projectId: data.projectId,
          currentScheduledMaintenanceStateId: QueryHelper.any(inProgress),
        },
        select: {
          _id: true,
          title: true,
          openStackParts: true,
          openStackClouds: { _id: true },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    const cloudId: string = data.openStackCloudId.toString();
    const covering: Array<{ id: string; title: string }> = [];

    for (const event of events) {
      const parts: Array<OpenStackMaintenancePart> =
        readOpenStackMaintenanceParts(event.openStackParts).filter(
          (part: OpenStackMaintenancePart): boolean => {
            return part.openStackCloudId === cloudId;
          },
        );
      const isOnTheCloud: boolean = (event.openStackClouds || []).some(
        (cloud: OpenStackCloud): boolean => {
          return String(cloud._id || "").toLowerCase() === cloudId;
        },
      );

      let isCovered: boolean = parts.length === 0 && isOnTheCloud;

      for (const part of parts) {
        const hostNames: Array<string> =
          part.kind === OpenStackMaintenancePartKind.AvailabilityZone
            ? await this.readHostsOfZone({
                projectId: data.projectId,
                openStackCloudId: data.openStackCloudId,
                zoneName: part.name,
                regionName: part.regionName,
              })
            : [part.name];

        isCovered =
          isCovered ||
          ((part.regionName || null) === (data.regionName || null) &&
            hostNames.some((hostName: string): boolean => {
              return (
                getOpenStackMachineOfHost(hostName) ===
                getOpenStackMachineOfHost(data.hostName)
              );
            }));
      }

      if (isCovered) {
        covering.push({
          id: (event._id || "").toString(),
          title: event.title || "",
        });
      }
    }

    return covering;
  }

  public static async readHostsOfZone(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    zoneName: string;
    regionName: string | null;
  }): Promise<Array<string>> {
    const hypervisors: Array<OpenStackResource> =
      await OpenStackResourceService.findBy({
        query: {
          projectId: data.projectId,
          openStackCloudId: data.openStackCloudId,
          kind: OpenStackResourceKind.Hypervisor,
          availabilityZone: data.zoneName,
          ...(data.regionName ? { regionName: data.regionName } : {}),
        },
        select: { hypervisorName: true, name: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    return hypervisors
      .map((hypervisor: OpenStackResource): string => {
        return hypervisor.hypervisorName || hypervisor.name || "";
      })
      .filter(Boolean);
  }
}
