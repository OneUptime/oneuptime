import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

const isPruningEnabled: (values: FormValues<GlobalConfig>) => boolean = (
  values: FormValues<GlobalConfig>,
): boolean => {
  return Boolean(values.clickhouseDataPruningEnabled);
};

const isNotificationEnabled: (values: FormValues<GlobalConfig>) => boolean = (
  values: FormValues<GlobalConfig>,
): boolean => {
  return Boolean(values.clickhouseCapacityNotificationEnabled);
};

const toNumberOrNull: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed: number = Number(value);
  return isNaN(parsed) ? null : parsed;
};

const validatePruningTarget: (
  values: FormValues<GlobalConfig>,
) => string | null = (values: FormValues<GlobalConfig>): string | null => {
  if (!isPruningEnabled(values)) {
    return null;
  }

  const trigger: number | null = toNumberOrNull(
    values.clickhouseDataPruningThresholdPercent,
  );
  const target: number | null = toNumberOrNull(
    values.clickhouseDataPruningTargetPercent,
  );

  if (trigger === null || target === null) {
    return null;
  }

  if (target >= trigger) {
    return "The pruning target must be lower than the pruning trigger.";
  }

  return null;
};

const ClickhouseCapacitySettings: FunctionComponent = (): ReactElement => {
  return (
    <>
      <Alert
        type={AlertType.WARNING}
        strongTitle="Automatic pruning permanently deletes telemetry."
        title="When enabled, OneUptime drops the oldest eligible telemetry partitions across the cluster until capacity reaches the target. Deleted data cannot be recovered unless you have a backup."
      />

      <CardModelDetail<GlobalConfig>
        name="ClickHouse Capacity Policy"
        cardProps={{
          title: "ClickHouse capacity policy",
          description:
            "Notify master administrators when a writable physical disk on any ClickHouse shard or replica crosses a capacity threshold, and optionally reclaim space by pruning the oldest data.",
        }}
        isEditable={true}
        editButtonText="Edit capacity policy"
        formFields={[
          {
            field: {
              clickhouseCapacityNotificationEnabled: true,
            },
            title: "Notify on high capacity",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Notify master administrators when a writable physical disk on any ClickHouse shard or replica crosses the configured capacity threshold.",
          },
          {
            field: {
              clickhouseCapacityNotificationThresholdPercent: true,
            },
            title: "Notification threshold (%)",
            fieldType: FormFieldSchemaType.PositiveNumber,
            required: isNotificationEnabled,
            showIf: isNotificationEnabled,
            validation: {
              minValue: 1,
              maxValue: 100,
            },
            placeholder: "80",
            description:
              "Send a notification when physical disk usage on any ClickHouse shard or replica rises to this percentage.",
          },
          {
            field: {
              clickhouseDataPruningEnabled: true,
            },
            title: "Enable automatic data pruning",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Permanently delete the oldest eligible telemetry partitions when capacity reaches the pruning trigger.",
          },
          {
            field: {
              clickhouseDataPruningThresholdPercent: true,
            },
            title: "Pruning trigger (%)",
            fieldType: FormFieldSchemaType.PositiveNumber,
            required: isPruningEnabled,
            showIf: isPruningEnabled,
            validation: {
              minValue: 1,
              maxValue: 100,
            },
            placeholder: "90",
            description:
              "Start pruning when physical disk usage on any ClickHouse shard or replica reaches this percentage.",
          },
          {
            field: {
              clickhouseDataPruningTargetPercent: true,
            },
            title: "Pruning target (%)",
            fieldType: FormFieldSchemaType.PositiveNumber,
            required: isPruningEnabled,
            showIf: isPruningEnabled,
            validation: {
              minValue: 1,
              maxValue: 100,
            },
            customValidation: validatePruningTarget,
            placeholder: "80",
            description:
              "Continue deleting the oldest data until every writable ClickHouse disk falls to this percentage. This must be lower than the pruning trigger.",
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-clickhouse-capacity-policy",
          fields: [
            {
              field: {
                clickhouseCapacityNotificationEnabled: true,
              },
              fieldType: FieldType.Boolean,
              title: "High-capacity notifications",
              placeholder: "No",
            },
            {
              field: {
                clickhouseCapacityNotificationThresholdPercent: true,
              },
              fieldType: FieldType.Number,
              title: "Notification threshold (%)",
              placeholder: "Not configured",
            },
            {
              field: {
                clickhouseDataPruningEnabled: true,
              },
              fieldType: FieldType.Boolean,
              title: "Automatic data pruning",
              placeholder: "No",
            },
            {
              field: {
                clickhouseDataPruningThresholdPercent: true,
              },
              fieldType: FieldType.Number,
              title: "Pruning trigger (%)",
              placeholder: "Not configured",
            },
            {
              field: {
                clickhouseDataPruningTargetPercent: true,
              },
              fieldType: FieldType.Number,
              title: "Pruning target (%)",
              placeholder: "Not configured",
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />
    </>
  );
};

export default ClickhouseCapacitySettings;
