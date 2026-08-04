import ObjectID from "Common/Types/ObjectID";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Table from "Common/UI/Components/Table/Table";
import Column from "Common/UI/Components/Table/Types/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import API from "Common/UI/Utils/API/API";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  COST_ROWS_PER_PAGE,
  formatCost,
  pageCostRows,
  sortCostRows,
} from "../Utils/KubernetesCostUtils";
import { getNamespaceElement } from "../Utils/KubernetesCostTableCells";
import {
  RightSizingResult,
  RightSizingSummary,
  fetchRightSizingRecommendations,
} from "../Utils/KubernetesRightSizingUtils";
import {
  MIN_OBSERVED_HOURS,
  ResourceRecommendation,
  RightSizingRecommendation,
  RightSizingVerdict,
  formatCpuCores,
  formatMemoryBytes,
} from "Common/Types/Kubernetes/KubernetesRightSizing";

export interface ComponentProps {
  kubernetesClusterId: ObjectID;
  startDate: Date;
  endDate: Date;
  /** Bumped by the parent page's refresh control. */
  refreshToggle: number;
}

type ValueFormatter = (value: number | null) => string;

/*
 * The change cell is the whole point of the table, so it has to read at a
 * glance: what is set now, what it should be, and which direction that is.
 * Green means the request comes down (money back), amber means it goes up
 * (the workload is starved and someone should know before it OOMKills).
 */
function getRequestChangeElement(
  resource: ResourceRecommendation,
  format: ValueFormatter,
): ReactElement {
  if (resource.verdict === RightSizingVerdict.Unavailable) {
    return (
      <span
        className="text-gray-400"
        title={resource.unavailableReason || "Not enough data."}
      >
        -
      </span>
    );
  }

  if (resource.verdict === RightSizingVerdict.Optimal) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="tabular-nums text-gray-600">
          {format(resource.current)}
        </span>
        <span className="text-xs text-gray-400">right-sized</span>
      </span>
    );
  }

  const isIncrease: boolean =
    resource.verdict === RightSizingVerdict.Underprovisioned ||
    resource.verdict === RightSizingVerdict.NoRequestSet;

  const arrowClassName: string = isIncrease
    ? "text-amber-600"
    : "text-emerald-600";

  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      <span className="text-gray-400 line-through">
        {resource.current === null ? "none" : format(resource.current)}
      </span>
      <span className={arrowClassName}>&rarr;</span>
      <span className="font-medium text-gray-900">
        {format(resource.recommended)}
      </span>
    </span>
  );
}

/*
 * A saving only means something once it is a number someone can put in a
 * budget, so a container that offers none says why instead of showing $0:
 * an under-provisioned workload costs more to fix, and one with no request
 * set is a scheduling risk that happens not to be a billing one.
 */
function getSavingsElement(
  recommendation: RightSizingRecommendation,
): ReactElement {
  if (recommendation.estimatedMonthlySavings > 0) {
    return (
      <span className="tabular-nums font-medium text-emerald-700">
        {formatCost(recommendation.estimatedMonthlySavings)}
        <span className="ml-1 text-xs font-normal text-gray-400">/mo</span>
      </span>
    );
  }

  if (recommendation.estimatedMonthlyIncrease > 0) {
    return (
      <span className="tabular-nums text-amber-700">
        +{formatCost(recommendation.estimatedMonthlyIncrease)}
        <span className="ml-1 text-xs font-normal text-gray-400">/mo</span>
      </span>
    );
  }

  return <span className="text-gray-400">-</span>;
}

function getContainerElement(
  recommendation: RightSizingRecommendation,
): ReactElement {
  const controller: string = [
    recommendation.controllerKind,
    recommendation.controllerName,
  ]
    .filter(Boolean)
    .join(" / ");

  return (
    <div>
      <div className="font-medium text-gray-900">
        {recommendation.containerName}
      </div>
      {controller ? (
        <div className="text-xs text-gray-500">{controller}</div>
      ) : null}
    </div>
  );
}

const KubernetesRightSizingCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<RightSizingResult | null>(null);

  const [page, setPage] = useState<number>(1);
  const [sortBy, setSortBy] = useState<keyof RightSizingRecommendation | null>(
    "estimatedMonthlySavings",
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Descending);

  // Bumped by this card's own Refresh button, alongside the parent's toggle.
  const [localRefresh, setLocalRefresh] = useState<number>(0);

  const clusterId: string = props.kubernetesClusterId.toString();
  const startMs: number = props.startDate.getTime();
  const endMs: number = props.endDate.getTime();

  useEffect(() => {
    let cancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");
      try {
        const fetched: RightSizingResult =
          await fetchRightSizingRecommendations({
            kubernetesClusterId: props.kubernetesClusterId,
            startDate: new Date(startMs),
            endDate: new Date(endMs),
          });

        if (cancelled) {
          return;
        }

        setResult(fetched);
        setPage(1);
      } catch (err) {
        if (!cancelled) {
          setError(API.getFriendlyMessage(err));
        }
      }
      if (!cancelled) {
        setIsLoading(false);
      }
    };

    load().catch((err: Error) => {
      if (!cancelled) {
        setError(API.getFriendlyMessage(err));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [clusterId, startMs, endMs, props.refreshToggle, localRefresh]);

  const recommendations: Array<RightSizingRecommendation> = useMemo(() => {
    return result ? result.recommendations : [];
  }, [result]);

  const sortedRows: Array<RightSizingRecommendation> = useMemo(() => {
    return sortCostRows<RightSizingRecommendation>(
      recommendations,
      sortBy,
      sortOrder,
    );
  }, [recommendations, sortBy, sortOrder]);

  const pagedRows: Array<RightSizingRecommendation> = useMemo(() => {
    return pageCostRows<RightSizingRecommendation>(sortedRows, page);
  }, [sortedRows, page]);

  const columns: Array<Column<RightSizingRecommendation>> = useMemo(() => {
    return [
      {
        title: "Container",
        type: FieldType.Element,
        key: "containerName",
        getElement: getContainerElement,
      },
      {
        title: "Namespace",
        type: FieldType.Element,
        key: "namespace",
        getElement: (row: RightSizingRecommendation): ReactElement => {
          return getNamespaceElement(row.namespace);
        },
      },
      {
        title: "CPU Request",
        type: FieldType.Element,
        key: "cpu",
        disableSort: true,
        getElement: (row: RightSizingRecommendation): ReactElement => {
          return getRequestChangeElement(row.cpu, formatCpuCores);
        },
      },
      {
        title: "Memory Request",
        type: FieldType.Element,
        key: "memory",
        disableSort: true,
        getElement: (row: RightSizingRecommendation): ReactElement => {
          return getRequestChangeElement(row.memory, formatMemoryBytes);
        },
      },
      {
        title: "Est. Saving",
        type: FieldType.Element,
        key: "estimatedMonthlySavings",
        getElement: getSavingsElement,
      },
    ];
  }, []);

  const summary: RightSizingSummary | null = result ? result.summary : null;

  const refreshButton: CardButtonSchema = {
    title: "",
    buttonStyle: ButtonStyleType.ICON,
    className: "py-0 pr-0 pl-1 mt-1",
    onClick: () => {
      setLocalRefresh((toggle: number) => {
        return toggle + 1;
      });
    },
    icon: IconProp.Refresh,
  };

  const observedHours: number = result ? result.observedHours : 0;
  const isWindowTooShort: boolean =
    !isLoading && observedHours > 0 && observedHours < MIN_OBSERVED_HOURS;

  const noRecommendationsMessage: ReactElement = useMemo(() => {
    if (isWindowTooShort) {
      return (
        <span>
          Right-sizing needs at least {MIN_OBSERVED_HOURS} hours of cost data.
          Widen the time range above to see recommendations.
        </span>
      );
    }

    if (summary && summary.analyzedCount > 0) {
      return (
        <span>
          Every container in this window is already within 15% of its
          recommended request. Nothing to change.
        </span>
      );
    }

    return (
      <span>
        No container-level cost data in this window yet. Right-sizing reads the
        same allocation rows as the spend breakdowns above.
      </span>
    );
  }, [isWindowTooShort, summary]);

  if (error) {
    return (
      <Card
        title="Right-Sizing"
        description="Recommended CPU and memory requests, derived from what each container actually used."
      >
        <ErrorMessage message={error} />
      </Card>
    );
  }

  return (
    <Card
      title="Right-Sizing"
      description="Recommended CPU and memory requests per container, derived from observed demand: a P95 of CPU usage and the peak memory working set, each with 25% headroom."
      buttons={[refreshButton]}
    >
      <Fragment>
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <GoldenMetricTile
            title="Potential Saving"
            icon={IconProp.CurrencyDollar}
            iconColor="emerald"
            value={
              isLoading || !summary
                ? "—"
                : formatCost(summary.totalMonthlySavings)
            }
            sublabel="per month, if applied"
          />
          <GoldenMetricTile
            title="Over-provisioned"
            icon={IconProp.BarsArrowDown}
            iconColor="amber"
            value={
              isLoading || !summary ? "—" : `${summary.overprovisionedCount}`
            }
            sublabel="containers asking for too much"
          />
          <GoldenMetricTile
            title="Under-provisioned"
            icon={IconProp.BarsArrowUp}
            iconColor="violet"
            value={
              isLoading || !summary ? "—" : `${summary.underprovisionedCount}`
            }
            sublabel="throttle or OOM risk"
          />
          <GoldenMetricTile
            title="Analyzed"
            icon={IconProp.Cube}
            iconColor="slate"
            value={isLoading || !summary ? "—" : `${summary.analyzedCount}`}
            sublabel="containers with cost data"
          />
        </div>

        {/*
         * Only worth raising once the window is long enough to size anything.
         * On a short window every container looks unsized, and blaming that
         * on Prometheus would send people to fix config that is already fine.
         */}
        {!isLoading &&
        !isWindowTooShort &&
        summary &&
        summary.missingMemoryPeakCount > 0 &&
        summary.analyzedCount > 0 ? (
          <div className="mb-4">
            <Alert
              type={AlertType.INFO}
              strongTitle="Memory recommendations are partly unavailable"
              title={`${summary.missingMemoryPeakCount} of ${summary.analyzedCount} containers reported no memory peak, so their memory requests were left unsized. Peaks come from Prometheus — a memory request sized from an hourly average is how containers get OOMKilled, so we would rather say nothing. Set cost.engine.prometheusUrl on the agent to fill this in.`}
            />
          </div>
        ) : null}

        {!isLoading && summary && summary.noRequestSetCount > 0 ? (
          <div className="mb-4">
            <Alert
              type={AlertType.WARNING}
              strongTitle="Containers with no resource requests"
              title={`${summary.noRequestSetCount} containers run without a request set. They cost nothing extra today, but the scheduler cannot place them safely and they are first to be evicted under pressure.`}
            />
          </div>
        ) : null}

        <Table<RightSizingRecommendation>
          id="kubernetes-right-sizing-table"
          columns={columns}
          data={pagedRows}
          singularLabel="Recommendation"
          pluralLabel="Recommendations"
          isLoading={isLoading}
          error=""
          currentPageNumber={page}
          totalItemsCount={sortedRows.length}
          itemsOnPage={COST_ROWS_PER_PAGE}
          onNavigateToPage={(pageNumber: number) => {
            setPage(pageNumber);
          }}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSortChanged={(
            newSortBy: keyof RightSizingRecommendation | null,
            newSortOrder: SortOrder,
          ) => {
            setSortBy(newSortBy);
            setSortOrder(newSortOrder);
            setPage(1);
          }}
          noItemsMessage={noRecommendationsMessage}
        />
      </Fragment>
    </Card>
  );
};

export default KubernetesRightSizingCard;
