import KubernetesEventAttribute, {
  KubernetesEventType,
} from "Common/Types/Kubernetes/KubernetesEvent";
import {
  KUBERNETES_CLUSTER_NAME_LOG_ATTRIBUTE,
  KUBERNETES_WARNING_EVENTS_TEMPLATE_ID,
} from "Common/Types/Monitor/KubernetesEventAlertTemplates";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  MonitorRecommendationResourceType,
  buildRecommendationId,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

/*
 * WHETHER A CLUSTER'S WARNING EVENTS RAISE ALERTS (the Events page's line).
 *
 * A cluster's Events page lists what Kubernetes warned about; its last line
 * says whether those warnings reach anyone. A Logs monitor that counts the
 * cluster's Warning events does - the Warning Events recommendation
 * (KubernetesEventAlertTemplates), or one somebody built from the docs'
 * recipe - and the line names it. Without one, the line offers to turn the
 * recommendation on: the cluster's Recommendations page, with it selected.
 *
 * Any grouping, window or extra filter counts: a monitor that watches only
 * OOMKilling still alerts on this cluster's warnings, and the line should
 * not offer a second one as if nothing did. A monitor that is not
 * monitoring (turned off) does not.
 *
 * Plain logic, free of React and of the API client, so App/Tests can read it.
 */

// The Warning Events recommendation, as Recommendations' ?select= names it.
export const KUBERNETES_WARNING_EVENTS_RECOMMENDATION_ID: string =
  buildRecommendationId(
    MonitorRecommendationResourceType.Kubernetes,
    KUBERNETES_WARNING_EVENTS_TEMPLATE_ID,
  );

// The slice of a monitor this reads (Monitor, as the list returns it).
export interface KubernetesWarningEventsMonitorLike {
  monitorType?: MonitorType | string | undefined;
  disableActiveMonitoring?: boolean | undefined;
  monitorSteps?:
    | {
        data?:
          | {
              monitorStepsInstanceArray?:
                | Array<{
                    data?:
                      | {
                          logMonitor?:
                            | { attributes?: Record<string, unknown> | undefined }
                            | undefined;
                        }
                      | undefined;
                  }>
                | undefined;
            }
          | undefined;
      }
    | undefined;
}

// Whether a Logs step's filter asks for this cluster's Warning events.
export function isKubernetesWarningEventsFilter(
  attributes: Record<string, unknown> | undefined,
  clusterIdentifier: string,
): boolean {
  if (!attributes || !clusterIdentifier) {
    return false;
  }

  return (
    attributes[KUBERNETES_CLUSTER_NAME_LOG_ATTRIBUTE] === clusterIdentifier &&
    attributes[KubernetesEventAttribute.Type] === KubernetesEventType.Warning
  );
}

// Whether this monitor alerts on the cluster's warning events.
export function isKubernetesWarningEventsMonitor(
  monitor: KubernetesWarningEventsMonitorLike,
  clusterIdentifier: string,
): boolean {
  if (monitor.monitorType !== MonitorType.Logs) {
    return false;
  }

  if (monitor.disableActiveMonitoring === true) {
    return false;
  }

  return (monitor.monitorSteps?.data?.monitorStepsInstanceArray || []).some(
    (step: {
      data?:
        | {
            logMonitor?:
              | { attributes?: Record<string, unknown> | undefined }
              | undefined;
          }
        | undefined;
    }): boolean => {
      return isKubernetesWarningEventsFilter(
        step.data?.logMonitor?.attributes,
        clusterIdentifier,
      );
    },
  );
}

// The monitors, of those read, that alert on the cluster's warning events.
export function findKubernetesWarningEventsMonitors<
  T extends KubernetesWarningEventsMonitorLike,
>(monitors: ReadonlyArray<T>, clusterIdentifier: string): Array<T> {
  return monitors.filter((monitor: T): boolean => {
    return isKubernetesWarningEventsMonitor(monitor, clusterIdentifier);
  });
}
