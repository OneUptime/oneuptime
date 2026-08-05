import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import { getSloFormFields } from "./SloFormFields";
import SloStatusPill from "../../Components/Slo/SloStatusPill";
import MonitorsElement from "../../Components/Monitor/Monitors";
import Route from "Common/Types/API/Route";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveOwnerTeam from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import useSloBulkActions, {
  SLO_OWNER_RESOURCE_ID_FIELD,
  SloBulkActionsResult,
} from "../../Components/Slo/useSloBulkActions";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Label from "Common/Models/DatabaseModels/Label";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import SloMultiMonitorMode from "Common/Types/ServiceLevelObjective/SloMultiMonitorMode";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500 } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import {
  DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
  DEFAULT_ROLLING_WINDOW_DAYS,
  getSloBudgetTier,
  SloBudgetTier,
} from "Common/Utils/Slo/SloHealth";
import { formatSloBurnRate } from "Common/Utils/Slo/SloWidgetFormat";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Select from "Common/Types/BaseDatabase/Select";
import FieldType from "Common/UI/Components/Types/FieldType";
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
| **Misconfigured** | The SLO cannot be measured — no monitors attached, no monitor data yet, or an out-of-range target |
| **Paused** | All attached monitors are paused or disabled |
| **Unknown** | The SLO has not been evaluated yet |

