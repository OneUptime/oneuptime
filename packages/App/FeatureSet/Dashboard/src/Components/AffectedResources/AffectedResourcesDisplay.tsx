import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import Service from "Common/Models/DatabaseModels/Service";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import CephClusterElement from "../Ceph/CephClusterElement";
import DatabaseServerElement from "../DatabaseServer/DatabaseServerElement";
import DockerHostElement from "../DockerHost/DockerHost";
import DockerSwarmClusterElement from "../DockerSwarm/DockerSwarmClusterElement";
import IoTFleetElement from "../IoT/IoTFleetElement";
import ProxmoxClusterElement from "../Proxmox/ProxmoxClusterElement";
import VMwareVCenterElement from "../VMware/VMwareVCenterElement";
import PodmanHostElement from "../PodmanHost/PodmanHost";
import HostElement from "../Host/Host";
import KubernetesClusterElement from "../KubernetesCluster/KubernetesCluster";
import MonitorElement from "../Monitor/Monitor";
import NetworkSiteElement from "../NetworkSite/NetworkSiteElement";
import ServiceElement from "../Service/ServiceElement";
import SloElement from "../Slo/SloElement";

export interface ComponentProps {
  monitors?: Array<Monitor> | undefined;
  hosts?: Array<Host> | undefined;
  kubernetesClusters?: Array<KubernetesCluster> | undefined;
  dockerHosts?: Array<DockerHost> | undefined;
  podmanHosts?: Array<PodmanHost> | undefined;
  proxmoxClusters?: Array<ProxmoxCluster> | undefined;
  vmwareVCenters?: Array<VMwareVCenter> | undefined;
  cephClusters?: Array<CephCluster> | undefined;
  dockerSwarmClusters?: Array<DockerSwarmCluster> | undefined;
  iotFleets?: Array<IoTFleet> | undefined;
  databaseServers?: Array<DatabaseServer> | undefined;
  networkSites?: Array<NetworkSite> | undefined;
  services?: Array<Service> | undefined;
  /*
   * The SLOs whose burn rate rules raised this incident or alert. The
   * worker writes the link and it is shown read-only here: the edit picker
   * deliberately does not offer SLOs, so editing the other resources can
   * never drop the link that lists this record on the SLO's own tabs.
   */
  serviceLevelObjectives?: Array<ServiceLevelObjective> | undefined;
  /*
   * Caller can hide categories that don't apply. Hiding one whose items the
   * page elsewhere calls affected leaves this card contradicting it: the
   * alert page once hid its monitor and read "No resources affected" beside
   * a feed that named the monitor.
   */
  hideMonitors?: boolean | undefined;
  hideHosts?: boolean | undefined;
  hideKubernetesClusters?: boolean | undefined;
  hideDockerHosts?: boolean | undefined;
  hidePodmanHosts?: boolean | undefined;
  hideProxmoxClusters?: boolean | undefined;
  hideVMwareVCenters?: boolean | undefined;
  hideCephClusters?: boolean | undefined;
  hideDockerSwarmClusters?: boolean | undefined;
  hideIoTFleets?: boolean | undefined;
  hideDatabaseServers?: boolean | undefined;
  hideNetworkSites?: boolean | undefined;
  hideServices?: boolean | undefined;
  hideServiceLevelObjectives?: boolean | undefined;
  emptyMessage?: string | undefined;
  /*
   * How many category sections sit side by side. Left out, the grid follows
   * the viewport: one column on phones, two from md up. That is right for a
   * full-width card but not for one in a narrow column (an overview page's
   * sidebar), where two sections share about 300px and every name is
   * clipped, so those callers ask for 1.
   */
  columns?: 1 | 2 | undefined;
}

type GetColumnsClassNameFunction = (columns: 1 | 2 | undefined) => string;

