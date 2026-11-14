import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { getTableHeaderButtons } from "Common/UI/Components/Table/TableHeaderControls";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import Navigation from "Common/UI/Utils/Navigation";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { getRefreshButton } from "Common/UI/Components/Card/CardButtons/Refresh";
import Table from "Common/UI/Components/Table/Table";
import FieldType from "Common/UI/Components/Types/FieldType";
import Link from "Common/UI/Components/Link/Link";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Route from "Common/Types/API/Route";
import Column from "Common/UI/Components/Table/Types/Column";
import Filter from "Common/UI/Components/Filters/Types/Filter";
import FilterData from "Common/UI/Components/Filters/Types/FilterData";
import Search from "Common/Types/BaseDatabase/Search";
import Includes from "Common/Types/BaseDatabase/Includes";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { withSentenceDigits } from "../ResourcePart/SentenceDigits";
import { formatReaderFigure } from "Common/Types/DateLanguage";
import ResourceStatusCell from "./ResourceStatusCell";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import { isDashPlaceholder } from "Common/UI/Components/Table/TableEmptyValue";

/*
 * Product-neutral client-side view-model for infrastructure resource
 * lists (Kubernetes pods/nodes, Proxmox nodes/guests/storages, Ceph
 * OSDs/pools/daemons). Kept structurally IDENTICAL to the
 * `KubernetesResource` interface in
 * Pages/Kubernetes/Utils/KubernetesResourceUtils.ts — keep the two in
 * sync so the Kubernetes wrapper stays a pass-through.
 */
export interface InfrastructureResource {
  name: string;
  /*
   * Grouping dimension rendered as the badge column: the namespace for
   * Kubernetes, the parent node for Proxmox guests/storages, the host
   * for Ceph OSDs. Set to "" and pass showGroupColumn={false} when not
   * applicable.
   */
  namespace: string;
  cpuUtilization: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
  /*
   * Memory usage as a percent of a denominator, used by aggregate list
   * views where memory is a summed "% of allocatable" coming off the
   * server — parallel to cpuUtilization. Leave undefined to render
   * from memoryUsageBytes + memoryLimitBytes instead.
   */
  memoryUtilization?: number | null;
  status: string;
  /*
   * How the status reads when the product's own rules say so (a Kubernetes
   * pod's "CrashLoopBackOff" in red): the word may be translated or a
   * template's, so its colour cannot be read off it. Unset, the colour
   * follows the word (getStatusBadgeClass).
   */
  statusTone?: ResourceStatusTone | undefined;
  /*
   * The status as an English template and its values, when it is one of
   * the product's own words ("{{available}} of {{desired}} available"):
   * drawn in the reader's language. `status` then holds its English
   * wording, which the filter and the sort read.
   */
  statusText?: ResourceStatusText | undefined;
  /*
   * Why the status reads as it does, most urgent first, as English templates
   * looked up in the reader's language ("CPU at 94%"): the first is drawn
   * under the status, the rest counted ("+1 more"), so a row says what is
   * wrong without opening the part.
   */
  statusReasons?: Array<ResourceStatusReason> | undefined;
  age: string;
  additionalAttributes: Record<string, string>;
}

export interface ResourceStatusReason {
  text: string;
  values?: Record<string, string> | undefined;
  // A count-dependent reason: its "one" form and the count.
  plural?: { one: string; count: number } | undefined;
}

/*
 * Where a usage bar turns amber, and red: a product whose rules call a busy
 * CPU something to look at, never broken, leaves `danger` out.
 */
export interface ResourceMetricThresholds {
  warning: number;
  danger?: number | undefined;
}

export const RESOURCE_STATUS_REASON_CLASS_NAME: string =
  "whitespace-normal text-xs text-gray-600 [overflow-wrap:anywhere]";

export interface ResourceStatusText {
  text: string;
  values?: Record<string, string> | undefined;
}

export type ResourceStatusTone = "positive" | "warning" | "danger" | "neutral";

