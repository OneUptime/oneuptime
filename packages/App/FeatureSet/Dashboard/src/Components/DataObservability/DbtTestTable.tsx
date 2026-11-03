import DataObservabilityApi from "./DataObservabilityApi";
import DataCheck from "Common/Models/DatabaseModels/DataCheck";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500, Green500, Red500, Yellow500 } from "Common/Types/BrandColors";
import {
  DataCheckAlertCondition,
  DataCheckType,
} from "Common/Types/DataObservability/DataCheckType";
import OneUptimeDate from "Common/Types/Date";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // One table's tests; every table's when not given.
  dataAssetId?: ObjectID | undefined;
}

// How a test's last run went, as dbt reported it.
export function getDbtTestResultPill(status: string | undefined): ReactElement {
  switch (status) {
    case "Passed":
      return <Pill text="Passed" color={Green500} />;
    case "Warned":
      return <Pill text="Warned" color={Yellow500} />;
    case "Failed":
      return <Pill text="Failed" color={Red500} />;
    case "Errored":
      return <Pill text="Errored" color={Red500} />;
    default:
      return <Pill text="Not run yet" color={Gray500} />;
  }
}

/*
 * The project's dbt tests on its watched tables, read from each upload of
 * its artifacts: how each last ran and how many rows it found failing. dbt
 * runs them, so they are not edited here: each is turned off or on, and set
 * to alert when it fails - one click, an alert like any check's.
 */
const DbtTestTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const isForOneTable: boolean = Boolean(props.dataAssetId);

  const setAlert: (data: {
    item: DataCheck;
    isOn: boolean;
    onCompleteAction: VoidFunction;
    onError: ErrorFunction;
  }) => Promise<void> = async (data: {
    item: DataCheck;
    isOn: boolean;
    onCompleteAction: VoidFunction;
    onError: ErrorFunction;
  }): Promise<void> => {
    try {
      await ModelAPI.updateById<DataCheck>({
        modelType: DataCheck,
        id: data.item.id!,
        data: data.isOn
          ? { alertCondition: DataCheckAlertCondition.Above, alertThreshold: 0 }
          : { alertCondition: null, alertThreshold: null },
      });
      await DataObservabilityApi.syncCheckAlert(data.item.id!);
      data.onCompleteAction();
    } catch (err) {
      data.onError(err as Error);
    }
  };

  return (
    <ModelTable<DataCheck>
      modelType={DataCheck}
      rowSwitch={{ column: "isEnabled" }}
      id={
        isForOneTable
          ? "data-observability-table-dbt-tests"
          : "data-observability-dbt-tests"
      }
      name={
        isForOneTable
          ? "Data Observability > Table > dbt Tests"
          : "Data Observability > dbt Tests"
      }
      userPreferencesKey={
        isForOneTable
          ? "data-observability-table-dbt-tests"
          : "data-observability-dbt-tests"
      }
      query={{
        ...(projectId ? { projectId: projectId } : {}),
        ...(props.dataAssetId ? { dataAssetId: props.dataAssetId } : {}),
        checkType: DataCheckType.DbtTest,
      }}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      sortBy="lastRunStatus"
      sortOrder={SortOrder.Ascending}
      showRefreshButton={true}
      searchableFields={["name"]}
      cardProps={{
        title: "dbt Tests",
        description: isForOneTable
          ? "The tests your dbt project runs on this table, from its uploaded artifacts: how each last ran, and the rows it found failing."
          : "Every test your dbt projects run on your tables, from their uploaded artifacts, failing first.",
      }}
      noItemsMessage={
        isForOneTable
          ? "No dbt test on this table. Upload your dbt project's artifacts after a build, as Documentation shows, and its tests appear here."
          : "No dbt test yet. Upload your dbt project's artifacts after a build, as Documentation shows."
      }
      selectMoreFields={{
        description: true,
        lastRunMessage: true,
        alertCondition: true,
        monitorId: true,
      }}
      filters={[
        {
          field: { name: true },
          title: "Test",
          type: FieldType.Text,
        },
        {
          field: { lastRunStatus: true },
          title: "Last Result",
          type: FieldType.Text,
        },
      ]}
      actionButtons={[
        {
          title: "Alert on Failures",
          buttonStyleType: ButtonStyleType.NORMAL,
          icon: IconProp.Bell,
          isVisible: (item: DataCheck): boolean => {
            return !item.alertCondition;
          },
          onClick: async (
            item: DataCheck,
            onCompleteAction: VoidFunction,
            onError: ErrorFunction,
          ) => {
            await setAlert({ item, isOn: true, onCompleteAction, onError });
          },
        },
        {
          title: "Stop Alerting",
          buttonStyleType: ButtonStyleType.NORMAL,
          icon: IconProp.BellSlash,
          isVisible: (item: DataCheck): boolean => {
            return Boolean(item.alertCondition);
          },
          onClick: async (
            item: DataCheck,
            onCompleteAction: VoidFunction,
            onError: ErrorFunction,
          ) => {
            await setAlert({ item, isOn: false, onCompleteAction, onError });
          },
        },
      ]}
      columns={[
        {
          field: { name: true },
          title: "Test",
          type: FieldType.Element,
          getExportValue: (check: DataCheck): string => {
            return check.name || "";
          },
          getElement: (check: DataCheck): ReactElement => {
            return (
              <div className="min-w-0">
                <span className="block truncate font-medium text-gray-900">
                  {check.name}
                </span>
                {check.description ? (
                  <span className="block max-w-md truncate text-xs text-gray-500">
                    {check.description}
                  </span>
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
        {
          field: { lastRunStatus: true },
          title: "Last Result",
          type: FieldType.Element,
          getExportValue: (check: DataCheck): string => {
            return check.lastRunStatus || "";
          },
          getElement: (check: DataCheck): ReactElement => {
            return (
              <div className="min-w-0 space-y-1">
                {getDbtTestResultPill(check.lastRunStatus)}
                {check.lastRunStatus !== "Passed" && check.lastRunMessage ? (
                  <span className="block max-w-md whitespace-pre-line text-xs text-gray-600">
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
          field: { lastValue: true },
          title: "Failing Rows",
          type: FieldType.Element,
          getExportValue: (check: DataCheck): string => {
            return String(check.lastValue ?? "");
          },
          getElement: (check: DataCheck): ReactElement => {
            return (
              <span
                className={`text-sm ${
                  check.lastValue ? "font-medium text-red-600" : "text-gray-700"
                }`}
              >
                {check.lastValue === undefined || check.lastValue === null
                  ? "-"
                  : translator.formatNumber(check.lastValue)}
              </span>
            );
          },
        },
        {
          field: { lastRunAt: true },
          title: "Last Run",
          type: FieldType.Element,
          getExportValue: (check: DataCheck): string => {
            return check.lastRunAt
              ? OneUptimeDate.fromString(check.lastRunAt).toISOString()
              : "";
          },
          getElement: (check: DataCheck): ReactElement => {
            return (
              <div className="min-w-0">
                <span className="block whitespace-nowrap text-sm text-gray-700">
                  {check.lastRunAt
                    ? OneUptimeDate.fromNow(
                        OneUptimeDate.fromString(check.lastRunAt),
                      )
                    : "-"}
                </span>
                {check.alertCondition ? (
                  <span className="block whitespace-nowrap text-xs text-gray-500">
                    {translator.translateText("Alerts on failures")}
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
  );
};

export default DbtTestTable;
