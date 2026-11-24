import AppLink from "../AppLink/AppLink";
import {
  NOT_EVALUATED,
  formatComplianceScore,
  getComplianceScoreClassName,
} from "../DataSecurity/ComplianceFrameworkTile";
import { formatMinutesAgo } from "../Inventory/InventoryLiveness";
import KUBERNETES_CLUSTER_ONBOARDING from "../Kubernetes/KubernetesClusterOnboarding";
import AddResourceModal from "../ResourceOnboarding/AddResourceModal";
import {
  downloadFleetComplianceCsv,
  downloadFleetComplianceJson,
} from "./KubernetesFleetComplianceExport";
import {
  FLEET_COMPLIANCE_ROWS_PER_PAGE,
  FLEET_COMPLIANCE_STATUS_LABELS,
  KubernetesFleetCluster,
  KubernetesFleetComplianceRow,
  KubernetesFleetComplianceStatus,
  KubernetesFleetFramework,
  NAME_SORT_KEY,
  WORKLOADS_SORT_KEY,
  filterFleetComplianceRows,
  getFailingControlKey,
  getFailingControls,
  getFleetFrameworks,
  getFrameworkSortKey,
  getFrameworkSummary,
  pageFleetComplianceRows,
  sortFleetComplianceRows,
  toFleetComplianceRow,
} from "./KubernetesFleetComplianceModel";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { findKubernetesComplianceControl } from "Common/Types/Kubernetes/Compliance/KubernetesComplianceCatalog";
import { isKubernetesComplianceFramework } from "Common/Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import {
  KubernetesComplianceFrameworkSummary,
  KubernetesComplianceSummaryFreshness,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceSummary";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Filter from "Common/UI/Components/Filters/Types/Filter";
import FilterData from "Common/UI/Components/Filters/Types/FilterData";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import Table from "Common/UI/Components/Table/Table";
import { TableEmptyStateKind } from "Common/UI/Components/Table/TableEmptyState";
import { getTableHeaderButtons } from "Common/UI/Components/Table/TableHeaderControls";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import Column from "Common/UI/Components/Table/Types/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * EVERY CLUSTER'S HARDENING ON ONE PAGE (#9876): Kubernetes > Compliance.
 *
 * A platform team with ten clusters had to open ten Compliance pages to
 * learn which one is furthest from Restricted. This lists every cluster
 * with each framework's score and how many of its controls fail, the lowest
 * score first, each linked to the cluster's own Compliance page. The Fails
 * filter answers "which clusters fail CIS 5.1.1?", and the export lists
 * every cluster's failing controls.
 *
 * Nothing is scored here: each cluster's record keeps the summary of its
 * last scoring (KubernetesCluster.complianceSummary), refreshed as its
 * agent's snapshots land and when its Compliance page is opened, and each
 * row says how fresh that is. Read with the reader's own permissions: a
 * cluster they may not read is not listed.
 */

export const KUBERNETES_FLEET_COMPLIANCE_TEST_ID: string =
  "kubernetes-fleet-compliance";

const TITLE: string = translationKey("Cluster Hardening");

const DESCRIPTION: string = translationKey(
  "Every cluster against the Pod Security Standards and the CIS Kubernetes Benchmark, the lowest score first. Scores refresh as each cluster's agent reports.",
);

const SCORED_AGO: string = translationKey("Scored {{age}}");

const SCORED_LATE: string = translationKey(
  "Scored {{age}}: later than it should be",
);

const AGENT_DISCONNECTED: string = translationKey(
  "Agent disconnected: scores from its last report",
);

const NOT_SCORED_YET: string = translationKey(
  "Not scored yet: scored once its agent reports",
);

const CONTROLS_FAILING: PluralTemplate = {
  one: translationKey("{{count}} control failing"),
  other: translationKey("{{count}} controls failing"),
};

const NO_CONTROL_FAILING: string = translationKey("No control failing");

const TURNED_OFF: string = translationKey("Turned off");

const NO_CLUSTERS_TITLE: string = translationKey("No Kubernetes clusters yet");

const NO_CLUSTERS_DESCRIPTION: string = translationKey(
  "Add a cluster to see how it stands against the Pod Security Standards and the CIS Kubernetes Benchmark, beside every other.",
);

