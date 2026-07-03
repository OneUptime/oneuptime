import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_PER_PROJECT from "Common/Types/Database/LimitMax";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import TelemetryRetentionConfig from "Common/Types/Telemetry/TelemetryRetentionConfig";
import TelemetryRetentionConfigForm from "Common/UI/Components/Telemetry/TelemetryRetentionConfigForm";
import TelemetryRetentionConfigSummary from "Common/UI/Components/Telemetry/TelemetryRetentionConfigSummary";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const IoTFleetSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail<IoTFleet>
        name="Fleet Settings"
        cardProps={{
          title: "Fleet Settings",
          description: "Manage settings for this IoT fleet.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formFields={[
          {
            field: {
              description: true,
            },
            title: "Description",
            description: "Friendly description for this IoT fleet.",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Temperature sensors across Building A",
          },
          {
            field: {
              expectedDeviceCheckinIntervalSeconds: true,
            },
            title: "Expected Device Check-in Interval (Seconds)",
            description:
              "How often devices in this fleet are expected to report. When set, a device silent for 3x this interval is marked Offline and the fleet's offline alerts fire even though the device sent nothing. Leave blank to turn silence-based offline detection off.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "300",
            validation: {
              minValue: 1,
            },
          },
          {
            field: {
              defaultOnCallDutyPolicyId: true,
            },
            title: "Default On-Call Policy",
            description:
              "Attached by default to alert templates created for this fleet, so out-of-the-box IoT alerts page someone.",
            fieldType: FormFieldSchemaType.Dropdown,
            required: false,
            placeholder: "Select On-Call Policy",
            fetchDropdownOptions: async (): Promise<Array<DropdownOption>> => {
              const policies: ListResult<OnCallDutyPolicy> =
                await ModelAPI.getList<OnCallDutyPolicy>({
                  modelType: OnCallDutyPolicy,
                  query: {},
                  select: {
                    _id: true,
                    name: true,
                  },
                  sort: {
                    name: SortOrder.Ascending,
                  },
                  limit: LIMIT_PER_PROJECT,
                  skip: 0,
                });
              return policies.data.map(
                (policy: OnCallDutyPolicy): DropdownOption => {
                  return {
                    label: policy.name || "Unknown",
                    value: policy._id?.toString() || "",
                  };
                },
              );
            },
          },
          {
            field: {
              retainTelemetryDataForDays: true,
            },
            title: "Retain Telemetry Data For (Days)",
            description:
              "Default retention for telemetry collected from this IoT fleet. Leave blank to use the project's default.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "Use project default",
            validation: {
              minValue: 1,
            },
          },
        ]}
        modelDetailProps={{
          modelType: IoTFleet,
          id: "iot-fleet-settings",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              description:
                "The fleet name is the join key to the iot.fleet.name attribute your devices send and cannot be changed. To move devices, update the attribute on the devices — the new fleet is auto-discovered — then archive this one.",
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
                expectedDeviceCheckinIntervalSeconds: true,
              },
              title: "Expected Device Check-in Interval (Seconds)",
              description:
                "Devices silent for 3x this interval are marked Offline and alerted on. Blank = silence-based offline detection off.",
              fieldType: FieldType.Number,
              placeholder: "Not set",
            },
            {
              field: {
                defaultOnCallDutyPolicy: {
                  name: true,
                },
              },
              title: "Default On-Call Policy",
              description:
                "Attached by default to alert templates created for this fleet.",
              fieldType: FieldType.Text,
              placeholder: "Not set",
            },
            {
              field: {
                retainTelemetryDataForDays: true,
              },
              title: "Retain Telemetry Data For (Days)",
              description:
                "Default retention for telemetry collected from this IoT fleet. Falls back to the project's default when not set.",
              fieldType: FieldType.Number,
              placeholder: "Using project default",
            },
          ],
        }}
      />
      <CardModelDetail<IoTFleet>
        name="Retention by Telemetry Type"
        cardProps={{
          title: "Retention by Telemetry Type",
          description:
            "Override retention for specific telemetry types for this IoT fleet. Any field left blank falls back to the fleet default, then the project's settings.",
        }}
        isEditable={true}
        editButtonText="Edit Overrides"
        createEditModalWidth={ModalWidth.Large}
        formFields={[
          {
            field: { telemetryRetentionConfig: true },
            title: "Retention Overrides",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            getCustomElement: (
              value: FormValues<IoTFleet>,
              props: CustomElementProps,
            ) => {
              return (
                <TelemetryRetentionConfigForm
                  {...props}
                  value={
                    value.telemetryRetentionConfig as
                      | TelemetryRetentionConfig
                      | undefined
                  }
                />
              );
            },
          },
        ]}
        modelDetailProps={{
          modelType: IoTFleet,
          id: "model-detail-iot-fleet-telemetry-retention-overrides",
          fields: [
            {
              field: { telemetryRetentionConfig: true },
              fieldType: FieldType.Element,
              title: "Retention Overrides",
              getElement: (item: IoTFleet) => {
                return (
                  <TelemetryRetentionConfigSummary
                    config={item.telemetryRetentionConfig}
                  />
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />
      <ArchiveResourceCard<IoTFleet>
        modelType={IoTFleet}
        modelId={modelId}
        singularName="fleet"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.IOT_FLEETS] as Route,
        )}
      />
    </Fragment>
  );
};

export default IoTFleetSettings;
