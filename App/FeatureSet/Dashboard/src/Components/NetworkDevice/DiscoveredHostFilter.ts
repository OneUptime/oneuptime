import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceMonitoringMethod from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import {
  isImportableDiscoveredHost,
  monitoringMethodForDiscoveredHost,
} from "Common/Utils/NetworkDiscovery/DiscoveryImportEligibility";
import { normalizeDiscoveredHosts } from "Common/Utils/NetworkDiscovery/DiscoveredHostUtil";

/*
 * Normalisation moved to Common so the server-side auto-import rule engine
 * reads the jsonb through the same cleanup as this dialog. Re-exported here
 * so the page and the tests keep one import site.
 */
export { normalizeDiscoveredHosts };

/*
 * Splitting one scan's results into the two groups an operator actually
 * reviews separately: hosts that answered SNMP, and hosts that only answered
 * ping.
 *
 * The Review Discovered Devices dialog used to render every responding host in
 * one list with everything pre-checked. That is fine for a lab /24 and
 * unusable at the size real sweeps come back at — issue #3322 reports 2,890
 * ICMP-only hosts and 2,866 SNMP hosts in a single scan, mixed together, with
 * no way to import one group without scrolling the other and unchecking it by
 * hand. The two groups are also not interchangeable: an SNMP host imports as a
 * polled device carrying the scan's credentials, a ping-only host imports as a
 * monitor-backed device with no polling at all (see DiscoveryImportEligibility)
 * — so "import the switches now, deal with the endpoints later" is the normal
 * thing to want, not an edge case.
 *
 * Kept react-free and out of the page component for the usual reason: the App
 * test suite runs in a plain Node environment with no renderer, so rules left
 * inside a `.tsx` are effectively untestable — and every failure mode here
 * (a filter that shows the wrong group, a count badge that disagrees with the
 * list under it, an import that quietly includes hosts the operator filtered
 * away) renders perfectly while being wrong.
 */

export enum DiscoveredHostFilter {
  // Everything the sweep found alive — the pre-#3322 behaviour, still default.
  All = "All",
  // Answered SNMP: imports as a polled device with the scan's credentials.
  Snmp = "Snmp",
  // Answered ping only: imports as a monitor-backed device, no polling.
  NoSnmp = "NoSnmp",
}

/** Group sizes for the filter badges. */
export interface DiscoveredHostCounts {
  all: number;
  snmp: number;
  noSnmp: number;
}

/** One button in the dialog's filter row. */
export interface DiscoveredHostFilterOption {
  // Already carries the group size, e.g. "SNMP (2,866)".
  label: string;
  value: DiscoveredHostFilter;
  count: number;
}

/**
 * True when the host answered ping but not SNMP — the "No SNMP" badge group.
 *
 * Phrased through `monitoringMethodForDiscoveredHost` rather than by reading
 * `snmpReachable` again so the filter can never disagree with the import: the
 * group a host is shown under and the monitoring method it is imported with
 * are the same decision, made once.
 */
export function isPingOnlyDiscoveredHost(
  host: DiscoveredNetworkDevice,
): boolean {
  return (
    monitoringMethodForDiscoveredHost(host) ===
    NetworkDeviceMonitoringMethod.Monitor
  );
}

export function matchesDiscoveredHostFilter(data: {
  host: DiscoveredNetworkDevice;
  filter: DiscoveredHostFilter;
}): boolean {
  const isPingOnly: boolean = isPingOnlyDiscoveredHost(data.host);

  if (data.filter === DiscoveredHostFilter.NoSnmp) {
    return isPingOnly;
  }

  if (data.filter === DiscoveredHostFilter.Snmp) {
    return !isPingOnly;
  }

  /*
   * All, and anything unrecognised. The page casts into the enum
   * (`value as DiscoveredHostFilter`), so nothing at runtime rejects a value
   * outside the three — a persisted preference or a URL parameter is one
   * change away from supplying one. Falling through to "show everything" is
   * the only safe default: the label and empty-message helpers already fall
   * through to the All wording, so any other fall-through would produce a
   * dialog headed "All" that had silently hidden a whole group, which is the
   * exact confusion #3322 was filed about.
   */
  return true;
}

