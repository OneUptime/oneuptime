import PageComponentProps from "../../PageComponentProps";
import AppLink from "../../../Components/AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import EventStatBar from "../../../Components/EventView/EventStatBar";
import EventStatTile from "../../../Components/EventView/EventStatTile";
import {
  formatRunDuration,
  getPipelineLateness,
  getPipelineSchedulePill,
  getPipelineScheduleText,
  getRunStatePill,
  isLastRunUnusuallyLong,
} from "../../DataObservability/Pipelines";
import DataPipeline from "Common/Models/DatabaseModels/DataPipeline";
import DataPipelineRun from "Common/Models/DatabaseModels/DataPipelineRun";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { DataPipelineLateness } from "Common/Types/DataObservability/DataPipelineSchedule";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useParams } from "react-router-dom";

/*
 * One pipeline at a glance - its latest run, how long a run usually takes,
 * whether its next run is on time, and how many it has run - then every
 * run, newest first: how it went, how long it took, its error, what it wrote.
 */
const PipelineOverviewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { id } = useParams();
  const dataPipelineId: ObjectID = useMemo((): ObjectID => {
    return new ObjectID(id || "");
  }, [id]);
  const [pipeline, setPipeline] = useState<DataPipeline | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    ModelAPI.getItem<DataPipeline>({
      modelType: DataPipeline,
      id: dataPipelineId,
      select: {
        lastRunState: true,
        lastRunStartedAt: true,
        lastRunDurationInSeconds: true,
        lastSuccessAt: true,
        lastErrorMessage: true,
        typicalRunDurationInSeconds: true,
        expectedRunIntervalInSeconds: true,
        runCount: true,
      },
    })
      .then((item: DataPipeline | null): void => {
        if (isCurrent) {
          setPipeline(item);
        }
      })
      .catch((): void => {
        // The tiles stay empty; the runs below read on their own.
      });

    return () => {
      isCurrent = false;
    };
  }, [dataPipelineId]);

  const lateness: DataPipelineLateness | null = pipeline
    ? getPipelineLateness(pipeline)
    : null;

  return (
    <div className="space-y-5">
      <EventStatBar columns={4} ariaLabel="Pipeline health">
        <EventStatTile
          label="Last Run"
          value={
            pipeline?.lastRunStartedAt
              ? OneUptimeDate.fromNow(
                  OneUptimeDate.fromString(pipeline.lastRunStartedAt),
                )
              : "-"
          }
          note={getRunStatePill(pipeline?.lastRunState)}
          icon={IconProp.Play}
        />
        <EventStatTile
          label="Usually Takes"
          value={
            pipeline?.typicalRunDurationInSeconds
              ? formatRunDuration(
                  translator,
                  pipeline.typicalRunDurationInSeconds,
                )
              : translator.translateText("Learning") || "Learning"
          }
          note={
            pipeline &&
            pipeline.lastRunDurationInSeconds !== undefined &&
            pipeline.lastRunDurationInSeconds !== null ? (
              <span
                className={
                  isLastRunUnusuallyLong(pipeline)
                    ? "font-medium text-red-600"
                    : ""
                }
              >
                {translator.translateTemplate("Last run took {{duration}}", {
                  duration: formatRunDuration(
                    translator,
                    pipeline.lastRunDurationInSeconds,
                  ),
                })}
              </span>
            ) : (
              translator.translateText("Learned from five completed runs") ||
              "Learned from five completed runs"
            )
          }
          icon={IconProp.Clock}
        />
        <EventStatTile
          label="Schedule"
          value={
            pipeline && lateness
              ? getPipelineScheduleText(translator, pipeline, lateness)
              : "-"
          }
          note={lateness ? getPipelineSchedulePill(lateness) : undefined}
          icon={IconProp.Calendar}
        />
        <EventStatTile
          label="Runs"
          value={translator.formatNumber(pipeline?.runCount || 0)}
          note={
            pipeline?.lastSuccessAt
              ? translator.translateTemplate("Last succeeded {{time}}", {
                  time: OneUptimeDate.fromNow(
                    OneUptimeDate.fromString(pipeline.lastSuccessAt),
                  ),
                })
              : undefined
          }
          icon={IconProp.Activity}
        />
      </EventStatBar>

      <ModelTable<DataPipelineRun>
        modelType={DataPipelineRun}
        id="data-observability-pipeline-runs"
        name="Data Observability > Pipeline > Runs"
        userPreferencesKey="data-observability-pipeline-runs"
        query={{ dataPipelineId: dataPipelineId }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        sortBy="startedAt"
        sortOrder={SortOrder.Descending}
        showRefreshButton={true}
        cardProps={{
          title: "Runs",
          description:
            "Every run of this pipeline, newest first: how it went, how long it took, and what it wrote.",
        }}
        noItemsMessage="No run yet. Runs appear as the pipeline's events arrive."
        selectMoreFields={{
          errorMessage: true,
          scheduledAt: true,
          attemptNumber: true,
          traceId: true,
        }}
        filters={[
          {
            field: { state: true },
            title: "State",
            type: FieldType.Text,
          },
          {
            field: { startedAt: true },
            title: "Started",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: { state: true },
            title: "State",
            type: FieldType.Element,
            getExportValue: (run: DataPipelineRun): string => {
              return run.state || "";
            },
            getElement: (run: DataPipelineRun): ReactElement => {
              return (
                <div className="min-w-0 space-y-1">
                  {getRunStatePill(run.state)}
                  {run.attemptNumber && run.attemptNumber > 1 ? (
                    <span className="block text-xs text-gray-500">
                      {translator.translateTemplate("Attempt {{attempt}}", {
                        attempt: run.attemptNumber,
                      })}
                    </span>
                  ) : (
                    <></>
                  )}
                  {run.traceId ? (
                    <AppLink
                      className="block text-xs text-indigo-600 hover:underline"
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.TRACE_VIEW] as Route,
                        { modelId: run.traceId },
                      )}
                    >
                      {translator.translateText("Trace and logs") || ""}
                    </AppLink>
                  ) : (
                    <></>
                  )}
                  {run.errorMessage ? (
                    <span className="block max-w-md whitespace-pre-line text-xs text-red-600">
                      {run.errorMessage}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: { startedAt: true },
            title: "Started",
            type: FieldType.Element,
            getExportValue: (run: DataPipelineRun): string => {
              return run.startedAt
                ? OneUptimeDate.fromString(run.startedAt).toISOString()
                : "";
            },
            getElement: (run: DataPipelineRun): ReactElement => {
              return (
                <div className="min-w-0">
                  <span className="block whitespace-nowrap text-sm text-gray-700">
                    {run.startedAt
                      ? OneUptimeDate.fromNow(
                          OneUptimeDate.fromString(run.startedAt),
                        )
                      : "-"}
                  </span>
                  {run.scheduledAt ? (
                    <span className="block whitespace-nowrap text-xs text-gray-500">
                      {translator.translateTemplate("Scheduled for {{time}}", {
                        time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                          OneUptimeDate.fromString(run.scheduledAt),
                        ),
                      })}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: { durationInSeconds: true },
            title: "Duration",
            type: FieldType.Element,
            getExportValue: (run: DataPipelineRun): string => {
              return String(run.durationInSeconds ?? "");
            },
            getElement: (run: DataPipelineRun): ReactElement => {
              return (
                <span className="whitespace-nowrap text-sm text-gray-700">
                  {formatRunDuration(translator, run.durationInSeconds)}
                </span>
              );
            },
          },
          {
            field: { outputs: true },
            title: "Wrote",
            type: FieldType.Element,
            disableSort: true,
            getExportValue: (run: DataPipelineRun): string => {
              return (run.outputs || []).join(", ");
            },
            getElement: (run: DataPipelineRun): ReactElement => {
              const outputs: Array<string> = run.outputs || [];

              return (
                <span className="block max-w-md truncate font-mono text-xs text-gray-700">
                  {outputs.length > 0 ? outputs.join(", ") : "-"}
                </span>
              );
            },
          },
        ]}
      />
    </div>
  );
};

export default PipelineOverviewPage;