export const RESOURCE_STATUS_TONE_CLASS_NAMES: Record<
  ResourceStatusTone,
  string
> = {
  positive: "bg-green-50 text-green-700",
  warning: "bg-yellow-50 text-yellow-700",
  danger: "bg-red-50 text-red-700",
  neutral: "bg-gray-50 text-gray-700",
};

/*
 * How a column's cell reads beside the plain ones: a failed backup in red,
 * a guest in no backup job in amber - the word a reader scans the column
 * for, never the colour alone.
 */
export type ResourceColumnTone = "danger" | "warning";

export const RESOURCE_COLUMN_TONE_CLASS_NAMES: Record<
  ResourceColumnTone,
  string
> = {
  danger: "font-medium text-red-700",
  warning: "text-amber-700",
};

export interface ResourceColumn {
  title: string;
  key: string;
  getValue?: (resource: InfrastructureResource) => string;
  // A cell that needs a look; undefined for a plain one.
  getTone?:
    | ((resource: InfrastructureResource) => ResourceColumnTone | undefined)
    | undefined;
  // What the column's values mean, in an (i) beside the header.
  description?: string | undefined;
  /*
   * Where a row shows this column's value while the table runs out of room
   * (a laptop beside the side menu, a phone): under the value of the column
   * with this key - "name", "cpuUtilization" - on a line of its own
   * (Column.foldInto). Left out, the column is always drawn.
   */
  foldInto?: string | undefined;
  // Folded, the value says its column's name first ("CPU Capacity 76.80 GHz").
  showTitleWhenFolded?: boolean | undefined;
  /*
   * A name or a path - an image ("registry.example/shop/checkout:2.7.0"):
   * drawn whole on as many lines as it needs, breaking after its own dots
   * and slashes (BreakableName), and as written on a right-to-left page.
   * Left to a line of its own, a registry path was cut short, and folded
   * under a row's name it was cut mid-word ("shop/check"), the tag that
   * tells two images apart out of sight.
   */
  isName?: boolean | undefined;
  /*
   * A count - "3", or ready out of desired "2/3" - drawn in the reader's
   * digits ("۲/۳" in Persian), as the Status column's "{{available}} of
   * {{desired}}" is (issue #7106). Kept as plain digits in the row, so
   * the filter reads them; anything else (a dash, "N/A") as written.
   */
  isCount?: boolean | undefined;
}

const COUNT_VALUE: RegExp = /^\d{1,15}(?:\/\d{1,15})?$/;

export function writeCountInReaderDigits(
  value: string,
  translator: Translator,
): string {
  if (!COUNT_VALUE.test(value)) {
    return value;
  }

  return value
    .split("/")
    .map((part: string): string => {
      return translator.formatNumber(Number(part));
    })
    .join("/");
}

/*
 * Header tooltips for the built-in columns. They are per page rather than
 * fixed, because the same title means different things: "CPU" on the Nodes
 * list is one node's own usage, on a Deployment list it is a sum over pods.
 */
export interface BuiltInColumnDescriptions {
  status?: string | undefined;
  cpu?: string | undefined;
  memory?: string | undefined;
  age?: string | undefined;
}

