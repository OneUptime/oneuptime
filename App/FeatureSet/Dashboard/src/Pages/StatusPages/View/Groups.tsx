import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import StatusPageGroupViewMode from "Common/Types/StatusPage/StatusPageGroupViewMode";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ProjectUtil from "Common/UI/Utils/Project";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import AxisValuesInput from "../../../Components/StatusPage/AxisValuesInput";

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<StatusPageGroup>
        modelType={StatusPageGroup}
        id="status-page-group"
        name="Status Page > Groups"
        userPreferencesKey="status-page-group-table"
        saveFilterProps={{
          tableId: "status-page-groups-table",
        }}
        isDeleteable={true}
        sortBy="order"
        showViewIdButton={true}
        sortOrder={SortOrder.Ascending}
        isCreateable={true}
        isViewable={false}
        isEditable={true}
        query={{
          statusPageId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        enableDragAndDrop={true}
        dragDropIndexField="order"
        onBeforeCreate={(item: StatusPageGroup): Promise<StatusPageGroup> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.statusPageId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Resource Groups",
          description:
            "Here are different groups for your status page resources.",
        }}
        noItemsMessage={"No status page group created for this status page."}
        formSteps={[
          {
            title: "Group Details",
            id: "group-details",
          },
          {
            title: "Layout",
            id: "layout",
          },
          {
            title: "Advanced",
            id: "advanced",
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Group Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Resource Group Name",
            stepId: "group-details",
          },
          {
            field: {
              description: true,
            },
            title: "Group Description",
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
            stepId: "group-details",
            description: MarkdownUtil.getMarkdownCheatsheet(
              "Describe the status page group here",
            ),
          },
          {
            field: {
              isExpandedByDefault: true,
            },
            title: "Expand on Status Page by Default",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            stepId: "group-details",
          },
          {
            field: {
              viewMode: true,
            },
            title: "View Mode",
            description:
              "How resources in this group are laid out on the public status page. 'List' is the classic vertical list. 'Grid' renders resources as a matrix using row and column axes.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              StatusPageGroupViewMode,
            ),
            required: false,
            defaultValue: StatusPageGroupViewMode.List,
            stepId: "layout",
          },
          {
            field: {
              rowAxisLabel: true,
            },
            title: "Row Axis Label",
            description:
              "Heading shown on the row axis (e.g. 'Service', 'Tenant'). Use any dimension that makes sense for your status page.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Service",
            showIf: (item: FormValues<StatusPageGroup>): boolean => {
              return item.viewMode === StatusPageGroupViewMode.Grid;
            },
            stepId: "layout",
          },
          {
            field: {
              rowAxisValues: true,
            },
            title: "Row Axis Values",
            description:
              "One label per row, in the order you want them displayed. Each resource in this group is then assigned to one of these rows.",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            showIf: (item: FormValues<StatusPageGroup>): boolean => {
              return item.viewMode === StatusPageGroupViewMode.Grid;
            },
            stepId: "layout",
            getCustomElement: (
              _values: FormValues<StatusPageGroup>,
              fieldProps: CustomElementProps,
            ): ReactElement => {
              return (
                <AxisValuesInput
                  initialValue={fieldProps.initialValue}
                  onChange={fieldProps.onChange}
                  onBlur={fieldProps.onBlur}
                  placeholder="e.g. Auth"
                  addButtonLabel="Add Row"
                  error={fieldProps.error}
                />
              );
            },
          },
          {
            field: {
              columnAxisLabel: true,
            },
            title: "Column Axis Label",
            description:
              "Heading shown on the column axis (e.g. 'Region', 'Environment'). Use any dimension that makes sense for your status page.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Region",
            showIf: (item: FormValues<StatusPageGroup>): boolean => {
              return item.viewMode === StatusPageGroupViewMode.Grid;
            },
            stepId: "layout",
          },
          {
            field: {
              columnAxisValues: true,
            },
            title: "Column Axis Values",
            description:
              "One label per column, in the order you want them displayed. Each resource in this group is then assigned to one of these columns.",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            showIf: (item: FormValues<StatusPageGroup>): boolean => {
              return item.viewMode === StatusPageGroupViewMode.Grid;
            },
            stepId: "layout",
            getCustomElement: (
              _values: FormValues<StatusPageGroup>,
              fieldProps: CustomElementProps,
            ): ReactElement => {
              return (
                <AxisValuesInput
                  initialValue={fieldProps.initialValue}
                  onChange={fieldProps.onChange}
                  onBlur={fieldProps.onBlur}
                  placeholder="e.g. US-East"
                  addButtonLabel="Add Column"
                  error={fieldProps.error}
                />
              );
            },
          },
          {
            field: {
              showCurrentStatus: true,
            },
            title: "Show Current Group Status",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: true,
            description:
              "Current Status will be shown beside this group on your status page.",
            stepId: "advanced",
          },
          {
            field: {
              showUptimePercent: true,
            },
            title: "Show Uptime %",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: false,
            description:
              "Show uptime percentage beside this group on your status page. The number of days is configured in Status Page Settings.",
            stepId: "advanced",
          },
          {
            field: {
              uptimePercentPrecision: true,
            },
            stepId: "advanced",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(UptimePrecision),
            showIf: (item: FormValues<StatusPageGroup>): boolean => {
              return Boolean(item.showUptimePercent);
            },
            title: "Select Uptime Precision",
            defaultValue: UptimePrecision.ONE_DECIMAL,
            required: true,
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Resource Group Name",
            type: FieldType.Text,
          },
          {
            field: {
              isExpandedByDefault: true,
            },
            title: "Expanded on Status Page by Default",
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Resource Group Name",
            type: FieldType.Text,
          },
          {
            field: {
              isExpandedByDefault: true,
            },
            title: "Expanded on Status Page by Default",
            type: FieldType.Boolean,
            hideOnMobile: true,
          },
        ]}
      />
    </Fragment>
  );
};

export default StatusPageDelete;
