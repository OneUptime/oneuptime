import Permission from "Common/Types/Permission";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * EACH PRODUCT LEVEL'S NAME, AS A KEY OF ITS OWN (#10289).
 *
 * A level is named as Common/Types/Permission titles it ("Cloud Admin",
 * "Network Viewer"), a catalog the extractor does not read (ROLE_NAMES in
 * RoleCardSelectOptions says why). Its name is drawn where a role's is: the
 * team and API key permission tables, the Add Permission picker, and the
 * "You need one of these permissions" sentences, which name a level as
 * they name a role (Common/UI/Utils/PermissionGate). So the names are
 * written out here one by one for the extractor, and each language words
 * a level as it words its area's role: "Cloud-Administrator",
 * "Administrador de la nube". A test holds this list to Permission's
 * levels, name for name (ProductLevelNamesInLocales).
 */
export const PRODUCT_LEVEL_NAMES: Partial<Record<Permission, string>> = {
  [Permission.SloAdmin]: translationKey("SLO Admin"),
  [Permission.SloMember]: translationKey("SLO Member"),
  [Permission.SloViewer]: translationKey("SLO Viewer"),
  [Permission.LlmObservabilityAdmin]: translationKey("LLM Observability Admin"),
  [Permission.LlmObservabilityViewer]: translationKey(
    "LLM Observability Viewer",
  ),
  [Permission.DataObservabilityAdmin]: translationKey(
    "Data Observability Admin",
  ),
  [Permission.DataObservabilityMember]: translationKey(
    "Data Observability Member",
  ),
  [Permission.DataObservabilityViewer]: translationKey(
    "Data Observability Viewer",
  ),
  [Permission.CodeAdmin]: translationKey("Code Admin"),
  [Permission.CodeMember]: translationKey("Code Member"),
  [Permission.CodeViewer]: translationKey("Code Viewer"),
  [Permission.InventoryAdmin]: translationKey("Inventory Admin"),
  [Permission.InventoryViewer]: translationKey("Inventory Viewer"),
  [Permission.ServiceAdmin]: translationKey("Service Admin"),
  [Permission.ServiceMember]: translationKey("Service Member"),
  [Permission.ServiceViewer]: translationKey("Service Viewer"),
  [Permission.DatabaseAdmin]: translationKey("Database Admin"),
  [Permission.DatabaseMember]: translationKey("Database Member"),
  [Permission.DatabaseViewer]: translationKey("Database Viewer"),
  [Permission.QueueAdmin]: translationKey("Queue Admin"),
  [Permission.QueueMember]: translationKey("Queue Member"),
  [Permission.QueueViewer]: translationKey("Queue Viewer"),
  [Permission.RumAdmin]: translationKey("RUM Admin"),
  [Permission.RumMember]: translationKey("RUM Member"),
  [Permission.RumViewer]: translationKey("RUM Viewer"),
  [Permission.HostAdmin]: translationKey("Host Admin"),
  [Permission.HostMember]: translationKey("Host Member"),
  [Permission.HostViewer]: translationKey("Host Viewer"),
  [Permission.KubernetesAdmin]: translationKey("Kubernetes Admin"),
  [Permission.KubernetesMember]: translationKey("Kubernetes Member"),
  [Permission.KubernetesViewer]: translationKey("Kubernetes Viewer"),
  [Permission.DockerAdmin]: translationKey("Docker Admin"),
  [Permission.DockerMember]: translationKey("Docker Member"),
  [Permission.DockerViewer]: translationKey("Docker Viewer"),
  [Permission.DockerSwarmAdmin]: translationKey("Docker Swarm Admin"),
  [Permission.DockerSwarmMember]: translationKey("Docker Swarm Member"),
  [Permission.DockerSwarmViewer]: translationKey("Docker Swarm Viewer"),
  [Permission.PodmanAdmin]: translationKey("Podman Admin"),
  [Permission.PodmanMember]: translationKey("Podman Member"),
  [Permission.PodmanViewer]: translationKey("Podman Viewer"),
  [Permission.ProxmoxAdmin]: translationKey("Proxmox Admin"),
  [Permission.ProxmoxMember]: translationKey("Proxmox Member"),
  [Permission.ProxmoxViewer]: translationKey("Proxmox Viewer"),
  [Permission.OpenStackAdmin]: translationKey("OpenStack Admin"),
  [Permission.OpenStackMember]: translationKey("OpenStack Member"),
  [Permission.OpenStackViewer]: translationKey("OpenStack Viewer"),
  [Permission.VMwareAdmin]: translationKey("VMware Admin"),
  [Permission.VMwareMember]: translationKey("VMware Member"),
  [Permission.VMwareViewer]: translationKey("VMware Viewer"),
  [Permission.CephAdmin]: translationKey("Ceph Admin"),
  [Permission.CephMember]: translationKey("Ceph Member"),
  [Permission.CephViewer]: translationKey("Ceph Viewer"),
  [Permission.StorageArrayAdmin]: translationKey("Storage Array Admin"),
  [Permission.StorageArrayMember]: translationKey("Storage Array Member"),
  [Permission.StorageArrayViewer]: translationKey("Storage Array Viewer"),
  [Permission.NetworkAdmin]: translationKey("Network Admin"),
  [Permission.NetworkMember]: translationKey("Network Member"),
  [Permission.NetworkViewer]: translationKey("Network Viewer"),
  [Permission.IoTAdmin]: translationKey("IoT Admin"),
  [Permission.IoTMember]: translationKey("IoT Member"),
  [Permission.IoTViewer]: translationKey("IoT Viewer"),
  [Permission.CloudAdmin]: translationKey("Cloud Admin"),
  [Permission.CloudMember]: translationKey("Cloud Member"),
  [Permission.CloudViewer]: translationKey("Cloud Viewer"),
  [Permission.AppPlatformAdmin]: translationKey("App Platform Admin"),
  [Permission.AppPlatformMember]: translationKey("App Platform Member"),
  [Permission.AppPlatformViewer]: translationKey("App Platform Viewer"),
  [Permission.ServerlessAdmin]: translationKey("Serverless Admin"),
  [Permission.ServerlessMember]: translationKey("Serverless Member"),
  [Permission.ServerlessViewer]: translationKey("Serverless Viewer"),
  [Permission.DashboardAdmin]: translationKey("Dashboard Admin"),
  [Permission.DashboardMember]: translationKey("Dashboard Member"),
  [Permission.DashboardViewer]: translationKey("Dashboard Viewer"),
  [Permission.FormAdmin]: translationKey("Form Admin"),
  [Permission.FormViewer]: translationKey("Form Viewer"),
};
