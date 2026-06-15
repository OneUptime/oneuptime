import ComponentProps from "../Pages/PageComponentProps";
import DockerSwarmLayout from "../Pages/DockerSwarm/Layout";
import DockerSwarmClusterViewLayout from "../Pages/DockerSwarm/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, DockerSwarmRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import DockerSwarmClusters from "../Pages/DockerSwarm/Clusters";
import DockerSwarmDocumentation from "../Pages/DockerSwarm/Documentation";
import DockerSwarmSettingsOwnerRules from "../Pages/DockerSwarm/Settings/OwnerRules";
import DockerSwarmSettingsLabelRules from "../Pages/DockerSwarm/Settings/LabelRules";
import DockerSwarmClusterOverview from "../Pages/DockerSwarm/View/Index";
import DockerSwarmClusterNodes from "../Pages/DockerSwarm/View/Nodes";
import DockerSwarmClusterNodeDetail from "../Pages/DockerSwarm/View/NodeDetail";
import DockerSwarmClusterServices from "../Pages/DockerSwarm/View/Services";
import DockerSwarmClusterServiceDetail from "../Pages/DockerSwarm/View/ServiceDetail";
import DockerSwarmClusterTasks from "../Pages/DockerSwarm/View/Tasks";
import DockerSwarmClusterTaskDetail from "../Pages/DockerSwarm/View/TaskDetail";
import DockerSwarmClusterStacks from "../Pages/DockerSwarm/View/Stacks";
import DockerSwarmClusterNetworks from "../Pages/DockerSwarm/View/Networks";
import DockerSwarmClusterSecrets from "../Pages/DockerSwarm/View/Secrets";
import DockerSwarmClusterConfigs from "../Pages/DockerSwarm/View/Configs";
import DockerSwarmClusterVolumes from "../Pages/DockerSwarm/View/Volumes";
import DockerSwarmClusterInsights from "../Pages/DockerSwarm/View/Insights";
import DockerSwarmClusterMetrics from "../Pages/DockerSwarm/View/Metrics";
import DockerSwarmClusterLogs from "../Pages/DockerSwarm/View/Logs";
import DockerSwarmClusterIncidents from "../Pages/DockerSwarm/View/Incidents";
import DockerSwarmClusterAlerts from "../Pages/DockerSwarm/View/Alerts";
import DockerSwarmClusterScheduledMaintenance from "../Pages/DockerSwarm/View/ScheduledMaintenance";
import DockerSwarmClusterOwners from "../Pages/DockerSwarm/View/Owners";
import DockerSwarmClusterAuditLogs from "../Pages/DockerSwarm/View/AuditLogs";
import DockerSwarmClusterSettings from "../Pages/DockerSwarm/View/Settings";
import DockerSwarmClusterDelete from "../Pages/DockerSwarm/View/Delete";
import DockerSwarmClusterDocumentation from "../Pages/DockerSwarm/View/Documentation";

const DockerSwarmRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<DockerSwarmLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <DockerSwarmClusters
              {...props}
              pageRoute={RouteMap[PageMap.DOCKER_SWARM_CLUSTERS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.DOCKER_SWARM_DOCUMENTATION)}
          element={
            <DockerSwarmDocumentation
              {...props}
              pageRoute={RouteMap[PageMap.DOCKER_SWARM_DOCUMENTATION] as Route}
            />
          }
        />
        <PageRoute
          path={
            DockerSwarmRoutePath[PageMap.DOCKER_SWARM_SETTINGS_OWNER_RULES] ||
            ""
          }
          element={
            <DockerSwarmSettingsOwnerRules
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_SETTINGS_OWNER_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            DockerSwarmRoutePath[PageMap.DOCKER_SWARM_SETTINGS_LABEL_RULES] ||
            ""
          }
          element={
            <DockerSwarmSettingsLabelRules
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_SETTINGS_LABEL_RULES] as Route
              }
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={DockerSwarmRoutePath[PageMap.DOCKER_SWARM_CLUSTER_VIEW] || ""}
        element={<DockerSwarmClusterViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <DockerSwarmClusterOverview
              {...props}
              pageRoute={RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW] as Route}
            />
          }
        />

        {/* Nodes */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODES,
          )}
          element={
            <DockerSwarmClusterNodes
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODES] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODE_DETAIL,
            2,
          )}
          element={
            <DockerSwarmClusterNodeDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODE_DETAIL] as Route
              }
            />
          }
        />

        {/* Services */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICES,
          )}
          element={
            <DockerSwarmClusterServices
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICES] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICE_DETAIL,
            2,
          )}
          element={
            <DockerSwarmClusterServiceDetail
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICE_DETAIL
                ] as Route
              }
            />
          }
        />

        {/* Tasks */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_TASKS,
          )}
          element={
            <DockerSwarmClusterTasks
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_TASKS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_TASK_DETAIL,
            2,
          )}
          element={
            <DockerSwarmClusterTaskDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_TASK_DETAIL] as Route
              }
            />
          }
        />

        {/* Stacks */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_STACKS,
          )}
          element={
            <DockerSwarmClusterStacks
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_STACKS] as Route
              }
            />
          }
        />

        {/* Networks */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_NETWORKS,
          )}
          element={
            <DockerSwarmClusterNetworks
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_NETWORKS] as Route
              }
            />
          }
        />

        {/* Secrets */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_SECRETS,
          )}
          element={
            <DockerSwarmClusterSecrets
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_SECRETS] as Route
              }
            />
          }
        />

        {/* Configs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_CONFIGS,
          )}
          element={
            <DockerSwarmClusterConfigs
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_CONFIGS] as Route
              }
            />
          }
        />

        {/* Volumes */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_VOLUMES,
          )}
          element={
            <DockerSwarmClusterVolumes
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_VOLUMES] as Route
              }
            />
          }
        />

        {/* Insights */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_INSIGHTS,
          )}
          element={
            <DockerSwarmClusterInsights
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_INSIGHTS] as Route
              }
            />
          }
        />

        {/* Metrics */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_METRICS,
          )}
          element={
            <DockerSwarmClusterMetrics
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_METRICS] as Route
              }
            />
          }
        />

        {/* Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_LOGS,
          )}
          element={
            <DockerSwarmClusterLogs
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_LOGS] as Route
              }
            />
          }
        />

        {/* Incidents */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_INCIDENTS,
          )}
          element={
            <DockerSwarmClusterIncidents
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_INCIDENTS] as Route
              }
            />
          }
        />

        {/* Alerts */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_ALERTS,
          )}
          element={
            <DockerSwarmClusterAlerts
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_ALERTS] as Route
              }
            />
          }
        />

        {/* Scheduled Maintenance */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_SCHEDULED_MAINTENANCE,
          )}
          element={
            <DockerSwarmClusterScheduledMaintenance
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.DOCKER_SWARM_CLUSTER_VIEW_SCHEDULED_MAINTENANCE
                ] as Route
              }
            />
          }
        />

        {/* Owners */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_OWNERS,
          )}
          element={
            <DockerSwarmClusterOwners
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_OWNERS] as Route
              }
            />
          }
        />

        {/* Audit Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_AUDIT_LOGS,
          )}
          element={
            <DockerSwarmClusterAuditLogs
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_AUDIT_LOGS] as Route
              }
            />
          }
        />

        {/* Settings */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_SETTINGS,
          )}
          element={
            <DockerSwarmClusterSettings
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_SETTINGS] as Route
              }
            />
          }
        />

        {/* Delete */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_DELETE,
          )}
          element={
            <DockerSwarmClusterDelete
              {...props}
              pageRoute={
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_DELETE] as Route
              }
            />
          }
        />

        {/* Documentation */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_DOCUMENTATION,
          )}
          element={
            <DockerSwarmClusterDocumentation
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.DOCKER_SWARM_CLUSTER_VIEW_DOCUMENTATION
                ] as Route
              }
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default DockerSwarmRoutes;
