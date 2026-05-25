import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, { FunctionComponent, ReactElement } from "react";
import DockerHostsElement from "../DockerHost/DockerHosts";
import HostsElement from "../Host/Hosts";
import KubernetesClustersElement from "../KubernetesCluster/KubernetesClusters";
import MonitorsElement from "../Monitor/Monitors";

export interface ComponentProps {
  monitors?: Array<Monitor> | undefined;
  hosts?: Array<Host> | undefined;
  kubernetesClusters?: Array<KubernetesCluster> | undefined;
  dockerHosts?: Array<DockerHost> | undefined;
  /*
   * Caller can hide categories that don't apply (e.g. Alert lists its monitor
   * separately via a singular relation).
   */
  hideMonitors?: boolean | undefined;
  hideHosts?: boolean | undefined;
  hideKubernetesClusters?: boolean | undefined;
  hideDockerHosts?: boolean | undefined;
  emptyMessage?: string | undefined;
}

/*
 * Single read-only display that mirrors the AffectedResourcesPicker. We group
 * the four ManyToMany relations under one "Resources Affected" header so the
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

  const showMonitors: boolean = !props.hideMonitors && monitors.length > 0;
  const showHosts: boolean = !props.hideHosts && hosts.length > 0;
  const showClusters: boolean =
    !props.hideKubernetesClusters && kubernetesClusters.length > 0;
  const showDocker: boolean = !props.hideDockerHosts && dockerHosts.length > 0;

  if (!showMonitors && !showHosts && !showClusters && !showDocker) {
    return (
      <span className="text-gray-500">
        {props.emptyMessage || "No resources affected."}
      </span>
    );
  }

  return (
    <div className="space-y-3">
      {showMonitors && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Monitors
          </div>
          <MonitorsElement monitors={monitors} />
        </div>
      )}
      {showHosts && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Hosts
          </div>
          <HostsElement hosts={hosts} />
        </div>
      )}
      {showClusters && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Kubernetes Clusters
          </div>
          <KubernetesClustersElement kubernetesClusters={kubernetesClusters} />
        </div>
      )}
      {showDocker && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Docker Hosts
          </div>
          <DockerHostsElement dockerHosts={dockerHosts} />
        </div>
      )}
    </div>
  );
};

export default AffectedResourcesDisplay;
