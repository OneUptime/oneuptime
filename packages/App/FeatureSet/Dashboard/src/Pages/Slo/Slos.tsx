import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import {
  getSloFormFields,
  SLO_CREATE_INITIAL_VALUES,
  SLO_FORM_STEPS,
} from "./SloFormFields";
import SloStatusPill from "../../Components/Slo/SloStatusPill";
import SloStatusSummaryCards from "../../Components/Slo/SloStatusSummaryCards";
import {
  applySloStatusSummaryTile,
  getSloListBaseQuery,
  getSloListStatusKind,
  SLO_LIST_FACETS,
  SLOS_TABLE_ID,
  SloListStatusKind,
  SloStatusSummaryTile,
} from "../../Components/Slo/SloStatusSummaryTiles";
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
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500, Slate500 } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { getSloBudgetTier, SloBudgetTier } from "Common/Utils/Slo/SloHealth";
import { formatSloBurnRate } from "Common/Utils/Slo/SloWidgetFormat";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Select from "Common/Types/BaseDatabase/Select";
import FieldType from "Common/UI/Components/Types/FieldType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useRef,
  useState,
} from "react";

const documentationMarkdown: string = `
### How SLOs and Error Budgets Work

A **Service Level Objective (SLO)** is a reliability target — for example "99.9% uptime over a rolling 30 days". OneUptime measures the **Service Level Indicator (SLI)** from the status timelines of the monitors the SLO measures, and compares it to your target.

- **Error budget** is the amount of downtime your target allows. At 99.9% over 30 days that is about 43 minutes. Every minute of downtime spends budget; when the budget runs out, the SLO is breached.
- **Burn rate** tells you how fast the budget is being spent. A burn rate of 1 spends the budget exactly over the window; a burn rate of 14 exhausts it in about 2 days on a 30-day window.

The tiles above the list count your SLOs by status. Click one to filter the list to exactly those SLOs, and click it again to clear the filter.

---

### Choosing What an SLO Measures

After you create an SLO, open it to choose its monitors. An SLO with no monitors shows **Misconfigured** until it has at least one.

- **Monitors** — attach monitors by hand from the SLO's **Monitors** page.
- **Monitor Rules** — attach monitors automatically by label, name or description from the SLO's **Monitor Rules** page. Monitors that match are attached when they are created or changed, and detached when they stop matching. While any rule is enabled, the rules manage the SLO's monitors, so monitors cannot be added by hand.

---

### SLO Settings

Open an SLO's **Settings** page to change how it is measured:

- **Objective** — the target percentage and the at-risk threshold.
- **Period** — a rolling window of days, or the calendar month in a time zone.
- **Downtime** — which monitor statuses count as downtime (every non-operational status by default), and how downtime on several monitors combines: any monitor down, or the average across monitors.
- **Enabled** — a disabled SLO is not evaluated, and its open burn-rate alerts and incidents are resolved.

---

### Alerts, Incidents and History

Every new SLO starts with a **fast burn** and a **slow burn** rule, scaled to its compliance window. On the SLO's **Burn Rate Rules** page, choose whether each rule raises an alert, declares an incident, or both, and who is paged. Alerts and incidents a rule creates list the SLO as an affected resource.

The SLO's **Metrics** page charts its SLI, error budget and burn rate over time, and its **Feed** records what changed and when.

---

### Archiving

Archive an SLO you no longer need but want to keep: from its **Settings** page, or select SLOs in this list and choose **Archive**. Archived SLOs are hidden from this list and are not evaluated, and their open burn-rate alerts and incidents are resolved. Find them on the **Archived** page in the side menu, where you can unarchive them to resume measuring.

Archiving and disabling are separate: unarchiving an SLO that was disabled leaves it disabled.

---

### SLO Status Values

| Status | Description |
|--------|-------------|
| **Healthy** | The SLI is at or above target and enough error budget remains |
| **At Risk** | Remaining error budget dropped below the at-risk threshold |
| **Budget Exhausted** | The error budget is fully spent — the SLO is breached |
| **Misconfigured** | The SLO cannot be measured — no monitors attached, no monitor data yet, or an out-of-range target |
| **Paused** | Every monitor the SLO measures is paused or disabled |
| **Disabled** | The SLO is turned off in its Settings and is not evaluated |
| **Unknown** | The SLO has not been evaluated yet |

SLOs are evaluated automatically every few minutes.
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

export type GetSloTableColumnsFunction = () => Columns<ServiceLevelObjective>;

/**
 * Target and compliance window: what an SLO promises. Shared with the
 * Archived SLOs page, which shows what a retired SLO promised but none of
 * its (frozen) live numbers.
 */
export const getSloTargetAndWindowColumns: GetSloTableColumnsFunction =
  (): Columns<ServiceLevelObjective> => {
    return [
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
    ];
  };

/**
 * When the worker last measured the SLO. On the Archived page this is the
 * moment its numbers froze.
 */
export const getSloLastEvaluatedColumns: GetSloTableColumnsFunction =
  (): Columns<ServiceLevelObjective> => {
    return [
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
    ];
  };

/**
 * The reliability columns every live SLO table shows: name, target, window,
 * SLI, budget, burn rate and status. Shared by the SLOs list and the
 * monitor's SLOs tab so the two can never disagree about what "at risk"
 * looks like. Surface-specific columns (monitors, labels, last evaluated)
 * are appended by the caller.
 */
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
      ...getSloTargetAndWindowColumns(),
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
           * An archived or disabled SLO keeps whatever status it had when it
           * stopped being evaluated, so rendering that stale value would claim
           * a live measurement that is not happening. Archived outranks
           * Disabled - see getSloListStatusKind - and the summary tiles use
           * the same precedence, so a tile never counts a row whose pill
           * disagrees with it.
           */
          const statusKind: SloListStatusKind = getSloListStatusKind(item);

          if (statusKind === SloListStatusKind.Archived) {
            return (
              <Pill text="Archived" color={Slate500} size={PillSize.Small} />
            );
          }

          if (statusKind === SloListStatusKind.Disabled) {
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
  isArchived: true,
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

type OnSummaryTileClickFunction = (tile: SloStatusSummaryTile) => void;

const Slos: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const { bulkActions, archiveBulkActions, modals }: SloBulkActionsResult =
    useSloBulkActions();

  /*
   * The owners cell, plus the facet bar: an Owner chip (the table shows the
   * owners it filters on) and the Status and Enabled chips the summary tiles
   * move. Tiles drill in through the bar rather than through a second filter
   * hidden behind the table, so the chips are the visible record of why the
   * list is short and the user backs out through the same control.
   */
  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    mergeFiltersIntoQuery,
    hasActiveFilters,
    facetSelections,
    facetOperators,
    setFacetSelection,
  } = useResourceOwners<ServiceLevelObjective>({
    ownerUserModelType: ServiceLevelObjectiveOwnerUser,
    ownerTeamModelType: ServiceLevelObjectiveOwnerTeam,
    resourceIdField: SLO_OWNER_RESOURCE_ID_FIELD,
    extraFacets: SLO_LIST_FACETS,
    persistKey: SLOS_TABLE_ID,
  });

  const onSummaryTileClick: OnSummaryTileClickFunction = (
    tile: SloStatusSummaryTile,
  ): void => {
    applySloStatusSummaryTile({
      tile: tile,
      facetSelections: facetSelections,
      facetOperators: facetOperators,
      setFacetSelection: setFacetSelection,
    });
  };

  const [summaryRefreshCount, setSummaryRefreshCount] = useState<number>(0);
  const hasFetchedTableRef: MutableRefObject<boolean> = useRef<boolean>(false);

  return (
    <Fragment>
      <SloStatusSummaryCards
        projectId={ProjectUtil.getCurrentProjectId()!}
        facetSelections={facetSelections}
        facetOperators={facetOperators}
        onTileClick={onSummaryTileClick}
        refreshToken={summaryRefreshCount.toString()}
      />
      <ModelTable<ServiceLevelObjective>
        modelType={ServiceLevelObjective}
        id={SLOS_TABLE_ID}
        userPreferencesKey={SLOS_TABLE_ID}
        /*
         * Archived SLOs are retired and listed on their own Archived page.
         * There is deliberately no Archived filter here: a column filter
         * overrides this pinned query, and would pull archived rows back in.
         */
        query={mergeFiltersIntoQuery(getSloListBaseQuery())}
        topContent={filterBar}
        onFetchSuccess={(data: Array<ServiceLevelObjective>) => {
          onResourcesFetched(data);

          /*
           * The strip's counts move when statuses or the set of live SLOs do
           * - a bulk archive, the Refresh button picking up the worker's
           * latest evaluation - and each of those ends in a table refetch.
           * So every refetch after the first load (which the strip's own
           * mount already counted) asks it to recount.
           */
          if (hasFetchedTableRef.current) {
            setSummaryRefreshCount((count: number): number => {
              return count + 1;
            });
          }

          hasFetchedTableRef.current = true;
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
        /*
         * An empty list under an active chip is not an empty project: say the
         * SLOs are there and the bar is what is hiding them.
         */
        noItemsMessage={
          hasActiveFilters
            ? "No SLO matches the filters above."
            : "No SLOs yet. Create one, then attach monitors or add a monitor rule to turn uptime into a reliability target with an error budget and burn-rate alerts."
        }
        helpContent={{
          title: "How SLOs Work",
          description:
            "Understanding SLOs, error budgets, monitors, settings, archiving and statuses",
          markdown: documentationMarkdown,
        }}
        documentationLink={new Route("/docs/slo/introduction")}
        showViewIdButton={true}
        bulkActions={{
          buttons: [...bulkActions, ...archiveBulkActions],
        }}
        /*
         * Status and Enabled are chips on the facet bar, not popup filters:
         * a popup filter on a chip's column would silently replace the chip's
         * constraint while the chip stays lit.
         */
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
        formSteps={SLO_FORM_STEPS}
        formFields={getSloFormFields()}
        /*
         * Seeds for the create modal only. The scalar values are the DB
         * defaults for NOT NULL columns, so without them the user would have
         * to fill in boxes whose answer is already the right one.
         *
         * Deliberately NOT the form fields' `defaultValue`: FormField falls
         * back to defaultValue whenever the current value is FALSY, which
         * makes a cleared number box snap back to the default mid-typing
         * and renders a legitimately saved at-risk threshold of 0 as 20.
         */
        createInitialValues={SLO_CREATE_INITIAL_VALUES}
        /*
         * A new SLO measures nothing until it has monitors, and everything it
         * needs next - monitors, monitor rules, settings - hangs off its own
         * page. Landing there beats leaving the user to find the new row in
         * the list and click through.
         */
        onCreateSuccess={(
          item: ServiceLevelObjective,
          modalType?: ModalType,
        ): Promise<ServiceLevelObjective> => {
          if (modalType === ModalType.Create && item._id) {
            Navigation.navigate(getSloViewRoute(item));
          }

          return Promise.resolve(item);
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
          ...getSloLastEvaluatedColumns(),
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
