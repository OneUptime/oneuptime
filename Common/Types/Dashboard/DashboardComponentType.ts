enum DashboardComponentType {
  Chart = `Chart`,
  Value = `Value`,
  Text = `Text`,
  Clock = `Clock`,
  Table = `Table`,
  Gauge = `Gauge`,
  /*
   * Widgets that read an EXTERNAL Data Source (Prometheus, SQL, ClickHouse,
   * Loki, Elasticsearch, REST) rather than OneUptime's own telemetry. They
   * are separate component types — not a mode of the metric widgets above —
   * so each one can carry the query editor, defaults, and rendering its own
   * source of data actually needs. Not available on public dashboards.
   */
  DataSourceChart = `DataSourceChart`,
  DataSourceValue = `DataSourceValue`,
  DataSourceGauge = `DataSourceGauge`,
  DataSourceTable = `DataSourceTable`,
  LogStream = `LogStream`,
  LogChart = `LogChart`,
  SecurityEventsList = `SecurityEventsList`,
  SecurityEventsFlow = `SecurityEventsFlow`,
  TraceList = `TraceList`,
  TraceChart = `TraceChart`,
  TraceTable = `TraceTable`,
  IncidentList = `IncidentList`,
  AlertList = `AlertList`,
  MonitorList = `MonitorList`,
  Slo = `Slo`,
  KubernetesPodList = `KubernetesPodList`,
  KubernetesNodeList = `KubernetesNodeList`,
  KubernetesNamespaceList = `KubernetesNamespaceList`,
  KubernetesDeploymentList = `KubernetesDeploymentList`,
  KubernetesStatefulSetList = `KubernetesStatefulSetList`,
  KubernetesDaemonSetList = `KubernetesDaemonSetList`,
  KubernetesJobList = `KubernetesJobList`,
  KubernetesCronJobList = `KubernetesCronJobList`,
  DockerHostList = `DockerHostList`,
  DockerContainerList = `DockerContainerList`,
  DockerImageList = `DockerImageList`,
  DockerNetworkList = `DockerNetworkList`,
  DockerVolumeList = `DockerVolumeList`,
  PodmanHostList = `PodmanHostList`,
  PodmanContainerList = `PodmanContainerList`,
  PodmanImageList = `PodmanImageList`,
  PodmanNetworkList = `PodmanNetworkList`,
  PodmanVolumeList = `PodmanVolumeList`,
  HostList = `HostList`,
  ProxmoxNodeList = `ProxmoxNodeList`,
  ProxmoxGuestList = `ProxmoxGuestList`,
  DockerSwarmNodeList = `DockerSwarmNodeList`,
  DockerSwarmServiceList = `DockerSwarmServiceList`,
  CephOsdList = `CephOsdList`,
  CephPoolList = `CephPoolList`,
  NetworkMap = `NetworkMap`,
  Html = `Html`,
}

export default DashboardComponentType;

/*
 * Every widget type that reads an EXTERNAL Data Source. Kept next to the
 * enum so adding a fifth one is a single edit, and consumed by the widget
 * settings form (which query editor to render) and by anything that has to
 * treat external-data widgets as a class — notably the public dashboard,
 * where they are unavailable.
 */
export const DataSourceComponentTypes: ReadonlyArray<DashboardComponentType> = [
  DashboardComponentType.DataSourceChart,
  DashboardComponentType.DataSourceValue,
  DashboardComponentType.DataSourceGauge,
  DashboardComponentType.DataSourceTable,
];

export function isDataSourceComponentType(
  componentType: DashboardComponentType,
): boolean {
  return DataSourceComponentTypes.includes(componentType);
}
