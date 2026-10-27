import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import IconProp from "Common/Types/Icon/IconProp";
import { DeviceNameSource } from "Common/Types/NetworkDevice/DeviceNameSource";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import FilterButtons, {
  FilterButtonOption,
} from "Common/UI/Components/FilterButtons/FilterButtons";
import Icon from "Common/UI/Components/Icon/Icon";
import Pagination from "Common/UI/Components/Pagination/Pagination";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import {
  buildDeviceName,
  getDiscoveredHostFullName,
  getDiscoveredHostNameSource,
} from "Common/Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import {
  DiscoveredHostNamingExplanation,
  explainUnnamedDiscoveredHost,
} from "Common/Utils/NetworkDiscovery/DiscoveredHostNamingDiagnosis";
import { normalizeReverseDnsName } from "Common/Utils/NetworkDiscovery/ReverseDnsNameUtil";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DiscoveredHostFilter,
  DiscoveredHostFilterOption,
  DiscoveredHostNameFilter,
  DiscoveredHostNameFilterOption,
  DiscoveredHostQuery,
  ShownDiscoveredHost,
  areAllShownHostsSelected,
  countSelectableShownHosts,
  countSelectedDiscoveredHosts,
  getDiscoveredHostFilterEmptyMessage,
  getDiscoveredHostFilterOptions,
  getDiscoveredHostNameFilterOptions,
  getDiscoveredHostVendor,
  getHostsCountedByFacet,
  getShownDiscoveredHosts,
  isDiscoveredHostQueryNarrowed,
  isPingOnlyDiscoveredHost,
  isSelectableDiscoveredHost,
  isSelectedIpAddress,
  toggleSelectionForShownHosts,
} from "../DiscoveredHostFilter";

/*
 * THE HOSTS OF A SCAN, TO CHOOSE FROM (Network > Discovery > Review Results,
 * first step).
 *
 * What each host is, in one row: the name its device will get (and, when
 * that name is its address, why nothing named it), its address and any
 * other name it goes by, its vendor and what it says about itself, whether
 * it answered SNMP or only ping, and whether it is already a device. Above
 * the rows, the ways a reviewer narrows a scan of hundreds to what they
 * want: a search that finds a host by any of its names, its address, its
 * vendor - or a whole subnet ("10.48.11.0/24") - and two facets, what the
 * host answered and whether anything named it, each with its count.
 *
 * Import brings in what is ticked AND shown. That was the rule with one
 * facet (issue #3322: "show only SNMP, press Import" must not bring the
 * ping-only hosts too), and with search and two facets it is said out loud:
 * the line above the rows counts the ticked hosts the view hides, which
 * Import leaves where they are.
 *
 * Rows are paged, fifty at a time: a scan of thousands is narrowed with the
 * search and the facets, and the page stays light however large it is.
 */

export const DISCOVERED_HOSTS_PER_PAGE: number = 50;

// The row's columns from md up: the box, the host, the vendor, the badges.
const HOST_GRID_WITH_VENDOR: string =
  "md:grid-cols-[1.25rem_minmax(0,2.4fr)_minmax(0,1.6fr)_minmax(0,12rem)]";
const HOST_GRID_WITHOUT_VENDOR: string =
  "md:grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,12rem)]";

export interface DiscoveredHostTableProps {
  // The scan's hosts, normalised, with anything imported already marked.
  hosts: Array<DiscoveredNetworkDevice>;
  // The scan as the dialog last read it: what the rows are named by.
  scan: NetworkDeviceDiscoveryScan;
  // Whether the scan's probe is a global one (undefined: not known).
  isGlobalProbe: boolean | undefined;
  // The scan asked nothing about SNMP, so there is no SNMP facet.
  isIcmpOnly: boolean;
  query: DiscoveredHostQuery;
  onQueryChange: (query: DiscoveredHostQuery) => void;
  selectedIpAddresses: Record<string, boolean>;
  onSelectionChange: (
    update: (current: Record<string, boolean>) => Record<string, boolean>,
  ) => void;
  isDisabled?: boolean | undefined;
}

