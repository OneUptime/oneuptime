import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import ProbeUtil from "../../Utils/Probe";
import Route from "Common/Types/API/Route";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceRole from "Common/Models/DatabaseModels/NetworkDeviceRole";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
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
  DEVICE_ROLE_DROPDOWN_MODAL,
  DEVICE_ROLE_FIELD_DESCRIPTION,
  DEVICE_ROLE_FIELD_PLACEHOLDER,
  DEVICE_ROLE_FIELD_TITLE,
  getDeviceRoleSettingsLink,
} from "../../Components/NetworkDevice/DeviceRoleFormFields";
import BadDataException from "Common/Types/Exception/BadDataException";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import useBulkOidTemplateActions from "../../Components/NetworkDevice/useBulkOidTemplateActions";
import OidTemplateElement from "../../Components/NetworkDevice/OidTemplateElement";
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
import { Gray500, Green, Red500, Yellow500 } from "Common/Types/BrandColors";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import ProbeElement from "Common/UI/Components/Probe/Probe";
import Query from "Common/Types/BaseDatabase/Query";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import DeviceSummaryCards from "../../Components/NetworkDevice/DeviceSummaryCards";
import DeviceStatusUtil, {
  DEVICE_STATUS_SELECT,
  DeviceReachabilityResult,
  NetworkDeviceStatus,
} from "../../Components/NetworkDevice/DeviceStatusUtil";
import {
  DEVICE_FACET_QUERY_FIELDS,
  DEVICE_INTERFACES_FACET_KEY,
  DEVICE_INTERFACES_FACET_OPTIONS,
  DEVICE_LAST_SEEN_FACET_KEY,
  DEVICE_LAST_SEEN_FACET_OPERATORS,
  DEVICE_PROBE_FACET_KEY,
  DEVICE_ROLE_FACET_KEY,
  DEVICE_SITE_FACET_KEY,
  DEVICE_STATUS_FACET_KEY,
  DEVICE_STATUS_FACET_OPTIONS,
  NETWORK_DEVICES_TABLE_ID,
  buildDeviceInterfacesFacetQuery,
  buildDeviceLastSeenFacetQuery,
  buildDeviceStatusFacetQuery,
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
         * "is" only. The three values partition one column, so "up or
         * pending" is not expressible as a single field query, and the empty
         * operators would write IsNull/NotNull over `isReachable` —
         * duplicating Pending under different wording.
         */
        supportedOperators: ["is"],
        options: DEVICE_STATUS_FACET_OPTIONS,
        toQueryValue: (
          values: Array<string>,
          operator: FilterOperator,
        ): unknown => {
          return buildDeviceStatusFacetQuery(values, operator);
        },
      },
      {
        key: DEVICE_LAST_SEEN_FACET_KEY,
        queryField: DEVICE_FACET_QUERY_FIELDS.lastSeen,
        label: "Last Seen",
        icon: IconProp.Clock,
        type: "dateRange",
        /*
         * The question the Status chip does not answer: not "is it up now"
         * but "when did it last answer". "Has not answered since last
         * Tuesday" and "answered between the 1st and the 5th" live here.
         * Status owns `isReachable` and this chip owns `lastSeenAt`, so the
         * two no longer have to exclude each other.
         */
        supportedOperators: DEVICE_LAST_SEEN_FACET_OPERATORS,
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
        /*
         * "is empty" is the useful half of this chip: an unassigned role means
         * the device is classified from its SNMP identity, so the empty set is
         * how an operator finds the ping-only devices that have nothing to
         * classify and still need an answer.
         */
        key: DEVICE_ROLE_FACET_KEY,
        queryField: DEVICE_FACET_QUERY_FIELDS.role,
        label: "Role",
        icon: IconProp.Identification,
        isMultiSelect: true,
        searchPlaceholder: "Search device roles...",
        supportedOperators: ["is", "is_not", "is_empty", "is_not_empty"],
        loadOptions: async (
          projectId: ObjectID,
          searchTerm: string,
        ): Promise<Array<FilterChipDropdownOption>> => {
          const query: Query<NetworkDeviceRole> = {
            projectId: projectId,
          } as Query<NetworkDeviceRole>;

          if (searchTerm.trim()) {
            (query as unknown as Record<string, unknown>)["name"] = new Search(
              searchTerm.trim(),
            );
          }

          const result: ListResult<NetworkDeviceRole> =
            await ModelAPI.getList<NetworkDeviceRole>({
              modelType: NetworkDeviceRole,
              query: query,
              limit: FACET_PICKER_PAGE_SIZE,
              skip: 0,
              select: { _id: true, name: true },
              // The order the settings page and the map legend use.
              sort: { order: SortOrder.Ascending },
            });

          return result.data.map((role: NetworkDeviceRole) => {
            return {
              value: role.id?.toString() || "",
              label: role.name?.toString() || "",
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

          const result: ListResult<NetworkDeviceRole> =
            await ModelAPI.getList<NetworkDeviceRole>({
              modelType: NetworkDeviceRole,
              query: {
                projectId: projectId,
                _id: new Includes(values),
              } as Query<NetworkDeviceRole>,
              limit: values.length,
              skip: 0,
              select: { _id: true, name: true },
              sort: {},
            });

          return result.data.map((role: NetworkDeviceRole) => {
            return {
              value: role.id?.toString() || "",
              label: role.name?.toString() || "",
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

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<NetworkDevice>({ modelType: NetworkDevice });

  const { archiveBulkActions } = useBulkArchiveActions<NetworkDevice>({
    modelType: NetworkDevice,
  });

  /*
   * Linking an EXISTING fleet to an OID Collection Template. Without a bulk
   * path the template only ever reaches devices created after it shipped,
   * which is the opposite of the problem issue #3507 describes: the routers
   * that need it were imported months ago.
   */
  const {
    bulkActions: oidTemplateBulkActions,
    modals: oidTemplateBulkActionModals,
  } = useBulkOidTemplateActions();

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
        /*
         * No snapshot note any more: the Status chip filters on a stored
         * verdict rather than on a wall-clock window taken when the value was
         * picked, so there is no drift between the rows and the pills for a
         * note to have to explain.
         */
        topContent={filterBar}
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
        /*
         * Bulk "Delete" is not listed here - ModelTable adds it to every table
         * that offers bulk actions, for anyone who may delete the model (issue
         * #3559: cleaning up a fleet of stale or duplicated devices one row at
         * a time is not a real option). What is set here is what the default
         * confirmation cannot know: what else leaves with the devices, and
         * that Archive is the reversible alternative.
         */
        bulkActions={{
          buttons: [
            ...labelBulkActions,
            ...oidTemplateBulkActions,
            ...archiveBulkActions,
          ],
          deleteConfirmationWarning:
            "Their interfaces, links, endpoints and any monitor OneUptime created for them - with that monitor's history - are deleted too. To take devices off this list without losing any of that, archive them instead: archived devices can be restored at any time.",
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
          {
            /*
             * No chip owns `oidTemplateId`, so this one is free to live here:
             * it is how an operator finds the fleet a template already covers
             * — and, after a bulk link, how they check it landed.
             */
            field: {
              oidTemplate: {
                name: true,
              },
            },
            title: "OID Collection Template",
            type: FieldType.Entity,
            filterEntityType: NetworkDeviceOidTemplate,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
        ]}
        cardProps={{
          title: "Network Devices",
          description:
            "Switches, routers, firewalls, and any other gear on your network. SNMP devices are polled by the probe you assign; devices without SNMP are reported on by the monitor you bind to them.",
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
              networkDeviceRole: true,
            },
            title: DEVICE_ROLE_FIELD_TITLE,
            stepId: "device-details",
            description: DEVICE_ROLE_FIELD_DESCRIPTION,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: DEVICE_ROLE_DROPDOWN_MODAL,
            sideLink: getDeviceRoleSettingsLink(),
            required: false,
            placeholder: DEVICE_ROLE_FIELD_PLACEHOLDER,
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

              const reachability: DeviceReachabilityResult =
                DeviceStatusUtil.getReachability(item);

              /*
               * Stale qualifies the verdict, it does not replace it — so it
               * rides along as an amber "Stale" pill next to the real one
               * rather than repainting an answering device red. The row
               * still says what the last poll found; the second pill says
               * nothing has checked since.
               */
              const stalePill: ReactElement = reachability.isStale ? (
                <Pill
                  text="Stale"
                  color={Yellow500}
                  size={PillSize.Small}
                  tooltip={`No SNMP poll has been attempted in the last ${reachability.staleWindowInMinutes} minutes, so this verdict may be out of date — check this device's probe.`}
                />
              ) : (
                <></>
              );

              if (reachability.status === NetworkDeviceStatus.Up) {
                return (
                  <div className="flex items-center gap-1.5">
                    <Pill
                      text="Up"
                      color={Green}
                      size={PillSize.Small}
                      tooltip="The last SNMP poll reached this device."
                    />
                    {stalePill}
                  </div>
                );
              }

              if (reachability.status === NetworkDeviceStatus.Down) {
                return (
                  <div className="flex items-center gap-1.5">
                    <Pill
                      text="Down"
                      color={Red500}
                      size={PillSize.Small}
                      tooltip="The last SNMP poll could not reach this device."
                    />
                    {stalePill}
                  </div>
                );
              }

              return (
                <Pill
                  text="Pending"
                  color={Gray500}
                  size={PillSize.Small}
                  tooltip="This device has not been polled yet."
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
              oidTemplate: {
                name: true,
              },
            },
            title: "Template",
            type: FieldType.Entity,
            hideOnMobile: true,
            /*
             * `selectedProperty` and `getElement` do two different jobs and
             * both are needed. Without the first, the column key is the
             * relation itself, so the cell stringifies to "[object Object]"
             * and the CSV exporter — which never calls getElement — writes
             * the raw object (OneUptime/oneuptime#3490). Naming the property
             * extends the key to "oidTemplate.name", which both resolve to
             * the string.
             */
            selectedProperty: "name",
            getElement: (item: NetworkDevice): ReactElement => {
              return <OidTemplateElement oidTemplate={item["oidTemplate"]} />;
            },
          },
          {
            field: {
              networkDeviceRole: {
                name: true,
              },
            },
            title: "Role",
            type: FieldType.Entity,
            hideOnMobile: true,
            /*
             * Same pair as the Template column above and for the same reason:
             * `selectedProperty` keeps the CSV exporter (which never calls
             * getElement) from writing the raw relation object.
             */
            selectedProperty: "name",
            getElement: (item: NetworkDevice): ReactElement => {
              if (!item.networkDeviceRole?.name) {
                /*
                 * Not "none": an unassigned role means the classifier works it
                 * out from the device's SNMP identity, which is the intended
                 * state for most devices rather than a gap to fill in.
                 */
                return (
                  <span
                    className="text-sm text-gray-400"
                    title="No role assigned — worked out from the device's SNMP identity."
                  >
                    Auto
                  </span>
                );
              }

              return (
                <span className="text-sm text-gray-900">
                  {item.networkDeviceRole.name}
                </span>
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
              /*
               * A monitor-backed device is never walked, so it has no probe
               * BY DESIGN — the import path withholds one deliberately
               * because a host that answered no SNMP has nothing to walk
               * with. Rendering the shared element's "No probe found." on it
               * reads as a lookup failure and sent operators hunting for a
               * probe to assign, which is what OneUptime/oneuptime#3447 is.
               */
              if (
                NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
                  item.monitoringMethod,
                )
              ) {
                return (
                  <span
                    className="text-sm text-gray-400"
                    title="Monitor-backed devices are not polled by a probe. Their status comes from the monitor bound to them."
                  >
                    Not polled
                  </span>
                );
              }

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
              /*
               * Interface counts are written by the SNMP walk and by nothing
               * else, so on a monitor-backed device they are not "zero
               * interfaces" — they are "never collected". "0 / 0" states the
               * device has no working ports, which is a different and wrong
               * claim (#3447).
               */
              if (
                NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
                  item.monitoringMethod,
                )
              ) {
                return (
                  <span
                    className="text-sm text-gray-400"
                    title="Interface inventory comes from an SNMP walk, which does not run on a monitor-backed device."
                  >
                    —
                  </span>
                );
              }

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
              /*
               * `lastSeenAt` only ever moves on a successful SNMP walk, so a
               * monitor-backed device's is NULL for life. "Never" reads as
               * "this device has not been reachable once", which is exactly
               * the wrong thing to tell an operator whose ping monitor says
               * it is up (#3447).
               */
              if (
                !item.lastSeenAt &&
                NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
                  item.monitoringMethod,
                )
              ) {
                return (
                  <span
                    className="text-sm text-gray-400"
                    title="Last contact is stamped by an SNMP walk, which does not run on a monitor-backed device. Its status comes from the monitor bound to it."
                  >
                    —
                  </span>
                );
              }

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
          /*
           * Carries `monitoringMethod` and `currentMonitorStatus` as well as
           * the poll columns: the status pill reads a monitor-backed
           * device's health from its monitor, not from an SNMP walk —
           * nothing polls those, so the poll columns alone would leave every
           * one of them stuck on "Pending".
           */
          ...DEVICE_STATUS_SELECT,
          interfacesDown: true,
          sysName: true,
          deviceModel: true,
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
      {oidTemplateBulkActionModals}
    </Fragment>
  );
};

export default NetworkDevices;
