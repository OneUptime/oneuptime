import DockerSwarmResource from "Common/Models/DatabaseModels/DockerSwarmResource";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { ResourcePartAttention } from "../../../Components/ResourcePart/ResourcePartTypes";
import {
  DockerSwarmPartKind,
  DockerSwarmRouteFor,
  getDockerSwarmAttentionItems,
  getDockerSwarmAttentionKey,
  getDockerSwarmNodeRows,
  getDockerSwarmServiceRows,
} from "./DockerSwarmHealth";

/*
 * WHAT NEEDS ATTENTION ON A SWARM NODE'S, SERVICE'S OR TASK'S PAGE.
 *
 * One list per page, read once by the swarm's rules (DockerSwarmHealth):
 * its Needs attention card draws it, and the hero's status opens it when
 * it says something is wrong ("Down", "1 of 3 running", "Failed"), so the
 * two can never disagree (#9594). A node's list holds it and the tasks
 * placed on it, a service's it and its tasks, a task's the task alone. The
 * part itself reads as its card names it - "This node" - under the card's
 * own words.
 *
 * React-free, so App tests can read it.
 */

export const DOCKER_SWARM_PART_ATTENTION_WORDS: Record<
  DockerSwarmPartKind,
  { description: string; current: string }
> = {
  Node: {
    description: translationKey(
      "What about this node and the tasks it runs is broken or needs a look.",
    ),
    current: translationKey("This node"),
  },
  Service: {
    description: translationKey(
      "What about this service and its tasks is broken or needs a look.",
    ),
    current: translationKey("This service"),
  },
  Task: {
    description: translationKey(
      "What about this task is broken or needs a look.",
    ),
    current: translationKey("This task"),
  },
};

export function getDockerSwarmPartAttention(data: {
  kind: DockerSwarmPartKind;
  externalId: string;
  // The part's inventory row; null while it has not reported.
  row: DockerSwarmResource | null;
  // The swarm's inventory, for a node's or a service's tasks.
  rows?: Array<DockerSwarmResource> | undefined;
  routeFor: DockerSwarmRouteFor;
  now: Date;
}): ResourcePartAttention {
  const words: { description: string; current: string } =
    DOCKER_SWARM_PART_ATTENTION_WORDS[data.kind];
  const row: DockerSwarmResource | null = data.row;
  const rows: Array<DockerSwarmResource> = !row
    ? []
    : data.kind === "Node"
      ? getDockerSwarmNodeRows({ rows: data.rows || [], node: row })
      : data.kind === "Service"
        ? getDockerSwarmServiceRows({ rows: data.rows || [], service: row })
        : [row];
  return {
    items:
      rows.length > 0
        ? getDockerSwarmAttentionItems({
            rows: rows,
            routeFor: data.routeFor,
            now: data.now,
            scope: "part",
          })
        : [],
    description: words.description,
    current: {
      key: getDockerSwarmAttentionKey(data.kind, data.externalId),
      label: words.current,
    },
  };
}
