import { FacetTileSelection } from "../ResourceOwners/FacetTileSelection";
import { buildFacetDateRangeQuery } from "../ResourceOwners/FacetDateRange";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../ResourceOwners/FilterChipDropdownTypes";
import EqualTo from "Common/Types/BaseDatabase/EqualTo";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import IsNull from "Common/Types/BaseDatabase/IsNull";

/*
 * The vocabulary of the device list's facet bar: which chips exist, what values
 * they offer, and the query each value stands for.
 *
 * Every tile in the summary strip drills in by moving one of these chips rather
 * than by layering a second, invisible filter under the table — so the chips are
 * the visible record of why the list is short, and the user narrows further or
 * backs out through the same control they would have used had they started from
 * the bar.
 *
 * Deliberately free of React and of the API client, the same way DeviceStatusUtil
 * is: the chips are assembled on the page (which has the probes and can call the
 * API), while the mapping from "what the chip says" to "what the database is
 * asked" lives here where it can be pinned in tests.
 */

/*
 * Shared by the table's `id`, its `userPreferencesKey` and the URL namespace its
 * filter/facet/view state is persisted under. Named here rather than on the page
 * because a link built elsewhere in the product has to address that namespace to
 * land the list pre-filtered (see DeviceListFacetRoute).
 */
export const NETWORK_DEVICES_TABLE_ID: string = "network-devices-table";

export const DEVICE_STATUS_FACET_KEY: string = "deviceStatus";
export const DEVICE_INTERFACES_FACET_KEY: string = "deviceInterfaces";
export const DEVICE_SITE_FACET_KEY: string = "deviceSite";
export const DEVICE_PROBE_FACET_KEY: string = "deviceProbe";
export const DEVICE_LAST_SEEN_FACET_KEY: string = "deviceLastSeen";
export const DEVICE_ROLE_FACET_KEY: string = "deviceRole";

/*
 * The column each chip owns. A chip and the column-filter popup cannot both
 * write the same field: BaseModelTable builds its request as
 * `{...props.query, ...columnFilterQuery}`, so a popup filter on a chip's field
 * replaces the chip's constraint outright — silently, while the chip carries on
 * claiming it applies. Where the two spell the same column differently
 * (`site` vs `siteId`) they instead survive as an AND that can never match,
 * emptying the table.
 *
 * So these are the fields the popup must not offer, and the page's `filters`
 * list is checked against them in the tests.
 */
export const DEVICE_FACET_QUERY_FIELDS: {
  status: string;
  interfaces: string;
  site: string;
  probe: string;
  lastSeen: string;
  role: string;
} = {
  /*
   * The stored outcome of the last poll, not a window over `lastSeenAt`.
   * That is what makes this chip return exactly the rows whose pills agree
   * with it however far behind the polling schedule has fallen — and it is
   * why Status and Last Seen are no longer two chips fighting over one
   * column.
   */
  status: "isReachable",
  interfaces: "interfacesDown",
  /*
   * The foreign key, not the `site` relation: "is empty" then asks the column
   * for NULL, which is the only way to find devices that belong to no site at
   * all — an unassigned device has no site row to join against.
   */
  site: "siteId",
  probe: "probeId",
  // "when did this device last answer", on its own column and its own chip.
  lastSeen: "lastSeenAt",
  /*
   * The foreign key, not the relation, for the same reason as `site`: "is
   * empty" over the column is the only way to ask for devices with no role
   * assigned - which is the majority of an SNMP fleet, and the honest way to
   * find the ping-only devices that still need one.
   */
  role: "networkDeviceRoleId",
};

/**
 * The Status chip's values. Up / Down / Pending partition the fleet exactly:
 * `isReachable` true, false, and NULL. SQL drops NULLs from both equality
 * comparisons, so a device with no verdict lands in Pending only and the three
 * always sum to the fleet size — which is what lets the three tiles' counts add
 * up to the total.
 *
 * `isReachable` is the SNMP walk's verdict on an SNMP device and the bound
 * monitor's verdict on a monitor-backed one (the server stamps it from the
 * monitor's status, NULL while nothing is bound), so one column and one chip
 * cover both kinds of device.
 */
export enum DeviceStatusFacetValue {
  Up = "up",
  Down = "down",
  Pending = "pending",
}

export enum DeviceInterfacesFacetValue {
  SomeDown = "some-down",
  AllUp = "all-up",
}

export type BuildDeviceStatusFacetQueryFunction = (
  values: Array<string>,
  operator: FilterOperator,
) => unknown;

/**
 * The `isReachable` constraint behind a Status selection.
 *
 * A stored verdict rather than a window, so the rows this returns are the rows
 * whose pills say the same thing — permanently, not just for as long as the
 * page has been open. The window it replaced was a snapshot of the wall clock
 * taken when the value was picked, which drifted away from the pills (which
 * recompute per render) the longer the list stayed open.
 *
 * Single-select and "is"-only by construction: the three values partition one
 * column, so "up or pending" is not expressible as a single field query, and
 * "is not up" would silently drop never-polled devices (NULL fails equality
 * either way) while reading as though it included them.
 *
 * `undefined` means "do not constrain this column" — the honest answer to a
 * value this build does not recognise, which is what a hand-edited URL or a view
 * saved by an older build can hand over.
 */
