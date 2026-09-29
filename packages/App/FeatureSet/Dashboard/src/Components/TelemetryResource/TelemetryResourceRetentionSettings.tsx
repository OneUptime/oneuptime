import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "Common/Types/ObjectID";
import TelemetryRetentionConfig from "Common/Types/Telemetry/TelemetryRetentionConfig";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import TelemetryRetentionConfigForm from "Common/UI/Components/Telemetry/TelemetryRetentionConfigForm";
import TelemetryRetentionConfigSummary from "Common/UI/Components/Telemetry/TelemetryRetentionConfigSummary";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { Fragment, ReactElement } from "react";

export interface TelemetryRetentionModel extends BaseModel {
  retainTelemetryDataForDays?: number | undefined;
  telemetryRetentionConfig?: TelemetryRetentionConfig | undefined;
}

export interface ComponentProps<TModel extends TelemetryRetentionModel> {
  modelType: { new (): TModel };
  modelId: ObjectID;
  resourceName: string;
  modelDetailIdPrefix: string;
}

/**
 * The two telemetry-retention controls shared by resource settings pages.
 *
 * Retention fields existed on several resource models before their Settings
 * pages did. Keeping the controls together gives every new resource one
 * component to mount, instead of relying on two manually copied cards that
 * can be forgotten independently.
 */
const TelemetryResourceRetentionSettings: <
  TModel extends TelemetryRetentionModel,
>(
  props: ComponentProps<TModel>,
) => ReactElement = <TModel extends TelemetryRetentionModel>(
  props: ComponentProps<TModel>,
): ReactElement => {
  return (
    <Fragment>
      <CardModelDetail<TModel>
        name="Telemetry Data Retention"
        cardProps={{
          title: "Telemetry Data Retention",
          description: `Set the default retention for telemetry collected from this ${props.resourceName}.`,
        }}
        isEditable={true}
        editButtonText="Edit Retention"
        formFields={[
          {
            field: {
              retainTelemetryDataForDays: true,
            },
            title: "Retain Telemetry Data For (Days)",
            description:
              "Leave blank to use the project's default telemetry retention.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "Use project default",
            validation: {
              minValue: 1,
            },
          },
        ]}
        modelDetailProps={{
          modelType: props.modelType,
          id: `${props.modelDetailIdPrefix}-telemetry-retention`,
          modelId: props.modelId,
          fields: [
            {
              field: {
                retainTelemetryDataForDays: true,
              },
              title: "Retain Telemetry Data For (Days)",
              description:
                "Falls back to the project's default telemetry retention when not set.",
              fieldType: FieldType.Number,
              placeholder: "Using project default",
            },
          ],
        }}
      />

      <CardModelDetail<TModel>
        name="Retention by Telemetry Type"
        cardProps={{
          title: "Retention by Telemetry Type",
          description: `Override retention for specific telemetry types collected from this ${props.resourceName}. Any field left blank falls back to the resource default above, then the project's settings.`,
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
              value: FormValues<TModel>,
              customElementProps: CustomElementProps,
            ): ReactElement => {
              return (
                <TelemetryRetentionConfigForm
                  {...customElementProps}
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
          modelType: props.modelType,
          id: `${props.modelDetailIdPrefix}-telemetry-retention-overrides`,
          fields: [
            {
              field: { telemetryRetentionConfig: true },
              fieldType: FieldType.Element,
              title: "Retention Overrides",
              getElement: (item: TModel): ReactElement => {
                return (
                  <TelemetryRetentionConfigSummary
                    config={item.telemetryRetentionConfig}
                  />
                );
              },
            },
          ],
          modelId: props.modelId,
        }}
      />
    </Fragment>
  );
};

export default TelemetryResourceRetentionSettings;
