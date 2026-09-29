import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import IconProp from "Common/Types/Icon/IconProp";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import Navigation from "Common/UI/Utils/Navigation";
import LogDropFilter from "Common/Models/DatabaseModels/LogDropFilter";
import FilterQueryBuilder from "../../../Components/FilterQueryBuilder/FilterQueryBuilder";
import LogFilterConfig from "../../../Components/FilterQueryBuilder/LogFilterConfig";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import LogDropFilterAction from "Common/Types/Log/LogDropFilterAction";
import {
  isSamplePercentageConfigured,
  MAX_SAMPLE_PERCENTAGE,
  MIN_SAMPLE_PERCENTAGE,
  resolveSamplePercentage,
} from "Common/Types/Telemetry/DropFilterSampling";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const LogDropFilterView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      {/* Section 1: Basic Details */}
      <CardModelDetail<LogDropFilter>
        name="Log Drop Filter Details"
        cardProps={{
          title: "Drop Filter Details",
          description: "Basic information about this drop filter.",
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Filter Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Describe what this filter does.",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        modelDetailProps={{
          modelType: LogDropFilter,
          id: "model-detail-log-drop-filter",
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
            {
              field: {
                isEnabled: true,
              },
              title: "Status",
              fieldType: FieldType.Boolean,
              getElement: (item: LogDropFilter): ReactElement => {
                if (item.isEnabled) {
                  return (
                    <Pill color={Green} text="Enabled" icon={IconProp.Check} />
                  );
                }
                return (
                  <Pill color={Red} text="Disabled" icon={IconProp.Close} />
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />

      {/* Section 2: Action Configuration */}
      <CardModelDetail<LogDropFilter>
        name="Drop Filter Action"
        cardProps={{
          title: "Action",
          description:
            "Choose whether to drop all matching logs or keep a sample.",
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              action: true,
            },
            title: "Action",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            dropdownOptions: [
              {
                label: "Drop — Discard all matching logs",
                value: "drop",
              },
              {
                label: "Sample — Keep a percentage of matching logs",
                value: "sample",
              },
            ],
          },
          {
            field: {
              samplePercentage: true,
            },
            title: "Sample Percentage",
            fieldType: FormFieldSchemaType.Number,
            /*
             * Required only while the Sample action is selected. Saving a
             * sample filter with no percentage used to be allowed, and the
             * engine read the blank as "throw away half".
             */
            required: (values: FormValues<LogDropFilter>): boolean => {
              return values.action === LogDropFilterAction.Sample;
            },
            validation: {
              minValue: MIN_SAMPLE_PERCENTAGE,
              maxValue: MAX_SAMPLE_PERCENTAGE,
            },
            description:
              "Required when Action is Sample. Percentage of matching logs to keep, between 1 and 99 (e.g. 10 = keep 10%, discard 90%).",
            placeholder: "e.g. 10",
          },
        ]}
        modelDetailProps={{
          modelType: LogDropFilter,
          id: "model-detail-log-drop-filter-action",
          fields: [
            {
              field: {
                action: true,
              },
              title: "Action",
              getElement: (item: LogDropFilter): ReactElement => {
                if (item.action === "drop") {
                  return (
                    <div className="flex items-center gap-3">
                      <Pill color={Red} text="Drop" icon={IconProp.Trash} />
                      <span className="text-sm text-gray-500">
                        All matching logs are permanently discarded
                      </span>
                    </div>
                  );
                }
                if (item.action === "sample") {
                  return (
                    <div className="flex items-center gap-3">
                      <Pill
                        color={Yellow}
                        text="Sample"
                        icon={IconProp.Filter}
                      />
                      <span className="text-sm text-gray-500">
                        Only a percentage of matching logs are kept
                      </span>
                    </div>
                  );
                }
                return (
                  <span className="text-sm text-gray-400">Not configured</span>
                );
              },
            },
            {
              field: {
                samplePercentage: true,
              },
              title: "Sample Percentage",
              showIf: (item: LogDropFilter): boolean => {
                return item.action === "sample";
              },
              getElement: (item: LogDropFilter): ReactElement => {
                /*
                 * `|| 0` used to render an unset percentage as "0% kept /
                 * 100% discarded" while the engine actually kept half — the
                 * display and the behaviour disagreed, and both were wrong.
                 * Show what the engine will really do instead.
                 */
                if (!isSamplePercentageConfigured(item.samplePercentage)) {
                  return (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-400">
                        Not configured
                      </span>
                      <span className="text-sm text-gray-500">
                        — no logs are being sampled away. Set a percentage
                        between {MIN_SAMPLE_PERCENTAGE} and{" "}
                        {MAX_SAMPLE_PERCENTAGE} to start sampling.
                      </span>
                    </div>
                  );
                }

                const pct: number = resolveSamplePercentage(
                  item.samplePercentage,
                );
                const discardPct: number = 100 - pct;

                return (
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold text-gray-900">
                        {pct}%
                      </span>
                      <span className="text-sm text-gray-500">kept</span>
                    </div>
                    <div className="text-gray-300">•</div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold text-gray-400">
                        {discardPct}%
                      </span>
                      <span className="text-sm text-gray-500">discarded</span>
                    </div>
                    <div className="flex-1 max-w-xs">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-green-500 h-2 rounded-full"
                          style={{ width: `${pct}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />

      {/*
       * Section 2b: Drop activity.
       *
       * A drop filter used to discard logs with no record anywhere, so
       * "is this filter the reason my logs are missing?" could not be
       * answered from the product at all. These two counters are written by
       * the ingest path and are the first place to look.
       */}
      <CardModelDetail<LogDropFilter>
        name="Drop Filter Activity"
        cardProps={{
          title: "Activity",
          description:
            "How much this filter has actually discarded. Updated by the ingest pipeline within a minute of a drop.",
        }}
        isEditable={false}
        formFields={[]}
        modelDetailProps={{
          modelType: LogDropFilter,
          id: "model-detail-log-drop-filter-activity",
          fields: [
            {
              field: {
                droppedCount: true,
              },
              title: "Logs Dropped",
              getElement: (item: LogDropFilter): ReactElement => {
                const dropped: number = item.droppedCount || 0;

                if (dropped === 0) {
                  return (
                    <span className="text-sm text-gray-400">
                      This filter has never matched a log.
                    </span>
                  );
                }

                return (
                  <span className="text-lg font-semibold text-gray-900">
                    {dropped.toLocaleString()}
                  </span>
                );
              },
            },
            {
              field: {
                lastDroppedAt: true,
              },
              title: "Last Dropped",
              fieldType: FieldType.DateTime,
              placeholder: "Never",
            },
          ],
          modelId: modelId,
        }}
      />

      {/* Section 3: Filter Conditions (Visual Builder) */}
      <FilterQueryBuilder
        modelType={LogDropFilter}
        modelId={modelId}
        config={LogFilterConfig}
        title="Filter Conditions"
        description="Define which logs this drop filter applies to. Matching logs will be dropped or sampled based on the action above."
      />

      {/* Section 4: Delete Filter */}
      <ModelDelete
        modelType={LogDropFilter}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.LOGS_SETTINGS_DROP_FILTERS] as Route,
              { modelId },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default LogDropFilterView;
