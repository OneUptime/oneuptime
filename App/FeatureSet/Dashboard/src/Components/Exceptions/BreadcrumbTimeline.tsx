import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import {
  BREADCRUMB_CATEGORY_LABELS,
  BREADCRUMB_CATEGORY_ORDER,
  BreadcrumbAttribute,
  BreadcrumbCategory,
  BreadcrumbGroup,
  categorizeBreadcrumb,
  countBreadcrumbCategories,
  describeBreadcrumbWindow,
  formatBreadcrumbClockTime,
  formatBreadcrumbOffset,
  getBreadcrumbAttributes,
  groupBreadcrumbEvents,
  sortBreadcrumbEvents,
} from "../../Utils/BreadcrumbTimelinePresentation";
import ExceptionSegmentedControl from "./ExceptionSegmentedControl";

export { BreadcrumbCategory };

export interface BreadcrumbEvent {
  name: string;
  time: Date;
  timeUnixNano: number;
  attributes: JSONObject;
}

export interface ComponentProps {
  events: Array<BreadcrumbEvent>;
  exceptionTime?: Date;
  maxEvents?: number;
}

type TimeFormat = "relative" | "clock";

interface CategoryStyle {
  icon: IconProp;
  nodeClassName: string;
  labelClassName: string;
  chipClassName: string;
}

export const BREADCRUMB_CATEGORY_STYLES: Record<
  BreadcrumbCategory,
  CategoryStyle
> = {
  [BreadcrumbCategory.Exception]: {
    icon: IconProp.Error,
    nodeClassName: "bg-red-600 text-white ring-red-100",
    labelClassName: "text-red-700",
    chipClassName: "bg-red-50 text-red-700 ring-red-600/20",
  },
  [BreadcrumbCategory.Error]: {
    icon: IconProp.Alert,
    nodeClassName: "bg-red-50 text-red-600 ring-white",
    labelClassName: "text-red-700",
    chipClassName: "bg-red-50 text-red-700 ring-red-600/20",
  },
  [BreadcrumbCategory.Warning]: {
    icon: IconProp.Alert,
    nodeClassName: "bg-amber-50 text-amber-600 ring-white",
    labelClassName: "text-amber-700",
    chipClassName: "bg-amber-50 text-amber-700 ring-amber-600/20",
  },
  [BreadcrumbCategory.HTTP]: {
    icon: IconProp.Globe,
    nodeClassName: "bg-sky-50 text-sky-600 ring-white",
    labelClassName: "text-sky-700",
    chipClassName: "bg-sky-50 text-sky-700 ring-sky-600/20",
  },
  [BreadcrumbCategory.DB]: {
    icon: IconProp.Database,
    nodeClassName: "bg-violet-50 text-violet-600 ring-white",
    labelClassName: "text-violet-700",
    chipClassName: "bg-violet-50 text-violet-700 ring-violet-600/20",
  },
  [BreadcrumbCategory.Log]: {
    icon: IconProp.Terminal,
    nodeClassName: "bg-gray-100 text-gray-600 ring-white",
    labelClassName: "text-gray-600",
    chipClassName: "bg-gray-100 text-gray-700 ring-gray-500/20",
  },
  [BreadcrumbCategory.Event]: {
    icon: IconProp.Info,
    nodeClassName: "bg-emerald-50 text-emerald-600 ring-white",
    labelClassName: "text-emerald-700",
    chipClassName: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  },
};

// --- Category filter chips ---

interface CategoryFilterProps {
  counts: Map<BreadcrumbCategory, number>;
  total: number;
  activeFilters: Set<BreadcrumbCategory>;
  onToggle: (category: BreadcrumbCategory) => void;
  onClear: () => void;
}

