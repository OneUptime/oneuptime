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
  FIRST_RUN_GUIDE_DESCRIPTION,
  getFirstRunEmptyState,
  getFirstRunTopContent,
} from "../../Components/Infrastructure/FirstRecordWatch";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import AddHostGuide from "../../Components/HostCollector/AddHostGuide";
import AddHostModal from "../../Components/HostCollector/AddHostModal";
import HostCollectorStatePill from "../../Components/HostCollector/HostCollectorStatePill";
import {
  getHostCollectorConfigLabel,
  isHostCollectorManaged,
} from "../../Components/HostCollector/HostCollectorStatus";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Pill from "Common/UI/Components/Pill/Pill";
import { Blue, Green, Red } from "Common/Types/BrandColors";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import { HOST_METRIC_DESCRIPTIONS } from "../../Components/MetricDescriptions/HostMetricDescriptions";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

interface ResourceSummary {
  cores: number | undefined;
  memoryBytes: number | undefined;
  processes: number | undefined;
}

/*
 * The config a host runs, under its collector's state: as wide as the
 * state's pill and no wider (w-0 + min-w-full adds nothing to the column's
 * width), so a long config name ends in "…" with the full name on hover
 * instead of pushing the Collector column under the row's actions.
 */
const HOSTS_COLLECTOR_CONFIG_LABEL_CLASS_NAME: string =
  "w-0 min-w-full truncate text-xs text-gray-500";

const formatMemory: (bytes: number | undefined) => string = (
  bytes: number | undefined,
): string => {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes)) {
    return "—";
  }
  const units: Array<string> = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v: number = bytes;
  let i: number = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
};

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

const IpAddressCell: FunctionComponent<{ ipString: string }> = (props: {
  ipString: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

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

  return (
    <div className="text-sm text-gray-700">
      <div className="font-mono">{primary}</div>
      {rest.length > 0 && !isExpanded && (
        <button
          type="button"
          onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
            e.stopPropagation();
            setIsExpanded(true);
          }}
          className="text-xs text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
        >
          {translator.translatePlural(
            { one: "+{{count}} more", other: "+{{count}} more" },
            rest.length,
          )}
        </button>
      )}
      {rest.length > 0 && isExpanded && (
        <div className="mt-1 flex flex-col gap-0.5">
          {rest.map((ip: string): ReactElement => {
            return (
              <div key={ip} className="font-mono text-xs text-gray-600">
                {ip}
              </div>
            );
          })}
          <button
            type="button"
            onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
              e.stopPropagation();
              setIsExpanded(false);
            }}
            className="mt-0.5 self-start text-xs text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
          >
            {translator.translateText("Show less")}
          </button>
        </div>
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

  /*
   * A host is added by running one command on it (Add Host): the command
   * installs the collector OneUptime configures, and the host registers
   * itself when it connects - named after its hostname, with the labels the
   * command gave it. There is no form: a host typed in by hand would only
   * wait for telemetry that nothing sends.
   */
  return (
    <Fragment>
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
          collectorInstanceUid: true,
          collectorLastContactAt: true,
          collectorConfigStatus: true,
          isCollectorHealthy: true,
          collectorConfig: {
            name: true,
          },
        }}
        cardProps={{
          title: "Hosts",
          description:
            "Hosts being monitored in this project. Add one with a single command on the host.",
          buttons: [
            {
              title: "Add Host",
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
            getElement: (item: Host): ReactElement => {
              const id: string = (item.hostIdentifier as string) || "";
              const name: string = (item.name as string) || "";
              const showId: boolean = id !== "" && id !== name;
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.HOST_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              return (
                <div className="min-w-0">
                  <AppLink
                    to={route}
                    className="text-sm font-medium text-gray-900 truncate hover:underline"
                  >
                    {name || "—"}
                  </AppLink>
                  {showId && (
                    <div className="text-xs text-gray-500 font-mono truncate">
                      {id}
                    </div>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              osType: true,
            },
            title: "OS",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: Host): ReactElement => {
              const osType: string = (item.osType as string) || "";
              const arch: string = (item.hostArch as string) || "";
              if (!osType && !arch) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              return (
                <div className="text-sm text-gray-700">
                  <span className="capitalize">
                    {osType || translator.translateText("unknown")}
                  </span>
                  {arch && (
                    <span className="ml-1.5 text-xs font-mono text-gray-500">
                      {arch}
                    </span>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              hostIpAddresses: true,
            },
            title: "IP Address",
            type: FieldType.Element,
            hideOnMobile: true,
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
              cpuCores: true,
            },
            title: "Resources",
            type: FieldType.Element,
            hideOnMobile: true,
            headerTooltip: HOST_METRIC_DESCRIPTIONS.hostListResources,
            getElement: (item: Host): ReactElement => {
              const summary: ResourceSummary = {
                cores: item.cpuCores ?? undefined,
                memoryBytes: item.totalMemoryBytes ?? undefined,
                processes: item.processCount ?? undefined,
              };
              if (
                summary.cores === undefined &&
                summary.memoryBytes === undefined &&
                summary.processes === undefined
              ) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              const parts: Array<string> = [];
              if (summary.cores !== undefined) {
                parts.push(
                  `${summary.cores} core${summary.cores === 1 ? "" : "s"}`,
                );
              }
              if (summary.memoryBytes !== undefined) {
                parts.push(formatMemory(summary.memoryBytes));
              }
              return (
                <div className="text-sm text-gray-700">
                  <div>{parts.join(" · ") || "—"}</div>
                  {summary.processes !== undefined && (
                    <div className="text-xs text-gray-500">
                      {translator.translatePlural(
                        {
                          one: "{{count}} process",
                          other: "{{count}} processes",
                        },
                        summary.processes,
                      )}
                    </div>
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
            getElement: (item: Host): ReactElement => {
              const isConnected: boolean =
                item.otelCollectorStatus === "connected";
              /*
               * A host whose collector OneUptime manages registers before
               * its first metrics: it is starting, not disconnected.
               */
              if (
                !isConnected &&
                !item.lastSeenAt &&
                isHostCollectorManaged(item)
              ) {
                return <Pill text="Starting" color={Blue} isPulsing={true} />;
              }
              return (
                <Pill
                  text={isConnected ? "Connected" : "Disconnected"}
                  color={isConnected ? Green : Red}
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
             * Shown on phones too: a config that failed on a host is the
             * one thing in this row that asks for action.
             */
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
        <AddHostGuide
          title="Add your first host"
          description={FIRST_RUN_GUIDE_DESCRIPTION}
          onHostConnected={() => {
            // The guide gives way, and the table reads the new host.
            firstRecordWatch.onRecordCreated();
            setConnectedCount((count: number): number => {
              return count + 1;
            });
          }}
        />
      )}
      {isAddHostOpen && (
        <AddHostModal
          onClose={() => {
            setIsAddHostOpen(false);
          }}
          onHostConnected={() => {
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
