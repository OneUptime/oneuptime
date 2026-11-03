import PageComponentProps from "../PageComponentProps";
import DataPipeline from "Common/Models/DatabaseModels/DataPipeline";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500, Green500, Red500, Yellow500 } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

// How a run stands, at a glance.
export function getRunStatePill(state: string | undefined): ReactElement {
  switch (state) {
    case "COMPLETE":
      return <Pill text="Complete" color={Green500} />;
    case "FAIL":
      return <Pill text="Failed" color={Red500} />;
    case "ABORT":
      return <Pill text="Aborted" color={Red500} />;
    case "START":
    case "RUNNING":
      return <Pill text="Running" color={Yellow500} />;
    default:
      return <Pill text="No run yet" color={Gray500} />;
  }
}

export function formatRunDuration(
  translator: Translator,
  seconds: number | undefined | null,
): string {
  if (seconds === undefined || seconds === null) {
    return "-";
  }

  if (seconds < 60) {
    return translator.translateTemplate("{{count}}s", { count: seconds });
  }

  if (seconds < 3600) {
    return translator.translateTemplate("{{minutes}}m {{seconds}}s", {
      minutes: Math.floor(seconds / 60),
      seconds: seconds % 60,
    });
  }

  return translator.translateTemplate("{{hours}}h {{minutes}}m", {
    hours: Math.floor(seconds / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
  });
}

/*
 * Every pipeline that sends OpenLineage events - Airflow tasks, Spark jobs,
 * dbt models - with how its latest run went, failing first. A pipeline
 * appears with its first event; see Documentation to send them.
 */
const DataObservabilityPipelinesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  return (
    <ModelTable<DataPipeline>
      modelType={DataPipeline}
      id="data-observability-pipelines"
      name="Data Observability > Pipelines"
      userPreferencesKey="data-observability-pipelines"
      query={{ ...(projectId ? { projectId: projectId } : {}) }}
      isDeleteable={true}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      sortBy="lastRunEndedAt"
      sortOrder={SortOrder.Descending}
      showRefreshButton={true}
      searchableFields={["jobName", "jobNamespace"]}
      cardProps={{
        title: "Pipelines",
        description:
          "Every job that sends OpenLineage events - Airflow, Dagster, Spark, dbt, Flink - and how its latest run went.",
      }}
      noItemsMessage="No pipeline yet. Point your scheduler's OpenLineage integration at OneUptime, as Documentation shows, and each job appears with its first run."
      selectMoreFields={{ lastErrorMessage: true, lastRunEndedAt: true }}
      filters={[
        {
          field: { lastRunState: true },
          title: "Last Run",
          type: FieldType.Text,
        },
        {
          field: { jobNamespace: true },
          title: "Namespace",
          type: FieldType.Text,
        },
      ]}
      columns={[
        {
          field: { jobName: true },
          title: "Pipeline",
          type: FieldType.Element,
          getExportValue: (pipeline: DataPipeline): string => {
            return pipeline.pipelineKey || pipeline.jobName || "";
          },
          getElement: (pipeline: DataPipeline): ReactElement => {
            return (
              <div className="min-w-0">
                <span className="block truncate font-medium text-gray-900">
                  {pipeline.jobName}
                </span>
                <span className="block truncate text-xs text-gray-500">
                  {pipeline.jobNamespace}
                </span>
              </div>
            );
          },
        },
        {
          field: { lastRunState: true },
          title: "Last Run",
          type: FieldType.Element,
          getExportValue: (pipeline: DataPipeline): string => {
            return pipeline.lastRunState || "";
          },
          getElement: (pipeline: DataPipeline): ReactElement => {
            return (
              <div className="min-w-0 space-y-1">
                {getRunStatePill(pipeline.lastRunState)}
                {pipeline.lastRunStartedAt ? (
                  <span className="block text-xs text-gray-500">
                    {OneUptimeDate.fromNow(
                      OneUptimeDate.fromString(pipeline.lastRunStartedAt),
                    )}
                  </span>
                ) : (
                  <></>
                )}
                {pipeline.lastRunState === "FAIL" &&
                pipeline.lastErrorMessage ? (
                  <span className="block max-w-md truncate text-xs text-red-600">
                    {pipeline.lastErrorMessage}
                  </span>
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
        {
          field: { lastRunDurationInSeconds: true },
          title: "Duration",
          type: FieldType.Element,
          getExportValue: (pipeline: DataPipeline): string => {
            return String(pipeline.lastRunDurationInSeconds ?? "");
          },
          getElement: (pipeline: DataPipeline): ReactElement => {
            return (
              <span className="whitespace-nowrap text-sm text-gray-700">
                {formatRunDuration(
                  translator,
                  pipeline.lastRunDurationInSeconds,
                )}
              </span>
            );
          },
        },
        {
          field: { lastSuccessAt: true },
          title: "Last Success",
          type: FieldType.Element,
          getExportValue: (pipeline: DataPipeline): string => {
            return pipeline.lastSuccessAt
              ? OneUptimeDate.fromString(pipeline.lastSuccessAt).toISOString()
              : "";
          },
          getElement: (pipeline: DataPipeline): ReactElement => {
            return (
              <span className="whitespace-nowrap text-sm text-gray-700">
                {pipeline.lastSuccessAt
                  ? OneUptimeDate.fromNow(
                      OneUptimeDate.fromString(pipeline.lastSuccessAt),
                    )
                  : "-"}
              </span>
            );
          },
        },
        {
          field: { runCount: true },
          title: "Runs",
          type: FieldType.Element,
          getExportValue: (pipeline: DataPipeline): string => {
            return String(pipeline.runCount ?? 0);
          },
          getElement: (pipeline: DataPipeline): ReactElement => {
            return (
              <span className="text-sm text-gray-700">
                {translator.formatNumber(pipeline.runCount || 0)}
              </span>
            );
          },
        },
      ]}
    />
  );
};

export default DataObservabilityPipelinesPage;
