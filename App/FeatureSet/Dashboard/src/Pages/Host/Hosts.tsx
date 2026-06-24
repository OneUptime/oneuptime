import PageMap from "../../Utils/PageMap";
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
  useEffect,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import HostDocumentationCard from "../../Components/Host/DocumentationCard";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";

interface ResourceSummary {
  cores: number | undefined;
  memoryBytes: number | undefined;
  processes: number | undefined;
}

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
          +{rest.length} more
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
            Show less
          </button>
        </div>
      )}
    </div>
  );
};

const Hosts: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [hostCount, setHostCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<Host>({ modelType: Host });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<Host>({
      ownerUserModelType: HostOwnerUser,
      ownerTeamModelType: HostOwnerTeam,
      resourceIdField: "hostId",
    });

  const { archiveBulkActions } = useBulkArchiveActions<Host>({
    modelType: Host,
  });

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

  const fetchHostCount: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const count: number = await ModelAPI.count({
        modelType: Host,
        query: {},
      });
      setHostCount(count);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchHostCount().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (hostCount === 0) {
    return (
      <Fragment>
        <HostDocumentationCard
          title="Getting Started with Host Monitoring"
          description="No hosts connected yet. Wire up an OpenTelemetry Collector with the hostmetrics receiver using the guide below — your host will appear here automatically once the first metric batch arrives."
        />
      </Fragment>
    );
  }

  return (
    <Fragment>
      <ModelTable<Host>
        modelType={Host}
        id="hosts-table"
        userPreferencesKey="hosts-table"
        saveFilterProps={{
          tableId: "hosts-table",
        }}
        topContent={filterBar}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({ isArchived: false })}
        onFetchSuccess={(data: Array<Host>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
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
        }}
        cardProps={{
          title: "Hosts",
          description:
            "Hosts being monitored in this project. Auto-discovered from any OTel telemetry that carries host.name plus a host signal (host.id, os.type, system.* metrics, etc).",
        }}
        showViewIdButton={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "production-host-1",
          },
          {
            field: {
              hostIdentifier: true,
            },
            title: "Host Identifier",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "host-prod-1",
            description:
              "This should match the host.name attribute reported by the OTel collector.",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Production host running in US East",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
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
            title: "Host Identifier",
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
                  <span className="capitalize">{osType || "unknown"}</span>
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
                      {summary.processes} processes
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
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default Hosts;