/*
 * The categories are sections of the card this display sits in, not cards of
 * their own. Each one used to be a bordered, shadowed tile with a coloured
 * bar across its top, so the card read as a stack of cards nested inside a
 * card. In one column the sections are split by hairlines, like the rows of
 * the details card above this one in an overview page's sidebar. Side by side
 * (md and up, in a full-width card) a hairline would also run across the top
 * of the second section of the first row, so that layout separates the
 * sections with whitespace instead.
 */
export const getAffectedResourcesGridClassName: GetColumnsClassNameFunction = (
  columns: 1 | 2 | undefined,
): string => {
  if (columns === 1) {
    return "grid grid-cols-1 divide-y divide-gray-100";
  }

  return "grid grid-cols-1 divide-y divide-gray-100 md:grid-cols-2 md:gap-x-10 md:gap-y-6 md:divide-y-0";
};

export const getAffectedResourcesSectionClassName: GetColumnsClassNameFunction =
  (columns: 1 | 2 | undefined): string => {
    if (columns === 1) {
      return "min-w-0 py-4 first:pt-0 last:pb-0";
    }

    return "min-w-0 py-4 first:pt-0 last:pb-0 md:py-0";
  };

/*
 * The resource elements wrap their name in a flex span (or a flex row, for
 * services), and text inside a flex container cannot be ellipsised from out
 * here. Turning those spans into truncating blocks keeps a long name on one
 * line with an ellipsis; the item's title shows it in full on hover.
 *
 * The rest stretches the element's link over its whole row (the row is
 * positioned, the link's ::after fills it), so the row that lights up on
 * hover is also the row that opens the resource, not just the name inside
 * it. The link's own focus outline would be clipped by the truncation, so a
 * keyboard focus ring is drawn around the row instead.
 */
export const AFFECTED_RESOURCE_ITEM_CLASS_NAME: string =
  "min-w-0 truncate [&_span.flex]:block [&_span.flex]:truncate [&_a]:after:absolute [&_a]:after:inset-0 [&_a]:after:rounded-md [&_a:focus-visible]:outline-none [&_a:focus-visible]:after:ring-2 [&_a:focus-visible]:after:ring-indigo-500";

interface NamedResource {
  name?: string | undefined;
}

const PREVIEW_COUNT: number = 4;
/*
 * Hard cap on rendered DOM nodes per category. Without this, an incident
 * attached to thousands of resources would render every item in one go when
 * the user clicks "Show more" — enough to lock the tab. Past this cap we
 * still render the first MAX_RENDER_PER_CATEGORY rows and surface the
 * remaining count in a note under the list so the user knows the data isn't
 * lost.
 */
const MAX_RENDER_PER_CATEGORY: number = 100;

interface CategorySectionProps<T extends NamedResource> {
  icon: IconProp;
  label: string;
  iconBgClass: string;
  iconColorClass: string;
  items: Array<T>;
  renderItem: (item: T) => ReactElement;
  className: string;
}

