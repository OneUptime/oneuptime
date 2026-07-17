import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import ProbeUtil from "../../Utils/Probe";
import Route from "Common/Types/API/Route";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Probe from "Common/Models/DatabaseModels/Probe";
import Label from "Common/Models/DatabaseModels/Label";
import BadDataException from "Common/Types/Exception/BadDataException";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
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
import DeviceSummaryCards from "../../Components/NetworkDevice/DeviceSummaryCards";
import DeviceStatusUtil, {
  DEVICE_FRESH_WINDOW_MINUTES,
  NetworkDeviceStatus,
} from "../../Components/NetworkDevice/DeviceStatusUtil";
import { getSnmpConfigFormFields } from "./SnmpConfigFormFields";

const NetworkDevices: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [probes, setProbes] = useState<Array<Probe>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

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
      <DeviceSummaryCards />
      <ModelTable<NetworkDevice>
        modelType={NetworkDevice}
        id="network-devices-table"
        userPreferencesKey="network-devices-table"
        query={{ isArchived: false }}
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
        ]}
        cardProps={{
          title: "Network Devices",
          description:
            "Switches, routers, and firewalls monitored via SNMP in this project. Devices are polled by the probe you assign.",
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
            placeholder: "core-switch-01",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Core switch in the US East datacenter",
          },
          {
            field: {
              hostname: true,
            },
            title: "Hostname",
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
            description: "Which probe should poll this device?",
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
          ...getSnmpConfigFormFields(),
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
