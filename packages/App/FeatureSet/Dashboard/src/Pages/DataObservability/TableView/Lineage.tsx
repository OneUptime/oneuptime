import PageComponentProps from "../../PageComponentProps";
import AppLink from "../../../Components/AppLink/AppLink";
import TableDashboards from "../../../Components/DataObservability/TableDashboards";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { getRunStatePill } from "../Pipelines";
import { useTableViewContext } from "./TableViewContext";
import DataAssetLineage from "Common/Models/DatabaseModels/DataAssetLineage";
import DataAssetLineageSource from "Common/Types/DataObservability/DataAssetLineageSource";
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
 * Where the table's data comes from and where it goes: the tables it is
 * built from - or the pipeline that writes it from data OneUptime does not
 * watch - and the tables built from it. Each edge says where it was seen:
 * a pipeline's run (OpenLineage, dbt), with how its latest run went, so a
 * stale table points at the run that should have written it; the
 * database's query history, with a login whose queries moved the data; or
 * a view's definition.
 */
const TableLineagePage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { dataAssetId } = useTableViewContext();

  const seenInColumn: Column<DataAssetLineage> = {
    field: {
      dataPipeline: {
        jobName: true,
        lastRunState: true,
        lastRunStartedAt: true,
        lastErrorMessage: true,
      },
    },
    title: "Seen In",
    type: FieldType.Element,
    disableSort: true,
    getElement: (edge: DataAssetLineage): ReactElement => {
      if (edge.source === DataAssetLineageSource.QueryHistory) {
        return (
          <div className="min-w-0 space-y-1">
            <span className="block text-sm text-gray-900">
              {translator.translateText("Query history")}
            </span>
            {edge.seenBy ? (
              <span className="block max-w-md truncate text-xs text-gray-500">
                {edge.seenBy}
              </span>
            ) : (
              <></>
            )}
          </div>
        );
      }

      if (edge.source === DataAssetLineageSource.ViewDefinition) {
        return (
          <span className="text-sm text-gray-900">
            {translator.translateText("View definition")}
          </span>
        );
      }

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
      <TableDashboards dataAssetId={dataAssetId} />
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
            "The tables this table is built from, and the pipelines that write it: seen in a pipeline's run, with how its latest run went, in the database's query history, or in a view's definition.",
        }}
        noItemsMessage="Nothing has been seen feeding this table yet. Lineage comes from OpenLineage events, dbt artifacts, BigQuery and Redshift query history, and views."
        selectMoreFields={{
          upstreamDataAssetId: true,
          source: true,
          seenBy: true,
        }}
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
          seenInColumn,
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
        selectMoreFields={{
          downstreamDataAssetId: true,
          source: true,
          seenBy: true,
        }}
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
          seenInColumn,
          lastSeenColumn,
        ]}
      />
    </div>
  );
};

export default TableLineagePage;
