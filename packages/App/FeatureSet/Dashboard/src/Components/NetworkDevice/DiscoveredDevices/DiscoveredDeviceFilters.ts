import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import {
  DISCOVERED_DEVICE_FILTER_OPERATORS,
  DiscoveredDeviceFilter,
  DiscoveredDeviceFilterField,
  DiscoveredDeviceFilterOperator,
  DiscoveredDeviceSource,
} from "Common/Types/NetworkDevice/DiscoveredDevice";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  FacetDateRange,
  parseFacetDateRange,
} from "../../ResourceOwners/FacetDateRange";
import { isFacetActive } from "../../ResourceOwners/FacetSelectionState";
import {
  FacetKind,
  FilterChipDropdownOption,
  FilterOperator,
} from "../../ResourceOwners/FilterChipDropdownTypes";

/*
 * THE DISCOVERED DEVICES LIST'S FILTER CHIPS (OneUptime issue #9304).
 *
 * The list had a search box and nothing else, while the Devices list beside
 * it narrows by chips. These are the same chips (FacetFilterBar and the chips
 * every list draws), so the two lists' filters look and work alike: a name,
 * an address, a MAC, a maker, a hostname, a site, what saw the device and
 * when it was last seen, each with the chips' own operators, all of them
 * holding at once, and the search on top.
 *
 * The list is the server's - a site sees thousands of devices - so the chips
 * do not filter rows here: each active chip becomes a DiscoveredDeviceFilter
 * the list request carries (Common/Types/NetworkDevice/DiscoveredDevice).
 * React-free, so the translation from chip to filter is tested on its own.
 */

export interface DiscoveredDeviceChip {
  field: DiscoveredDeviceFilterField;
  // English, looked up where it is drawn.
  label: string;
  type: FacetKind;
  icon: IconProp;
  supportedOperators: Array<FilterOperator>;
  isMultiSelect?: boolean | undefined;
  // English, looked up where it is drawn.
  placeholder?: string | undefined;
}

// What the chips hold: each chip's values and operator, by field.
export interface DiscoveredDeviceChipState {
  values: Partial<Record<DiscoveredDeviceFilterField, Array<string>>>;
  operators: Partial<Record<DiscoveredDeviceFilterField, FilterOperator>>;
}

export const EMPTY_DISCOVERED_DEVICE_CHIP_STATE: DiscoveredDeviceChipState = {
  values: {},
  operators: {},
};

export const DISCOVERED_DEVICE_FILTERS_LABEL: string = translationKey(
  "Filter discovered devices",
);

function operatorsOf(
  field: DiscoveredDeviceFilterField,
): Array<FilterOperator> {
  return [
    ...DISCOVERED_DEVICE_FILTER_OPERATORS[field],
  ] as Array<FilterOperator>;
}

/*
 * In the order the table's columns are: who it is, where it is, what saw it
 * and when. Last Seen's chip offers "on a day" too, which the request words
 * as a whole day's range.
 */
export const DISCOVERED_DEVICE_CHIPS: ReadonlyArray<DiscoveredDeviceChip> = [
  {
    field: DiscoveredDeviceFilterField.Name,
    label: translationKey("Name"),
    type: "text",
    icon: IconProp.Label,
    supportedOperators: operatorsOf(DiscoveredDeviceFilterField.Name),
  },
  {
    field: DiscoveredDeviceFilterField.IpAddress,
    label: translationKey("IP Address"),
    type: "text",
    icon: IconProp.Globe,
    supportedOperators: operatorsOf(DiscoveredDeviceFilterField.IpAddress),
  },
  {
    field: DiscoveredDeviceFilterField.MacAddress,
    label: translationKey("MAC Address"),
    type: "text",
    icon: IconProp.Hashtag,
    supportedOperators: operatorsOf(DiscoveredDeviceFilterField.MacAddress),
  },
  {
    field: DiscoveredDeviceFilterField.Vendor,
    label: translationKey("Vendor"),
    type: "text",
    icon: IconProp.Cube,
    supportedOperators: operatorsOf(DiscoveredDeviceFilterField.Vendor),
  },
  {
    field: DiscoveredDeviceFilterField.Hostname,
    label: translationKey("Hostname"),
    type: "text",
    icon: IconProp.ServerStack,
    supportedOperators: operatorsOf(DiscoveredDeviceFilterField.Hostname),
  },
  {
    field: DiscoveredDeviceFilterField.Site,
    label: translationKey("Site"),
    type: "options",
    icon: IconProp.BuildingOffice,
    isMultiSelect: true,
    supportedOperators: operatorsOf(DiscoveredDeviceFilterField.Site),
  },
  {
    field: DiscoveredDeviceFilterField.Source,
    label: translationKey("Seen By"),
    type: "options",
    icon: IconProp.Signal,
    supportedOperators: operatorsOf(DiscoveredDeviceFilterField.Source),
  },
  {
    field: DiscoveredDeviceFilterField.LastSeen,
    label: translationKey("Last Seen"),
    type: "dateRange",
    icon: IconProp.Clock,
    supportedOperators: [
      "is",
      ...operatorsOf(DiscoveredDeviceFilterField.LastSeen),
    ],
  },
];

