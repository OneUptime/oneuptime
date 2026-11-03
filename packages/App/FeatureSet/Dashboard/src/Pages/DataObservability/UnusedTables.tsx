import PageComponentProps from "../PageComponentProps";
import {
  formatLastRead,
  formatRowCount,
  formatSize,
} from "../../Components/DataObservability/DataObservabilityFormat";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataAsset from "Common/Models/DatabaseModels/DataAsset";
import Route from "Common/Types/API/Route";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  getUnusedCutoff,
  UNUSED_AFTER_DAYS,
} from "Common/Types/DataObservability/DataAssetReads";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

/*
 * The tables nobody has read for 90 days, biggest first: what they hold,
 * when they were last read - or since when they have had no read at all -
 * and whether something still writes them, which is work and storage spent
 * on data nobody uses. Read from the engines' own read counters and the
 * services' database spans (DataAssetReads).
 */
const DataObservabilityUnusedTablesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const cutoff: Date = useMemo((): Date => {
    return getUnusedCutoff(OneUptimeDate.getCurrentDate());
  }, []);

  return (
    <ModelTable<DataAsset>
      modelType={DataAsset}
      id="data-observability-unused-tables"
      name="Data Observability > Unused Tables"
      userPreferencesKey="data-observability-unused-tables"
      query={{
        ...(projectId ? { projectId: projectId } : {}),
        isDropped: false,
        unreadSince: new LessThanOrEqual<Date>(cutoff),
      }}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={true}
      viewButtonText="View"
      onViewPage={(item: DataAsset): Promise<Route> => {
        return Promise.resolve(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.DATA_OBSERVABILITY_TABLE_VIEW] as Route,
            { modelId: item.id! },
          ),
        );
      }}
      sortBy="sizeInBytes"
      sortOrder={SortOrder.Descending}
      showRefreshButton={true}
      searchableFields={["assetKey", "dataStoreName"]}
      cardProps={{
        title: "Unused Tables",
        description: translator.translateTemplate(
          "Tables nobody has read for {{days}} days, biggest first: candidates to archive or drop. A table still being written costs its writes and storage too.",
          { days: UNUSED_AFTER_DAYS },
        ),
      }}
      noItemsMessage={translator.translateTemplate(
        "Every table has been read in the last {{days}} days, or its reads cannot be counted yet.",
        { days: UNUSED_AFTER_DAYS },
      )}
      selectMoreFields={{
        dataStoreName: true,
        unreadSince: true,
      }}
      filters={[
        {
          field: { dataStoreName: true },
          title: "Database",
          type: FieldType.Text,
        },
        {
          field: { lastChangedAt: true },
          title: "Last Changed",
          type: FieldType.Date,
        },
      ]}
      columns={[
        {
          field: { assetKey: true },
          title: "Table",
          type: FieldType.Element,
          wrapContent: true,
          getExportValue: (asset: DataAsset): string => {
            return asset.assetKey || "";
          },
          getElement: (asset: DataAsset): ReactElement => {
            return (
              <div className="min-w-0">
                <span className="block truncate font-medium text-gray-900">
                  {asset.assetKey}
                </span>
                <span className="block truncate text-xs text-gray-500">
                  {asset.dataStoreName}
                </span>
              </div>
            );
          },
        },
        {
          field: { sizeInBytes: true },
          title: "Size",
          type: FieldType.Element,
          getExportValue: (asset: DataAsset): string => {
            return String(asset.sizeInBytes ?? "");
          },
          getElement: (asset: DataAsset): ReactElement => {
            return (
              <span className="whitespace-nowrap text-sm font-medium text-gray-900">
                {formatSize(asset.sizeInBytes)}
              </span>
            );
          },
        },
        {
          field: { rowCount: true },
          title: "Rows",
          type: FieldType.Element,
          getExportValue: (asset: DataAsset): string => {
            return String(asset.rowCount ?? "");
          },
          getElement: (asset: DataAsset): ReactElement => {
            return (
              <span className="whitespace-nowrap text-sm text-gray-700">
                {formatRowCount(translator, asset.rowCount)}
              </span>
            );
          },
        },
        {
          field: { lastReadAt: true },
          title: "Last Read",
          type: FieldType.Element,
          getExportValue: (asset: DataAsset): string => {
            return asset.lastReadAt
              ? OneUptimeDate.fromString(asset.lastReadAt).toISOString()
              : "";
          },
          getElement: (asset: DataAsset): ReactElement => {
            return (
              <span className="whitespace-nowrap text-sm text-gray-700">
                {formatLastRead(
                  translator,
                  asset.lastReadAt,
                  asset.unreadSince,
                )}
              </span>
            );
          },
        },
        {
          field: { lastChangedAt: true },
          title: "Last Written",
          type: FieldType.Element,
          getExportValue: (asset: DataAsset): string => {
            return asset.lastChangedAt
              ? OneUptimeDate.fromString(asset.lastChangedAt).toISOString()
              : "";
          },
          getElement: (asset: DataAsset): ReactElement => {
            const isStillWritten: boolean = Boolean(
              asset.lastChangedAt &&
                OneUptimeDate.fromString(asset.lastChangedAt) > cutoff,
            );

            return (
              <div className="min-w-0">
                <span className="block whitespace-nowrap text-sm text-gray-700">
                  {asset.lastChangedAt
                    ? OneUptimeDate.fromNow(
                        OneUptimeDate.fromString(asset.lastChangedAt),
                      )
                    : "-"}
                </span>
                {isStillWritten ? (
                  <span className="block whitespace-nowrap text-xs font-medium text-yellow-700">
                    {translator.translateText(
                      "Still written, though nobody reads it",
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
  );
};

export default DataObservabilityUnusedTablesPage;
