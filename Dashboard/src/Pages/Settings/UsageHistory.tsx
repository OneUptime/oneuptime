import TelemetryServiceElement from "../../Components/TelemetryService/TelemetryServiceElement";
import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import Currency from "Common/Types/Currency";
import Decimal from "Common/Types/Decimal";
import DiskSize from "Common/Types/DiskSize";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { DropdownOption } from "CommonUI/src/Components/Dropdown/Dropdown";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import DropdownUtil from "CommonUI/src/Utils/Dropdown";
import TelemetryService from "Model/Models/TelemetryService";
import TelemetryUsageBilling from "Model/Models/TelemetryUsageBilling";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

export interface ComponentProps extends PageComponentProps {}

const Settings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<TelemetryUsageBilling>
        modelType={TelemetryUsageBilling}
        id="usage-history-table"
        isDeleteable={false}
        name="Settings > Billing > Usage History"
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        cardProps={{
          title: "Telemetry Usage History",
          description:
            "Here is the telemetry usage history for this project. Please refer to the pricing page for more details.",
        }}
        noItemsMessage={
          "No usage history found. Maybe you have not used Telemetry features yet?"
        }
        query={{
          projectId: DashboardNavigation.getProjectId()?.toString(),
        }}
        showRefreshButton={true}
        filters={[
          {
            field: {
              productType: true,
            },
            title: "Product",
            type: FieldType.Dropdown,
            filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              ProductType,
            ).filter((option: DropdownOption) => {
              return option.value !== ProductType.ActiveMonitoring;
            }), // Remove Active Monitoring from the dropdown
          },
          {
            field: {
              createdAt: true,
            },
            title: "Day",
            type: FieldType.Date,
          },
          {
            field: {
              telemetryService: true,
            },
            title: "Telemetry Service",
            type: FieldType.Entity,
            filterEntityType: TelemetryService,
            filterQuery: {
              projectId: DashboardNavigation.getProjectId()?.toString(),
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
        ]}
        columns={[
          {
            field: {
              productType: true,
            },
            title: "Product",
            type: FieldType.Text,
          },
          {
            field: {
              createdAt: true,
            },
            title: "Day",
            type: FieldType.Date,
          },
          {
            field: {
              dataIngestedInGB: true,
            },
            title: "Data Ingested (in GB)",
            type: FieldType.Text,
            getElement: (item: TelemetryUsageBilling) => {
              return (
                <div>{`${DiskSize.convertToDecimalPlaces(
                  (item["dataIngestedInGB"] as Decimal).value as number,
                )} GB`}</div>
              );
            },
          },
          {
            field: {
              telemetryService: {
                name: true,
                _id: true,
              },
            },
            title: "Telemetry Service",
            type: FieldType.Element,
            getElement: (item: TelemetryUsageBilling) => {
              return (
                <TelemetryServiceElement
                  telemetryService={
                    item["telemetryService"] as TelemetryService
                  }
                />
              );
            },
          },
          {
            field: {
              retainTelemetryDataForDays: true,
            },
            title: "Data Retention (in Days)",
            type: FieldType.Text,
            getElement: (item: TelemetryUsageBilling) => {
              return (
                <div>{`${item[
                  "retainTelemetryDataForDays"
                ]?.toString()} Days`}</div>
              );
            },
          },
          {
            field: {
              dataIngestedInGB: true,
            },
            title: "Data Ingested (in GB)",
            type: FieldType.Text,
            getElement: (item: TelemetryUsageBilling) => {
              return (
                <div>{`${DiskSize.convertToDecimalPlaces(
                  (item["dataIngestedInGB"] as Decimal).value as number,
                )} GB`}</div>
              );
            },
          },
          {
            field: {
              totalCostInUSD: true,
            },
            title: "Total Cost",
            type: FieldType.Text,
            getElement: (item: TelemetryUsageBilling) => {
              return (
                <div>{`${Currency.convertToDecimalPlaces(
                  (item["totalCostInUSD"] as Decimal).value as number,
                )} USD`}</div>
              );
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default Settings;
