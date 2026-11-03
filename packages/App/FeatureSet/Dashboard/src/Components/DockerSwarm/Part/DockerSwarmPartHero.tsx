import React, { FunctionComponent, ReactElement } from "react";
import DockerSwarmResource from "Common/Models/DatabaseModels/DockerSwarmResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ResourcePartHero from "../../ResourcePart/ResourcePartHero";
import {
  ResourcePartAccent,
  ResourcePartBadge,
  ResourcePartChip,
  ResourcePartStatus,
} from "../../ResourcePart/ResourcePartTypes";
import { DOCKER_SWARM_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/DockerSwarmMetricDescriptions";
import {
  DockerSwarmAssessment,
  DockerSwarmPartKind,
  assessDockerSwarmResource,
  getDockerSwarmAttribute,
  getDockerSwarmDisplayName,
  toDockerSwarmDate,
  toDockerSwarmNumber,
} from "../../../Pages/DockerSwarm/Utils/DockerSwarmHealth";
import {
  DockerSwarmTaskCount,
  formatDockerSwarmCpus,
  getDockerSwarmModeBadge,
  getDockerSwarmRoleBadge,
  getDockerSwarmRollbackBadge,
  shortDockerSwarmContainerId,
} from "../../../Pages/DockerSwarm/Utils/DockerSwarmPartFacts";
import { formatBytes } from "../../../Pages/DockerSwarm/Utils/DockerSwarmResourceUtils";

/*
 * The top of a Docker Swarm node's, service's or task's page, above its
 * tabs: which part it is, how it is doing by the swarm's rules, where it
 * sits (its stack, its service, its node - each one step away), and the
 * facts a Swarm administrator looks for first: a node's role, CPUs and
 * memory, a service's mode and its tasks running, a task's slot and
 * container. An image's name is a Details row, where a long one breaks
 * after its slashes. The shared ResourcePartHero draws it.
 */

export interface ComponentProps {
  kind: DockerSwarmPartKind;
  // The part's inventory row; null while it has not reported.
  row: DockerSwarmResource | null;
  externalId: string;
  clusterName: string;
  clusterRoute: Route;
  getPartRoute: (kind: DockerSwarmPartKind, externalId: string) => Route;
  // The node's or the service's current tasks, for its "running" chip.
  taskCount?: DockerSwarmTaskCount | undefined;
  // The external ids of the parts a task sits in, when the inventory has them.
  serviceExternalId?: string | undefined;
  nodeExternalId?: string | undefined;
  now: Date;
}

const STATUS_DESCRIPTIONS: Record<DockerSwarmPartKind, string> = {
  Node: DOCKER_SWARM_METRIC_DESCRIPTIONS.nodeStatus,
  Service: DOCKER_SWARM_METRIC_DESCRIPTIONS.serviceStatus,
  Task: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskStatus,
};

const ICONS: Record<DockerSwarmPartKind, IconProp> = {
  Node: IconProp.Server,
  Service: IconProp.SquareStack,
  Task: IconProp.QueueList,
};

const ACCENTS: Record<DockerSwarmPartKind, ResourcePartAccent> = {
  Node: "sky",
  Service: "indigo",
  Task: "emerald",
};

const LINK_CLASS_NAME: string =
  "font-medium text-gray-700 hover:text-indigo-600 hover:underline";

const DockerSwarmPartHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const row: DockerSwarmResource | null = props.row;

  const slashIndex: number = props.externalId.indexOf("/");
  const idTail: string =
    slashIndex >= 0
      ? props.externalId.substring(slashIndex + 1)
      : props.externalId;
  const name: string = row ? getDockerSwarmDisplayName(row) : idTail;

  const assessment: DockerSwarmAssessment | null = row
    ? assessDockerSwarmResource(row, props.now)
    : null;
  const status: ResourcePartStatus | undefined = assessment
    ? { ...assessment.status, description: STATUS_DESCRIPTIONS[props.kind] }
    : undefined;

  const badges: Array<ResourcePartBadge> = [];
  const chips: Array<ResourcePartChip> = [];

  const clusterLink: ReactElement = (
    <Link to={props.clusterRoute} className={LINK_CLASS_NAME}>
      {props.clusterName}
    </Link>
  );

  let location: ReactElement | undefined = undefined;

  const pushTasks: () => void = (): void => {
    if (props.taskCount && props.taskCount.total > 0) {
      chips.push({
        key: "tasks",
        icon: IconProp.QueueList,
        label: translator.translatePlural(
          {
            one: "{{running}}/{{count}} task running",
            other: "{{running}}/{{count}} tasks running",
          },
          props.taskCount.total,
          // In the reader's digits, as the count beside it is.
          { running: translator.formatNumber(props.taskCount.running) },
        ),
      });
    }
  };

  if (props.kind === "Node") {
    location = (
      <TranslatedSentence
        template="Node of swarm {{cluster}}"
        slots={{ cluster: clusterLink }}
      />
    );
    if (row) {
      badges.push(getDockerSwarmRoleBadge(row));
    }
    pushTasks();
    const cpus: number | null = toDockerSwarmNumber(
      row ? getDockerSwarmAttribute(row, "cpus") : null,
    );
    if (cpus !== null && cpus > 0) {
      chips.push({
        key: "cpus",
        icon: IconProp.CPUChip,
        label: translator.translatePlural(
          { one: "{{count}} CPU", other: "{{count}} CPUs" },
          Number(formatDockerSwarmCpus(cpus)),
        ),
      });
    }
    const memory: number | null = toDockerSwarmNumber(
      row ? getDockerSwarmAttribute(row, "memoryBytes") : null,
    );
    if (memory !== null && memory > 0) {
      chips.push({
        key: "memory",
        icon: IconProp.SquareStack,
        label: translator.translateTemplate("{{size}} memory", {
          size: formatBytes(memory),
        }),
      });
    }
    const engineVersion: string = row
      ? getDockerSwarmAttribute(row, "engineVersion")
      : "";
    if (engineVersion) {
      chips.push({
        key: "engine",
        icon: IconProp.Info,
        label: translator.translateTemplate("Docker {{version}}", {
          version: engineVersion,
        }),
      });
    }
  } else if (props.kind === "Service") {
    location = row?.stackName ? (
      <TranslatedSentence
        template="Service of stack {{stack}} in swarm {{cluster}}"
        slots={{
          stack: <bdi>{row.stackName}</bdi>,
          cluster: clusterLink,
        }}
      />
    ) : (
      <TranslatedSentence
        template="Service of swarm {{cluster}}"
        slots={{ cluster: clusterLink }}
      />
    );
    if (row) {
      const mode: ResourcePartBadge | null = getDockerSwarmModeBadge(row);
      if (mode) {
        badges.push(mode);
      }
      const rollback: ResourcePartBadge | null =
        getDockerSwarmRollbackBadge(row);
      if (rollback) {
        badges.push(rollback);
      }
    }
    pushTasks();
  } else {
    const serviceName: string = row?.serviceName || "";
    const nodeName: string = row?.nodeHostname || "";
    const serviceLink: ReactElement | null = serviceName ? (
      props.serviceExternalId ? (
        <Link
          to={props.getPartRoute("Service", props.serviceExternalId)}
          className={LINK_CLASS_NAME}
        >
          <bdi>{serviceName}</bdi>
        </Link>
      ) : (
        <bdi>{serviceName}</bdi>
      )
    ) : null;
    const nodeLink: ReactElement | null = nodeName ? (
      props.nodeExternalId ? (
        <Link
          to={props.getPartRoute("Node", props.nodeExternalId)}
          className={LINK_CLASS_NAME}
        >
          <bdi>{nodeName}</bdi>
        </Link>
      ) : (
        <bdi>{nodeName}</bdi>
      )
    ) : null;

    if (serviceLink && nodeLink) {
      location = (
        <TranslatedSentence
          template="Task of service {{service}} on node {{node}}"
          slots={{ service: serviceLink, node: nodeLink }}
        />
      );
    } else if (serviceLink) {
      location = (
        <TranslatedSentence
          template="Task of service {{service}} in swarm {{cluster}}"
          slots={{ service: serviceLink, cluster: clusterLink }}
        />
      );
    } else {
      location = (
        <TranslatedSentence
          template="Task of swarm {{cluster}}"
          slots={{ cluster: clusterLink }}
        />
      );
    }

    const slot: string = row ? getDockerSwarmAttribute(row, "slot") : "";
    if (slot) {
      chips.push({
        key: "slot",
        icon: IconProp.Hashtag,
        label: translator.translateTemplate("Slot {{slot}}", { slot: slot }),
      });
    }
    const containerId: string = row
      ? getDockerSwarmAttribute(row, "containerId")
      : "";
    if (containerId) {
      chips.push({
        key: "container",
        icon: IconProp.Square2Stack,
        label: translator.translateTemplate("Container {{id}}", {
          id: shortDockerSwarmContainerId(containerId),
        }),
      });
    }
  }

  return (
    <ResourcePartHero
      testId={`docker-swarm-${props.kind.toLowerCase()}-hero`}
      icon={ICONS[props.kind]}
      accent={ACCENTS[props.kind]}
      name={name}
      status={status}
      badges={badges}
      location={location}
      lastReportAt={toDockerSwarmDate(row?.lastSeenAt)}
      chips={chips}
    />
  );
};

export default DockerSwarmPartHero;
