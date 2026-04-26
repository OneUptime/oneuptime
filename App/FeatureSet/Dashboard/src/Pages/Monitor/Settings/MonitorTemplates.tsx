import ProjectUtil from "Common/UI/Utils/Project";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Label from "Common/Models/DatabaseModels/Label";
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import MonitorTypeUtil from "../../../Utils/MonitorType";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import MonitorStepsForm from "../../../Components/Form/Monitor/MonitorSteps";
import MonitorStepsType from "Common/Types/Monitor/MonitorSteps";
import MonitoringInterval from "../../../Utils/MonitorIntervalDropdownOptions";
import {
  CustomElementProps,
  FormFieldStyleType,
} from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const MonitorTemplates: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<MonitorTemplate>
        modelType={MonitorTemplate}
        id="monitor-templates-table"
        userPreferencesKey="monitor-templates-table"
        name="Settings > Monitor Templates"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        cardProps={{
          title: "Monitor Templates",
          description:
            "Save reusable monitor configurations and create new monitors from them in one click.",
        }}
        noItemsMessage={"No monitor templates found."}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        showViewIdButton={true}
        formSteps={[
          {
            title: "Template Info",
            id: "template-info",
          },
          {
            title: "Monitor Defaults",
            id: "monitor-defaults",
          },
          {
            title: "Criteria",
            id: "criteria",
            showIf: (values: FormValues<MonitorTemplate>) => {
              return values.monitorType !== MonitorType.Manual;
            },
          },
          {
            title: "Interval",
            id: "monitoring-interval",
            showIf: (values: FormValues<MonitorTemplate>) => {
              return MonitorTypeHelper.doesMonitorTypeHaveInterval(
                values.monitorType as MonitorType,
              );
            },
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        formFields={[
          {
            field: {
              templateName: true,
            },
            title: "Template Name",
            fieldType: FormFieldSchemaType.Text,
            stepId: "template-info",
            required: true,
            placeholder: "Production API Health",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              templateDescription: true,
            },
            title: "Template Description",
            fieldType: FormFieldSchemaType.LongText,
            stepId: "template-info",
            required: true,
            placeholder: "What is this template for?",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              monitorName: true,
            },
            title: "Default Monitor Name",
            description:
              "Default name applied to monitors created from this template. Users can override on creation.",
            fieldType: FormFieldSchemaType.Text,
            stepId: "monitor-defaults",
            required: true,
            placeholder: "Monitor Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              monitorDescription: true,
            },
            title: "Default Monitor Description",
            fieldType: FormFieldSchemaType.LongText,
            stepId: "monitor-defaults",
            required: false,
            placeholder: "Description",
          },
          {
            field: {
              monitorType: true,
            },
            title: "Monitor Type",
            description: "What kind of monitor will this template produce?",
            stepId: "monitor-defaults",
            fieldType: FormFieldSchemaType.CardSelect,
            required: true,
            cardSelectOptions:
              MonitorTypeUtil.monitorTypesAsCategorizedCardSelectOptions(),
          },
          {
            field: {
              monitorSteps: true,
            },
            stepId: "criteria",
            styleType: FormFieldStyleType.Heading,
            title: "Monitor Details",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: true,
            customValidation: (values: FormValues<MonitorTemplate>) => {
              return MonitorStepsType.getValidationError(
                values.monitorSteps as MonitorStepsType,
                values.monitorType as MonitorType,
              );
            },
            getCustomElement: (
              value: FormValues<MonitorTemplate>,
              fieldProps: CustomElementProps,
            ) => {
              return (
                <MonitorStepsForm
                  {...fieldProps}
                  monitorType={value.monitorType || MonitorType.Manual}
                  monitorName={value.monitorName || ""}
                />
              );
            },
          },
          {
            field: {
              monitoringInterval: true,
            },
            stepId: "monitoring-interval",
            title: "Monitoring Interval",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            fetchDropdownOptions: (item: FormValues<MonitorTemplate>) => {
              let interval: Array<DropdownOption> = [...MonitoringInterval];

              if (
                item &&
                (item.monitorType === MonitorType.SyntheticMonitor ||
                  item.monitorType === MonitorType.CustomJavaScriptCode ||
                  item.monitorType === MonitorType.SSLCertificate)
              ) {
                interval = interval.filter((option: DropdownOption) => {
                  return (
                    option.value !== "* * * * *" &&
                    option.value !== "*/2 * * * *"
                  );
                });
              }

              return Promise.resolve(interval);
            },
            placeholder: "Select Monitoring Interval",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels",
            stepId: "labels",
            description:
              "Default labels applied to monitors created from this template.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        filters={[
          {
            field: {
              templateName: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              templateDescription: true,
            },
            title: "Description",
            type: FieldType.LongText,
          },
        ]}
        columns={[
          {
            field: {
              templateName: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              templateDescription: true,
            },
            title: "Description",
            type: FieldType.LongText,
          },
          {
            field: {
              monitorType: true,
            },
            title: "Monitor Type",
            type: FieldType.Text,
          },
        ]}
      />
    </Fragment>
  );
};

export default MonitorTemplates;
