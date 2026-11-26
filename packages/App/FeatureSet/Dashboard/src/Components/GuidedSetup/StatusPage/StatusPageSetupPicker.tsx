import {
  NOTHING_FOUND,
  NO_STATUS_PAGE_SETUP_FILTER,
  STATUS_PAGE_SETUP_COPY,
  StatusPageSetupFilter,
  StatusPageSetupFound,
  StatusPageSetupLabel,
  StatusPageSetupMonitor,
  StatusPageSetupMonitorGroup,
  getLabelsOfList,
  getShownItems,
  isStatusPageSetupFiltered,
  pickShownItems,
  togglePickedMonitor,
} from "./StatusPageSetup";
import StatusPageSetupApi from "./StatusPageSetupApi";
import Color from "Common/Types/Color";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldError from "Common/UI/Components/Forms/Fields/FieldError";
import Input from "Common/UI/Components/Input/Input";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translateRecordName } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * STEP 1'S LIST OF WHAT THE PAGE SHOWS (#6806, #7147): the project's
 * monitor groups, then its monitors, each with a checkbox. None is ticked
 * until the person ticks it (or the website setup handed one in).
 *
 * A busy project's list - longer than its box shows at once - gets a search
 * by name, and a label to narrow it by when its monitors carry labels:
 * "Select all" then picks what the list shows, adding to what was picked,
 * so a label and Select all pick every monitor that carries it. The search
 * and the label are asked of the server, a page of each kind by name
 * (#10580): a monitor is found however many the project has, and a list
 * that matches more than it shows says how many. A monitor
 * group is put on the page as one row (BulkAddStatusPageMonitorGroups).
 * What the page picked already shows (#7517) is ticked and locked, "On the
 * page", and never counted as picked.
 */

// From this many rows the list scrolls in its box, and gets a search.
export const STATUS_PAGE_SETUP_SEARCH_FROM: number = 9;

export interface ComponentProps {
  /*
   * The first page of the project's monitors and monitor groups, by name,
   * and how many it has in all (#10580): the list a search starts from.
   */
  monitors: ReadonlyArray<StatusPageSetupMonitor>;
  monitorGroups: ReadonlyArray<StatusPageSetupMonitorGroup>;
  monitorCount?: number | undefined;
  monitorGroupCount?: number | undefined;
  // Monitor ids and monitor group ids, in the order they were picked.
  picked: ReadonlyArray<string>;
  pickedGroups: ReadonlyArray<string>;
  onPick: (picked: Array<string>, pickedGroups: Array<string>) => void;
  /*
   * What a search found beyond the first page: the setup keeps their names
   * and statuses, for what is picked from them.
   */
  onFound?:
    | ((found: {
        monitors: Array<StatusPageSetupMonitor>;
        monitorGroups: Array<StatusPageSetupMonitorGroup>;
      }) => void)
    | undefined;
  // What the page the monitors go on shows already, by id.
  onThePageMonitorIds?: ReadonlyArray<string> | undefined;
  onThePageGroupIds?: ReadonlyArray<string> | undefined;
  // Nothing picked, said under the list.
  error?: string | undefined;
}

// How long typing pauses before the list is searched.
export const STATUS_PAGE_SETUP_SEARCH_DEBOUNCE_MS: number = 250;

const linkClassName: string =
  "text-sm font-medium text-indigo-600 hover:text-indigo-800 underline-offset-2 hover:underline";

// Each label once, by name: the project's and those the list's records carry.
const mergeLabels: (
  first: ReadonlyArray<StatusPageSetupLabel>,
  second: ReadonlyArray<StatusPageSetupLabel>,
) => Array<StatusPageSetupLabel> = (
  first: ReadonlyArray<StatusPageSetupLabel>,
  second: ReadonlyArray<StatusPageSetupLabel>,
): Array<StatusPageSetupLabel> => {
  const byId: Map<string, StatusPageSetupLabel> = new Map<
    string,
    StatusPageSetupLabel
  >();

  for (const label of [...first, ...second]) {
    if (label.id && !byId.has(label.id)) {
      byId.set(label.id, label);
    }
  }

  return Array.from(byId.values()).sort(
    (a: StatusPageSetupLabel, b: StatusPageSetupLabel): number => {
      return a.name.localeCompare(b.name);
    },
  );
};

const StatusPageSetupPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [filter, setFilter] = useState<StatusPageSetupFilter>(
    NO_STATUS_PAGE_SETUP_FILTER,
  );
  /*
   * What the server found for the filter, a page of each kind, by name;
   * null while nothing is typed and no label picked (the first page shows).
   */
  const [found, setFound] = useState<{
    monitors: StatusPageSetupFound<StatusPageSetupMonitor>;
    monitorGroups: StatusPageSetupFound<StatusPageSetupMonitorGroup>;
  } | null>(null);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  // The project's labels, read once the list is long enough to narrow.
  const [projectLabels, setProjectLabels] = useState<
    Array<StatusPageSetupLabel>
  >([]);
  // Only the latest search may write the list.
  const searchIdRef: MutableRefObject<number> = useRef<number>(0);

  const onPageMonitors: ReadonlyArray<string> = props.onThePageMonitorIds || [];
  const onPageGroups: ReadonlyArray<string> = props.onThePageGroupIds || [];

  const monitorTotal: number = Math.max(
    props.monitorCount ?? 0,
    props.monitors.length,
  );
  const groupTotal: number = Math.max(
    props.monitorGroupCount ?? 0,
    props.monitorGroups.length,
  );
  const rowCount: number = monitorTotal + groupTotal;
  const isLong: boolean = rowCount >= STATUS_PAGE_SETUP_SEARCH_FROM;
  const isFiltered: boolean = isStatusPageSetupFiltered(filter);

  // The filter, searched on the server once typing pauses.
  useEffect(() => {
    const searchId: number = ++searchIdRef.current;

    if (!isStatusPageSetupFiltered(filter)) {
      setFound(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      Promise.all([
        StatusPageSetupApi.searchMonitors(filter),
        // A read of the groups the person may not make: monitors alone.
        StatusPageSetupApi.searchMonitorGroups(filter).catch(() => {
          return NOTHING_FOUND as StatusPageSetupFound<StatusPageSetupMonitorGroup>;
        }),
      ])
        .then(
          ([monitors, monitorGroups]: [
            StatusPageSetupFound<StatusPageSetupMonitor>,
            StatusPageSetupFound<StatusPageSetupMonitorGroup>,
          ]) => {
            if (searchId !== searchIdRef.current) {
              return;
            }

            setFound({ monitors: monitors, monitorGroups: monitorGroups });
            setIsSearching(false);
            props.onFound?.({
              monitors: monitors.items,
              monitorGroups: monitorGroups.items,
            });
          },
        )
        .catch(() => {
          if (searchId === searchIdRef.current) {
            setFound({
              monitors:
                NOTHING_FOUND as StatusPageSetupFound<StatusPageSetupMonitor>,
              monitorGroups:
                NOTHING_FOUND as StatusPageSetupFound<StatusPageSetupMonitorGroup>,
            });
            setIsSearching(false);
          }
        });
    }, STATUS_PAGE_SETUP_SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [filter.search, filter.labelId]);

  // The project's labels, once a list long enough to narrow is drawn.
  useEffect(() => {
    if (!isLong) {
      return;
    }

    let isCurrent: boolean = true;

    StatusPageSetupApi.loadLabels()
      .then((labels: Array<StatusPageSetupLabel> | undefined) => {
        if (isCurrent) {
          setProjectLabels(labels || []);
        }
      })
      .catch(() => {
        // The labels the list's own records carry still narrow it.
      });

    return () => {
      isCurrent = false;
    };
  }, [isLong]);

  // The rows to list: what the search found, or the first page.
  const listedMonitors: ReadonlyArray<StatusPageSetupMonitor> = found
    ? found.monitors.items
    : props.monitors;
  const listedGroups: ReadonlyArray<StatusPageSetupMonitorGroup> = found
    ? found.monitorGroups.items
    : props.monitorGroups;

  const labels: Array<StatusPageSetupLabel> = mergeLabels(
    projectLabels,
    getLabelsOfList({
      monitors: [...props.monitors, ...listedMonitors],
      monitorGroups: [...props.monitorGroups, ...listedGroups],
    }),
  );

  /*
   * The server searched by name and label; the same filter here keeps the
   * rows a search typed since has not reached yet out of the list.
   */
  const shownGroups: Array<StatusPageSetupMonitorGroup> = getShownItems({
    items: listedGroups,
    filter: filter,
  });
  const shownMonitors: Array<StatusPageSetupMonitor> = getShownItems({
    items: listedMonitors,
    filter: filter,
  });

  // How many match in all, and whether the list shows each of them.
  const matchCount: number = found
    ? Math.max(found.monitors.count, found.monitors.items.length) +
      Math.max(found.monitorGroups.count, found.monitorGroups.items.length)
    : rowCount;
  const shownCount: number = shownMonitors.length + shownGroups.length;

  /*
   * What can be picked: everything but what the page shows already - every
   * monitor and group of the project, not only the ones listed.
   */
  const pickableCount: number =
    Math.max(0, monitorTotal - onPageMonitors.length) +
    Math.max(0, groupTotal - onPageGroups.length);
  const shownPickableCount: number =
    shownMonitors.filter((monitor: StatusPageSetupMonitor): boolean => {
      return !onPageMonitors.includes(monitor.id);
    }).length +
    shownGroups.filter((group: StatusPageSetupMonitorGroup): boolean => {
      return !onPageGroups.includes(group.id);
    }).length;
  const pickedCount: number = props.picked.length + props.pickedGroups.length;

  const labelOptions: Array<DropdownOption> = labels.map(
    (label: StatusPageSetupLabel): DropdownOption => {
      return {
        value: label.id,
        // A label's name as the project wrote it.
        label: label.name,
        isUserContent: true,
        ...(label.color ? { color: new Color(label.color) } : {}),
        // Two labels of one name told apart in the picker (#10314).
        ...(label.sharedName ? { sharedName: label.sharedName } : {}),
      };
    },
  );

  const onThePage: ReactElement = (
    <span className="flex-shrink-0 text-sm text-gray-500">
      {translator.translateText(STATUS_PAGE_SETUP_COPY.onThePage)}
    </span>
  );

  const searchLabel: string =
    translator.translateText(STATUS_PAGE_SETUP_COPY.searchPlaceholder) || "";

  return (
    <fieldset>
      <legend className="block text-sm font-medium text-gray-700">
        {translator.translateText(STATUS_PAGE_SETUP_COPY.monitorsLabel)}
      </legend>
      <p className="mt-1 text-sm text-gray-500">
        {translator.translateText(STATUS_PAGE_SETUP_COPY.monitorsHelp)}
      </p>
      {isLong ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0 sm:flex-1">
            <Input
              isSearchOrFilter={true}
              value={filter.search}
              placeholder={STATUS_PAGE_SETUP_COPY.searchPlaceholder}
              ariaLabel={searchLabel}
              onChange={(value: string) => {
                setFilter({ ...filter, search: value });
              }}
              disableSpellCheck={true}
              dataTestId="guided-setup-search"
            />
          </div>
          {labelOptions.length > 0 ? (
            <div
              className="min-w-0 sm:w-72"
              data-testid="guided-setup-label-filter"
            >
              <Dropdown
                options={labelOptions}
                value={labelOptions.find((option: DropdownOption): boolean => {
                  return option.value === filter.labelId;
                })}
                placeholder={STATUS_PAGE_SETUP_COPY.labelPlaceholder}
                ariaLabel={STATUS_PAGE_SETUP_COPY.labelFilterLabel}
                isClearable={true}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  setFilter({
                    ...filter,
                    labelId: typeof value === "string" ? value : null,
                  });
                }}
              />
            </div>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {shownPickableCount > 0 ? (
          <button
            type="button"
            className={linkClassName}
            data-testid="guided-setup-select-all"
            onClick={() => {
              props.onPick(
                pickShownItems({
                  picked: props.picked,
                  shown: shownMonitors,
                  onThePage: onPageMonitors,
                }),
                pickShownItems({
                  picked: props.pickedGroups,
                  shown: shownGroups,
                  onThePage: onPageGroups,
                }),
              );
            }}
          >
            {translator.translateText(STATUS_PAGE_SETUP_COPY.selectAll)}
          </button>
        ) : (
          <></>
        )}
        {pickedCount > 0 ? (
          <button
            type="button"
            className={linkClassName}
            data-testid="guided-setup-clear-all"
            onClick={() => {
              props.onPick([], []);
            }}
          >
            {translator.translateText(STATUS_PAGE_SETUP_COPY.clearAll)}
          </button>
        ) : (
          <></>
        )}
        <span
          className="text-sm text-gray-500"
          data-testid="guided-setup-picked-count"
          aria-live="polite"
        >
          {translator.translatePlural(
            {
              one: "{{count}} of {{total}} picked",
              other: "{{count}} of {{total}} picked",
            },
            pickedCount,
            { total: translator.formatNumber(pickableCount) },
          )}
        </span>
      </div>
      <ul
        className="mt-2 max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200"
        data-testid="guided-setup-monitors"
      >
        {shownGroups.map((group: StatusPageSetupMonitorGroup) => {
          const isOnPage: boolean = onPageGroups.includes(group.id);

          return (
            <li
              key={`group-${group.id}`}
              className="flex items-center justify-between gap-3 px-3 py-2"
              data-testid={`guided-setup-monitor-group-row-${group.id}`}
            >
              <CheckboxElement
                title={group.name}
                isTitleUserContent={true}
                value={isOnPage || props.pickedGroups.includes(group.id)}
                disabled={isOnPage}
                onChange={() => {
                  props.onPick(
                    [...props.picked],
                    togglePickedMonitor({
                      picked: props.pickedGroups,
                      monitorId: group.id,
                    }),
                  );
                }}
                dataTestId={`guided-setup-monitor-group-${group.id}`}
              />
              {isOnPage ? (
                onThePage
              ) : (
                <Pill
                  text={STATUS_PAGE_SETUP_COPY.monitorGroupKind}
                  tone={PillTone.Neutral}
                  isDotHidden={true}
                  className="flex-shrink-0"
                />
              )}
            </li>
          );
        })}
        {shownMonitors.map((monitor: StatusPageSetupMonitor) => {
          const isOnPage: boolean = onPageMonitors.includes(monitor.id);

          return (
            <li
              key={`monitor-${monitor.id}`}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <CheckboxElement
                title={monitor.name}
                isTitleUserContent={true}
                value={isOnPage || props.picked.includes(monitor.id)}
                disabled={isOnPage}
                onChange={() => {
                  props.onPick(
                    togglePickedMonitor({
                      picked: props.picked,
                      monitorId: monitor.id,
                    }),
                    [...props.pickedGroups],
                  );
                }}
                dataTestId={`guided-setup-monitor-${monitor.id}`}
              />
              {isOnPage ? (
                onThePage
              ) : monitor.statusName ? (
                <span className="flex-shrink-0 text-sm text-gray-500">
                  {translateRecordName(
                    translator,
                    StateListType.MonitorStatus,
                    monitor.statusName,
                  )}
                </span>
              ) : (
                <></>
              )}
            </li>
          );
        })}
        {isFiltered &&
        !isSearching &&
        shownGroups.length + shownMonitors.length === 0 ? (
          <li
            className="px-3 py-3 text-sm text-gray-500"
            data-testid="guided-setup-no-match"
          >
            {translator.translateText(STATUS_PAGE_SETUP_COPY.noMatch)}
          </li>
        ) : (
          <></>
        )}
      </ul>
      {/*
       * More match than one read lists (#10580): how many, and how to find
       * the rest - typing more of a name, or a label, narrows them.
       */}
      {!isSearching && shownCount > 0 && matchCount > shownCount ? (
        <p
          className="mt-2 text-xs text-gray-500"
          data-testid="guided-setup-more"
        >
          {translator.translateTemplate(
            "Showing {{shown}} of {{total}}. Type to narrow the list.",
            {
              shown: translator.formatNumber(shownCount),
              total: translator.formatNumber(matchCount),
            },
          )}
        </p>
      ) : (
        <></>
      )}
      {props.error ? (
        <FieldError message={props.error} className="mt-2 text-sm" />
      ) : (
        <></>
      )}
    </fieldset>
  );
};

export default StatusPageSetupPicker;
