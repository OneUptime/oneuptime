import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  KubernetesContainerAssessment,
  assessKubernetesContainer,
} from "Common/Types/Kubernetes/KubernetesHealth";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import ResourcePartHero from "../../ResourcePart/ResourcePartHero";
import {
  ResourcePartBadge,
  ResourcePartChip,
} from "../../ResourcePart/ResourcePartTypes";
import {
  KUBERNETES_CURRENT_PART_LABELS,
  getKubernetesKindIcon,
} from "../../../Pages/Kubernetes/Utils/KubernetesAttention";
import {
  KUBERNETES_CONTAINER_ATTENTION_DESCRIPTION,
  getKubernetesContainerAttentionItems,
  getKubernetesContainerKey,
} from "../../../Pages/Kubernetes/Utils/KubernetesContainerFacts";
import {
  KubernetesPartRead,
  KubernetesPartRow,
  toResourcePartStatus,
} from "../../../Pages/Kubernetes/Utils/KubernetesPartFacts";
import { KubernetesPartRoutes } from "../../../Pages/Kubernetes/Utils/KubernetesPartRoutes";

/*
 * The top of a container's own page: its name, how it is doing in
 * Kubernetes' own word - "CrashLoopBackOff", "Error, exit code 1",
 * "Running" - the pod, namespace and node it runs in, each a step away,
 * its restarts, and when its pod last reported. When it needs attention,
 * its status opens why: how its last run ended, Kubernetes' message, since
 * when (#9595). The pod's own read holds all of it (useKubernetesPart).
 */

export interface ComponentProps {
  name: string;
  // The pod it runs in, as the page's address names it.
  pod: string;
  namespace?: string | undefined;
  // The pod's own read; null while it loads.
  read: KubernetesPartRead | null;
  routes: KubernetesPartRoutes;
}

function toDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  const date: Date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

const KubernetesContainerHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const pod: KubernetesPartRow | null = props.read?.part || null;
  const assessment: KubernetesContainerAssessment | null = pod
    ? assessKubernetesContainer(pod, { name: props.name })
    : null;
  const namespace: string = pod?.namespaceKey || props.namespace || "";
  const podName: string = pod?.name || props.pod;
  const spec: Record<string, unknown> =
    pod?.spec && typeof pod.spec === "object"
      ? (pod.spec as Record<string, unknown>)
      : {};
  const nodeName: string =
    typeof spec["nodeName"] === "string" ? (spec["nodeName"] as string) : "";

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

  const podLink: ReactElement = linkTo(
    props.routes.getPartRoute({
      kind: "Pod",
      name: podName,
      namespace: namespace,
    }),
    podName,
  );
  const namespaceLink: ReactElement = linkTo(
    props.routes.getPartRoute({ kind: "Namespace", name: namespace }),
    namespace,
  );

  const location: ReactElement | undefined =
    podName && namespace ? (
      nodeName ? (
        <TranslatedSentence
          template="Container of pod {{pod}} in namespace {{namespace}}, on node {{node}}"
          slots={{
            pod: podLink,
            namespace: namespaceLink,
            node: linkTo(
              props.routes.getPartRoute({ kind: "Node", name: nodeName }),
              nodeName,
            ),
          }}
        />
      ) : (
        <TranslatedSentence
          template="Container of pod {{pod}} in namespace {{namespace}}"
          slots={{ pod: podLink, namespace: namespaceLink }}
        />
      )
    ) : undefined;

  const badges: Array<ResourcePartBadge> = [];
  if (assessment?.isInit) {
    // It runs, and must end, before the pod's other containers start.
    badges.push({
      key: "init",
      label: translationKey("Init container"),
      tone: "neutral",
    });
  }

  const chips: Array<ResourcePartChip> = [];
  if (assessment && assessment.restarts > 0) {
    chips.push({
      key: "restarts",
      icon: IconProp.Refresh,
      label: translator.translatePlural(
        { one: "{{count}} restart", other: "{{count}} restarts" },
        assessment.restarts,
      ),
    });
  }

  const currentLabel: string | undefined =
    KUBERNETES_CURRENT_PART_LABELS["Container"];

  return (
    <ResourcePartHero
      testId="kubernetes-container-hero"
      icon={getKubernetesKindIcon("Container")}
      accent="violet"
      name={assessment?.container || props.name}
      status={assessment ? toResourcePartStatus(assessment) : undefined}
      badges={badges}
      location={location}
      lastReportAt={toDate(pod?.lastSeenAt)}
      chips={chips}
      attention={
        pod
          ? {
              items: getKubernetesContainerAttentionItems({
                pod: pod,
                assessment: assessment,
                routeFor: props.routes.getPartRoute,
              }),
              description: KUBERNETES_CONTAINER_ATTENTION_DESCRIPTION,
              current: currentLabel
                ? {
                    key: getKubernetesContainerKey(
                      pod,
                      assessment?.container || props.name,
                    ),
                    label: currentLabel,
                  }
                : undefined,
              showKind: false,
            }
          : undefined
      }
    />
  );
};

export default KubernetesContainerHero;