SLOs are evaluated automatically every few minutes. Each new SLO is created with a **fast burn** and a **slow burn** rule already set up, scaled to its compliance window — open the SLO's Burn Rate Rules tab to route them to your on-call policies.
`;

type FormatPercentFunction = (value: number | undefined | null) => string;

const formatPercent: FormatPercentFunction = (
  value: number | undefined | null,
): string => {
  if (value === undefined || value === null) {
    return "—";
  }
  return `${Math.round(value * 1000) / 1000}%`;
};

/*
 * Tailwind classes per budget tier. The tier itself comes from the shared,
 * unit-tested helper so the colour always agrees with the SLO's own at-risk
 * threshold — the previous hardcoded `remaining <= 20` rendered an SLO with a
 * 50% threshold green while the worker had already moved it to At Risk.
 */
const BUDGET_TIER_TEXT_CLASS: Record<SloBudgetTier, string> = {
  [SloBudgetTier.Healthy]: "text-emerald-700",
  [SloBudgetTier.AtRisk]: "text-amber-700",
  [SloBudgetTier.Exhausted]: "text-red-700",
  [SloBudgetTier.Unknown]: "text-gray-400",
};

/**
 * The reliability columns every SLO table shows: name, target, window,
 * SLI, budget, burn rate and status. Shared by the SLOs list and the
 * monitor's SLOs tab so the two can never disagree about what "at risk"
 * looks like. Surface-specific columns (monitors, labels, last evaluated)
 * are appended by the caller.
 */
export type GetSloTableColumnsFunction = () => Columns<ServiceLevelObjective>;

export const getSloTableColumns: GetSloTableColumnsFunction =
  (): Columns<ServiceLevelObjective> => {
    return [
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

          const tier: SloBudgetTier = getSloBudgetTier({
            errorBudgetRemainingPercentage: remaining,
            atRiskThresholdPercentage: item.atRiskThresholdPercentage,
          });

          return (
            <span
              className={`text-sm font-medium ${BUDGET_TIER_TEXT_CLASS[tier]}`}
            >
              {formatPercent(remaining)}
            </span>
          );
        },
      },
      {
        field: {
          currentBurnRate: true,
        },
        title: "Burn Rate",
        type: FieldType.Element,
        hideOnMobile: true,
        getElement: (item: ServiceLevelObjective): ReactElement => {
          const burnRate: string | null = formatSloBurnRate(
            item.currentBurnRate,
          );

          if (burnRate === null) {
            return <span className="text-sm text-gray-400">—</span>;
          }

          /*
           * Above 1× the budget is being spent faster than the window can
           * sustain — the number that decides whether this is a "watch it"
           * or a "do something now".
           */
          const isBurningTooFast: boolean = (item.currentBurnRate || 0) > 1;

          return (
            <span
              className={
                isBurningTooFast
                  ? "text-sm font-medium text-amber-700"
                  : "text-sm text-gray-900"
              }
            >
              {burnRate}
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
          /*
           * A disabled SLO keeps whatever status it had when it was switched
           * off, so rendering that stale value would claim a live
           * measurement that is not happening. Say "Disabled" instead; the
           * Enabled filter pairs with it.
           */
          if (item.isEnabled === false) {
            return (
              <Pill text="Disabled" color={Gray500} size={PillSize.Small} />
            );
          }

          return <SloStatusPill status={item.sloStatus} />;
        },
      },
    ];
  };

/**
 * Columns read by the getElement callbacks above but not owned by a
 * column of their own — without these the cells silently render their
 * fallback ("—", or a stale-looking status).
 */
export const SLO_TABLE_SELECT_MORE_FIELDS: Select<ServiceLevelObjective> = {
  windowType: true,
  isEnabled: true,
  atRiskThresholdPercentage: true,
};

export type GetSloViewRouteFunction = (item: ServiceLevelObjective) => Route;

export const getSloViewRoute: GetSloViewRouteFunction = (
  item: ServiceLevelObjective,
): Route => {
  return new Route(
    RouteUtil.populateRouteParams(RouteMap[PageMap.SLO_VIEW] as Route, {
      modelId: new ObjectID(item._id as string),
    }).toString(),
  );
};

const Slos: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const { bulkActions, modals }: SloBulkActionsResult = useSloBulkActions();

  /*
   * Only the owners cell, not the facet filter bar the peer lists also take
   * from this hook: "Add Owner" needs somewhere to show its result, and
   * without a column the whole bulk action would land with nothing on
   * screen changing.
   */
  const { getOwnersForResource, isLoadingOwners, onResourcesFetched } =
    useResourceOwners<ServiceLevelObjective>({
      ownerUserModelType: ServiceLevelObjectiveOwnerUser,
      ownerTeamModelType: ServiceLevelObjectiveOwnerTeam,
      resourceIdField: SLO_OWNER_RESOURCE_ID_FIELD,
    });

  return (
    <Fragment>
      <ModelTable<ServiceLevelObjective>
        modelType={ServiceLevelObjective}
        id="slos-table"
        userPreferencesKey="slos-table"
        onFetchSuccess={(data: Array<ServiceLevelObjective>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        showRefreshButton={true}
        name="SLOs"
        searchableFields={["name", "description"]}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: "Service Level Objectives",
          description:
            "Reliability targets measured from monitor uptime. Each SLO tracks its error budget and alerts you before the budget runs out.",
        }}
        noItemsMessage="No SLOs yet. Create one to turn a monitor's uptime into a reliability target with an error budget and burn-rate alerts."
        helpContent={{
          title: "How SLOs Work",
          description:
            "Understanding SLOs, error budgets, burn rates, and statuses",
          markdown: documentationMarkdown,
        }}
        documentationLink={new Route("/docs/slo/introduction")}
        showViewIdButton={true}
        bulkActions={{
          buttons: [...bulkActions],
        }}
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
              monitors: {
                name: true,
              },
            },
            title: "Monitors",
            type: FieldType.EntityArray,
            filterEntityType: Monitor,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
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
        formFields={getSloFormFields()}
        /*
         * Seeds for the create modal only — the edit form is populated from
         * the saved model. These are the DB defaults for four NOT NULL
         * columns, so without them the user would have to fill in four
         * boxes whose answer is already the right one.
         *
         * Deliberately NOT the form fields' `defaultValue`: FormField falls
         * back to defaultValue whenever the current value is FALSY, which
         * makes a cleared number box snap back to the default mid-typing
         * and renders a legitimately saved at-risk threshold of 0 as 20.
         */
        createInitialValues={{
          windowType: SloWindowType.Rolling,
          windowDays: DEFAULT_ROLLING_WINDOW_DAYS,
          atRiskThresholdPercentage: DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
          multiMonitorMode: SloMultiMonitorMode.AnyDown,
        }}
        columns={[
          ...getSloTableColumns(),
          {
            field: {
              monitors: {
                name: true,
                _id: true,
              },
            },
            title: "Monitors",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: ServiceLevelObjective): ReactElement => {
              return (
                <MonitorsElement
                  monitors={(item.monitors as Array<Monitor>) || []}
                />
              );
            },
          },
          {
            field: {
              lastEvaluatedAt: true,
            },
            title: "Last Evaluated",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: ServiceLevelObjective): ReactElement => {
              if (!item.lastEvaluatedAt) {
                return <span className="text-sm text-gray-400">Never</span>;
              }

              const lastEvaluatedAt: Date = OneUptimeDate.fromString(
                item.lastEvaluatedAt,
              );

              return (
                <span
                  className="text-sm text-gray-900"
                  title={OneUptimeDate.getDateAsLocalFormattedString(
                    lastEvaluatedAt,
                  )}
                >
                  {OneUptimeDate.fromNow(lastEvaluatedAt)}
                </span>
              );
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
          {
            field: {
              _id: true,
            },
            title: "Owners",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: ServiceLevelObjective): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
        selectMoreFields={SLO_TABLE_SELECT_MORE_FIELDS}
        onViewPage={(item: ServiceLevelObjective): Promise<Route> => {
          return Promise.resolve(getSloViewRoute(item));
        }}
      />
      {modals}
    </Fragment>
  );
};

export default Slos;
