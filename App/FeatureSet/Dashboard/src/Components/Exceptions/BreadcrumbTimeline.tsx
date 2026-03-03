import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useMemo,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import Icon, { SizeProp, ThickProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import {
  Green500,
  Red500,
  Yellow500,
  Blue500,
  Purple500,
  Gray500,
} from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject, JSONValue } from "Common/Types/JSON";

export interface BreadcrumbEvent {
  name: string;
  time: Date;
  timeUnixNano: number;
  attributes: JSONObject;
}

export enum BreadcrumbCategory {
  HTTP = "HTTP",
  DB = "DB",
  Log = "LOG",
  Error = "ERROR",
  Warning = "WARN",
  Event = "EVENT",
  Exception = "EXCEPTION",
}

// Grouped event: consecutive identical events collapsed into one
interface GroupedBreadcrumbEvent {
  events: BreadcrumbEvent[];
  category: BreadcrumbCategory;
  summary: string;
  detail: string | null;
  firstTime: Date;
  lastTime: Date;
  count: number;
}

export interface ComponentProps {
  events: BreadcrumbEvent[];
  exceptionTime?: Date;
  maxEvents?: number;
}

// --- Categorization helpers ---

type CategorizeEventFunction = (event: BreadcrumbEvent) => BreadcrumbCategory;

const categorizeEvent: CategorizeEventFunction = (
  event: BreadcrumbEvent,
): BreadcrumbCategory => {
  const name: string = (event.name || "").toLowerCase();
  const attrs: JSONObject = event.attributes || {};

  if (name === "exception" || attrs["exception.type"]) {
    return BreadcrumbCategory.Exception;
  }

  if (
    name.includes("http") ||
    attrs["http.method"] ||
    attrs["http.status_code"] ||
    attrs["http.url"]
  ) {
    return BreadcrumbCategory.HTTP;
  }

  if (
    name.includes("db") ||
    name.includes("database") ||
    name.includes("query") ||
    name.includes("sql") ||
    attrs["db.system"] ||
    attrs["db.statement"]
  ) {
    return BreadcrumbCategory.DB;
  }

  if (name.includes("log") || name.includes("console")) {
    return BreadcrumbCategory.Log;
  }

  if (
    name.includes("error") ||
    attrs["level"] === "error" ||
    attrs["severity"] === "error"
  ) {
    return BreadcrumbCategory.Error;
  }

  if (
    name.includes("warn") ||
    attrs["level"] === "warn" ||
    attrs["level"] === "warning" ||
    attrs["severity"] === "warning"
  ) {
    return BreadcrumbCategory.Warning;
  }

  return BreadcrumbCategory.Event;
};

// --- Category colors ---

interface CategoryStyle {
  color: Color;
  icon: IconProp;
  bgClass: string;
  dotClass: string;
  textClass: string;
  borderClass: string;
  lightBgClass: string;
}

type GetCategoryStyleFunction = (category: BreadcrumbCategory) => CategoryStyle;

