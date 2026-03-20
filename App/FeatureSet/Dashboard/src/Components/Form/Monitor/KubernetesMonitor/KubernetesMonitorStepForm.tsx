import MonitorStepKubernetesMonitor, {
  MonitorStepKubernetesMonitorUtil,
  KubernetesResourceScope,
} from "Common/Types/Monitor/MonitorStepKubernetesMonitor";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import MetricView from "../../../Metrics/MetricView";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RollingTimePicker from "Common/UI/Components/RollingTimePicker/RollingTimePicker";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input from "Common/UI/Components/Input/Input";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import API from "Common/UI/Utils/API/API";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

export interface ComponentProps {
  monitorStepKubernetesMonitor: MonitorStepKubernetesMonitor;
  onChange: (
    monitorStepKubernetesMonitor: MonitorStepKubernetesMonitor,
  ) => void;
}

const resourceScopeOptions: Array<DropdownOption> = [
  {
    label: "Cluster",
    value: KubernetesResourceScope.Cluster,
  },
  {
    label: "Namespace",
    value: KubernetesResourceScope.Namespace,
  },
  {
    label: "Workload",
    value: KubernetesResourceScope.Workload,
  },
  {
    label: "Node",
    value: KubernetesResourceScope.Node,
  },
  {
    label: "Pod",
    value: KubernetesResourceScope.Pod,
  },
];

const KubernetesMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rollingTime, setRollingTime] = React.useState<RollingTime | null>(
    null,
  );

  const monitorStepKubernetesMonitor: MonitorStepKubernetesMonitor =
    props.monitorStepKubernetesMonitor ||
    MonitorStepKubernetesMonitorUtil.getDefault();

  const [startAndEndTime, setStartAndEndTime] =
    React.useState<InBetween<Date> | null>(null);

  const [clusterOptions, setClusterOptions] = React.useState<
    Array<DropdownOption>
  >([]);

  const [_isLoadingClusters, setIsLoadingClusters] =
    React.useState<boolean>(true);

  useEffect(() => {
    // Load clusters
    setIsLoadingClusters(true);
    ModelAPI.getList<KubernetesCluster>({
      modelType: KubernetesCluster,
      query: {},
      select: {
        _id: true,
        name: true,
        clusterIdentifier: true,
      },
      sort: {
        name: SortOrder.Ascending,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    })
      .then((result: ListResult<KubernetesCluster>) => {
        const options: Array<DropdownOption> = result.data.map(
          (cluster: KubernetesCluster) => {
            return {
              label: cluster.name || cluster.clusterIdentifier || "Unknown",
              value: cluster.clusterIdentifier || "",
            };
          },
        );
        setClusterOptions(options);
      })
      .catch((err: Error) => {
        // If error, provide empty options
        setClusterOptions([]);
        API.getFriendlyErrorMessage(err);
      })
      .finally(() => {
        setIsLoadingClusters(false);
      });
  }, []);

  useEffect(() => {
    if (rollingTime === monitorStepKubernetesMonitor.rollingTime) {
      return;
    }

    setRollingTime(monitorStepKubernetesMonitor.rollingTime);

    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepKubernetesMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, [monitorStepKubernetesMonitor.rollingTime]);

  useEffect(() => {
    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepKubernetesMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, []);

  const showNamespaceFilter: boolean =
    monitorStepKubernetesMonitor.resourceScope ===
      KubernetesResourceScope.Namespace ||
    monitorStepKubernetesMonitor.resourceScope ===
      KubernetesResourceScope.Workload ||
    monitorStepKubernetesMonitor.resourceScope ===
      KubernetesResourceScope.Pod;

  const showWorkloadFilter: boolean =
    monitorStepKubernetesMonitor.resourceScope ===
    KubernetesResourceScope.Workload;

  const showNodeFilter: boolean =
    monitorStepKubernetesMonitor.resourceScope ===
    KubernetesResourceScope.Node;

  const showPodFilter: boolean =
    monitorStepKubernetesMonitor.resourceScope ===
    KubernetesResourceScope.Pod;

  return (
    <div>
      <FieldLabelElement
        title="Kubernetes Cluster"
        description={"Select the Kubernetes cluster to monitor."}
        required={true}
      />
      <Dropdown
        options={clusterOptions}
        value={clusterOptions.find(
          (option: DropdownOption) =>
            option.value === monitorStepKubernetesMonitor.clusterIdentifier,
        )}
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          props.onChange({
            ...monitorStepKubernetesMonitor,
            clusterIdentifier: (value as string) || "",
          });
        }}
        placeholder="Select a cluster..."
      />

      <div className="mt-3"></div>

      <FieldLabelElement
        title="Resource Scope"
        description={"Select the scope of resources to monitor."}
        required={true}
      />
      <Dropdown
        options={resourceScopeOptions}
        value={resourceScopeOptions.find(
          (option: DropdownOption) =>
            option.value === monitorStepKubernetesMonitor.resourceScope,
        )}
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          props.onChange({
            ...monitorStepKubernetesMonitor,
            resourceScope:
              (value as KubernetesResourceScope) ||
              KubernetesResourceScope.Cluster,
            resourceFilters: {},
          });
        }}
        placeholder="Select resource scope..."
      />

      {showNamespaceFilter && (
        <div className="mt-3">
          <FieldLabelElement
            title="Namespace"
            description={"Filter by namespace (optional)."}
            required={false}
          />
          <Input
            value={monitorStepKubernetesMonitor.resourceFilters.namespace || ""}
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepKubernetesMonitor,
                resourceFilters: {
                  ...monitorStepKubernetesMonitor.resourceFilters,
                  namespace: value || undefined,
                },
              });
            }}
            placeholder="e.g. default, production"
          />
        </div>
      )}

      {showWorkloadFilter && (
        <div className="mt-3">
          <FieldLabelElement
            title="Workload Name"
            description={"Filter by workload name (optional)."}
            required={false}
          />
          <Input
            value={
              monitorStepKubernetesMonitor.resourceFilters.workloadName || ""
            }
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepKubernetesMonitor,
                resourceFilters: {
                  ...monitorStepKubernetesMonitor.resourceFilters,
                  workloadName: value || undefined,
                },
              });
            }}
            placeholder="e.g. my-deployment"
          />
        </div>
      )}

      {showNodeFilter && (
        <div className="mt-3">
          <FieldLabelElement
            title="Node Name"
            description={"Filter by node name (optional)."}
            required={false}
          />
          <Input
            value={monitorStepKubernetesMonitor.resourceFilters.nodeName || ""}
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepKubernetesMonitor,
                resourceFilters: {
                  ...monitorStepKubernetesMonitor.resourceFilters,
                  nodeName: value || undefined,
                },
              });
            }}
            placeholder="e.g. node-1"
          />
        </div>
      )}

      {showPodFilter && (
        <div className="mt-3">
          <FieldLabelElement
            title="Pod Name"
            description={"Filter by pod name (optional)."}
            required={false}
          />
          <Input
            value={monitorStepKubernetesMonitor.resourceFilters.podName || ""}
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepKubernetesMonitor,
                resourceFilters: {
                  ...monitorStepKubernetesMonitor.resourceFilters,
                  podName: value || undefined,
                },
              });
            }}
            placeholder="e.g. my-pod-abc123"
          />
        </div>
      )}

      <div className="mt-3"></div>

      <FieldLabelElement
        title="Time Range"
        description={"Select the time range for the Kubernetes monitor."}
        required={true}
      />
      <RollingTimePicker
        value={monitorStepKubernetesMonitor.rollingTime}
        onChange={(value: RollingTime) => {
          if (value === monitorStepKubernetesMonitor.rollingTime) {
            return;
          }

          props.onChange({
            ...monitorStepKubernetesMonitor,
            rollingTime: value,
          });
        }}
      />

      <div className="mt-3"></div>

      <FieldLabelElement
        title="Select Metrics"
        description={
          "Select the Kubernetes metrics to monitor. Common metrics include k8s.pod.cpu.utilization, k8s.node.memory.usage, k8s.deployment.available_replicas, etc."
        }
        required={true}
      />

      <div className="mt-3"></div>

      <MetricView
        hideStartAndEndDate={true}
        data={{
          startAndEndDate: startAndEndTime,
          queryConfigs:
            monitorStepKubernetesMonitor.metricViewConfig.queryConfigs,
          formulaConfigs:
            monitorStepKubernetesMonitor.metricViewConfig.formulaConfigs,
        }}
        hideCardInQueryElements={true}
        hideCardInCharts={true}
        chartCssClass="rounded-md border border-gray-200 mt-2 shadow-none"
        onChange={(data: MetricViewData) => {
          props.onChange({
            ...monitorStepKubernetesMonitor,
            metricViewConfig: {
              queryConfigs: data.queryConfigs,
              formulaConfigs: data.formulaConfigs,
            },
          });
        }}
      />
    </div>
  );
};

export default KubernetesMonitorStepForm;