const CategoryFilter: FunctionComponent<CategoryFilterProps> = (
  props: CategoryFilterProps,
): ReactElement => {
  const hasFilters: boolean = props.activeFilters.size > 0;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label="Filter breadcrumbs by category"
      data-testid="breadcrumb-filters"
    >
      <button
        type="button"
        aria-pressed={!hasFilters}
        onClick={props.onClear}
        data-testid="breadcrumb-filter-all"
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
          hasFilters
            ? "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"
            : "bg-gray-900 text-white ring-gray-900"
        }`}
      >
        All
        <span className="tabular-nums opacity-70">{props.total}</span>
      </button>
      {BREADCRUMB_CATEGORY_ORDER.filter((category: BreadcrumbCategory) => {
        return (props.counts.get(category) || 0) > 0;
      }).map((category: BreadcrumbCategory): ReactElement => {
        const isActive: boolean = props.activeFilters.has(category);
        const style: CategoryStyle = BREADCRUMB_CATEGORY_STYLES[category];

        return (
          <button
            key={category}
            type="button"
            aria-pressed={isActive}
            data-testid={`breadcrumb-filter-${category}`}
            onClick={() => {
              props.onToggle(category);
            }}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
              isActive
                ? style.chipClassName
                : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"
            }`}
          >
            <Icon icon={style.icon} className="h-3.5 w-3.5" />
            {BREADCRUMB_CATEGORY_LABELS[category]}
            <span className="tabular-nums opacity-70">
              {props.counts.get(category)}
            </span>
          </button>
        );
      })}
    </div>
  );
};

// --- Attributes ---

interface AttributeListProps {
  attributes: Array<BreadcrumbAttribute>;
}

