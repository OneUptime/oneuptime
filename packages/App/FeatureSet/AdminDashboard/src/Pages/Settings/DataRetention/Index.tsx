import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import {
  TELEMETRY_USAGE_MAX_RETENTION_IN_DAYS,
  TELEMETRY_USAGE_MIN_RETENTION_IN_DAYS,
} from "Common/Types/Telemetry/TelemetryUsage";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

const Settings: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  return (
    <Page
      title={t("pages.settings.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.settings"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: t("breadcrumbs.dataRetention"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_DATA_RETENTION] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <CardModelDetail
        name="Monitor Log Retention Settings"
        cardProps={{
          title: t("pages.settings.dataRetention.logCardTitle"),
          description: t("pages.settings.dataRetention.logCardDescription"),
        }}
        isEditable={true}
        editButtonText={t("pages.settings.dataRetention.logEditButton")}
        // Titled like the button that opens it, not "Edit Global Config".
        editModalTitle={t("pages.settings.dataRetention.logEditButton")}
        formFields={[
          {
            field: {
              monitorLogRetentionInDays: true,
            },
            title: "Monitor Log Retention (Days)",
            fieldType: FormFieldSchemaType.PositiveNumber,
            required: false,
            description:
              "How many days monitor logs are kept, from 1 to 365. Leave empty for 1 day.",
            validation: {
              minValue: 1,
              maxValue: 365,
            },
            placeholder: "1",
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-global-config-data-retention",
          fields: [
            {
              field: {
                monitorLogRetentionInDays: true,
              },
              fieldType: FieldType.Number,
              title: "Monitor Log Retention (Days)",
              placeholder: "1 (default)",
              description:
                "Number of days to retain monitor logs. Monitor logs older than this will be automatically deleted.",
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />

      <CardModelDetail
        name="Monitor Metric Retention Settings"
        cardProps={{
          title: t("pages.settings.dataRetention.metricCardTitle"),
          description: t("pages.settings.dataRetention.metricCardDescription"),
        }}
        isEditable={true}
        editButtonText={t("pages.settings.dataRetention.metricEditButton")}
        // Titled like the button that opens it, not "Edit Global Config".
        editModalTitle={t("pages.settings.dataRetention.metricEditButton")}
        formFields={[
          {
            field: {
              monitorMetricRetentionInDays: true,
            },
            title: "Monitor Metric Retention (Days)",
            fieldType: FormFieldSchemaType.PositiveNumber,
            required: false,
            description:
              "How many days monitor, SLO and session replay budget metrics are kept, from 1 to 365. Leave empty for 30 days.",
            validation: {
              minValue: 1,
              maxValue: 365,
            },
            placeholder: "30",
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-global-config-monitor-metric-retention",
          fields: [
            {
              field: {
                monitorMetricRetentionInDays: true,
              },
              fieldType: FieldType.Number,
              title: "Monitor Metric Retention (Days)",
              placeholder: "30 (default)",
              description:
                "Number of days to retain monitor metrics, SLO metrics and session replay budget metrics. Metrics older than this will be automatically deleted.",
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />

      {/*
       * How long every project's daily telemetry usage is kept (Project
       * Settings > Telemetry & APM > Usage, and Telemetry Usage here), with
       * billing on or off. Never below 30 days: metering counts the last
       * week's days that have no usage yet, so a day deleted inside that
       * week would be counted again (getTelemetryUsageRetentionInDays).
       */}
      <CardModelDetail
        name="Telemetry Usage Retention Settings"
        cardProps={{
          title: t("pages.settings.dataRetention.usageCardTitle"),
          description: t("pages.settings.dataRetention.usageCardDescription"),
        }}
        isEditable={true}
        editButtonText={t("pages.settings.dataRetention.usageEditButton")}
        // Titled like the button that opens it, not "Edit Global Config".
        editModalTitle={t("pages.settings.dataRetention.usageEditButton")}
        formFields={[
          {
            field: {
              telemetryUsageRetentionInDays: true,
            },
            title: "Telemetry Usage Retention (Days)",
            fieldType: FormFieldSchemaType.PositiveNumber,
            required: false,
            // The bounds and the default of getTelemetryUsageRetentionInDays.
            description:
              "How many days each project's daily telemetry usage is kept, from 30 to 1095. Leave empty for 120 days.",
            validation: {
              minValue: TELEMETRY_USAGE_MIN_RETENTION_IN_DAYS,
              maxValue: TELEMETRY_USAGE_MAX_RETENTION_IN_DAYS,
            },
            placeholder: "120",
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-global-config-telemetry-usage-retention",
          fields: [
            {
              field: {
                telemetryUsageRetentionInDays: true,
              },
              fieldType: FieldType.Number,
              title: "Telemetry Usage Retention (Days)",
              placeholder: "120 (default)",
              description:
                "Number of days to keep each project's daily telemetry usage. Usage older than this is deleted.",
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />
    </Page>
  );
};

export default Settings;
