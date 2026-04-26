import LabelsElement from "Common/UI/Components/Label/Labels";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import MonitorStepsType from "Common/Types/Monitor/MonitorSteps";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import MonitorTypeUtil from "../../../Utils/MonitorType";
import MonitorStepsForm from "../../../Components/Form/Monitor/MonitorSteps";
import MonitorStepsViewer from "../../../Components/Monitor/MonitorSteps/MonitorSteps";
import MonitoringInterval from "../../../Utils/MonitorIntervalDropdownOptions";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import {
  CustomElementProps,
  FormFieldStyleType,
} from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const MonitorTemplatesView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      <CardModelDetail<MonitorTemplate>
        name="Monitor Template Details"
        cardProps={{
          title: "Monitor Template Details",
          description: "Here are the details for this monitor template.",
          buttons: [
            {
              title: "Create Monitor from Template",
              icon: IconProp.Add,
              buttonStyle: ButtonStyleType.PRIMARY,
              onClick: () => {
                const createRoute: Route = RouteUtil.populateRouteParams(
                  RouteMap[PageMap.MONITOR_CREATE] as Route,
                );
                Navigation.navigate(
                  createRoute.addQueryParams({
                    monitorTemplateId: modelId.toString(),
                  }),
                );
              },
            },
          ],
        }}
        createEditModalWidth={ModalWidth.Large}
        isEditable={true}
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
              "Default name applied to monitors created from this template.",
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
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: MonitorTemplate,
          id: "model-detail-monitor-template",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Monitor Template ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                templateName: true,
              },
              title: "Template Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                templateDescription: true,
              },
              title: "Template Description",
              fieldType: FieldType.LongText,
            },
            {
              field: {
                monitorName: true,
              },
              title: "Default Monitor Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                monitorType: true,
              },
              title: "Monitor Type",
              fieldType: FieldType.Text,
            },
            {
              field: {
                monitoringInterval: true,
              },
              title: "Monitoring Interval",
              fieldType: FieldType.Text,
            },
            {
              field: {
                monitorSteps: true,
              },
              title: "Criteria",
              fieldType: FieldType.Element,
              getElement: (item: MonitorTemplate): ReactElement => {
                if (!item.monitorSteps) {
                  return <p>No criteria configured.</p>;
                }
                return (
                  <MonitorStepsViewer
                    monitorSteps={item.monitorSteps as MonitorStepsType}
                    monitorType={item.monitorType as MonitorType}
                  />
                );
              },
            },
            {
              field: {
                createdAt: true,
              },
              title: "Created At",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: MonitorTemplate): ReactElement => {
                return <LabelsElement labels={item.labels || []} />;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <ModelDelete
        modelType={MonitorTemplate}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_SETTINGS_TEMPLATES] as Route,
              { modelId },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default MonitorTemplatesView;