function CategorySection<T extends NamedResource>(
  props: CategorySectionProps<T>,
): ReactElement {
  const [showAll, setShowAll] = useState<boolean>(false);
  const headingId: string = useId();
  const listId: string = useId();
  const total: number = props.items.length;
  const expandedCap: number = Math.min(total, MAX_RENDER_PER_CATEGORY);
  const visibleItems: Array<T> = showAll
    ? props.items.slice(0, expandedCap)
    : props.items.slice(0, PREVIEW_COUNT);
  const collapsedRemaining: number = total - PREVIEW_COUNT;
  const truncatedCount: number = total - MAX_RENDER_PER_CATEGORY;
  const hasMore: boolean = collapsedRemaining > 0;
  const isTruncated: boolean = showAll && truncatedCount > 0;
  const moreCount: number = Math.min(
    collapsedRemaining,
    MAX_RENDER_PER_CATEGORY - PREVIEW_COUNT,
  );

  return (
    <div data-testid="affected-resource-category" className={props.className}>
      <div className="flex min-w-0 items-center gap-2">
        <div
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${props.iconBgClass}`}
        >
          <Icon
            icon={props.icon}
            className={`h-3.5 w-3.5 ${props.iconColorClass}`}
          />
        </div>
        {/*
         * The count is part of the heading, which also names the list, so a
         * screen reader hears "Monitors 7" before a list of the first four.
         */}
        <h3 id={headingId} className="flex min-w-0 flex-1 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-gray-900">
            {props.label}
          </span>{" "}
          <span
            data-testid="affected-resource-category-count"
            className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium tabular-nums text-gray-600"
          >
            {total.toLocaleString()}
          </span>
        </h3>
      </div>
      {/*
       * Indented to line up with the label, past the icon (h-6 plus gap-2),
       * so the icon column reads as the section's gutter.
       */}
      <ul
        id={listId}
        aria-labelledby={headingId}
        className="mt-1.5 flex flex-col gap-0.5 pl-8"
      >
        {visibleItems.map((item: T, i: number) => {
          const itemName: string = item.name?.toString() || "";

          return (
            <li
              key={i}
              className="relative -ml-2 rounded-md px-2 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              <div
                data-testid="affected-resource-item"
                className={AFFECTED_RESOURCE_ITEM_CLASS_NAME}
                title={itemName || undefined}
              >
                {props.renderItem(item)}
              </div>
            </li>
          );
        })}
      </ul>
      {isTruncated && (
        <div
          data-testid="affected-resource-truncated-note"
          className="ml-8 mt-2 flex items-start gap-1.5 text-xs leading-5 text-amber-700"
        >
          <Icon
            icon={IconProp.Alert}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600"
          />
          <span>
            Showing the first {MAX_RENDER_PER_CATEGORY.toLocaleString()} of{" "}
            {total.toLocaleString()}. {truncatedCount.toLocaleString()} more
            attached — edit affected resources to manage the full list.
          </span>
        </div>
      )}
      {hasMore && (
        <button
          type="button"
          aria-expanded={showAll}
          aria-controls={listId}
          className="ml-6 mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
          onClick={() => {
            return setShowAll(!showAll);
          }}
        >
          <Icon
            icon={showAll ? IconProp.ChevronUp : IconProp.ChevronDown}
            className="h-3 w-3"
          />
          <span>
            {showAll ? "Show less" : `Show ${moreCount.toLocaleString()} more`}
          </span>
        </button>
      )}
    </div>
  );
}

/*
 * Single read-only display that mirrors the AffectedResourcesPicker. We group
 * the five ManyToMany relations under one "Resources Affected" header so the
 * edit experience (one picker) and the view experience (one section) line up.
 * Empty buckets collapse so the section only shows what's actually attached.
 *
 * SLOs are the one bucket with no picker counterpart: burn rate rules link
 * them, and nobody attaches or detaches them by hand.
 */
const AffectedResourcesDisplay: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const monitors: Array<Monitor> = props.monitors || [];
  const hosts: Array<Host> = props.hosts || [];
  const kubernetesClusters: Array<KubernetesCluster> =
    props.kubernetesClusters || [];
  const dockerHosts: Array<DockerHost> = props.dockerHosts || [];
  const podmanHosts: Array<PodmanHost> = props.podmanHosts || [];
  const proxmoxClusters: Array<ProxmoxCluster> = props.proxmoxClusters || [];
  const vmwareVCenters: Array<VMwareVCenter> = props.vmwareVCenters || [];
  const cephClusters: Array<CephCluster> = props.cephClusters || [];
  const dockerSwarmClusters: Array<DockerSwarmCluster> =
    props.dockerSwarmClusters || [];
  const iotFleets: Array<IoTFleet> = props.iotFleets || [];
  const databaseServers: Array<DatabaseServer> = props.databaseServers || [];
  const networkSites: Array<NetworkSite> = props.networkSites || [];
  const services: Array<Service> = props.services || [];
  const serviceLevelObjectives: Array<ServiceLevelObjective> =
    props.serviceLevelObjectives || [];

  const showMonitors: boolean = !props.hideMonitors && monitors.length > 0;
  const showHosts: boolean = !props.hideHosts && hosts.length > 0;
  const showClusters: boolean =
    !props.hideKubernetesClusters && kubernetesClusters.length > 0;
  const showDocker: boolean = !props.hideDockerHosts && dockerHosts.length > 0;
  const showPodman: boolean = !props.hidePodmanHosts && podmanHosts.length > 0;
  const showProxmox: boolean =
    !props.hideProxmoxClusters && proxmoxClusters.length > 0;
  const showVMware: boolean =
    !props.hideVMwareVCenters && vmwareVCenters.length > 0;
  const showCeph: boolean = !props.hideCephClusters && cephClusters.length > 0;
  const showSwarm: boolean =
    !props.hideDockerSwarmClusters && dockerSwarmClusters.length > 0;
  const showIoTFleets: boolean = !props.hideIoTFleets && iotFleets.length > 0;
  const showDatabases: boolean =
    !props.hideDatabaseServers && databaseServers.length > 0;
  const showNetworkSites: boolean =
    !props.hideNetworkSites && networkSites.length > 0;
  const showServices: boolean = !props.hideServices && services.length > 0;
  const showSlos: boolean =
    !props.hideServiceLevelObjectives && serviceLevelObjectives.length > 0;

  if (
    !showMonitors &&
    !showHosts &&
    !showClusters &&
    !showDocker &&
    !showPodman &&
    !showProxmox &&
    !showVMware &&
    !showCeph &&
    !showSwarm &&
    !showIoTFleets &&
    !showDatabases &&
    !showNetworkSites &&
    !showServices &&
    !showSlos
  ) {
    /*
     * Only a caller that shows SLOs (the incident and alert pages) can have
     * one linked by a burn rate rule; a scheduled maintenance event or a
     * template never does, so the hint does not promise it there.
     */
    const showsSlos: boolean =
      props.serviceLevelObjectives !== undefined &&
      !props.hideServiceLevelObjectives;

    /*
     * Open, like the rest of the card's body: a dashed, tinted box here was
     * another card inside the card.
     */
    return (
      <div
        data-testid="affected-resources-empty"
        className="flex flex-col items-center px-4 py-6 text-center"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
          <Icon icon={IconProp.Server} className="h-5 w-5 text-gray-400" />
        </div>
        <p className="mt-3 text-sm font-medium text-gray-900">
          {props.emptyMessage || "No resources affected."}
        </p>
        <p className="mt-1 max-w-xs text-xs leading-5 text-gray-500">
          Attach monitors, hosts, clusters, or services to track which parts of
          your infrastructure are impacted.
          {showsSlos
            ? " SLOs are linked automatically when their burn rate rules fire."
            : ""}
        </p>
      </div>
    );
  }

  const totalCount: number =
    (showMonitors ? monitors.length : 0) +
    (showHosts ? hosts.length : 0) +
    (showClusters ? kubernetesClusters.length : 0) +
    (showDocker ? dockerHosts.length : 0) +
    (showPodman ? podmanHosts.length : 0) +
    (showProxmox ? proxmoxClusters.length : 0) +
    (showVMware ? vmwareVCenters.length : 0) +
    (showCeph ? cephClusters.length : 0) +
    (showSwarm ? dockerSwarmClusters.length : 0) +
    (showIoTFleets ? iotFleets.length : 0) +
    (showDatabases ? databaseServers.length : 0) +
    (showNetworkSites ? networkSites.length : 0) +
    (showServices ? services.length : 0) +
    (showSlos ? serviceLevelObjectives.length : 0);
  const categoryCount: number =
    (showMonitors ? 1 : 0) +
    (showHosts ? 1 : 0) +
    (showClusters ? 1 : 0) +
    (showDocker ? 1 : 0) +
    (showPodman ? 1 : 0) +
    (showProxmox ? 1 : 0) +
    (showVMware ? 1 : 0) +
    (showCeph ? 1 : 0) +
    (showSwarm ? 1 : 0) +
    (showIoTFleets ? 1 : 0) +
    (showDatabases ? 1 : 0) +
    (showNetworkSites ? 1 : 0) +
    (showServices ? 1 : 0) +
    (showSlos ? 1 : 0);
  const resourceWord: string = totalCount === 1 ? "resource" : "resources";
  const categoryWord: string = categoryCount === 1 ? "category" : "categories";
  const sectionClassName: string = getAffectedResourcesSectionClassName(
    props.columns,
  );

  return (
    <div className="flex flex-col gap-4">
      {/*
       * One category already counts its own items in its heading, so the
       * total only earns a line once there is more than one to add up.
       */}
      {categoryCount > 1 && (
        <p
          data-testid="affected-resources-summary"
          className="text-xs text-gray-500"
        >
          <span className="font-semibold text-gray-900">
            {totalCount.toLocaleString()} {resourceWord}
          </span>{" "}
          across {categoryCount.toLocaleString()} {categoryWord}
        </p>
      )}
      <div
        data-testid="affected-resources-grid"
        className={getAffectedResourcesGridClassName(props.columns)}
      >
        {showMonitors && (
          <CategorySection<Monitor>
            className={sectionClassName}
            icon={IconProp.AltGlobe}
            label="Monitors"
            iconBgClass="bg-blue-50"
            iconColorClass="text-blue-600"
            items={monitors}
            renderItem={(monitor: Monitor) => {
              return <MonitorElement monitor={monitor} />;
            }}
          />
        )}
        {showHosts && (
          <CategorySection<Host>
            className={sectionClassName}
            icon={IconProp.Server}
            label="Hosts"
            iconBgClass="bg-emerald-50"
            iconColorClass="text-emerald-600"
            items={hosts}
            renderItem={(host: Host) => {
              return <HostElement host={host} />;
            }}
          />
        )}
        {showClusters && (
          <CategorySection<KubernetesCluster>
            className={sectionClassName}
            icon={IconProp.Kubernetes}
            label="Kubernetes Clusters"
            iconBgClass="bg-indigo-50"
            iconColorClass="text-indigo-600"
            items={kubernetesClusters}
            renderItem={(cluster: KubernetesCluster) => {
              return <KubernetesClusterElement kubernetesCluster={cluster} />;
            }}
          />
        )}
        {showDocker && (
          <CategorySection<DockerHost>
            className={sectionClassName}
            icon={IconProp.Docker}
            label="Docker Hosts"
            iconBgClass="bg-sky-50"
            iconColorClass="text-sky-600"
            items={dockerHosts}
            renderItem={(dockerHost: DockerHost) => {
              return <DockerHostElement dockerHost={dockerHost} />;
            }}
          />
        )}
        {showPodman && (
          <CategorySection<PodmanHost>
            className={sectionClassName}
            icon={IconProp.Podman}
            label="Podman Hosts"
            iconBgClass="bg-violet-50"
            iconColorClass="text-violet-600"
            items={podmanHosts}
            renderItem={(podmanHost: PodmanHost) => {
              return <PodmanHostElement podmanHost={podmanHost} />;
            }}
          />
        )}
        {showProxmox && (
          <CategorySection<ProxmoxCluster>
            className={sectionClassName}
            icon={IconProp.Proxmox}
            label="Proxmox Clusters"
            iconBgClass="bg-orange-50"
            iconColorClass="text-orange-600"
            items={proxmoxClusters}
            renderItem={(cluster: ProxmoxCluster) => {
              return <ProxmoxClusterElement proxmoxCluster={cluster} />;
            }}
          />
        )}
        {showVMware && (
          <CategorySection<VMwareVCenter>
            className={sectionClassName}
            icon={IconProp.VMware}
            label="vCenters"
            iconBgClass="bg-sky-50"
            iconColorClass="text-sky-600"
            items={vmwareVCenters}
            renderItem={(vcenter: VMwareVCenter) => {
              return <VMwareVCenterElement vmwareVCenter={vcenter} />;
            }}
          />
        )}
        {showCeph && (
          <CategorySection<CephCluster>
            className={sectionClassName}
            icon={IconProp.Ceph}
            label="Ceph Clusters"
            iconBgClass="bg-rose-50"
            iconColorClass="text-rose-600"
            items={cephClusters}
            renderItem={(cluster: CephCluster) => {
              return <CephClusterElement cephCluster={cluster} />;
            }}
          />
        )}
        {showSwarm && (
          <CategorySection<DockerSwarmCluster>
            className={sectionClassName}
            icon={IconProp.DockerSwarm}
            label="Docker Swarm Clusters"
            iconBgClass="bg-cyan-50"
            iconColorClass="text-cyan-600"
            items={dockerSwarmClusters}
            renderItem={(cluster: DockerSwarmCluster) => {
              return <DockerSwarmClusterElement dockerSwarmCluster={cluster} />;
            }}
          />
        )}
        {showIoTFleets && (
          <CategorySection<IoTFleet>
            className={sectionClassName}
            icon={IconProp.IoT}
            label="IoT Fleets"
            iconBgClass="bg-teal-50"
            iconColorClass="text-teal-600"
            items={iotFleets}
            renderItem={(fleet: IoTFleet) => {
              return <IoTFleetElement iotFleet={fleet} />;
            }}
          />
        )}
        {showDatabases && (
          <CategorySection<DatabaseServer>
            className={sectionClassName}
            icon={IconProp.Database}
            label="Databases"
            iconBgClass="bg-purple-50"
            iconColorClass="text-purple-600"
            items={databaseServers}
            renderItem={(databaseServer: DatabaseServer) => {
              return <DatabaseServerElement databaseServer={databaseServer} />;
            }}
          />
        )}
        {showNetworkSites && (
          <CategorySection<NetworkSite>
            className={sectionClassName}
            icon={IconProp.BuildingOffice}
            label="Network Sites"
            iconBgClass="bg-indigo-50"
            iconColorClass="text-indigo-600"
            items={networkSites}
            renderItem={(networkSite: NetworkSite) => {
              return <NetworkSiteElement networkSite={networkSite} />;
            }}
          />
        )}
        {showServices && (
          <CategorySection<Service>
            className={sectionClassName}
            icon={IconProp.Cube}
            label="Services"
            iconBgClass="bg-amber-50"
            iconColorClass="text-amber-600"
            items={services}
            renderItem={(service: Service) => {
              return (
                <ServiceElement
                  service={service}
                  serviceNameClassName="min-w-0 truncate"
                />
              );
            }}
          />
        )}
        {/*
         * Last: an SLO is not a piece of infrastructure but the objective
         * measured over it, so it reads best after everything it covers.
         * Fuchsia is a hue no other category uses, and Theme.css remaps its
         * 50 and 600 shades for dark mode.
         */}
        {showSlos && (
          <CategorySection<ServiceLevelObjective>
            className={sectionClassName}
            icon={IconProp.Gauge}
            label="SLOs"
            iconBgClass="bg-fuchsia-50"
            iconColorClass="text-fuchsia-600"
            items={serviceLevelObjectives}
            renderItem={(serviceLevelObjective: ServiceLevelObjective) => {
              return (
                <SloElement serviceLevelObjective={serviceLevelObjective} />
              );
            }}
          />
        )}
      </div>
    </div>
  );
};

export default AffectedResourcesDisplay;