const getCategoryStyle: GetCategoryStyleFunction = (
  category: BreadcrumbCategory,
): CategoryStyle => {
  switch (category) {
    case BreadcrumbCategory.HTTP:
      return {
        color: Blue500,
        icon: IconProp.Globe,
        bgClass: "bg-blue-50",
        dotClass: "bg-blue-500",
        textClass: "text-blue-800",
        borderClass: "border-l-blue-400",
        lightBgClass: "bg-blue-50/50",
      };
    case BreadcrumbCategory.DB:
      return {
        color: Purple500,
        icon: IconProp.Database,
        bgClass: "bg-purple-50",
        dotClass: "bg-purple-500",
        textClass: "text-purple-800",
        borderClass: "border-l-purple-400",
        lightBgClass: "bg-purple-50/50",
      };
    case BreadcrumbCategory.Log:
      return {
        color: Gray500,
        icon: IconProp.Terminal,
        bgClass: "bg-gray-50",
        dotClass: "bg-gray-400",
        textClass: "text-gray-700",
        borderClass: "border-l-gray-300",
        lightBgClass: "bg-gray-50/50",
      };
    case BreadcrumbCategory.Error:
      return {
        color: Red500,
        icon: IconProp.Alert,
        bgClass: "bg-red-50",
        dotClass: "bg-red-500",
        textClass: "text-red-800",
        borderClass: "border-l-red-400",
        lightBgClass: "bg-red-50/50",
      };
    case BreadcrumbCategory.Warning:
      return {
        color: Yellow500,
        icon: IconProp.Alert,
        bgClass: "bg-yellow-50",
        dotClass: "bg-yellow-500",
        textClass: "text-yellow-800",
        borderClass: "border-l-yellow-400",
        lightBgClass: "bg-yellow-50/50",
      };
    case BreadcrumbCategory.Exception:
      return {
        color: Red500,
        icon: IconProp.Error,
        bgClass: "bg-red-100",
        dotClass: "bg-red-600",
        textClass: "text-red-900",
        borderClass: "border-l-red-500",
        lightBgClass: "bg-red-50",
      };
    case BreadcrumbCategory.Event:
    default:
      return {
        color: Green500,
        icon: IconProp.Info,
        bgClass: "bg-green-50",
        dotClass: "bg-green-500",
        textClass: "text-green-800",
        borderClass: "border-l-green-400",
        lightBgClass: "bg-green-50/50",
      };
  }
};

// --- Event summary extraction ---

type GetEventSummaryFunction = (event: BreadcrumbEvent) => string;

const getEventSummary: GetEventSummaryFunction = (
  event: BreadcrumbEvent,
): string => {
  const attrs: JSONObject = event.attributes || {};

  if (attrs["http.method"] || attrs["http.url"]) {
    const method: string = (attrs["http.method"] as string) || "";
    const url: string = (attrs["http.url"] as string) || "";
    const status: string = attrs["http.status_code"]
      ? ` → ${attrs["http.status_code"]}`
      : "";
    return `${method} ${url}${status}`.trim();
  }

  if (attrs["db.statement"]) {
    const statement: string = (attrs["db.statement"] as string) || "";
    return statement.length > 100
      ? statement.substring(0, 100) + "..."
      : statement;
  }

  if (attrs["exception.message"]) {
    const msg: string = (attrs["exception.message"] as string) || "";
    return msg.length > 120 ? msg.substring(0, 120) + "..." : msg;
  }

  return event.name || "Event";
};

type GetEventDetailFunction = (event: BreadcrumbEvent) => string | null;

const getEventDetail: GetEventDetailFunction = (
  event: BreadcrumbEvent,
): string | null => {
  const attrs: JSONObject = event.attributes || {};

  if (attrs["exception.type"]) {
    return attrs["exception.type"] as string;
  }

  if (attrs["http.status_code"]) {
    const code: number = attrs["http.status_code"] as number;
    if (code >= 400) {
      return `HTTP ${code}`;
    }
  }

  return null;
};

// --- Time formatting ---

type FormatRelativeTimeFunction = (
  eventTime: Date,
  exceptionTime: Date | undefined,
) => string;

const formatRelativeTime: FormatRelativeTimeFunction = (
  eventTime: Date,
  exceptionTime: Date | undefined,
): string => {
  if (!exceptionTime) {
    return OneUptimeDate.getDateAsLocalFormattedString(eventTime);
  }

  const diffMs: number = eventTime.getTime() - exceptionTime.getTime();
  const absDiffMs: number = Math.abs(diffMs);

  if (absDiffMs < 10) {
    return "at exception";
  }

  if (absDiffMs < 1000) {
    const prefix: string = diffMs <= 0 ? "-" : "+";
    return `${prefix}${absDiffMs}ms`;
  }

  const seconds: number = Math.floor(absDiffMs / 1000);
  if (seconds < 60) {
    const prefix: string = diffMs <= 0 ? "-" : "+";
    return `${prefix}${seconds}s`;
  }

  const minutes: number = Math.floor(seconds / 60);
  const remainingSeconds: number = seconds % 60;
  const prefix: string = diffMs <= 0 ? "-" : "+";
  if (remainingSeconds === 0) {
    return `${prefix}${minutes}m`;
  }
  return `${prefix}${minutes}m ${remainingSeconds}s`;
};