/**
 * True when this address carries a tick of its own.
 *
 * `hasOwnProperty` rather than a bare index, because the address is a
 * probe-supplied string used verbatim as an object key: a host reporting its
 * address as "constructor" or "toString" finds a truthy function on
 * `Object.prototype` and imports itself without anyone ever ticking it. A host
 * whose address spells "__proto__" cannot be ticked at all — assigning that
 * key on an object literal runs the prototype setter and stores nothing — so
 * it now stays out of the import instead of walking into it.
 */
export function isSelectedIpAddress(data: {
  selectedIpAddresses: Record<string, boolean>;
  ipAddress: string;
}): boolean {
  return (
    Object.prototype.hasOwnProperty.call(
      data.selectedIpAddresses,
      data.ipAddress,
    ) && Boolean(data.selectedIpAddresses[data.ipAddress])
  );
}

/**
 * The hosts the dialog should render, in scan order.
 *
 * Order is preserved deliberately: the probe reports hosts in address order,
 * and re-sorting would move rows under the operator's cursor every time the
 * filter changed.
 */
export function filterDiscoveredHosts(data: {
  hosts: Array<DiscoveredNetworkDevice>;
  filter: DiscoveredHostFilter;
}): Array<DiscoveredNetworkDevice> {
  return data.hosts.filter((host: DiscoveredNetworkDevice) => {
    return matchesDiscoveredHostFilter({ host: host, filter: data.filter });
  });
}

/**
 * A host paired with where it sits in the UNFILTERED scan.
 *
 * The dialog keys its rows by address plus position. Taking that position from
 * the filtered array moves it every time the filter changes, which changes the
 * key, which makes React unmount and remount the row — and `CheckboxElement`
 * seeds its checked state from `initialValue` and only reconciles `value` in a
 * passive effect, so a remounted row paints UNCHECKED for a frame. On a
 * thousands-of-hosts scan the whole selection appears to blank out and snap
 * back on every filter click, in a dialog whose entire job is deciding what is
 * ticked. Scan position does not move when the filter changes, so it is what
 * the key has to be built from.
 */
export interface ShownDiscoveredHost {
  host: DiscoveredNetworkDevice;
  /** Index in the unfiltered scan — stable across filter changes. */
  scanIndex: number;
}

/**
 * The rows to render, each carrying its stable identity.
 *
 * Same order and same membership as `filterDiscoveredHosts`; this is that
 * function plus the position the caller needs for a React key.
 */
export function getShownDiscoveredHosts(data: {
  hosts: Array<DiscoveredNetworkDevice>;
  filter: DiscoveredHostFilter;
}): Array<ShownDiscoveredHost> {
  const shown: Array<ShownDiscoveredHost> = [];

  data.hosts.forEach((host: DiscoveredNetworkDevice, scanIndex: number) => {
    if (matchesDiscoveredHostFilter({ host: host, filter: data.filter })) {
      shown.push({ host: host, scanIndex: scanIndex });
    }
  });

  return shown;
}

/**
 * Group sizes, computed from the UNFILTERED list.
 *
 * Same reasoning as the recommendations tiles: the badges are what the
 * operator clicks to change the filter, so deriving them from the filtered
 * list would make every badge except the active one read zero.
 *
 * Already-registered hosts are counted. The badge answers "how big is this
 * group", which is how the number is checked against the probe's own ICMP/SNMP
 * tallies; excluding rows for a reason the badge cannot show would just make
 * the two disagree.
 */
export function countDiscoveredHosts(
  hosts: Array<DiscoveredNetworkDevice>,
): DiscoveredHostCounts {
  const counts: DiscoveredHostCounts = {
    all: hosts.length,
    snmp: 0,
    noSnmp: 0,
  };

  for (const host of hosts) {
    if (isPingOnlyDiscoveredHost(host)) {
      counts.noSnmp = counts.noSnmp + 1;
    } else {
      counts.snmp = counts.snmp + 1;
    }
  }

  return counts;
}

/**
 * How a group is named in prose — and, critically, on the row badge.
 *
 * "No SNMP" is the exact wording already on the per-row pill, so the filter
 * button and the thing it filters for read as the same word rather than as two
 * near-synonyms the operator has to connect.
 */