// The Seen By chip's choices, in English.
export const DISCOVERED_DEVICE_SOURCE_OPTIONS: ReadonlyArray<FilterChipDropdownOption> =
  [
    {
      value: DiscoveredDeviceSource.Walk,
      label: translationKey("Switch or router"),
      icon: IconProp.Switch,
    },
    {
      value: DiscoveredDeviceSource.Controller,
      label: translationKey("Network controller"),
      icon: IconProp.Wifi,
    },
  ];

/*
 * The chips a list draws: a site's own list is already one site's, so it
 * has no Site chip.
 */
export function getDiscoveredDeviceChips(data: {
  isSiteList: boolean;
}): Array<DiscoveredDeviceChip> {
  return DISCOVERED_DEVICE_CHIPS.filter((chip: DiscoveredDeviceChip) => {
    return !(
      data.isSiteList && chip.field === DiscoveredDeviceFilterField.Site
    );
  });
}

function operatorOf(
  state: DiscoveredDeviceChipState,
  field: DiscoveredDeviceFilterField,
): FilterOperator {
  return state.operators[field] || "is";
}

// Is this chip narrowing the list? The bar's count and the request agree.
export function isDiscoveredDeviceChipActive(
  chip: DiscoveredDeviceChip,
  state: DiscoveredDeviceChipState,
): boolean {
  return (
    chip.supportedOperators.includes(operatorOf(state, chip.field)) &&
    isFacetActive(
      { key: chip.field, type: chip.type },
      state.values[chip.field],
      operatorOf(state, chip.field),
    )
  );
}

export function countActiveDiscoveredDeviceChips(
  chips: ReadonlyArray<DiscoveredDeviceChip>,
  state: DiscoveredDeviceChipState,
): number {
  return chips.filter((chip: DiscoveredDeviceChip): boolean => {
    return isDiscoveredDeviceChipActive(chip, state);
  }).length;
}

// Last Seen's range as the request words it, or null while it is half typed.
function toLastSeenFilter(
  values: Array<string>,
  operator: FilterOperator,
): DiscoveredDeviceFilter | null {
  const range: FacetDateRange = parseFacetDateRange(values);

  if (!range.start) {
    return null;
  }

  const field: DiscoveredDeviceFilterField =
    DiscoveredDeviceFilterField.LastSeen;

  switch (operator) {
    case "is":
      // A day, as the Devices list's Last Seen chip reads it.
      return {
        field: field,
        operator: DiscoveredDeviceFilterOperator.Between,
        values: [
          OneUptimeDate.getStartOfDay(range.start).toISOString(),
          OneUptimeDate.getEndOfDay(range.start).toISOString(),
        ],
      };
    case "before":
    case "after":
      return {
        field: field,
        operator:
          operator === "before"
            ? DiscoveredDeviceFilterOperator.Before
            : DiscoveredDeviceFilterOperator.After,
        values: [range.start.toISOString()],
      };
    case "between":
      return range.end
        ? {
            field: field,
            operator: DiscoveredDeviceFilterOperator.Between,
            values: [
              OneUptimeDate.getStartOfDay(range.start).toISOString(),
              OneUptimeDate.getEndOfDay(range.end).toISOString(),
            ],
          }
        : null;
    default:
      return null;
  }
}

/*
 * The filters the active chips ask for, in the chips' order. A chip that is
 * not narrowing anything yet - no value, a half-typed range - asks for none.
 */
export function toDiscoveredDeviceFilters(
  chips: ReadonlyArray<DiscoveredDeviceChip>,
  state: DiscoveredDeviceChipState,
): Array<DiscoveredDeviceFilter> {
  const filters: Array<DiscoveredDeviceFilter> = [];

  for (const chip of chips) {
    if (!isDiscoveredDeviceChipActive(chip, state)) {
      continue;
    }

    const operator: FilterOperator = operatorOf(state, chip.field);
    const values: Array<string> = state.values[chip.field] || [];

    if (chip.type === "dateRange") {
      const filter: DiscoveredDeviceFilter | null = toLastSeenFilter(
        values,
        operator,
      );

      if (filter) {
        filters.push(filter);
      }

      continue;
    }

    const isEmptiness: boolean =
      operator === "is_empty" || operator === "is_not_empty";

    filters.push({
      field: chip.field,
      operator: operator as DiscoveredDeviceFilterOperator,
      values: isEmptiness
        ? []
        : chip.type === "text"
          ? values.slice(0, 1)
          : [...values],
    });
  }

  return filters;
}

/*
 * The state after one chip changed: its values and operator together, so a
 * render never shows one operator while the request carries another.
 */
export function setDiscoveredDeviceChip(
  state: DiscoveredDeviceChipState,
  field: DiscoveredDeviceFilterField,
  values: Array<string>,
  operator: FilterOperator,
): DiscoveredDeviceChipState {
  const nextValues: DiscoveredDeviceChipState["values"] = { ...state.values };
  const nextOperators: DiscoveredDeviceChipState["operators"] = {
    ...state.operators,
  };

  const isEmptiness: boolean =
    operator === "is_empty" || operator === "is_not_empty";

  if (values.length === 0 && !isEmptiness) {
    delete nextValues[field];
  } else {
    nextValues[field] = isEmptiness ? [] : values;
  }

  if (operator === "is" && values.length === 0) {
    delete nextOperators[field];
  } else {
    nextOperators[field] = operator;
  }

  return { values: nextValues, operators: nextOperators };
}