type FormatAbsoluteTimeFunction = (eventTime: Date) => string;

const formatAbsoluteTime: FormatAbsoluteTimeFunction = (
  eventTime: Date,
): string => {
  return OneUptimeDate.getDateAsLocalFormattedString(eventTime);
};

// --- Grouping logic ---

type GroupEventsFunction = (
  events: BreadcrumbEvent[],
) => GroupedBreadcrumbEvent[];

const groupConsecutiveEvents: GroupEventsFunction = (
  events: BreadcrumbEvent[],
): GroupedBreadcrumbEvent[] => {
  if (events.length === 0) {
    return [];
  }

  const groups: GroupedBreadcrumbEvent[] = [];
  let currentGroup: GroupedBreadcrumbEvent | null = null;

  for (const event of events) {
    const category: BreadcrumbCategory = categorizeEvent(event);
    const summary: string = getEventSummary(event);
    const detail: string | null = getEventDetail(event);

    // Group if same category + same summary text (identical events)
    if (
      currentGroup &&
      currentGroup.category === category &&
      currentGroup.summary === summary
    ) {
      currentGroup.events.push(event);
      currentGroup.lastTime = event.time;
      currentGroup.count = currentGroup.count + 1;
    } else {
      // Start a new group
      currentGroup = {
        events: [event],
        category: category,
        summary: summary,
        detail: detail,
        firstTime: event.time,
        lastTime: event.time,
        count: 1,
      };
      groups.push(currentGroup);
    }
  }

  return groups;
};

// --- Get relevant attributes for display ---

type GetDisplayAttributesFunction = (
  event: BreadcrumbEvent,
) => Array<{ key: string; value: string }>;

const getDisplayAttributes: GetDisplayAttributesFunction = (
  event: BreadcrumbEvent,
): Array<{ key: string; value: string }> => {
  const attrs: JSONObject = event.attributes || {};
  const result: Array<{ key: string; value: string }> = [];

  // Skip internal/noisy attribute keys
  const skipKeys: Set<string> = new Set([
    "exception.escaped",
    "exception.stacktrace",
  ]);

  for (const key of Object.keys(attrs)) {
    if (skipKeys.has(key)) {
      continue;
    }

    const value: JSONValue = attrs[key] as JSONValue;
    if (value === null || value === undefined || value === "") {
      continue;
    }

    const stringValue: string =
      typeof value === "object" ? JSON.stringify(value) : String(value);

    result.push({ key, value: stringValue });
  }

  return result;
};

// --- Sub-component: Category filter bar ---

interface CategoryFilterProps {
  categoryCounts: Map<BreadcrumbCategory, number>;
  activeFilters: Set<BreadcrumbCategory>;
  onToggleFilter: (category: BreadcrumbCategory) => void;
  onClearFilters: () => void;
}

const CategoryFilterBar: FunctionComponent<CategoryFilterProps> = ({
  categoryCounts,
  activeFilters,
  onToggleFilter,
  onClearFilters,
}: CategoryFilterProps): ReactElement => {
  const allCategories: BreadcrumbCategory[] = [
    BreadcrumbCategory.Exception,
    BreadcrumbCategory.Error,
    BreadcrumbCategory.Warning,
    BreadcrumbCategory.HTTP,
    BreadcrumbCategory.DB,
    BreadcrumbCategory.Log,
    BreadcrumbCategory.Event,
  ];

  const hasFilters: boolean = activeFilters.size > 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-5 py-3 border-b border-gray-100 bg-gray-50/50">
      <span className="text-xs font-medium text-gray-500 mr-1">Filter:</span>
      {allCategories
        .filter((cat: BreadcrumbCategory) => {
          return (categoryCounts.get(cat) || 0) > 0;
        })
        .map((cat: BreadcrumbCategory): ReactElement => {
          const style: CategoryStyle = getCategoryStyle(cat);
          const count: number = categoryCounts.get(cat) || 0;
          const isActive: boolean = activeFilters.has(cat);

          return (
            <button
              key={cat}
              onClick={() => {
                return onToggleFilter(cat);
              }}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-all cursor-pointer ${
                isActive
                  ? "ring-2 ring-offset-1 ring-indigo-300 border-indigo-300"
                  : hasFilters
                    ? "opacity-40 border-gray-200 hover:opacity-70"
                    : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <Pill text={cat} color={style.color} size={PillSize.Small} />
              <span className="text-gray-500 ml-0.5">{count}</span>
            </button>
          );
        })}

      {hasFilters && (
        <button
          onClick={onClearFilters}
          className="ml-2 text-xs text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer"
        >
          Clear
        </button>
      )}
    </div>
  );
};