const AttributeList: FunctionComponent<AttributeListProps> = (
  props: AttributeListProps,
): ReactElement => {
  if (props.attributes.length === 0) {
    return (
      <p className="text-xs italic text-gray-500">
        This event carried no attributes.
      </p>
    );
  }

  return (
    <dl
      className="divide-y divide-gray-100 overflow-hidden rounded-lg bg-white ring-1 ring-inset ring-gray-200"
      data-testid="breadcrumb-attributes"
    >
      {props.attributes.map((attribute: BreadcrumbAttribute): ReactElement => {
        return (
          <div
            key={attribute.key}
            className="group flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-4"
          >
            <dt
              className="truncate font-mono text-xs text-gray-500 sm:w-56 sm:flex-shrink-0"
              title={attribute.key}
            >
              {attribute.key}
            </dt>
            <dd className="flex min-w-0 flex-1 items-start gap-2 font-mono text-xs text-gray-900">
              <span className="min-w-0 flex-1 break-all">
                {attribute.value}
              </span>
              <span className="flex-shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <CopyTextButton
                  textToBeCopied={attribute.value}
                  iconOnly={true}
                  size="xs"
                  title={`Copy ${attribute.key}`}
                />
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
};

// --- One timeline row ---

interface TimelineRowProps {
  group: BreadcrumbGroup<BreadcrumbEvent>;
  isExpanded: boolean;
  isLast: boolean;
  onToggle: () => void;
  exceptionTime: Date | undefined;
  timeFormat: TimeFormat;
}

const TimelineRow: FunctionComponent<TimelineRowProps> = (
  props: TimelineRowProps,
): ReactElement => {
  const { group } = props;
  const style: CategoryStyle = BREADCRUMB_CATEGORY_STYLES[group.category];
  const isException: boolean = group.category === BreadcrumbCategory.Exception;
  const attributes: Array<BreadcrumbAttribute> = getBreadcrumbAttributes(
    group.events[0]!,
  );
  const isClickable: boolean = attributes.length > 0 || group.count > 1;

  const formatTime: (time: Date) => string = (time: Date): string => {
    if (props.timeFormat === "relative") {
      return (
        formatBreadcrumbOffset(time, props.exceptionTime) ||
        formatBreadcrumbClockTime(time)
      );
    }

    return formatBreadcrumbClockTime(time);
  };

  const eventName: string = group.events[0]!.name;
  const secondaryParts: Array<string> = [];

  if (eventName && eventName !== group.summary) {
    secondaryParts.push(eventName);
  }

  // The event name and the detail can be the same text; show it once.
  if (group.detail && !secondaryParts.includes(group.detail)) {
    secondaryParts.push(group.detail);
  }

  return (
    <li
      className="relative"
      data-testid="breadcrumb-row"
      data-category={group.category}
    >
      {/* The timeline: a line from this node down to the next one. */}
      {!props.isLast && (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-[1.75rem] top-6 w-px bg-gray-200 md:left-[2rem]"
        />
      )}

      <div
        className={`relative flex items-start gap-3 px-4 py-2.5 transition-colors md:px-5 ${
          isException ? "bg-red-50/70" : isClickable ? "hover:bg-gray-50" : ""
        }`}
      >
        <span
          className={`relative z-10 mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ring-4 ${style.nodeClassName}`}
          data-testid="breadcrumb-node"
        >
          <Icon icon={style.icon} className="h-3.5 w-3.5" />
        </span>

        <div className="min-w-0 flex-1">
          {/*
           * Only the summary is the toggle. The expanded details sit beside
           * it, not inside it, so their values and copy buttons stay separate
           * controls rather than being flattened into the button's name.
           */}
          <div
            className={`-mx-1 rounded-md px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              isClickable ? "cursor-pointer" : ""
            }`}
            {...(isClickable
              ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-expanded": props.isExpanded,
                  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
                    if (event.target !== event.currentTarget) {
                      return;
                    }

                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      props.onToggle();
                    }
                  },
                  onClick: props.onToggle,
                }
              : {})}
          >
            <div className="flex items-start gap-3">
              <p
                className={`min-w-0 flex-1 truncate font-mono text-[13px] leading-6 ${
                  isException ? "font-semibold text-red-800" : "text-gray-900"
                }`}
                title={group.summary}
                data-testid="breadcrumb-summary"
              >
                {group.summary}
              </p>
              <span
                className={`flex-shrink-0 whitespace-nowrap font-mono text-xs leading-6 tabular-nums ${
                  isException ? "font-medium text-red-600" : "text-gray-500"
                }`}
                title={OneUptimeDate.getDateAsLocalFormattedString(
                  group.firstTime,
                )}
                data-testid="breadcrumb-time"
              >
                {formatTime(group.firstTime)}
                {group.count > 1 &&
                  group.firstTime.getTime() !== group.lastTime.getTime() && (
                    <span className="text-gray-400">
                      {" → "}
                      {formatTime(group.lastTime)}
                    </span>
                  )}
              </span>
              {isClickable ? (
                <Icon
                  icon={
                    props.isExpanded
                      ? IconProp.ChevronDown
                      : IconProp.ChevronRight
                  }
                  className="mt-1 h-4 w-4 flex-shrink-0 text-gray-400"
                />
              ) : (
                <span className="w-4 flex-shrink-0" />
              )}
            </div>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-xs">
              <span
                className={`font-semibold uppercase tracking-wide ${style.labelClassName}`}
                data-testid="breadcrumb-category"
              >
                {BREADCRUMB_CATEGORY_LABELS[group.category]}
              </span>
              {group.count > 1 && (
                <span
                  className="rounded-full bg-gray-100 px-1.5 font-semibold tabular-nums text-gray-600"
                  data-testid="breadcrumb-count"
                >
                  ×{group.count}
                </span>
              )}
              {secondaryParts.map((part: string) => {
                return (
                  <span key={part} className="min-w-0 truncate text-gray-500">
                    {part}
                  </span>
                );
              })}
            </div>
          </div>

          {props.isExpanded && (
            <div
              className="mt-3 space-y-3 pb-1"
              data-testid="breadcrumb-detail"
            >
              <AttributeList attributes={attributes} />

              {group.count > 1 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-gray-500">
                    {group.count} identical events
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {group.events.map(
                      (event: BreadcrumbEvent, index: number): ReactElement => {
                        return (
                          <span
                            key={index}
                            title={OneUptimeDate.getDateAsLocalFormattedString(
                              event.time,
                            )}
                            className="rounded bg-white px-2 py-0.5 font-mono text-[11px] text-gray-600 ring-1 ring-inset ring-gray-200"
                          >
                            {formatTime(event.time)}
                          </span>
                        );
                      },
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
};

// --- Main component ---

/*
 * What happened in the trace before the exception: requests, queries, logs
 * and warnings as a vertical timeline, filterable by category, with each
 * event's attributes one click away.
 */
const BreadcrumbTimeline: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const maxEvents: number = props.maxEvents || 50;

  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<BreadcrumbCategory>>(
    new Set(),
  );
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(
    props.exceptionTime ? "relative" : "clock",
  );

  const sortedEvents: Array<BreadcrumbEvent> = useMemo(() => {
    return sortBreadcrumbEvents(props.events, maxEvents);
  }, [props.events, maxEvents]);

  const categoryCounts: Map<BreadcrumbCategory, number> = useMemo(() => {
    return countBreadcrumbCategories(sortedEvents);
  }, [sortedEvents]);

  const filteredEvents: Array<BreadcrumbEvent> = useMemo(() => {
    if (activeFilters.size === 0) {
      return sortedEvents;
    }

    return sortedEvents.filter((event: BreadcrumbEvent) => {
      return activeFilters.has(categorizeBreadcrumb(event));
    });
  }, [sortedEvents, activeFilters]);

  const groups: Array<BreadcrumbGroup<BreadcrumbEvent>> = useMemo(() => {
    return groupBreadcrumbEvents(filteredEvents);
  }, [filteredEvents]);

  const toggleFilter: (category: BreadcrumbCategory) => void = (
    category: BreadcrumbCategory,
  ): void => {
    setActiveFilters((previous: Set<BreadcrumbCategory>) => {
      const next: Set<BreadcrumbCategory> = new Set(previous);

      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }

      return next;
    });
    setExpandedIndex(null);
  };

  const clearFilters: () => void = (): void => {
    setActiveFilters(new Set());
    setExpandedIndex(null);
  };

  if (sortedEvents.length === 0) {
    return (
      <Card
        title="Breadcrumbs"
        description="Events leading up to the exception."
      >
        <div
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 px-6 py-10 text-center"
          data-testid="breadcrumbs-empty"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
            <Icon icon={IconProp.QueueList} className="h-5 w-5 text-gray-400" />
          </div>
          <p className="mt-3 text-sm font-medium text-gray-700">
            No breadcrumbs
          </p>
          <p className="mt-1 text-sm text-gray-500">
            The trace recorded no events leading up to this exception.
          </p>
        </div>
      </Card>
    );
  }

  const description: string = describeBreadcrumbWindow({
    shownCount: sortedEvents.length,
    totalCount: props.events.length,
    ...(activeFilters.size > 0 ? { filteredCount: filteredEvents.length } : {}),
    firstTime: sortedEvents[0]?.time,
    exceptionTime: props.exceptionTime,
  });

  return (
    <Card
      title="Breadcrumbs"
      description={description}
      rightElement={
        props.exceptionTime ? (
          <ExceptionSegmentedControl<TimeFormat>
            label="Breadcrumb time format"
            testId="breadcrumb-time-format"
            value={timeFormat}
            onChange={setTimeFormat}
            options={[
              {
                value: "relative",
                label: "Relative",
                title: "Time before or after the exception",
              },
              { value: "clock", label: "Clock", title: "Local time of day" },
            ]}
          />
        ) : undefined
      }
    >
      <div className="space-y-4">
        {categoryCounts.size > 1 && (
          <CategoryFilter
            counts={categoryCounts}
            total={sortedEvents.length}
            activeFilters={activeFilters}
            onToggle={toggleFilter}
            onClear={clearFilters}
          />
        )}

        {groups.length > 0 ? (
          <ol
            className="-mx-5 divide-y divide-gray-100 border-y border-gray-100 md:-mx-6"
            aria-label="Breadcrumb events"
            data-testid="breadcrumb-timeline"
          >
            {groups.map(
              (
                group: BreadcrumbGroup<BreadcrumbEvent>,
                index: number,
              ): ReactElement => {
                return (
                  <TimelineRow
                    key={`${group.category}-${group.firstTime.getTime()}-${index}`}
                    group={group}
                    isExpanded={expandedIndex === index}
                    isLast={index === groups.length - 1}
                    onToggle={() => {
                      setExpandedIndex(expandedIndex === index ? null : index);
                    }}
                    exceptionTime={props.exceptionTime}
                    timeFormat={timeFormat}
                  />
                );
              },
            )}
          </ol>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 px-4 py-8">
            <p className="text-sm text-gray-500">
              No events match the selected categories.
            </p>
            <button
              type="button"
              onClick={clearFilters}
              className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-500"
            >
              Show all events
            </button>
          </div>
        )}
      </div>
    </Card>
  );
};

export default BreadcrumbTimeline;
