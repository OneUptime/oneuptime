import CephExecutor from "./CephExecutor";
import DatabaseExecutor from "./DatabaseExecutor";
import DockerExecutor from "./DockerExecutor";
import GovcExecutor from "./GovcExecutor";
import HostExecutor from "./HostExecutor";
import ProxmoxExecutor from "./ProxmoxExecutor";
import {
  ExecutorOptions,
  ResourceExecutor,
  ResourceExecutorClass,
} from "./ResourceExecutor";
import UnavailableExecutor from "./UnavailableExecutor";
import AiResourceType, {
  isAiResourceType,
} from "../Common/Types/ResourceAiAgent/AiResourceType";

/*
 * Which executor reaches which resource type. One agent process serves ONE
 * resource, so it builds exactly one executor, from the configured type:
 *
 *   DockerHost, PodmanHost, DockerSwarmCluster  DockerExecutor (docker CLI)
 *   ProxmoxCluster                              ProxmoxExecutor (PVE API)
 *   VMwareVCenter                               GovcExecutor (govc)
 *   CephCluster                                 CephExecutor (ceph CLI)
 *   DatabaseServer                              DatabaseExecutor (drivers)
 *   Host                                        HostExecutor (nsenter)
 *
 * Every class is constructed the same way (constructor(options:
 * ExecutorOptions)); an agent without a known type gets an
 * UnavailableExecutor, which runs nothing.
 */
export const EXECUTOR_CLASSES: Readonly<
  Record<AiResourceType, ResourceExecutorClass>
> = {
  [AiResourceType.DockerHost]: DockerExecutor,
  [AiResourceType.PodmanHost]: DockerExecutor,
  [AiResourceType.DockerSwarmCluster]: DockerExecutor,
  [AiResourceType.ProxmoxCluster]: ProxmoxExecutor,
  [AiResourceType.VMwareVCenter]: GovcExecutor,
  [AiResourceType.CephCluster]: CephExecutor,
  [AiResourceType.DatabaseServer]: DatabaseExecutor,
  [AiResourceType.Host]: HostExecutor,
};

export function getExecutorClass(
  resourceType: AiResourceType | null,
): ResourceExecutorClass {
  if (!resourceType || !isAiResourceType(resourceType)) {
    return UnavailableExecutor;
  }

  return EXECUTOR_CLASSES[resourceType];
}

// The executor for the configured resource type.
export function createExecutor(options: ExecutorOptions): ResourceExecutor {
  const ExecutorClass: ResourceExecutorClass = getExecutorClass(
    options.config.resourceType,
  );

  return new ExecutorClass(options);
}

export type ExecutorFactoryFunction = (
  options: ExecutorOptions,
) => ResourceExecutor;
