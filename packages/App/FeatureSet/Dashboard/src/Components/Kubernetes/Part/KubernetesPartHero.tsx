import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import {
  KubernetesHealthAssessment,
  KubernetesObjectRef,
  getKubernetesJobCronJob,
  getKubernetesPodWorkload,
  kubernetesObjectKey,
} from "Common/Types/Kubernetes/KubernetesHealth";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import Route from "Common/Types/API/Route";
import ResourcePartHero from "../../ResourcePart/ResourcePartHero";
import {
  ResourcePartAttention,
  ResourcePartBadge,
  ResourcePartChip,
} from "../../ResourcePart/ResourcePartTypes";
import {
  KUBERNETES_CURRENT_PART_LABELS,
  getKubernetesKindIcon,
} from "../../../Pages/Kubernetes/Utils/KubernetesAttention";
import {
  KUBERNETES_PART_COPY,
  KubernetesPartRead,
  KubernetesPartRow,
  assessKubernetesPart,
  getKubernetesNamespaceAttention,
  getKubernetesPartAttentionItems,
  getKubernetesPodFacts,
  KubernetesPodFacts,
  toResourcePartStatus,
} from "../../../Pages/Kubernetes/Utils/KubernetesPartFacts";
import { KubernetesPartRoutes } from "../../../Pages/Kubernetes/Utils/KubernetesPartRoutes";
import KubernetesResourceUtils from "../../../Pages/Kubernetes/Utils/KubernetesResourceUtils";
import {
  KubernetesNamespaceCountChip,
  getKubernetesCronJobFailedRunsChip,
  getKubernetesJobFailedPodsAttention,
  getKubernetesNamespaceCountChips,
} from "../../../Pages/Kubernetes/Utils/KubernetesPartCounts";
import {
  KubernetesProblemRowsLoader,
  getKubernetesProblemRowsLoader,
} from "../../../Pages/Kubernetes/Utils/KubernetesProblemLoader";

/*
 * The top of a Kubernetes object's page, above its tabs: what it is, how it
 * is doing in Kubernetes' own words ("CrashLoopBackOff", "1 of 3
 * available"), where it sits - its namespace, its node, the workload it
 * belongs to, each one step away - when the agent last reported it, and the
 * facts a reader looks for first. The shared ResourcePartHero draws it; the
 * status comes from the cluster's own rules (KubernetesPartFacts), so it
 * says what the Overview's Needs attention says.
 */