export function getDiscoveredHostFilterLabel(
  filter: DiscoveredHostFilter,
): string {
  if (filter === DiscoveredHostFilter.Snmp) {
    return "SNMP";
  }

  if (filter === DiscoveredHostFilter.NoSnmp) {
    return "No SNMP";
  }

  return "All";
}

/**
 * What to say when a group has nothing in it.
 *
 * A separate function rather than `No ${getDiscoveredHostFilterLabel(f)} hosts`
 * because that label is a noun phrase built for a button — and for the No SNMP
 * group it already starts with "No", so the sentence frame's own "No " collided
 * with it and the dialog read "No No SNMP hosts in this scan." A group of zero
 * is one click away on any all-SNMP sweep, so that sentence is not a rare path.
 *
 * The two group messages are phrased positively for the same reason: "every
 * host answered SNMP" tells the operator what the sweep found, where "no
 * ping-only hosts" only tells them what it did not.
 */
export function getDiscoveredHostFilterEmptyMessage(
  filter: DiscoveredHostFilter,
): string {
  if (filter === DiscoveredHostFilter.Snmp) {
    return "No host in this scan answered SNMP.";
  }

  if (filter === DiscoveredHostFilter.NoSnmp) {
    return "Every host in this scan answered SNMP.";
  }

  return "This scan did not find any responding hosts.";
}

/**
 * The filter row, counts included.
 *
 * The count is in the label rather than in a badge because a group of zero has
 * to render its zero: "SNMP (0)" is the answer to "did this sweep find any
 * switches at all", and a badge that hides zeroes would leave that button
 * looking identical to one with results behind it.
 *
 * Thousands separators for the reason #3322 exists — at four digits, 2866 and
 * 2,866 are not equally easy to check against the probe's own tally.
 */
export function getDiscoveredHostFilterOptions(
  hosts: Array<DiscoveredNetworkDevice>,
): Array<DiscoveredHostFilterOption> {
  const counts: DiscoveredHostCounts = countDiscoveredHosts(hosts);

  const countByFilter: Record<DiscoveredHostFilter, number> = {
    [DiscoveredHostFilter.All]: counts.all,
    [DiscoveredHostFilter.Snmp]: counts.snmp,
    [DiscoveredHostFilter.NoSnmp]: counts.noSnmp,
  };

  return [
    DiscoveredHostFilter.All,
    DiscoveredHostFilter.Snmp,
    DiscoveredHostFilter.NoSnmp,
  ].map((filter: DiscoveredHostFilter) => {
    const count: number = countByFilter[filter];

    return {
      label: `${getDiscoveredHostFilterLabel(filter)} (${count.toLocaleString(
        "en-US",
      )})`,
      value: filter,
      count: count,
    };
  });
}

/**
 * True when this row's checkbox can be ticked at all.
 *
 * A host with no address cannot be imported (the address is the device's
 * hostname AND the selection key), and one already registered has nothing left
 * to import.
 */
export function isSelectableDiscoveredHost(
  host: DiscoveredNetworkDevice | null | undefined,
): boolean {
  if (!host) {
    return false;
  }

  /*
   * Trimmed, so a whitespace-only address is refused the same way an empty
   * one is. normalizeDiscoveredHosts already trims, but this predicate is
   * exported and called on raw rows too, and "selectable" disagreeing with
   * itself depending on which list you came through is the class of bug the
   * whole module is arranged to avoid.
   */
  return (
    Boolean(String(host.ipAddress ?? "").trim()) &&
    !host.isAlreadyRegistered &&
    isImportableDiscoveredHost(host)
  );
}

/**
 * The scan's hosts with the ones imported during this sitting flipped to
 * already-registered.
 *
 * `isAlreadyRegistered` is computed server-side when the probe uploads its
 * results and then frozen into the jsonb column — nothing recomputes it on
 * read. So a host imported a moment ago still reports false, and the dialog
 * would happily offer it again, pre-checked, creating a second Network Device
 * for the same address.
 *
 * That was survivable when one press imported everything and closed the
 * dialog. Importing group by group is now the intended flow (#3322), which
 * means coming back to a list that still contains what you just imported is
 * the normal case rather than the odd one, so the page overlays what it knows.
 *
 * Returns copies; the scan's own array is left alone so nothing depends on
 * mutation order.
 */
