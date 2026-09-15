import PageComponentProps from "../../PageComponentProps";
import DeviceStatusHero from "../../../Components/NetworkDevice/DeviceStatusHero";
import { HOSTNAME_FIELD_DESCRIPTION } from "../../../Components/NetworkDevice/MonitoringMethodFormFields";
import DeviceInterfacesPreview from "../../../Components/NetworkDevice/DeviceInterfacesPreview";
import DeviceInventoryCard from "../../../Components/NetworkDevice/DeviceInventoryCard";
import DeviceMonitorLookupUtil, {
  DeviceMonitorContext,
} from "../../../Components/NetworkDevice/DeviceMonitorLookupUtil";
import DeviceMonitorsCard from "../../../Components/NetworkDevice/DeviceMonitorsCard";
import DeviceVendorTemplateBanner from "../../../Components/NetworkDevice/DeviceVendorTemplateBanner";
import DeviceAttachmentCard from "../../../Components/NetworkDevice/DeviceAttachmentCard";
import DeviceDiagnosticsCard from "../../../Components/NetworkDevice/DeviceDiagnosticsCard";
import { getMacAddressFormField } from "../MacAddressFormField";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiagnostic from "Common/Models/DatabaseModels/NetworkDeviceDiagnostic";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import Label from "Common/Models/DatabaseModels/Label";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import API from "Common/UI/Utils/API/API";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Device Overview — the "is it OK, and what is it?" page. Health hero on
 * top, then identity and inventory, an interfaces digest, and the monitors
 * watching the device. Deep data lives on its own sub-pages (Interfaces,
 * Metrics, Traffic, Monitors), and SNMP credentials live in Settings.
 */
const NetworkDeviceView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [monitors, setMonitors] = useState<Array<Monitor>>([]);
  const [isMonitorBacked, setIsMonitorBacked] = useState<boolean>(false);
  const [isMonitorsLoading, setIsMonitorsLoading] = useState<boolean>(true);
  const [monitorsError, setMonitorsError] = useState<string>("");

  /*
   * Hidden, not disabled, like the topology view's gates: PermissionGate
   * answers "not allowed, nothing honest to say" while the permission
   * snapshot is still in flight, and disabled buttons would accuse a
   * permitted operator of lacking a permission they hold. Only the Ping /
   * Traceroute buttons are behind it; the card's read-only latency trend
   * shows for everyone who can see the device.
   */
  const canRunDiagnostics: boolean = PermissionGate.check(
    new NetworkDeviceDiagnostic(),
    ModelAction.Create,
  ).isAllowed;

  useEffect(() => {
    const fetchMonitors: PromiseVoidFunction = async (): Promise<void> => {
      try {
        const context: DeviceMonitorContext =
          await DeviceMonitorLookupUtil.getDeviceMonitorContext(modelId);
        setMonitors(context.monitors);
        setIsMonitorBacked(context.isMonitorBacked);
      } catch (err) {
        setMonitorsError(API.getFriendlyMessage(err));
      }

      setIsMonitorsLoading(false);
    };

    fetchMonitors().catch((err: Error) => {
      setMonitorsError(API.getFriendlyMessage(err));
      setIsMonitorsLoading(false);
    });
  }, []);

  return (
    <Fragment>
      <DeviceVendorTemplateBanner modelId={modelId} />
      <DeviceStatusHero modelId={modelId} />
      <CardModelDetail<NetworkDevice>
        name="Network Device Details"
        cardProps={{
          title: "Device Details",
          description:
            "Name, address, and organization for this device. SNMP credentials are managed in Settings.",
        }}
        isEditable={true}
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
            description: HOSTNAME_FIELD_DESCRIPTION,
          },
          getMacAddressFormField(),
          {
            field: {
              site: true,
            },
            title: "Site",
            description:
              "The network site this device belongs to. Site health rolls up from its devices.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: NetworkSite,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Site (optional)",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels",
            description: "Organize and filter devices with labels.",
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
        modelDetailProps={{
          modelType: NetworkDevice,
          id: "network-device-details",
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
                hostname: true,
              },
              title: "Hostname",
              fieldType: FieldType.Text,
            },
            /*
             * Read-only, and deliberately not in the edit form above (issue
             * #3678). It is a record of the name DNS gave the device — set by
             * discovery import from the PTR record, or kept from the old name
             * when the name was shortened — so the one place it is shown is
             * next to the address it describes. Hidden when empty: most
             * hand-made devices never have one.
             */
            {
              field: {
                dnsName: true,
              },
              title: "DNS Name",
              fieldType: FieldType.Text,
              showIf: (item: NetworkDevice): boolean => {
                return Boolean(item.dnsName);
              },
            },
            {
              field: {
                macAddress: true,
              },
              title: "MAC Address",
              fieldType: FieldType.Text,
              showIf: (item: NetworkDevice): boolean => {
                return Boolean(item.macAddress);
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
              showIf: (item: NetworkDevice): boolean => {
                return Boolean(item.description);
              },
            },
            {
              field: {
                site: {
                  name: true,
                },
              },
              title: "Site",
              fieldType: FieldType.Element,
              getElement: (item: NetworkDevice): ReactElement => {
                if (!item.site?.name) {
                  return (
                    <span className="text-gray-400">No site assigned</span>
                  );
                }
                return <span>{item.site.name}</span>;
              },
            },
            {
              field: {
                sysName: true,
              },
              title: "System Name (sysName)",
              fieldType: FieldType.Text,
              showIf: (item: NetworkDevice): boolean => {
                return Boolean(item.sysName);
              },
            },
            {
              field: {
                sysDescr: true,
              },
              title: "System Description (sysDescr)",
              fieldType: FieldType.Text,
              showIf: (item: NetworkDevice): boolean => {
                return Boolean(item.sysDescr);
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
              fieldType: FieldType.Element,
              getElement: (item: NetworkDevice): ReactElement => {
                return (
                  <LabelsElement labels={item["labels"] as Array<Label>} />
                );
              },
              showIf: (item: NetworkDevice): boolean => {
                const labels: Array<Label> | undefined =
                  (item.labels as Array<Label> | undefined) ?? undefined;
                return Array.isArray(labels) && labels.length > 0;
              },
            },
          ],
        }}
      />
      <DeviceInterfacesPreview modelId={modelId} />
      <DeviceAttachmentCard modelId={modelId} />
      <DeviceDiagnosticsCard
        modelId={modelId}
        canRunDiagnostics={canRunDiagnostics}
      />
      <DeviceInventoryCard modelId={modelId} />
      <DeviceMonitorsCard
        monitors={monitors}
        isLoading={isMonitorsLoading}
        error={monitorsError}
        networkDeviceId={modelId.toString()}
        isMonitorBacked={isMonitorBacked}
      />
    </Fragment>
  );
};

export default NetworkDeviceView;
