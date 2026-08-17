import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import ProbeUtil from "../../Utils/Probe";
import Route from "Common/Types/API/Route";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import Probe from "Common/Models/DatabaseModels/Probe";
import NetworkDeviceMonitoringMethod, {
  NetworkDeviceMonitoringMethodUtil,
} from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import {
  MONITORING_METHOD_OPTIONS,
  isMonitorBackedDevice,
  isSnmpDevice,
} from "../../Components/NetworkDevice/MonitoringMethodFormFields";
import {
  DEVICE_ROLE_FIELD_DESCRIPTION,
  DEVICE_ROLE_FIELD_TITLE,
  DEVICE_ROLE_OPTIONS,
} from "../../Components/NetworkDevice/DeviceRoleFormFields";
import BadDataException from "Common/Types/Exception/BadDataException";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { Gray500, Green, Red500 } from "Common/Types/BrandColors";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import ProbeElement from "Common/UI/Components/Probe/Probe";
import Query from "Common/Types/BaseDatabase/Query";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import DeviceSummaryCards from "../../Components/NetworkDevice/DeviceSummaryCards";
import FacetSnapshotNote from "../../Components/Network/FacetSnapshotNote";
import DeviceStatusUtil, {
  DEVICE_FRESH_WINDOW_MINUTES,
  NetworkDeviceStatus,
} from "../../Components/NetworkDevice/DeviceStatusUtil";
import {
  DEVICE_FACET_QUERY_FIELDS,
  DEVICE_INTERFACES_FACET_KEY,
  DEVICE_INTERFACES_FACET_OPTIONS,
  DEVICE_LAST_SEEN_FACET_KEY,
  DEVICE_LAST_SEEN_FACET_OPERATORS,
  DEVICE_PROBE_FACET_KEY,
  DEVICE_SITE_FACET_KEY,
  DEVICE_STATUS_FACET_KEY,
  DEVICE_STATUS_FACET_OPTIONS,
  DeviceStatusCutoff,
  NETWORK_DEVICES_TABLE_ID,
  buildDeviceInterfacesFacetQuery,
  buildDeviceLastSeenFacetQuery,
  buildDeviceStatusFacetQuery,
  isTimeBasedDeviceStatus,
} from "../../Components/NetworkDevice/DeviceFacets";
import { DeviceSummaryTile } from "../../Components/NetworkDevice/DeviceSummaryTiles";
import { applyFacetTileSelection } from "../../Components/ResourceOwners/FacetTileSelection";
import useResourceOwners, {
  ResourceFacet,
  buildEntityFacetQuery,
} from "../../Components/ResourceOwners/useResourceOwners";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../../Components/ResourceOwners/FilterChipDropdownTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { getSnmpConfigFormFields } from "./SnmpConfigFormFields";

/*
 * Stable object identity, because ModelTable decides whether to refetch by
 * comparing the query it was handed against the previous render's. The facet bar
 * merges its chips into a copy of this.
 */
const BASE_DEVICE_QUERY: Query<NetworkDevice> = {
  isArchived: false,
};

// How many rows an option picker asks for per search.
const FACET_PICKER_PAGE_SIZE: number = 50;

