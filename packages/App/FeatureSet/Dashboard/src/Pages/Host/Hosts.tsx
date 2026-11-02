import PageMap from "../../Utils/PageMap";
import { ARCHIVE_INSTEAD_OF_DELETE } from "../../Components/Archive/ResourceArchiveCopy";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Host from "Common/Models/DatabaseModels/Host";
import HostOwnerTeam from "Common/Models/DatabaseModels/HostOwnerTeam";
import HostOwnerUser from "Common/Models/DatabaseModels/HostOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners, {
  ResourceFacet,
  buildEnumFacetQuery,
} from "../../Components/ResourceOwners/useResourceOwners";
import { FilterOperator } from "../../Components/ResourceOwners/FilterChipDropdown";
import IconProp from "Common/Types/Icon/IconProp";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useId,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import useFirstRecordWatch, {
  FirstRecordWatch,
} from "../../Components/Infrastructure/UseFirstRecordWatch";
import {
  getFirstRunEmptyState,
  getFirstRunTopContent,
} from "../../Components/Infrastructure/FirstRecordWatch";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import AddHostModal from "../../Components/HostCollector/AddHostModal";
import ResourceShowcaseCard from "../../Components/ResourceShowcase/ResourceShowcaseCard";
import HOST_SHOWCASE from "../../Components/Host/HostShowcase";
import HostCollectorStatePill from "../../Components/HostCollector/HostCollectorStatePill";
import {
  getHostCollectorConfigLabel,
  isHostCollectorManaged,
} from "../../Components/HostCollector/HostCollectorStatus";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import AppLink from "../../Components/AppLink/AppLink";
import HostFleetAttentionCard from "../../Components/Host/HostFleetAttentionCard";
import {
  HOST_STATUS_COLUMN_CLASS_NAME,
  HOST_USAGE_COLUMN_CLASS_NAME,
  HostCellLine,
  HostStatusCell,
  HostUsageCell,
  getHostCellLine,
} from "../../Components/Host/HostListCells";
import ObjectID from "Common/Types/ObjectID";
import { HOST_METRIC_DESCRIPTIONS } from "../../Components/MetricDescriptions/HostMetricDescriptions";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * The config a host runs, under its collector's state: as wide as the
 * state's pill and no wider (w-0 + min-w-full adds nothing to the column's
 * width), so a long config name ends in "…" with the full name on hover
 * instead of pushing the Collector column under the row's actions.
 */
const HOSTS_COLLECTOR_CONFIG_LABEL_CLASS_NAME: string =
  "w-0 min-w-full truncate text-xs text-gray-500";

/*
 * The host's name, never narrower than 8rem beside its Status and usage
 * bars, cut short at 12rem: named here, the table leaves the column's
 * width to the page rather than giving the name's room to the bars.
 */
export const HOSTS_NAME_CELL_WIDTH_CLASS_NAME: string =
  "min-w-[8rem] max-w-[12rem]";

const isIPv4: (ip: string) => boolean = (ip: string): boolean => {
  return ip.includes(".") && !ip.includes(":");
};

const isLoopback: (ip: string) => boolean = (ip: string): boolean => {
  const lower: string = ip.toLowerCase();
  return lower === "::1" || lower.startsWith("127.");
};

const isLinkLocal: (ip: string) => boolean = (ip: string): boolean => {
  const lower: string = ip.toLowerCase();
  return lower.startsWith("fe80:") || lower.startsWith("169.254.");
};

const ipDisplayScore: (ip: string) => number = (ip: string): number => {
  let score: number = 0;
  if (isIPv4(ip)) {
    score += 100;
  }
  if (!isLoopback(ip)) {
    score += 10;
  }
  if (!isLinkLocal(ip)) {
    score += 1;
  }
  return score;
};

const parseIpString: (ipString: string) => Array<string> = (
  ipString: string,
): Array<string> => {
  const seen: Set<string> = new Set<string>();
  const ips: Array<string> = [];
  for (const raw of ipString.split(",")) {
    const trimmed: string = raw.trim();
    if (!trimmed) {
      continue;
    }
    const key: string = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    ips.push(trimmed);
  }
  return ips;
};