// A cluster as the page reads it.
export function toFleetCluster(
  cluster: KubernetesCluster,
): KubernetesFleetCluster {
  return {
    id: cluster.id?.toString() || cluster._id?.toString() || "",
    name:
      cluster.name?.toString() ||
      cluster.clusterIdentifier?.toString() ||
      cluster.id?.toString() ||
      "",
    isConnected: cluster.otelCollectorStatus === "connected",
    lastSeenAt: cluster.lastSeenAt || null,
    complianceSummary: cluster.complianceSummary,
    complianceSummaryRefreshedAt: cluster.complianceSummaryRefreshedAt || null,
  };
}

// A failing control as the Fails filter names it, in the reader's words.
export function getFailingControlLabel(
  control: { framework: string; requirement: string; title: string },
  translator: Translator,
): string {
  const info: { title: string; isNumbered?: boolean | undefined } | undefined =
    isKubernetesComplianceFramework(control.framework)
      ? findKubernetesComplianceControl(control.framework, control.requirement)
      : undefined;
  const title: string = info
    ? translator.translateText(info.title) || info.title
    : control.title;

  return info && !info.isNumbered
    ? `${control.framework} · ${title}`
    : `${control.framework} ${control.requirement} · ${title}`;
}

function minutesSince(value: string | null, now: Date): number {
  if (!value) {
    return 0;
  }

  return Math.max(0, (now.getTime() - new Date(value).getTime()) / 60000);
}

// How fresh a cluster's scores are, under its name.
const Freshness: FunctionComponent<{
  row: KubernetesFleetComplianceRow;
  now: Date;
  translator: Translator;
}> = (props: {
  row: KubernetesFleetComplianceRow;
  now: Date;
  translator: Translator;
}): ReactElement => {
  const { row, translator } = props;

  switch (row.freshness) {
    case KubernetesComplianceSummaryFreshness.Missing:
      return (
        <p className="text-xs text-gray-500">
          {translator.translateText(NOT_SCORED_YET)}
        </p>
      );
    case KubernetesComplianceSummaryFreshness.Disconnected:
      return (
        <p className="text-xs text-amber-800">
          {translator.translateText(AGENT_DISCONNECTED)}
        </p>
      );
    case KubernetesComplianceSummaryFreshness.Late:
      return (
        <p className="text-xs text-amber-800">
          {translator.translateTemplate(SCORED_LATE, {
            age: formatMinutesAgo(
              minutesSince(row.refreshedAt, props.now),
              translator,
            ),
          })}
        </p>
      );
    default:
      return (
        <p className="text-xs text-gray-500">
          {translator.translateTemplate(SCORED_AGO, {
            age: formatMinutesAgo(
              minutesSince(row.refreshedAt, props.now),
              translator,
            ),
          })}
        </p>
      );
  }
};

// One framework's score on a cluster, and how many of its controls fail.
const FrameworkCell: FunctionComponent<{
  summary: KubernetesComplianceFrameworkSummary | undefined;
  translator: Translator;
}> = (props: {
  summary: KubernetesComplianceFrameworkSummary | undefined;
  translator: Translator;
}): ReactElement => {
  const { summary, translator } = props;

  if (!summary) {
    return <TableEmptyValue />;
  }

  if (summary.isTurnedOff) {
    return <Pill text={TURNED_OFF} tone={PillTone.Paused} />;
  }

  const failing: number = summary.failingControls.length;

  return (
    <div className="min-w-[7rem]">
      <div
        className={`text-base font-semibold tabular-nums ${getComplianceScoreClassName(
          summary.score,
        )}`}
      >
        {summary.score === null
          ? translator.translateText(NOT_EVALUATED)
          : formatComplianceScore(summary.score, translator)}
      </div>
      <div
        className={`text-xs ${failing > 0 ? "text-red-700" : "text-gray-500"}`}
      >
        {failing > 0
          ? translator.translatePlural(CONTROLS_FAILING, failing)
          : translator.translateText(NO_CONTROL_FAILING)}
      </div>
    </div>
  );
};

