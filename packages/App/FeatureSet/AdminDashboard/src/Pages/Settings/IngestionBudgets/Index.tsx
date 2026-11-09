import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  getDailyBudgetDetailFields,
  getDailyBudgetFormFields,
  getRateLimitDetailFields,
  getRateLimitFormFields,
  IngestionBudgetLevel,
} from "../../../Utils/IngestionBudgetFormFields";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import {
  TELEMETRY_INGESTION_BUDGET_DEFAULT_RESET_TIME,
  TELEMETRY_INGESTION_BUDGET_DEFAULT_TIMEZONE,
  TELEMETRY_INGESTION_BUDGET_DEFAULT_WARNING_PERCENT,
  TELEMETRY_INGESTION_BUDGET_MAX_WARNING_PERCENT,
  TELEMETRY_INGESTION_BUDGET_MIN_WARNING_PERCENT,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import TimezoneUtil from "Common/UI/Utils/Timezone";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * Admin Dashboard > Settings > Ingestion Budgets: the daily budget and the
 * per-second rate every project gets for each telemetry signal, unless it has
 * its own (Projects > a project > Ingestion Budgets), and when the budget day
 * resets. Empty is no limit - every installation starts there - so nothing
 * changes until a budget is set here. Saved on GlobalConfig; ingest reads it
 * within a minute on every server (TelemetryIngestionBudgetSettings).
 *
 * The daily budgets come first: they are what protects the instance. The
 * warning and the reset are settings most installations leave as they are,
 * and the per-second rates are a refinement on top of the budgets, so both
 * follow, the rates last.
 */
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
          title: t("breadcrumbs.ingestionBudgets"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_INGESTION_BUDGETS] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <CardModelDetail<GlobalConfig>
        name="Default Daily Ingestion Budgets"
        cardProps={{
          title: t("pages.settings.ingestionBudgets.dailyCardTitle"),
          description: t(
            "pages.settings.ingestionBudgets.dailyCardDescription",
          ),
        }}
        isEditable={true}
        editButtonText={t("pages.settings.ingestionBudgets.dailyEditButton")}
        editModalTitle={t("pages.settings.ingestionBudgets.dailyEditButton")}
        formFields={getDailyBudgetFormFields<GlobalConfig>(
          IngestionBudgetLevel.Instance,
        )}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-global-config-ingestion-budgets",
          showDetailsInNumberOfColumns: 2,
          fields: getDailyBudgetDetailFields<GlobalConfig>(
            IngestionBudgetLevel.Instance,
          ),
          modelId: ObjectID.getZeroObjectID(),
        }}
      />

      <CardModelDetail<GlobalConfig>
        name="Ingestion Budget Warning and Reset"
        cardProps={{
          title: t("pages.settings.ingestionBudgets.resetCardTitle"),
          description: t(
            "pages.settings.ingestionBudgets.resetCardDescription",
          ),
        }}
        isEditable={true}
        editButtonText={t("pages.settings.ingestionBudgets.resetEditButton")}
        editModalTitle={t("pages.settings.ingestionBudgets.resetEditButton")}
        formFields={[
          {
            field: {
              telemetryIngestionBudgetWarningPercent: true,
            },
            title: "Warning Threshold (%)",
            fieldType: FormFieldSchemaType.PositiveNumber,
            required: false,
            description:
              "Projects are warned, and their owners emailed, when this share of a daily budget is used. From 1 to 99. Leave empty for 80.",
            validation: {
              minValue: TELEMETRY_INGESTION_BUDGET_MIN_WARNING_PERCENT,
              maxValue: TELEMETRY_INGESTION_BUDGET_MAX_WARNING_PERCENT,
            },
            placeholder: String(
              TELEMETRY_INGESTION_BUDGET_DEFAULT_WARNING_PERCENT,
            ),
          },
          {
            field: {
              telemetryIngestionBudgetResetTime: true,
            },
            title: "Reset Time",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            description:
              "When each budget day starts again, as HH:MM on the 24-hour clock. Leave empty for 00:00.",
            placeholder: TELEMETRY_INGESTION_BUDGET_DEFAULT_RESET_TIME,
          },
          {
            field: {
              telemetryIngestionBudgetResetTimezone: true,
            },
            title: "Reset Time Zone",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: TimezoneUtil.getTimezoneDropdownOptions(),
            required: false,
            description:
              "The time zone of the reset time. Leave empty for UTC.",
            placeholder: TELEMETRY_INGESTION_BUDGET_DEFAULT_TIMEZONE,
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-global-config-ingestion-budget-reset",
          showDetailsInNumberOfColumns: 3,
          fields: [
            {
              field: {
                telemetryIngestionBudgetWarningPercent: true,
              },
              title: "Warning Threshold (%)",
              fieldType: FieldType.Number,
              placeholder: `${TELEMETRY_INGESTION_BUDGET_DEFAULT_WARNING_PERCENT} (default)`,
            },
            {
              field: {
                telemetryIngestionBudgetResetTime: true,
              },
              title: "Reset Time",
              fieldType: FieldType.Text,
              placeholder: `${TELEMETRY_INGESTION_BUDGET_DEFAULT_RESET_TIME} (default)`,
            },
            {
              field: {
                telemetryIngestionBudgetResetTimezone: true,
              },
              title: "Reset Time Zone",
              fieldType: FieldType.Text,
              placeholder: `${TELEMETRY_INGESTION_BUDGET_DEFAULT_TIMEZONE} (default)`,
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />

      <CardModelDetail<GlobalConfig>
        name="Default Ingestion Rate Limits"
        cardProps={{
          title: t("pages.settings.ingestionBudgets.rateCardTitle"),
          description: t("pages.settings.ingestionBudgets.rateCardDescription"),
        }}
        isEditable={true}
        editButtonText={t("pages.settings.ingestionBudgets.rateEditButton")}
        editModalTitle={t("pages.settings.ingestionBudgets.rateEditButton")}
        formFields={getRateLimitFormFields<GlobalConfig>(
          IngestionBudgetLevel.Instance,
        )}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-global-config-ingestion-rate-limits",
          showDetailsInNumberOfColumns: 2,
          fields: getRateLimitDetailFields<GlobalConfig>(
            IngestionBudgetLevel.Instance,
          ),
          modelId: ObjectID.getZeroObjectID(),
        }}
      />
    </Page>
  );
};

export default Settings;