// Exported for its tests: a host's addresses, the rest folded under "+N more".
export const IpAddressCell: FunctionComponent<{ ipString: string }> = (props: {
  ipString: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const restListId: string = `host-ip-addresses-${useId()}`;

  if (!props.ipString) {
    return <span className="text-sm text-gray-400">—</span>;
  }

  const ips: Array<string> = parseIpString(props.ipString);
  if (ips.length === 0) {
    return <span className="text-sm text-gray-400">—</span>;
  }

  const sorted: Array<string> = [...ips].sort(
    (a: string, b: string): number => {
      return ipDisplayScore(b) - ipDisplayScore(a);
    },
  );
  const primary: string = sorted[0]!;
  const rest: Array<string> = sorted.slice(1);

  /*
   * One button under the addresses, open or folded: "+2 more" opens the rest
   * above it and it becomes Show less, in the same place, so a press keeps
   * focus on it. They were two buttons, one per state, and a press dropped
   * focus to the page. Its focus ring is the product's link ring, not the
   * browser's outline.
   */
  return (
    <div className="text-sm text-gray-700">
      <div className="font-mono">{primary}</div>
      {rest.length > 0 && isExpanded && (
        <div
          id={restListId}
          className="mt-1 flex flex-col gap-0.5"
          data-testid="host-ip-addresses-rest"
        >
          {rest.map((ip: string): ReactElement => {
            return (
              <div key={ip} className="font-mono text-xs text-gray-600">
                {ip}
              </div>
            );
          })}
        </div>
      )}
      {rest.length > 0 && (
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={isExpanded ? restListId : undefined}
          data-testid="host-ip-addresses-toggle"
          onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
          className={`${
            isExpanded ? "mt-0.5 " : ""
          }-mx-1 cursor-pointer rounded-sm px-1 text-xs text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
        >
          {isExpanded
            ? translator.translateText("Show less")
            : translator.translatePlural(
                { one: "+{{count}} more", other: "+{{count}} more" },
                rest.length,
              )}
        </button>
      )}
    </div>
  );
};

const Hosts: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const firstRecordWatch: FirstRecordWatch = useFirstRecordWatch<Host>({
    modelType: Host,
  });
  const [isAddHostOpen, setIsAddHostOpen] = useState<boolean>(false);
  // Hosts connected from the Add Host dialog show in the list at once.
  const [connectedCount, setConnectedCount] = useState<number>(0);

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<Host>({ modelType: Host });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<Host>({
      ownerUserModelType: HostOwnerUser,
      ownerTeamModelType: HostOwnerTeam,
      resourceIdField: "hostId",
    });

  const { archiveBulkActions, archiveRowActions } = useBulkArchiveActions<Host>(
    {
      modelType: Host,
    },
  );

  const hostExtraFacets: Array<ResourceFacet> = [
    {
      key: "otelCollectorStatus",
      label: "Status",
      icon: IconProp.Wifi,
      isMultiSelect: false,
      options: [
        { value: "connected", label: "Connected" },
        { value: "disconnected", label: "Disconnected" },
      ],
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildEnumFacetQuery(values, operator, false);
      },
    },
    {
      key: "osType",
      label: "OS",
      icon: IconProp.ComputerDesktop,
      isMultiSelect: true,
      options: [
        { value: "linux", label: "Linux" },
        { value: "darwin", label: "macOS" },
        { value: "windows", label: "Windows" },
        { value: "freebsd", label: "FreeBSD" },
      ],
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildEnumFacetQuery(values, operator);
      },
    },
    {
      key: "hostArch",
      label: "Architecture",
      icon: IconProp.CPUChip,
      isMultiSelect: true,
      options: [
        { value: "amd64", label: "amd64" },
        { value: "arm64", label: "arm64" },
        { value: "x86", label: "x86" },
        { value: "arm", label: "arm" },
      ],
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildEnumFacetQuery(values, operator);
      },
    },
  ];

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<Host>({
    persistKey: "hosts-table",
    ownerUserModelType: HostOwnerUser,
    ownerTeamModelType: HostOwnerTeam,
    resourceIdField: "hostId",
    showLabelsFacet: true,
    extraFacets: hostExtraFacets,
  });

  if (firstRecordWatch.isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (firstRecordWatch.error) {
    return (
      <ErrorMessage
        message={firstRecordWatch.error}
        onRefreshClick={firstRecordWatch.retry}
      />
    );
  }

  // Every row's readings are judged against one moment (HostHealth).
  const now: Date = new Date();

  /*
   * A host is added by running one command on it (Add Host): the command
   * installs the collector OneUptime configures, and the host registers
   * itself when it connects - named after its hostname, with the labels the
   * command gave it. There is no form: a host typed in by hand would only
   * wait for telemetry that nothing sends.
   */
  return (
    <Fragment>
      {/*
       * What on the fleet needs someone, the most urgent first, before the
       * list: hosts not reporting, filling up, short of memory, overloaded,
       * with failed units or a config that did not start (HostHealth).
       */}
      {(firstRecordWatch.count ?? 0) > 0 ? (
        <HostFleetAttentionCard
          refreshToken={`${firstRecordWatch.refreshToken}-${connectedCount}`}
        />
      ) : (
        <></>
      )}
      <ModelTable<Host>
        modelType={Host}
        // Archive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...archiveRowActions]}
        refreshToggle={`${firstRecordWatch.refreshToken}-${connectedCount}`}
        id="hosts-table"
        userPreferencesKey="hosts-table"
        saveFilterProps={{
          tableId: "hosts-table",
        }}
        topContent={getFirstRunTopContent({
          topContent: filterBar,
          count: firstRecordWatch.count,
        })}
        emptyState={getFirstRunEmptyState({
          emptyState: facetEmptyState,
          count: firstRecordWatch.count,
        })}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({ isArchived: false })}
        onFetchSuccess={(data: Array<Host>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={true}
        deleteConfirmationWarning={ARCHIVE_INSTEAD_OF_DELETE}
        isEditable={false}
        isCreateable={false}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        bulkActions={{
          buttons: [
            ...labelBulkActions,
            ...ownerBulkActions,
            ...archiveBulkActions,
          ],
        }}
        name="Hosts"
        isViewable={true}
        selectMoreFields={{
          osType: true,
          osVersion: true,
          hostArch: true,
          hostIpAddresses: true,
          cpuCores: true,
          totalMemoryBytes: true,
          processCount: true,
          containerRuntime: true,
          lastSeenAt: true,
          createdAt: true,
          collectorInstanceUid: true,
          collectorLastContactAt: true,
          collectorRegisteredAt: true,
          collectorConfigStatus: true,
          isCollectorHealthy: true,
          collectorConfig: {
            name: true,
          },
          // What the host last reported, for Status, CPU, Memory and Disk.
          latestCpuPercent: true,
          latestMemoryPercent: true,
          latestSwapPercent: true,
          latestDiskPercent: true,
          latestDiskMountpoint: true,
          latestInodesPercent: true,
          latestInodesMountpoint: true,
          latestLoadAverage15m: true,
          failedSystemdUnitCount: true,
          failedSystemdUnits: true,
          readingsUpdatedAt: true,
        }}
        cardProps={{
          title: "Hosts",
          description:
            "Hosts being monitored in this project. Add one with a single command on the host.",
          buttons: [
            {
              title: "Add Host",
              phoneTitle: "Add",
              icon: IconProp.Add,
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                setIsAddHostOpen(true);
              },
            },
          ],
        }}
        showViewIdButton={true}
        formFields={[]}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              hostIdentifier: true,
            },
            title: "Host Name (host.name)",
            type: FieldType.Text,
          },
          {
            field: {
              containerRuntime: true,
            },
            title: "Container Runtime",
            type: FieldType.Text,
          },
          {
            field: {
              hostIpAddresses: true,
            },
            title: "IP Address",
            type: FieldType.Text,
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            contentClassName: HOSTS_NAME_CELL_WIDTH_CLASS_NAME,
            getElement: (item: Host): ReactElement => {
              const id: string = (item.hostIdentifier as string) || "";
              const name: string = (item.name as string) || "";
              const showId: boolean = id !== "" && id !== name;
              const osType: string = (item.osType as string) || "";
              const arch: string = (item.hostArch as string) || "";
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.HOST_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              const osLabel: string =
                osType || translator.translateText("unknown") || "unknown";
              /*
               * Its name, its host name where that is another, and what it
               * runs: the OS and architecture a column of their own held.
               * Each line ends in "..." where the column does, is whole
               * under the pointer, and on a Persian page is cut short at
               * its own end (getHostCellLine).
               */
              const nameLine: HostCellLine = getHostCellLine({
                text: name,
                language: translator.language,
                className: "truncate",
              });
              const idLine: HostCellLine = getHostCellLine({
                text: id,
                language: translator.language,
                className: "truncate font-mono text-xs text-gray-500",
              });
              const osLine: HostCellLine = getHostCellLine({
                text: [osLabel, arch].filter(Boolean).join(" "),
                language: translator.language,
                className: "truncate text-xs text-gray-500",
              });
              return (
                <div className="min-w-0">
                  <div
                    dir={nameLine.dir}
                    className={nameLine.className}
                    title={name || undefined}
                  >
                    <AppLink
                      to={route}
                      className="text-sm font-medium text-gray-900 hover:underline"
                    >
                      {name || "—"}
                    </AppLink>
                  </div>
                  {showId && (
                    <div
                      dir={idLine.dir}
                      className={idLine.className}
                      title={id}
                      data-testid="host-identifier"
                    >
                      {id}
                    </div>
                  )}
                  {osType || arch ? (
                    <div
                      dir={osLine.dir}
                      className={osLine.className}
                      data-testid="host-os"
                    >
                      <span className="capitalize">{osLabel}</span>
                      {arch ? (
                        <>
                          {" "}
                          <span className="font-mono text-gray-400">
                            {arch}
                          </span>
                        </>
                      ) : (
                        <></>
                      )}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            contentClassName: HOST_STATUS_COLUMN_CLASS_NAME,
            headerTooltip: HOST_METRIC_DESCRIPTIONS.hostListStatus,
            /*
             * The host's health in one word, by the rules its Needs
             * attention card follows, with the reason under it. A managed
             * host whose collector registered and is still starting says
             * so, pulsing, as it did.
             */
            getElement: (item: Host): ReactElement => {
              return <HostStatusCell host={item} now={now} />;
            },
          },
          {
            field: {
              latestCpuPercent: true,
            },
            title: "CPU",
            type: FieldType.Element,
            contentClassName: HOST_USAGE_COLUMN_CLASS_NAME,
            hideOnMobile: true,
            headerTooltip: HOST_METRIC_DESCRIPTIONS.hostListCpu,
            getElement: (item: Host): ReactElement => {
              return <HostUsageCell host={item} kind="cpu" now={now} />;
            },
          },
          {
            field: {
              latestMemoryPercent: true,
            },
            title: "Memory",
            type: FieldType.Element,
            contentClassName: HOST_USAGE_COLUMN_CLASS_NAME,
            hideOnMobile: true,
            headerTooltip: HOST_METRIC_DESCRIPTIONS.hostListMemory,
            getElement: (item: Host): ReactElement => {
              return <HostUsageCell host={item} kind="memory" now={now} />;
            },
          },
          {
            field: {
              latestDiskPercent: true,
            },
            title: "Disk",
            type: FieldType.Element,
            contentClassName: HOST_USAGE_COLUMN_CLASS_NAME,
            hideOnMobile: true,
            headerTooltip: HOST_METRIC_DESCRIPTIONS.hostListDisk,
            getElement: (item: Host): ReactElement => {
              return <HostUsageCell host={item} kind="disk" now={now} />;
            },
          },
          {
            field: {
              hostIpAddresses: true,
            },
            title: "IP Address",
            type: FieldType.Element,
            hideOnMobile: true,
            // Given way first where the row has no room: Status says why.
            hideBelowLargeScreen: true,
            getElement: (item: Host): ReactElement => {
              return (
                <IpAddressCell
                  ipString={(item.hostIpAddresses as string) || ""}
                />
              );
            },
          },
          {
            field: {
              collectorConfigStatus: true,
            },
            title: "Collector",
            type: FieldType.Element,
            /*
             * Given way where the row has no room, a phone's card
             * included: what asks for action about a host's collector - a
             * config that did not start, a collector that reports an
             * error - is a reason in the Status column too.
             */
            hideBelowLargeScreen: true,
            getElement: (item: Host): ReactElement => {
              // A collector installed by hand: nothing OneUptime manages.
              if (!isHostCollectorManaged(item)) {
                return <TableEmptyValue screenReaderText="Installed by hand" />;
              }
              /*
               * "OneUptime default" without its system: the OS column
               * beside it says that, and the host's Collector page names
               * the default in full.
               */
              const configLabel: string = getHostCollectorConfigLabel(
                {
                  configName: item.collectorConfig?.name,
                },
                translator,
              );
              return (
                <div className="flex min-w-0 flex-col items-start gap-1">
                  <HostCollectorStatePill host={item} />
                  <div
                    className={HOSTS_COLLECTOR_CONFIG_LABEL_CLASS_NAME}
                    title={configLabel}
                    data-testid="host-collector-config-label"
                  >
                    {configLabel}
                  </div>
                </div>
              );
            },
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.DateTime,
            hideBelowLargeScreen: true,
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            hideOnMobile: true,
            hideBelowLargeScreen: true,
            foldInto: "name",
            getElement: (item: Host): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
          {
            field: {
              _id: true,
            },
            title: "Owners",
            type: FieldType.Element,
            hideOnMobile: true,
            hideBelowLargeScreen: true,
            foldInto: "name",
            getElement: (item: Host): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
        onViewPage={(item: Host): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.HOST_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
      {firstRecordWatch.count === 0 && (
        <ResourceShowcaseCard
          showcase={HOST_SHOWCASE}
          addButton={{
            title: "Add Host",
            onClick: () => {
              setIsAddHostOpen(true);
            },
          }}
        />
      )}
      {isAddHostOpen && (
        <AddHostModal
          onClose={() => {
            setIsAddHostOpen(false);
          }}
          onHostConnected={() => {
            // The showcase gives way, and the table reads the new host.
            firstRecordWatch.onRecordCreated();
            setConnectedCount((count: number): number => {
              return count + 1;
            });
          }}
        />
      )}
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default Hosts;
