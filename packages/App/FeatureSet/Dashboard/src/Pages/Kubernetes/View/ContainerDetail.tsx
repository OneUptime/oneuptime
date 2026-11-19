import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import KubernetesContainerModel from "Common/Models/DatabaseModels/KubernetesContainer";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import MetricQueryConfigData, {
  ChartSeries,
} from "Common/Types/Metrics/MetricQueryConfigData";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import CardListSkeleton from "Common/UI/Components/Skeleton/CardListSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import EmptyState, {
  EmptyStateSize,
} from "Common/UI/Components/EmptyState/EmptyState";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import IconProp from "Common/Types/Icon/IconProp";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import AggregateModel from "Common/Types/BaseDatabase/AggregatedModel";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import {
  KubernetesContainerSpec,
  KubernetesContainerStatus,
} from "Common/Types/Kubernetes/KubernetesObjectParser";
import KubernetesMetricsTab from "../../../Components/Kubernetes/KubernetesMetricsTab";
import KubernetesLogsTab from "../../../Components/Kubernetes/KubernetesLogsTab";
import KubernetesContainersTab from "../../../Components/Kubernetes/KubernetesContainersTab";
import KubernetesContainerHero from "../../../Components/Kubernetes/Part/KubernetesContainerHero";
import ResourcePartRow from "../../../Components/ResourcePart/ResourcePartRow";
import KubernetesResourceUtils from "../Utils/KubernetesResourceUtils";
import KubernetesCpuUtils, {
  NodeAllocatableCpu,
} from "../Utils/KubernetesCpuUtils";
import useNodeAllocatableCpu from "../Utils/useNodeAllocatableCpu";
import useKubernetesPart, {
  KubernetesPartState,
} from "../Utils/UseKubernetesPart";
import {
  KubernetesPartRoutes,
  getKubernetesContainerRoute,
  getKubernetesNamespaceParam,
  getKubernetesPartRoutes,
  getKubernetesPodParam,
} from "../Utils/KubernetesPartRoutes";
import { KubernetesPartRow } from "../Utils/KubernetesPartFacts";
import { getKubernetesContainerRowStatus } from "../Utils/KubernetesContainerFacts";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * A CONTAINER'S OWN PAGE.
 *
 * A container is named within its pod, so its address says whose
 * (`?pod=&namespace=`, KubernetesPartRoutes.getKubernetesContainerRoute):
 * the page reads that pod and says why the container is not running - its
 * waiting or terminated reason, exit code, how its last run ended, its
 * restarts and since when - in its hero, and everything Kubernetes reports
 * about it below. It used to say the container's name and its cluster, and
 * nothing a "NotReady" row of the Containers list was opened for (#9595).
 *
 * An older link names no pod: when one pod runs a container of that name,
 * it is that one; when several do, the page lists them to pick from.
 */

// The pods a name-only link offers, the ones in trouble first.
const CANDIDATE_LIMIT: number = 50;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray<T>(value: unknown): Array<T> {
  return Array.isArray(value) ? (value as Array<T>) : [];
}

const KubernetesClusterContainerDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const containerName: string = Navigation.getLastParamAsString();
  // Whose: the pod and namespace the address names.
  const podParam: string | undefined = getKubernetesPodParam();
  const namespaceParam: string | undefined = getKubernetesNamespaceParam();
  const listClassName: string = useCardRuledListClassName();

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  // The pods that run a container of this name, for a link that names none.
  const [candidates, setCandidates] =
    useState<Array<KubernetesContainerModel> | null>(null);
  const [candidatesError, setCandidatesError] = useState<string>("");

  const fetchCluster: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: KubernetesCluster | null = await ModelAPI.getItem({
        modelType: KubernetesCluster,
        id: modelId,
        select: {
          clusterIdentifier: true,
          /*
           * The name is display-only: the hero's link back and the Logs
           * tab's locked cluster chip read it instead of the identifier.
           */
          name: true,
        },
      });
      setCluster(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchCluster().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  useEffect(() => {
    if (podParam) {
      return;
    }
    ModelAPI.getList<KubernetesContainerModel>({
      modelType: KubernetesContainerModel,
      query: {
        kubernetesClusterId: modelId,
        name: containerName,
      },
      skip: 0,
      limit: CANDIDATE_LIMIT,
      select: {
        name: true,
        podName: true,
        podNamespaceKey: true,
        state: true,
        reason: true,
        isReady: true,
        restartCount: true,
      },
      sort: {
        isReady: SortOrder.Ascending,
        restartCount: SortOrder.Descending,
      },
    })
      .then((result: ListResult<KubernetesContainerModel>) => {
        setCandidates(result.data);
      })
      .catch((err: unknown) => {
        setCandidatesError(API.getFriendlyMessage(err));
        setCandidates([]);
      });
  }, [podParam, containerName]);

  // The pod the container is in: the address's, else the one pod running it.
  const onlyCandidate: KubernetesContainerModel | undefined =
    candidates && candidates.length === 1 ? candidates[0] : undefined;
  const pod: string | undefined =
    podParam || onlyCandidate?.podName || undefined;
  const namespace: string | undefined = podParam
    ? namespaceParam
    : onlyCandidate?.podNamespaceKey || undefined;

  // That pod as the cluster's rules read it: the container's status is in it.
  const partState: KubernetesPartState = useKubernetesPart({
    clusterId: modelId,
    kind: "Pod",
    name: pod || "",
    namespace: namespace,
  });
  const routes: KubernetesPartRoutes = getKubernetesPartRoutes(modelId);

  // Per-node allocatable CPU — denominator for the true CPU% transform.
  const allocatable: NodeAllocatableCpu | null = useNodeAllocatableCpu(
    cluster?.clusterIdentifier || undefined,
  );

  if (isLoading) {
    return <PageSkeleton />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cluster) {
    return <ErrorMessage message="Cluster not found." />;
  }

  const clusterIdentifier: string = cluster.clusterIdentifier || "";

  const getSeries: (data: AggregateModel) => ChartSeries = (
    data: AggregateModel,
  ): ChartSeries => {
    const attributes: Record<string, unknown> =
      (data["attributes"] as Record<string, unknown>) || {};
    const name: string =
      (attributes["resource.k8s.container.name"] as string) ||
      "Unknown Container";
    return { title: name };
  };

  // This container's series: its pod's, when the page knows the pod.
  const metricAttributes: Record<string, string> = {
    "resource.k8s.cluster.name": clusterIdentifier,
    "resource.k8s.container.name": containerName,
    ...(pod ? { "resource.k8s.pod.name": pod } : {}),
    ...(pod && namespace ? { "resource.k8s.namespace.name": namespace } : {}),
  };

  const cpuQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "container_cpu",
      title: translator.translateText("Container CPU Utilization"),
      description: translator.translateTemplate(
        "CPU utilization for container {{containerName}}",
        { containerName: containerName },
      ),
      legend: translator.translateText("CPU"),
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "container.cpu.utilization",
        attributes: metricAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    getSeries: getSeries,
    transformValue: KubernetesCpuUtils.makeCpuPercentTransform(allocatable),
  };

  const memoryQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "container_memory",
      title: translator.translateText("Container Memory Usage"),
      description: translator.translateTemplate(
        "Memory usage for container {{containerName}}",
        { containerName: containerName },
      ),
      legend: translator.translateText("Memory"),
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "container.memory.usage",
        attributes: metricAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    getSeries: getSeries,
    yAxisValueFormatter: KubernetesResourceUtils.formatBytesForChart,
  };

  /*
   * What Kubernetes reports about the container - its state, readiness,
   * restarts, why it waits and how its last run ended, its command, ports
   * and resources - as the pod's Containers tab draws it, for this one.
   */
  const renderContainer: () => ReactElement = (): ReactElement => {
    const row: KubernetesPartRow | null = partState.read?.part || null;

    if (partState.error && !row) {
      return (
        <ErrorMessage
          message={partState.error}
          onRefreshClick={partState.refresh}
        />
      );
    }

    if (partState.isLoading && !row) {
      return <CardListSkeleton count={1} lines={4} />;
    }

    const spec: Record<string, unknown> = asObject(row?.spec);
    const status: Record<string, unknown> = asObject(row?.status);
    const named: (container: { name?: string }) => boolean = (container: {
      name?: string;
    }): boolean => {
      return container.name === containerName;
    };

    return (
      <KubernetesContainersTab
        containers={asArray<KubernetesContainerSpec>(spec["containers"]).filter(
          named,
        )}
        initContainers={asArray<KubernetesContainerSpec>(
          spec["initContainers"],
        ).filter(named)}
        containerStatuses={asArray<KubernetesContainerStatus>(
          status["containerStatuses"],
        )}
        initContainerStatuses={asArray<KubernetesContainerStatus>(
          status["initContainerStatuses"],
        )}
      />
    );
  };

  /*
   * A link that names no pod, to a name several pods run: each of them,
   * the ones in trouble first, a step from its own container's page.
   */
  const renderCandidates: () => ReactElement = (): ReactElement => {
    if (candidatesError) {
      return <ErrorMessage message={candidatesError} />;
    }
    if (!candidates) {
      return <CardListSkeleton count={3} lines={1} />;
    }
    return (
      <Card
        title="Pods running this container"
        description="Every pod that runs a container of this name. Pick one to see why its container is not running."
      >
        {candidates.length === 0 ? (
          <EmptyState
            id="kubernetes-container-pods-empty"
            size={EmptyStateSize.Inline}
            icon={IconProp.Cube}
            title="No pod runs a container of this name now."
            description="It shows here once a pod runs it and the Kubernetes agent reports that pod."
          />
        ) : (
          <ul className={listClassName} data-testid="kubernetes-container-pods">
            {candidates.map(
              (candidate: KubernetesContainerModel): ReactElement => {
                const state: string =
                  getKubernetesContainerRowStatus(candidate);
                return (
                  <li
                    key={`${candidate.podNamespaceKey || ""}/${candidate.podName || ""}`}
                  >
                    <ResourcePartRow
                      dataTestId="kubernetes-container-pod"
                      to={getKubernetesContainerRoute(modelId, {
                        name: containerName,
                        pod: candidate.podName || "",
                        namespace: candidate.podNamespaceKey || "",
                      })}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1"
                    >
                      <span className="min-w-0 text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
                        <bdi>{candidate.podName}</bdi>
                      </span>
                      <span className="text-xs text-gray-500">
                        <bdi>{candidate.podNamespaceKey}</bdi>
                      </span>
                      {/*
                       * Running in the reader's word; Kubernetes' own
                       * ("CrashLoopBackOff") as it writes it.
                       */}
                      <Pill
                        text={state}
                        tone={
                          state === "Running"
                            ? PillTone.Success
                            : state === "Completed"
                              ? PillTone.Neutral
                              : PillTone.Warning
                        }
                      />
                    </ResourcePartRow>
                  </li>
                );
              },
            )}
          </ul>
        )}
      </Card>
    );
  };

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: pod ? renderContainer() : renderCandidates(),
    },
    {
      name: "Logs",
      children: (
        <Card
          title="Container Logs"
          description="Logs for this container in the selected time range (the past hour by default)."
        >
          {/*
           * Its pod's lines when the page knows the pod. Without one, the
           * empty podName is dropped from the filter (see
           * buildKubernetesLogsAttributeFilters), so the tab scopes by
           * cluster + container rather than asking for logs that carry no
           * pod name at all.
           */}
          <KubernetesLogsTab
            clusterIdentifier={clusterIdentifier}
            clusterName={cluster.name}
            podName={pod || ""}
            containerName={containerName}
            namespace={pod ? namespace : undefined}
          />
        </Card>
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={translator.translateTemplate(
            "Container Metrics: {{containerName}}",
            { containerName: containerName },
          )}
          description="CPU and memory usage for this container over the selected time range (the past hour by default)."
        >
          <KubernetesMetricsTab queryConfigs={[cpuQuery, memoryQuery]} />
        </Card>
      ),
    },
  ];

  return (
    <Fragment>
      {pod ? (
        <KubernetesContainerHero
          name={containerName}
          pod={pod}
          namespace={namespace}
          read={partState.read}
          routes={routes}
        />
      ) : (
        <></>
      )}
      <Tabs label="Container" tabs={tabs} onTabChange={() => {}} />
    </Fragment>
  );
};

export default KubernetesClusterContainerDetail;
