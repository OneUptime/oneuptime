import { JSONObject } from "../JSON";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import RollingTime from "../RollingTime/RollingTime";

/*
 * Docker Swarm telemetry contract (the trap these filters avoid): the
 * OneUptime Docker Swarm Agent stamps ONLY the resource attribute
 * `docker.swarm.cluster.name` on every batch — it does NOT stamp
 * `container.runtime` or `host.name`. The metrics that actually arrive
 * come from the docker_stats receiver and are the standard `container.*`
 * series. The docker_stats receiver labels each datapoint with the
 * container's identity (`container.name`, `container.image.name`),
 * which Swarm derives from the service/task that owns the container —
 * Swarm service tasks are named `<service>.<slot>.<taskid>`. These
 * identity labels are datapoint attributes, stored unprefixed in
 * ClickHouse, so filters here target `container.name` (NOT
 * `resource.container.name`). The optional node/service filters are
 * substring-friendly identity hints applied on top of the always-on
 * cluster scope.
 */
export interface DockerSwarmResourceFilters {
  /**
   * → equality on the `container.name` datapoint attribute. A Swarm
   * service task's container is named `<service>.<slot>.<taskid>`, so
   * an exact container name pins one task replica.
   */
  containerName?: string | undefined;
  /**
   * → equality on the `container.image.name` datapoint attribute. Scopes
   * the query to every task running a given image.
   */
  containerImage?: string | undefined;
  /**
   * → equality on the `docker.swarm.node.name` datapoint attribute when
   * the agent stamps it. Scopes the query to containers running on one
   * Swarm node. Optional — leave empty to span the whole cluster.
   */
  nodeName?: string | undefined;
  /**
   * → equality on the `docker.swarm.service.name` datapoint attribute
   * when the agent stamps it. Scopes the query to one Swarm service's
   * tasks. Optional.
   */
  serviceName?: string | undefined;
}

export default interface MonitorStepDockerSwarmMonitor {
  clusterIdentifier: string;
  resourceFilters: DockerSwarmResourceFilters;
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
}

export class MonitorStepDockerSwarmMonitorUtil {
  public static getDefault(): MonitorStepDockerSwarmMonitor {
    return {
      clusterIdentifier: "",
      resourceFilters: {},
      metricViewConfig: {
        queryConfigs: [],
        formulaConfigs: [],
      },
      rollingTime: RollingTime.Past1Minute,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepDockerSwarmMonitor {
    return json as any as MonitorStepDockerSwarmMonitor;
  }

  public static toJSON(monitor: MonitorStepDockerSwarmMonitor): JSONObject {
    return monitor as any as JSONObject;
  }
}
