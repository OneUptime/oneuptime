import AppLink from "../AppLink/AppLink";
import DataObservabilityApi from "./DataObservabilityApi";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataCheck from "Common/Models/DatabaseModels/DataCheck";
import Route from "Common/Types/API/Route";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500, Green500, Red500 } from "Common/Types/BrandColors";
import { DataAssetColumn } from "Common/Types/DataObservability/DataAssetColumn";
import {
  DATA_CHECK_ALERT_CONDITIONS,
  DATA_CHECK_INTERVALS_IN_MINUTES,
  DATA_CHECK_TYPES,
  DataCheckAlertCondition,
  DataCheckType,
  DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES,
  doesAlertConditionNeedThreshold,
  isColumnCheckType,
} from "Common/Types/DataObservability/DataCheckType";
import OneUptimeDate from "Common/Types/Date";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  // One table's checks, with its columns to choose from; or every check of the project.
  dataAssetId?: ObjectID | undefined;
  columns?: Array<DataAssetColumn> | undefined;
  // Changed when checks were added from elsewhere (suggestions), to read the list again.
  refreshToggle?: string | undefined;
}

const TYPE_OPTIONS: Array<DropdownOption> = DATA_CHECK_TYPES.map(
  (type: DataCheckType): DropdownOption => {
    return { value: type, label: type };
  },
);

function getIntervalOptions(translator: Translator): Array<DropdownOption> {
  return DATA_CHECK_INTERVALS_IN_MINUTES.map(
    (minutes: number): DropdownOption => {
      return {
        value: minutes,
        label:
          minutes < 60
            ? translator.translateTemplate("Every {{count}} minutes", {
                count: minutes,
              })
            : minutes === 60
              ? "Every hour"
              : minutes === 1440
                ? "Every day"
                : translator.translateTemplate("Every {{count}} hours", {
                    count: minutes / 60,
                  }),
      };
    },
  );
}

const ALERT_OPTIONS: Array<DropdownOption> = DATA_CHECK_ALERT_CONDITIONS.map(
  (condition: DataCheckAlertCondition): DropdownOption => {
    return { value: condition, label: condition };
  },
);

// Accepted values are typed one per line, and kept as a list.
function readAcceptedValues(value: unknown): Array<string> | undefined {
  if (Array.isArray(value)) {
    return value.map(String);
  }

  if (typeof value !== "string") {
    return undefined;
  }

  return value
    .split(/\r?\n/)
    .map((line: string) => {
      return line.trim();
    })
    .filter(Boolean);
}

function withAcceptedValuesAsList(item: DataCheck): DataCheck {
  const values: Array<string> | undefined = readAcceptedValues(
    item.acceptedValues as unknown,
  );

  if (values !== undefined) {
    item.acceptedValues = values;
  }

  return item;
}

/*
 * The checks on a table's values - or, with no table, every check of the
 * project - with their last value and run, and their alert. Saving a check
 * makes its monitor match its alert condition (DataCheckAlerts); Run Now
 * runs it at its store's very next collection.
 */
const DataCheckTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const [alertError, setAlertError] = useState<string>("");
  const isForOneTable: boolean = Boolean(props.dataAssetId);
  const columnOptions: Array<DropdownOption> = (props.columns || []).map(
    (column: DataAssetColumn): DropdownOption => {
      return { value: column.name, label: column.name };
    },
  );

  const syncAlert: (item: DataCheck) => Promise<DataCheck> = async (
    item: DataCheck,
  ): Promise<DataCheck> => {
    setAlertError("");

    if (item.id) {
      try {
        await DataObservabilityApi.syncCheckAlert(item.id);
      } catch (err) {
        setAlertError(
          translator.translateTemplate(
            "The check is saved, but its alert could not be set up: {{reason}}",
            { reason: API.getFriendlyMessage(err) },
          ),
        );
      }
    }

    return item;
  };

  return (
    <>
      {alertError ? (
        <p className="mb-3 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {alertError}
        </p>
      ) : (
        <></>
      )}
      <ModelTable<DataCheck>
        modelType={DataCheck}
        rowSwitch={{ column: "isEnabled" }}
        refreshToggle={props.refreshToggle}
        id={
          isForOneTable
            ? "data-observability-table-checks"
            : "data-observability-checks"
        }
        name={
          isForOneTable
            ? "Data Observability > Table > Checks"
            : "Data Observability > Checks"
        }
        userPreferencesKey={
          isForOneTable
            ? "data-observability-table-checks"
            : "data-observability-checks"
        }
        query={{
          ...(projectId ? { projectId: projectId } : {}),
          ...(props.dataAssetId ? { dataAssetId: props.dataAssetId } : {}),
          // dbt's tests are listed on their own (DbtTestTable): dbt runs them.
          checkType: new NotEqual<string>(DataCheckType.DbtTest),
        }}
        isDeleteable={true}
        isEditable={isForOneTable}
        isCreateable={isForOneTable}
        isViewable={false}
        sortBy="lastRunStatus"
        sortOrder={SortOrder.Ascending}
        showRefreshButton={true}
        searchableFields={["name"]}
        cardProps={{
          title: "Checks",
          description: isForOneTable
            ? "Checks on what this table holds: empty or repeated values, values outside a list or pattern, rows with no match, a query of your own. Each runs on a schedule."
            : "Every check on your tables' values, failing first.",
        }}
        noItemsMessage={
          isForOneTable
            ? "No check on this table yet. Add one to watch its values: how many are empty, repeated, or not what they should be."
            : "No check yet. Open a table and add one on its Checks tab."
        }
        onBeforeCreate={async (item: DataCheck): Promise<DataCheck> => {
          if (props.dataAssetId) {
            item.dataAssetId = props.dataAssetId;
          }

          return withAcceptedValuesAsList(item);
        }}
        onBeforeUpdate={async (item: DataCheck): Promise<DataCheck> => {
          return withAcceptedValuesAsList(item);
        }}
        onBeforeEdit={async (item: DataCheck): Promise<DataCheck> => {
          if (Array.isArray(item.acceptedValues)) {
            (item as unknown as Record<string, unknown>)["acceptedValues"] =
              item.acceptedValues.join("\n");
          }

          return item;
        }}
        onCreateSuccess={syncAlert}
        selectMoreFields={{
          dataAssetId: true,
          lastRunMessage: true,
          alertThreshold: true,
          monitorId: true,
          segmentColumn: true,
        }}
        actionButtons={[
          {
            title: "Run Now",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Play,
            onClick: async (
              item: DataCheck,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                await DataObservabilityApi.runCheckNow(item.id!);
                onCompleteAction();
              } catch (err) {
                onError(err as Error);
              }
            },
          },
        ]}
        formSteps={[
          { title: "Check", id: "check" },
          { title: "What It Reads", id: "reads" },
          { title: "When It Runs", id: "when" },
        ]}
        formFields={[
          {
            field: { name: true },
            stepId: "check",
            title: "Name",
            description: "Shown on the check's metric and alerts.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Orders without a customer",
          },
          {
            field: { checkType: true },
            stepId: "check",
            title: "Check",
            description: "What the check measures.",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            dropdownOptions: TYPE_OPTIONS,
          },
          {
            field: { description: true },
            stepId: "check",
            title: "Description",
            description:
              "Shown with the check: why it matters, and what to do when it fails.",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Why it matters, and what to do when it fails.",
          },
          {
            field: { columnName: true },
            stepId: "reads",
            title: "Column",
            description: "The column the check reads.",
            fieldType: FormFieldSchemaType.Dropdown,
            required: false,
            dropdownOptions: columnOptions,
            showIf: (values: FormValues<DataCheck>): boolean => {
              return Boolean(
                values.checkType &&
                  isColumnCheckType(values.checkType as DataCheckType),
              );
            },
          },
          {
            field: { acceptedValues: true },
            stepId: "reads",
            title: "Accepted Values",
            description: "One per line.",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "pending\npaid\nrefunded",
            showIf: (values: FormValues<DataCheck>): boolean => {
              return values.checkType === DataCheckType.InvalidPercent;
            },
          },
          {
            field: { pattern: true },
            stepId: "reads",
            title: "Pattern",
            description: "A regular expression every value must match.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "^[^@\\s]+@[^@\\s]+$",
            showIf: (values: FormValues<DataCheck>): boolean => {
              return values.checkType === DataCheckType.FormatMismatchPercent;
            },
          },
          {
            field: { referenceTableKey: true },
            stepId: "reads",
            title: "Referenced Table",
            description: "The table the column refers to, as schema.table.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "public.customers",
            showIf: (values: FormValues<DataCheck>): boolean => {
              return values.checkType === DataCheckType.OrphanCount;
            },
          },
          {
            field: { referenceColumnName: true },
            stepId: "reads",
            title: "Referenced Column",
            description: "The column of that table it refers to.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "id",
            showIf: (values: FormValues<DataCheck>): boolean => {
              return values.checkType === DataCheckType.OrphanCount;
            },
          },
          {
            field: { customSql: true },
            stepId: "reads",
            title: "Query",
            description:
              "One SELECT returning a number. With Segment By, a segment and a number per row.",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "SELECT COUNT(*) FROM orders WHERE total < 0",
            showIf: (values: FormValues<DataCheck>): boolean => {
              return values.checkType === DataCheckType.CustomSql;
            },
          },
          {
            field: { segmentColumn: true },
            stepId: "reads",
            title: "Segment By",
            description:
              "Run the check once per value of a column - a tenant, a region - one series and one alert each.",
            fieldType: FormFieldSchemaType.Dropdown,
            required: false,
            dropdownOptions: columnOptions,
          },
          {
            field: { intervalInMinutes: true },
            stepId: "when",
            title: "Run",
            description:
              "How often the check runs, with its database's collection.",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            defaultValue: DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES,
            dropdownOptions: getIntervalOptions(translator),
          },
          {
            field: { alertCondition: true },
            stepId: "when",
            title: "Alert When",
            description:
              "Unusually high or low compares each value with its own learned baseline for that hour of the week. Leave empty for no alert.",
            fieldType: FormFieldSchemaType.Dropdown,
            required: false,
            dropdownOptions: ALERT_OPTIONS,
          },
          {
            field: { alertThreshold: true },
            stepId: "when",
            title: "Threshold",
            description: "The value an Above or Below alert compares with.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            showIf: (values: FormValues<DataCheck>): boolean => {
              return Boolean(
                values.alertCondition &&
                  doesAlertConditionNeedThreshold(
                    values.alertCondition as DataCheckAlertCondition,
                  ),
              );
            },
          },
          {
            field: { isEnabled: true },
            stepId: "when",
            title: "Enabled",
            description:
              "Turned off, the check stops running, and its alert goes quiet with it.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: true,
          },
        ]}
        filters={[
          {
            field: { checkType: true },
            title: "Check",
            type: FieldType.Dropdown,
            filterDropdownOptions: TYPE_OPTIONS,
          },
          {
            field: { lastRunStatus: true },
            title: "Last Run",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Element,
            getExportValue: (check: DataCheck): string => {
              return check.name || "";
            },
            getElement: (check: DataCheck): ReactElement => {
              return (
                <div className="min-w-0">
                  {isForOneTable || !check.dataAssetId ? (
                    <span className="block truncate font-medium text-gray-900">
                      {check.name}
                    </span>
                  ) : (
                    <AppLink
                      to={RouteUtil.populateRouteParams(
                        RouteMap[
                          PageMap.DATA_OBSERVABILITY_TABLE_VIEW_CHECKS
                        ] as Route,
                        { modelId: check.dataAssetId },
                      )}
                      className="block truncate font-medium text-gray-900 hover:underline"
                    >
                      <span>{check.name}</span>
                    </AppLink>
                  )}
                  <span className="block truncate text-xs text-gray-500">
                    {check.checkType}
                    {check.columnName ? ` · ${check.columnName}` : ""}
                    {check.segmentColumn
                      ? ` · ${translator.translateTemplate("by {{column}}", {
                          column: check.segmentColumn,
                        })}`
                      : ""}
                  </span>
                </div>
              );
            },
          },
          {
            field: { lastValue: true },
            title: "Last Value",
            type: FieldType.Element,
            getExportValue: (check: DataCheck): string => {
              return check.lastValue === undefined || check.lastValue === null
                ? ""
                : String(check.lastValue);
            },
            getElement: (check: DataCheck): ReactElement => {
              return (
                <span className="whitespace-nowrap text-sm text-gray-700">
                  {check.lastValue === undefined || check.lastValue === null
                    ? "-"
                    : translator.formatNumber(Number(check.lastValue))}
                </span>
              );
            },
          },
          {
            field: { lastRunStatus: true },
            title: "Last Run",
            type: FieldType.Element,
            getExportValue: (check: DataCheck): string => {
              return check.lastRunStatus || "";
            },
            getElement: (check: DataCheck): ReactElement => {
              if (!check.lastRunAt) {
                return <Pill text="Waiting for first run" color={Gray500} />;
              }

              return (
                <div className="min-w-0 space-y-1">
                  {check.lastRunStatus === "Failed" ? (
                    <Pill text="Failed" color={Red500} />
                  ) : (
                    <Pill text="Ran" color={Green500} />
                  )}
                  <span className="block text-xs text-gray-500">
                    {OneUptimeDate.fromNow(
                      OneUptimeDate.fromString(check.lastRunAt),
                    )}
                  </span>
                  {check.lastRunMessage ? (
                    <span className="block whitespace-pre-line text-xs text-red-600">
                      {check.lastRunMessage}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: { alertCondition: true },
            title: "Alert",
            type: FieldType.Element,
            getExportValue: (check: DataCheck): string => {
              return check.alertCondition || "";
            },
            getElement: (check: DataCheck): ReactElement => {
              if (!check.alertCondition) {
                return (
                  <span className="text-sm text-gray-500">
                    {translator.translateText("No alert")}
                  </span>
                );
              }

              const text: string = doesAlertConditionNeedThreshold(
                check.alertCondition,
              )
                ? `${check.alertCondition} ${check.alertThreshold ?? ""}`
                : check.alertCondition;

              return check.monitorId ? (
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.MONITOR_VIEW] as Route,
                    { modelId: check.monitorId },
                  )}
                  className="text-sm text-gray-900 hover:underline"
                >
                  <span>{text}</span>
                </AppLink>
              ) : (
                <span className="text-sm text-gray-700">{text}</span>
              );
            },
          },
        ]}
      />
    </>
  );
};

export default DataCheckTable;