// --- Sub-component: Attribute detail table ---

interface AttributeTableProps {
  attributes: Array<{ key: string; value: string }>;
}

const AttributeTable: FunctionComponent<AttributeTableProps> = ({
  attributes,
}: AttributeTableProps): ReactElement => {
  if (attributes.length === 0) {
    return (
      <div className="text-xs text-gray-400 italic py-2 px-3">
        No attributes.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-gray-200 overflow-hidden mt-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-3 py-1.5 font-semibold text-gray-600 w-1/3">
              Attribute
            </th>
            <th className="text-left px-3 py-1.5 font-semibold text-gray-600">
              Value
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {attributes.map(
            (attr: { key: string; value: string }, i: number): ReactElement => {
              return (
                <tr key={i} className="hover:bg-gray-50/50">
                  <td className="px-3 py-1.5 font-mono text-gray-500 align-top whitespace-nowrap">
                    {attr.key}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-gray-800 break-all">
                    {attr.value}
                  </td>
                </tr>
              );
            },
          )}
        </tbody>
      </table>
    </div>
  );
};

// --- Sub-component: Single timeline row ---

interface TimelineRowProps {
  group: GroupedBreadcrumbEvent;
  isExpanded: boolean;
  onToggle: () => void;
  isLast: boolean;
  exceptionTime: Date | undefined;
}

const TimelineRow: FunctionComponent<TimelineRowProps> = ({
  group,
  isExpanded,
  onToggle,
  isLast,
  exceptionTime,
}: TimelineRowProps): ReactElement => {
  const style: CategoryStyle = getCategoryStyle(group.category);
  const isException: boolean =
    group.category === BreadcrumbCategory.Exception ||
    group.category === BreadcrumbCategory.Error;
  const hasAttributes: boolean =
    getDisplayAttributes(group.events[0]!).length > 0;
  const isClickable: boolean = hasAttributes || group.count > 1;

  return (
    <div className="relative">
      {/* Main row */}
      <div
        className={`relative flex items-stretch transition-colors ${
          isException ? style.lightBgClass : "hover:bg-gray-50/80"
        } ${isClickable ? "cursor-pointer" : ""}`}
        onClick={() => {
          if (isClickable) {
            onToggle();
          }
        }}
      >
        {/* Colored left border accent */}
        <div
          className={`w-1 flex-shrink-0 rounded-l ${
            isException ? style.borderClass.replace("border-l-", "bg-") : ""
          }`}
          style={{
            backgroundColor: isException ? undefined : style.color.toString(),
            opacity: isException ? undefined : 0.3,
          }}
        />

        {/* Timeline column with dot and connector */}
        <div className="flex flex-col items-center w-10 flex-shrink-0 relative">
          {/* Top connector line */}
          <div
            className="w-px flex-1 bg-gray-200"
            style={{ minHeight: "8px" }}
          />
          {/* Dot */}
          <div className="relative z-10 my-0.5">
            <div
              className={`w-3 h-3 rounded-full ring-2 ring-white ${style.dotClass}`}
            />
          </div>
          {/* Bottom connector line */}
          {!isLast ? (
            <div className="w-px flex-1 bg-gray-200" />
          ) : (
            <div className="flex-1" />
          )}
        </div>

        {/* Content area */}
        <div className="flex-1 min-w-0 flex items-center py-2.5 pr-4 gap-3">
          {/* Icon */}
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${style.bgClass}`}
          >
            <Icon
              icon={style.icon}
              size={SizeProp.Smaller}
              color={style.color}
              thick={ThickProp.LessThick}
            />
          </div>

          {/* Category + Count badge */}
          <div className="flex-shrink-0 flex items-center gap-1.5">
            <Pill
              text={group.category}
              color={style.color}
              size={PillSize.Small}
            />
            {group.count > 1 && (
              <span className="inline-flex items-center justify-center px-1.5 py-0 rounded-full text-[10px] font-bold bg-gray-200 text-gray-700 min-w-[20px]">
                ×{group.count}
              </span>
            )}
          </div>

          {/* Summary text */}
          <div className="flex-1 min-w-0">
            <div
              className={`text-sm font-mono truncate ${
                isException
                  ? "font-semibold " + style.textClass
                  : "text-gray-800"
              }`}
            >
              {group.summary}
            </div>
            {group.detail && !isExpanded && (
              <div
                className={`text-xs mt-0.5 ${isException ? "text-red-600/70" : "text-gray-400"}`}
              >
                {group.detail}
              </div>
            )}
          </div>

          {/* Timestamp */}
          <Tooltip text={formatAbsoluteTime(group.firstTime)}>
            <div
              className={`flex-shrink-0 text-xs font-mono whitespace-nowrap ${
                isException ? "text-red-400" : "text-gray-400"
              }`}
            >
              {formatRelativeTime(group.firstTime, exceptionTime)}
              {group.count > 1 && group.firstTime !== group.lastTime && (
                <span className="text-gray-300 ml-1">
                  → {formatRelativeTime(group.lastTime, exceptionTime)}
                </span>
              )}
            </div>
          </Tooltip>

          {/* Expand chevron */}
          {isClickable && (
            <div className="flex-shrink-0 ml-1">
              <Icon
                icon={isExpanded ? IconProp.ChevronDown : IconProp.ChevronRight}
                size={SizeProp.Smaller}
                className="text-gray-300"
              />
            </div>
          )}
        </div>
      </div>

      {/* Expanded detail panel */}
      {isExpanded && (
        <div className="relative flex">
          {/* Left border continuation */}
          <div
            className="w-1 flex-shrink-0"
            style={{
              backgroundColor: style.color.toString(),
              opacity: 0.15,
            }}
          />
          {/* Timeline connector */}
          <div className="flex flex-col items-center w-10 flex-shrink-0">
            <div className="w-px flex-1 bg-gray-200" />
          </div>
          {/* Detail content */}
          <div className="flex-1 min-w-0 pb-3 pr-5 pt-1">
            {/* Detail subtitle for exception */}
            {group.detail && (
              <div className={`text-xs font-semibold mb-2 ${style.textClass}`}>
                {group.detail}
              </div>
            )}

            {/* Attributes of first event */}
            <AttributeTable
              attributes={getDisplayAttributes(group.events[0]!)}
            />

            {/* If grouped, show individual occurrence timestamps */}
            {group.count > 1 && (
              <div className="mt-3">
                <div className="text-xs font-semibold text-gray-500 mb-1.5">
                  {group.count} occurrences:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {group.events.map(
                    (ev: BreadcrumbEvent, i: number): ReactElement => {
                      return (
                        <Tooltip key={i} text={formatAbsoluteTime(ev.time)}>
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 text-[10px] font-mono text-gray-600">
                            {formatRelativeTime(ev.time, exceptionTime)}
                          </span>
                        </Tooltip>
                      );
                    },
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// --- Main component ---

const BreadcrumbTimeline: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const maxEvents: number = props.maxEvents || 50;

  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<BreadcrumbCategory>>(
    new Set(),
  );

  // Sort events by time ascending
  const sortedEvents: BreadcrumbEvent[] = useMemo((): BreadcrumbEvent[] => {
    return [...props.events]
      .sort((a: BreadcrumbEvent, b: BreadcrumbEvent) => {
        return a.timeUnixNano - b.timeUnixNano;
      })
      .slice(-maxEvents);
  }, [props.events, maxEvents]);

  // Category counts for filter bar
  const categoryCounts: Map<BreadcrumbCategory, number> = useMemo((): Map<
    BreadcrumbCategory,
    number
  > => {
    const counts: Map<BreadcrumbCategory, number> = new Map();
    for (const event of sortedEvents) {
      const cat: BreadcrumbCategory = categorizeEvent(event);
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    return counts;
  }, [sortedEvents]);

  // Filtered events
  const filteredEvents: BreadcrumbEvent[] = useMemo((): BreadcrumbEvent[] => {
    if (activeFilters.size === 0) {
      return sortedEvents;
    }
    return sortedEvents.filter((ev: BreadcrumbEvent) => {
      return activeFilters.has(categorizeEvent(ev));
    });
  }, [sortedEvents, activeFilters]);

  // Group consecutive identical events
  const groupedEvents: GroupedBreadcrumbEvent[] =
    useMemo((): GroupedBreadcrumbEvent[] => {
      return groupConsecutiveEvents(filteredEvents);
    }, [filteredEvents]);

  // Has multiple categories (show filter bar only if useful)
  const hasMultipleCategories: boolean = categoryCounts.size > 1;

  type ToggleFilterFunction = (category: BreadcrumbCategory) => void;

  const toggleFilter: ToggleFilterFunction = (
    category: BreadcrumbCategory,
  ): void => {
    setActiveFilters((prev: Set<BreadcrumbCategory>) => {
      const next: Set<BreadcrumbCategory> = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
    setExpandedIndex(null);
  };

  const totalEventsLabel: string =
    activeFilters.size > 0
      ? `${filteredEvents.length} of ${sortedEvents.length} events (filtered)`
      : `${sortedEvents.length} events leading up to the exception`;

  if (sortedEvents.length === 0) {
    return (
      <Card
        title="Breadcrumbs"
        description="Events leading up to the exception."
      >
        <div className="flex flex-col items-center justify-center py-12 px-4">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
            <Icon
              icon={IconProp.QueueList}
              size={SizeProp.Regular}
              className="text-gray-400"
            />
          </div>
          <p className="text-sm font-medium text-gray-500">No breadcrumbs</p>
          <p className="text-xs text-gray-400 mt-1">
            No events were captured leading up to this exception.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Breadcrumbs" description={totalEventsLabel}>
      <div className="overflow-hidden">
        {/* Category filter bar */}
        {hasMultipleCategories && (
          <CategoryFilterBar
            categoryCounts={categoryCounts}
            activeFilters={activeFilters}
            onToggleFilter={toggleFilter}
            onClearFilters={() => {
              setActiveFilters(new Set());
              setExpandedIndex(null);
            }}
          />
        )}

        {/* Summary stats row */}
        <div className="flex items-center gap-4 px-5 py-2 border-b border-gray-100 text-xs text-gray-400">
          <span>
            {groupedEvents.length} group{groupedEvents.length !== 1 ? "s" : ""}
            {groupedEvents.length < filteredEvents.length && (
              <span className="text-gray-300">
                {" "}
                ({filteredEvents.length - groupedEvents.length} collapsed)
              </span>
            )}
          </span>
          {props.exceptionTime && (
            <span className="ml-auto font-mono">
              Time relative to exception
            </span>
          )}
        </div>

        {/* Timeline events */}
        <div className="divide-y divide-gray-100/80">
          {groupedEvents.map(
            (group: GroupedBreadcrumbEvent, index: number): ReactElement => {
              return (
                <TimelineRow
                  key={index}
                  group={group}
                  isExpanded={expandedIndex === index}
                  onToggle={() => {
                    setExpandedIndex(expandedIndex === index ? null : index);
                  }}
                  isLast={index === groupedEvents.length - 1}
                  exceptionTime={props.exceptionTime}
                />
              );
            },
          )}
        </div>

        {/* Filtered empty state */}
        {groupedEvents.length === 0 && activeFilters.size > 0 && (
          <div className="flex flex-col items-center justify-center py-8 px-4">
            <p className="text-sm text-gray-500">
              No events match the selected filters.
            </p>
            <button
              onClick={() => {
                setActiveFilters(new Set());
              }}
              className="mt-2 text-sm text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>
    </Card>
  );
};

export default BreadcrumbTimeline;
