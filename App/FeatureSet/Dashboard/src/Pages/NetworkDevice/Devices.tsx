import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import ProbeUtil from "../../Utils/Probe";
import Route from "Common/Types/API/Route";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import Probe from "Common/Models/DatabaseModels/Probe";
import Label from "Common/Models/DatabaseModels/Label";
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
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ProjectUtil from "Common/UI/Utils/Project";
import Navigation from "Common/UI/Utils/Navigation";
import Query from "Common/Types/BaseDatabase/Query";
import DeviceSummaryCards from "../../Components/NetworkDevice/DeviceSummaryCards";
import SummaryFilterChip from "../../Components/Network/SummaryFilterChip";
import DeviceStatusUtil, {
  DEVICE_FRESH_WINDOW_MINUTES,
  NetworkDeviceStatus,
} from "../../Components/NetworkDevice/DeviceStatusUtil";
import {
  DEVICE_SUMMARY_FILTER_URL_PARAM,
  DeviceSummaryFilterDefinition,
  DeviceSummaryFilterKey,
  getDeviceSummaryFilterConflictingFilterFields,
  getDeviceSummaryFilterDefinition,
  getDeviceSummaryFilterQuery,
  isDeviceSummaryFilterTimeBased,
  parseDeviceSummaryFilterKey,
} from "../../Components/NetworkDevice/DeviceSummaryFilter";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import { getSnmpConfigFormFields } from "./SnmpConfigFormFields";

/*
 * Shared by the table's `id`, its `userPreferencesKey` and the URL namespace
 * its filter/sort/page state is persisted under. Named here because the
 * summary drill-down has to clear that state (see changeSummaryFilter).
 */
const NETWORK_DEVICES_TABLE_ID: string = "network-devices-table";

