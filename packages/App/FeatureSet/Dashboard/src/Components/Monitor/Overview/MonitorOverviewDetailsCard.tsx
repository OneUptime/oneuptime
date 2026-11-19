import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import MonitorTypeTitle, { getMonitorTypeTitle } from "../MonitorTypeTitle";
import {
  canReadMonitorDevice,
  getMonitorNetworkDeviceFormField,
} from "../MonitorNetworkDeviceField";
import AppLink from "../../AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Route from "Common/Types/API/Route";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { isDeviceTargetMonitorType } from "Common/Utils/Monitor/DeviceMonitorTemplateUtil";
import { DetailStyle } from "Common/UI/Components/Detail/Detail";
import Field from "Common/UI/Components/ModelDetail/Field";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import LabelsElement from "Common/UI/Components/Label/Labels";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorId: ObjectID;
  // Flip to make the card read the monitor again.
  refresher: boolean;
  onSaveSuccess: () => void;
  /*
   * The monitor's type, and whether an import, an auto import rule or an
   * alert policy made it for a network device: a Ping, IP, Port, NTP,
   * Website, API or SSL Certificate monitor a person made can be tied to the
   * device it checks here (issue #9545); one made for a device is that
   * device's already.
   */
  monitorType?: MonitorType | undefined;
  isMadeForDevice?: boolean | undefined;
}

// The type's English title (MonitorTypeTitle), as the type picker writes it.
export { getMonitorTypeTitle };

// The device's name, a link to its page.
function DeviceLink(props: { device: NetworkDevice }): ReactElement {
  const deviceId: string = props.device._id?.toString() || "";

  return (
    <AppLink
      to={RouteUtil.populateRouteParams(
        RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
        { modelId: deviceId },
      )}
      className="font-medium text-gray-900 hover:underline"
    >
      {props.device.name || deviceId}
    </AppLink>
  );
}

/*
 * The monitor's own record in the side column: name, description and labels
 * (editable here, as before), plus the type, when it was created and its id.
 * On a phone the page header hides labels, so this is where they are seen.
 *
 * A monitor of a network device says which (issue #9545): the device a
 * person tied it to, or the one an import made it for, each a link to the
 * device's page. A Ping, IP, Port, NTP, Website, API or SSL Certificate
 * monitor a person made is tied, or untied, with Edit.
 */
const MonitorOverviewDetailsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const canReadDevice: boolean = canReadMonitorDevice();
  const canTieToDevice: boolean =
    canReadDevice &&
    !props.isMadeForDevice &&
    isDeviceTargetMonitorType(props.monitorType);

  /*
   * The edit form's More fields: the labels and, for a monitor a person made
   * that checks a host, the device it checks - changed or cleared with Edit.
   * Not offered for one an import made for a device: that one is the
   * device's already, and the server refuses it. One section, so both fold
   * under the one header.
   */
  const moreFields: FormFieldCollapsibleSection<Monitor> =
    getAdvancedFormSection<Monitor>();

  const deviceFormFields: Fields<Monitor> = canTieToDevice
    ? [
        getMonitorNetworkDeviceFormField({
          placeholder: "Not tied to a device",
          collapsibleSection: moreFields,
        }),
      ]
    : [];

  const deviceFields: Array<Field<Monitor>> = canReadDevice
    ? [
        {
          field: {
            networkDevice: {
              _id: true,
              name: true,
            },
          },
          title: "Network Device",
          fieldType: FieldType.Element,
          showIf: (item: Monitor): boolean => {
            return Boolean(item.networkDevice?._id);
          },
          getElement: (item: Monitor): ReactElement => {
            return <DeviceLink device={item.networkDevice!} />;
          },
        },
        {
          field: {
            autoProvisionedNetworkDevice: {
              _id: true,
              name: true,
            },
          },
          title: "Network Device",
          fieldType: FieldType.Element,
          showIf: (item: Monitor): boolean => {
            return Boolean(item.autoProvisionedNetworkDevice?._id);
          },
          getElement: (item: Monitor): ReactElement => {
            return <DeviceLink device={item.autoProvisionedNetworkDevice!} />;
          },
        },
      ]
    : [];

  return (
    <CardModelDetail<Monitor>
      name="Monitor Details"
      cardProps={{
        title: "Details",
        description: "Name, description and labels.",
        headerLayout: "stacked",
      }}
      editButtonText="Edit"
      isEditable={true}
      formFields={[
        {
          field: {
            name: true,
          },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Monitor Name",
          hideColumnDescription: true,
          validation: {
            minLength: 2,
          },
        },
        {
          field: {
            description: true,
          },
          title: "Description",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: "Description",
          hideColumnDescription: true,
        },
        getLabelsFormField<Monitor>({ collapsibleSection: moreFields }),
        ...deviceFormFields,
      ]}
      refresher={props.refresher}
      onSaveSuccess={() => {
        props.onSaveSuccess();
      }}
      modelDetailProps={{
        modelType: Monitor,
        id: "model-detail-monitors",
        modelId: props.monitorId,
        style: DetailStyle.Compact,
        showDetailsInNumberOfColumns: 1,
        fields: [
          {
            field: {
              name: true,
            },
            title: "Name",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            placeholder: "No description",
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
            getElement: (item: Monitor): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
          {
            field: {
              monitorType: true,
            },
            title: "Monitor Type",
            fieldType: FieldType.Element,
            getElement: (item: Monitor): ReactElement => {
              return <MonitorTypeTitle monitorType={item.monitorType} />;
            },
          },
          ...deviceFields,
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            fieldType: FieldType.DateTime,
          },
          {
            field: {
              _id: true,
            },
            title: "Monitor ID",
            fieldType: FieldType.ObjectID,
          },
        ],
      }}
    />
  );
};

export default MonitorOverviewDetailsCard;
