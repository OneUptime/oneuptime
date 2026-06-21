import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Service from "Common/Models/DatabaseModels/Service";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement, useState } from "react";
import DockerHostElement from "../DockerHost/DockerHost";
import PodmanHostElement from "../PodmanHost/PodmanHost";
import HostElement from "../Host/Host";
import KubernetesClusterElement from "../KubernetesCluster/KubernetesCluster";
import MonitorElement from "../Monitor/Monitor";
import ServiceElement from "../Service/ServiceElement";

export interface ComponentProps {
  monitors?: Array<Monitor> | undefined;
  hosts?: Array<Host> | undefined;
  kubernetesClusters?: Array<KubernetesCluster> | undefined;
  dockerHosts?: Array<DockerHost> | undefined;
  podmanHosts?: Array<PodmanHost> | undefined;
  services?: Array<Service> | undefined;
  /*
   * Caller can hide categories that don't apply (e.g. Alert lists its monitor
   * separately via a singular relation).
   */
  hideMonitors?: boolean | undefined;
  hideHosts?: boolean | undefined;
  hideKubernetesClusters?: boolean | undefined;
  hideDockerHosts?: boolean | undefined;
  hidePodmanHosts?: boolean | undefined;
  hideServices?: boolean | undefined;
  emptyMessage?: string | undefined;
}

const PREVIEW_COUNT: number = 4;
/*
 * Hard cap on rendered DOM nodes per category. Without this, an incident
 * attached to thousands of resources would render every item in one go when
 * the user clicks "Show more" — enough to lock the tab. Past this cap we
 * still render the first MAX_RENDER_PER_CATEGORY rows and surface the
 * remaining count in a footer note so the user knows the data isn't lost.
 */
const MAX_RENDER_PER_CATEGORY: number = 100;

interface CategoryCardProps<T> {
  icon: IconProp;
  label: string;
  iconBgClass: string;
  iconColorClass: string;
  accentBarClass: string;
  countTextClass: string;
  countBgClass: string;
  items: Array<T>;
  renderItem: (item: T) => ReactElement;
}

