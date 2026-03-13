import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import LogDropFilter from "Common/Models/DatabaseModels/LogDropFilter";
import ProjectUtil from "Common/UI/Utils/Project";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const LogDropFilters: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<LogDropFilter>
        modelType={LogDropFilter}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="log-drop-filters-table"
        name="Settings > Log Drop Filters"
        userPreferencesKey="log-drop-filters-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Log Drop Filters",
          description:
            "Drop filters let you discard or sample logs before they are stored. Matching logs are dropped or sampled at the configured percentage. Filters run in sort order before pipeline processing.",
        }}
        noItemsMessage={"No drop filters found."}
        viewPageRoute={Navigation.getCurrentRoute()}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. Drop Debug Logs",
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
              filterQuery: true,
            },
            title: "Filter Query",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            placeholder:
              "e.g. severityText = 'DEBUG' OR body LIKE '%health%'",
          },
          {
            field: {
              action: true,
            },
            title: "Action",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "drop or sample",
          },
          {
            field: {
              samplePercentage: true,
            },
            title: "Sample Percentage",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "50 (keep this % of matching logs)",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              sortOrder: true,
            },
            title: "Sort Order",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "0",
          },
        ]}
        showRefreshButton={true}
        showViewIdButton={true}
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Name",
          },
          {
            field: {
              action: true,
            },
            type: FieldType.Text,
            title: "Action",
          },
          {
            field: {
              isEnabled: true,
            },
            type: FieldType.Boolean,
            title: "Enabled",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              action: true,
            },
            title: "Action",
            type: FieldType.Text,
          },
          {
            field: {
              samplePercentage: true,
            },
            title: "Sample %",
            type: FieldType.Number,
            noValueMessage: "-",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
          },
          {
            field: {
              sortOrder: true,
            },
            title: "Sort Order",
            type: FieldType.Number,
          },
        ]}
      />
    </Fragment>
  );
};

export default LogDropFilters;
