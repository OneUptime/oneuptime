import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

const isStorageNotificationEnabled: (
  values: FormValues<GlobalConfig>,
) => boolean = (values: FormValues<GlobalConfig>): boolean => {
  return Boolean(values.postgresStorageNotificationEnabled);
};

const isConnectionNotificationEnabled: (
  values: FormValues<GlobalConfig>,
) => boolean = (values: FormValues<GlobalConfig>): boolean => {
  return Boolean(values.postgresConnectionNotificationEnabled);
};

const isWraparoundNotificationEnabled: (
  values: FormValues<GlobalConfig>,
) => boolean = (values: FormValues<GlobalConfig>): boolean => {
  return Boolean(values.postgresWraparoundNotificationEnabled);
};

const isReplicationSlotNotificationEnabled: (
  values: FormValues<GlobalConfig>,
) => boolean = (values: FormValues<GlobalConfig>): boolean => {
  return Boolean(values.postgresReplicationSlotNotificationEnabled);
};

const PostgresHealthSettings: FunctionComponent = (): ReactElement => {
  return (
    <CardModelDetail<GlobalConfig>
      name="PostgreSQL Health Policy"
      cardProps={{
        title: "PostgreSQL health policy",
        description:
          "Notify master administrators when PostgreSQL runs short of storage or connections, approaches transaction-ID wraparound, or has a replication slot retaining WAL.",
      }}
      isEditable={true}
      editButtonText="Edit PostgreSQL policy"
      formFields={[
        {
          field: {
            postgresStorageNotificationEnabled: true,
          },
          title: "Notify on high storage usage",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "Notify master administrators when the database size crosses the configured share of its storage limit.",
          footerElement: (
            <Alert
              type={AlertType.INFO}
              strongTitle="PostgreSQL cannot report free disk space."
              title="Unlike ClickHouse, PostgreSQL exposes no filesystem free space over SQL, so OneUptime compares the database size against the storage limit you enter below. Keep it in step with the volume backing PostgreSQL."
              className="mt-3"
            />
          ),
        },
        {
          field: {
            postgresStorageLimitInGb: true,
          },
          title: "Storage limit (GB)",
          fieldType: FormFieldSchemaType.PositiveNumber,
          required: isStorageNotificationEnabled,
          showIf: isStorageNotificationEnabled,
          validation: {
            minValue: 1,
          },
          placeholder: "100",
          description:
            "Size of the volume backing PostgreSQL, in gigabytes. Storage notifications are skipped until this is set.",
        },
        {
          field: {
            postgresStorageNotificationThresholdPercent: true,
          },
          title: "Storage threshold (%)",
          fieldType: FormFieldSchemaType.PositiveNumber,
          required: isStorageNotificationEnabled,
          showIf: isStorageNotificationEnabled,
          validation: {
            minValue: 1,
            maxValue: 100,
          },
          placeholder: "80",
          description:
            "Send a notification when the database size rises to this percentage of the storage limit.",
        },
        {
          field: {
            postgresConnectionNotificationEnabled: true,
          },
          title: "Notify on connection saturation",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "Notify master administrators when client backends approach the max_connections limit, past which PostgreSQL refuses new connections entirely.",
        },
        {
          field: {
            postgresConnectionNotificationThresholdPercent: true,
          },
          title: "Connection threshold (%)",
          fieldType: FormFieldSchemaType.PositiveNumber,
          required: isConnectionNotificationEnabled,
          showIf: isConnectionNotificationEnabled,
          validation: {
            minValue: 1,
            maxValue: 100,
          },
          placeholder: "80",
          description:
            "Send a notification when client backends rise to this percentage of max_connections.",
        },
        {
          field: {
            postgresWraparoundNotificationEnabled: true,
          },
          title: "Notify on transaction-ID wraparound risk",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "Notify master administrators when transaction-ID age approaches the point at which PostgreSQL refuses all writes to protect the data.",
        },
        {
          field: {
            postgresWraparoundNotificationThresholdPercent: true,
          },
          title: "Wraparound threshold (%)",
          fieldType: FormFieldSchemaType.PositiveNumber,
          required: isWraparoundNotificationEnabled,
          showIf: isWraparoundNotificationEnabled,
          validation: {
            minValue: 1,
            maxValue: 100,
          },
          placeholder: "50",
          description:
            "Send a notification when transaction-ID age reaches this percentage of the wraparound ceiling. Recovering from wraparound needs the instance offline, so this warns much earlier than a capacity check.",
        },
        {
          field: {
            postgresReplicationSlotNotificationEnabled: true,
          },
          title: "Notify on replication slot WAL retention",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "Notify master administrators when a replication slot retains more WAL than the limit below, or when PostgreSQL has already lost the WAL a slot needed.",
        },
        {
          field: {
            postgresRetainedWalLimitInGb: true,
          },
          title: "Retained WAL limit (GB)",
          fieldType: FormFieldSchemaType.PositiveNumber,
          required: isReplicationSlotNotificationEnabled,
          showIf: isReplicationSlotNotificationEnabled,
          validation: {
            minValue: 1,
          },
          placeholder: "10",
          description:
            "Send a notification when a single replication slot retains more than this many gigabytes of WAL. An abandoned slot retains WAL forever and will eventually fill the volume.",
        },
      ]}
      modelDetailProps={{
        modelType: GlobalConfig,
        id: "model-detail-postgres-health-policy",
        fields: [
          {
            field: {
              postgresStorageNotificationEnabled: true,
            },
            fieldType: FieldType.Boolean,
            title: "High-storage notifications",
            placeholder: "No",
          },
          {
            field: {
              postgresStorageLimitInGb: true,
            },
            fieldType: FieldType.Number,
            title: "Storage limit (GB)",
            placeholder: "Not configured",
          },
          {
            field: {
              postgresStorageNotificationThresholdPercent: true,
            },
            fieldType: FieldType.Number,
            title: "Storage threshold (%)",
            placeholder: "Not configured",
          },
          {
            field: {
              postgresConnectionNotificationEnabled: true,
            },
            fieldType: FieldType.Boolean,
            title: "Connection saturation notifications",
            placeholder: "No",
          },
          {
            field: {
              postgresConnectionNotificationThresholdPercent: true,
            },
            fieldType: FieldType.Number,
            title: "Connection threshold (%)",
            placeholder: "Not configured",
          },
          {
            field: {
              postgresWraparoundNotificationEnabled: true,
            },
            fieldType: FieldType.Boolean,
            title: "Wraparound notifications",
            placeholder: "No",
          },
          {
            field: {
              postgresWraparoundNotificationThresholdPercent: true,
            },
            fieldType: FieldType.Number,
            title: "Wraparound threshold (%)",
            placeholder: "Not configured",
          },
          {
            field: {
              postgresReplicationSlotNotificationEnabled: true,
            },
            fieldType: FieldType.Boolean,
            title: "Replication slot notifications",
            placeholder: "No",
          },
          {
            field: {
              postgresRetainedWalLimitInGb: true,
            },
            fieldType: FieldType.Number,
            title: "Retained WAL limit (GB)",
            placeholder: "Not configured",
          },
        ],
        modelId: ObjectID.getZeroObjectID(),
      }}
    />
  );
};

export default PostgresHealthSettings;
