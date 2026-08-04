import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

const isMemoryNotificationEnabled: (
  values: FormValues<GlobalConfig>,
) => boolean = (values: FormValues<GlobalConfig>): boolean => {
  return Boolean(values.redisMemoryNotificationEnabled);
};

const isConnectionNotificationEnabled: (
  values: FormValues<GlobalConfig>,
) => boolean = (values: FormValues<GlobalConfig>): boolean => {
  return Boolean(values.redisConnectionNotificationEnabled);
};

const RedisHealthSettings: FunctionComponent = (): ReactElement => {
  return (
    <CardModelDetail<GlobalConfig>
      name="Redis Health Policy"
      cardProps={{
        title: "Redis health policy",
        description:
          "Notify master administrators when Redis runs short of memory or connections, evicts keys, or cannot persist to disk.",
      }}
      isEditable={true}
      editButtonText="Edit Redis policy"
      formFields={[
        {
          field: {
            redisMemoryNotificationEnabled: true,
          },
          title: "Notify on high memory usage",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "Notify master administrators when Redis memory usage crosses the configured share of maxmemory. Requires maxmemory to be set on Redis.",
        },
        {
          field: {
            redisMemoryNotificationThresholdPercent: true,
          },
          title: "Memory threshold (%)",
          fieldType: FormFieldSchemaType.PositiveNumber,
          required: isMemoryNotificationEnabled,
          showIf: isMemoryNotificationEnabled,
          validation: {
            minValue: 1,
            maxValue: 100,
          },
          placeholder: "80",
          description:
            "Send a notification when Redis memory usage rises to this percentage of maxmemory.",
        },
        {
          field: {
            redisConnectionNotificationEnabled: true,
          },
          title: "Notify on connection saturation",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "Notify master administrators when connected clients approach the maxclients limit, or when Redis starts rejecting connections.",
        },
        {
          field: {
            redisConnectionNotificationThresholdPercent: true,
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
            "Send a notification when connected clients rise to this percentage of maxclients. Rejected connections always notify, whatever this is set to.",
        },
        {
          field: {
            redisKeyEvictionNotificationEnabled: true,
          },
          title: "Notify on key eviction",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "Notify master administrators when Redis discards keys because it reached its memory limit. Leave this off if you run Redis as a pure cache, where eviction is expected.",
        },
        {
          field: {
            redisPersistenceFailureNotificationEnabled: true,
          },
          title: "Notify on persistence failure",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "Notify master administrators when a Redis RDB snapshot or AOF write fails, which means everything since the last successful write is lost if Redis restarts.",
        },
      ]}
      modelDetailProps={{
        modelType: GlobalConfig,
        id: "model-detail-redis-health-policy",
        fields: [
          {
            field: {
              redisMemoryNotificationEnabled: true,
            },
            fieldType: FieldType.Boolean,
            title: "High-memory notifications",
            placeholder: "No",
          },
          {
            field: {
              redisMemoryNotificationThresholdPercent: true,
            },
            fieldType: FieldType.Number,
            title: "Memory threshold (%)",
            placeholder: "Not configured",
          },
          {
            field: {
              redisConnectionNotificationEnabled: true,
            },
            fieldType: FieldType.Boolean,
            title: "Connection saturation notifications",
            placeholder: "No",
          },
          {
            field: {
              redisConnectionNotificationThresholdPercent: true,
            },
            fieldType: FieldType.Number,
            title: "Connection threshold (%)",
            placeholder: "Not configured",
          },
          {
            field: {
              redisKeyEvictionNotificationEnabled: true,
            },
            fieldType: FieldType.Boolean,
            title: "Key eviction notifications",
            placeholder: "No",
          },
          {
            field: {
              redisPersistenceFailureNotificationEnabled: true,
            },
            fieldType: FieldType.Boolean,
            title: "Persistence failure notifications",
            placeholder: "No",
          },
        ],
        modelId: ObjectID.getZeroObjectID(),
      }}
    />
  );
};

export default RedisHealthSettings;
