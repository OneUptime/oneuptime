import ProductKey from "./ProductKey";

/*
 * WHICH PRODUCT A RECORD BELONGS TO, FOR THE API'S REFUSAL (#6815).
 *
 * While a product is switched off on the server, the API refuses to create,
 * change or delete its records (BaseAPI, Utils/ServerProducts). A product's
 * records here are its main record - the one its first page lists and
 * counts (ProjectProductsService.PRODUCT_RECORD_MODELS, which a test holds
 * this to): a monitor, a status page, a workflow. Without one, nothing of
 * the product can be made: its other records hang off it.
 *
 * Reads are never refused. Products that are still on show records of
 * others - an incident names its monitors, a monitor's criteria can name an
 * on-call policy, a status page lists scheduled maintenance - and refusing
 * those reads would break the products that are on.
 *
 * By table name, so BaseAPI and the Dashboard (Search leaves out records
 * of a product that is off) can ask without loading every model. Pure.
 */
export const PRODUCT_OF_TABLE: Readonly<Record<string, ProductKey>> = {
  Monitor: ProductKey.Monitors,
  Incident: ProductKey.Incidents,
  Alert: ProductKey.Alerts,
  OnCallDutyPolicy: ProductKey.OnCall,
  StatusPage: ProductKey.StatusPages,
  ScheduledMaintenance: ProductKey.ScheduledMaintenance,
  ServiceLevelObjective: ProductKey.Slos,
  AIInsight: ProductKey.AIInsights,
  CodeRepository: ProductKey.Code,
  Service: ProductKey.Services,
  DatabaseServer: ProductKey.Databases,
  MessageQueue: ProductKey.Queues,
  RumApplication: ProductKey.Rum,
  Host: ProductKey.Hosts,
  KubernetesCluster: ProductKey.Kubernetes,
  DockerHost: ProductKey.Docker,
  DockerSwarmCluster: ProductKey.DockerSwarm,
  PodmanHost: ProductKey.Podman,
  ProxmoxCluster: ProductKey.Proxmox,
  OpenStackCloud: ProductKey.OpenStack,
  VMwareVCenter: ProductKey.VMware,
  CephCluster: ProductKey.Ceph,
  StorageArray: ProductKey.StorageArrays,
  NetworkDevice: ProductKey.Network,
  IoTFleet: ProductKey.IoT,
  CloudConnection: ProductKey.Cloud,
  ServerlessFunction: ProductKey.Serverless,
  Dashboard: ProductKey.Dashboards,
  Workflow: ProductKey.Workflows,
  Runbook: ProductKey.Runbooks,
  Form: ProductKey.Forms,
};

// The product a table's records belong to, or null for a table of none.
export const getProductOfTable: (
  tableName: string | null | undefined,
) => ProductKey | null = (
  tableName: string | null | undefined,
): ProductKey | null => {
  if (!tableName) {
    return null;
  }

  return Object.prototype.hasOwnProperty.call(PRODUCT_OF_TABLE, tableName)
    ? PRODUCT_OF_TABLE[tableName]!
    : null;
};