export function markDiscoveredHostsAsRegistered(data: {
  hosts: Array<DiscoveredNetworkDevice>;
  importedIpAddresses: Set<string>;
}): Array<DiscoveredNetworkDevice> {
  if (data.importedIpAddresses.size === 0) {
    return data.hosts;
  }

  return data.hosts.map((host: DiscoveredNetworkDevice) => {
    /*
     * Stringified: object keys are strings, so a numeric address is recorded
     * as "10" on the way in and would never match `has(10)` on the way out —
     * leaving an imported host looking importable for ever.
     */
    if (!data.importedIpAddresses.has(String(host?.ipAddress ?? ""))) {
      return host;
    }

    return { ...host, isAlreadyRegistered: true };
  });
}

/*
 * Where the page remembers what it has imported, keyed by scan.
 *
 * Keyed rather than a bare set for two reasons, both of which are real:
 *
 *   - An import of 2,866 hosts is thousands of sequential creates and runs for
 *     minutes. Nothing stops the operator closing the dialog and opening a
 *     different scan meanwhile, and a bare set written when that run finally
 *     lands would mark the OTHER scan's same-addressed hosts "Already added" —
 *     disabled, unticked, silently skipped by Import.
 *   - Keeping the record per scan lets it outlive the dialog, so closing and
 *     reopening the same scan does not resurrect what was just imported.
 *     `isAlreadyRegistered` is frozen into the jsonb at probe-upload time and
 *     never recomputed, so without that the reopened dialog offers imported
 *     hosts again, pre-checked, and Import creates duplicates.
 *
 * A plain Record of arrays rather than a Map of Sets so the value stays
 * JSON-shaped: it is React state, it gets compared and asserted on, and
 * neither of those is pleasant with nested Maps.
 */
export type ImportedIpAddressesByScanId = Record<string, Array<string>>;

/** What has been imported for one scan, ready for the overlay. */
export function getImportedIpAddressesForScan(data: {
  importedByScanId: ImportedIpAddressesByScanId;
  scanId: string | null | undefined;
}): Set<string> {
  if (!data.scanId) {
    return new Set<string>();
  }

  /*
   * hasOwnProperty for the same reason the selection lookup uses it: a bare
   * index into a plain object finds inherited members, and `new Set(fn)` on
   * an inherited function throws rather than falling back to the `|| []`.
   */
  if (
    !Object.prototype.hasOwnProperty.call(data.importedByScanId, data.scanId)
  ) {
    return new Set<string>();
  }

  return new Set<string>(data.importedByScanId[data.scanId] || []);
}

/**
 * The store with more addresses recorded against one scan.
 *
 * Additive and duplicate-free, so two imports in one sitting accumulate rather
 * than the second replacing the first.
 */
export function withImportedIpAddresses(data: {
  importedByScanId: ImportedIpAddressesByScanId;
  scanId: string | null | undefined;
  ipAddresses: Array<string>;
}): ImportedIpAddressesByScanId {
  if (!data.scanId || data.ipAddresses.length === 0) {
    return data.importedByScanId;
  }

  const merged: Set<string> = new Set<string>([
    ...getImportedIpAddressesForScan({
      importedByScanId: data.importedByScanId,
      scanId: data.scanId,
    }),
    ...data.ipAddresses,
  ]);

  return {
    ...data.importedByScanId,
    [data.scanId]: Array.from(merged),
  };
}

/**
 * The dialog's opening selection: every selectable host, pre-checked.
 *
 * Computed over the whole scan rather than the active filter because the
 * dialog always opens on `All` — and because a filter is a view, not a
 * selection: switching to SNMP and back must not lose the ticks.
 */
export function getInitialSelection(
  hosts: Array<DiscoveredNetworkDevice>,
): Record<string, boolean> {
  const selection: Record<string, boolean> = {};

  for (const host of hosts) {
    if (isSelectableDiscoveredHost(host)) {
      selection[host.ipAddress] = true;
    }
  }

  return selection;
}

