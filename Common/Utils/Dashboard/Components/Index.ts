import { ComponentArgument } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import BadDataException from "../../../Types/Exception/BadDataException";
import DashboardAlertListComponentUtil from "./DashboardAlertListComponent";
import DashboardCephOsdListComponentUtil from "./DashboardCephOsdListComponent";
import DashboardCephPoolListComponentUtil from "./DashboardCephPoolListComponent";
import DashboardChartComponentUtil from "./DashboardChartComponent";
import DashboardDockerContainerListComponentUtil from "./DashboardDockerContainerListComponent";
import DashboardDockerHostListComponentUtil from "./DashboardDockerHostListComponent";
import DashboardDockerImageListComponentUtil from "./DashboardDockerImageListComponent";
import DashboardDockerNetworkListComponentUtil from "./DashboardDockerNetworkListComponent";
import DashboardDockerVolumeListComponentUtil from "./DashboardDockerVolumeListComponent";
import DashboardGaugeComponentUtil from "./DashboardGaugeComponent";
import DashboardHostListComponentUtil from "./DashboardHostListComponent";
import DashboardIncidentListComponentUtil from "./DashboardIncidentListComponent";
import DashboardKubernetesCronJobListComponentUtil from "./DashboardKubernetesCronJobListComponent";
import DashboardKubernetesDaemonSetListComponentUtil from "./DashboardKubernetesDaemonSetListComponent";
import DashboardKubernetesDeploymentListComponentUtil from "./DashboardKubernetesDeploymentListComponent";
import DashboardKubernetesJobListComponentUtil from "./DashboardKubernetesJobListComponent";
import DashboardKubernetesNamespaceListComponentUtil from "./DashboardKubernetesNamespaceListComponent";
import DashboardKubernetesNodeListComponentUtil from "./DashboardKubernetesNodeListComponent";
import DashboardKubernetesPodListComponentUtil from "./DashboardKubernetesPodListComponent";
import DashboardKubernetesStatefulSetListComponentUtil from "./DashboardKubernetesStatefulSetListComponent";
import DashboardLogStreamComponentUtil from "./DashboardLogStreamComponent";
import DashboardMonitorListComponentUtil from "./DashboardMonitorListComponent";
import DashboardPodmanContainerListComponentUtil from "./DashboardPodmanContainerListComponent";
import DashboardPodmanHostListComponentUtil from "./DashboardPodmanHostListComponent";
import DashboardPodmanImageListComponentUtil from "./DashboardPodmanImageListComponent";
import DashboardPodmanNetworkListComponentUtil from "./DashboardPodmanNetworkListComponent";
import DashboardPodmanVolumeListComponentUtil from "./DashboardPodmanVolumeListComponent";
import DashboardProxmoxGuestListComponentUtil from "./DashboardProxmoxGuestListComponent";
import DashboardProxmoxNodeListComponentUtil from "./DashboardProxmoxNodeListComponent";
import DashboardTableComponentUtil from "./DashboardTableComponent";
import DashboardTextComponentUtil from "./DashboardTextComponent";
import DashboardTraceChartComponentUtil from "./DashboardTraceChartComponent";
import DashboardTraceListComponentUtil from "./DashboardTraceListComponent";
import DashboardValueComponentUtil from "./DashboardValueComponent";

export default class DashboardComponentsUtil {
  public static getComponentSettingsArguments(
    dashboardComponentType: DashboardComponentType,
  ): Array<ComponentArgument<DashboardBaseComponent>> {
    if (dashboardComponentType === DashboardComponentType.Chart) {
      return DashboardChartComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.Text) {
      return DashboardTextComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.Value) {
      return DashboardValueComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.Table) {
      return DashboardTableComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.Gauge) {
      return DashboardGaugeComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.LogStream) {
      return DashboardLogStreamComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.TraceList) {
      return DashboardTraceListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.TraceChart) {
      return DashboardTraceChartComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.IncidentList) {
      return DashboardIncidentListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.AlertList) {
      return DashboardAlertListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.MonitorList) {
      return DashboardMonitorListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.KubernetesPodList) {
      return DashboardKubernetesPodListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.KubernetesNodeList) {
      return DashboardKubernetesNodeListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (
      dashboardComponentType === DashboardComponentType.KubernetesNamespaceList
    ) {
      return DashboardKubernetesNamespaceListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (
      dashboardComponentType === DashboardComponentType.KubernetesDeploymentList
    ) {
      return DashboardKubernetesDeploymentListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (
      dashboardComponentType ===
      DashboardComponentType.KubernetesStatefulSetList
    ) {
      return DashboardKubernetesStatefulSetListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (
      dashboardComponentType === DashboardComponentType.KubernetesDaemonSetList
    ) {
      return DashboardKubernetesDaemonSetListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.KubernetesJobList) {
      return DashboardKubernetesJobListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (
      dashboardComponentType === DashboardComponentType.KubernetesCronJobList
    ) {
      return DashboardKubernetesCronJobListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.DockerHostList) {
      return DashboardDockerHostListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.DockerContainerList) {
      return DashboardDockerContainerListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.DockerImageList) {
      return DashboardDockerImageListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.DockerNetworkList) {
      return DashboardDockerNetworkListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.DockerVolumeList) {
      return DashboardDockerVolumeListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.PodmanHostList) {
      return DashboardPodmanHostListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.PodmanContainerList) {
      return DashboardPodmanContainerListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.PodmanImageList) {
      return DashboardPodmanImageListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.PodmanNetworkList) {
      return DashboardPodmanNetworkListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.PodmanVolumeList) {
      return DashboardPodmanVolumeListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.HostList) {
      return DashboardHostListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.ProxmoxNodeList) {
      return DashboardProxmoxNodeListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.ProxmoxGuestList) {
      return DashboardProxmoxGuestListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.CephOsdList) {
      return DashboardCephOsdListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.CephPoolList) {
      return DashboardCephPoolListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    throw new BadDataException(
      `Unknown dashboard component type: ${dashboardComponentType}`,
    );
  }
}
