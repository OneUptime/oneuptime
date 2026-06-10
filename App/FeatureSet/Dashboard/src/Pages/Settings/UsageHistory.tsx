import ServiceElement from "../../Components/Service/ServiceElement";
import ProjectUtil from "Common/UI/Utils/Project";
import TelemetryServiceUtil from "Common/UI/Utils/TelemetryService";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import PageComponentProps from "../PageComponentProps";
import Currency from "Common/Types/Currency";
import Decimal from "Common/Types/Decimal";
import DiskSize from "Common/Types/DiskSize";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Service from "Common/Models/DatabaseModels/Service";
import TelemetryUsageBilling from "Common/Models/DatabaseModels/TelemetryUsageBilling";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

export type ComponentProps = PageComponentProps;

const Settings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<TelemetryUsageBilling>
        modelType={TelemetryUsageBilling}
        id="usage-history-table"
        userPreferencesKey="usage-history-table"
        saveFilterProps={{
          tableId: "settings-usage-history-table",
        }}
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
          "No usage history found. Maybe you have not used Telemetry features yet or you're checking this before the end of the day. Please wait until the end of the day for usage to show up."
        }
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
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
              service: true,
            },
            title: "Service",
            type: FieldType.Entity,
            filterEntityType: Service,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
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
              service: {
                name: true,
                _id: true,
                serviceColor: true,
              },
              primaryEntityId: true,
              primaryEntityType: true,
            },
            title: "Service",
            type: FieldType.Element,
            getElement: (item: TelemetryUsageBilling) => {
              const service: Service | undefined = item["service"] as
                | Service
                | undefined;
              if (service) {
                return <ServiceElement service={service} />;
              }

              const primaryEntityType: ServiceType | undefined = item[
                "primaryEntityType"
              ] as ServiceType | undefined;

              /*
               * Non-Service telemetry (unattributed / Host / Docker /
               * Kubernetes) has no Service row, so the relation resolves to
               * null. Render a label from the primaryEntityType discriminator
               * instead of crashing on the null relation.
               */
              const projectId: ObjectID | null =
                ProjectUtil.getCurrentProjectId();
              if (
                projectId &&
                (primaryEntityType === ServiceType.Unknown ||
                  TelemetryServiceUtil.isUnknownServiceId(
                    item.primaryEntityId,
                    projectId,
                  ))
              ) {
                return (
                  <ServiceElement
                    service={TelemetryServiceUtil.getUnknownService(projectId)}
                  />
                );
              }

              const typeLabels: Record<string, string> = {
                [ServiceType.Host]: "Host telemetry",
                [ServiceType.DockerHost]: "Docker host telemetry",
                [ServiceType.KubernetesCluster]: "Kubernetes telemetry",
              };
              const label: string | undefined = primaryEntityType
                ? typeLabels[primaryEntityType]
                : undefined;
              if (label) {
                return <div className="text-gray-700">{label}</div>;
              }

              return <div className="text-gray-400">—</div>;
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
