/*
 * The names an Affected Resources cell lists, in the order it lists them
 * (AffectedResourcesCell): the monitors first, then hosts, Kubernetes
 * clusters, Docker and Podman hosts, Proxmox clusters, vCenters, Ceph
 * clusters, storage arrays, Docker Swarm clusters, IoT fleets, databases,
 * cloud resources, network sites, services and SLOs.
 *
 * A list's CSV export writes these for its Affected Resources column, so the
 * file names a row's resources the way the row draws them. The alerts list
 * has no Monitor column - its Affected Resources names the alert's monitor -
 * and without this its file put the monitor last, after every other
 * resource, in the order the column declares its fields.
 *
 * React-free, so a plain unit test can import it. Keep the order in step
 * with AffectedResourcesCell: AlertsTableAffectedResources draws the cell
 * and reads the two side by side.
 */

export interface NamedResource {
  name?: string | undefined;
}

export interface AffectedResourceLists {
  monitors?: Array<NamedResource> | undefined;
  hosts?: Array<NamedResource> | undefined;
  kubernetesClusters?: Array<NamedResource> | undefined;
  dockerHosts?: Array<NamedResource> | undefined;
  podmanHosts?: Array<NamedResource> | undefined;
  proxmoxClusters?: Array<NamedResource> | undefined;
  vmwareVCenters?: Array<NamedResource> | undefined;
  cephClusters?: Array<NamedResource> | undefined;
  storageArrays?: Array<NamedResource> | undefined;
  dockerSwarmClusters?: Array<NamedResource> | undefined;
  iotFleets?: Array<NamedResource> | undefined;
  databaseServers?: Array<NamedResource> | undefined;
  cloudResources?: Array<NamedResource> | undefined;
  networkSites?: Array<NamedResource> | undefined;
  services?: Array<NamedResource> | undefined;
  serviceLevelObjectives?: Array<NamedResource> | undefined;
}

// The cell's order, list by list.
export const AFFECTED_RESOURCE_LIST_ORDER: ReadonlyArray<
  keyof AffectedResourceLists
> = [
  "monitors",
  "hosts",
  "kubernetesClusters",
  "dockerHosts",
  "podmanHosts",
  "proxmoxClusters",
  "vmwareVCenters",
  "cephClusters",
  "storageArrays",
  "dockerSwarmClusters",
  "iotFleets",
  "databaseServers",
  "cloudResources",
  "networkSites",
  "services",
  "serviceLevelObjectives",
];

/*
 * Joined the way a CSV cell joins several values (TableColumnsToCsv), so the
 * column reads like every other list's multi-value column.
 */
export const AFFECTED_RESOURCES_EXPORT_SEPARATOR: string = "; ";

export type GetAffectedResourceNamesFunction = (
  lists: AffectedResourceLists,
) => Array<string>;

/*
 * Every named resource, monitors first. A resource with no name is left out,
 * and a name already listed is not listed again, as TableColumnsToCsv does
 * for any cell built from several fields.
 */
export const getAffectedResourceNames: GetAffectedResourceNamesFunction = (
  lists: AffectedResourceLists,
): Array<string> => {
  const names: Array<string> = [];

  for (const listName of AFFECTED_RESOURCE_LIST_ORDER) {
    for (const resource of lists[listName] || []) {
      const name: string = (resource?.name || "").toString().trim();

      if (name && !names.includes(name)) {
        names.push(name);
      }
    }
  }

  return names;
};

export type GetAffectedResourcesExportValueFunction = (
  lists: AffectedResourceLists,
) => string;

// The text of an Affected Resources cell in a CSV export.
export const getAffectedResourcesExportValue: GetAffectedResourcesExportValueFunction =
  (lists: AffectedResourceLists): string => {
    return getAffectedResourceNames(lists).join(
      AFFECTED_RESOURCES_EXPORT_SEPARATOR,
    );
  };
