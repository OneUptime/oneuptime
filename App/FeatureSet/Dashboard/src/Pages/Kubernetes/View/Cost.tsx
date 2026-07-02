import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Card from "Common/UI/Components/Card/Card";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import LocalTable from "Common/UI/Components/Table/LocalTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import type Columns from "Common/UI/Components/Table/Types/Columns";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ExpandableText from "Common/UI/Components/ExpandableText/ExpandableText";

interface CostPricing {
  cpuPerCoreHour: number;
  memoryPerGbHour: number;
  isDefaultPricing: boolean;
}

interface CostTotals {
  cpuRequestCores: number;
  memoryRequestGb: number;
  estimatedMonthlyCost: number;
}

interface NamespaceCostRow {
  namespace: string;
  podCount: number;
  cpuRequestCores: number;
  memoryRequestGb: number;
  estimatedMonthlyCost: number;
}

interface WorkloadCostRow {
  kind: string;
  name: string;
  namespace: string;
  podCount: number;
  cpuRequestCores: number;
  memoryRequestGb: number;
  estimatedMonthlyCost: number;
}

interface RightsizingRow {
  workloadKind: string;
  workloadName: string;
  namespace: string;
  containerName: string;
  podCount: number;
  requestedCpuCores: number;
  requestedMemoryGb: number;
  p95CpuCores: number | null;
  p95MemoryGb: number | null;
  suggestedCpuCores: number | null;
  suggestedMemoryGb: number | null;
  vpaTargetCpuCores: number | null;
  vpaTargetMemoryBytes: number | null;
  estimatedMonthlySavings: number;
  suggestion: string;
}

interface CostReport {
  windowHours: number;
  currencyCode: string;
  pricing: CostPricing;
  totals: CostTotals;
  byNamespace: Array<NamespaceCostRow>;
  topWorkloads: Array<WorkloadCostRow>;
  rightsizing: Array<RightsizingRow>;
}

const WINDOW_OPTIONS: Array<DropdownOption> = [
  { label: "Last 24 hours", value: 24 },
  { label: "Last 72 hours", value: 72 },
  { label: "Last 7 days", value: 168 },
];

function readNumber(obj: JSONObject, key: string): number {
  const value: unknown = obj[key];
  return typeof value === "number" && isFinite(value) ? value : 0;
}

function readNullableNumber(obj: JSONObject, key: string): number | null {
  const value: unknown = obj[key];
  return typeof value === "number" && isFinite(value) ? value : null;
}

function readString(obj: JSONObject, key: string): string {
  const value: unknown = obj[key];
  return typeof value === "string" ? value : "";
}