const NetworkDevices: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [probes, setProbes] = useState<Array<Probe>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Holds the freshness cutoff behind the Status chip, re-snapshotting it only
   * when the selection changes. See DeviceStatusCutoff for why it cannot simply
   * be "now".
   */
  const statusCutoff: React.MutableRefObject<DeviceStatusCutoff> =
    useRef<DeviceStatusCutoff>(new DeviceStatusCutoff());

  /*
   * The chips above the table. Rebuilt only when the probes land, so the array
   * identity the facet bar memoises against stays stable across renders.
   */
  const deviceFacets: Array<ResourceFacet> = useMemo(() => {
    return [
      {
        key: DEVICE_STATUS_FACET_KEY,
        queryField: DEVICE_FACET_QUERY_FIELDS.status,
        label: "Status",
        icon: IconProp.Heartbeat,
        isMultiSelect: false,
        /*
         * "is" only. The three values are ranges over one column, so "up or
         * pending" is not expressible as a single field query, and the empty
         * operators would write IsNull/NotNull over `lastSeenAt` — duplicating
         * Pending under different wording.
         */
        supportedOperators: ["is"],
        options: DEVICE_STATUS_FACET_OPTIONS,
        /*
         * Both chips write `lastSeenAt`, and the merged query has room for one
         * constraint per column — so picking either clears the other rather
         * than one quietly overwriting the other while both stay lit.
         */
        exclusiveWith: [DEVICE_LAST_SEEN_FACET_KEY],
        toQueryValue: (
          values: Array<string>,
          operator: FilterOperator,
        ): unknown => {
          return buildDeviceStatusFacetQuery(
            values,
            operator,
            statusCutoff.current.getCutoffFor(values[0] || ""),
          );
        },
      },
      {
        key: DEVICE_LAST_SEEN_FACET_KEY,
        queryField: DEVICE_FACET_QUERY_FIELDS.lastSeen,
        label: "Last Seen",
        icon: IconProp.Clock,
        type: "dateRange",
        /*
         * The question the Status chip cannot express: an arbitrary date rather
         * than the fixed 15-minute freshness window. "Not polled since last
         * Tuesday" and "polled between the 1st and the 5th" live here.
         */
        supportedOperators: DEVICE_LAST_SEEN_FACET_OPERATORS,
        exclusiveWith: [DEVICE_STATUS_FACET_KEY],
        toQueryValue: (
          values: Array<string>,
          operator: FilterOperator,
        ): unknown => {
          return buildDeviceLastSeenFacetQuery(values, operator);
        },
      },
      {
        key: DEVICE_INTERFACES_FACET_KEY,
        queryField: DEVICE_FACET_QUERY_FIELDS.interfaces,
        label: "Interfaces",
        icon: IconProp.ArrowUpDown,
        isMultiSelect: false,
        supportedOperators: ["is"],
        options: DEVICE_INTERFACES_FACET_OPTIONS,
        toQueryValue: (
          values: Array<string>,
          operator: FilterOperator,
        ): unknown => {
          return buildDeviceInterfacesFacetQuery(values, operator);
        },
      },
      {
        key: DEVICE_SITE_FACET_KEY,
        queryField: DEVICE_FACET_QUERY_FIELDS.site,
        label: "Site",
        icon: IconProp.BuildingOffice,
        isMultiSelect: true,
        searchPlaceholder: "Search sites...",
        supportedOperators: ["is", "is_not", "is_empty", "is_not_empty"],
        loadOptions: async (
          projectId: ObjectID,
          searchTerm: string,
        ): Promise<Array<FilterChipDropdownOption>> => {
          const query: Query<NetworkSite> = {
            projectId: projectId,
          } as Query<NetworkSite>;

          if (searchTerm.trim()) {
            (query as unknown as Record<string, unknown>)["name"] = new Search(
              searchTerm.trim(),
            );
          }

          const result: ListResult<NetworkSite> =
            await ModelAPI.getList<NetworkSite>({
              modelType: NetworkSite,
              query: query,
              limit: FACET_PICKER_PAGE_SIZE,
              skip: 0,
              select: { _id: true, name: true },
              sort: { name: SortOrder.Ascending },
            });

          return result.data.map((site: NetworkSite) => {
            return {
              value: site.id?.toString() || "",
              label: site.name?.toString() || "",
            };
          });
        },
        resolveOptions: async (
          projectId: ObjectID,
          values: Array<string>,
        ): Promise<Array<FilterChipDropdownOption>> => {
          if (values.length === 0) {
            return [];
          }

          const result: ListResult<NetworkSite> =
            await ModelAPI.getList<NetworkSite>({
              modelType: NetworkSite,
              query: {
                projectId: projectId,
                _id: new Includes(values),
              } as Query<NetworkSite>,
              limit: values.length,
              skip: 0,
              select: { _id: true, name: true },
              sort: {},
            });

          return result.data.map((site: NetworkSite) => {
            return {
              value: site.id?.toString() || "",
              label: site.name?.toString() || "",
            };
          });
        },
        toQueryValue: (
          values: Array<string>,
          operator: FilterOperator,
        ): unknown => {
          return buildEntityFacetQuery(values, operator, true);
        },
      },
      {
        key: DEVICE_PROBE_FACET_KEY,
        queryField: DEVICE_FACET_QUERY_FIELDS.probe,
        label: "Probe",
        icon: IconProp.Signal,
        isMultiSelect: true,
        searchPlaceholder: "Search probes...",
        supportedOperators: ["is", "is_not", "is_empty", "is_not_empty"],
        // Reuses the probes the create form already needed, so the chip is free.
        options: probes.map((probe: Probe): FilterChipDropdownOption => {
          return {
            value: probe.id?.toString() || "",
            label: probe.name?.toString() || "",
          };
        }),
        toQueryValue: (
          values: Array<string>,
          operator: FilterOperator,
        ): unknown => {
          return buildEntityFacetQuery(values, operator, true);
        },
      },
    ];
  }, [probes]);

  const {
    filterBar,
    mergeFiltersIntoQuery,
    hasActiveFilters,
    facetSelections,
    facetOperators,
    setFacetSelection,
    clearAllFacets,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<NetworkDevice>({
    /*
     * Devices have owner users and teams, but this table shows no owner column —
     * a chip filtering on something invisible in the rows would be unexplainable.
     * Enabling it belongs with adding that column.
     */
    showOwnerFacet: false,
    showLabelsFacet: true,
    extraFacets: deviceFacets,
    persistKey: NETWORK_DEVICES_TABLE_ID,
  });

  type OnSummaryTileClickFunction = (tile: DeviceSummaryTile) => void;

  const onSummaryTileClick: OnSummaryTileClickFunction = (
    tile: DeviceSummaryTile,
  ): void => {
    applyFacetTileSelection({
      selection: tile.selection,
      facetSelections: facetSelections,
      facetOperators: facetOperators,
      setFacetSelection: setFacetSelection,
      clearAllFacets: clearAllFacets,
    });
  };

  const selectedDeviceStatus: string | null =
    facetSelections[DEVICE_STATUS_FACET_KEY]?.[0] || null;

  /*
   * Synced with the live selection on every render, including the `null` of a
   * cleared chip. That is what makes picking the SAME value a second time take a
   * fresh window: without seeing the clear, the snapshot would still be keyed on
   * "down" and hand back the window from the first time round.
   *
   * The chip's own toQueryValue asks for the same selection later in this render,
   * so it gets this very Date — stable across renders, which is what stops
   * ModelTable refetching forever.
   */
  const statusWindowCutoff: Date =
    statusCutoff.current.getCutoffFor(selectedDeviceStatus);

  /*
   * The note under the bar, derived from the cutoff the query actually uses rather
   * than from "now" — the two naming different moments is exactly the confusion
   * this note exists to prevent.
   */
  const statusSnapshotDetail: string | undefined = useMemo(() => {
    if (!isTimeBasedDeviceStatus(selectedDeviceStatus)) {
      return undefined;
    }

    return `Up and down are measured against a ${DEVICE_FRESH_WINDOW_MINUTES}-minute window: devices last polled before ${OneUptimeDate.getLocalHourAndMinuteFromDate(
      statusWindowCutoff,
    )} count as down. Pick the status again to refresh it.`;
  }, [selectedDeviceStatus, statusWindowCutoff]);

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<NetworkDevice>({ modelType: NetworkDevice });

  const { archiveBulkActions } = useBulkArchiveActions<NetworkDevice>({
    modelType: NetworkDevice,
  });

  const fetchProbes: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const probes: Array<Probe> = await ProbeUtil.getAllProbes();
      setProbes(probes);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchProbes().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Fragment>
      <DeviceSummaryCards
        facetSelections={facetSelections}
        facetOperators={facetOperators}
        onTileClick={onSummaryTileClick}
      />
      <ModelTable<NetworkDevice>
        modelType={NetworkDevice}
        id={NETWORK_DEVICES_TABLE_ID}
        userPreferencesKey={NETWORK_DEVICES_TABLE_ID}
        query={mergeFiltersIntoQuery(BASE_DEVICE_QUERY)}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        topContent={
          <Fragment>
            {filterBar}
            {statusSnapshotDetail ? (
              <FacetSnapshotNote
                testIdSuffix="network-devices"
                detail={statusSnapshotDetail}
              />
            ) : (
              <></>
            )}
          </Fragment>
        }
        /*
         * "No network device" under a chip that matched nothing reads as an empty
         * project. This says the fleet is there and the bar is what is hiding it.
         *
         * Only the chips — `hasActiveFilters` is the bar's own state, so a search
         * term or a popup filter that matches nothing still falls through to the
         * table's default copy.
         */
        noItemsMessage={
          hasActiveFilters
            ? "No network device matches the filters above."
            : undefined
        }
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        showRefreshButton={true}
        bulkActions={{
          buttons: [...labelBulkActions, ...archiveBulkActions],
        }}
        name="Network Devices"
        isViewable={true}
        searchableFields={["name", "description"]}
        /*
         * Only what the chips cannot express — free text.
         *
         * Status, Last Seen, Interfaces, Site, Probe and Labels have all moved to
         * the facet bar, and their fields have to be gone from here:
         * BaseModelTable spreads this popup's query OVER the page's, so a popup
         * filter on a chip's field would replace the chip's constraint silently,
         * while the chip and the lit tile above carried on claiming it applied.
         */
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
              hostname: true,
            },
            title: "Hostname",
            type: FieldType.Text,
          },
          {
            field: {
              vendor: true,
            },
            title: "Vendor",
            type: FieldType.Text,
          },
        ]}
        cardProps={{
          title: "Network Devices",
          description:
            "Switches, routers, and firewalls monitored via SNMP in this project. Devices are polled by the probe you assign.",
        }}
        showViewIdButton={true}
        formSteps={[
          {
            title: "Monitoring",
            id: "monitoring-method",
          },
          {
            title: "Device Details",
            id: "device-details",
          },
          {
            title: "Probe & Site",
            id: "probe-and-site",
          },
          {
            /*
             * Hidden wholesale for a monitor-backed device: it is never
             * polled, so there is nothing for a community string or a v3
             * credential to be used for.
             */
            title: "SNMP Credentials",
            id: "snmp",
            showIf: isSnmpDevice,
          },
        ]}
        formFields={[
          {
            field: {
              monitoringMethod: true,
            },
            title: "How is this device monitored?",
            stepId: "monitoring-method",
            description:
              "SNMP devices are polled by a probe you assign, on their own schedule. Pick Monitor for gear that cannot be walked — a switch with SNMP disabled, a consumer access point, a PDU — and bind it to an existing Ping or IP monitor instead. Either way the device belongs to a site, carries labels, and appears on the network topology map.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: MONITORING_METHOD_OPTIONS,
            required: true,
            defaultValue: NetworkDeviceMonitoringMethod.Snmp,
            placeholder: "Monitoring method",
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "device-details",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "core-switch-01",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "device-details",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Core switch in the US East datacenter",
          },
          {
            field: {
              deviceRole: true,
            },
            title: DEVICE_ROLE_FIELD_TITLE,
            stepId: "device-details",
            description: DEVICE_ROLE_FIELD_DESCRIPTION,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DEVICE_ROLE_OPTIONS,
            required: false,
            placeholder: "Worked out from the device (SNMP only)",
          },
          {
            field: {
              hostname: true,
            },
            title: "Hostname",
            stepId: "device-details",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "10.0.0.1 or switch-01.example.com",
            description:
              "The device's address. SNMP devices are polled here; for monitor-backed devices it is how the device is identified and matched to SNMP traps.",
          },
          {
            field: {
              monitor: true,
            },
            title: "Monitor",
            stepId: "probe-and-site",
            showIf: isMonitorBackedDevice,
            description:
              "The monitor whose status IS this device's status. A Ping or IP monitor on the device's address is the usual choice. Its status drives the device's status pill, its site's health rollup, and the colour it is drawn in on the topology map.",
            sideLink: {
              text: "Create a monitor",
              url: RouteUtil.populateRouteParams(
                RouteMap[PageMap.MONITORS] as Route,
              ),
              openLinkInNewTab: true,
            },
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: isMonitorBackedDevice,
            placeholder: "Select Monitor",
          },
          {
            field: {
              probe: true,
            },
            title: "Probe",
            stepId: "probe-and-site",
            showIf: isSnmpDevice,
            /*
             * Same constraint as the discovery scan: the probe has to be able
             * to reach the device, so the operator needs to know how to get a
             * probe onto that network from here.
             */
            description:
              "The probe that polls this device on its schedule, and receives its SNMP traps, syslog, and NetFlow. It has to be able to reach the device directly, so pick one deployed on the device's network — if you have none there yet, create a custom probe and run it there. Polling starts as soon as the device is created — no monitor needed.",
            sideLink: {
              text: "Create a custom probe",
              url: RouteUtil.populateRouteParams(
                RouteMap[PageMap.MONITORS_SETTINGS_PROBES] as Route,
              ),
              openLinkInNewTab: true,
            },
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: probes.map((probe: Probe) => {
              if (!probe.name || !probe._id) {
                throw new BadDataException(`Probe name or id is missing`);
              }

              return {
                label: probe.name,
                value: probe._id,
              };
            }),
            required: true,
            placeholder: "Probe",
          },
          {
            field: {
              site: true,
            },
            title: "Site",
            stepId: "probe-and-site",
            description:
              "The network site this device belongs to. Site health rolls up from its devices. Assignment rules can also set this automatically.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: NetworkSite,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Site (optional)",
          },
          ...getSnmpConfigFormFields({ stepId: "snmp" }),
        ]}
        columns={[
          {
            field: {
              _id: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: NetworkDevice): ReactElement => {
              /*
               * A monitor-backed device is never polled, so SNMP freshness
               * says nothing about it — its monitor is the only thing that
               * knows whether it is up, and without this branch every one of
               * them would sit on "Pending" forever.
               */
              if (
                NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
                  item.monitoringMethod,
                )
              ) {
                if (!item.currentMonitorStatus?.name) {
                  return (
                    <Pill
                      text="Pending"
                      color={Gray500}
                      size={PillSize.Small}
                      tooltip="No monitor is bound to this device yet, or the one that is has not reported a status."
                    />
                  );
                }

                return (
                  <Pill
                    text={item.currentMonitorStatus.name}
                    color={item.currentMonitorStatus.color || Gray500}
                    size={PillSize.Small}
                    tooltip="Reported by the monitor bound to this device."
                  />
                );
              }

              const status: NetworkDeviceStatus = DeviceStatusUtil.getStatus(
                item.lastSeenAt,
              );

              if (status === NetworkDeviceStatus.Up) {
                return (
                  <Pill
                    text="Up"
                    color={Green}
                    size={PillSize.Small}
                    tooltip={`Polled successfully within the last ${DEVICE_FRESH_WINDOW_MINUTES} minutes.`}
                  />
                );
              }

              if (status === NetworkDeviceStatus.Down) {
                return (
                  <Pill
                    text="Down"
                    color={Red500}
                    size={PillSize.Small}
                    tooltip={`No successful SNMP poll in the last ${DEVICE_FRESH_WINDOW_MINUTES} minutes.`}
                  />
                );
              }

              return (
                <Pill
                  text="Pending"
                  color={Gray500}
                  size={PillSize.Small}
                  tooltip="This device has not been polled successfully yet."
                />
              );
            },
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: NetworkDevice): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              return (
                <div>
                  <AppLink
                    to={route}
                    className="text-sm font-medium text-gray-900 hover:underline"
                  >
                    {(item.name as string) || "—"}
                  </AppLink>
                  {item.sysName && (
                    <div className="text-xs text-gray-500">{item.sysName}</div>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              hostname: true,
            },
            title: "Hostname",
            type: FieldType.Text,
            hideOnMobile: true,
          },
          {
            field: {
              vendor: true,
            },
            title: "Vendor / Model",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: NetworkDevice): ReactElement => {
              if (!item.vendor && !item.deviceModel) {
                return <span className="text-sm text-gray-400">—</span>;
              }

              return (
                <div>
                  <div className="text-sm text-gray-900">
                    {item.vendor || "—"}
                  </div>
                  {item.deviceModel && (
                    <div className="text-xs text-gray-500">
                      {item.deviceModel}
                    </div>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              site: {
                name: true,
                _id: true,
              },
            },
            title: "Site",
            type: FieldType.Entity,
            hideOnMobile: true,
            getElement: (item: NetworkDevice): ReactElement => {
              if (!item.site?.name || !item.site?._id) {
                return <span className="text-sm text-gray-400">—</span>;
              }

              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_SITE_VIEW] as Route,
                {
                  modelId: new ObjectID(item.site._id.toString()),
                },
              );

              return (
                <AppLink
                  to={route}
                  className="text-sm text-gray-900 hover:underline"
                >
                  {item.site.name}
                </AppLink>
              );
            },
          },
          {
            field: {
              probe: {
                name: true,
                iconFileId: true,
              },
            },
            title: "Probe",
            type: FieldType.Entity,
            hideOnMobile: true,
            getElement: (item: NetworkDevice): ReactElement => {
              return <ProbeElement probe={item["probe"]} />;
            },
          },
          {
            field: {
              interfacesUp: true,
            },
            title: "Interfaces (Up / Down)",
            type: FieldType.Element,
            getElement: (item: NetworkDevice): ReactElement => {
              const up: number = (item.interfacesUp as number) || 0;
              const down: number = (item.interfacesDown as number) || 0;
              return (
                <span className="text-sm font-medium">
                  <span className="text-emerald-700">{up}</span>
                  <span className="text-gray-400"> / </span>
                  <span className={down > 0 ? "text-red-700" : "text-gray-500"}>
                    {down}
                  </span>
                </span>
              );
            },
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.Element,
            getElement: (item: NetworkDevice): ReactElement => {
              if (!item.lastSeenAt) {
                return <span className="text-sm text-gray-400">Never</span>;
              }

              const lastSeen: Date = OneUptimeDate.fromString(item.lastSeenAt);

              return (
                <span
                  className="text-sm text-gray-600"
                  title={OneUptimeDate.getDateAsLocalFormattedString(lastSeen)}
                >
                  {OneUptimeDate.fromNow(lastSeen)}
                </span>
              );
            },
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
            getElement: (item: NetworkDevice): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
        selectMoreFields={{
          interfacesDown: true,
          sysName: true,
          deviceModel: true,
          lastSeenAt: true,
          /*
           * The status pill reads a monitor-backed device's health from its
           * monitor, not from SNMP freshness — nothing polls those, so
           * lastSeenAt would leave every one of them stuck on "Pending".
           */
          monitoringMethod: true,
          currentMonitorStatus: {
            name: true,
            color: true,
            isOfflineState: true,
          },
        }}
        onViewPage={(item: NetworkDevice): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
      {labelBulkActionModals}
    </Fragment>
  );
};

export default NetworkDevices;
