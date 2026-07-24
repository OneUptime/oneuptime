import PageComponentProps from "../../PageComponentProps";
import DeviceStatusHero from "../../../Components/NetworkDevice/DeviceStatusHero";
import DeviceInterfacesPreview from "../../../Components/NetworkDevice/DeviceInterfacesPreview";
import DeviceInventoryCard from "../../../Components/NetworkDevice/DeviceInventoryCard";
import DeviceMonitorLookupUtil from "../../../Components/NetworkDevice/DeviceMonitorLookupUtil";
import DeviceMonitorsCard from "../../../Components/NetworkDevice/DeviceMonitorsCard";
import DeviceVendorTemplateBanner from "../../../Components/NetworkDevice/DeviceVendorTemplateBanner";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import Label from "Common/Models/DatabaseModels/Label";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import API from "Common/UI/Utils/API/API";
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
  const [isMonitorsLoading, setIsMonitorsLoading] = useState<boolean>(true);
  const [monitorsError, setMonitorsError] = useState<string>("");

  useEffect(() => {
    const fetchMonitors: PromiseVoidFunction = async (): Promise<void> => {
      try {
        setMonitors(
          await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(modelId),
        );
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
            description: "IP address or hostname the probe will poll via SNMP.",
          },
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
      <DeviceInventoryCard modelId={modelId} />
      <DeviceMonitorsCard
        monitors={monitors}
        isLoading={isMonitorsLoading}
        error={monitorsError}
      />
    </Fragment>
  );
};

export default NetworkDeviceView;