function parseCostReport(data: JSONObject): CostReport {
  const pricingObj: JSONObject = (data["pricing"] as JSONObject) || {};
  const totalsObj: JSONObject = (data["totals"] as JSONObject) || {};

  const byNamespaceRaw: unknown = data["byNamespace"];
  const byNamespace: Array<NamespaceCostRow> = Array.isArray(byNamespaceRaw)
    ? byNamespaceRaw.map((item: unknown): NamespaceCostRow => {
        const row: JSONObject = (item as JSONObject) || {};
        return {
          namespace: readString(row, "namespace"),
          podCount: readNumber(row, "podCount"),
          cpuRequestCores: readNumber(row, "cpuRequestCores"),
          memoryRequestGb: readNumber(row, "memoryRequestGb"),
          estimatedMonthlyCost: readNumber(row, "estimatedMonthlyCost"),
        };
      })
    : [];

  const topWorkloadsRaw: unknown = data["topWorkloads"];
  const topWorkloads: Array<WorkloadCostRow> = Array.isArray(topWorkloadsRaw)
    ? topWorkloadsRaw.map((item: unknown): WorkloadCostRow => {
        const row: JSONObject = (item as JSONObject) || {};
        return {
          kind: readString(row, "kind"),
          name: readString(row, "name"),
          namespace: readString(row, "namespace"),
          podCount: readNumber(row, "podCount"),
          cpuRequestCores: readNumber(row, "cpuRequestCores"),
          memoryRequestGb: readNumber(row, "memoryRequestGb"),
          estimatedMonthlyCost: readNumber(row, "estimatedMonthlyCost"),
        };
      })
    : [];

  const rightsizingRaw: unknown = data["rightsizing"];
  const rightsizing: Array<RightsizingRow> = Array.isArray(rightsizingRaw)
    ? rightsizingRaw.map((item: unknown): RightsizingRow => {
        const row: JSONObject = (item as JSONObject) || {};
        return {
          workloadKind: readString(row, "workloadKind"),
          workloadName: readString(row, "workloadName"),
          namespace: readString(row, "namespace"),
          containerName: readString(row, "containerName"),
          podCount: readNumber(row, "podCount"),
          requestedCpuCores: readNumber(row, "requestedCpuCores"),
          requestedMemoryGb: readNumber(row, "requestedMemoryGb"),
          p95CpuCores: readNullableNumber(row, "p95CpuCores"),
          p95MemoryGb: readNullableNumber(row, "p95MemoryGb"),
          suggestedCpuCores: readNullableNumber(row, "suggestedCpuCores"),
          suggestedMemoryGb: readNullableNumber(row, "suggestedMemoryGb"),
          vpaTargetCpuCores: readNullableNumber(row, "vpaTargetCpuCores"),
          vpaTargetMemoryBytes: readNullableNumber(row, "vpaTargetMemoryBytes"),
          estimatedMonthlySavings: readNumber(row, "estimatedMonthlySavings"),
          suggestion: readString(row, "suggestion"),
        };
      })
    : [];

  rightsizing.sort((a: RightsizingRow, b: RightsizingRow) => {
    return b.estimatedMonthlySavings - a.estimatedMonthlySavings;
  });

  return {
    windowHours: readNumber(data, "windowHours"),
    currencyCode: readString(data, "currencyCode") || "USD",
    pricing: {
      cpuPerCoreHour: readNumber(pricingObj, "cpuPerCoreHour"),
      memoryPerGbHour: readNumber(pricingObj, "memoryPerGbHour"),
      isDefaultPricing: pricingObj["isDefaultPricing"] === true,
    },
    totals: {
      cpuRequestCores: readNumber(totalsObj, "cpuRequestCores"),
      memoryRequestGb: readNumber(totalsObj, "memoryRequestGb"),
      estimatedMonthlyCost: readNumber(totalsObj, "estimatedMonthlyCost"),
    },
    byNamespace: byNamespace,
    topWorkloads: topWorkloads,
    rightsizing: rightsizing,
  };
}

function formatMoney(value: number, currencyCode: string): string {
  return `${value.toFixed(2)} ${currencyCode}`;
}

function formatRate(value: number): string {
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".0");
}

function formatCores(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, ".0");
}

function formatGb(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return `${value.toFixed(2)} GiB`;
}

