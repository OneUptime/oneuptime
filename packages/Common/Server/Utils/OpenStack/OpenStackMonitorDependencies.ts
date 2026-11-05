import Monitor from "../../../Models/DatabaseModels/Monitor";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  getOpenStackTemplateChildren,
  getOpenStackTemplateParents,
} from "../../../Types/Monitor/OpenStackControlPlaneAlertTemplates";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil from "../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";
import { OPENSTACK_CLOUD_LOG_ATTRIBUTE } from "../../../Utils/OpenStack/OpenStackLogs";
import MonitorService from "../../Services/MonitorService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";

/*
 * ONE FAILURE, ONE INCIDENT, WITHOUT ANYONE HAVING TO SET IT UP.
 *
 * Which of a cloud's monitors waits for which is known already: OpenStackControlPlaneAlertTemplates
 * says it, by template. A stopped RabbitMQ opening twenty incidents because nobody filled in
 * twenty Dependencies pages is the failure this is here to stop. So when a monitor is made, this
 * finds out which template it is, by the fingerprint the Recommendations page knows a monitor by,
 * and links it to its cloud's others through the product's own monitor dependencies, whichever
 * order they were made in. Each link is an ordinary one: it shows on the monitor's Dependencies
 * page, and a person can take it off there. Nothing puts back what someone took off, because
 * nothing here runs but for a monitor being made.
 *
 * Never in the way: a monitor that could not be linked is still a monitor.
 */

/*
 * Never read into the fingerprint, as ResourcePartAlertCoverage says: only the shape of what a
 * monitor reads tells one from another.
 */
const PLACEHOLDER_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000000",
);

// Which cloud a step reads, whichever kind of monitor it is.
export function getCloudOfOpenStackStep(step: MonitorStep): string | null {
  const cloud: unknown =
    step.data?.openstackMonitor?.cloudIdentifier ||
    step.data?.logMonitor?.attributes?.[OPENSTACK_CLOUD_LOG_ATTRIBUTE];

  return typeof cloud === "string" && cloud ? cloud : null;
}

export function getCloudOfOpenStackMonitor(monitor: Monitor): string | null {
  for (const step of monitor.monitorSteps?.data?.monitorStepsInstanceArray ||
    []) {
    const cloud: string | null = getCloudOfOpenStackStep(step);

    if (cloud) {
      return cloud;
    }
  }

  return null;
}

/*
 * Which of OpenStack's templates each monitor was made from, on one cloud: the fingerprint the
 * Recommendations page reads, so a monitor it calls covered is one this links.
 */
export function getOpenStackTemplateOfMonitors(data: {
  cloud: string;
  monitors: Array<Monitor>;
}): Map<string, Monitor> {
  const recommendations: Array<MonitorRecommendation> =
    MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.OpenStack,
    );
  const byTemplate: Map<string, Monitor> = new Map();

  for (const monitor of data.monitors) {
    const covered: Map<string, ObjectID> =
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations,
        existingMonitors: [
          {
            monitorId: (monitor.id || new ObjectID(monitor._id!)) as ObjectID,
            monitorSteps:
              monitor.monitorSteps?.data?.monitorStepsInstanceArray || [],
          },
        ],
        args: {
          resourceIdentifier: data.cloud,
          onlineMonitorStatusId: PLACEHOLDER_ID,
          offlineMonitorStatusId: PLACEHOLDER_ID,
          defaultIncidentSeverityId: PLACEHOLDER_ID,
          defaultAlertSeverityId: PLACEHOLDER_ID,
          monitorName: data.cloud,
        },
      });

    for (const recommendation of recommendations) {
      if (
        covered.has(recommendation.recommendationId) &&
        !byTemplate.has(recommendation.templateId)
      ) {
        byTemplate.set(recommendation.templateId, monitor);
      }
    }
  }

  return byTemplate;
}

function idOf(monitor: Monitor): string {
  return ((monitor.id || monitor._id)?.toString() || "").toLowerCase();
}

export default class OpenStackMonitorDependencies {
  public static async linkMonitor(data: {
    monitorId: ObjectID;
    projectId: ObjectID;
    monitorType: MonitorType | undefined;
    monitor: Monitor;
  }): Promise<void> {
    if (
      data.monitorType !== MonitorType.OpenStack &&
      data.monitorType !== MonitorType.Logs
    ) {
      return;
    }

    const cloud: string | null = getCloudOfOpenStackMonitor(data.monitor);

    if (!cloud) {
      return;
    }

    try {
      await OpenStackMonitorDependencies.link({ ...data, cloud });
    } catch (error) {
      logger.warn(
        `Could not link a new monitor to its cloud's others: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private static async link(data: {
    monitorId: ObjectID;
    projectId: ObjectID;
    monitor: Monitor;
    cloud: string;
  }): Promise<void> {
    const created: Monitor = data.monitor;
    created.id = data.monitorId;

    const templateId: string | undefined = Array.from(
      getOpenStackTemplateOfMonitors({
        cloud: data.cloud,
        monitors: [created],
      }).keys(),
    )[0];

    if (!templateId) {
      return;
    }

    const parentTemplates: Array<string> =
      getOpenStackTemplateParents(templateId);
    const childTemplates: ReadonlyArray<string> =
      getOpenStackTemplateChildren(templateId);

    if (parentTemplates.length === 0 && childTemplates.length === 0) {
      return;
    }

    const others: Array<Monitor> = (
      await MonitorService.findBy({
        query: {
          projectId: data.projectId,
          monitorType: QueryHelper.any([
            MonitorType.OpenStack,
            MonitorType.Logs,
          ]),
        },
        select: {
          _id: true,
          monitorSteps: true,
          dependsOnMonitors: { _id: true },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      })
    ).filter((monitor: Monitor): boolean => {
      return (
        idOf(monitor) !== idOf(created) &&
        getCloudOfOpenStackMonitor(monitor) === data.cloud
      );
    });

    const byTemplate: Map<string, Monitor> = getOpenStackTemplateOfMonitors({
      cloud: data.cloud,
      monitors: others,
    });

    const parents: Array<Monitor> = parentTemplates
      .map((parent: string): Monitor | undefined => {
        return byTemplate.get(parent);
      })
      .filter((monitor: Monitor | undefined): monitor is Monitor => {
        return Boolean(monitor);
      });

    if (parents.length > 0) {
      await MonitorService.updateOneById({
        id: data.monitorId,
        data: {
          dependsOnMonitors: parents.map((parent: Monitor): Monitor => {
            return OpenStackMonitorDependencies.reference(parent);
          }),
        } as never,
        props: { isRoot: true },
      });
    }

    for (const childTemplate of childTemplates) {
      const child: Monitor | undefined = byTemplate.get(childTemplate);

      if (!child) {
        continue;
      }

      await MonitorService.updateOneById({
        id: new ObjectID(idOf(child)),
        data: {
          dependsOnMonitors: [
            ...(child.dependsOnMonitors || []).map(
              (parent: Monitor): Monitor => {
                return OpenStackMonitorDependencies.reference(parent);
              },
            ),
            OpenStackMonitorDependencies.reference(created),
          ],
        } as never,
        props: { isRoot: true },
      });
    }
  }

  private static reference(monitor: Monitor): Monitor {
    const reference: Monitor = new Monitor();
    reference.id = new ObjectID(idOf(monitor));
    return reference;
  }
}
