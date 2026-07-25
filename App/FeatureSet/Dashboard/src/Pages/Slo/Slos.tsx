import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Label from "Common/Models/DatabaseModels/Label";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import Color from "Common/Types/Color";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const documentationMarkdown: string = `
### How SLOs and Error Budgets Work

A **Service Level Objective (SLO)** is a reliability target for a service — for example "99.9% uptime over a rolling 30 days". OneUptime measures the **Service Level Indicator (SLI)** from the status timelines of the monitors you attach, and compares it to your target.

- **Error budget** is the amount of downtime your target allows. At 99.9% over 30 days that is about 43 minutes. Every minute of downtime spends budget; when the budget runs out, the SLO is breached.
- **Burn rate** tells you how fast the budget is being spent. A burn rate of 1 spends the budget exactly over the window; a burn rate of 14 exhausts it in about 2 days on a 30-day window.

---

### SLO Status Values

| Status | Description |
|--------|-------------|
| **Healthy** | The SLI is at or above target and enough error budget remains |
| **At Risk** | Remaining error budget dropped below the at-risk threshold |
| **Budget Exhausted** | The error budget is fully spent — the SLO is breached |
| **Misconfigured** | The SLO has no monitors attached, so it cannot be evaluated |
| **Paused** | All attached monitors are paused or disabled |

SLOs are evaluated automatically every few minutes. Attach burn-rate rules on the SLO's page to get alerted before the budget runs out.
`;

type GetStatusPillFunction = (status: SloStatus | undefined) => ReactElement;

const getStatusPill: GetStatusPillFunction = (
  status: SloStatus | undefined,
): ReactElement => {
  let color: Color = Gray500;

  if (status === SloStatus.Healthy) {
    color = Green;
  } else if (status === SloStatus.AtRisk) {
    color = Yellow;
  } else if (status === SloStatus.BudgetExhausted) {
    color = Red;
  }

  return (
    <Pill
      text={status || SloStatus.Healthy}
      color={color}
      size={PillSize.Small}
    />
  );
};

type FormatPercentFunction = (value: number | undefined | null) => string;

const formatPercent: FormatPercentFunction = (
  value: number | undefined | null,
): string => {
  if (value === undefined || value === null) {
    return "—";
  }
  return `${Math.round(value * 1000) / 1000}%`;
};

const Slos: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<ServiceLevelObjective>
        modelType={ServiceLevelObjective}
        id="slos-table"
        userPreferencesKey="slos-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        showRefreshButton={true}
        name="SLOs"
        searchableFields={["name", "description"]}
        cardProps={{
          title: "Service Level Objectives",
          description:
            "Reliability targets measured from monitor uptime. Each SLO tracks its error budget and alerts you before the budget runs out.",
        }}
        helpContent={{
          title: "How SLOs Work",
          description:
            "Understanding SLOs, error budgets, burn rates, and statuses",
          markdown: documentationMarkdown,
        }}
        showViewIdButton={true}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              sloStatus: true,
            },
            title: "Status",
            type: FieldType.Dropdown,
            filterDropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(SloStatus),
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            filterEntityType: Label,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "API Availability",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "99.9% availability for the public API",
          },
          {
            field: {
              monitors: true,
            },
            title: "Monitors",
            description:
              "Monitors whose uptime is measured by this SLO. Time when any of these monitors is down spends error budget.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Select Monitors",
          },
          {
            field: {
              targetPercentage: true,
            },
            title: "Target (%)",
            description:
              "Reliability target as a percentage, e.g. 99.9. Must be less than 100.",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "99.9",
          },
          {
            field: {
              windowDays: true,
            },
            title: "Window (Days)",
            description:
              "Length of the rolling compliance window the SLI is measured over.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: [
              { label: "7 days", value: 7 },
              { label: "28 days", value: 28 },
              { label: "30 days", value: 30 },
              { label: "90 days", value: 90 },
            ],
            required: true,
            placeholder: "30 days",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels",
            description: "Organize and filter SLOs with labels.",
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
              targetPercentage: true,
            },
            title: "Target",
            type: FieldType.Element,
            getElement: (item: ServiceLevelObjective): ReactElement => {
              return (
                <span className="text-sm text-gray-900">
                  {formatPercent(item.targetPercentage)}
                </span>
              );
            },
          },
          {
            field: {
              windowDays: true,
            },
            title: "Window",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: ServiceLevelObjective): ReactElement => {
              if (item.windowType === SloWindowType.CalendarMonth) {
                return (
                  <span className="text-sm text-gray-900">Calendar month</span>
                );
              }
              return (
                <span className="text-sm text-gray-900">
                  {item.windowDays || 30} days rolling
                </span>
              );
            },
          },
          {
            field: {
              currentSliPercentage: true,
            },
            title: "Current SLI",
            type: FieldType.Element,
            getElement: (item: ServiceLevelObjective): ReactElement => {
              const sli: number | undefined | null = item.currentSliPercentage;
              const target: number | undefined | null = item.targetPercentage;

              if (sli === undefined || sli === null) {
                return <span className="text-sm text-gray-400">—</span>;
              }

              const meetsTarget: boolean =
                target === undefined || target === null || sli >= target;

              return (
                <span
                  className={
                    meetsTarget
                      ? "text-sm font-medium text-emerald-700"
                      : "text-sm font-medium text-red-700"
                  }
                >
                  {formatPercent(sli)}
                </span>
              );
            },
          },
          {
            field: {
              errorBudgetRemainingPercentage: true,
            },
            title: "Budget Remaining",
            type: FieldType.Element,
            getElement: (item: ServiceLevelObjective): ReactElement => {
              const remaining: number | undefined | null =
                item.errorBudgetRemainingPercentage;

              if (remaining === undefined || remaining === null) {
                return <span className="text-sm text-gray-400">—</span>;
              }

              let colorClassName: string = "text-emerald-700";
              if (remaining <= 0) {
                colorClassName = "text-red-700";
              } else if (remaining <= 20) {
                colorClassName = "text-amber-700";
              }

              return (
                <span className={`text-sm font-medium ${colorClassName}`}>
                  {formatPercent(remaining)}
                </span>
              );
            },
          },
          {
            field: {
              sloStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: ServiceLevelObjective): ReactElement => {
              return getStatusPill(item.sloStatus);
            },
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            hideOnMobile: true,
            getElement: (item: ServiceLevelObjective): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
        selectMoreFields={{
          windowType: true,
        }}
        onViewPage={(item: ServiceLevelObjective): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.SLO_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              ).toString(),
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default Slos;
