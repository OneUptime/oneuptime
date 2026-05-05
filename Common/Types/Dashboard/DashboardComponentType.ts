enum DashboardComponentType {
  Chart = `Chart`,
  Value = `Value`,
  Text = `Text`,
  Table = `Table`,
  Gauge = `Gauge`,
  LogStream = `LogStream`,
  TraceList = `TraceList`,
  IncidentList = `IncidentList`,
  AlertList = `AlertList`,
  MonitorList = `MonitorList`,
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
}

export default DashboardComponentType;
