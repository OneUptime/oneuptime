import PageComponentProps from "../PageComponentProps";
import DataObservabilityApi from "../../Components/DataObservability/DataObservabilityApi";
import DataAsset from "Common/Models/DatabaseModels/DataAsset";
import DataReconciliation from "Common/Models/DatabaseModels/DataReconciliation";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500, Green500, Red500, Yellow500 } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import {
  DATA_CHECK_INTERVALS_IN_MINUTES,
  DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES,
} from "Common/Types/DataObservability/DataCheckType";
import {
  DATA_RECONCILIATION_MEASURES,
  DataReconciliationMeasure,
  DataReconciliationStatus,
  DataReconciliationToleranceType,
  doesMeasureNeedColumn,
} from "Common/Types/DataObservability/DataReconciliation";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { errorInSentence } from "Common/UI/Utils/ErrorInSentence";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";

/*
 * Every reconciliation: one measure of two tables - rows, a column's sum or
 * distinct values, or a query's number - in one database or two, with how
 * far apart they may be. Each side is read by a check of its own, made and
 * kept by the reconciliation (DataReconciliationSync) as the person who
 * saves it, and the two are compared once read together; drifting beyond
 * the tolerance alerts. Saving one, made or edited, brings its checks and
 * monitor in step; Run Now reads both at their databases' next collections.
 */

type FormSide = "source" | "target";

/*
 * The line under a reconciliation's name - "Row Count against Row Count,
 * within 0.5%" - small and grey, wrapping between its words: a table's cell
 * keeps its words on one line (whitespace-nowrap) unless told otherwise.
 */
export const RECONCILIATION_MEASURES_LINE_CLASS_NAME: string =
  "block whitespace-normal break-words text-xs text-gray-500";

const MEASURE_OPTIONS: Array<DropdownOption> = DATA_RECONCILIATION_MEASURES.map(
  (measure: DataReconciliationMeasure): DropdownOption => {
    return { value: measure, label: measure };
  },
);

const TOLERANCE_OPTIONS: Array<DropdownOption> = [
  { value: DataReconciliationToleranceType.Percent, label: "Percent" },
  { value: DataReconciliationToleranceType.Absolute, label: "Absolute" },
];

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

function getStatusPill(status: string | undefined): ReactElement {
  switch (status) {
    case DataReconciliationStatus.InStep:
      return <Pill text="In Step" color={Green500} />;
    case DataReconciliationStatus.Drifted:
      return <Pill text="Drifted" color={Red500} />;
    case DataReconciliationStatus.Failed:
      return <Pill text="Failed" color={Yellow500} />;
    default:
      return <Pill text="Waiting" color={Gray500} />;
  }
}

const DataObservabilityReconciliationsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const [syncError, setSyncError] = useState<string>("");

  const syncReconciliation: (
    item: DataReconciliation,
  ) => Promise<DataReconciliation> = async (
    item: DataReconciliation,
  ): Promise<DataReconciliation> => {
    setSyncError("");

    if (item.id) {
      try {
        await DataObservabilityApi.syncReconciliation(item.id);
      } catch (err) {
        setSyncError(
          translator.translateTemplate(
            "The reconciliation is saved, but its checks and monitor could not be set up: {{reason}}",
            { reason: errorInSentence((err as Error).message) },
          ),
        );
      }
    }

    return item;
  };

  const formatNumber: (value: number | undefined | null) => string = (
    value: number | undefined | null,
  ): string => {
    return value === undefined || value === null
      ? "-"
      : translator.formatNumber(Number(value));
  };

  const sideFields: (
    side: FormSide,
  ) => Array<ModelField<DataReconciliation>> = (
    side: FormSide,
  ): Array<ModelField<DataReconciliation>> => {
    const isSource: boolean = side === "source";
    const measureOf: (values: FormValues<DataReconciliation>) => unknown = (
      values: FormValues<DataReconciliation>,
    ): unknown => {
      return isSource ? values.sourceMeasure : values.targetMeasure;
    };

    return [
      {
        field: isSource ? { sourceDataAsset: true } : { targetDataAsset: true },
        stepId: side,
        title: "Table",
        description: isSource
          ? "The table to compare from: the system of record, usually."
          : "The table to compare with: its copy in another database, a warehouse or a replica.",
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownModal: {
          type: DataAsset,
          labelField: "assetKey",
          valueField: "_id",
          sort: { assetKey: SortOrder.Ascending },
          query: { isDropped: false },
        },
        required: true,
        placeholder: "Select a table",
      },
      {
        field: isSource ? { sourceMeasure: true } : { targetMeasure: true },
        stepId: side,
        title: "Measure",
        description:
          "What is measured of the table: its rows, a column's sum or distinct values, or a number your own query returns.",
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: MEASURE_OPTIONS,
        defaultValue: DataReconciliationMeasure.RowCount,
        required: true,
      },
      {
        field: isSource
          ? { sourceColumnName: true }
          : { targetColumnName: true },
        stepId: side,
        title: "Column",
        description: "The column whose values are added up or counted.",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        placeholder: "amount",
        showIf: (values: FormValues<DataReconciliation>): boolean => {
          return doesMeasureNeedColumn(
            measureOf(values) as DataReconciliationMeasure,
          );
        },
      },
      {
        field: isSource ? { sourceCustomSql: true } : { targetCustomSql: true },
        stepId: side,
        title: "Custom SQL",
        description:
          "A read-only query of the table's database that returns one number, named value. It runs in a read-only transaction with a timeout.",
        fieldType: FormFieldSchemaType.LongText,
        required: false,
        placeholder:
          "SELECT COUNT(*) AS value FROM orders WHERE created_at < now() - interval '1 hour'",
        showIf: (values: FormValues<DataReconciliation>): boolean => {
          return measureOf(values) === DataReconciliationMeasure.CustomSql;
        },
      },
    ];
  };

  return (
    <div className="space-y-3">
      {syncError ? (
        <p className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-800">
          {syncError}
        </p>
      ) : (
        <></>
      )}
      <ModelTable<DataReconciliation>
        modelType={DataReconciliation}
        id="data-observability-reconciliations"
        name="Data Observability > Reconciliations"
        userPreferencesKey="data-observability-reconciliations"
        query={{ ...(projectId ? { projectId: projectId } : {}) }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        createVerb="Create"
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        showRefreshButton={true}
        searchableFields={["name"]}
        cardProps={{
          title: "Reconciliations",
          description:
            "Two copies of the same data, kept honest: one measure of two tables, in one database or two, compared once both are read, with an alert when they drift beyond the tolerance.",
        }}
        noItemsMessage="No reconciliation yet. Create one to compare a table with its copy, such as orders in the app's database and the warehouse, and hear when they drift."
        formSteps={[
          { title: "Reconciliation", id: "reconciliation" },
          { title: "Source", id: "source" },
          { title: "Target", id: "target" },
        ]}
        formFields={[
          {
            field: { name: true },
            stepId: "reconciliation",
            title: "Name",
            description: "Shown on the reconciliation's alert.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Orders: app vs warehouse",
          },
          {
            field: { description: true },
            stepId: "reconciliation",
            title: "Description",
            description:
              "Why the two must agree, and what to do when they do not.",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
          },
          {
            field: { toleranceType: true },
            stepId: "reconciliation",
            title: "Tolerance Type",
            description:
              "Percent compares the difference with the source's value; Absolute with an amount.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: TOLERANCE_OPTIONS,
            defaultValue: DataReconciliationToleranceType.Percent,
            required: true,
          },
          {
            field: { tolerance: true },
            stepId: "reconciliation",
            title: "Tolerance",
            description:
              "How far apart the two may be before they have drifted: 0 means they must agree exactly.",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "0.5",
          },
          {
            field: { intervalInMinutes: true },
            stepId: "reconciliation",
            title: "Compare",
            description:
              "How often both sides are read and compared, with their databases' collections.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: getIntervalOptions(translator),
            defaultValue: DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES,
            required: true,
          },
          ...sideFields("source"),
          ...sideFields("target"),
        ]}
        onCreateSuccess={syncReconciliation}
        actionButtons={[
          {
            title: "Run Now",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Play,
            onClick: async (
              item: DataReconciliation,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                await DataObservabilityApi.runReconciliationNow(item.id!);
                onCompleteAction();
              } catch (err) {
                onError(err as Error);
              }
            },
          },
        ]}
        selectMoreFields={{
          description: true,
          statusMessage: true,
          toleranceType: true,
          tolerance: true,
          sourceMeasure: true,
          targetMeasure: true,
        }}
        filters={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { status: true },
            title: "Status",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Reconciliation",
            type: FieldType.Element,
            getExportValue: (item: DataReconciliation): string => {
              return item.name || "";
            },
            // The page's words beside the name: only the name reads its own way.
            getLineText: drawsItsOwnLines,
            getElement: (item: DataReconciliation): ReactElement => {
              return (
                <div className="min-w-0">
                  <IsolatedLine
                    as="span"
                    text={item.name || ""}
                    className="block truncate font-medium text-gray-900"
                  />
                  {/*
                   * What is compared, wrapping under the name: cut short at
                   * the column's 20rem, the measures in German ("Anzahl
                   * eindeutiger Werte gegen Anzahl eindeutiger...") left no
                   * room for the tolerance, and held the column at its cap.
                   */}
                  <span className={RECONCILIATION_MEASURES_LINE_CLASS_NAME}>
                    {translator.translateTemplate(
                      "{{source}} against {{target}}, within {{tolerance}}",
                      {
                        /*
                         * Each measure by its name, as the Measure dropdown
                         * draws it in the reader's language (#7223).
                         */
                        source: translatableTerm(item.sourceMeasure || ""),
                        target: translatableTerm(item.targetMeasure || ""),
                        tolerance:
                          item.toleranceType ===
                          DataReconciliationToleranceType.Percent
                            ? `${formatNumber(item.tolerance)}%`
                            : formatNumber(item.tolerance),
                      },
                    )}
                  </span>
                </div>
              );
            },
          },
          {
            field: { sourceDataAsset: { assetKey: true } },
            title: "Source",
            type: FieldType.Element,
            disableSort: true,
            getElement: (item: DataReconciliation): ReactElement => {
              return (
                <div className="min-w-0">
                  <span className="block truncate text-sm text-gray-900">
                    {item.sourceDataAsset?.assetKey || "-"}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {formatNumber(item.sourceValue)}
                  </span>
                </div>
              );
            },
          },
          {
            field: { targetDataAsset: { assetKey: true } },
            title: "Target",
            type: FieldType.Element,
            disableSort: true,
            getElement: (item: DataReconciliation): ReactElement => {
              return (
                <div className="min-w-0">
                  <span className="block truncate text-sm text-gray-900">
                    {item.targetDataAsset?.assetKey || "-"}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {formatNumber(item.targetValue)}
                  </span>
                </div>
              );
            },
          },
          {
            field: { difference: true },
            title: "Difference",
            type: FieldType.Element,
            getElement: (item: DataReconciliation): ReactElement => {
              return item.difference === undefined ||
                item.difference === null ? (
                <span className="text-sm text-gray-500">-</span>
              ) : (
                <div className="text-sm text-gray-700">
                  <span className="block">{formatNumber(item.difference)}</span>
                  <span className="block text-xs text-gray-500">
                    {`${formatNumber(
                      Math.round(Number(item.differencePercent || 0) * 100) /
                        100,
                    )}%`}
                  </span>
                </div>
              );
            },
          },
          {
            field: { status: true },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: DataReconciliation): ReactElement => {
              return (
                <div className="min-w-0 space-y-1">
                  {getStatusPill(item.status)}
                  {item.statusMessage ? (
                    <span className="block max-w-xs truncate text-xs text-gray-500">
                      {item.statusMessage}
                    </span>
                  ) : item.comparedAt ? (
                    <span className="block text-xs text-gray-500">
                      {OneUptimeDate.fromNow(
                        OneUptimeDate.fromString(item.comparedAt),
                      )}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
        ]}
      />
    </div>
  );
};

export default DataObservabilityReconciliationsPage;
