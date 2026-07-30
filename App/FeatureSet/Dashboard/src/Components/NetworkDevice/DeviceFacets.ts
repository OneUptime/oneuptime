import { DEVICE_FRESH_WINDOW_MINUTES } from "./DeviceStatusUtil";
import { FacetTileSelection } from "../ResourceOwners/FacetTileSelection";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../ResourceOwners/FilterChipDropdownTypes";
import EqualTo from "Common/Types/BaseDatabase/EqualTo";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import OneUptimeDate from "Common/Types/Date";

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
} = {
  status: "lastSeenAt",
  interfaces: "interfacesDown",
  /*
   * The foreign key, not the `site` relation: "is empty" then asks the column
   * for NULL, which is the only way to find devices that belong to no site at
   * all — an unassigned device has no site row to join against.
   */
  site: "siteId",
  probe: "probeId",
};

/**
 * The Status chip's values. Up / Down / Pending partition the fleet exactly:
 * `lastSeenAt` >= cutoff, < cutoff, and NULL. SQL drops NULLs from both
 * comparisons, so a never-polled device lands in Pending only and the three
 * always sum to the fleet size — which is what lets the three tiles' counts add
 * up to the total.
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

/**
 * The instant that separates "up" from "stale" — mirrors
 * DeviceStatusUtil.getStatus, which decides the pill in the Status column, so
 * the rows a filter returns are the rows whose pills agree with it.
 */
export type GetDeviceFreshCutoffFunction = () => Date;

export const getDeviceFreshCutoff: GetDeviceFreshCutoffFunction = (): Date => {
  return OneUptimeDate.getSomeMinutesAgo(DEVICE_FRESH_WINDOW_MINUTES);
};

export type IsTimeBasedDeviceStatusFunction = (
  value: string | null | undefined,
) => boolean;

/**
 * Whether this Status value is defined against the freshness window, and so
 * against a cutoff taken at the moment it was selected.
 *
 * The page says when that was, because the Status column recomputes the same
 * window on every render — leave the page open long enough and a row inside the
 * "up" list paints a Down pill with nothing to explain it.
 */
export const isTimeBasedDeviceStatus: IsTimeBasedDeviceStatusFunction = (
  value: string | null | undefined,
): boolean => {
  return (
    value === DeviceStatusFacetValue.Up || value === DeviceStatusFacetValue.Down
  );
};

/**
 * A freshness cutoff that only moves when the selection does.
 *
 * The cutoff cannot be rebuilt per render: the merged query is handed to
 * ModelTable, which decides whether to refetch by comparing it against the
 * previous render's, so a fresh `Date` every render would look like a change
 * every render — an endless refetch loop.
 *
 * Re-deriving it on a timer instead would send anyone reading page 3 back to
 * page 1 every tick and drop any bulk selection they had made, which is worse
 * than the drift. So the window is a snapshot taken when the value was picked,
 * the page says when that was, and picking again takes a new one.
 */
export class DeviceStatusCutoff {
  private selection: string | null = null;
  private cutoff: Date | null = null;

  /**
   * The cutoff for this selection, snapshotting a new one whenever the selection
   * changes.
   *
   * Call it with the *live* selection on every render, `null` included. Being told
   * about the clear is what makes picking the same value a second time take a fresh
   * window: keyed on the value alone, "down → cleared → down an hour later" would
   * silently reuse the first hour's cutoff while everything else on the page said
   * otherwise.
   */
  public getCutoffFor(selection: string | null): Date {
    if (this.selection !== selection || !this.cutoff) {
      this.selection = selection;
      this.cutoff = getDeviceFreshCutoff();
    }

    return this.cutoff;
  }

  /** The selection the current snapshot was taken for, or null before any. */
  public getSelection(): string | null {
    return this.selection;
  }
}

export type BuildDeviceStatusFacetQueryFunction = (
  values: Array<string>,
  operator: FilterOperator,
  cutoff: Date,
) => unknown;

/**
 * The `lastSeenAt` constraint behind a Status selection.
 *
 * Single-select and "is"-only by construction: the three values are ranges over
 * one column, so "up or pending" is not expressible as a single field query, and
 * "is not up" would silently drop never-polled devices (NULL fails both
 * comparisons) while reading as though it included them.
 *
 * `undefined` means "do not constrain this column" — the honest answer to a
 * value this build does not recognise, which is what a hand-edited URL or a view
 * saved by an older build can hand over.
 */
export const buildDeviceStatusFacetQuery: BuildDeviceStatusFacetQueryFunction =
  (values: Array<string>, operator: FilterOperator, cutoff: Date): unknown => {
    if (operator !== "is" || values.length !== 1) {
      return undefined;
    }

    switch (values[0]) {
      case DeviceStatusFacetValue.Up:
        return new GreaterThanOrEqual(cutoff);

      case DeviceStatusFacetValue.Down:
        return new LessThan(cutoff);

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
    sublabel: `Polled in the last ${DEVICE_FRESH_WINDOW_MINUTES} minutes`,
  },
  {
    value: DeviceStatusFacetValue.Down,
    label: "Down / Stale",
    sublabel: `No successful poll in the last ${DEVICE_FRESH_WINDOW_MINUTES} minutes`,
  },
  {
    value: DeviceStatusFacetValue.Pending,
    label: "Pending",
    sublabel: "Never polled successfully",
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