function CategoryCard<T>(props: CategoryCardProps<T>): ReactElement {
  const [showAll, setShowAll] = useState<boolean>(false);
  const total: number = props.items.length;
  const expandedCap: number = Math.min(total, MAX_RENDER_PER_CATEGORY);
  const visibleItems: Array<T> = showAll
    ? props.items.slice(0, expandedCap)
    : props.items.slice(0, PREVIEW_COUNT);
  const collapsedRemaining: number = total - PREVIEW_COUNT;
  const truncatedCount: number = total - MAX_RENDER_PER_CATEGORY;
  const hasMore: boolean = collapsedRemaining > 0;
  const isTruncated: boolean = showAll && truncatedCount > 0;

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-all duration-200 hover:border-gray-300 hover:shadow-md">
      <div className={`h-1 w-full ${props.accentBarClass}`} />
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${props.iconBgClass}`}
          >
            <Icon
              icon={props.icon}
              className={`h-[18px] w-[18px] ${props.iconColorClass}`}
            />
          </div>
          <span className="text-sm font-semibold text-gray-900">
            {props.label}
          </span>
        </div>
        <span
          className={`inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-full px-2.5 text-xs font-semibold ${props.countBgClass} ${props.countTextClass}`}
        >
          {total.toLocaleString()}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5 border-t border-gray-100 px-2 py-2">
        {visibleItems.map((item: T, i: number) => {
          return (
            <li
              key={i}
              className="group/item flex items-center justify-between rounded-md px-2.5 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              <div className="min-w-0 flex-1 truncate">
                {props.renderItem(item)}
              </div>
              <Icon
                icon={IconProp.ChevronRight}
                className="ml-2 h-3.5 w-3.5 shrink-0 text-gray-300 transition-colors group-hover/item:text-gray-500"
              />
            </li>
          );
        })}
      </ul>
      {isTruncated && (
        <div className="flex items-start gap-2 border-t border-gray-100 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
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
          className="flex w-full items-center justify-center gap-1.5 border-t border-gray-100 bg-gray-50/50 px-4 py-2.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
          onClick={() => {
            return setShowAll(!showAll);
          }}
        >
          {showAll ? (
            <>
              <Icon icon={IconProp.ChevronUp} className="h-3 w-3" />
              <span>Show less</span>
            </>
          ) : (
            <>
              <Icon icon={IconProp.ChevronDown} className="h-3 w-3" />
              <span>
                Show{" "}
                {Math.min(
                  collapsedRemaining,
                  MAX_RENDER_PER_CATEGORY - PREVIEW_COUNT,
                ).toLocaleString()}{" "}
                more{" "}
                {Math.min(
                  collapsedRemaining,
                  MAX_RENDER_PER_CATEGORY - PREVIEW_COUNT,
                ) === 1
                  ? "item"
                  : "items"}
              </span>
            </>
          )}
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
  const services: Array<Service> = props.services || [];

  const showMonitors: boolean = !props.hideMonitors && monitors.length > 0;
  const showHosts: boolean = !props.hideHosts && hosts.length > 0;
  const showClusters: boolean =
    !props.hideKubernetesClusters && kubernetesClusters.length > 0;
  const showDocker: boolean = !props.hideDockerHosts && dockerHosts.length > 0;
  const showPodman: boolean = !props.hidePodmanHosts && podmanHosts.length > 0;
  const showServices: boolean = !props.hideServices && services.length > 0;

  if (
    !showMonitors &&
    !showHosts &&
    !showClusters &&
    !showDocker &&
    !showPodman &&
    !showServices
  ) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-10 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-gray-200">
          <Icon icon={IconProp.Server} className="h-5 w-5 text-gray-400" />
        </div>
        <span className="text-sm font-medium text-gray-700">
          {props.emptyMessage || "No resources affected."}
        </span>
        <span className="max-w-sm text-xs text-gray-500">
          Attach monitors, hosts, clusters, or services to track which parts of
          your infrastructure are impacted.
        </span>
      </div>
    );
  }

  const totalCount: number =
    (showMonitors ? monitors.length : 0) +
    (showHosts ? hosts.length : 0) +
    (showClusters ? kubernetesClusters.length : 0) +
    (showDocker ? dockerHosts.length : 0) +
    (showPodman ? podmanHosts.length : 0) +
    (showServices ? services.length : 0);
  const categoryCount: number =
    (showMonitors ? 1 : 0) +
    (showHosts ? 1 : 0) +
    (showClusters ? 1 : 0) +
    (showDocker ? 1 : 0) +
    (showPodman ? 1 : 0) +
    (showServices ? 1 : 0);
  const resourceWord: string = totalCount === 1 ? "resource" : "resources";
  const categoryWord: string = categoryCount === 1 ? "category" : "categories";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
          {totalCount.toLocaleString()} {resourceWord}
        </span>
        <span className="text-gray-300">·</span>
        <span>
          across {categoryCount.toLocaleString()} {categoryWord}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {showMonitors && (
          <CategoryCard<Monitor>
            icon={IconProp.AltGlobe}
            label="Monitors"
            iconBgClass="bg-blue-50"
            iconColorClass="text-blue-600"
            accentBarClass="bg-blue-500"
            countBgClass="bg-blue-50"
            countTextClass="text-blue-700"
            items={monitors}
            renderItem={(monitor: Monitor) => {
              return <MonitorElement monitor={monitor} />;
            }}
          />
        )}
        {showHosts && (
          <CategoryCard<Host>
            icon={IconProp.Server}
            label="Hosts"
            iconBgClass="bg-emerald-50"
            iconColorClass="text-emerald-600"
            accentBarClass="bg-emerald-500"
            countBgClass="bg-emerald-50"
            countTextClass="text-emerald-700"
            items={hosts}
            renderItem={(host: Host) => {
              return <HostElement host={host} />;
            }}
          />
        )}
        {showClusters && (
          <CategoryCard<KubernetesCluster>
            icon={IconProp.Kubernetes}
            label="Kubernetes Clusters"
            iconBgClass="bg-indigo-50"
            iconColorClass="text-indigo-600"
            accentBarClass="bg-indigo-500"
            countBgClass="bg-indigo-50"
            countTextClass="text-indigo-700"
            items={kubernetesClusters}
            renderItem={(cluster: KubernetesCluster) => {
              return <KubernetesClusterElement kubernetesCluster={cluster} />;
            }}
          />
        )}
        {showDocker && (
          <CategoryCard<DockerHost>
            icon={IconProp.Docker}
            label="Docker Hosts"
            iconBgClass="bg-sky-50"
            iconColorClass="text-sky-600"
            accentBarClass="bg-sky-500"
            countBgClass="bg-sky-50"
            countTextClass="text-sky-700"
            items={dockerHosts}
            renderItem={(dockerHost: DockerHost) => {
              return <DockerHostElement dockerHost={dockerHost} />;
            }}
          />
        )}
        {showPodman && (
          <CategoryCard<PodmanHost>
            icon={IconProp.Podman}
            label="Podman Hosts"
            iconBgClass="bg-violet-50"
            iconColorClass="text-violet-600"
            accentBarClass="bg-violet-500"
            countBgClass="bg-violet-50"
            countTextClass="text-violet-700"
            items={podmanHosts}
            renderItem={(podmanHost: PodmanHost) => {
              return <PodmanHostElement podmanHost={podmanHost} />;
            }}
          />
        )}
        {showServices && (
          <CategoryCard<Service>
            icon={IconProp.Cube}
            label="Services"
            iconBgClass="bg-amber-50"
            iconColorClass="text-amber-600"
            accentBarClass="bg-amber-500"
            countBgClass="bg-amber-50"
            countTextClass="text-amber-700"
            items={services}
            renderItem={(service: Service) => {
              return <ServiceElement service={service} />;
            }}
          />
        )}
      </div>
    </div>
  );
};

export default AffectedResourcesDisplay;
