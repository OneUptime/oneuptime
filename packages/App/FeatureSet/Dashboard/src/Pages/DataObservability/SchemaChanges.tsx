import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataAssetFeed, {
  DataAssetFeedEventType,
} from "Common/Models/DatabaseModels/DataAssetFeed";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

const SCHEMA_EVENTS: Array<DataAssetFeedEventType> = [
  DataAssetFeedEventType.ColumnAdded,
  DataAssetFeedEventType.ColumnRemoved,
  DataAssetFeedEventType.ColumnRenamed,
  DataAssetFeedEventType.ColumnTypeChanged,
  DataAssetFeedEventType.ColumnNullabilityChanged,
  DataAssetFeedEventType.AssetDropped,
  DataAssetFeedEventType.AssetRestored,
];

// The Change filter's words, keys of the Dashboard's locales.
const EVENT_LABELS: Record<string, string> = {
  [DataAssetFeedEventType.ColumnAdded]: translationKey("Column added"),
  [DataAssetFeedEventType.ColumnRemoved]: translationKey("Column removed"),
  [DataAssetFeedEventType.ColumnRenamed]: translationKey("Column renamed"),
  [DataAssetFeedEventType.ColumnTypeChanged]: translationKey("Type changed"),
  [DataAssetFeedEventType.ColumnNullabilityChanged]: translationKey(
    "Nullability changed",
  ),
  [DataAssetFeedEventType.AssetDropped]: translationKey("Table dropped"),
  [DataAssetFeedEventType.AssetRestored]: translationKey("Table restored"),
};

const EVENT_OPTIONS: Array<DropdownOption> = SCHEMA_EVENTS.map(
  (event: DataAssetFeedEventType): DropdownOption => {
    return { value: event, label: EVENT_LABELS[event] || event };
  },
);

/*
 * Every schema change across the connected databases, newest first: the
 * column that came, went, was renamed or retyped, and the tables dropped
 * and restored - each linked to its table. The first place to look when a
 * report breaks after a deploy.
 */
const DataObservabilitySchemaChangesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  return (
    <ModelTable<DataAssetFeed>
      modelType={DataAssetFeed}
      id="data-observability-schema-changes"
      name="Data Observability > Schema Changes"
      userPreferencesKey="data-observability-schema-changes"
      query={{
        ...(projectId ? { projectId: projectId } : {}),
        dataAssetFeedEventType: new Includes(SCHEMA_EVENTS),
      }}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      sortBy="postedAt"
      sortOrder={SortOrder.Descending}
      showRefreshButton={true}
      cardProps={{
        title: "Schema Changes",
        description:
          "Every column added, removed, renamed or retyped, and every table dropped or restored, newest first.",
      }}
      noItemsMessage="No schema changes yet. They show here as soon as a collection sees one."
      selectMoreFields={{ dataAssetId: true }}
      filters={[
        {
          field: { dataAssetFeedEventType: true },
          title: "Change",
          type: FieldType.Dropdown,
          filterDropdownOptions: EVENT_OPTIONS,
        },
        {
          field: { postedAt: true },
          title: "When",
          type: FieldType.Date,
        },
      ]}
      columns={[
        {
          field: { postedAt: true },
          title: "When",
          type: FieldType.Element,
          getExportValue: (item: DataAssetFeed): string => {
            return item.postedAt
              ? OneUptimeDate.fromString(item.postedAt).toISOString()
              : "";
          },
          getElement: (item: DataAssetFeed): ReactElement => {
            return (
              <span className="whitespace-nowrap text-sm text-gray-700">
                {item.postedAt
                  ? OneUptimeDate.fromNow(
                      OneUptimeDate.fromString(item.postedAt),
                    )
                  : "-"}
              </span>
            );
          },
        },
        {
          field: { dataAsset: { assetKey: true, dataStoreName: true } },
          title: "Table",
          type: FieldType.Element,
          disableSort: true,
          getExportValue: (item: DataAssetFeed): string => {
            return item.dataAsset?.assetKey || "";
          },
          getElement: (item: DataAssetFeed): ReactElement => {
            if (!item.dataAssetId) {
              return <span>-</span>;
            }

            return (
              <div className="min-w-0">
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.DATA_OBSERVABILITY_TABLE_VIEW] as Route,
                    { modelId: item.dataAssetId },
                  )}
                  className="block truncate font-medium text-gray-900 hover:underline"
                >
                  <span>{item.dataAsset?.assetKey || ""}</span>
                </AppLink>
                <span className="block truncate text-xs text-gray-500">
                  {item.dataAsset?.dataStoreName || ""}
                </span>
              </div>
            );
          },
        },
        {
          field: { feedInfoInMarkdown: true },
          title: "Change",
          type: FieldType.Element,
          disableSort: true,
          wrapContent: true,
          getExportValue: (item: DataAssetFeed): string => {
            return item.feedInfoInMarkdown || "";
          },
          getElement: (item: DataAssetFeed): ReactElement => {
            return (
              <div className="text-sm text-gray-700">
                <MarkdownViewer text={item.feedInfoInMarkdown || ""} />
              </div>
            );
          },
        },
      ]}
    />
  );
};

export default DataObservabilitySchemaChangesPage;