function formatBytesAsGb(bytes: number | null): string {
  if (bytes === null) {
    return "—";
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

const KubernetesClusterCost: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [isClusterLoading, setIsClusterLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [windowHours, setWindowHours] = useState<number>(24);
  const [report, setReport] = useState<CostReport | null>(null);
  const [isReportLoading, setIsReportLoading] = useState<boolean>(true);
  const [reportError, setReportError] = useState<string>("");

  // Pricing edit form state.
  const [cpuPriceInput, setCpuPriceInput] = useState<string>("");
  const [memoryPriceInput, setMemoryPriceInput] = useState<string>("");
  const [currencyInput, setCurrencyInput] = useState<string>("");
  const [isSavingPricing, setIsSavingPricing] = useState<boolean>(false);
  const [pricingError, setPricingError] = useState<string>("");

  const fetchCluster: PromiseVoidFunction = async (): Promise<void> => {
    setIsClusterLoading(true);
    try {
      const item: KubernetesCluster | null = await ModelAPI.getItem({
        modelType: KubernetesCluster,
        id: modelId,
        select: {
          clusterIdentifier: true,
          costPerCpuCoreHour: true,
          costPerGbMemoryHour: true,
          currencyCode: true,
        },
      });

      if (!item) {
        setError("Cluster not found.");
        setIsClusterLoading(false);
        return;
      }

      setCpuPriceInput(
        item.costPerCpuCoreHour !== undefined &&
          item.costPerCpuCoreHour !== null
          ? String(item.costPerCpuCoreHour)
          : "",
      );
      setMemoryPriceInput(
        item.costPerGbMemoryHour !== undefined &&
          item.costPerGbMemoryHour !== null
          ? String(item.costPerGbMemoryHour)
          : "",
      );
      setCurrencyInput(item.currencyCode || "");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsClusterLoading(false);
  };

  const loadReport: (hours: number) => Promise<void> = async (
    hours: number,
  ): Promise<void> => {
    setIsReportLoading(true);
    setReportError("");
    try {
      const reportUrl: URL = URL.fromString(APP_API_URL.toString())
        .addRoute("/kubernetes-cluster/cost-report/")
        .addRoute(modelId.toString());

      const reportResponse: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: reportUrl,
          data: {
            windowHours: hours,
          },
          headers: {
            ...ModelAPI.getCommonHeaders(),
          },
        });

      if (reportResponse instanceof HTTPErrorResponse) {
        throw reportResponse;
      }

      setReport(parseCostReport(reportResponse.data));
    } catch (err) {
      setReportError(API.getFriendlyMessage(err));
    }
    setIsReportLoading(false);
  };

  const savePricing: PromiseVoidFunction = async (): Promise<void> => {
    setIsSavingPricing(true);
    setPricingError("");
    try {
      const cpuPrice: number = parseFloat(cpuPriceInput);
      const memoryPrice: number = parseFloat(memoryPriceInput);

      await ModelAPI.updateById({
        modelType: KubernetesCluster,
        id: modelId,
        data: {
          costPerCpuCoreHour:
            cpuPriceInput.trim() && !isNaN(cpuPrice) ? cpuPrice : null,
          costPerGbMemoryHour:
            memoryPriceInput.trim() && !isNaN(memoryPrice) ? memoryPrice : null,
          currencyCode: currencyInput.trim() || null,
        },
      });

      await loadReport(windowHours);
    } catch (err) {
      setPricingError(API.getFriendlyMessage(err));
    }
    setIsSavingPricing(false);
  };

  useEffect(() => {
    fetchCluster().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  useEffect(() => {
    loadReport(windowHours).catch((err: Error) => {
      setReportError(API.getFriendlyMessage(err));
    });
  }, [windowHours]);

  if (isClusterLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const currencyCode: string = report?.currencyCode || "USD";

  const totalPotentialSavings: number = (report?.rightsizing || []).reduce(
    (sum: number, row: RightsizingRow) => {
      return sum + row.estimatedMonthlySavings;
    },
    0,
  );

  const namespaceColumns: Columns<NamespaceCostRow> = [
    {
      title: "Namespace",
      type: FieldType.Element,
      key: "namespace",
      getElement: (row: NamespaceCostRow): ReactElement => {
        return (
          <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700">
            {row.namespace || "default"}
          </span>
        );
      },
    },
    {
      title: "Pods",
      type: FieldType.Number,
      key: "podCount",
    },
    {
      title: "CPU Requests (cores)",
      type: FieldType.Element,
      key: "cpuRequestCores",
      getElement: (row: NamespaceCostRow): ReactElement => {
        return (
          <span className="text-gray-900">
            {formatCores(row.cpuRequestCores)}
          </span>
        );
      },
    },
    {
      title: "Memory Requests",
      type: FieldType.Element,
      key: "memoryRequestGb",
      getElement: (row: NamespaceCostRow): ReactElement => {
        return (
          <span className="text-gray-900">{formatGb(row.memoryRequestGb)}</span>
        );
      },
    },
    {
      title: "Est. Monthly Cost",
      type: FieldType.Element,
      key: "estimatedMonthlyCost",
      getElement: (row: NamespaceCostRow): ReactElement => {
        return (
          <span className="font-medium text-gray-900">
            {formatMoney(row.estimatedMonthlyCost, currencyCode)}
          </span>
        );
      },
    },
  ];

  const workloadColumns: Columns<WorkloadCostRow> = [
    {
      title: "Workload",
      type: FieldType.Element,
      key: "name",
      getElement: (row: WorkloadCostRow): ReactElement => {
        return (
          <div>
            <span className="text-gray-900">
              {row.kind} {row.name}
            </span>
            {row.namespace ? (
              <span className="ml-2 inline-flex px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700">
                {row.namespace}
              </span>
            ) : (
              <></>
            )}
          </div>
        );
      },
    },
    {
      title: "Pods",
      type: FieldType.Number,
      key: "podCount",
    },
    {
      title: "CPU Requests (cores)",
      type: FieldType.Element,
      key: "cpuRequestCores",
      getElement: (row: WorkloadCostRow): ReactElement => {
        return (
          <span className="text-gray-900">
            {formatCores(row.cpuRequestCores)}
          </span>
        );
      },
    },
    {
      title: "Memory Requests",
      type: FieldType.Element,
      key: "memoryRequestGb",
      getElement: (row: WorkloadCostRow): ReactElement => {
        return (
          <span className="text-gray-900">{formatGb(row.memoryRequestGb)}</span>
        );
      },
    },
    {
      title: "Est. Monthly Cost",
      type: FieldType.Element,
      key: "estimatedMonthlyCost",
      getElement: (row: WorkloadCostRow): ReactElement => {
        return (
          <span className="font-medium text-gray-900">
            {formatMoney(row.estimatedMonthlyCost, currencyCode)}
          </span>
        );
      },
    },
  ];

  const rightsizingColumns: Columns<RightsizingRow> = [
    {
      title: "Workload",
      type: FieldType.Element,
      key: "workloadName",
      getElement: (row: RightsizingRow): ReactElement => {
        return (
          <div>
            <span className="text-gray-900">
              {row.workloadKind} {row.workloadName}
            </span>
            {row.namespace ? (
              <span className="ml-2 inline-flex px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700">
                {row.namespace}
              </span>
            ) : (
              <></>
            )}
          </div>
        );
      },
    },
    {
      title: "Container",
      type: FieldType.Text,
      key: "containerName",
    },
    {
      title: "CPU (requested → P95)",
      type: FieldType.Element,
      key: "requestedCpuCores",
      getElement: (row: RightsizingRow): ReactElement => {
        return (
          <span className="text-gray-900 whitespace-nowrap">
            {formatCores(row.requestedCpuCores)} →{" "}
            {formatCores(row.p95CpuCores)}
          </span>
        );
      },
    },
    {
      title: "Memory (requested → P95)",
      type: FieldType.Element,
      key: "requestedMemoryGb",
      getElement: (row: RightsizingRow): ReactElement => {
        return (
          <span className="text-gray-900 whitespace-nowrap">
            {formatGb(row.requestedMemoryGb)} → {formatGb(row.p95MemoryGb)}
          </span>
        );
      },
    },
    {
      title: "Suggestion",
      type: FieldType.Element,
      key: "suggestion",
      getElement: (row: RightsizingRow): ReactElement => {
        return (
          <div>
            <ExpandableText text={row.suggestion || "-"} maxLength={100} />
            {row.vpaTargetCpuCores !== null ||
            row.vpaTargetMemoryBytes !== null ? (
              <div className="text-xs text-gray-500 mt-1">
                VPA target: {formatCores(row.vpaTargetCpuCores)} cores /{" "}
                {formatBytesAsGb(row.vpaTargetMemoryBytes)}
              </div>
            ) : (
              <></>
            )}
          </div>
        );
      },
    },
    {
      title: "Est. Monthly Savings",
      type: FieldType.Element,
      key: "estimatedMonthlySavings",
      getElement: (row: RightsizingRow): ReactElement => {
        return (
          <span
            className={`font-medium ${
              row.estimatedMonthlySavings > 0
                ? "text-emerald-700"
                : "text-gray-500"
            }`}
          >
            {formatMoney(row.estimatedMonthlySavings, currencyCode)}
          </span>
        );
      },
    },
  ];

  return (
    <Fragment>
      {/* Time window selector */}
      <div className="flex items-center justify-end mb-4">
        <span className="text-sm text-gray-600 mr-3">Usage window</span>
        <div className="w-48">
          <Dropdown
            id="kubernetes-cost-window-dropdown"
            options={WINDOW_OPTIONS}
            value={WINDOW_OPTIONS.find((option: DropdownOption) => {
              return option.value === windowHours;
            })}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (typeof value === "number") {
                setWindowHours(value);
              }
            }}
          />
        </div>
      </div>

      {isReportLoading ? (
        <Card
          title="Cost Report"
          description="Crunching request inventory and usage percentiles — this can take a few seconds."
        >
          <ComponentLoader />
        </Card>
      ) : reportError ? (
        <ErrorMessage message={reportError} />
      ) : report ? (
        <Fragment>
          {/* Headline cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-5">
            <InfoCard
              title="Est. Monthly Cost"
              value={formatMoney(
                report.totals.estimatedMonthlyCost,
                currencyCode,
              )}
              textClassName="text-2xl font-semibold text-gray-900"
            />
            <InfoCard
              title="CPU Requests"
              value={`${formatCores(report.totals.cpuRequestCores)} cores`}
              textClassName="text-2xl font-semibold text-gray-900"
            />
            <InfoCard
              title="Memory Requests"
              value={formatGb(report.totals.memoryRequestGb)}
              textClassName="text-2xl font-semibold text-gray-900"
            />
            <InfoCard
              title="Pricing"
              value={
                <div>
                  <div className="text-sm text-gray-900">
                    {formatRate(report.pricing.cpuPerCoreHour)} {currencyCode}
                    /core-hr
                  </div>
                  <div className="text-sm text-gray-900">
                    {formatRate(report.pricing.memoryPerGbHour)} {currencyCode}
                    /GB-hr
                  </div>
                  {report.pricing.isDefaultPricing && (
                    <div className="text-xs text-gray-500 mt-1">
                      (estimated defaults)
                    </div>
                  )}
                </div>
              }
            />
          </div>

          {/* Pricing configuration */}
          <div className="mb-5">
            <Card
              title="Pricing Configuration"
              description="Set your provider's prices to make this report accurate. Leave blank to use estimated defaults."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 items-end">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cost per CPU core hour
                  </label>
                  <Input
                    type={InputType.NUMBER}
                    value={cpuPriceInput}
                    placeholder="e.g. 0.032"
                    onChange={(value: string) => {
                      setCpuPriceInput(value);
                    }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cost per GB memory hour
                  </label>
                  <Input
                    type={InputType.NUMBER}
                    value={memoryPriceInput}
                    placeholder="e.g. 0.004"
                    onChange={(value: string) => {
                      setMemoryPriceInput(value);
                    }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Currency code
                  </label>
                  <Input
                    type={InputType.TEXT}
                    value={currencyInput}
                    placeholder="USD"
                    onChange={(value: string) => {
                      setCurrencyInput(value);
                    }}
                  />
                </div>
              </div>
              <div className="mt-4">
                <Button
                  title="Save Pricing"
                  buttonStyle={ButtonStyleType.PRIMARY}
                  isLoading={isSavingPricing}
                  onClick={() => {
                    savePricing().catch(() => {});
                  }}
                />
              </div>
              {pricingError ? <ErrorMessage message={pricingError} /> : <></>}
            </Card>
          </div>

          {/* Cost by namespace */}
          <div className="mb-5">
            <Card
              title="Cost by Namespace"
              description="Estimated monthly cost from resource requests, per namespace."
            >
              {report.byNamespace.length === 0 ? (
                <div className="text-gray-500 text-sm p-4">
                  No namespace cost data available yet. Costs appear once the
                  kubernetes-agent reports pod resource requests.
                </div>
              ) : (
                <LocalTable<NamespaceCostRow>
                  id="kubernetes-cost-namespace-table"
                  data={report.byNamespace}
                  columns={namespaceColumns}
                  singularLabel="Namespace"
                  pluralLabel="Namespaces"
                />
              )}
            </Card>
          </div>

          {/* Top workloads */}
          <div className="mb-5">
            <Card
              title="Top Workloads"
              description="The most expensive workloads in this cluster by estimated monthly cost."
            >
              {report.topWorkloads.length === 0 ? (
                <div className="text-gray-500 text-sm p-4">
                  No workload cost data available yet.
                </div>
              ) : (
                <LocalTable<WorkloadCostRow>
                  id="kubernetes-cost-workload-table"
                  data={report.topWorkloads}
                  columns={workloadColumns}
                  singularLabel="Workload"
                  pluralLabel="Workloads"
                />
              )}
            </Card>
          </div>

          {/* Rightsizing recommendations */}
          <div className="mb-5">
            <Card
              title="Rightsizing Recommendations"
              description={`Requested vs observed (P95) usage over the selected window. Total potential savings: ${formatMoney(
                totalPotentialSavings,
                currencyCode,
              )}/month.`}
            >
              {report.rightsizing.length === 0 ? (
                <div className="text-gray-500 text-sm p-4">
                  No rightsizing recommendations available. Recommendations
                  appear once usage metrics have been collected for the
                  cluster&apos;s workloads.
                </div>
              ) : (
                <LocalTable<RightsizingRow>
                  id="kubernetes-cost-rightsizing-table"
                  data={report.rightsizing}
                  columns={rightsizingColumns}
                  singularLabel="Recommendation"
                  pluralLabel="Recommendations"
                />
              )}
            </Card>
          </div>
        </Fragment>
      ) : (
        <ErrorMessage message="No cost report available." />
      )}
    </Fragment>
  );
};

export default KubernetesClusterCost;
