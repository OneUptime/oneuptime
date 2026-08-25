import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Navigation from "Common/UI/Utils/Navigation";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import {
  MONITORING_METHOD_OPTIONS,
  isMonitorBackedDevice,
  isSnmpDevice,
} from "../../../Components/NetworkDevice/MonitoringMethodFormFields";
import {
  DEVICE_ROLE_FIELD_DESCRIPTION,
  DEVICE_ROLE_FIELD_TITLE,
  DEVICE_ROLE_OPTIONS,
} from "../../../Components/NetworkDevice/DeviceRoleFormFields";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import DeviceHealthOidsFormField from "../../../Components/NetworkDevice/DeviceHealthOidsFormField";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { getSnmpConfigFormFields } from "../SnmpConfigFormFields";
import { getDevicePollingFormFields } from "../DevicePollingFormFields";
import ProbeUtil from "../../../Utils/Probe";
import Probe from "Common/Models/DatabaseModels/Probe";
import ProbeElement from "Common/UI/Components/Probe/Probe";
import BadDataException from "Common/Types/Exception/BadDataException";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const NetworkDeviceSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * The probe list is fetched rather than pulled in through a dropdownModal:
   * global probes are not project rows and only come back from the dedicated
   * /probe/global-probes endpoint, which ProbeUtil merges in. A plain model
   * dropdown would silently offer an empty list on any install whose probes
   * are all global.
   */
  const [probes, setProbes] = useState<Array<Probe>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchProbes: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      setProbes(await ProbeUtil.getAllProbes());
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
      <CardModelDetail<NetworkDevice>
        name="Device Settings"
        cardProps={{
          title: "Device Settings",
          description: "Manage settings for this network device.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formSteps={[
          {
            title: "Device Details",
            id: "device-details",
          },
          {
            /*
             * Nothing polls a monitor-backed device, so a community string
             * or a v3 credential has nothing to be used for.
             */
            title: "SNMP Credentials",
            id: "snmp",
            showIf: isSnmpDevice,
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
              monitoringMethod: true,
            },
            title: "Monitoring Method",
            stepId: "device-details",
            description:
              "SNMP means an assigned probe polls this device on its own schedule. Monitor means nothing polls it and the bound monitor's status is its status — switching to Monitor turns polling off.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: MONITORING_METHOD_OPTIONS,
            required: true,
            placeholder: "Monitoring method",
          },
          {
            field: {
              monitor: true,
            },
            title: "Monitor",
            stepId: "device-details",
            showIf: isMonitorBackedDevice,
            description:
              "The monitor whose status IS this device's status. Usually a Ping or IP monitor on the device's address.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Monitor",
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
          ...getSnmpConfigFormFields({ stepId: "snmp" }),
        ]}
        modelDetailProps={{
          modelType: NetworkDevice,
          id: "network-device-settings",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
            },
            {
              field: {
                hostname: true,
              },
              title: "Hostname",
              fieldType: FieldType.Text,
            },
            {
              field: {
                monitoringMethod: true,
              },
              title: "Monitoring Method",
              fieldType: FieldType.Text,
            },
            {
              field: {
                monitor: {
                  name: true,
                },
              },
              title: "Monitor",
              fieldType: FieldType.Text,
            },
            {
              field: {
                deviceRole: true,
              },
              title: DEVICE_ROLE_FIELD_TITLE,
              fieldType: FieldType.Text,
            },
          ],
        }}
      />
      <CardModelDetail<NetworkDevice>
        name="Polling & Data Collection"
        cardProps={{
          title: "Polling & Data Collection",
          description:
            "The assigned probe polls this device on its own schedule — inventory, interfaces, topology neighbors, endpoints, and health OIDs. Monitors are only needed to alert on what these polls report.",
        }}
        isEditable={true}
        editButtonText="Edit Polling"
        formSteps={[
          {
            title: "Polling",
            id: "polling",
          },
          {
            title: "Health OIDs",
            id: "health-oids",
          },
        ]}
        formFields={[
          {
            field: {
              probe: true,
            },
            title: "Probe",
            stepId: "polling",
            description:
              "The probe that polls this device, and the one whose SNMP trap, syslog and NetFlow receivers this device's records are matched against. It has to be able to reach the device directly.",
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
          ...getDevicePollingFormFields({ stepId: "polling" }),
          {
            field: {
              snmpOids: true,
            },
            title: "Health OIDs",
            stepId: "health-oids",
            description:
              "SNMP OIDs (CPU, memory, temperature, or any custom OID) collected on each poll. Values are recorded as device metrics and can be alerted on through monitor criteria.",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            getCustomElement: (
              value: FormValues<NetworkDevice>,
              customElementProps: CustomElementProps,
            ): ReactElement => {
              return (
                <DeviceHealthOidsFormField
                  {...customElementProps}
                  initialValue={
                    (value.snmpOids as Array<SnmpOid> | undefined) || []
                  }
                />
              );
            },
          },
          {
            field: {
              autoApplyVendorHealthTemplate: true,
            },
            title: "Auto-Apply Vendor Health Template",
            stepId: "health-oids",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "When the device's vendor is fingerprinted from its SNMP sysObjectID and the Health OID list above is empty, seed it with the matching vendor health template automatically on the next poll. A non-empty list is never touched. Auto-imported devices have this on by default.",
          },
        ]}
        modelDetailProps={{
          modelType: NetworkDevice,
          id: "network-device-polling-settings",
          modelId: modelId,
          fields: [
            {
              field: {
                probe: {
                  name: true,
                  iconFileId: true,
                },
              },
              title: "Probe",
              fieldType: FieldType.Element,
              getElement: (item: NetworkDevice): ReactElement => {
                if (!item.probe) {
                  return <p>No probe assigned.</p>;
                }
                return <ProbeElement probe={item.probe} />;
              },
            },
            {
              field: {
                isPollingEnabled: true,
              },
              title: "Polling Enabled",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                pollingIntervalInMinutes: true,
              },
              title: "Polling Interval (Minutes)",
              fieldType: FieldType.Number,
            },
            {
              field: {
                walkInterfaces: true,
              },
              title: "Walk Interfaces",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                collectEndpoints: true,
              },
              title: "Collect Connected Endpoints",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                snmpOids: true,
              },
              title: "Health OIDs",
              fieldType: FieldType.Element,
              getElement: (item: NetworkDevice): ReactElement => {
                const oids: Array<SnmpOid> = item.snmpOids || [];
                if (oids.length === 0) {
                  return <span>No health OIDs configured.</span>;
                }
                return (
                  <span>
                    {oids
                      .map((oid: SnmpOid) => {
                        return oid.name || oid.oid;
                      })
                      .join(", ")}
                  </span>
                );
              },
            },
          ],
        }}
      />
      <ArchiveResourceCard<NetworkDevice>
        modelType={NetworkDevice}
        modelId={modelId}
        singularName="device"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.NETWORK_DEVICES] as Route,
        )}
      />
    </Fragment>
  );
};

export default NetworkDeviceSettings;
