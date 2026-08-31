import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
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
import { VoidFunction } from "Common/Types/FunctionTypes";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const MonitorTemplates: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<MonitorTemplate>
        modelType={MonitorTemplate}
        enableJsonImportExport={true}
        id="monitor-templates-table"
        userPreferencesKey="monitor-templates-table"
        saveFilterProps={{
          tableId: "monitor-templates-table",
        }}
        name="Settings > Monitor Templates"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Monitor Templates",
          description:
            "Save reusable monitor configurations and create new monitors from them in one click.",
        }}
        actionButtons={[
          {
            title: "Create Monitor",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Add,
            onClick: async (
              item: MonitorTemplate,
              onCompleteAction: VoidFunction,
            ) => {
              const createRoute: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.MONITOR_CREATE] as Route,
              );
              Navigation.navigate(
                createRoute.addQueryParams({
                  monitorTemplateId: item._id?.toString() || "",
                }),
              );
              onCompleteAction();
            },
          },
        ]}
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
            /*
             * Optional since issue #3486. A Network Device auto-import rule
             * names what it provisions "<device> - <this>", so a required
             * field forced the same suffix onto every imported device; blank
             * now means the monitor is named after the device alone.
             *
             * No minLength either: a blank field that accepts nothing shorter
             * than two characters rejects a one-character name while
             * accepting no name at all.
             */
            description:
              "Default name applied to monitors created from this template. Leave it blank to name each monitor after the resource it watches.",
            fieldType: FormFieldSchemaType.Text,
            stepId: "monitor-defaults",
            required: false,
            placeholder: "Monitor Name",
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
            cardSelectSearchable: true,
            cardSelectSearchPlaceholder:
              "Search monitor types - try ping, ssl, k8s, postgres",
            cardSelectCollapsibleGroups: true,
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
              /*
               * The template's OWN name stands in when the default monitor
               * name is blank (issue #3486). This string is interpolated into
               * the seeded criteria and incident titles - "Check if {name} is
               * online" - and those strings are persisted into the template's
               * monitorSteps and inherited by every monitor made from it, so
               * an empty one would bake "Check if  is online" in permanently.
               */
              return (
                <MonitorStepsForm
                  {...fieldProps}
                  monitorType={value.monitorType || MonitorType.Manual}
                  monitorName={
                    value.monitorName?.trim() ||
                    value.templateName?.trim() ||
                    ""
                  }
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
        searchableFields={[
          "templateName",
          "templateDescription",
          "monitorName",
        ]}
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
