import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Service from "Common/Models/DatabaseModels/Service";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement, useState } from "react";
import DockerHostElement from "../DockerHost/DockerHost";
import HostElement from "../Host/Host";
import KubernetesClusterElement from "../KubernetesCluster/KubernetesCluster";
import MonitorElement from "../Monitor/Monitor";
import ServiceElement from "../Service/ServiceElement";

export interface ComponentProps {
  monitors?: Array<Monitor> | undefined;
  hosts?: Array<Host> | undefined;
  kubernetesClusters?: Array<KubernetesCluster> | undefined;
  dockerHosts?: Array<DockerHost> | undefined;
  services?: Array<Service> | undefined;
  /*
   * Caller can hide categories that don't apply (e.g. Alert lists its monitor
   * separately via a singular relation).
   */
  hideMonitors?: boolean | undefined;
  hideHosts?: boolean | undefined;
  hideKubernetesClusters?: boolean | undefined;
  hideDockerHosts?: boolean | undefined;
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
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow">
      <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-md ${props.iconBgClass}`}
          >
            <Icon
              icon={props.icon}
              className={`h-4 w-4 ${props.iconColorClass}`}
            />
          </div>
          <span className="text-sm font-semibold text-gray-800">
            {props.label}
          </span>
        </div>
        <span className="inline-flex h-5 min-w-[1.5rem] items-center justify-center rounded-full bg-white px-2 text-xs font-semibold text-gray-600 ring-1 ring-inset ring-gray-200">
          {total.toLocaleString()}
        </span>
      </div>
      <ul className="divide-y divide-gray-100">
        {visibleItems.map((item: T, i: number) => {
          return (
            <li
              key={i}
              className="px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              {props.renderItem(item)}
            </li>
          );
        })}
      </ul>
      {isTruncated && (
        <div className="border-t border-gray-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Showing the first {MAX_RENDER_PER_CATEGORY.toLocaleString()} of{" "}
          {total.toLocaleString()}. {truncatedCount.toLocaleString()} more
          attached — edit affected resources to manage the full list.
        </div>
      )}
      {hasMore && (
        <button
          type="button"
          className="flex w-full items-center justify-center gap-1 border-t border-gray-100 bg-white px-4 py-2 text-xs font-medium text-indigo-600 transition-colors hover:bg-gray-50 hover:text-indigo-700"
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
  const services: Array<Service> = props.services || [];

  const showMonitors: boolean = !props.hideMonitors && monitors.length > 0;
  const showHosts: boolean = !props.hideHosts && hosts.length > 0;
  const showClusters: boolean =
    !props.hideKubernetesClusters && kubernetesClusters.length > 0;
  const showDocker: boolean = !props.hideDockerHosts && dockerHosts.length > 0;
  const showServices: boolean = !props.hideServices && services.length > 0;

  if (
    !showMonitors &&
    !showHosts &&
    !showClusters &&
    !showDocker &&
    !showServices
  ) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-4 text-sm text-gray-500">
        <Icon icon={IconProp.Server} className="h-4 w-4 text-gray-400" />
        <span>{props.emptyMessage || "No resources affected."}</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {showMonitors && (
        <CategoryCard<Monitor>
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
        <CategoryCard<Host>
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
        <CategoryCard<KubernetesCluster>
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
        <CategoryCard<DockerHost>
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
      {showServices && (
        <CategoryCard<Service>
          icon={IconProp.Cube}
          label="Services"
          iconBgClass="bg-amber-50"
          iconColorClass="text-amber-600"
          items={services}
          renderItem={(service: Service) => {
            return <ServiceElement service={service} />;
          }}
        />
      )}
    </div>
  );
};

export default AffectedResourcesDisplay;
