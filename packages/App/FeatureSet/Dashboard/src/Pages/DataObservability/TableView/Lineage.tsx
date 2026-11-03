import PageComponentProps from "../../PageComponentProps";
import AppLink from "../../../Components/AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { getRunStatePill } from "../Pipelines";
import { useTableViewContext } from "./TableViewContext";
import DataAssetLineage from "Common/Models/DatabaseModels/DataAssetLineage";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Column from "Common/UI/Components/ModelTable/Column";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

function tableLink(
  id: ObjectID | undefined,
  key: string | undefined,
): ReactElement {
  if (!id) {
    return <span className="text-sm text-gray-500">-</span>;
  }

  return (
    <AppLink
      to={RouteUtil.populateRouteParams(
        RouteMap[PageMap.DATA_OBSERVABILITY_TABLE_VIEW] as Route,
        { modelId: id },
      )}
      className="font-medium text-gray-900 hover:underline"
    >
      <span>{key || ""}</span>
    </AppLink>
  );
}

/*
 * Where the table's data comes from and where it goes, from the pipelines
 * that read and write it (OpenLineage): the tables it is built from - or
 * the pipeline that writes it from data OneUptime does not watch - each
 * with how that pipeline's latest run went, so a stale table points at the
 * run that should have written it; and the tables built from it.
 */
const TableLineagePage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { dataAssetId } = useTableViewContext();

  const pipelineColumn: Column<DataAssetLineage> = {
    field: {
      dataPipeline: {
        jobName: true,
        lastRunState: true,
        lastRunStartedAt: true,
        lastErrorMessage: true,
      },
    },
    title: "Pipeline",
    type: FieldType.Element,
    disableSort: true,
    getElement: (edge: DataAssetLineage): ReactElement => {
      if (!edge.dataPipeline) {
        return <span className="text-sm text-gray-500">-</span>;
      }

      return (
        <div className="min-w-0 space-y-1">
          <span className="block truncate text-sm text-gray-900">
            {edge.dataPipeline.jobName}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {getRunStatePill(edge.dataPipeline.lastRunState)}
            {edge.dataPipeline.lastRunStartedAt ? (
              <span className="text-xs text-gray-500">
                {OneUptimeDate.fromNow(
                  OneUptimeDate.fromString(edge.dataPipeline.lastRunStartedAt),
                )}
              </span>
            ) : (
              <></>
            )}
          </div>
          {edge.dataPipeline.lastRunState === "FAIL" &&
          edge.dataPipeline.lastErrorMessage ? (
            <span className="block max-w-md truncate text-xs text-red-600">
              {edge.dataPipeline.lastErrorMessage}
            </span>
          ) : (
            <></>
          )}
        </div>
      );
    },
  };

  const lastSeenColumn: Column<DataAssetLineage> = {
    field: { lastSeenAt: true },
    title: "Last Seen",
    type: FieldType.Element,
    getElement: (edge: DataAssetLineage): ReactElement => {
      return (
        <span className="whitespace-nowrap text-sm text-gray-700">
          {edge.lastSeenAt
            ? OneUptimeDate.fromNow(OneUptimeDate.fromString(edge.lastSeenAt))
            : "-"}
        </span>
      );
    },
  };

  return (
    <div className="space-y-5">
      <ModelTable<DataAssetLineage>
        modelType={DataAssetLineage}
        id="data-observability-table-upstream"
        name="Data Observability > Table > Built From"
        userPreferencesKey="data-observability-table-upstream"
        query={{ downstreamDataAssetId: dataAssetId }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        sortBy="lastSeenAt"
        sortOrder={SortOrder.Descending}
        showRefreshButton={true}
        cardProps={{
          title: "Built From",
          description:
            "The tables this table is built from, and the pipelines that write it, with how each pipeline's latest run went.",
        }}
        noItemsMessage="No pipeline has been seen writing this table. Pipelines that send OpenLineage events show here once a run writes it."
        selectMoreFields={{ upstreamDataAssetId: true }}
        filters={[]}
        columns={[
          {
            field: { upstreamDataAsset: { assetKey: true } },
            title: "From",
            type: FieldType.Element,
            disableSort: true,
            getElement: (edge: DataAssetLineage): ReactElement => {
              return edge.upstreamDataAssetId ? (
                tableLink(
                  edge.upstreamDataAssetId,
                  edge.upstreamDataAsset?.assetKey,
                )
              ) : (
                <span className="text-sm text-gray-500">
                  {translator.translateText("Data OneUptime does not watch")}
                </span>
              );
            },
          },
          pipelineColumn,
          lastSeenColumn,
        ]}
      />
      <ModelTable<DataAssetLineage>
        modelType={DataAssetLineage}
        id="data-observability-table-downstream"
        name="Data Observability > Table > Feeds"
        userPreferencesKey="data-observability-table-downstream"
        query={{ upstreamDataAssetId: dataAssetId }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        sortBy="lastSeenAt"
        sortOrder={SortOrder.Descending}
        showRefreshButton={true}
        cardProps={{
          title: "Feeds",
          description:
            "The tables built from this one: what goes stale or wrong when it does.",
        }}
        noItemsMessage="No table has been seen built from this one."
        selectMoreFields={{ downstreamDataAssetId: true }}
        filters={[]}
        columns={[
          {
            field: { downstreamDataAsset: { assetKey: true } },
            title: "Table",
            type: FieldType.Element,
            disableSort: true,
            getElement: (edge: DataAssetLineage): ReactElement => {
              return tableLink(
                edge.downstreamDataAssetId,
                edge.downstreamDataAsset?.assetKey,
              );
            },
          },
          pipelineColumn,
          lastSeenColumn,
        ]}
      />
    </div>
  );
};

export default TableLineagePage;