export const buildDeviceStatusFacetQuery: BuildDeviceStatusFacetQueryFunction =
  (values: Array<string>, operator: FilterOperator): unknown => {
    if (operator !== "is" || values.length !== 1) {
      return undefined;
    }

    switch (values[0]) {
      /*
       * Bare booleans, not EqualTo: CompareType covers number/Date/string
       * only, and a plain boolean is what every other boolean query in the
       * product (`isArchived: false`) already sends. `undefined` is the only
       * value the facet layer drops, so `false` survives the merge.
       */
      case DeviceStatusFacetValue.Up:
        return true;

      case DeviceStatusFacetValue.Down:
        return false;

      case DeviceStatusFacetValue.Pending:
        return new IsNull();

      default:
        return undefined;
    }
  };

export type BuildDeviceInterfacesFacetQueryFunction = (
  values: Array<string>,
  operator: FilterOperator,
) => unknown;

/**
 * The `interfacesDown` constraint behind an Interfaces selection.
 *
 * `EqualTo(0)` rather than a bare `0` for "all up": the server's query builder
 * skips falsy values, so a bare zero would reach the ORM as no filter at all and
 * the chip would light up over an unfiltered list.
 */
export const buildDeviceInterfacesFacetQuery: BuildDeviceInterfacesFacetQueryFunction =
  (values: Array<string>, operator: FilterOperator): unknown => {
    if (operator !== "is" || values.length !== 1) {
      return undefined;
    }

    switch (values[0]) {
      case DeviceInterfacesFacetValue.SomeDown:
        return new GreaterThan(0);

      case DeviceInterfacesFacetValue.AllUp:
        return new EqualTo(0);

      default:
        return undefined;
    }
  };

export const DEVICE_STATUS_FACET_OPTIONS: Array<FilterChipDropdownOption> = [
  {
    value: DeviceStatusFacetValue.Up,
    label: "Up",
    sublabel: "The last SNMP poll, or the bound monitor, reached the device",
  },
  {
    value: DeviceStatusFacetValue.Down,
    label: "Down",
    sublabel:
      "The last SNMP poll, or the bound monitor, could not reach the device",
  },
  {
    value: DeviceStatusFacetValue.Pending,
    label: "Pending",
    sublabel: "No verdict yet — never polled, or no monitor bound",
  },
];

export const DEVICE_INTERFACES_FACET_OPTIONS: Array<FilterChipDropdownOption> =
  [
    {
      value: DeviceInterfacesFacetValue.SomeDown,
      label: "Some down",
      sublabel: "At least one interface is down",
    },
    {
      value: DeviceInterfacesFacetValue.AllUp,
      label: "All up",
      sublabel: "No interface is down",
    },
  ];

/**
 * The Last Seen chip's operators.
 *
 * "is empty" and "is not empty" are left out on purpose: over `lastSeenAt` they
 * read as "never answered a poll", which is close enough to the Status chip's
 * Pending to be mistaken for it. Two chips spelling one thing two ways is how a
 * user ends up believing they have applied two filters.
 */
export const DEVICE_LAST_SEEN_FACET_OPERATORS: Array<FilterOperator> = [
  "is",
  "before",
  "after",
  "between",
];

export type BuildDeviceLastSeenFacetQueryFunction = (
  values: Array<string>,
  operator: FilterOperator,
) => unknown;

/**
 * The `lastSeenAt` constraint behind a Last Seen selection.
 *
 * The question the Status chip does not answer: not "is it up now" but "when
 * did it last answer" — the only way to ask "which devices have not answered
 * since last Tuesday" or "which answered between the 1st and the 5th".
 *
 * Day-granular, and identical to what the column-filter popup's date entry
 * produced before the facet bar took the column over — so a question a user
 * used to be able to ask of this list still returns the same rows.
 */
export const buildDeviceLastSeenFacetQuery: BuildDeviceLastSeenFacetQueryFunction =
  (values: Array<string>, operator: FilterOperator): unknown => {
    if (!DEVICE_LAST_SEEN_FACET_OPERATORS.includes(operator)) {
      return undefined;
    }

    return buildFacetDateRangeQuery(values, operator);
  };

/**
 * "Devices assigned to no site at all" — the Site chip on its "is empty"
 * operator.
 *
 * Lives here, next to the chip it moves, because two pages have to agree on it:
 * the Sites page counts unassigned devices and links here, and this page has to
 * come up showing exactly the rows behind that count.
 */
export const UNASSIGNED_DEVICES_FACET_SELECTION: FacetTileSelection = {
  facetKey: DEVICE_SITE_FACET_KEY,
  values: [],
  operator: "is_empty",
};
