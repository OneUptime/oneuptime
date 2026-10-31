import PageComponentProps from "../PageComponentProps";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceLink from "Common/Models/DatabaseModels/NetworkDeviceLink";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * Cables that discovery cannot see.
 *
 * LLDP and CDP only report what both ends agree to advertise, so a switch
 * with discovery disabled or a firewall that speaks neither leaves a real
 * cable invisible — and the device on the far end of it floating
 * unconnected on the map. A device monitored by ping alone used to be the
 * commonest case; it is now placed on its switch port from the switch's
 * forwarding table (issue #3489), so a link is drawn here for it only when
 * no walked switch has learned its MAC. A link drawn here is merged with a
 * discovered or learned one between the same pair rather than doubling the
 * line, so declaring a link that discovery later finds costs nothing.
 */
const NetworkDeviceLinks: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  return (
    <Fragment>
      <ModelTable<NetworkDeviceLink>
        modelType={NetworkDeviceLink}
        id="network-device-links-table"
        userPreferencesKey="network-device-links-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showRefreshButton={true}
        name="Network Device Links"
        cardProps={{
          title: "Device Links",
          description:
            "Cables the map cannot see on its own. A monitor bound to a link colors it.",
        }}
        noItemsMessage="No device links yet. Add one to connect two devices the discovery protocols cannot see between."
        filters={[
          {
            field: {
              fromDevice: {
                name: true,
              },
            },
            title: "From Device",
            type: FieldType.Entity,
            filterEntityType: NetworkDevice,
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              toDevice: {
                name: true,
              },
            },
            title: "To Device",
            type: FieldType.Entity,
            filterEntityType: NetworkDevice,
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
        ]}
        formSteps={[
          { title: "Link", id: "link" },
          { title: "Ports", id: "ports" },
          { title: "Topology", id: "topology" },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "link",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "IDF-2 uplink to core",
          },
          {
            field: {
              fromDevice: true,
            },
            title: "From Device",
            stepId: "link",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: NetworkDevice,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Select Device",
          },
          {
            field: {
              toDevice: true,
            },
            title: "To Device",
            stepId: "link",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: NetworkDevice,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Select Device",
          },
          {
            field: {
              fromPortName: true,
            },
            title: "From Port",
            stepId: "ports",
            description: "Free text, such as Gi1/0/24.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Gi1/0/24",
          },
          {
            field: {
              toPortName: true,
            },
            title: "To Port",
            stepId: "ports",
            description: "Optional. Free text, same as above.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "eth0",
          },
          {
            field: {
              parentDevice: true,
            },
            title: "Parent Device",
            stepId: "topology",
            description:
              "Which end is upstream, such as the router. The map draws the other end beneath it.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: NetworkDevice,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Peers — infer the hierarchy",
          },
          {
            field: {
              monitor: true,
            },
            title: "Monitor",
            stepId: "topology",
            description:
              "Its status colors the link on the map, unless the link reports its own state.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Monitor",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              fromDevice: {
                name: true,
              },
            },
            title: "From Device",
            type: FieldType.Entity,
            getElement: (item: NetworkDeviceLink): ReactElement => {
              return (
                <span className="text-sm text-gray-900">
                  {item.fromDevice?.name || "—"}
                </span>
              );
            },
          },
          {
            field: {
              toDevice: {
                name: true,
              },
            },
            title: "To Device",
            type: FieldType.Entity,
            getElement: (item: NetworkDeviceLink): ReactElement => {
              return (
                <span className="text-sm text-gray-900">
                  {item.toDevice?.name || "—"}
                </span>
              );
            },
          },
          {
            field: {
              parentDevice: {
                name: true,
              },
            },
            title: "Parent",
            type: FieldType.Entity,
            hideOnMobile: true,
            /*
             * "Inferred" rather than a dash: an empty parent is not missing
             * data, it is the map being left to work the direction out, and
             * the difference is the whole point of the column.
             */
            getElement: (item: NetworkDeviceLink): ReactElement => {
              if (!item.parentDevice?.name) {
                return (
                  <span className="text-sm text-gray-400">
                    {translator.translateText("Inferred")}
                  </span>
                );
              }
              return (
                <span className="text-sm text-gray-900">
                  {item.parentDevice.name}
                </span>
              );
            },
          },
          {
            field: {
              monitor: {
                name: true,
              },
            },
            title: "Bound Monitor",
            type: FieldType.Entity,
            hideOnMobile: true,
            getElement: (item: NetworkDeviceLink): ReactElement => {
              if (!item.monitor?.name) {
                return (
                  <span className="text-sm text-gray-400">
                    {translator.translateText("None")}
                  </span>
                );
              }
              return (
                <span className="text-sm text-gray-900">
                  {item.monitor.name}
                </span>
              );
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default NetworkDeviceLinks;
