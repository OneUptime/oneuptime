import { JSONObject } from "../JSON";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import RollingTime from "../RollingTime/RollingTime";
import { escapeWildcards } from "../BaseDatabase/WildcardPattern";

/*
 * Docker Swarm telemetry contract. Every attribute below is a RESOURCE
 * attribute, so ClickHouse stores it `resource.`-prefixed and every filter
 * targets the prefixed key:
 *
 *  - the docker_stats receiver puts each container's identity on the
 *    resource of its metrics: `container.name` (a Swarm task's container is
 *    `<service>.<slot>.<taskid>`), `container.image.name`, `container.id`,
 *    and `container.runtime=docker` on every one;
 *  - the OneUptime Docker Swarm Agent's config copies two of the labels
 *    Swarm puts on every task container onto that resource
 *    (`container_labels_to_metric_labels`): `com.docker.swarm.service.name`
 *    as `docker.swarm.service.name` and `com.docker.swarm.node.id` as
 *    `docker.swarm.node.id`. Swarm labels a task with its node's ID only, so
 *    the node's name, `docker.swarm.node.name`, comes from the agent's
 *    DOCKER_SWARM_NODE_NAME (install.sh writes the node's hostname, as
 *    `docker node ls` shows it) and is left off when that is empty;
 *  - the agent stamps `docker.swarm.cluster.name` on everything, and never
 *    `host.name` (with `container.runtime`, that would register every node
 *    as a Docker Host of its own).
 */
export interface DockerSwarmResourceFilters {
  /**
   * → equality on `resource.container.name`. A Swarm service task's
   * container is named `<service>.<slot>.<taskid>`, so an exact container
   * name pins one task replica.
   */
  containerName?: string | undefined;
  /**
   * → `resource.container.image.name`, matched with or without the digest
   * Swarm pins a task's image to (see getContainerImageGlobs). Scopes the
   * query to every task running a given image.
   */
  containerImage?: string | undefined;
  /**
   * → equality on `resource.docker.swarm.node.name`: the node's hostname,
   * stamped from the agent's DOCKER_SWARM_NODE_NAME. Scopes the query to
   * the containers running on one Swarm node. Optional — leave empty to
   * span the whole cluster.
   */
  nodeName?: string | undefined;
  /**
   * → equality on `resource.docker.swarm.service.name`, Swarm's own
   * `com.docker.swarm.service.name` label (a stack's service is
   * `<stack>_<service>`). Scopes the query to one service's tasks. Optional.
   */
  serviceName?: string | undefined;
  /**
   * → `resource.docker.swarm.service.name` is present: only the containers
   * Swarm runs for a service (its tasks), not one started any other way on
   * a node - the agent's own container, a `docker run`. Set by every
   * template but Cluster Stopped Reporting, whose heartbeat is the agent's
   * own container. Not set: every container the agent reports.
   */
  tasksOnly?: boolean | undefined;
}

// The attribute only a Swarm task's container carries (see tasksOnly).
export const SWARM_TASK_SERVICE_ATTRIBUTE: string =
  "resource.docker.swarm.service.name";

export default interface MonitorStepDockerSwarmMonitor {
  clusterIdentifier: string;
  /*
   * The resource's id. Bound on every write and read by the worker, so a
   * rename keeps the monitor on its resource (InfrastructureResourceBinding).
   */
  resourceId?: string | undefined;
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

  /**
   * The globs (Wildcard syntax) a Container Image filter matches
   * `resource.container.image.name` with.
   *
   * Swarm rewrites the image a service is deployed with before any task
   * runs it: `docker service create` and `docker stack deploy` tag an
   * untagged name `:latest`, then pin the reference to the digest the
   * registry resolves it to. A task deployed from `nginx` runs, and
   * docker_stats reports, `nginx:latest@sha256:…` — so an exact match on
   * `nginx:latest`, the image as `docker service ls` and OneUptime's own
   * Services and Tasks pages show it, finds nothing. This undoes both
   * rewrites: the typed reference is matched with any digest or none, a
   * digest typed with it is dropped (a service update pins a new one), and
   * a name typed without a tag or a digest is also matched as `:latest`.
   * The typed text is matched literally: a `*` in it is not a wildcard.
   * Blank text matches no image in particular: no globs, no filter.
   */
  public static getContainerImageGlobs(containerImage: string): Array<string> {
    const typed: string = containerImage.trim();
    const withoutDigest: string =
      MonitorStepDockerSwarmMonitorUtil.withoutDigest(typed);

    if (!withoutDigest) {
      // Blank, or a digest with no name: match the text as it is.
      return typed ? [escapeWildcards(typed)] : [];
    }

    const references: Array<string> = [withoutDigest];

    if (
      withoutDigest === typed &&
      !MonitorStepDockerSwarmMonitorUtil.hasTag(withoutDigest)
    ) {
      references.push(`${withoutDigest}:latest`);
    }

    return references.flatMap((reference: string): Array<string> => {
      const literal: string = escapeWildcards(reference);
      return [literal, `${literal}@*`];
    });
  }

  /*
   * An image reference without the digest at its end (`@sha256:<hex>`, or
   * any `@<algorithm>:<encoded>`). Read with indexOf rather than a regular
   * expression: the value comes from a monitor's settings, with no limit on
   * its length.
   */
  private static withoutDigest(reference: string): string {
    const at: number = reference.lastIndexOf("@");

    if (at < 0) {
      return reference;
    }

    const digest: string = reference.substring(at + 1);
    const colon: number = digest.indexOf(":");

    if (
      colon <= 0 ||
      colon === digest.length - 1 ||
      digest.includes("/") ||
      digest.indexOf(":", colon + 1) >= 0
    ) {
      return reference;
    }

    return reference.substring(0, at);
  }

  /*
   * Whether an image reference names a tag: a `:` after its last `/`. A
   * colon before the last slash is a registry's port
   * (`registry.example.com:5000/team/app`).
   */
  private static hasTag(reference: string): boolean {
    const name: string = reference.substring(reference.lastIndexOf("/") + 1);
    return name.includes(":");
  }

  public static fromJSON(json: JSONObject): MonitorStepDockerSwarmMonitor {
    return json as any as MonitorStepDockerSwarmMonitor;
  }

  public static toJSON(monitor: MonitorStepDockerSwarmMonitor): JSONObject {
    return monitor as any as JSONObject;
  }
}