const NetworkDevices: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [probes, setProbes] = useState<Array<Probe>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Which summary tile the list is drilled into. Seeded from the URL — read
   * once, synchronously, so the very first fetch already carries the filter
   * (an effect would fetch the whole fleet first and throw it away), and so
   * the Sites page's "Unassigned Devices" tile can hand its rows over by
   * linking here.
   */
  const [summaryFilterKey, setSummaryFilterKey] =
    useState<DeviceSummaryFilterKey | null>(() => {
      return parseDeviceSummaryFilterKey(
        Navigation.getQueryStringByName(DEVICE_SUMMARY_FILTER_URL_PARAM),
      );
    });

  type ChangeSummaryFilterFunction = (
    filterKey: DeviceSummaryFilterKey | null,
  ) => void;

  const changeSummaryFilter: ChangeSummaryFilterFunction = (
    filterKey: DeviceSummaryFilterKey | null,
  ): void => {
    /*
     * Drop whatever the column-filter popup was holding, and the page number
     * that went with it.
     *
     * A drill-down and a column filter over the same field cannot both apply:
     * BaseModelTable spreads the column filters over the page's query, so an
     * already-set "Last Seen At" filter would silently replace the tile's
     * constraint while the chip carried on claiming it. The table is
     * remounted on the selection (see its `key` below), and it re-reads this
     * state on mount — so clearing it here is what makes the two exclusive
     * whichever order the user reaches for them in.
     */
    TableFilterUrlState.clear(NETWORK_DEVICES_TABLE_ID);

    setSummaryFilterKey(filterKey);
    /*
     * replaceState, so a drill-down is shareable and survives viewing a
     * device and coming back, without burying the previous page under a
     * history entry per tile click.
     */
    Navigation.setQueryString({
      [DEVICE_SUMMARY_FILTER_URL_PARAM]: filterKey,
    });
  };

  /*
   * Memoised because "up" and "down" carry a cutoff Date built at call time,
   * and ModelTable decides whether to refetch by JSON-comparing this prop
   * against the previous render's. A fresh cutoff every render would compare
   * unequal every render — an endless refetch loop.
   *
   * The consequence is that the window is a snapshot taken when the tile was
   * activated, not a live one. Re-deriving it on a timer instead would send
   * anyone reading page 3 back to page 1 every tick and drop any bulk
   * selection they had made, which is worse than the drift — so the chip says
   * when the snapshot was taken, and re-activating the tile takes a new one.
   */
  const tableQuery: Query<NetworkDevice> = useMemo(() => {
    return {
      isArchived: false,
      ...getDeviceSummaryFilterQuery(summaryFilterKey),
    };
  }, [summaryFilterKey]);

  const summaryFilterDefinition: DeviceSummaryFilterDefinition | null =
    summaryFilterKey
      ? getDeviceSummaryFilterDefinition(summaryFilterKey)
      : null;

  /*
   * The instant the snapshot above was taken, shown next to the chip. Keyed on
   * the same selection as the query, so it is re-taken exactly when the cutoff
   * is and cannot end up naming a different moment.
   */
  const summaryFilterDetail: string | undefined = useMemo(() => {
    if (!isDeviceSummaryFilterTimeBased(summaryFilterKey)) {
      return undefined;
    }

    return `as of ${OneUptimeDate.getLocalHourAndMinuteFromDate(
      OneUptimeDate.getCurrentDate(),
    )}`;
  }, [summaryFilterKey]);

  /*
   * A drill-down owns its field, so the popup stops offering a filter that
   * would overwrite it. `filters` is also what BaseModelTable sanitises
   * URL-restored filter data against, so dropping an entry here drops any
   * stale value for it from a shared link too.
   */
  const conflictingFilterFields: Array<string> =
    getDeviceSummaryFilterConflictingFilterFields(summaryFilterKey);

  type IsFilterOfferedFunction = (filter: Filter<NetworkDevice>) => boolean;

  const isFilterOffered: IsFilterOfferedFunction = (
    filter: Filter<NetworkDevice>,
  ): boolean => {
    const field: string | undefined = filter.field
      ? Object.keys(filter.field)[0]
      : undefined;

    return !field || !conflictingFilterFields.includes(field);
  };

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
        selectedFilterKey={summaryFilterKey}
        onFilterKeyChange={changeSummaryFilter}
      />
      <ModelTable<NetworkDevice>
        /*
         * Remounted when the drill-down changes, so the table re-reads its
         * (just-cleared) filter and page state instead of carrying a column
         * filter that would silently override the tile's constraint.
         */
        key={`${NETWORK_DEVICES_TABLE_ID}-${summaryFilterKey || "all"}`}
        modelType={NetworkDevice}
        id={NETWORK_DEVICES_TABLE_ID}
        userPreferencesKey={NETWORK_DEVICES_TABLE_ID}
        query={tableQuery}
        topContent={
          summaryFilterDefinition ? (
            <SummaryFilterChip
              testIdSuffix="network-devices"
              label={summaryFilterDefinition.chipLabel}
              detail={summaryFilterDetail}
              onClear={() => {
                changeSummaryFilter(null);
              }}
            />
          ) : undefined
        }
        noItemsMessage={summaryFilterDefinition?.emptyMessage}
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
              vendor: true,
            },
            title: "Vendor",
            type: FieldType.Text,
          },
          {
            field: {
              probe: {
                name: true,
              },
            },
            title: "Probe",
            type: FieldType.Entity,
            filterEntityType: Probe,
            fetchFilterDropdownOptions: async (): Promise<
              Array<DropdownOption>
            > => {
              return probes.map((probe: Probe) => {
                return {
                  label: probe.name || "",
                  value: probe._id?.toString() || "",
                };
              });
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              site: {
                name: true,
              },
            },
            title: "Site",
            type: FieldType.Entity,
            filterEntityType: NetworkSite,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
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
            filterEntityType: Label,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen At",
            type: FieldType.Date,
          },
          /*
           * The drill-down owns its field while it is active, so the popup
           * never offers a filter that would quietly replace it.
           */
        ].filter(isFilterOffered)}
        cardProps={{
          title: "Network Devices",
          description:
            "Switches, routers, and firewalls monitored via SNMP in this project. Devices are polled by the probe you assign.",
        }}
        showViewIdButton={true}
        formSteps={[
          {
            title: "Device Details",
            id: "device-details",
          },
          {
            title: "Probe & Site",
            id: "probe-and-site",
          },
          {
            title: "SNMP Credentials",
            id: "snmp",
          },
        ]}
        formFields={[
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
              hostname: true,
            },
            title: "Hostname",
            stepId: "device-details",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "10.0.0.1 or switch-01.example.com",
            description: "IP address or hostname the probe will poll via SNMP.",
          },
          {
            field: {
              probe: true,
            },
            title: "Probe",
            stepId: "probe-and-site",
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