/**
 * Exactly what pressing Import imports: selected AND currently shown.
 *
 * Scoping the import to the active filter is the whole point of #3322. The
 * alternative — importing everything ticked, including hosts the filter has
 * hidden — would make "filter to SNMP, press Import Selected" quietly create
 * the 2,890 ping-only devices the operator just filtered away, which is the
 * exact outcome the issue is asking to avoid. Nothing is lost by it either:
 * ticks on hidden hosts survive in state and come back with the filter, and
 * the submit button's count is computed from this same list, so the number on
 * the button always matches what the press will do.
 *
 * Duplicate addresses collapse to one device. A single checkbox is keyed by
 * address and governs every row carrying it, so importing each row would
 * create N devices from one tick. `discoveredDevices` is jsonb written from
 * the probe's payload, so duplicates are a thing the page has to survive
 * rather than a thing it can assume away.
 */
export function getDiscoveredHostsToImport(data: {
  hosts: Array<DiscoveredNetworkDevice>;
  filter: DiscoveredHostFilter;
  selectedIpAddresses: Record<string, boolean>;
}): Array<DiscoveredNetworkDevice> {
  const seenIpAddresses: Set<string> = new Set<string>();

  return filterDiscoveredHosts({
    hosts: data.hosts,
    filter: data.filter,
  }).filter((host: DiscoveredNetworkDevice) => {
    if (!isSelectableDiscoveredHost(host)) {
      return false;
    }

    if (
      !isSelectedIpAddress({
        selectedIpAddresses: data.selectedIpAddresses,
        ipAddress: host.ipAddress,
      })
    ) {
      return false;
    }

    if (seenIpAddresses.has(host.ipAddress)) {
      return false;
    }

    seenIpAddresses.add(host.ipAddress);

    return true;
  });
}

/**
 * How many hosts the active filter offers a checkbox for.
 *
 * Deduplicated for the same reason as the import list: one address is one
 * checkbox, so counting it twice would make "Select all" claim to tick more
 * boxes than exist.
 */
export function countSelectableShownHosts(data: {
  hosts: Array<DiscoveredNetworkDevice>;
  filter: DiscoveredHostFilter;
}): number {
  const seenIpAddresses: Set<string> = new Set<string>();

  for (const host of filterDiscoveredHosts({
    hosts: data.hosts,
    filter: data.filter,
  })) {
    if (isSelectableDiscoveredHost(host)) {
      seenIpAddresses.add(host.ipAddress);
    }
  }

  return seenIpAddresses.size;
}

/**
 * True when every tickable host in the current view is already ticked.
 *
 * False for an empty view rather than vacuously true, so the bulk control
 * reads "Select all" (and stays disabled) on a group with nothing to select,
 * instead of offering to clear a selection that does not exist.
 */
export function areAllShownHostsSelected(data: {
  hosts: Array<DiscoveredNetworkDevice>;
  filter: DiscoveredHostFilter;
  selectedIpAddresses: Record<string, boolean>;
}): boolean {
  const selectableCount: number = countSelectableShownHosts({
    hosts: data.hosts,
    filter: data.filter,
  });

  if (selectableCount === 0) {
    return false;
  }

  return (
    getDiscoveredHostsToImport({
      hosts: data.hosts,
      filter: data.filter,
      selectedIpAddresses: data.selectedIpAddresses,
    }).length === selectableCount
  );
}

/**
 * Selection after ticking (or clearing) every tickable host in the current
 * view — the bulk control next to the filter.
 *
 * Scoped to the view and additive across views, following
 * `RecommendationFilterUtil.toggleSelectionForGroup`: selecting all while the
 * SNMP filter is active must not disturb ticks on ping-only hosts, because the
 * operator's next move is usually to switch filters and import the other group
 * too. Only a fully-selected view toggles off.
 *
 * This is what replaces "scroll 2,890 rows and uncheck them one at a time".
 */
export function toggleSelectionForShownHosts(data: {
  hosts: Array<DiscoveredNetworkDevice>;
  filter: DiscoveredHostFilter;
  selectedIpAddresses: Record<string, boolean>;
}): Record<string, boolean> {
  const shouldClear: boolean = areAllShownHostsSelected(data);

  const selection: Record<string, boolean> = { ...data.selectedIpAddresses };

  for (const host of filterDiscoveredHosts({
    hosts: data.hosts,
    filter: data.filter,
  })) {
    if (!isSelectableDiscoveredHost(host)) {
      continue;
    }

    selection[host.ipAddress] = !shouldClear;
  }

  return selection;
}
