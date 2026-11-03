import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import {
  ErrorFunction,
  PromiseVoidFunction,
  VoidFunction,
} from "Common/Types/FunctionTypes";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { getTableHeaderButtons } from "Common/UI/Components/Table/TableHeaderControls";
import Table from "Common/UI/Components/Table/Table";
import FieldType from "Common/UI/Components/Types/FieldType";
import Column from "Common/UI/Components/Table/Types/Column";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  ClientSort,
  ClientSortColumns,
  compareText,
  resolveClientSort,
  sortClientRows,
} from "../../../Utils/ClientTableSort";
import { CONTAINER_HOST_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/ContainerHostMetricDescriptions";
import ResourceStatusCell from "../../../Components/Infrastructure/ResourceStatusCell";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import {
  RESOURCE_COLUMN_TONE_CLASS_NAMES,
  ResourceColumnTone,
} from "../../../Components/Infrastructure/ResourceTable";
import { formatRelativeTime } from "../../../Components/Home/HomeRelativeTime";
import {
  ContainerHostRow,
  getContainerHostRows,
} from "../../../Components/ContainerHost/ContainerHostRows";
import { loadContainerHostReadings } from "../../../Components/ContainerHost/ContainerHostReadings";
import {
  PODMAN_CONTAINER_HOST_RUNTIME,
  getContainerHostRoutes,
} from "../../../Components/ContainerHost/ContainerHostRuntime";

// The columns that sort: each by the value behind its cell.
type ContainerSortKey =
  | "containerName"
  | "statusRank"
  | "composeProject"
  | "containerImage"
  | "cpuPercent"
  | "memoryPercent"
  | "restarts"
  | "startedAtMs";

type PodmanContainerSort = ClientSort<ContainerSortKey>;

const PAGE_SIZE: number = 25;

/*
 * Every column sorts, by the value behind its cell. The readings open busiest
 * first (Memory by its share of the limit, the amount under it), the name
 * and image A to Z, the status most urgent first and Last Started the
 * newest first (a container that just restarted); a missing reading or image
 * sorts last either way. A container's network totals are on its own page.
 */
const SORT_COLUMNS: ClientSortColumns<ContainerHostRow, ContainerSortKey> = {
  containerName: { firstSortOrder: SortOrder.Ascending },
  statusRank: { firstSortOrder: SortOrder.Ascending },
  composeProject: { firstSortOrder: SortOrder.Ascending },
  containerImage: { firstSortOrder: SortOrder.Ascending },
  cpuPercent: { firstSortOrder: SortOrder.Descending },
  memoryPercent: { firstSortOrder: SortOrder.Descending },
  restarts: { firstSortOrder: SortOrder.Descending },
  startedAtMs: { firstSortOrder: SortOrder.Descending },
};

const DEFAULT_SORT: PodmanContainerSort = {
  sortBy: "containerName",
  sortOrder: SortOrder.Ascending,
};

// Containers that tie in the sorted column stay in name order.
const compareByName: (a: ContainerHostRow, b: ContainerHostRow) => number = (
  a: ContainerHostRow,
  b: ContainerHostRow,
): number => {
  return compareText(a.containerName, b.containerName);
};

const formatBytes: (bytes: number) => string = (bytes: number): string => {
  if (!isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units: Array<string> = ["B", "KB", "MB", "GB", "TB"];
  let value: number = bytes;
  let idx: number = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(value >= 100 || idx === 0 ? 0 : 1)} ${units[idx]}`;
};

const formatReadingBytes: (value: number | null) => string = (
  value: number | null,
): string => {
  return value === null ? "—" : formatBytes(value);
};

const formatReadingPercent: (value: number | null) => string = (
  value: number | null,
): string => {
  return value === null ? "—" : `${value.toFixed(2)}%`;
};

// A reading past its alert's line reads amber, as Needs attention says it.
const renderReading: (
  text: string,
  tone: ResourceColumnTone | undefined,
) => ReactElement = (
  text: string,
  tone: ResourceColumnTone | undefined,
): ReactElement => {
  return (
    <span
      className={tone ? RESOURCE_COLUMN_TONE_CLASS_NAMES[tone] : undefined}
      data-tone={tone}
    >
      {text}
    </span>
  );
};

const PodmanHostContainers: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [containers, setContainers] = useState<Array<ContainerHostRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isHostMissing, setIsHostMissing] = useState<boolean>(false);
  const [readAt, setReadAt] = useState<Date>(OneUptimeDate.getCurrentDate());
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE);
  const [sort, setSort] = useState<PodmanContainerSort>(DEFAULT_SORT);

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const host: PodmanHost | null = await ModelAPI.getItem({
        modelType: PodmanHost,
        id: modelId,
        select: {
          hostIdentifier: true,
        },
      });

      if (!host?.hostIdentifier) {
        setIsHostMissing(true);
        setIsLoading(false);
        return;
      }

      /*
       * Every container with its latest readings in the last 5 minutes
       * before now, its restarts in the last 15 and its inventory row, which
       * keeps a container that stopped listed until OneUptime forgets it
       * (ContainerHostReadings); its state by the host's rules.
       */
      const readings: Awaited<ReturnType<typeof loadContainerHostReadings>> =
        await loadContainerHostReadings({
          runtime: PODMAN_CONTAINER_HOST_RUNTIME,
          hostId: modelId,
          hostIdentifier: host.hostIdentifier as string,
        });

      setContainers(getContainerHostRows(readings));
      setReadAt(readings.readAt);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  // Sorted before the page is cut out, so a sort runs across every page.
  const sortedContainers: Array<ContainerHostRow> = useMemo(() => {
    return sortClientRows({
      rows: containers,
      columns: SORT_COLUMNS,
      sort: sort,
      tieBreak: compareByName,
    });
  }, [containers, sort]);

  /*
   * A refresh can shrink the list (OneUptime forgets a stopped container 15
   * minutes after its last reading), so clamp instead of trusting
   * currentPage — otherwise the user is stranded on a page past the end,
   * staring at an empty table.
   */
  const totalPages: number = Math.max(
    1,
    Math.ceil(containers.length / pageSize),
  );
  const effectivePage: number = Math.min(currentPage, totalPages);

  const paginatedData: Array<ContainerHostRow> = useMemo(() => {
    const start: number = (effectivePage - 1) * pageSize;
    return sortedContainers.slice(start, start + pageSize);
  }, [sortedContainers, effectivePage, pageSize]);

  const routes: ReturnType<typeof getContainerHostRoutes> = useMemo(() => {
    return getContainerHostRoutes(PODMAN_CONTAINER_HOST_RUNTIME, modelId);
  }, [modelId]);

  const getContainerDetailRoute: (row: ContainerHostRow) => Route = (
    row: ContainerHostRow,
  ): Route => {
    return routes.getContainerRoute(row.containerName);
  };

  // A column the host's containers fill: Compose project only when one does.
  const hasComposeProjects: boolean = containers.some(
    (row: ContainerHostRow): boolean => {
      return Boolean(row.composeProject);
    },
  );

  const tableColumns: Array<Column<ContainerHostRow>> = useMemo(() => {
    const columns: Array<Column<ContainerHostRow>> = [
      {
        title: "Container Name",
        type: FieldType.Element,
        key: "containerName",
        /*
         * The name is what a reader scans for: drawn whole, breaking after
         * its own dots and dashes on a narrow line, never cut short.
         */
        wrapContent: true,
        wrapMaxWidthClassName: "max-w-[16rem]",
        contentClassName: "min-w-[9rem]",
        getElement: (row: ContainerHostRow): ReactElement => {
          return (
            <Link
              to={getContainerDetailRoute(row)}
              className="font-medium text-gray-900 hover:text-indigo-600 hover:underline [overflow-wrap:anywhere]"
            >
              <bdi>
                <BreakableName text={row.containerName} breaksFromLength={0} />
              </bdi>
            </Link>
          );
        },
      },
      {
        title: "Status",
        type: FieldType.Element,
        key: "statusRank",
        headerTooltip: CONTAINER_HOST_METRIC_DESCRIPTIONS.containerStatus,
        wrapContent: true,
        wrapMaxWidthClassName: "max-w-[12rem]",
        contentClassName: "min-w-[7rem]",
        getElement: (row: ContainerHostRow): ReactElement => {
          return <ResourceStatusCell resource={row.status} />;
        },
      },
    ];

    if (hasComposeProjects) {
      columns.push({
        title: "Compose Project",
        type: FieldType.Element,
        key: "composeProject",
        headerTooltip:
          CONTAINER_HOST_METRIC_DESCRIPTIONS.containerComposeProject,
        hideBelowLargeScreen: true,
        foldInto: "containerName",
        showTitleWhenFolded: true,
        getElement: (row: ContainerHostRow): ReactElement => {
          return row.composeProject ? (
            <bdi>{row.composeProject}</bdi>
          ) : (
            <span>—</span>
          );
        },
      });
    }

    columns.push(
      {
        title: "Image",
        type: FieldType.Element,
        key: "containerImage",
        hideBelowLargeScreen: true,
        foldInto: "containerName",
        wrapContent: true,
        wrapMaxWidthClassName: "max-w-[16rem]",
        getElement: (row: ContainerHostRow): ReactElement => {
          return row.containerImage ? (
            <bdi className="[overflow-wrap:anywhere]">
              <BreakableName text={row.containerImage} />
            </bdi>
          ) : (
            <span>{translator.translateText("unknown")}</span>
          );
        },
      },
      {
        title: "CPU",
        type: FieldType.Element,
        key: "cpuPercent",
        headerTooltip: CONTAINER_HOST_METRIC_DESCRIPTIONS.containerCpu,
        getElement: (row: ContainerHostRow): ReactElement => {
          return renderReading(
            formatReadingPercent(row.cpuPercent),
            row.cpuTone,
          );
        },
      },
      {
        title: "Memory",
        type: FieldType.Element,
        key: "memoryPercent",
        headerTooltip: CONTAINER_HOST_METRIC_DESCRIPTIONS.containerMemory,
        /*
         * Of its limit, or of the host's memory: the share a reader sorts by
         * to find a container near its limit, with the amount under it.
         */
        getElement: (row: ContainerHostRow): ReactElement => {
          if (row.memoryPercent === null && row.memoryUsage === null) {
            return <span>—</span>;
          }
          return (
            <div className="flex flex-col">
              {renderReading(
                formatReadingPercent(row.memoryPercent),
                row.memoryTone,
              )}
              {row.memoryUsage !== null ? (
                <span className="text-xs text-gray-500">
                  {formatReadingBytes(row.memoryUsage)}
                </span>
              ) : (
                <></>
              )}
            </div>
          );
        },
      },
      {
        title: "Restarts (15 min)",
        type: FieldType.Element,
        key: "restarts",
        headerTooltip: CONTAINER_HOST_METRIC_DESCRIPTIONS.containerRestarts,
        getElement: (row: ContainerHostRow): ReactElement => {
          return renderReading(
            row.restarts === null ? "—" : String(row.restarts),
            row.restartsTone,
          );
        },
      },
      {
        title: "Last Started",
        type: FieldType.Element,
        key: "startedAtMs",
        headerTooltip: CONTAINER_HOST_METRIC_DESCRIPTIONS.containerUptime,
        getElement: (row: ContainerHostRow): ReactElement => {
          if (row.startedAtMs === null) {
            return <span>—</span>;
          }
          const startedAt: Date = new Date(row.startedAtMs);
          return (
            <span
              title={OneUptimeDate.getDateAsLocalFormattedString(startedAt)}
            >
              {formatRelativeTime({
                date: startedAt,
                now: readAt,
                language: translator.language,
              })}
            </span>
          );
        },
      },
      {
        title: "",
        type: FieldType.Actions,
        key: null,
        disableSort: true,
      },
    );

    return columns;
  }, [modelId, hasComposeProjects, readAt, translator]);

  const actionButtons: Array<ActionButtonSchema<ContainerHostRow>> = [
    {
      title: "View",
      icon: IconProp.Eye,
      buttonStyleType: ButtonStyleType.NORMAL,
      onClick: (
        row: ContainerHostRow,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
      ): void => {
        try {
          Navigation.navigate(getContainerDetailRoute(row));
          onCompleteAction();
        } catch (err) {
          onError(err as Error);
        }
      },
    },
  ];

  /*
   * Refresh lives in the ⋯ at the end of the card's header, where every
   * table keeps it (getTableHeaderButtons), not as a loose icon beside
   * the title.
   */
  const cardButtons: Array<CardButtonSchema> = [
    {
      title: "",
      buttonStyle: ButtonStyleType.ICON,
      onClick: () => {
        fetchData().catch(() => {});
      },
      icon: IconProp.Refresh,
    },
  ];

  if (isLoading && containers.length === 0) {
    return <PageLoader isVisible={true} />;
  }

  if (isHostMissing) {
    return <ErrorMessage message="Host not found." />;
  }

  return (
    <Card
      title="Podman Containers"
      description="Every container on this host, with its state by the host's rules, its restarts and what it uses now. One that stopped stays listed for 15 minutes after its last reading."
      headerLayout="toolbar"
      buttons={getTableHeaderButtons(cardButtons)}
    >
      <Table<ContainerHostRow>
        id="podman-containers-table"
        columns={tableColumns}
        actionButtons={actionButtons}
        data={paginatedData}
        singularLabel="Container"
        pluralLabel="Containers"
        isLoading={isLoading}
        error={error}
        onRefreshClick={() => {
          fetchData().catch(() => {});
        }}
        currentPageNumber={effectivePage}
        totalItemsCount={containers.length}
        itemsOnPage={pageSize}
        onNavigateToPage={(page: number, itemsOnPage: number) => {
          setCurrentPage(page);
          if (itemsOnPage > 0) {
            setPageSize(itemsOnPage);
          }
        }}
        sortOrder={sort.sortOrder}
        sortBy={sort.sortBy}
        onSortChanged={(
          newSortBy: keyof ContainerHostRow | null,
          newSortOrder: SortOrder,
        ) => {
          setSort((current: PodmanContainerSort): PodmanContainerSort => {
            return resolveClientSort({
              columns: SORT_COLUMNS,
              current: current,
              requestedSortBy: newSortBy,
              requestedSortOrder: newSortOrder,
            });
          });
          setCurrentPage(1);
        }}
        noItemsMessage="No containers reported in the last 15 minutes. Make sure the Podman agent is running on this host and sending metrics."
      />
    </Card>
  );
};

export default PodmanHostContainers;
