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
import TraceDropFilter from "Common/Models/DatabaseModels/TraceDropFilter";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const TraceDropFilterView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      {/* Section 1: Basic Details */}
      <CardModelDetail<TraceDropFilter>
        name="Trace Drop Filter Details"
        cardProps={{
          title: "Drop Filter Details",
          description: "Basic information about this drop filter.",
        }}
        isEditable={true}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Filter Name",
            validation: { minLength: 2 },
          },
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Describe what this filter does.",
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        modelDetailProps={{
          modelType: TraceDropFilter,
          id: "model-detail-trace-drop-filter",
          fields: [
            { field: { name: true }, title: "Name" },
            { field: { description: true }, title: "Description" },
            {
              field: { isEnabled: true },
              title: "Status",
              fieldType: FieldType.Boolean,
              getElement: (item: TraceDropFilter): ReactElement => {
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
      <CardModelDetail<TraceDropFilter>
        name="Drop Filter Action"
        cardProps={{
          title: "Action",
          description:
            "Choose whether to drop all matching spans or keep a sample.",
        }}
        isEditable={true}
        formFields={[
          {
            field: { action: true },
            title: "Action",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            dropdownOptions: [
              {
                label: "Drop — Discard all matching spans",
                value: "drop",
              },
              {
                label: "Sample — Keep a percentage of matching spans",
                value: "sample",
              },
            ],
          },
          {
            field: { samplePercentage: true },
            title: "Sample Percentage",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            description:
              "Only applies when Action is Sample. Percentage of matching spans to keep (e.g. 10 = keep 10%, discard 90%).",
            placeholder: "e.g. 10",
          },
        ]}
        modelDetailProps={{
          modelType: TraceDropFilter,
          id: "model-detail-trace-drop-filter-action",
          fields: [
            {
              field: { action: true },
              title: "Action",
              getElement: (item: TraceDropFilter): ReactElement => {
                if (item.action === "drop") {
                  return (
                    <div className="flex items-center gap-3">
                      <Pill color={Red} text="Drop" icon={IconProp.Trash} />
                      <span className="text-sm text-gray-500">
                        All matching spans are permanently discarded
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
                        Only a percentage of matching spans are kept
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
              field: { samplePercentage: true },
              title: "Sample Percentage",
              showIf: (item: TraceDropFilter): boolean => {
                return item.action === "sample";
              },
            },
          ],
          modelId: modelId,
        }}
      />

      {/* Section 3: Filter Query */}
      <CardModelDetail<TraceDropFilter>
        name="Trace Drop Filter Query"
        cardProps={{
          title: "Filter Query",
          description:
            "Filter expression that identifies matching spans. Available fields: name, kind, statusCode, serviceId, attributes.<key>. Operators: =, !=, LIKE, IN, AND, OR.",
        }}
        isEditable={true}
        formFields={[
          {
            field: { filterQuery: true },
            title: "Filter Query",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            placeholder:
              "e.g. name LIKE '%healthcheck%' AND kind = 'SPAN_KIND_SERVER'",
          },
        ]}
        modelDetailProps={{
          modelType: TraceDropFilter,
          id: "model-detail-trace-drop-filter-query",
          fields: [
            {
              field: { filterQuery: true },
              title: "Filter Query",
            },
          ],
          modelId: modelId,
        }}
      />

      {/* Section 4: Delete Filter */}
      <ModelDelete
        modelType={TraceDropFilter}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.TRACES_SETTINGS_DROP_FILTERS] as Route,
              { modelId },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default TraceDropFilterView;