export interface ComponentProps {
  resources: Array<InfrastructureResource>;
  title: string;
  description: string;
  columns?: Array<ResourceColumn> | undefined;
  /* Defaults to true. The grouping column renders `resource.namespace`. */
  showGroupColumn?: boolean | undefined;
  /* Column + filter title for the grouping column. Defaults to "Group". */
  groupColumnTitle?: string | undefined;
  /* Badge text when `resource.namespace` is empty. Defaults to "-". */
  groupFallbackLabel?: string | undefined;
  /*
   * Where the grouping column's badge goes while the table runs out of room
   * (see ResourceColumn.foldInto): "name" puts an ESXi host's datacenter
   * under its name. Left out, the column is always drawn.
   */
  groupColumnFoldInto?: string | undefined;
  showStatus?: boolean | undefined;
  /*
   * The Age column, beside Status; defaults to true. A list whose rows never
   * report an age - a Proxmox storage has no uptime - leaves it out rather
   * than drawing a column of dashes.
   */
  showAge?: boolean | undefined;
  showResourceMetrics?: boolean | undefined;
  getViewRoute?: ((resource: InfrastructureResource) => Route) | undefined;
  emptyMessage?: string | undefined;
  isLoading?: boolean | undefined;
  /*
   * Why its rows could not be read: the table says so in place of its
   * empty line ("No guests on this node."), with Refresh when the page
   * hands it onRefreshClick.
   */
  error?: string | undefined;
  onRefreshClick?: (() => void) | undefined;
  /* Prefix for the DOM table id. Defaults to "infrastructure". */
  tableIdPrefix?: string | undefined;
  builtInColumnDescriptions?: BuiltInColumnDescriptions | undefined;
  /*
   * The lines the CPU and Memory bars change colour at, when the product's
   * own rules draw them elsewhere than the table's defaults (amber past 60%
   * and red past 80% for CPU; 70% and 85% for memory).
   */
  metricThresholds?:
    | {
        cpu?: ResourceMetricThresholds | undefined;
        memory?: ResourceMetricThresholds | undefined;
      }
    | undefined;
  /*
   * How the Memory column writes an amount, when the product writes it
   * otherwise than the table (formatMemoryValue): a vCenter's hosts in GiB
   * and TiB, as vSphere does.
   */
  formatMemory?: ((bytes: number) => string) | undefined;
}

const PAGE_SIZE: number = 25;

// A row's reason in the reader's language, its numbers in the sentence's digits.
export function getResourceStatusReasonText(
  reason: ResourceStatusReason,
  translator: Translator,
): string {
  if (reason.plural) {
    return translator.translatePlural(
      { one: reason.plural.one, other: reason.text },
      reason.plural.count,
      withSentenceDigits(reason.values),
      { setsValuesApart: true },
    );
  }
  return reason.values
    ? translator.translateTemplate(
        reason.text,
        withSentenceDigits(reason.values),
        { setsValuesApart: true },
      )
    : translator.translateText(reason.text) || reason.text;
}

// A bar's colour against the product's own lines (see metricThresholds).
export function getThresholdBarColor(
  pct: number,
  thresholds: ResourceMetricThresholds,
  calmClassName: string,
): string {
  if (thresholds.danger !== undefined && pct > thresholds.danger) {
    return "bg-red-500";
  }
  if (pct > thresholds.warning) {
    return "bg-amber-500";
  }
  return calmClassName;
}

// In the reader's digits ("۱۲٫۵٪", "12,5 %"; #7106); English as before.
export function formatCpuValue(value: number | null): string {
  if (value === null || value === undefined) {
    return "N/A";
  }
  return formatReaderFigure(value, { decimals: 1, isPercent: true });
}

