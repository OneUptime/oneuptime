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
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import { BILLING_ENABLED } from "Common/UI/Config";
import TelemetryUsageOverview from "Common/UI/Components/TelemetryUsage/TelemetryUsageOverview";
import { formatTelemetryUsageExceptionsPart } from "Common/UI/Components/TelemetryUsage/TelemetryUsageWords";
import {
  fetchProjectTelemetryUsage,
  getTelemetryUsageResourceRoute,
} from "../../Components/TelemetryUsage/ProjectTelemetryUsage";
import ModelTableColumn from "Common/UI/Components/ModelTable/Column";
import TelemetryIngestionBudgetStatusCard from "Common/UI/Components/TelemetryIngestionBudget/TelemetryIngestionBudgetStatusCard";
import { fetchProjectTelemetryIngestionBudgetStatus } from "../../Components/TelemetryIngestionBudget/ProjectTelemetryIngestionBudget";

export type ComponentProps = PageComponentProps;

/*
 * Project Settings > Telemetry & APM > Usage: how much telemetry the project
 * sends, on every install - with billing on, and where it is off and usage
 * is counted at no cost (TelemetryUsageBillingService). It was Billing and
 * Invoices > Usage History, the one place usage was shown, and only where
 * billing was on; this page is that page, at the same address.
 *
 * The overview first - each day by signal, each resource with the
 * retention it is kept for - then the daily rows themselves. What usage
 * cost is shown only where billing is on, to whoever reads billing: the
 * overview's server leaves it out otherwise, and the rows' Total Cost
 * column is drawn only with billing on, and only for whoever may read it
 * (ModelTable leaves out a column its reader may not read).
 */
const Settings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <Fragment>
      {/*
       * Today's ingestion budgets, first: they are counted as telemetry
       * arrives, while the usage below is counted once a day has ended.
       * Nothing at all on a project with no budget, which is most of them.
       */}
      <TelemetryIngestionBudgetStatusCard
        fetchStatus={fetchProjectTelemetryIngestionBudgetStatus}
        hideWhenUnbudgeted={true}
      />

      <TelemetryUsageOverview
        projectId={ProjectUtil.getCurrentProjectId()!.toString()}
        fetchUsage={fetchProjectTelemetryUsage}
        getResourceRoute={getTelemetryUsageResourceRoute}
      />

      <ModelTable<TelemetryUsageBilling>
        modelType={TelemetryUsageBilling}
        id="usage-history-table"
        userPreferencesKey="usage-history-table"
        saveFilterProps={{
          tableId: "settings-usage-history-table",
        }}
        isDeleteable={false}
        name="Settings > Telemetry > Usage"
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        cardProps={{
          title: "Telemetry Usage History",
          description: BILLING_ENABLED
            ? "How much telemetry each service sent each day, how long it is kept and what it cost. Except for session replays, telemetry kept for fewer than 7 days is billed as 7 days. The pricing page has the rates."
            : "How much telemetry each service sent each day, and how long it is kept.",
        }}
        noItemsMessage={
          "No usage yet. Each day's usage shows up after the day ends."
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
              return (
                option.value !== ProductType.ActiveMonitoring &&
                option.value !== ProductType.WatchedTables
              );
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
          /*
           * Data Ingested is drawn once, after the service that sent it: the
           * table drew the same column twice, before and after Service.
           */
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
                [ServiceType.Host]: translationKey("Host telemetry"),
                [ServiceType.DockerHost]: translationKey(
                  "Docker host telemetry",
                ),
                [ServiceType.PodmanHost]: translationKey(
                  "Podman host telemetry",
                ),
                [ServiceType.KubernetesCluster]: translationKey(
                  "Kubernetes telemetry",
                ),
                [ServiceType.DatabaseServer]:
                  translationKey("Database telemetry"),
              };
              const label: string | undefined = primaryEntityType
                ? typeLabels[primaryEntityType]
                : undefined;
              if (label) {
                return (
                  <div className="text-gray-700">
                    {translator.translateText(label)}
                  </div>
                );
              }

              return <div className="text-gray-400">—</div>;
            },
          },
          /*
           * What the row is billed for. A Traces row is billed for its spans
           * and its exceptions together, so it says, under that, how much
           * of it the exceptions were - the overview above shows them apart
           * (issue #6356). A row counted before then says nothing more.
           */
          {
            field: {
              dataIngestedInGB: true,
              exceptionDataIngestedInGB: true,
            },
            title: "Data Ingested (in GB)",
            type: FieldType.Text,
            getElement: (item: TelemetryUsageBilling) => {
              const exceptionDataIngestedInGB: number = Number(
                (item["exceptionDataIngestedInGB"] as Decimal | undefined)
                  ?.value || 0,
              );

              return (
                <div>
                  <div>{`${DiskSize.convertToDecimalPlaces(
                    (item["dataIngestedInGB"] as Decimal).value as number,
                  )} GB`}</div>
                  {item["productType"] === ProductType.Traces &&
                  exceptionDataIngestedInGB > 0 ? (
                    <div
                      className="text-xs text-gray-500"
                      data-testid="usage-history-exceptions-part"
                    >
                      {formatTelemetryUsageExceptionsPart(
                        exceptionDataIngestedInGB,
                        translator,
                      )}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
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
                <div>
                  {translator.translatePlural(
                    { one: "{{count}} Day", other: "{{count}} Days" },
                    Number(item["retainTelemetryDataForDays"] || 0),
                  )}
                </div>
              );
            },
          },
          // What it cost: only where billing is on, and for whoever reads billing.
          ...(BILLING_ENABLED
            ? [
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
                } as ModelTableColumn<TelemetryUsageBilling>,
              ]
            : []),
        ]}
      />
    </Fragment>
  );
};

export default Settings;
