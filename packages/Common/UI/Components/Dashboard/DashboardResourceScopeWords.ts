import { DashboardResourceScope } from "../../../Types/Dashboard/DashboardResourceScope";
import { Translator } from "../../../Types/Translator";

/*
 * The words a dashboard says a variable's kind of resource with
 * (DashboardResourceScope, issue #11258), in the reader's language: what
 * its "All" means in the toolbar - "All hosts", never a bare "All" that
 * reads as the whole project - the kind's name in the Variables dialog, and
 * what a board of a kind the project has none of says. Each is a whole
 * phrase of its own, never a kind glued into a sentence, so it reads right
 * in every language. Shared by the signed-in and public toolbars.
 */

// The toolbar's "All", for a variable that picks among the kind.
export function getDashboardResourceScopeAllLabel(
  translator: Translator,
  scope: DashboardResourceScope | undefined,
): string {
  switch (scope) {
    case DashboardResourceScope.Host:
      return translator.translateText("All hosts") || "All hosts";
    case DashboardResourceScope.OpenStackCloud:
      return translator.translateText("All clouds") || "All clouds";
    case DashboardResourceScope.VMwareVCenter:
      return translator.translateText("All vCenters") || "All vCenters";
    case DashboardResourceScope.XcpNgPool:
      return translator.translateText("All pools") || "All pools";
    case DashboardResourceScope.StorageArray:
      return translator.translateText("All arrays") || "All arrays";
    case DashboardResourceScope.KubernetesCluster:
    case DashboardResourceScope.DockerSwarmCluster:
    case DashboardResourceScope.ProxmoxCluster:
    case DashboardResourceScope.CephCluster:
      return translator.translateText("All clusters") || "All clusters";
    default:
      return translator.translateText("All") || "All";
  }
}

// The kind's name, as the Variables dialog offers it.
export function getDashboardResourceScopeName(
  translator: Translator,
  scope: DashboardResourceScope,
): string {
  switch (scope) {
    case DashboardResourceScope.KubernetesCluster:
      return (
        translator.translateText("Kubernetes clusters") || "Kubernetes clusters"
      );
    case DashboardResourceScope.Host:
      return translator.translateText("Hosts") || "Hosts";
    case DashboardResourceScope.DockerSwarmCluster:
      return (
        translator.translateText("Docker Swarm clusters") ||
        "Docker Swarm clusters"
      );
    case DashboardResourceScope.ProxmoxCluster:
      return (
        translator.translateText("Proxmox clusters") || "Proxmox clusters"
      );
    case DashboardResourceScope.OpenStackCloud:
      return (
        translator.translateText("OpenStack clouds") || "OpenStack clouds"
      );
    case DashboardResourceScope.VMwareVCenter:
      return translator.translateText("VMware vCenters") || "VMware vCenters";
    case DashboardResourceScope.XcpNgPool:
      return translator.translateText("XCP-ng pools") || "XCP-ng pools";
    case DashboardResourceScope.CephCluster:
      return translator.translateText("Ceph clusters") || "Ceph clusters";
    case DashboardResourceScope.StorageArray:
      return translator.translateText("Storage arrays") || "Storage arrays";
  }
}

// What a board of the kind says while the project has none of it.
export function getDashboardResourceScopeNoneTitle(
  translator: Translator,
  scope: DashboardResourceScope,
): string {
  switch (scope) {
    case DashboardResourceScope.KubernetesCluster:
      return (
        translator.translateText("No Kubernetes clusters yet") ||
        "No Kubernetes clusters yet"
      );
    case DashboardResourceScope.Host:
      return translator.translateText("No hosts yet") || "No hosts yet";
    case DashboardResourceScope.DockerSwarmCluster:
      return (
        translator.translateText("No Docker Swarm clusters yet") ||
        "No Docker Swarm clusters yet"
      );
    case DashboardResourceScope.ProxmoxCluster:
      return (
        translator.translateText("No Proxmox clusters yet") ||
        "No Proxmox clusters yet"
      );
    case DashboardResourceScope.OpenStackCloud:
      return (
        translator.translateText("No OpenStack clouds yet") ||
        "No OpenStack clouds yet"
      );
    case DashboardResourceScope.VMwareVCenter:
      return (
        translator.translateText("No vCenters yet") || "No vCenters yet"
      );
    case DashboardResourceScope.XcpNgPool:
      return (
        translator.translateText("No XCP-ng pools yet") ||
        "No XCP-ng pools yet"
      );
    case DashboardResourceScope.CephCluster:
      return (
        translator.translateText("No Ceph clusters yet") ||
        "No Ceph clusters yet"
      );
    case DashboardResourceScope.StorageArray:
      return (
        translator.translateText("No storage arrays yet") ||
        "No storage arrays yet"
      );
  }
}

// The button that opens the product the kind is set up in.
export function getDashboardResourceScopeSetUpLabel(
  translator: Translator,
  scope: DashboardResourceScope,
): string {
  switch (scope) {
    case DashboardResourceScope.KubernetesCluster:
      return (
        translator.translateText("Set Up Kubernetes") || "Set Up Kubernetes"
      );
    case DashboardResourceScope.Host:
      return translator.translateText("Add Host") || "Add Host";
    case DashboardResourceScope.DockerSwarmCluster:
      return (
        translator.translateText("Set Up Docker Swarm") ||
        "Set Up Docker Swarm"
      );
    case DashboardResourceScope.ProxmoxCluster:
      return translator.translateText("Set Up Proxmox") || "Set Up Proxmox";
    case DashboardResourceScope.OpenStackCloud:
      return (
        translator.translateText("Set Up OpenStack") || "Set Up OpenStack"
      );
    case DashboardResourceScope.VMwareVCenter:
      return translator.translateText("Set Up VMware") || "Set Up VMware";
    case DashboardResourceScope.XcpNgPool:
      return translator.translateText("Set Up XCP-ng") || "Set Up XCP-ng";
    case DashboardResourceScope.CephCluster:
      return translator.translateText("Set Up Ceph") || "Set Up Ceph";
    case DashboardResourceScope.StorageArray:
      return (
        translator.translateText("Set Up Storage Arrays") ||
        "Set Up Storage Arrays"
      );
  }
}
