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
        formFields={[
          {
            field: {
              monitorLogRetentionInDays: true,
            },
            title: "Monitor Log Retention (Days)",
            fieldType: FormFieldSchemaType.PositiveNumber,
            required: false,
            description:
              "Number of days to retain monitor logs. Monitor logs older than this will be automatically deleted. Default is 1 day if not set. Minimum: 1 day, Maximum: 365 days.",
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
        formFields={[
          {
            field: {
              monitorMetricRetentionInDays: true,
            },
            title: "Monitor Metric Retention (Days)",
            fieldType: FormFieldSchemaType.PositiveNumber,
            required: false,
            description:
              "Number of days to retain monitor metrics. Monitor metrics older than this will be automatically deleted. Default is 1 day if not set. Minimum: 1 day, Maximum: 365 days.",
            validation: {
              minValue: 1,
              maxValue: 365,
            },
            placeholder: "1",
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
              placeholder: "1 (default)",
              description:
                "Number of days to retain monitor metrics. Monitor metrics older than this will be automatically deleted.",
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />
    </Page>
  );
};

export default Settings;
