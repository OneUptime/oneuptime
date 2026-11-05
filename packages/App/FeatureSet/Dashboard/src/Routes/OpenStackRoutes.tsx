import ComponentProps from "../Pages/PageComponentProps";
import OpenStackLayout from "../Pages/OpenStack/Layout";
import OpenStackCloudViewLayout from "../Pages/OpenStack/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, OpenStackRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import OpenStackClouds from "../Pages/OpenStack/Clouds";
import OpenStackDocumentation from "../Pages/OpenStack/Documentation";
import OpenStackSettingsOwnerRules from "../Pages/OpenStack/Settings/OwnerRules";
import OpenStackSettingsLabelRules from "../Pages/OpenStack/Settings/LabelRules";
import OpenStackArchived from "../Pages/OpenStack/Archived";
import OpenStackCloudOverview from "../Pages/OpenStack/View/Index";
import OpenStackCloudServices from "../Pages/OpenStack/View/Services";
import OpenStackCloudServiceDetail from "../Pages/OpenStack/View/ServiceDetail";
import OpenStackCloudHypervisors from "../Pages/OpenStack/View/Hypervisors";
import OpenStackCloudInstances from "../Pages/OpenStack/View/Instances";
import OpenStackCloudFlavors from "../Pages/OpenStack/View/Flavors";
import OpenStackCloudNetworks from "../Pages/OpenStack/View/Networks";
import OpenStackCloudRouters from "../Pages/OpenStack/View/Routers";
import OpenStackCloudFloatingIps from "../Pages/OpenStack/View/FloatingIps";
import OpenStackCloudBareMetalNodes from "../Pages/OpenStack/View/BareMetalNodes";
import OpenStackCloudBareMetalNodeDetail from "../Pages/OpenStack/View/BareMetalNodeDetail";
import OpenStackCloudVolumes from "../Pages/OpenStack/View/Volumes";
import OpenStackCloudStoragePools from "../Pages/OpenStack/View/StoragePools";
import OpenStackCloudImages from "../Pages/OpenStack/View/Images";
import OpenStackCloudHypervisorDetail from "../Pages/OpenStack/View/HypervisorDetail";
import OpenStackCloudInstanceDetail from "../Pages/OpenStack/View/InstanceDetail";
import OpenStackCloudFlavorDetail from "../Pages/OpenStack/View/FlavorDetail";
import OpenStackCloudAvailabilityZones from "../Pages/OpenStack/View/AvailabilityZones";
import OpenStackCloudAvailabilityZoneDetail from "../Pages/OpenStack/View/AvailabilityZoneDetail";
import OpenStackCloudAggregates from "../Pages/OpenStack/View/Aggregates";
import OpenStackCloudAggregateDetail from "../Pages/OpenStack/View/AggregateDetail";
import OpenStackCloudNetworkDetail from "../Pages/OpenStack/View/NetworkDetail";
import OpenStackCloudSubnets from "../Pages/OpenStack/View/Subnets";
import OpenStackCloudSubnetDetail from "../Pages/OpenStack/View/SubnetDetail";
import OpenStackCloudRouterDetail from "../Pages/OpenStack/View/RouterDetail";
import OpenStackCloudFloatingIpDetail from "../Pages/OpenStack/View/FloatingIpDetail";
import OpenStackCloudNetworkAgents from "../Pages/OpenStack/View/NetworkAgents";
import OpenStackCloudNetworkAgentDetail from "../Pages/OpenStack/View/NetworkAgentDetail";
import OpenStackCloudVolumeDetail from "../Pages/OpenStack/View/VolumeDetail";
import OpenStackCloudStoragePoolDetail from "../Pages/OpenStack/View/StoragePoolDetail";
import OpenStackCloudSnapshots from "../Pages/OpenStack/View/Snapshots";
import OpenStackCloudImageDetail from "../Pages/OpenStack/View/ImageDetail";
import OpenStackCloudStacks from "../Pages/OpenStack/View/Stacks";
import OpenStackCloudStackDetail from "../Pages/OpenStack/View/StackDetail";
import OpenStackCloudContainerClusters from "../Pages/OpenStack/View/ContainerClusters";
import OpenStackCloudContainerClusterDetail from "../Pages/OpenStack/View/ContainerClusterDetail";
import OpenStackCloudShares from "../Pages/OpenStack/View/Shares";
import OpenStackCloudShareDetail from "../Pages/OpenStack/View/ShareDetail";
import OpenStackCloudProjects from "../Pages/OpenStack/View/Projects";
import OpenStackCloudProjectDetail from "../Pages/OpenStack/View/ProjectDetail";
import OpenStackCloudDomains from "../Pages/OpenStack/View/Domains";
import OpenStackCloudControlPlane from "../Pages/OpenStack/View/ControlPlane";
import OpenStackCloudControlPlaneDependency from "../Pages/OpenStack/View/ControlPlaneDependency";
import OpenStackCloudTopology from "../Pages/OpenStack/View/Topology";
import OpenStackCloudMetrics from "../Pages/OpenStack/View/Metrics";
import OpenStackCloudRecommendations from "../Pages/OpenStack/View/Recommendations";
import OpenStackCloudCapacity from "../Pages/OpenStack/View/Capacity";
import OpenStackCloudSpend from "../Pages/OpenStack/View/Spend";
import OpenStackCloudLogs from "../Pages/OpenStack/View/Logs";
import OpenStackCloudTraces from "../Pages/OpenStack/View/Traces";
import OpenStackCloudChecks from "../Pages/OpenStack/View/Checks";
import OpenStackCloudIncidents from "../Pages/OpenStack/View/Incidents";
import OpenStackCloudAlerts from "../Pages/OpenStack/View/Alerts";
import OpenStackCloudScheduledMaintenance from "../Pages/OpenStack/View/ScheduledMaintenance";
import OpenStackCloudOwners from "../Pages/OpenStack/View/Owners";
import OpenStackCloudFeed from "../Pages/OpenStack/View/Feed";
import OpenStackCloudAiInsights from "../Pages/OpenStack/View/AI/Insights";
import OpenStackCloudAiLogs from "../Pages/OpenStack/View/AI/Logs";
import OpenStackCloudAiAgent from "../Pages/OpenStack/View/AI/Agent";
import OpenStackCloudAuditLogs from "../Pages/OpenStack/View/AuditLogs";
import OpenStackCloudSettings from "../Pages/OpenStack/View/Settings";
import OpenStackCloudDelete from "../Pages/OpenStack/View/Delete";
import OpenStackCloudDocumentation from "../Pages/OpenStack/View/Documentation";
import OpenStackCloudLabelRule from "Common/Models/DatabaseModels/OpenStackCloudLabelRule";
import OpenStackCloudOwnerRule from "Common/Models/DatabaseModels/OpenStackCloudOwnerRule";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import { getDeveloperDocsRoutes } from "../Components/DeveloperDocs/DeveloperDocsRoutes";
import { DeveloperDocsScope } from "../Components/DeveloperDocs/DeveloperDocsPages";

const OpenStackRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<OpenStackLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <OpenStackClouds
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUDS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.OPENSTACK_DOCUMENTATION)}
          element={
            <OpenStackDocumentation
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_DOCUMENTATION] as Route}
            />
          }
        />
        <PageRoute
          path={
            OpenStackRoutePath[PageMap.OPENSTACK_SETTINGS_OWNER_RULES] || ""
          }
          element={
            <OpenStackSettingsOwnerRules
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_SETTINGS_OWNER_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            OpenStackRoutePath[PageMap.OPENSTACK_SETTINGS_OWNER_RULE_VIEW] || ""
          }
          element={
            <OpenStackSettingsOwnerRules
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_SETTINGS_OWNER_RULE_VIEW] as Route
              }
              ruleViewModelType={OpenStackCloudOwnerRule}
            />
          }
        />
        <PageRoute
          path={
            OpenStackRoutePath[PageMap.OPENSTACK_SETTINGS_LABEL_RULES] || ""
          }
          element={
            <OpenStackSettingsLabelRules
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_SETTINGS_LABEL_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            OpenStackRoutePath[PageMap.OPENSTACK_SETTINGS_LABEL_RULE_VIEW] || ""
          }
          element={
            <OpenStackSettingsLabelRules
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_SETTINGS_LABEL_RULE_VIEW] as Route
              }
              ruleViewModelType={OpenStackCloudLabelRule}
            />
          }
        />
        <PageRoute
          path={OpenStackRoutePath[PageMap.OPENSTACK_ARCHIVED] || ""}
          element={
            <OpenStackArchived
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_ARCHIVED] as Route}
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: OpenStackCloud,
          scope: DeveloperDocsScope.List,
          props,
          mountPageKey: PageMap.OPENSTACK_ROOT,
        })}
      </PageRoute>

      <PageRoute
        path={OpenStackRoutePath[PageMap.OPENSTACK_CLOUD_VIEW] || ""}
        element={<OpenStackCloudViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <OpenStackCloudOverview
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_TOPOLOGY,
          )}
          element={
            <OpenStackCloudTopology
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_TOPOLOGY] as Route
              }
            />
          }
        />

        {/* Control Plane */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_SERVICES,
          )}
          element={
            <OpenStackCloudServices
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SERVICES] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_SERVICE_DETAIL,
            2,
          )}
          element={
            <OpenStackCloudServiceDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SERVICE_DETAIL] as Route
              }
            />
          }
        />

        {/* Compute */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_HYPERVISORS,
          )}
          element={
            <OpenStackCloudHypervisors
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_HYPERVISORS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_INSTANCES,
          )}
          element={
            <OpenStackCloudInstances
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_INSTANCES] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_FLAVORS,
          )}
          element={
            <OpenStackCloudFlavors
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_FLAVORS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_HYPERVISOR_DETAIL,
          )}
          element={
            <OpenStackCloudHypervisorDetail
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.OPENSTACK_CLOUD_VIEW_HYPERVISOR_DETAIL
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_INSTANCE_DETAIL,
          )}
          element={
            <OpenStackCloudInstanceDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_INSTANCE_DETAIL] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_FLAVOR_DETAIL,
          )}
          element={
            <OpenStackCloudFlavorDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_FLAVOR_DETAIL] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_AVAILABILITY_ZONES,
          )}
          element={
            <OpenStackCloudAvailabilityZones
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.OPENSTACK_CLOUD_VIEW_AVAILABILITY_ZONES
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_AVAILABILITY_ZONE_DETAIL,
          )}
          element={
            <OpenStackCloudAvailabilityZoneDetail
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.OPENSTACK_CLOUD_VIEW_AVAILABILITY_ZONE_DETAIL
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_AGGREGATES,
          )}
          element={
            <OpenStackCloudAggregates
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_AGGREGATES] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_AGGREGATE_DETAIL,
          )}
          element={
            <OpenStackCloudAggregateDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_AGGREGATE_DETAIL] as Route
              }
            />
          }
        />

        {/* Network */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_NETWORKS,
          )}
          element={
            <OpenStackCloudNetworks
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_NETWORKS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_ROUTERS,
          )}
          element={
            <OpenStackCloudRouters
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_ROUTERS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_BARE_METAL_NODES,
          )}
          element={
            <OpenStackCloudBareMetalNodes
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_BARE_METAL_NODES] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_BARE_METAL_NODE_DETAIL,
          )}
          element={
            <OpenStackCloudBareMetalNodeDetail
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.OPENSTACK_CLOUD_VIEW_BARE_METAL_NODE_DETAIL
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IPS,
          )}
          element={
            <OpenStackCloudFloatingIps
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IPS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_DETAIL,
          )}
          element={
            <OpenStackCloudNetworkDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_DETAIL] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_SUBNETS,
          )}
          element={
            <OpenStackCloudSubnets
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SUBNETS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_SUBNET_DETAIL,
          )}
          element={
            <OpenStackCloudSubnetDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SUBNET_DETAIL] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_ROUTER_DETAIL,
          )}
          element={
            <OpenStackCloudRouterDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_ROUTER_DETAIL] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IP_DETAIL,
          )}
          element={
            <OpenStackCloudFloatingIpDetail
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IP_DETAIL
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_AGENTS,
          )}
          element={
            <OpenStackCloudNetworkAgents
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_AGENTS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_AGENT_DETAIL,
          )}
          element={
            <OpenStackCloudNetworkAgentDetail
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_AGENT_DETAIL
                ] as Route
              }
            />
          }
        />

        {/* Storage */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_VOLUMES,
          )}
          element={
            <OpenStackCloudVolumes
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_VOLUMES] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_STORAGE_POOLS,
          )}
          element={
            <OpenStackCloudStoragePools
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_STORAGE_POOLS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_IMAGES,
          )}
          element={
            <OpenStackCloudImages
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_IMAGES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_VOLUME_DETAIL,
          )}
          element={
            <OpenStackCloudVolumeDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_VOLUME_DETAIL] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_STORAGE_POOL_DETAIL,
          )}
          element={
            <OpenStackCloudStoragePoolDetail
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.OPENSTACK_CLOUD_VIEW_STORAGE_POOL_DETAIL
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_SNAPSHOTS,
          )}
          element={
            <OpenStackCloudSnapshots
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SNAPSHOTS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_IMAGE_DETAIL,
          )}
          element={
            <OpenStackCloudImageDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_IMAGE_DETAIL] as Route
              }
            />
          }
        />

        {/* Orchestration: only a cloud that runs these links here. */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_STACKS,
          )}
          element={
            <OpenStackCloudStacks
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_STACKS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_STACK_DETAIL,
          )}
          element={
            <OpenStackCloudStackDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_STACK_DETAIL] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_CONTAINER_CLUSTERS,
          )}
          element={
            <OpenStackCloudContainerClusters
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.OPENSTACK_CLOUD_VIEW_CONTAINER_CLUSTERS
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_CONTAINER_CLUSTER_DETAIL,
          )}
          element={
            <OpenStackCloudContainerClusterDetail
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.OPENSTACK_CLOUD_VIEW_CONTAINER_CLUSTER_DETAIL
                ] as Route
              }
            />
          }
        />

        {/* Shares: only a cloud that runs Manila links here. */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_SHARES,
          )}
          element={
            <OpenStackCloudShares
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SHARES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_SHARE_DETAIL,
          )}
          element={
            <OpenStackCloudShareDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SHARE_DETAIL] as Route
              }
            />
          }
        />

        {/* Tenancy */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_PROJECTS,
          )}
          element={
            <OpenStackCloudProjects
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_PROJECTS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_PROJECT_DETAIL,
            2,
          )}
          element={
            <OpenStackCloudProjectDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_PROJECT_DETAIL] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_DOMAINS,
          )}
          element={
            <OpenStackCloudDomains
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_DOMAINS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_CONTROL_PLANE,
          )}
          element={
            <OpenStackCloudControlPlane
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_CONTROL_PLANE] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_CONTROL_PLANE_DEPENDENCY,
          )}
          element={
            <OpenStackCloudControlPlaneDependency
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.OPENSTACK_CLOUD_VIEW_CONTROL_PLANE_DEPENDENCY
                ] as Route
              }
            />
          }
        />

        {/* Telemetry */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_METRICS,
          )}
          element={
            <OpenStackCloudMetrics
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_METRICS] as Route
              }
            />
          }
        />

        {/* Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.OPENSTACK_CLOUD_VIEW_LOGS)}
          element={
            <OpenStackCloudLogs
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_LOGS] as Route}
            />
          }
        />

        {/* Traces */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_TRACES,
          )}
          element={
            <OpenStackCloudTraces
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_TRACES] as Route}
            />
          }
        />

        {/* Checks */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_CHECKS,
          )}
          element={
            <OpenStackCloudChecks
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_CHECKS] as Route}
            />
          }
        />

        {/* Incidents */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_INCIDENTS,
          )}
          element={
            <OpenStackCloudIncidents
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_INCIDENTS] as Route
              }
            />
          }
        />

        {/* Alerts */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_ALERTS,
          )}
          element={
            <OpenStackCloudAlerts
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_ALERTS] as Route}
            />
          }
        />

        {/* Scheduled Maintenance */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_SCHEDULED_MAINTENANCE,
          )}
          element={
            <OpenStackCloudScheduledMaintenance
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.OPENSTACK_CLOUD_VIEW_SCHEDULED_MAINTENANCE
                ] as Route
              }
            />
          }
        />

        {/* Owners */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_RECOMMENDATIONS,
          )}
          element={
            <OpenStackCloudRecommendations
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_RECOMMENDATIONS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_CAPACITY,
          )}
          element={
            <OpenStackCloudCapacity
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_CAPACITY] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.OPENSTACK_CLOUD_VIEW_SPEND)}
          element={
            <OpenStackCloudSpend
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SPEND] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_OWNERS,
          )}
          element={
            <OpenStackCloudOwners
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_OWNERS] as Route}
            />
          }
        />

        {/* AI */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_AI_INSIGHTS,
            2,
          )}
          element={
            <OpenStackCloudAiInsights
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_AI_INSIGHTS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_AI_LOGS,
            2,
          )}
          element={
            <OpenStackCloudAiLogs
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_AI_LOGS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_AI_AGENT,
            2,
          )}
          element={
            <OpenStackCloudAiAgent
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_AI_AGENT] as Route
              }
            />
          }
        />

        {/* Feed */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.OPENSTACK_CLOUD_VIEW_FEED)}
          element={
            <OpenStackCloudFeed
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_FEED] as Route}
            />
          }
        />

        {/* Audit Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_AUDIT_LOGS,
          )}
          element={
            <OpenStackCloudAuditLogs
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_AUDIT_LOGS] as Route
              }
            />
          }
        />

        {/* Settings */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_SETTINGS,
          )}
          element={
            <OpenStackCloudSettings
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SETTINGS] as Route
              }
            />
          }
        />

        {/* Delete */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_DELETE,
          )}
          element={
            <OpenStackCloudDelete
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_DELETE] as Route}
            />
          }
        />

        {/* Documentation */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_DOCUMENTATION,
          )}
          element={
            <OpenStackCloudDocumentation
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_DOCUMENTATION] as Route
              }
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: OpenStackCloud,
          scope: DeveloperDocsScope.View,
          props,
        })}
      </PageRoute>
    </Routes>
  );
};

export default OpenStackRoutes;
