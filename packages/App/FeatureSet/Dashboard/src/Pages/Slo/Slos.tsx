import PageMap from "../../Utils/PageMap";
import {
  UsedByListActions,
  getUsedByListActions,
} from "../../Components/UsedBy/UsedByListActions";
import { UsedByRecordKind } from "Common/Types/UsedBy/UsedBy";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";
import GlossaryTerm from "Common/Types/Docs/GlossaryTerm";
import { ARCHIVE_INSTEAD_OF_DELETE } from "../../Components/Archive/ResourceArchiveCopy";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import {
  getSloFormFields,
  SLO_CREATE_FORM_STEPS,
  SLO_CREATE_INITIAL_VALUES,
} from "./SloFormFields";
// The Metric SLO fields' controls, for the create form.
import "./SloMetricQueryFieldElements";
import SloStatusPill from "../../Components/Slo/SloStatusPill";
import SloDeploymentsCell from "../../Components/Slo/SloDeploymentsCell";
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
import ServicesElement from "../../Components/Service/ServiceElements";
import Service from "Common/Models/DatabaseModels/Service";
import { isEventSliType } from "Common/Utils/Slo/SloRequestSli";
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
import {
  formatSloBurnRate,
  formatSloPercent,
  SLI_DECIMALS,
} from "Common/Utils/Slo/SloWidgetFormat";
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
import {
  getGlobalTranslator,
  translatePlural,
  translateText,
} from "Common/UI/Utils/TranslateTemplate";
import useProductFirstRun, {
  ProductFirstRun,
} from "../../Components/ProductOnboarding/UseProductFirstRun";
import ProductShowcase from "../../Components/ProductOnboarding/ProductShowcase";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";
import TableEmptyValue, {
  getValueOrQuietDash,
} from "Common/UI/Components/Table/TableEmptyValue";

const documentationMarkdown: string = `
An SLO is a reliability target, such as 99.9% uptime over 30 days. OneUptime measures it every 5 minutes, tracks the error budget the target leaves you, and alerts you before that budget runs out.

## Set Up an SLO

1. Create an SLO and choose what it measures:
   - **Monitor uptime**: the share of time its monitors are up.
   - **Request success**: the share of its services' requests that do not fail, from their traces.
   - **Request latency**: the share of its services' requests served within a threshold you set, such as 300 ms.
   - **Metric**: the share of good events in a counter or a histogram your services send.
2. Keep the suggested target of 99.9%, or set your own. It is measured over a rolling 30 days unless you change it.
3. For a Monitor uptime SLO, attach monitors on its **Monitors** page, or let its **Monitor Rules** attach them by label, type, name or description. Until it has a monitor, it shows **Misconfigured**.

Every new SLO starts with three burn rate rules (**Fast burn**, **Slow burn** and **Slow leak**) that alert you when its budget is being spent too fast.

## Error Budget and Burn Rate

- The **error budget** is the downtime the target allows. At 99.9% over 30 days, that is about 43 minutes. An SLO that counts requests or events counts its budget in them too: at 99.9%, one bad request in every 1,000.
- The **burn rate** is how fast the budget is being spent. At 1, it lasts exactly the period; at 14, a 30-day budget is gone in about 2 days.

## Alerts and Incidents

An SLO's **Burn Rate Rules** page decides what happens when its budget burns too fast: whether each rule opens an alert, declares an incident or both, and who is paged. The alerts and incidents list the SLO as an affected resource.

To give older SLOs the rules a new one starts with, select them in this list and choose **Add recommended rules** in **Bulk Actions**. Before anything is added, it says which SLOs get which rules.

## Statuses

| Status | What it means |
|--------|---------------|
| **Healthy** | On target, with enough error budget left |
| **At Risk** | Less error budget is left than the SLO's at-risk threshold (20% unless you change it) |
| **Budget Exhausted** | The error budget is spent: the SLO is breached |
| **Waiting** | Nothing has checked its monitors yet. It is measured from their first check |
| **Misconfigured** | It cannot be measured: no monitors, no data, or a target out of range |
| **Paused** | Every monitor it measures is paused or disabled |
| **Disabled** | It is turned off in its Settings, and is not evaluated |
| **Unknown** | It has not been evaluated yet |

The tiles above the list count your SLOs by status. Select one to show only those SLOs, and select it again to show them all.

The **Deployments** filter shows the SLOs whose error budget policy freezes deployments right now. Show the **Deployments** column from the column picker to see since when.

## Settings, Archiving and History

- An SLO's **Settings** page changes what it measures, its target, its at-risk threshold, its period (a rolling number of days, or a calendar month in a time zone), which monitor statuses count as downtime, and how downtime on several monitors adds up.
- Turning an SLO off stops it being evaluated, and resolves its open burn rate alerts and incidents.
- Archive an SLO you no longer need but want to keep, from its **Settings** page or by selecting it here and choosing **Archive**. It leaves this list, is no longer evaluated, and its open burn rate alerts and incidents are resolved. Archived SLOs are on the **Archived** page, under **Advanced** in the side menu, where you can unarchive them. Unarchiving does not turn a disabled SLO back on.
- An SLO's **Metrics** page charts its SLI, error budget and burn rate over time, and its **Feed** records what changed and when.
`;