export function formatMemoryValue(bytes: number | null): string {
  if (bytes === null || bytes === undefined) {
    return "N/A";
  }

  // The number in the reader's digits, the unit as written: "۱۲٫۵ MB".
  if (bytes < 1024) {
    return `${formatReaderFigure(bytes, {
      decimals: 1,
      dropTrailingZeros: true,
    })} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${formatReaderFigure(bytes / 1024, { decimals: 1 })} KB`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${formatReaderFigure(bytes / (1024 * 1024), { decimals: 1 })} MB`;
  }

  return `${formatReaderFigure(bytes / (1024 * 1024 * 1024), {
    decimals: 2,
  })} GB`;
}

// A row's status in the reader's language.
export function getResourceStatusLabel(
  resource: Pick<InfrastructureResource, "status" | "statusText">,
  translator: Translator,
): string {
  const text: ResourceStatusText | undefined = resource.statusText;
  if (!text) {
    return resource.status;
  }
  return text.values
    ? translator.translateTemplate(text.text, withSentenceDigits(text.values))
    : translator.translateText(text.text) || text.text;
}

export function getStatusBadgeClass(status: string): string {
  const s: string = status.toLowerCase();
  if (
    s === "running" ||
    s === "ready" ||
    s === "active" ||
    s === "bound" ||
    s === "succeeded" ||
    s === "available" ||
    s === "admitted" ||
    s === "true" ||
    s === "up" ||
    s === "online" ||
    s === "connected" ||
    s === "healthy" ||
    s === "ok" ||
    s === "powered on"
  ) {
    return "bg-green-50 text-green-700";
  }
  if (
    s === "pending" ||
    s === "unknown" ||
    s === "waiting" ||
    s === "terminating" ||
    s === "degraded" ||
    s === "warn" ||
    s === "warning"
  ) {
    return "bg-yellow-50 text-yellow-700";
  }
  if (
    s === "failed" ||
    s === "crashloopbackoff" ||
    s === "error" ||
    s === "lost" ||
    s === "rejected" ||
    s === "unavailable" ||
    s === "notready" ||
    s === "imagepullbackoff" ||
    s === "false" ||
    s === "down" ||
    s === "offline" ||
    s === "err"
  ) {
    return "bg-red-50 text-red-700";
  }
  return "bg-gray-50 text-gray-700";
}

/*
 * The CPU column's bar colour. Exported so a list that shows the same
 * resources' CPU elsewhere (an ESXi host's busiest VMs) colours a VM the
 * way its row in this table does.
 */
export function getCpuBarColor(pct: number): string {
  if (pct > 80) {
    return "bg-red-500";
  }
  if (pct > 60) {
    return "bg-yellow-500";
  }
  return "bg-green-500";
}

function getMemoryBarColor(pct: number): string {
  if (pct > 85) {
    return "bg-red-500";
  }
  if (pct > 70) {
    return "bg-yellow-500";
  }
  return "bg-blue-500";
}

const ResourceTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const showGroupColumn: boolean = props.showGroupColumn !== false;
  const groupColumnTitle: string = props.groupColumnTitle || "Group";
  const groupFallbackLabel: string = props.groupFallbackLabel || "-";
  const showStatus: boolean = props.showStatus !== false;
  const showResourceMetrics: boolean = props.showResourceMetrics !== false;
  const formatMemory: (bytes: number | null) => string = (
    bytes: number | null,
  ): string => {
    return props.formatMemory && bytes !== null && bytes !== undefined
      ? props.formatMemory(bytes)
      : formatMemoryValue(bytes);
  };
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Ascending);
  const [showFilterModal, setShowFilterModal] = useState<boolean>(false);
  const [filterData, setFilterData] = useState<
    FilterData<InfrastructureResource>
  >({});

  // Build filter definitions from data
  const filters: Array<Filter<InfrastructureResource>> = useMemo(() => {
    const result: Array<Filter<InfrastructureResource>> = [
      {
        title: "Name",
        key: "name",
        type: FieldType.Text,
      },
    ];

    if (showGroupColumn) {
      const groups: Array<string> = Array.from(
        new Set(
          props.resources
            .map((r: InfrastructureResource) => {
              return r.namespace;
            })
            .filter(Boolean),
        ),
      ).sort();
      result.push({
        title: groupColumnTitle,
        key: "namespace",
        type: FieldType.Dropdown,
        // A namespace's or a group's name, drawn as written.
        filterDropdownOptions: groups.map((group: string) => {
          return { label: group, value: group, isUserContent: true };
        }),
      });
    }

    if (showStatus) {
      const statuses: Array<string> = Array.from(
        new Set(
          props.resources
            .map((r: InfrastructureResource) => {
              return r.status;
            })
            .filter(Boolean),
        ),
      ).sort();
      // Each status as its cells draw it.
      const labelOf: (status: string) => string = (status: string): string => {
        const resource: InfrastructureResource | undefined =
          props.resources.find((r: InfrastructureResource): boolean => {
            return r.status === status;
          });
        return resource ? getResourceStatusLabel(resource, translator) : status;
      };
      result.push({
        title: "Status",
        key: "status",
        type: FieldType.Dropdown,
        /*
         * As its cells draw it: already in the reader's words, or the
         * status as the resource reports it - never looked up again.
         */
        filterDropdownOptions: statuses.map((s: string) => {
          return { label: labelOf(s), value: s, isUserContent: true };
        }),
      });
    }

    return result;
  }, [
    props.resources,
    showGroupColumn,
    groupColumnTitle,
    showStatus,
    translator,
  ]);

  // Filter and sort data client-side
  const processedData: Array<InfrastructureResource> = useMemo(() => {
    let data: Array<InfrastructureResource> = [...props.resources];

    // Apply filters from filterData
    for (const key of Object.keys(filterData) as Array<
      keyof InfrastructureResource
    >) {
      const value: unknown = filterData[key];
      if (!value) {
        continue;
      }

      if (value instanceof Search) {
        const searchText: string = value.toString().toLowerCase();
        data = data.filter((r: InfrastructureResource) => {
          const fieldValue: string = (r[key] as string) || "";
          return fieldValue.toLowerCase().includes(searchText);
        });
      } else if (value instanceof Includes) {
        const includeValues: Array<string> = value.values as Array<string>;
        data = data.filter((r: InfrastructureResource) => {
          const fieldValue: string = (r[key] as string) || "";
          return includeValues.includes(fieldValue);
        });
      } else if (typeof value === "string") {
        // Dropdown single selection stores as plain string
        data = data.filter((r: InfrastructureResource) => {
          const fieldValue: string = (r[key] as string) || "";
          return fieldValue === value;
        });
      } else if (Array.isArray(value)) {
        // Dropdown multi-selection stores as plain array
        const includeValues: Array<string> = value.map((v: unknown) => {
          return String(v);
        });
        data = data.filter((r: InfrastructureResource) => {
          const fieldValue: string = (r[key] as string) || "";
          return includeValues.includes(fieldValue);
        });
      }
    }

    // Sort
    if (sortBy) {
      data.sort((a: InfrastructureResource, b: InfrastructureResource) => {
        let cmp: number = 0;
        if (sortBy === "name") {
          cmp = a.name.localeCompare(b.name);
        } else if (sortBy === "namespace") {
          cmp = a.namespace.localeCompare(b.namespace);
        } else if (sortBy === "status") {
          cmp = a.status.localeCompare(b.status);
        } else if (sortBy === "cpuUtilization") {
          cmp = (a.cpuUtilization ?? -1) - (b.cpuUtilization ?? -1);
        } else if (sortBy === "memoryUsageBytes") {
          cmp = (a.memoryUsageBytes ?? -1) - (b.memoryUsageBytes ?? -1);
        } else if (sortBy === "age") {
          cmp = a.age.localeCompare(b.age);
        }
        return sortOrder === SortOrder.Descending ? -cmp : cmp;
      });
    }

    return data;
  }, [props.resources, filterData, sortBy, sortOrder]);

  /*
   * The page above can refetch a shorter list, so clamp instead of trusting
   * currentPage — otherwise the reader is stranded on a page past the end,
   * staring at an empty table.
   */
  const totalPages: number = Math.max(
    1,
    Math.ceil(processedData.length / pageSize),
  );
  const effectivePage: number = Math.min(currentPage, totalPages);

  // Paginate
  const paginatedData: Array<InfrastructureResource> = useMemo(() => {
    const start: number = (effectivePage - 1) * pageSize;
    return processedData.slice(start, start + pageSize);
  }, [processedData, effectivePage, pageSize]);

  const tableColumns: Array<Column<InfrastructureResource>> = [
    {
      title: "Name",
      type: FieldType.Element,
      key: "name",
      getElement: (resource: InfrastructureResource): ReactElement => {
        /*
         * As written on a right-to-left page, in an isolate of its own: a
         * Ceph pool's ".mgr" read "mgr.".
         */
        if (props.getViewRoute) {
          return (
            <Link
              to={props.getViewRoute(resource)}
              className="font-medium text-gray-900 hover:text-indigo-600 hover:underline"
            >
              <bdi>{resource.name}</bdi>
            </Link>
          );
        }
        return (
          <span className="font-medium text-gray-900">
            <bdi>{resource.name}</bdi>
          </span>
        );
      },
    },
  ];

  if (showGroupColumn) {
    tableColumns.push({
      title: groupColumnTitle,
      type: FieldType.Element,
      key: "namespace",
      ...(props.groupColumnFoldInto
        ? { hideBelowLargeScreen: true, foldInto: props.groupColumnFoldInto }
        : {}),
      getElement: (resource: InfrastructureResource): ReactElement => {
        return (
          <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700">
            {resource.namespace || groupFallbackLabel}
          </span>
        );
      },
    });
  }

  /*
   * A status with its reason under it wraps inside its column (a table's
   * cells keep their values on one line otherwise), so a long reason never
   * widens the column or runs over the next one.
   */
  const hasStatusReasons: boolean = props.resources.some(
    (resource: InfrastructureResource): boolean => {
      return (resource.statusReasons || []).length > 0;
    },
  );

  if (showStatus) {
    tableColumns.push({
      title: "Status",
      type: FieldType.Element,
      key: "status",
      headerTooltip: props.builtInColumnDescriptions?.status,
      ...(hasStatusReasons
        ? {
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-[12rem]",
            /*
             * Its own floor rather than a column of prose's 10rem: the
             * reason under the pill is a few words, and beside a side menu
             * at 1024px the 10rem left a host's name 56px ("esx01.a",
             * "cme.e..."). The pill keeps to one line (whitespace-nowrap),
             * so a longer one widens the column instead.
             */
            contentClassName: "min-w-[7rem]",
          }
        : {}),
      getElement: (resource: InfrastructureResource): ReactElement => {
        return <ResourceStatusCell resource={resource} />;
      },
    });
  }

  if (props.columns) {
    for (const col of props.columns) {
      tableColumns.push({
        title: col.title,
        type: FieldType.Element,
        key: col.key as keyof InfrastructureResource,
        disableSort: true,
        headerTooltip: col.description,
        ...(col.foldInto
          ? {
              hideBelowLargeScreen: true,
              foldInto: col.foldInto,
              showTitleWhenFolded: col.showTitleWhenFolded,
            }
          : {}),
        ...(col.isName
          ? { wrapContent: true, wrapMaxWidthClassName: "max-w-[16rem]" }
          : {}),
        getElement: (resource: InfrastructureResource): ReactElement => {
          const written: string = col.getValue
            ? col.getValue(resource)
            : resource.additionalAttributes[col.key] || "";
          const value: string = col.isCount
            ? writeCountInReaderDigits(written, translator)
            : written;
          const tone: ResourceColumnTone | undefined = col.getTone
            ? col.getTone(resource)
            : undefined;
          const isWritten: boolean =
            Boolean(value) && !isDashPlaceholder(value);
          const classNames: Array<string> = tone
            ? [RESOURCE_COLUMN_TONE_CLASS_NAMES[tone]]
            : [];
          if (col.showTitleWhenFolded && !col.isName && isWritten) {
            /*
             * A reading folded with its column's name ("Max Avail 9.2 TiB")
             * goes to the next line whole rather than leaving its unit
             * there alone, where a longer title (Persian's) fills the line.
             */
            classNames.push("inline-block");
          }
          return (
            <span
              className={
                classNames.length > 0 ? classNames.join(" ") : undefined
              }
              data-tone={tone}
              /*
               * In its own direction: on a Persian page "3 / 4 ms" read
               * "ms 4 / 3", and "1.5 TiB / 3.8 TiB" lost its first number
               * to the line's end.
               */
              dir="auto"
            >
              {col.isName && isWritten ? (
                <bdi
                  className="[overflow-wrap:anywhere]"
                  data-testid="resource-column-name"
                >
                  <BreakableName text={value} />
                </bdi>
              ) : (
                value
              )}
            </span>
          );
        },
      });
    }
  }

  if (showResourceMetrics) {
    tableColumns.push(
      {
        title: "CPU",
        type: FieldType.Element,
        key: "cpuUtilization",
        headerTooltip: props.builtInColumnDescriptions?.cpu,
        getElement: (resource: InfrastructureResource): ReactElement => {
          if (
            resource.cpuUtilization === null ||
            resource.cpuUtilization === undefined
          ) {
            return (
              <span className="text-gray-400">
                {translator.translateText("N/A")}
              </span>
            );
          }
          const pct: number = Math.min(resource.cpuUtilization, 100);
          const cpuThresholds: ResourceMetricThresholds | undefined =
            props.metricThresholds?.cpu;
          return (
            <div className="flex items-center gap-2 min-w-[120px]">
              <div className="flex-1 bg-gray-200 rounded-full h-2">
                <div
                  data-testid="resource-cpu-bar"
                  className={`h-2 rounded-full ${
                    cpuThresholds
                      ? getThresholdBarColor(pct, cpuThresholds, "bg-green-500")
                      : getCpuBarColor(pct)
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs text-gray-600 whitespace-nowrap w-10 text-right">
                {formatCpuValue(resource.cpuUtilization)}
              </span>
            </div>
          );
        },
      },
      {
        title: "Memory",
        type: FieldType.Element,
        key: "memoryUsageBytes",
        headerTooltip: props.builtInColumnDescriptions?.memory,
        getElement: (resource: InfrastructureResource): ReactElement => {
          if (
            resource.memoryUsageBytes === null ||
            resource.memoryUsageBytes === undefined
          ) {
            return (
              <span className="text-gray-400">
                {translator.translateText("N/A")}
              </span>
            );
          }

          /*
           * Aggregate views supply a pre-summed memory percentage
           * (memoryUtilization), parallel to cpuUtilization. Render it
           * like the CPU bar, with summed usage bytes as the sub-line.
           * Can exceed 100% the same way summed CPU% does, so clamp
           * the bar but keep the real number.
           */
          if (
            resource.memoryUtilization !== null &&
            resource.memoryUtilization !== undefined
          ) {
            const pct: number = Math.min(resource.memoryUtilization, 100);
            /*
             * A product's own lines when it has them, as the limit's bar
             * below: a Swarm task's memory is a percent of its limit, amber
             * past its alert's 85%.
             */
            const utilizationThresholds: ResourceMetricThresholds | undefined =
              props.metricThresholds?.memory;
            return (
              <div className="min-w-[140px]">
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-200 rounded-full h-2">
                    <div
                      data-testid="resource-memory-bar"
                      className={`h-2 rounded-full ${
                        utilizationThresholds
                          ? getThresholdBarColor(
                              pct,
                              utilizationThresholds,
                              "bg-blue-500",
                            )
                          : getMemoryBarColor(pct)
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-600 whitespace-nowrap">
                    {formatReaderFigure(resource.memoryUtilization, {
                      decimals: 1,
                      isPercent: true,
                    })}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {/* "471 MiB", not "MiB 471", on a right-to-left page. */}
                  <bdi>{formatMemory(resource.memoryUsageBytes)}</bdi>
                </div>
              </div>
            );
          }

          if (
            resource.memoryLimitBytes !== null &&
            resource.memoryLimitBytes !== undefined &&
            resource.memoryLimitBytes > 0
          ) {
            const pct: number = Math.min(
              (resource.memoryUsageBytes / resource.memoryLimitBytes) * 100,
              100,
            );
            const memoryThresholds: ResourceMetricThresholds | undefined =
              props.metricThresholds?.memory;
            return (
              <div className="min-w-[140px]">
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-200 rounded-full h-2">
                    <div
                      data-testid="resource-memory-bar"
                      className={`h-2 rounded-full ${
                        memoryThresholds
                          ? getThresholdBarColor(
                              pct,
                              memoryThresholds,
                              "bg-blue-500",
                            )
                          : getMemoryBarColor(pct)
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-600 whitespace-nowrap">
                    {formatReaderFigure(Math.round(pct), {
                      decimals: 0,
                      isPercent: true,
                    })}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  <bdi>
                    {formatMemory(resource.memoryUsageBytes)} /{" "}
                    {formatMemory(resource.memoryLimitBytes)}
                  </bdi>
                </div>
              </div>
            );
          }

          return (
            <span className="text-sm text-gray-700" dir="auto">
              {formatMemory(resource.memoryUsageBytes)}
            </span>
          );
        },
      },
    );
  }

  if (showStatus && props.showAge !== false) {
    tableColumns.push({
      title: "Age",
      type: FieldType.Element,
      key: "age",
      headerTooltip: props.builtInColumnDescriptions?.age,
      getElement: (resource: InfrastructureResource): ReactElement => {
        if (!resource.age) {
          return <span className="text-gray-400">-</span>;
        }
        return <span className="text-sm text-gray-600">{resource.age}</span>;
      },
    });
  }

  const actionButtons: Array<ActionButtonSchema<InfrastructureResource>> = [];

  if (props.getViewRoute) {
    tableColumns.push({
      title: "",
      type: FieldType.Actions,
      key: null,
      disableSort: true,
    });

    actionButtons.push({
      title: "View",
      icon: IconProp.Eye,
      buttonStyleType: ButtonStyleType.NORMAL,
      onClick: (
        resource: InfrastructureResource,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
      ): void => {
        try {
          Navigation.navigate(props.getViewRoute!(resource));
          onCompleteAction();
        } catch (err) {
          onError(err as Error);
        }
      },
    });
  }

  const hasActiveFilters: boolean = Object.keys(filterData).length > 0;

  /*
   * Refresh and Filter live in the ⋯ at the end of the card's header,
   * where every table keeps them (getTableHeaderButtons), not as loose
   * icons beside the title.
   */
  const cardButtons: Array<CardButtonSchema> = [];

  if (props.onRefreshClick) {
    cardButtons.push({
      ...getRefreshButton(),
      onClick: props.onRefreshClick,
    });
  }

  cardButtons.push({
    title: "",
    buttonStyle: ButtonStyleType.ICON,
    onClick: () => {
      setShowFilterModal(true);
    },
    icon: IconProp.Filter,
  });

  return (
    <Card
      title={props.title}
      description={props.description}
      headerLayout="toolbar"
      buttons={getTableHeaderButtons(cardButtons)}
    >
      <Table<InfrastructureResource>
        id={`${props.tableIdPrefix || "infrastructure"}-${props.title.toLowerCase().replace(/\s+/g, "-")}-table`}
        columns={tableColumns}
        actionButtons={actionButtons}
        data={paginatedData}
        singularLabel={props.title}
        pluralLabel={props.title}
        isLoading={props.isLoading || false}
        error={props.error || ""}
        onRefreshClick={props.onRefreshClick}
        currentPageNumber={effectivePage}
        totalItemsCount={processedData.length}
        itemsOnPage={pageSize}
        onNavigateToPage={(page: number, itemsOnPage: number) => {
          setCurrentPage(page);
          if (itemsOnPage > 0) {
            setPageSize(itemsOnPage);
          }
        }}
        sortBy={sortBy as keyof InfrastructureResource | null}
        sortOrder={sortOrder}
        onSortChanged={(
          newSortBy: keyof InfrastructureResource | null,
          newSortOrder: SortOrder,
        ) => {
          setSortBy(newSortBy as string | null);
          setSortOrder(newSortOrder);
        }}
        filters={filters}
        showFilterModal={showFilterModal}
        filterData={filterData}
        onFilterChanged={(
          newFilterData: FilterData<InfrastructureResource>,
        ) => {
          setFilterData(newFilterData);
          setCurrentPage(1);
        }}
        onFilterModalOpen={() => {
          setShowFilterModal(true);
        }}
        onFilterModalClose={() => {
          setShowFilterModal(false);
        }}
        noItemsMessage={
          hasActiveFilters
            ? "No resources match the current filters."
            : props.emptyMessage || "No resources found."
        }
      />
    </Card>
  );
};

export default ResourceTable;