const KubernetesFleetComplianceSection: FunctionComponent =
  (): ReactElement => {
    const translator: Translator = useTranslator();
    const [clusters, setClusters] = useState<Array<KubernetesFleetCluster>>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>("");
    const [readCount, setReadCount] = useState<number>(0);
    const [readAt, setReadAt] = useState<Date>(OneUptimeDate.getCurrentDate());
    const [sortBy, setSortBy] = useState<string | null>(null);
    const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Ascending);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [pageSize, setPageSize] = useState<number>(
      FLEET_COMPLIANCE_ROWS_PER_PAGE,
    );
    const [filterData, setFilterData] = useState<
      FilterData<KubernetesFleetComplianceRow>
    >({});
    const [isFilterModalVisible, setIsFilterModalVisible] =
      useState<boolean>(false);
    const [isAddClusterOpen, setIsAddClusterOpen] = useState<boolean>(false);

    useEffect(() => {
      let isCurrent: boolean = true;

      setIsLoading(true);
      setError("");

      ModelAPI.getList<KubernetesCluster>({
        modelType: KubernetesCluster,
        query: { isArchived: false },
        select: {
          _id: true,
          name: true,
          clusterIdentifier: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          complianceSummary: true,
          complianceSummaryRefreshedAt: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        sort: { name: SortOrder.Ascending },
      })
        .then((result: ListResult<KubernetesCluster>) => {
          if (isCurrent) {
            setClusters(result.data.map(toFleetCluster));
            setReadAt(OneUptimeDate.getCurrentDate());
            setIsLoading(false);
          }
        })
        .catch((err: unknown) => {
          if (isCurrent) {
            setError(API.getFriendlyMessage(err));
            setIsLoading(false);
          }
        });

      return () => {
        isCurrent = false;
      };
    }, [readCount]);

    const rows: Array<KubernetesFleetComplianceRow> = useMemo(() => {
      return clusters.map((cluster: KubernetesFleetCluster) => {
        return toFleetComplianceRow(cluster, readAt);
      });
    }, [clusters, readAt]);

    const frameworks: Array<KubernetesFleetFramework> = useMemo(() => {
      return getFleetFrameworks(rows);
    }, [rows]);

    const filters: Array<Filter<KubernetesFleetComplianceRow>> = useMemo(() => {
      return [
        { title: "Cluster", key: "name", type: FieldType.Text },
        {
          title: "Status",
          key: "status",
          type: FieldType.MultiSelectDropdown,
          filterDropdownOptions: Object.values(
            KubernetesFleetComplianceStatus,
          ).map((status: KubernetesFleetComplianceStatus): DropdownOption => {
            return {
              value: status,
              label: FLEET_COMPLIANCE_STATUS_LABELS[status],
            };
          }),
        },
        {
          title: "Fails",
          key: "failingControlKeys",
          type: FieldType.MultiSelectDropdown,
          filterDropdownOptions: getFailingControls(rows).map(
            (control: {
              framework: string;
              requirement: string;
              title: string;
            }): DropdownOption => {
              return {
                value: getFailingControlKey(
                  control.framework,
                  control.requirement,
                ),
                // In the reader's words already: drawn as given.
                label: getFailingControlLabel(control, translator),
                isUserContent: true,
              };
            },
          ),
        },
      ];
    }, [rows, translator]);

    const filteredRows: Array<KubernetesFleetComplianceRow> = useMemo(() => {
      return filterFleetComplianceRows(
        rows,
        filterData as Record<string, unknown>,
      );
    }, [rows, filterData]);

    const sortedRows: Array<KubernetesFleetComplianceRow> = useMemo(() => {
      return sortFleetComplianceRows(filteredRows, sortBy, sortOrder);
    }, [filteredRows, sortBy, sortOrder]);

    const pagedRows: Array<KubernetesFleetComplianceRow> = useMemo(() => {
      return pageFleetComplianceRows(sortedRows, currentPage, pageSize);
    }, [sortedRows, currentPage, pageSize]);

    const columns: Array<Column<KubernetesFleetComplianceRow>> = [
      {
        title: "Cluster",
        key: NAME_SORT_KEY,
        type: FieldType.Element,
        getElement: (row: KubernetesFleetComplianceRow): ReactElement => {
          return (
            <div className="min-w-[10rem] space-y-0.5">
              <AppLink
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_COMPLIANCE] as Route,
                  { modelId: new ObjectID(row.clusterId) },
                )}
                className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
              >
                <span>{row.name}</span>
              </AppLink>
              <Freshness row={row} now={readAt} translator={translator} />
            </div>
          );
        },
      },
      ...frameworks.map(
        (
          framework: KubernetesFleetFramework,
        ): Column<KubernetesFleetComplianceRow> => {
          return {
            // A framework's name, as its tile names it: no word to look up.
            title: framework.framework,
            headerTooltip: framework.fullName,
            key: getFrameworkSortKey(framework.framework),
            type: FieldType.Element,
            firstSortOrder: SortOrder.Ascending,
            getElement: (row: KubernetesFleetComplianceRow): ReactElement => {
              return (
                <FrameworkCell
                  summary={getFrameworkSummary(row, framework.framework)}
                  translator={translator}
                />
              );
            },
          };
        },
      ),
      {
        title: "Workloads",
        key: WORKLOADS_SORT_KEY,
        type: FieldType.Element,
        hideOnMobile: true,
        getElement: (row: KubernetesFleetComplianceRow): ReactElement => {
          return row.workloadCount === null ? (
            <TableEmptyValue />
          ) : (
            <span className="tabular-nums text-gray-700">
              {translator.formatNumber(row.workloadCount)}
            </span>
          );
        },
      },
    ];

    /*
     * Export, Filter and Refresh live in the card's header, where every
     * table keeps them (getTableHeaderButtons). The exports write what the
     * filters keep, the worst first.
     */
    const cardButtons: Array<CardButtonSchema> = [
      {
        title: "Export CSV",
        icon: IconProp.Download,
        buttonStyle: ButtonStyleType.NORMAL,
        disabled: sortedRows.length === 0,
        onClick: () => {
          downloadFleetComplianceCsv(sortedRows);
        },
      },
      {
        title: "Export JSON",
        icon: IconProp.Download,
        buttonStyle: ButtonStyleType.OUTLINE,
        disabled: sortedRows.length === 0,
        onClick: () => {
          downloadFleetComplianceJson(sortedRows);
        },
      },
      {
        title: "Filter",
        buttonStyle: ButtonStyleType.ICON,
        icon: IconProp.Filter,
        onClick: () => {
          setIsFilterModalVisible(true);
        },
      },
      {
        title: "Refresh",
        buttonStyle: ButtonStyleType.ICON,
        icon: IconProp.Refresh,
        onClick: () => {
          setReadCount((count: number): number => {
            return count + 1;
          });
        },
      },
    ];

    return (
      <div data-testid={KUBERNETES_FLEET_COMPLIANCE_TEST_ID}>
        <Card
          title={TITLE}
          description={DESCRIPTION}
          headerLayout="toolbar"
          buttons={getTableHeaderButtons(cardButtons)}
        >
          <Table<KubernetesFleetComplianceRow>
            id="kubernetes-fleet-compliance-table"
            columns={columns}
            data={pagedRows}
            singularLabel="Cluster"
            pluralLabel="Clusters"
            isLoading={isLoading}
            error={error}
            onRefreshClick={
              error
                ? () => {
                    setReadCount((count: number): number => {
                      return count + 1;
                    });
                  }
                : undefined
            }
            currentPageNumber={currentPage}
            totalItemsCount={sortedRows.length}
            itemsOnPage={pageSize}
            onNavigateToPage={(pageNumber: number, itemsOnPage: number) => {
              setCurrentPage(pageNumber);
              if (itemsOnPage > 0) {
                setPageSize(itemsOnPage);
              }
            }}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSortChanged={(
              newSortBy: keyof KubernetesFleetComplianceRow | null,
              newSortOrder: SortOrder,
            ) => {
              setSortBy(newSortBy ? String(newSortBy) : null);
              setSortOrder(newSortOrder);
              setCurrentPage(1);
            }}
            filters={filters}
            filterData={filterData}
            showFilterModal={isFilterModalVisible}
            onFilterModalOpen={() => {
              setIsFilterModalVisible(true);
            }}
            onFilterModalClose={() => {
              setIsFilterModalVisible(false);
            }}
            onFilterChanged={(
              data: FilterData<KubernetesFleetComplianceRow>,
            ) => {
              setFilterData(data);
              setCurrentPage(1);
            }}
            emptyStateProps={
              rows.length === 0 && !error
                ? {
                    kind: TableEmptyStateKind.Empty,
                    icon: IconProp.ClipboardDocumentCheck,
                    title: NO_CLUSTERS_TITLE,
                    description: NO_CLUSTERS_DESCRIPTION,
                    actions: [
                      {
                        title: KUBERNETES_CLUSTER_ONBOARDING.addTitle,
                        icon: IconProp.Add,
                        onClick: () => {
                          setIsAddClusterOpen(true);
                        },
                      },
                    ],
                    dataTestId: `${KUBERNETES_FLEET_COMPLIANCE_TEST_ID}-empty`,
                  }
                : undefined
            }
          />
        </Card>
        {isAddClusterOpen ? (
          <AddResourceModal
            onboarding={KUBERNETES_CLUSTER_ONBOARDING}
            onClose={() => {
              setIsAddClusterOpen(false);
            }}
            onConnected={() => {
              setReadCount((count: number): number => {
                return count + 1;
              });
            }}
          />
        ) : (
          <></>
        )}
      </div>
    );
  };

export default KubernetesFleetComplianceSection;
