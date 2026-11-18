import {
  NO_STATUS_PAGE_SETUP_FILTER,
  STATUS_PAGE_SETUP_COPY,
  StatusPageSetupFilter,
  StatusPageSetupLabel,
  StatusPageSetupMonitor,
  StatusPageSetupMonitorGroup,
  getLabelsOfList,
  getShownItems,
  isStatusPageSetupFiltered,
  pickShownItems,
  togglePickedMonitor,
} from "./StatusPageSetup";
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
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * STEP 1'S LIST OF WHAT THE PAGE SHOWS (#6806, #7147): the project's
 * monitor groups, then its monitors, each with a checkbox. None is ticked
 * until the person ticks it (or the website setup handed one in).
 *
 * A busy project's list - longer than its box shows at once - gets a search
 * by name, and a label to narrow it by when its monitors carry labels:
 * "Select all" then picks what the list shows, adding to what was picked,
 * so a label and Select all pick every monitor that carries it. A monitor
 * group is put on the page as one row (BulkAddStatusPageMonitorGroups).
 * What the page picked already shows (#7517) is ticked and locked, "On the
 * page", and never counted as picked.
 */

// From this many rows the list scrolls in its box, and gets a search.
export const STATUS_PAGE_SETUP_SEARCH_FROM: number = 9;

export interface ComponentProps {
  monitors: ReadonlyArray<StatusPageSetupMonitor>;
  monitorGroups: ReadonlyArray<StatusPageSetupMonitorGroup>;
  // Monitor ids and monitor group ids, in the order they were picked.
  picked: ReadonlyArray<string>;
  pickedGroups: ReadonlyArray<string>;
  onPick: (picked: Array<string>, pickedGroups: Array<string>) => void;
  // What the page the monitors go on shows already, by id.
  onThePageMonitorIds?: ReadonlyArray<string> | undefined;
  onThePageGroupIds?: ReadonlyArray<string> | undefined;
  // Nothing picked, said under the list.
  error?: string | undefined;
}

const linkClassName: string =
  "text-sm font-medium text-indigo-600 hover:text-indigo-800 underline-offset-2 hover:underline";

const StatusPageSetupPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [filter, setFilter] = useState<StatusPageSetupFilter>(
    NO_STATUS_PAGE_SETUP_FILTER,
  );

  const onPageMonitors: ReadonlyArray<string> = props.onThePageMonitorIds || [];
  const onPageGroups: ReadonlyArray<string> = props.onThePageGroupIds || [];

  const labels: Array<StatusPageSetupLabel> = getLabelsOfList({
    monitors: props.monitors,
    monitorGroups: props.monitorGroups,
  });
  const rowCount: number = props.monitors.length + props.monitorGroups.length;
  const isLong: boolean = rowCount >= STATUS_PAGE_SETUP_SEARCH_FROM;
  const isFiltered: boolean = isStatusPageSetupFiltered(filter);

  const shownGroups: Array<StatusPageSetupMonitorGroup> = getShownItems({
    items: props.monitorGroups,
    filter: filter,
  });
  const shownMonitors: Array<StatusPageSetupMonitor> = getShownItems({
    items: props.monitors,
    filter: filter,
  });

  // What can be picked: everything but what the page shows already.
  const pickableCount: number =
    props.monitors.filter((monitor: StatusPageSetupMonitor): boolean => {
      return !onPageMonitors.includes(monitor.id);
    }).length +
    props.monitorGroups.filter(
      (group: StatusPageSetupMonitorGroup): boolean => {
        return !onPageGroups.includes(group.id);
      },
    ).length;
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
        {isFiltered && shownGroups.length + shownMonitors.length === 0 ? (
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
      {props.error ? (
        <FieldError message={props.error} className="mt-2 text-sm" />
      ) : (
        <></>
      )}
    </fieldset>
  );
};

export default StatusPageSetupPicker;
