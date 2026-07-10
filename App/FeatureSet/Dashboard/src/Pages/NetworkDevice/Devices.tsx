import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import ProbeUtil from "../../Utils/Probe";
import Route from "Common/Types/API/Route";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Probe from "Common/Models/DatabaseModels/Probe";
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
        filters={[]}
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
          {
            field: {
              snmpVersion: true,
            },
            title: "SNMP Version",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: [
              { label: "V1", value: "V1" },
              { label: "V2c", value: "V2c" },
              { label: "V3", value: "V3" },
            ],
            required: true,
            placeholder: "V2c",
          },
          {
            field: {
              snmpCommunityString: true,
            },
            title: "SNMP Community String",
            fieldType: FormFieldSchemaType.Password,
            required: false,
            placeholder: "public",
            description: "Required for SNMP V1 and V2c. Not used for V3.",
          },
          {
            field: {
              snmpPort: true,
            },
            title: "SNMP Port",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "161",
          },
        ]}
        columns={[
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
                <AppLink
                  to={route}
                  className="text-sm font-medium text-gray-900 hover:underline"
                >
                  {(item.name as string) || "—"}
                </AppLink>
              );
            },
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
            getElement: (item: NetworkDevice): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
        selectMoreFields={{
          interfacesDown: true,
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
