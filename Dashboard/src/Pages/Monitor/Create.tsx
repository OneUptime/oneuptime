import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import Navigation from "Common/UI/Utils/Navigation";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import MonitorTypeUtil from "../../Utils/MonitorType";
import {
  CustomElementProps,
  FormFieldStyleType,
} from "Common/UI/Components/Forms/Types/Field";
import MonitorSteps from "../../Components/Form/Monitor/MonitorSteps";
import MonitorStepsType from "Common/Types/Monitor/MonitorSteps";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import MonitoringInterval from "../../Utils/MonitorIntervalDropdownOptions";
import Card from "Common/UI/Components/Card/Card";

const MonitorCreate: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <Card
        title="Create New Monitor"
        description={
          "Monitor anything - Websites, API, IPv4, IPv6, or send data inbound and more. Create alerts on any metrics and alert the right team."
        }
        className="mb-10"
      >
        <ModelForm<Monitor>
          modelType={Monitor}
          name="Create New Monitor"
          id="create-monitor-form"
          fields={[
            {
              field: {
                name: true,
              },
              title: "Name",
              stepId: "monitor-info",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "Monitor Name",
              validation: {
                minLength: 2,
              },
            },
            {
              field: {
                description: true,
              },
              stepId: "monitor-info",
              title: "Description",
              fieldType: FormFieldSchemaType.LongText,
              required: false,
              placeholder: "Description",
            },
            {
              field: {
                monitorType: true,
              },
              title: "Monitor Type",
              description: "Select the type of monitor you want to create",
              stepId: "monitor-info",
              fieldType: FormFieldSchemaType.CardSelect,
              required: true,
              cardSelectOptions:
                MonitorTypeUtil.monitorTypesAsCardSelectOptions(),
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
              customValidation: (values: FormValues<Monitor>) => {
                const error: string | null =
                  MonitorStepsType.getValidationError(
                    values.monitorSteps as MonitorStepsType,
                    values.monitorType as MonitorType,
                  );

                return error;
              },
              getCustomElement: (
                value: FormValues<Monitor>,
                props: CustomElementProps,
              ) => {
                return (
                  <MonitorSteps
                    {...props}
                    monitorType={value.monitorType || MonitorType.Manual}
                    monitorName={value.name || ""}
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
              fetchDropdownOptions: (item: FormValues<Monitor>) => {
                let interval: Array<DropdownOption> = [...MonitoringInterval];

                if (
                  item &&
                  (item.monitorType === MonitorType.SyntheticMonitor ||
                    item.monitorType === MonitorType.CustomJavaScriptCode ||
                    item.monitorType === MonitorType.SSLCertificate)
                ) {
                  // remove the every minute option, every 2 mins, every 10 minutes
                  interval = interval.filter((option: DropdownOption) => {
                    return (
                      option.value !== "* * * * *" &&
                      option.value !== "*/2 * * * *"
                    );
                  });

                  return Promise.resolve(interval);
                }

                return Promise.resolve(interval);
              },

              placeholder: "Select Monitoring Interval",
            },
          ]}
          steps={[
            {
              title: "Monitor Info",
              id: "monitor-info",
            },
            {
              title: "Criteria",
              id: "criteria",
              showIf: (values: FormValues<Monitor>) => {
                return values.monitorType !== MonitorType.Manual;
              },
            },
            {
              title: "Interval",
              id: "monitoring-interval",
              showIf: (values: FormValues<Monitor>) => {
                return MonitorTypeHelper.doesMonitorTypeHaveInterval(
                  values.monitorType as MonitorType,
                );
              },
            },
          ]}
          onSuccess={(createdItem: Monitor) => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.MONITOR_VIEW] as Route,
                  {
                    modelId: createdItem._id,
                  },
                ),
              ),
            );
          }}
          submitButtonText={"Create Monitor"}
          formType={FormType.Create}
        />
      </Card>
    </Fragment>
  );
};

export default MonitorCreate;