export interface ComponentProps {
  kind: string;
  // The name the page's address carries, until the object is read.
  name: string;
  /*
   * The namespace the page's address carries: where the object sits says
   * so while it loads, and when its read fails.
   */
  namespace?: string | undefined;
  read: KubernetesPartRead | null;
  clusterName: string;
  routes: KubernetesPartRoutes;
  /*
   * The agent's name for the cluster, which its Events are stamped with: a
   * count's dialog reads its pods' latest warnings when it opens. Left
   * out, it lists them as the read has them.
   */
  clusterIdentifier?: string | undefined;
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function readNumber(source: Json, key: string): number | null {
  const value: unknown = source[key];
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number: number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readString(source: Json, key: string): string {
  const value: unknown = source[key];
  return typeof value === "string" ? value : "";
}

function toDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  const date: Date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

const KubernetesPartHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const row: KubernetesPartRow | null = props.read?.part || null;
  const spec: Json = asObject(row?.spec);
  const status: Json = asObject(row?.status);
  const namespace: string = row?.namespaceKey || props.namespace || "";

  const assessment: KubernetesHealthAssessment | null = props.read
    ? assessKubernetesPart(props.read)
    : null;

  const badges: Array<ResourcePartBadge> = [];
  const chips: Array<ResourcePartChip> = [];

  const linkClassName: string =
    "font-medium text-gray-700 hover:text-indigo-600 hover:underline";

  const linkTo: (route: Route | undefined, label: string) => ReactElement = (
    route: Route | undefined,
    label: string,
  ): ReactElement => {
    return route ? (
      <Link to={route} className={linkClassName}>
        <bdi>{label}</bdi>
      </Link>
    ) : (
      <bdi className="font-medium text-gray-700">{label}</bdi>
    );
  };

  const clusterLink: ReactElement = linkTo(
    props.routes.clusterRoute,
    props.clusterName,
  );
  const namespaceLink: ReactElement = linkTo(
    props.routes.getPartRoute({ kind: "Namespace", name: namespace }),
    namespace,
  );

  const pushCount: (
    key: string,
    icon: IconProp,
    forms: { one: string; other: string },
    count: number | null,
  ) => void = (
    key: string,
    icon: IconProp,
    forms: { one: string; other: string },
    count: number | null,
  ): void => {
    if (count !== null && count > 0) {
      chips.push({
        key: key,
        icon: icon,
        label: translator.translatePlural(forms, count),
      });
    }
  };

  let location: ReactElement | undefined = undefined;

  // A count's pods, with their latest warnings, read when its dialog opens.
  const loadRows: KubernetesProblemRowsLoader | undefined =
    props.clusterIdentifier
      ? getKubernetesProblemRowsLoader({
          clusterIdentifier: props.clusterIdentifier,
          routeFor: props.routes.getPartRoute,
        })
      : undefined;

  if (props.kind === "Namespace") {
    location = (
      <TranslatedSentence
        template="Namespace of cluster {{cluster}}"
        slots={{ cluster: clusterLink }}
      />
    );
    /*
     * What in it needs attention, in two counts that open exactly what
     * they count (#9595): its workloads, each once, and its pods.
     */
    if (props.read) {
      const countChips: Array<KubernetesNamespaceCountChip> =
        getKubernetesNamespaceCountChips({
          attention: getKubernetesNamespaceAttention({
            read: props.read,
            routeFor: props.routes.getPartRoute,
          }),
          translator: translator,
          routeFor: props.routes.getPartRoute,
          loadRows: loadRows,
        });
      for (const chip of countChips) {
        chips.push({
          key: chip.key,
          icon: chip.key === "pods" ? IconProp.Circle : IconProp.Layers,
          label: chip.label,
          attention: chip.attention,
        });
      }
    }
  } else if (props.kind === "Node") {
    location = (
      <TranslatedSentence
        template="Node of cluster {{cluster}}"
        slots={{ cluster: clusterLink }}
      />
    );
    /*
     * Cordoned: the status says so when nothing is wrong; beside a problem
     * ("Not ready") a badge does.
     */
    const isCordoned: boolean =
      spec["unschedulable"] === true || spec["unschedulable"] === "true";
    if (isCordoned && assessment?.status.text !== "Scheduling disabled") {
      badges.push({
        key: "cordoned",
        label: "Scheduling disabled",
        tone: "neutral",
      });
    }
    pushCount(
      "pods",
      IconProp.Circle,
      { one: "{{count}} pod", other: "{{count}} pods" },
      props.read ? props.read.pods.length : null,
    );
    const capacity: Json = asObject(status["capacity"]);
    const cores: number | null = readNumber(capacity, "cpu");
    pushCount(
      "cores",
      IconProp.CPUChip,
      { one: "{{count}} core", other: "{{count}} cores" },
      cores,
    );
    const memory: string = readString(capacity, "memory");
    const memoryBytes: number = memory
      ? KubernetesResourceUtils.parseK8sMemoryToBytes(memory)
      : 0;
    if (memoryBytes > 0) {
      chips.push({
        key: "memory",
        icon: IconProp.SquareStack,
        label: translator.translateTemplate("{{size}} memory", {
          size: KubernetesResourceUtils.formatMemoryValue(memoryBytes),
        }),
      });
    }
    const kubelet: string = readString(
      asObject(status["nodeInfo"]),
      "kubeletVersion",
    );
    if (kubelet) {
      chips.push({
        key: "kubelet",
        icon: IconProp.Kubernetes,
        label: translator.translateTemplate("Kubelet {{version}}", {
          version: kubelet,
        }),
      });
    }
  } else if (props.kind === "Pod") {
    const facts: KubernetesPodFacts | null = row
      ? getKubernetesPodFacts(row)
      : null;
    const workload: { kind: string; name: string; namespace: string } | null =
      row ? getKubernetesPodWorkload(row) : null;
    const nodeLink: ReactElement | null = facts?.nodeName
      ? linkTo(
          props.routes.getPartRoute({ kind: "Node", name: facts.nodeName }),
          facts.nodeName,
        )
      : null;
    const ownerLink: ReactElement | null = workload
      ? linkTo(
          props.routes.getPartRoute({
            kind: workload.kind,
            name: workload.name,
            namespace: workload.namespace,
          }),
          `${workload.kind} ${workload.name}`,
        )
      : null;

    if (namespace) {
      location = ownerLink ? (
        nodeLink ? (
          <TranslatedSentence
            template="Pod of {{owner}} in namespace {{namespace}}, on node {{node}}"
            slots={{
              owner: ownerLink,
              namespace: namespaceLink,
              node: nodeLink,
            }}
          />
        ) : (
          <TranslatedSentence
            template="Pod of {{owner}} in namespace {{namespace}}, not on a node yet"
            slots={{ owner: ownerLink, namespace: namespaceLink }}
          />
        )
      ) : nodeLink ? (
        <TranslatedSentence
          template="In namespace {{namespace}}, on node {{node}}"
          slots={{ namespace: namespaceLink, node: nodeLink }}
        />
      ) : (
        <TranslatedSentence
          template="In namespace {{namespace}} of cluster {{cluster}}"
          slots={{ namespace: namespaceLink, cluster: clusterLink }}
        />
      );
    }

    if (facts && facts.ready) {
      const [ready, total] = facts.ready.split("/");
      chips.push({
        key: "ready",
        icon: IconProp.Cube,
        label: translator.translatePlural(
          {
            one: "{{ready}}/{{count}} container ready",
            other: "{{ready}}/{{count}} containers ready",
          },
          Number(total),
          // In the reader's digits, as the count beside it is.
          { ready: translator.formatNumber(Number(ready)) },
        ),
      });
    }
    pushCount(
      "restarts",
      IconProp.Refresh,
      { one: "{{count}} restart", other: "{{count}} restarts" },
      facts ? facts.restarts : null,
    );
    const qosClass: string = readString(status, "qosClass");
    if (qosClass) {
      chips.push({
        key: "qos",
        icon: IconProp.Scale,
        label: translator.translateTemplate("QoS {{class}}", {
          class: qosClass,
        }),
      });
    }
  } else {
    /*
     * A CronJob's run says whose run it is, one step from the CronJob's
     * page, as a pod says its workload: "Run of CronJob nightly-report in
     * namespace shop".
     */
    const cronJob: KubernetesObjectRef | null =
      props.kind === "Job" && row ? getKubernetesJobCronJob(row) : null;

    if (namespace) {
      location = cronJob ? (
        <TranslatedSentence
          template="Run of {{owner}} in namespace {{namespace}}"
          slots={{
            owner: linkTo(
              props.routes.getPartRoute({
                kind: "CronJob",
                name: cronJob.name,
                namespace: cronJob.namespace,
              }),
              `CronJob ${cronJob.name}`,
            ),
            namespace: namespaceLink,
          }}
        />
      ) : (
        <TranslatedSentence
          template="In namespace {{namespace}} of cluster {{cluster}}"
          slots={{ namespace: namespaceLink, cluster: clusterLink }}
        />
      );
    }

    if (props.kind === "DaemonSet") {
      pushCount(
        "nodes",
        IconProp.Server,
        { one: "Runs on {{count}} node", other: "Runs on {{count}} nodes" },
        readNumber(status, "desiredNumberScheduled"),
      );
    } else if (props.kind === "CronJob") {
      const schedule: string = readString(spec, "schedule");
      if (schedule) {
        chips.push({
          key: "schedule",
          icon: IconProp.Clock,
          label: translator.translateTemplate("Schedule {{schedule}}", {
            schedule: schedule,
          }),
        });
      }
      pushCount(
        "runs",
        IconProp.Play,
        { one: "{{count}} run kept", other: "{{count}} runs kept" },
        props.read ? props.read.jobs.length : null,
      );
      // Its runs that failed, each with why Kubernetes stopped it.
      const failedRuns: ReturnType<typeof getKubernetesCronJobFailedRunsChip> =
        props.read
          ? getKubernetesCronJobFailedRunsChip({
              read: props.read,
              translator: translator,
              routeFor: props.routes.getPartRoute,
            })
          : null;
      if (failedRuns) {
        chips.push({
          key: "failedRuns",
          icon: IconProp.Close,
          label: failedRuns.label,
          attention: failedRuns.attention,
        });
      }
    } else if (props.kind === "Job") {
      pushCount(
        "succeeded",
        IconProp.Check,
        { one: "{{count}} pod succeeded", other: "{{count}} pods succeeded" },
        readNumber(status, "succeeded"),
      );
      /*
       * Its failed pods open which and why - each one's container, exit
       * code and since when - where the chip only said how many (#9595).
       */
      const failed: number | null = readNumber(status, "failed");
      if (failed !== null && failed > 0) {
        chips.push({
          key: "failed",
          icon: IconProp.Close,
          label: translator.translatePlural(
            { one: "{{count}} pod failed", other: "{{count}} pods failed" },
            failed,
          ),
          attention: props.read
            ? getKubernetesJobFailedPodsAttention({
                read: props.read,
                translator: translator,
                routeFor: props.routes.getPartRoute,
                loadRows: loadRows,
              })
            : undefined,
        });
      }
    } else {
      pushCount(
        "replicas",
        IconProp.Layers,
        { one: "{{count}} replica", other: "{{count}} replicas" },
        readNumber(spec, "replicas"),
      );
    }

    if (props.kind !== "Job" && props.kind !== "CronJob") {
      pushCount(
        "pods",
        IconProp.Circle,
        { one: "{{count}} pod", other: "{{count}} pods" },
        props.read ? props.read.pods.length : null,
      );
    }
  }

  /*
   * What its Needs attention card lists - it and the pods it runs - which
   * its status opens when it says something is wrong: "CrashLoopBackOff"
   * says which container, its exit code and since when, a step from here.
   */
  const currentLabel: string | undefined =
    KUBERNETES_CURRENT_PART_LABELS[props.kind];
  const attention: ResourcePartAttention | undefined = props.read
    ? {
        items: getKubernetesPartAttentionItems({
          read: props.read,
          routeFor: props.routes.getPartRoute,
        }),
        description: KUBERNETES_PART_COPY[props.kind]?.attentionDescription,
        current:
          row && currentLabel
            ? {
                key: kubernetesObjectKey(
                  row.kind || props.kind,
                  row.namespaceKey || "",
                  row.name || "",
                ),
                label: currentLabel,
              }
            : undefined,
      }
    : undefined;

  return (
    <ResourcePartHero
      testId={`kubernetes-${props.kind.toLowerCase()}-hero`}
      icon={getKubernetesKindIcon(props.kind)}
      accent="violet"
      name={row?.name || props.name}
      status={assessment ? toResourcePartStatus(assessment) : undefined}
      badges={badges}
      location={location}
      lastReportAt={toDate(row?.lastSeenAt)}
      chips={chips}
      attention={attention}
    />
  );
};

export default KubernetesPartHero;