const DiscoveredHostTable: FunctionComponent<DiscoveredHostTableProps> = (
  props: DiscoveredHostTableProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [page, setPage] = useState<number>(1);

  const query: DiscoveredHostQuery = props.query;
  const hosts: Array<DiscoveredNetworkDevice> = props.hosts;

  // A new view starts on its first page.
  useEffect(() => {
    setPage(1);
  }, [query.answered, query.name, query.search, query.hideAlreadyAdded]);

  const answeredOptions: Array<FilterButtonOption> = useMemo(() => {
    return getDiscoveredHostFilterOptions(
      getHostsCountedByFacet({ hosts: hosts, query: query, facet: "answered" }),
      translator,
    ).map((option: DiscoveredHostFilterOption): FilterButtonOption => {
      return { label: option.label, value: option.value };
    });
  }, [hosts, query, translator]);

  const nameOptions: Array<FilterButtonOption> = useMemo(() => {
    return getDiscoveredHostNameFilterOptions(
      getHostsCountedByFacet({ hosts: hosts, query: query, facet: "name" }),
      translator,
    ).map((option: DiscoveredHostNameFilterOption): FilterButtonOption => {
      return { label: option.label, value: option.value };
    });
  }, [hosts, query, translator]);

  /*
   * Each row carries its position in the UNFILTERED scan, so its React key
   * does not change when the view does - see ShownDiscoveredHost.
   */
  const shownHosts: Array<ShownDiscoveredHost> = useMemo(() => {
    return getShownDiscoveredHosts({ hosts: hosts, filter: query });
  }, [hosts, query]);

  const selectableShownCount: number = countSelectableShownHosts({
    hosts: hosts,
    filter: query,
  });

  const areAllShownSelected: boolean = areAllShownHostsSelected({
    hosts: hosts,
    filter: query,
    selectedIpAddresses: props.selectedIpAddresses,
  });

  const selection: { selected: number; hiddenSelected: number } =
    countSelectedDiscoveredHosts({
      hosts: hosts,
      filter: query,
      selectedIpAddresses: props.selectedIpAddresses,
    });

  const shownSelectedCount: number =
    selection.selected - selection.hiddenSelected;

  /*
   * The vendor column, only when a host has something to put in it: a scan
   * that pinged and asked nothing else has no vendor or description for
   * any host, and a column of dashes is only width taken from the names.
   */
  const hasVendorColumn: boolean = useMemo(() => {
    return hosts.some((host: DiscoveredNetworkDevice): boolean => {
      return Boolean(getDiscoveredHostVendor(host) || host.sysDescr);
    });
  }, [hosts]);

  const alreadyAddedCount: number = hosts.filter(
    (host: DiscoveredNetworkDevice): boolean => {
      return Boolean(host.isAlreadyRegistered);
    },
  ).length;

  const pageCount: number = Math.max(
    1,
    Math.ceil(shownHosts.length / DISCOVERED_HOSTS_PER_PAGE),
  );
  const currentPage: number = Math.min(page, pageCount);
  const pageHosts: Array<ShownDiscoveredHost> = shownHosts.slice(
    (currentPage - 1) * DISCOVERED_HOSTS_PER_PAGE,
    currentPage * DISCOVERED_HOSTS_PER_PAGE,
  );

  const isNarrowed: boolean = isDiscoveredHostQueryNarrowed(query);

  const clearFilters: () => void = (): void => {
    props.onQueryChange({
      ...query,
      answered: DiscoveredHostFilter.All,
      name: DiscoveredHostNameFilter.Any,
      search: "",
      hideAlreadyAdded: false,
    });
  };

  const toggleShown: () => void = (): void => {
    props.onSelectionChange((current: Record<string, boolean>) => {
      return toggleSelectionForShownHosts({
        hosts: hosts,
        filter: query,
        selectedIpAddresses: current,
      });
    });
  };

  return (
    <div className="space-y-3" data-testid="discovered-host-table">
      {/*
       * The search on the left, the facets on the right, each facet's name
       * above its buttons: the buttons of two facets line up however long
       * either name is, in any language, and on a phone each facet is a
       * block of its own. The search lines up with the buttons' row.
       */}
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between lg:gap-x-6">
        <div className="group relative w-full lg:w-auto lg:min-w-[16rem] lg:max-w-md lg:flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400 transition-colors duration-150 group-focus-within:text-indigo-500">
            <Icon icon={IconProp.Search} className="h-4 w-4" />
          </span>
          <input
            data-unsaved-changes-ignore
            type="text"
            value={query.search || ""}
            /*
             * Says everything the box finds a host by - the subnet the
             * placeholder offers included - so the name a screen reader
             * reads holds the words on screen.
             */
            aria-label={translator.translateText(
              "Search hosts by name, address, subnet or vendor",
            )}
            data-testid="discovered-host-search"
            placeholder={translator.translateText(
              "Search by name, address or subnet",
            )}
            disabled={props.isDisabled}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              props.onQueryChange({ ...query, search: event.target.value });
            }}
            className="h-10 w-full rounded-md border border-gray-300 bg-white pl-10 pr-10 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition duration-150 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          {query.search ? (
            <button
              type="button"
              aria-label={translator.translateText("Clear search")}
              title={translator.translateText("Clear search")}
              data-testid="discovered-host-search-clear"
              onClick={() => {
                props.onQueryChange({ ...query, search: "" });
              }}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 transition-colors hover:text-gray-600 focus:outline-none focus-visible:text-gray-600"
            >
              <Icon icon={IconProp.Close} className="h-4 w-4" />
            </button>
          ) : (
            <></>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          {/*
           * Not offered on a scan that asked nothing about SNMP: every host
           * would be in one group, and an empty "SNMP (0)" reads as a
           * credential failure on a sweep that carried no credentials.
           */}
          {!props.isIcmpOnly && (
            <div
              className="flex min-w-0 flex-col gap-1.5"
              data-testid="discovered-host-answered-facet"
            >
              {/*
               * "Responded", the word the scans table's Responded Hosts
               * column uses - not "Answered", whose translations are a
               * phone call's (Incoming Call Policy logs share that key).
               */}
              <span
                className="text-xs font-medium text-gray-500"
                aria-hidden="true"
              >
                {translator.translateText("Responded")}
              </span>
              <FilterButtons
                className="flex-wrap [&>button]:whitespace-nowrap"
                ariaLabel="Responded"
                options={answeredOptions}
                selectedValue={query.answered}
                onSelect={(value: string) => {
                  props.onQueryChange({
                    ...query,
                    answered: value as DiscoveredHostFilter,
                  });
                }}
              />
            </div>
          )}
          <div
            className="flex min-w-0 flex-col gap-1.5"
            data-testid="discovered-host-name-facet"
          >
            <span
              className="text-xs font-medium text-gray-500"
              aria-hidden="true"
            >
              {translator.translateText("Name")}
            </span>
            <FilterButtons
              className="flex-wrap [&>button]:whitespace-nowrap"
              ariaLabel="Name"
              options={nameOptions}
              selectedValue={query.name || DiscoveredHostNameFilter.Any}
              onSelect={(value: string) => {
                props.onQueryChange({
                  ...query,
                  name: value as DiscoveredHostNameFilter,
                });
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <CheckboxElement
            dataTestId="discovered-device-select-all"
            ariaLabel={
              areAllShownSelected
                ? translator.translateTemplate(
                    "Clear the {{count}} hosts shown",
                    { count: translator.formatNumber(selectableShownCount) },
                  )
                : translator.translateTemplate(
                    "Select the {{count}} hosts shown",
                    { count: translator.formatNumber(selectableShownCount) },
                  )
            }
            initialValue={areAllShownSelected}
            value={areAllShownSelected}
            isIndeterminate={!areAllShownSelected && shownSelectedCount > 0}
            disabled={selectableShownCount === 0 || props.isDisabled}
            onChange={() => {
              toggleShown();
            }}
          />
          <span
            className="text-sm font-medium text-gray-900"
            data-testid="discovered-host-selection-count"
            role="status"
            aria-live="polite"
          >
            {translator.translatePlural(
              {
                one: "{{count}} host selected",
                other: "{{count}} hosts selected",
              },
              shownSelectedCount,
              { count: translator.formatNumber(shownSelectedCount) },
            )}
          </span>
          {/*
           * Links in the product's link colour: in the grey of a secondary
           * link, "Select all 511" and "Clear selection" read as disabled
           * text beside the bold count.
           */}
          {selectableShownCount > 0 && !areAllShownSelected && (
            <Button
              title={translator.translateTemplate("Select all {{count}}", {
                count: translator.formatNumber(selectableShownCount),
              })}
              dataTestId="discovered-host-select-shown"
              buttonStyle={ButtonStyleType.LINK}
              buttonSize={ButtonSize.ExtraSmall}
              className="text-sm font-medium"
              disabled={props.isDisabled}
              onClick={toggleShown}
            />
          )}
          {selection.selected > 0 && (
            <Button
              title="Clear selection"
              dataTestId="discovered-host-clear-selection"
              buttonStyle={ButtonStyleType.LINK}
              buttonSize={ButtonSize.ExtraSmall}
              className="text-sm font-medium"
              disabled={props.isDisabled}
              onClick={() => {
                props.onSelectionChange(() => {
                  return {};
                });
              }}
            />
          )}
          {selection.hiddenSelected > 0 && (
            <span
              className="text-xs text-amber-700"
              data-testid="discovered-host-hidden-selection"
            >
              {translator.translatePlural(
                {
                  one: "{{count}} selected host is hidden by the filters and will not be imported.",
                  other:
                    "{{count}} selected hosts are hidden by the filters and will not be imported.",
                },
                selection.hiddenSelected,
                {
                  count: translator.formatNumber(selection.hiddenSelected),
                },
              )}
            </span>
          )}
        </div>
        {alreadyAddedCount > 0 && (
          <div className="flex-shrink-0">
            <Toggle
              title={translator.translatePlural(
                {
                  one: "Hide {{count}} already added",
                  other: "Hide {{count}} already added",
                },
                alreadyAddedCount,
                { count: translator.formatNumber(alreadyAddedCount) },
              )}
              initialValue={Boolean(query.hideAlreadyAdded)}
              value={Boolean(query.hideAlreadyAdded)}
              dataTestId="discovered-host-hide-already-added"
              onChange={(value: boolean) => {
                props.onQueryChange({ ...query, hideAlreadyAdded: value });
              }}
            />
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <div
          className={`gap-4 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 max-md:hidden md:grid ${
            hasVendorColumn ? HOST_GRID_WITH_VENDOR : HOST_GRID_WITHOUT_VENDOR
          }`}
          aria-hidden="true"
        >
          <span />
          <span>{translator.translateText("Host")}</span>
          {hasVendorColumn && <span>{translator.translateText("Vendor")}</span>}
          <span className="text-right">
            {translator.translateText("Status")}
          </span>
        </div>
        {shownHosts.length === 0 ? (
          <div
            className="px-4 py-10 text-center"
            data-testid="discovered-host-empty"
          >
            <p className="text-sm text-gray-500">
              {hosts.length === 0
                ? getDiscoveredHostFilterEmptyMessage(DiscoveredHostFilter.All)
                : isNarrowed &&
                    (query.search ||
                      query.hideAlreadyAdded ||
                      (query.name &&
                        query.name !== DiscoveredHostNameFilter.Any))
                  ? translator.translateText(
                      "No host matches the search and filters.",
                    )
                  : getDiscoveredHostFilterEmptyMessage(query.answered)}
            </p>
            {hosts.length > 0 && isNarrowed && (
              <div className="mt-3 flex justify-center">
                <Button
                  title="Clear filters"
                  dataTestId="discovered-host-clear-filters"
                  buttonStyle={ButtonStyleType.LINK}
                  buttonSize={ButtonSize.ExtraSmall}
                  className="text-sm font-medium"
                  onClick={clearFilters}
                />
              </div>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100" role="list">
            {pageHosts.map((shown: ShownDiscoveredHost): ReactElement => {
              return (
                <DiscoveredHostRow
                  /*
                   * Scan position, not position in the filtered list - see
                   * ShownDiscoveredHost. A key that moved with the view
                   * would remount every row on every filter click.
                   */
                  key={`${shown.host.ipAddress}-${shown.scanIndex}`}
                  entry={shown.host}
                  scan={props.scan}
                  isGlobalProbe={props.isGlobalProbe}
                  hasVendorColumn={hasVendorColumn}
                  isChecked={
                    isSelectableDiscoveredHost(shown.host) &&
                    isSelectedIpAddress({
                      selectedIpAddresses: props.selectedIpAddresses,
                      ipAddress: shown.host.ipAddress,
                    })
                  }
                  isDisabled={Boolean(props.isDisabled)}
                  onCheckedChange={(value: boolean) => {
                    props.onSelectionChange(
                      (current: Record<string, boolean>) => {
                        return {
                          ...current,
                          [shown.host.ipAddress]: value,
                        };
                      },
                    );
                  }}
                />
              );
            })}
          </ul>
        )}
      </div>

      {shownHosts.length > DISCOVERED_HOSTS_PER_PAGE && (
        <Pagination
          currentPageNumber={currentPage}
          totalItemsCount={shownHosts.length}
          itemsOnPage={DISCOVERED_HOSTS_PER_PAGE}
          onNavigateToPage={(pageNumber: number) => {
            setPage(pageNumber);
          }}
          isLoading={false}
          isError={false}
          singularLabel="Host"
          pluralLabel="Hosts"
          isCompact={true}
          dataTestId="discovered-host-pagination"
        />
      )}
    </div>
  );
};

export interface DiscoveredHostRowProps {
  entry: DiscoveredNetworkDevice;
  scan: NetworkDeviceDiscoveryScan;
  isGlobalProbe: boolean | undefined;
  // The table shows a vendor column (some host of the scan has a vendor).
  hasVendorColumn: boolean;
  isChecked: boolean;
  isDisabled: boolean;
  onCheckedChange: (value: boolean) => void;
}

/*
 * One host. Everything the row says about a host's names comes from the
 * shared naming rules the import builds the device with, so the name beside
 * the checkbox is the name the device gets, character for character.
 */
export const DiscoveredHostRow: FunctionComponent<DiscoveredHostRowProps> = (
  props: DiscoveredHostRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const entry: DiscoveredNetworkDevice = props.entry;
  const scanToReview: NetworkDeviceDiscoveryScan = props.scan;
  /*
   * Ping-only hosts (snmpReachable === false) import too, with no
   * credentials and pinged by the scan's probe, rather than carrying
   * credentials they never answered to. They are badged so the reviewer
   * knows what they are agreeing to.
   */
  const isPingOnly: boolean = isPingOnlyDiscoveredHost(entry);
  /*
   * The SAME predicate every count, the select-all box and the import use,
   * so a row never offers a box no count agrees exists.
   */
  const isSelectable: boolean = isSelectableDiscoveredHost(entry);
  const isChecked: boolean = isSelectable && props.isChecked;
  const vendor: string | undefined = getDiscoveredHostVendor(entry);
  /*
   * Why this host is listed by its address, when it is - or undefined when it
   * has a name (OneUptime issue #3916). ALL of the wording lives in Common,
   * where every sentence is unit-tested, and nothing the scanned host chose
   * is ever put into it.
   *
   * Computed HERE, before the name line, and not among the naming
   * statements that follow: those are lifted out of this file and executed
   * on their own by the App suite's DiscoveryReviewHostname tests, with only
   * the builders they use injected.
   */
  const unnamedHostExplanation: DiscoveredHostNamingExplanation | undefined =
    explainUnnamedDiscoveredHost({
      host: entry,
      scan: scanToReview,
      isGlobalProbe: props.isGlobalProbe,
    });
  /*
   * `buildDeviceName`, not the unclamped display name: this row shows the
   * name the device will ACTUALLY be created with, character for character -
   * under the scan's own naming choice, the one the import is handed, so a
   * scan set to short names shows "core-sw-01" here and creates "core-sw-01"
   * (issue #3678).
   */
  const displayName: string = buildDeviceName(entry, scanToReview);
  /*
   * What the name line would read with nothing cut off it: the winning name
   * before the short-name option and before the 80-character clamp. When the
   * two differ the line above has lost something the reviewer may need to
   * tell hosts apart, so it goes on the second line in full.
   */
  const fullName: string = getDiscoveredHostFullName(entry);
  /*
   * Re-normalised rather than read raw: this is the one place the
   * attacker-chosen bytes of a PTR record would be rendered verbatim if the
   * normalisation upstream ever stopped happening.
   */
  const normalizedDnsHostname: string | undefined = normalizeReverseDnsName(
    entry.dnsHostname,
  );
  /*
   * The two extra names, each printed at most once and never when it IS the
   * name line. A sysName and PTR record that disagree both appear, whatever
   * the scan's naming choice: shortening the name line must not be what
   * hides a stale reverse zone.
   */
  const secondaryFullName: string | undefined =
    fullName !== displayName ? fullName : undefined;
  const secondaryDnsHostname: string | undefined =
    normalizedDnsHostname &&
    normalizedDnsHostname !== displayName &&
    normalizedDnsHostname !== secondaryFullName
      ? normalizedDnsHostname
      : undefined;
  /*
   * Whether the name line is a NetBIOS name (issues #3677, #4518), asked of
   * the naming rule itself so the hint can never disagree with the name.
   */
  const isNamedByNetbios: boolean =
    getDiscoveredHostNameSource(entry) === DeviceNameSource.NetbiosName;
  return (
    <li
      className={`flex flex-col gap-2 px-3 py-3 md:grid md:items-start md:gap-4 ${
        props.hasVendorColumn ? HOST_GRID_WITH_VENDOR : HOST_GRID_WITHOUT_VENDOR
      } ${entry.isAlreadyRegistered ? "bg-gray-50/60" : ""}`}
      data-testid={`discovered-host-row-${entry.ipAddress}`}
    >
      <div className="flex min-w-0 items-start gap-3 md:contents">
        <div className="pt-0.5">
          <CheckboxElement
            dataTestId={`discovered-device-checkbox-${entry.ipAddress}`}
            /*
             * initialValue as well as value: CheckboxElement seeds its own
             * state from initialValue and only reconciles value in a passive
             * effect, so without this a row mounts unticked and corrects
             * itself a frame later.
             */
            initialValue={isChecked}
            value={isChecked}
            disabled={!isSelectable || props.isDisabled}
            ariaLabel={translator.translateTemplate(
              "Import {{name}} ({{address}})",
              {
                name: displayName,
                address: entry.ipAddress || translatableTerm("no address"),
              },
            )}
            hoverText={
              entry.isAlreadyRegistered
                ? "Already added as a Network Device."
                : entry.ipAddress
                  ? undefined
                  : "This host reported no address, so it cannot be imported."
            }
            onChange={(value: boolean) => {
              props.onCheckedChange(value);
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <div
              className={`truncate text-sm font-medium ${
                entry.isAlreadyRegistered ? "text-gray-500" : "text-gray-900"
              }`}
              title={displayName}
            >
              {displayName}
            </div>
            {unnamedHostExplanation && (
              <Fragment>
                <span className="flex-shrink-0 text-xs text-gray-400">
                  {translator.translateText(unnamedHostExplanation.label)}
                </span>
                <InfoTooltip
                  label={translator.translateTemplate(
                    "why {{address}} has no name",
                    { address: entry.ipAddress },
                  )}
                  text={unnamedHostExplanation.text}
                  dataTestId={`discovered-device-unnamed-${entry.ipAddress}`}
                />
              </Fragment>
            )}
          </div>
          <div className="truncate text-sm text-gray-500">
            {entry.ipAddress}
            {isNamedByNetbios && (
              <span
                className="text-gray-400"
                title={translator.translateText(
                  "The Windows computer name this host reported for itself over NetBIOS. A host's own name is used ahead of its reverse-DNS name.",
                )}
              >
                {" · "}
                {translator.translateText("NetBIOS name")}
              </span>
            )}
            {secondaryFullName && (
              <span className="text-gray-400">
                {" · "}
                {secondaryFullName}
              </span>
            )}
            {secondaryDnsHostname && (
              <span className="text-gray-400">
                {" · "}
                {secondaryDnsHostname}
              </span>
            )}
          </div>
        </div>
      </div>
      {props.hasVendorColumn && (
        /*
         * On a phone the vendor and the badges sit under the name, indented
         * to start where the name starts: the box's column (28px) and the
         * gap after it (12px).
         */
        <div className="min-w-0 pl-10 md:pl-0">
          {vendor ? (
            <div
              className="truncate text-sm text-gray-700"
              data-testid={`discovered-host-vendor-${entry.ipAddress}`}
            >
              {vendor}
            </div>
          ) : (
            <></>
          )}
          {entry.sysDescr ? (
            /*
             * Under the vendor, the small print; with no vendor to put it
             * under, the description is the cell's one line, and reads as
             * one rather than as a faint footnote to nothing.
             */
            <div
              className={`truncate ${
                vendor ? "text-xs text-gray-400" : "text-sm text-gray-600"
              }`}
              title={entry.sysDescr}
            >
              {entry.sysDescr}
            </div>
          ) : !vendor ? (
            <div className="text-sm text-gray-300 max-md:hidden md:block">
              —
            </div>
          ) : (
            <></>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 pl-10 md:justify-end md:pl-0">
        {isPingOnly ? (
          <span
            className="inline-flex flex-shrink-0 items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
            title={translator.translateText(
              "Responds to ping only. Imports as a device pinged by the scan's probe, with no SNMP credentials — add them later for interfaces and inventory.",
            )}
          >
            {translator.translateText("No SNMP")}
          </span>
        ) : (
          <></>
        )}
        {entry.isAlreadyRegistered && (
          <span className="inline-flex flex-shrink-0 items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {translator.translateText("Already added")}
          </span>
        )}
      </div>
    </li>
  );
};

export default DiscoveredHostTable;
