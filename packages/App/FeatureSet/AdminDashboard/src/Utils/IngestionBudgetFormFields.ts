import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormField from "Common/UI/Components/Forms/Types/Field";
import DetailField from "Common/UI/Components/ModelDetail/Field";
import FieldType from "Common/UI/Components/Types/FieldType";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import {
  TELEMETRY_INGESTION_BUDGET_COLUMNS,
  TELEMETRY_INGESTION_BUDGET_MAX_DAILY_GB,
  TELEMETRY_INGESTION_BUDGET_MAX_RATE_MB_PER_SECOND,
  TELEMETRY_INGESTION_BUDGET_SIGNALS,
  TelemetryIngestionBudgetSignal,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";

/*
 * The budget and rate fields of the Admin Dashboard's two Ingestion Budgets
 * pages: the instance defaults (Settings) and one project's overrides
 * (Projects > a project). One field per signal, in the order the Usage page
 * lists them, each titled as written here so the Admin locales can word it.
 */

export const DAILY_BUDGET_TITLES: Record<TelemetryIngestionBudgetSignal, string> =
  {
    [ProductType.Logs]: "Logs (GB per day)",
    [ProductType.Traces]: "Traces (GB per day)",
    [ProductType.Metrics]: "Metrics (GB per day)",
    [ProductType.Profiles]: "Profiles (GB per day)",
    [ProductType.SecurityEvents]: "Security Events (GB per day)",
  };

export const RATE_LIMIT_TITLES: Record<TelemetryIngestionBudgetSignal, string> =
  {
    [ProductType.Logs]: "Logs (MB per second)",
    [ProductType.Traces]: "Traces (MB per second)",
    [ProductType.Metrics]: "Metrics (MB per second)",
    [ProductType.Profiles]: "Profiles (MB per second)",
    [ProductType.SecurityEvents]: "Security Events (MB per second)",
  };

export enum IngestionBudgetLevel {
  // Settings > Ingestion Budgets: the default every project gets.
  Instance = "instance",
  // Projects > a project > Ingestion Budgets: that project's own.
  Project = "project",
}

/*
 * What an empty field means: no limit for the instance's defaults; the
 * instance default for a project (where 0 is "no limit for this project").
 */
export const INSTANCE_EMPTY_PLACEHOLDER: string = "No limit";
export const PROJECT_EMPTY_PLACEHOLDER: string = "Instance default";

const placeholderFor: (level: IngestionBudgetLevel) => string = (
  level: IngestionBudgetLevel,
): string => {
  return level === IngestionBudgetLevel.Project
    ? PROJECT_EMPTY_PLACEHOLDER
    : INSTANCE_EMPTY_PLACEHOLDER;
};

const columnOf: (
  signal: TelemetryIngestionBudgetSignal,
  isDaily: boolean,
) => string = (
  signal: TelemetryIngestionBudgetSignal,
  isDaily: boolean,
): string => {
  return isDaily
    ? TELEMETRY_INGESTION_BUDGET_COLUMNS[signal].dailyBudgetInGB
    : TELEMETRY_INGESTION_BUDGET_COLUMNS[signal].rateLimitInMBPerSecond;
};

const getFormFields: <TBaseModel extends BaseModel>(data: {
  level: IngestionBudgetLevel;
  isDaily: boolean;
}) => Array<FormField<TBaseModel>> = <TBaseModel extends BaseModel>(data: {
  level: IngestionBudgetLevel;
  isDaily: boolean;
}): Array<FormField<TBaseModel>> => {
  return TELEMETRY_INGESTION_BUDGET_SIGNALS.map(
    (signal: TelemetryIngestionBudgetSignal): FormField<TBaseModel> => {
      return {
        field: {
          [columnOf(signal, data.isDaily)]: true,
        } as unknown as FormField<TBaseModel>["field"],
        title: data.isDaily
          ? DAILY_BUDGET_TITLES[signal]
          : RATE_LIMIT_TITLES[signal],
        fieldType: FormFieldSchemaType.Number,
        required: false,
        // The column's description is written for the API, not this form.
        hideColumnDescription: true,
        placeholder: placeholderFor(data.level),
        validation: {
          // 0 is "no limit for this project"; the server refuses it on the instance.
          minValue: data.level === IngestionBudgetLevel.Project ? 0 : undefined,
          maxValue: data.isDaily
            ? TELEMETRY_INGESTION_BUDGET_MAX_DAILY_GB
            : TELEMETRY_INGESTION_BUDGET_MAX_RATE_MB_PER_SECOND,
        },
      };
    },
  );
};

const getDetailFields: <TBaseModel extends BaseModel>(data: {
  level: IngestionBudgetLevel;
  isDaily: boolean;
}) => Array<DetailField<TBaseModel>> = <TBaseModel extends BaseModel>(data: {
  level: IngestionBudgetLevel;
  isDaily: boolean;
}): Array<DetailField<TBaseModel>> => {
  return TELEMETRY_INGESTION_BUDGET_SIGNALS.map(
    (signal: TelemetryIngestionBudgetSignal): DetailField<TBaseModel> => {
      return {
        field: {
          [columnOf(signal, data.isDaily)]: true,
        } as unknown as DetailField<TBaseModel>["field"],
        title: data.isDaily
          ? DAILY_BUDGET_TITLES[signal]
          : RATE_LIMIT_TITLES[signal],
        fieldType: FieldType.Number,
        placeholder: placeholderFor(data.level),
      };
    },
  );
};

export const getDailyBudgetFormFields: <TBaseModel extends BaseModel>(
  level: IngestionBudgetLevel,
) => Array<FormField<TBaseModel>> = <TBaseModel extends BaseModel>(
  level: IngestionBudgetLevel,
): Array<FormField<TBaseModel>> => {
  return getFormFields<TBaseModel>({ level: level, isDaily: true });
};

export const getRateLimitFormFields: <TBaseModel extends BaseModel>(
  level: IngestionBudgetLevel,
) => Array<FormField<TBaseModel>> = <TBaseModel extends BaseModel>(
  level: IngestionBudgetLevel,
): Array<FormField<TBaseModel>> => {
  return getFormFields<TBaseModel>({ level: level, isDaily: false });
};

export const getDailyBudgetDetailFields: <TBaseModel extends BaseModel>(
  level: IngestionBudgetLevel,
) => Array<DetailField<TBaseModel>> = <TBaseModel extends BaseModel>(
  level: IngestionBudgetLevel,
): Array<DetailField<TBaseModel>> => {
  return getDetailFields<TBaseModel>({ level: level, isDaily: true });
};

export const getRateLimitDetailFields: <TBaseModel extends BaseModel>(
  level: IngestionBudgetLevel,
) => Array<DetailField<TBaseModel>> = <TBaseModel extends BaseModel>(
  level: IngestionBudgetLevel,
): Array<DetailField<TBaseModel>> => {
  return getDetailFields<TBaseModel>({ level: level, isDaily: false });
};
