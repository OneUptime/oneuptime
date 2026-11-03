import React, { FunctionComponent, ReactElement } from "react";
import DockerSwarmResource from "Common/Models/DatabaseModels/DockerSwarmResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { RESOURCE_PART_TONE_CLASS_NAMES } from "../ResourcePart/ResourcePartHero";
import ResourcePartRow from "../ResourcePart/ResourcePartRow";
import { withSentenceDigits } from "../ResourcePart/SentenceDigits";
import {
  DOCKER_SWARM_TASK_CPU_WARNING_PERCENT,
  DOCKER_SWARM_TASK_MEMORY_WARNING_PERCENT,
  DockerSwarmAssessment,
  DockerSwarmNodeLoad,
  assessDockerSwarmNode,
  getDockerSwarmDisplayName,
  getDockerSwarmNodeLoad,
  isDockerSwarmLeader,
  isDockerSwarmManager,
  sortDockerSwarmNodesForGlance,
} from "../../Pages/DockerSwarm/Utils/DockerSwarmHealth";

/*
 * The swarm's nodes at a glance on its Overview - what `docker node ls` and
 * Portainer's swarm view open with: each node, how it is doing by the
 * swarm's rules, its role, the tasks Swarm placed on it and how much of the
 * node they use, one step from its page. Nodes that need attention come
 * first, then the managers, then the rest in name order.
 *
 * The bars are the node's tasks' latest readings against what the node has
 * (its CPUs and memory, which the agent reports from files 0.161.3 on): the
 * agent reads each task's container, not the node. A node with no fresh
 * readings, or of unknown size, shows no bar rather than a guess.
 */

// How many nodes the card lists before it points to the node list.
export const DOCKER_SWARM_NODES_CARD_SHOWN: number = 8;

export interface ComponentProps {
  rows: Array<DockerSwarmResource>;
  getNodeRoute: (externalId: string) => Route;
  nodesRoute: Route;
  now: Date;
}

function barClassName(percent: number, warning: number): string {
  return percent > warning ? "bg-amber-500" : "bg-emerald-500";
}

const DockerSwarmNodesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const nodes: Array<DockerSwarmResource> = sortDockerSwarmNodesForGlance(
    props.rows,
  );

  if (nodes.length === 0) {
    return <></>;
  }

  const shown: Array<DockerSwarmResource> = nodes.slice(
    0,
    DOCKER_SWARM_NODES_CARD_SHOWN,
  );

  const renderBar: (data: {
    key: string;
    label: string;
    percent: number | null;
    warning: number;
  }) => ReactElement = (data: {
    key: string;
    label: string;
    percent: number | null;
    warning: number;
  }): ReactElement => {
    const percent: number | null =
      data.percent === null ? null : Math.min(100, Math.max(0, data.percent));
    return (
      <div
        className="min-w-0 flex-1"
        data-testid={`docker-swarm-nodes-card-${data.key}`}
      >
        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
          <span className="text-gray-500">{tx(data.label)}</span>
          <span className="font-medium tabular-nums text-gray-700">
            {percent === null ? "—" : `${Math.round(percent)}%`}
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-gray-100">
          {percent === null ? (
            <></>
          ) : (
            <div
              data-testid={`docker-swarm-nodes-card-${data.key}-bar`}
              className={`h-1.5 rounded-full ${barClassName(percent, data.warning)}`}
              style={{ width: `${Math.max(percent, 2)}%` }}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="mb-6" data-testid="docker-swarm-nodes-card">
      <Card
        title="Nodes"
        description="Each node's state and role, the tasks Swarm placed on it, and how much of the node they use."
        buttons={[
          <Link
            key="all-nodes"
            to={props.nodesRoute}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
            dataTestId="docker-swarm-nodes-card-all"
          >
            {translator.translatePlural(
              { one: "View {{count}} node", other: "View all {{count}} nodes" },
              nodes.length,
            )}
          </Link>,
        ]}
      >
        <ul className={listClassName}>
          {shown.map((node: DockerSwarmResource): ReactElement => {
            const externalId: string = node.externalId || "";
            const name: string = getDockerSwarmDisplayName(node);
            const assessment: DockerSwarmAssessment =
              assessDockerSwarmNode(node);
            const load: DockerSwarmNodeLoad = getDockerSwarmNodeLoad({
              rows: props.rows,
              node: node,
              now: props.now,
            });

            const facts: Array<string> = [
              isDockerSwarmManager(node)
                ? isDockerSwarmLeader(node)
                  ? tx("Leader")
                  : tx("Manager node")
                : tx("Worker node"),
            ];
            if (load.tasks.total > 0) {
              facts.push(
                translator.translatePlural(
                  {
                    one: "{{running}}/{{count}} task running",
                    other: "{{running}}/{{count}} tasks running",
                  },
                  load.tasks.total,
                  // Written as the count beside it is, in the reader's digits.
                  { running: translator.formatNumber(load.tasks.running) },
                ),
              );
            } else {
              facts.push(tx("No tasks"));
            }

            return (
              <li
                key={externalId || name}
                data-testid="docker-swarm-nodes-card-item"
                data-node={name}
              >
                <ResourcePartRow
                  to={externalId ? props.getNodeRoute(externalId) : undefined}
                  className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6"
                >
                  <div className="flex min-w-0 items-start gap-3 md:w-1/2">
                    <div
                      className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200"
                      aria-hidden="true"
                    >
                      <Icon icon={IconProp.Server} className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span
                          data-testid="docker-swarm-nodes-card-name"
                          className="min-w-0 text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
                        >
                          <bdi>
                            <BreakableName text={name} breaksFromLength={0} />
                          </bdi>
                        </span>
                        <span
                          data-testid="docker-swarm-nodes-card-status"
                          data-tone={assessment.status.tone}
                          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${RESOURCE_PART_TONE_CLASS_NAMES[assessment.status.tone].badge}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${RESOURCE_PART_TONE_CLASS_NAMES[assessment.status.tone].dot}`}
                            aria-hidden="true"
                          />
                          {assessment.status.values
                            ? translator.translateTemplate(
                                assessment.status.label,
                                withSentenceDigits(assessment.status.values),
                              )
                            : tx(assessment.status.label)}
                        </span>
                      </div>
                      <div
                        className="mt-0.5 text-xs text-gray-500"
                        data-testid="docker-swarm-nodes-card-facts"
                      >
                        {facts.join(" · ")}
                      </div>
                    </div>
                  </div>
                  {/*
                   * One meter under the other on a phone: side by side,
                   * "Tasks' memory" and its value no longer fit a line and
                   * the two bars sat at different heights.
                   */}
                  <div className="flex min-w-0 flex-1 flex-col gap-2 pl-10 sm:flex-row sm:gap-4 md:pl-0">
                    {renderBar({
                      key: "cpu",
                      label: "Tasks' CPU",
                      percent: load.cpuPercentOfNode,
                      warning: DOCKER_SWARM_TASK_CPU_WARNING_PERCENT,
                    })}
                    {renderBar({
                      key: "memory",
                      label: "Tasks' memory",
                      percent: load.memoryPercentOfNode,
                      warning: DOCKER_SWARM_TASK_MEMORY_WARNING_PERCENT,
                    })}
                  </div>
                </ResourcePartRow>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
};

export default DockerSwarmNodesCard;