type FormatPercentFunction = (value: number | undefined | null) => string;

// "99,874 %" in German: the table's figures as the reader's language writes them.
const formatPercent: FormatPercentFunction = (
  value: number | undefined | null,
): string => {
  return (
    formatSloPercent(value, SLI_DECIMALS, getGlobalTranslator()) ??
    EMPTY_VALUE_MARK
  );
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
              {getValueOrQuietDash(formatPercent(item.targetPercentage))}
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
              <span className="text-sm text-gray-900">
                {translateText("Calendar month")}
              </span>
            );
          }
          return (
            <span className="text-sm text-gray-900">
              {translatePlural(
                {
                  one: "{{count}} day rolling",
                  other: "{{count}} days rolling",
                },
                item.windowDays || 30,
              )}
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
            return (
              <span className="text-sm text-gray-500">
                {translateText("Never")}
              </span>
            );
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
            return <TableEmptyValue />;
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
              {getValueOrQuietDash(formatPercent(sli))}
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
            return <TableEmptyValue />;
          }

          const tier: SloBudgetTier = getSloBudgetTier({
            errorBudgetRemainingPercentage: remaining,
            atRiskThresholdPercentage: item.atRiskThresholdPercentage,
          });

          return (
            <span
              className={`text-sm font-medium ${BUDGET_TIER_TEXT_CLASS[tier]}`}
            >
              {getValueOrQuietDash(formatPercent(remaining))}
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
            getGlobalTranslator(),
          );

          if (burnRate === null) {
            return <TableEmptyValue />;
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
 * What the SLO measures: its monitors, or a request SLO's services (#8441).
 * One column, since an SLO measures one or the other: a request SLO's row
 * used to show an empty Monitors cell. The services and the SLI type are
 * read through SLO_TABLE_SELECT_MORE_FIELDS.
 */
export const getSloWhatItMeasuresColumns: GetSloTableColumnsFunction =
  (): Columns<ServiceLevelObjective> => {
    return [
      {
        field: {
          monitors: {
            name: true,
            _id: true,
          },
        },
        title: "What It Measures",
        type: FieldType.Element,
        hideOnMobile: true,
        getElement: (item: ServiceLevelObjective): ReactElement => {
          if (isEventSliType(item.sliType)) {
            return (
              <ServicesElement
                services={(item.services as Array<Service>) || []}
              />
            );
          }

          return (
            <MonitorsElement
              monitors={(item.monitors as Array<Monitor>) || []}
            />
          );
        },
      },
    ];
  };

/**
 * The deploy gate (#6377): which SLOs are freezing deployments right now,
 * "Frozen since <time>" in red, and nothing for an SLO that allows them.
 * Hidden until someone switches it on from the column picker, so the list
 * stays as it was for a team that gates nothing on its SLOs; the
 * Deployments chip filters by the same column. The SLO list's alone: it
 * reads deploymentsFrozenAt too (SLO_LIST_SELECT_MORE_FIELDS).
 */
export const getSloDeploymentsColumns: GetSloTableColumnsFunction =
  (): Columns<ServiceLevelObjective> => {
    return [
      {
        field: {
          deploymentsAllowed: true,
        },
        title: "Deployments",
        type: FieldType.Element,
        hideOnMobile: true,
        isHiddenByDefault: true,
        getElement: (item: ServiceLevelObjective): ReactElement => {
          return <SloDeploymentsCell slo={item} />;
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
  // What It Measures: a request SLO's services, in place of monitors.
  sliType: true,
  services: {
    name: true,
    _id: true,
  },
};

// The SLO list's own: the Deployments column's freeze time too.
export const SLO_LIST_SELECT_MORE_FIELDS: Select<ServiceLevelObjective> = {
  ...SLO_TABLE_SELECT_MORE_FIELDS,
  deploymentsFrozenAt: true,
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
  // Until the first one, the page explains the product under the empty table.
  const firstRun: ProductFirstRun = useProductFirstRun<ServiceLevelObjective>({
    modelType: ServiceLevelObjective,
    query: getSloListBaseQuery(),
  });
  const {
    bulkActions,
    archiveBulkActions,
    recommendedRulesBulkActions,
    rowActions,
    archiveRowActions,
    modals,
  }: SloBulkActionsResult = useSloBulkActions();

  /*
   * A row's Delete and the bulk Delete say what still uses the SLOs first
   * (#7435); their Archive says it too (useSloBulkActions).
   */
  const usedBy: UsedByListActions<ServiceLevelObjective> =
    getUsedByListActions<ServiceLevelObjective>(UsedByRecordKind.Slo);

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
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
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
        refreshToggle={firstRun.refreshToken}
        showCreateForm={firstRun.showCreateForm}
        // Enable or Disable, and Archive, in each row's ⋯ menu.
        actionButtons={[...rowActions, ...archiveRowActions]}
        id={SLOS_TABLE_ID}
        userPreferencesKey={SLOS_TABLE_ID}
        /*
         * Archived SLOs are retired and listed on their own Archived page.
         * There is deliberately no Archived filter here: a column filter
         * overrides this pinned query, and would pull archived rows back in.
         */
        query={mergeFiltersIntoQuery(getSloListBaseQuery())}
        topContent={firstRun.getTopContent(filterBar)}
        emptyState={firstRun.getEmptyState(facetEmptyState)}
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
        isDeleteable={true}
        getDeleteConfirmation={usedBy.getDeleteConfirmation}
        deleteConfirmationWarning={ARCHIVE_INSTEAD_OF_DELETE}
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
            "Reliability targets measured from monitor uptime or from your services' requests. Each SLO tracks its error budget and alerts you before it runs out.",
          titleGlossaryTerm: GlossaryTerm.SLO,
        }}
        /*
         * An empty list under an active chip is not an empty project: the
         * table hears about the chips through emptyState and says nothing
         * matches them. This is what a project with no SLO at all is told.
         */
        noItemsMessage="No SLOs yet. Create one and attach monitors to turn uptime into a target with an error budget."
        helpContent={{
          title: "How SLOs Work",
          description: "Set a reliability target, and know before you miss it.",
          markdown: documentationMarkdown,
        }}
        documentationLink={new Route("/docs/slo/introduction")}
        showViewIdButton={true}
        /*
         * Add recommended rules is offered here alone: an archived SLO's
         * rules never fire, and the Archived page offers Unarchive alone.
         */
        bulkActions={{
          buttons: [
            ...bulkActions,
            ...recommendedRulesBulkActions,
            ...archiveBulkActions,
          ],
          deleteConfirmationDetails: usedBy.deleteConfirmationDetails,
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
          // The request SLOs that measure a service (#8441).
          {
            field: {
              services: {
                name: true,
              },
            },
            title: "Services",
            type: FieldType.EntityArray,
            filterEntityType: Service,
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
        /*
         * Two steps (SloFormFields.ts): what the SLO measures - monitor
         * uptime, or a request SLO's services and latency threshold - then
         * its name, target and a folded Advanced section.
         */
        formFields={getSloFormFields()}
        formSteps={SLO_CREATE_FORM_STEPS}
        /*
         * Seeds for the create modal only. The window and the at-risk
         * threshold are the DB defaults for NOT NULL columns, so without
         * them the user would have to fill in boxes whose answer is already
         * the right one; the target is the suggested 99.9, which people see
         * and can change.
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
          firstRun.onRecordCreated();
          if (modalType === ModalType.Create && item._id) {
            Navigation.navigate(getSloViewRoute(item));
          }

          return Promise.resolve(item);
        }}
        columns={[
          ...getSloTableColumns(),
          ...getSloDeploymentsColumns(),
          ...getSloWhatItMeasuresColumns(),
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
        selectMoreFields={SLO_LIST_SELECT_MORE_FIELDS}
        onViewPage={(item: ServiceLevelObjective): Promise<Route> => {
          return Promise.resolve(getSloViewRoute(item));
        }}
      />
      {modals}
      {/* Under the table (the modals above are dialogs over the page). */}
      {firstRun.isFirstRun && (
        <ProductShowcase
          product={ProductKey.Slos}
          // The empty table above says what the list is for.
          hidesDescription={true}
          startButton={firstRun.startButton}
        />
      )}
    </Fragment>
  );
};

export default Slos;
