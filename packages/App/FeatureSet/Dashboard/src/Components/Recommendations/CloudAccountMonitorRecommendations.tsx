import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { getCloudMonitoringServiceName } from "Common/Types/Monitor/CloudAlertTemplates";
import { ActiveMonitorLimitStatus } from "Common/Types/Monitor/ActiveMonitorLimit";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorRecommendationUtil from "Common/Types/Monitor/Recommendation/MonitorRecommendationUtil";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  MonitorRecommendation,
  MonitorRecommendationNotificationSettings,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { runBulkAction } from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionProgress,
  useBulkActionProgress,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import UILink from "Common/UI/Components/Link/Link";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  MONITOR_CONSENT_ERROR,
  MonitorPayAsYouGoCard,
  isMonitorBatchConsentRequired,
} from "../Billing/PayAsYouGo";
import { readActiveMonitorLimitIfReached } from "../Monitor/ActiveMonitorLimitNotice";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import CloudAccountRecommendationPlan, {
  CLOUD_ACCOUNT_CREATE_RESULT_LABELS,
  CloudAccountRecommendationGap,
  CloudAccountRecommendationGapReason,
  CloudAccountRecommendationGaps,
  CloudAccountRecommendationGroup,
  CloudAccountRecommendationPlanItem,
  CloudAccountRecommendationResource,
  CloudAccountRecommendationRow,
  CloudAccountRecommendationTarget,
} from "./CloudAccountRecommendationPlan";
import {
  CloudAccountRecommendationCoverage,
  CloudAccountRecommendationResources,
  loadCloudAccountRecommendationCoverage,
  loadCloudAccountRecommendationResources,
} from "./CloudAccountRecommendationData";
import MonitorRecommendationCreateSideOver from "./MonitorRecommendationCreateSideOver";
import {
  CREATE_MONITORS_LOCKED_SENTENCE,
  loadMonitorRecommendationProjectSetup,
  MonitorRecommendationProjectSetup,
} from "./MonitorRecommendationProjectSetup";
import RecommendationToolbar from "./RecommendationToolbar";
import { notifyRecommendationsChanged } from "./RecommendationsChanged";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  RecommendationCounts,
  RecommendationFilterState,
  RecommendationSeverityFilter,
  RecommendationStatus,
  RecommendationStatusFilter,
} from "./RecommendationViewModel";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import {
  getAlertTemplateName,
  getAlertTemplateSummary,
} from "../Form/Monitor/AlertTemplatePicker/AlertTemplateGroups";

export interface ComponentProps {
  // The account's cloud and its id there: what its resources are read by.
  provider: string;
  cloudAccountId: string;
}

// The monitors one Add creates, while its panel is open.
interface PendingCreate {
  targets: Array<CloudAccountRecommendationTarget>;
}

/*
 * The side of a row its action takes once the row is wide enough, read
 * from the card's own width: a record page's card is 430px wide at a 768px
 * window and 890px at 1280 (the side menu takes the rest).
 */
const WIDE_ROW: string =
  "[@container(min-width:36rem)]:flex-row [@container(min-width:36rem)]:items-start [@container(min-width:36rem)]:justify-between";

const WIDE_RESOURCE_ROW: string =
  "[@container(min-width:30rem)]:flex-row [@container(min-width:30rem)]:items-center [@container(min-width:30rem)]:justify-between";

// A Button keeps a dialog footer's md:ml-3: cleared where it sits in a row.
const BUTTON_IN_ROW: string =
  "[&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0";

// How many of the resources a reason names are listed by name.
export const NOT_LISTED_NAMES_SHOWN: number = 8;

// What each reason says, above the resources it names.
const NOT_LISTED_REASON_TEXT: Readonly<
  Record<CloudAccountRecommendationGapReason, string>
> = {
  [CloudAccountRecommendationGapReason.NoMetrics]: translationKey(
    "Waiting for their first metrics",
  ),
  [CloudAccountRecommendationGapReason.NextRead]: translationKey(
    "Offered after their next read, within a few minutes",
  ),
  [CloudAccountRecommendationGapReason.Unsupported]: translationKey(
    "No recommended monitors for them yet. You can still create one from a resource's Metrics tab.",
  ),
};

// The reasons, in the order the section says them.
const NOT_LISTED_REASONS: ReadonlyArray<CloudAccountRecommendationGapReason> = [
  CloudAccountRecommendationGapReason.NoMetrics,
  CloudAccountRecommendationGapReason.NextRead,
  CloudAccountRecommendationGapReason.Unsupported,
];

/*
 * Where a left-out resource's name leads: its Recommendations tab, which
 * says when it will be offered some, while it waits for metrics or a read;
 * its Metrics tab when no recommended monitor is for it - the tab the
 * reason's sentence sends people to, to make one of their own.
 */
export const NOT_LISTED_RESOURCE_PAGES: Readonly<
  Record<CloudAccountRecommendationGapReason, PageMap>
> = {
  [CloudAccountRecommendationGapReason.NoMetrics]:
    PageMap.CLOUD_RESOURCE_VIEW_RECOMMENDATIONS,
  [CloudAccountRecommendationGapReason.NextRead]:
    PageMap.CLOUD_RESOURCE_VIEW_RECOMMENDATIONS,
  [CloudAccountRecommendationGapReason.Unsupported]:
    PageMap.CLOUD_RESOURCE_VIEW_METRICS,
};

/*
 * A CLOUD ACCOUNT'S RECOMMENDED MONITORS: the monitors OneUptime recommends
 * for every resource the account holds (CloudAlertTemplates), a row per
 * recommendation of each resource type. One Add sets a recommendation up
 * on every resource of the type still without it, Add all every
 * recommendation of the type, and a resource's own Add just that one - the
 * resource's Recommendations tab offers the same monitors one resource at
 * a time. What is set up already, and what the team dismissed on a
 * resource's tab, is never offered twice (CloudAccountRecommendationPlan).
 *
 * The monitors are created one at a time through the bulk runner
 * (runBulkAction, concurrency 1): every one counts against the plan's
 * active monitors, and each create must see the one before it. Its dialog
 * counts them down with the time left and Stop, and says once it has ended
 * which were made and why any were not.
 */
const CloudAccountMonitorRecommendations: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");

  const [setup, setSetup] = useState<MonitorRecommendationProjectSetup | null>(
    null,
  );
  const [resources, setResources] = useState<
    Array<CloudAccountRecommendationResource>
  >([]);
  const [resourceTotal, setResourceTotal] = useState<number>(0);
  const [existingMonitors, setExistingMonitors] = useState<
    Array<{ monitorId: ObjectID; monitorSteps: Array<MonitorStep> }>
  >([]);
  const [dismissals, setDismissals] = useState<
    CloudAccountRecommendationCoverage["dismissals"]
  >([]);

  const [filterState, setFilterState] = useState<RecommendationFilterState>({
    searchText: "",
    // What is still to set up: the page's job.
    status: RecommendationStatusFilter.Available,
    severity: RecommendationSeverityFilter.All,
  });

  const [expandedRowKeys, setExpandedRowKeys] = useState<Set<string>>(
    new Set<string>(),
  );

  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(
    null,
  );
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [panelError, setPanelError] = useState<string>("");
  const [limitReached, setLimitReached] =
    useState<ActiveMonitorLimitStatus | null>(null);

  const progress: BulkActionProgress<CloudAccountRecommendationPlanItem> =
    useBulkActionProgress<CloudAccountRecommendationPlanItem>({
      singularLabel: "Monitor",
      pluralLabel: "Monitors",
      itemToString: CloudAccountRecommendationPlan.getPlanItemName,
    });

  type LoadCoverageFunction = () => Promise<void>;

  /*
   * What covers a recommendation already, and what the team dismissed:
   * read again after every run, so what was made is never offered twice.
   */
  const loadCoverage: LoadCoverageFunction = async (): Promise<void> => {
    const coverage: CloudAccountRecommendationCoverage =
      await loadCloudAccountRecommendationCoverage();

    setExistingMonitors(coverage.existingMonitors);
    setDismissals(coverage.dismissals);
  };

  type LoadFunction = () => Promise<void>;

  const load: LoadFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        throw new Error(translator.translateText("Project not found."));
      }

      const [projectSetup, read]: [
        MonitorRecommendationProjectSetup,
        CloudAccountRecommendationResources,
      ] = await Promise.all([
        loadMonitorRecommendationProjectSetup(translator),
        loadCloudAccountRecommendationResources({
          projectId: projectId,
          provider: props.provider,
          cloudAccountId: props.cloudAccountId,
        }),
      ]);

      setSetup(projectSetup);
      setResources(read.resources);
      setResourceTotal(read.total);

      await loadCoverage();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useAsyncEffect(async () => {
    await load();
  }, [props.provider, props.cloudAccountId]);

  const groups: Array<CloudAccountRecommendationGroup> = useMemo(() => {
    return CloudAccountRecommendationPlan.buildGroups({
      resources: resources,
      existingMonitors: existingMonitors,
      dismissals: dismissals,
    });
  }, [resources, existingMonitors, dismissals]);

  const isRunning: boolean = progress.isRunning || isStarting;

  /*
   * Whether the person may create monitors at all. A member whose role may
   * not still sees what is recommended and what is set up, and every Add
   * says why it is locked, as every Create of a monitor does
   * (PermissionGate). While the permission snapshot is still loading there
   * is nothing honest to say, so the buttons stay as they are. Said of
   * monitors, not "this Monitor": the line stands at the top of a page that
   * adds them by the dozen.
   */
  const monitorCreateGate: PermissionGateResult = PermissionGate.check(
    new Monitor(),
    ModelAction.Create,
    { sentence: CREATE_MONITORS_LOCKED_SENTENCE },
  );
  const createLockReason: string | undefined =
    !monitorCreateGate.isAllowed && monitorCreateGate.disabledReason
      ? monitorCreateGate.disabledReason
      : undefined;

  type OpenCreateFunction = (
    targets: Array<CloudAccountRecommendationTarget>,
  ) => void;

  /*
   * Opens the create panel for these monitors and reads the plan's limit on
   * active monitors as it opens: a project with no room is told so at
   * once, above the form, before anyone fills it in.
   */
  const openCreate: OpenCreateFunction = (
    targets: Array<CloudAccountRecommendationTarget>,
  ): void => {
    if (targets.length === 0 || createLockReason) {
      return;
    }

    setActionError("");
    setPanelError("");
    setLimitReached(null);
    setPendingCreate({ targets: targets });

    readActiveMonitorLimitIfReached()
      .then((status: ActiveMonitorLimitStatus | null): void => {
        setLimitReached(status);
      })
      .catch(() => {
        // A limit that cannot be read is no limit here: the server holds it.
      });
  };

  type CreateFunction = (data: {
    targets: Array<CloudAccountRecommendationTarget>;
    notificationSettings: MonitorRecommendationNotificationSettings;
    hasAcknowledgedBilling: boolean;
  }) => Promise<void>;

  const createMonitors: CreateFunction = async (data: {
    targets: Array<CloudAccountRecommendationTarget>;
    notificationSettings: MonitorRecommendationNotificationSettings;
    hasAcknowledgedBilling: boolean;
  }): Promise<void> => {
    if (!setup) {
      return;
    }

    const plan: Array<CloudAccountRecommendationPlanItem> =
      CloudAccountRecommendationPlan.buildCreatePlan({
        targets: data.targets,
        defaults: setup.defaults,
        notificationSettings: data.notificationSettings,
      });

    if (plan.length === 0) {
      setPendingCreate(null);
      return;
    }

    /*
     * The panel disables its submit until the charge is acknowledged.
     * Repeated here so a caller that skips the panel cannot start it.
     */
    if (
      !data.hasAcknowledgedBilling &&
      isMonitorBatchConsentRequired(
        plan.map((item: CloudAccountRecommendationPlanItem) => {
          return item.monitor.monitorType as MonitorType;
        }),
      )
    ) {
      setPanelError(MONITOR_CONSENT_ERROR);
      return;
    }

    setIsStarting(true);

    /*
     * A project with no room under its plan's limit on active monitors can
     * create none of them: said once, with the limit's notice in the panel,
     * and nothing starts. With some room left the run starts, and the
     * server refuses the creates past it one by one, in its own words.
     */
    const limitStatus: ActiveMonitorLimitStatus | null =
      await readActiveMonitorLimitIfReached();

    if (limitStatus) {
      setLimitReached(limitStatus);
      setIsStarting(false);
      return;
    }

    // The progress dialog takes over from the panel.
    setPendingCreate(null);
    setIsStarting(false);

    try {
      /*
       * One at a time: every monitor created counts against the project's
       * limit on active monitors, and each create must see the one before
       * it (BulkActionConcurrencyLedger).
       */
      await runBulkAction<CloudAccountRecommendationPlanItem>({
        actionProps: progress.getActionProps(plan, {
          resultLabels: CLOUD_ACCOUNT_CREATE_RESULT_LABELS,
        }),
        concurrency: 1,
        step: async (
          item: CloudAccountRecommendationPlanItem,
        ): Promise<void> => {
          try {
            await ModelAPI.createOrUpdate({
              model: item.monitor,
              modelType: Monitor,
              formType: FormType.Create,
              miscDataProps: item.miscDataProps,
            });
          } catch (err) {
            const message: string = API.getFriendlyMessage(err);

            // The progress list shows it as given: a fixed sentence is looked up.
            throw new Error(translator.translateText(message) || message);
          }
        },
      });
    } finally {
      try {
        await loadCoverage();
      } catch (err) {
        setActionError(API.getFriendlyMessage(err));
      }

      // The side menu's badge counts what is left again.
      notifyRecommendationsChanged();
    }
  };

  type ToggleRowFunction = (key: string) => void;

  const toggleRow: ToggleRowFunction = (key: string): void => {
    const next: Set<string> = new Set<string>(expandedRowKeys);

    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }

    setExpandedRowKeys(next);
  };

  // The service the numbers come from, by its own name, in every language.
  const source: string =
    getCloudMonitoringServiceName(props.provider) ||
    translator.translateText("its cloud") ||
    "its cloud";

  const cardDescription: string = translator.translateTemplate(
    "Monitors OneUptime recommends for this account's resources, from the metrics {{source}} reports. Add one to a resource, or to every resource of its type at once.",
    { source: source },
  );

  if (isLoading) {
    return <ComponentLoader />;
  }

  /*
   * A read that failed keeps the page's frame - its title and what it is
   * for - and says why inside it, with a way to read it again that is not
   * reloading the whole page, as the account's Costs do.
   */
  if (error) {
    return (
      <Card title="Recommended Monitors" description={cardDescription}>
        <div data-testid="cloud-account-recommendations-error">
          <ErrorMessage
            message={error}
            onRefreshClick={() => {
              load().catch((err: Error) => {
                setError(API.getFriendlyMessage(err));
              });
            }}
          />
        </div>
      </Card>
    );
  }

  const counts: RecommendationCounts =
    CloudAccountRecommendationPlan.getToolbarCounts(groups);

  const visibleGroups: Array<CloudAccountRecommendationGroup> =
    CloudAccountRecommendationPlan.filterGroups({
      groups: groups,
      filterState: filterState,
      translator: translator,
    });

  const gaps: CloudAccountRecommendationGaps =
    CloudAccountRecommendationPlan.getGaps({
      resources: resources,
      groups: groups,
    });

  const getResourceRoute: (
    resourceId: string,
    page?: PageMap | undefined,
  ) => Route = (resourceId: string, page?: PageMap | undefined): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[page || PageMap.CLOUD_RESOURCE_VIEW_RECOMMENDATIONS] as Route,
      { modelId: new ObjectID(resourceId) },
    );
  };

  const getMonitorRoute: (monitorId: ObjectID) => Route = (
    monitorId: ObjectID,
  ): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.MONITOR_VIEW] as Route,
      { modelId: monitorId },
    );
  };

  type RenderAddButtonFunction = (data: {
    targets: Array<CloudAccountRecommendationTarget>;
    title: string;
    ariaLabel: string;
    dataTestId: string;
    buttonStyle: ButtonStyleType;
  }) => ReactElement;

  const renderAddButton: RenderAddButtonFunction = (data: {
    targets: Array<CloudAccountRecommendationTarget>;
    title: string;
    ariaLabel: string;
    dataTestId: string;
    buttonStyle: ButtonStyleType;
  }): ReactElement => {
    return (
      <div className={`flex-none ${BUTTON_IN_ROW}`}>
        <Button
          title={data.title}
          ariaLabel={data.ariaLabel}
          icon={IconProp.Add}
          buttonStyle={data.buttonStyle}
          buttonSize={ButtonSize.Small}
          dataTestId={data.dataTestId}
          disabled={Boolean(createLockReason) || isRunning}
          tooltip={createLockReason}
          onClick={() => {
            openCreate(data.targets);
          }}
        />
      </div>
    );
  };

  type RenderTargetFunction = (
    row: CloudAccountRecommendationRow,
    target: CloudAccountRecommendationTarget,
  ) => ReactElement;

  const renderTarget: RenderTargetFunction = (
    row: CloudAccountRecommendationRow,
    target: CloudAccountRecommendationTarget,
  ): ReactElement => {
    return (
      <li
        key={target.resource.resourceId}
        className={`flex flex-col gap-2 px-3 py-2 ${WIDE_RESOURCE_ROW}`}
        data-testid={`cloud-account-recommendation-target-${row.recommendationId}-${target.resource.resourceId}`}
      >
        <UILink
          to={getResourceRoute(target.resource.resourceId)}
          className="min-w-0 break-words text-sm text-gray-900 hover:underline"
        >
          <IsolatedText text={target.resource.resourceName} />
        </UILink>
        {/*
         * As tall as the Add a resource still without it has, so a list of
         * made and unmade ones keeps one row height.
         */}
        <div className="flex min-h-[2rem] flex-none items-center gap-2">
          {target.status === RecommendationStatus.Created ? (
            <Fragment>
              <StatusBadge text="Created" type={StatusBadgeType.Success} />
              {target.monitorId ? (
                <UILink
                  to={getMonitorRoute(target.monitorId)}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
                >
                  {translator.translateText("View monitor")}
                </UILink>
              ) : (
                <></>
              )}
            </Fragment>
          ) : (
            <></>
          )}
          {target.status === RecommendationStatus.Dismissed ? (
            <StatusBadge text="Dismissed" type={StatusBadgeType.Info} />
          ) : (
            <></>
          )}
          {target.status === RecommendationStatus.Available ? (
            renderAddButton({
              targets: [target],
              title: "Add",
              ariaLabel: translator.translateTemplate(
                "Add {{name}} to {{resource}}",
                {
                  name: getAlertTemplateName(translator, row),
                  resource: target.resource.resourceName,
                },
              ),
              dataTestId: `cloud-account-recommendation-add-one-${row.recommendationId}-${target.resource.resourceId}`,
              buttonStyle: ButtonStyleType.OUTLINE,
            })
          ) : (
            <></>
          )}
        </div>
      </li>
    );
  };

  type RenderRowFunction = (
    group: CloudAccountRecommendationGroup,
    row: CloudAccountRecommendationRow,
  ) => ReactElement;

  const renderRow: RenderRowFunction = (
    group: CloudAccountRecommendationGroup,
    row: CloudAccountRecommendationRow,
  ): ReactElement => {
    const rowKey: string = `${group.key}|${row.recommendationId}`;
    const isExpanded: boolean = expandedRowKeys.has(rowKey);
    const isCritical: boolean = row.severity === "Critical";
    const available: Array<CloudAccountRecommendationTarget> =
      CloudAccountRecommendationPlan.getAvailableTargets(row);
    const listId: string =
      `cloud-account-recommendation-resources-${group.key}-${row.recommendationId}`
        .replace(/[^a-zA-Z0-9_-]/g, "-")
        .toLowerCase();

    return (
      <li
        key={rowKey}
        className="relative px-4 py-3 pl-5"
        data-testid={`cloud-account-recommendation-row-${row.recommendationId}`}
      >
        <div
          className={`absolute inset-y-3 left-0 w-1 rounded-r ${
            row.counts.available === 0
              ? "bg-green-400"
              : isCritical
                ? "bg-red-400"
                : "bg-amber-400"
          }`}
          aria-hidden="true"
        />
        <div className={`flex flex-col gap-3 ${WIDE_ROW}`}>
          <div className="min-w-0 [@container(min-width:36rem)]:flex-1">
            {/*
             * The template's name and its line in the reader's language,
             * each in an isolate that reads the way most of its letters do:
             * a description (a row with no line) is the catalog's English,
             * and reads as written - its full stop at its end - on a Persian
             * page too.
             */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">
                <IsolatedText text={getAlertTemplateName(translator, row)} />
              </span>
              <StatusBadge
                text={row.severity}
                type={
                  isCritical ? StatusBadgeType.Danger : StatusBadgeType.Warning
                }
              />
            </div>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              <IsolatedText
                text={
                  getAlertTemplateSummary(translator, row) || row.description
                }
              />
            </p>
            {/*
             * How many of its resources have it, and the way to them, on
             * one line: which ones is a click away, never a line of its own.
             */}
            <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs">
              <span
                className="text-gray-600"
                data-testid={`cloud-account-recommendation-coverage-${row.recommendationId}`}
              >
                {translator.translatePlural(
                  {
                    one: "Set up on {{created}} of {{count}} resource",
                    other: "Set up on {{created}} of {{count}} resources",
                  },
                  row.counts.total,
                  { created: translator.formatNumber(row.counts.created) },
                )}
                {row.counts.dismissed > 0
                  ? ` · ${translator.translatePlural(
                      {
                        one: "{{count}} dismissed",
                        other: "{{count}} dismissed",
                      },
                      row.counts.dismissed,
                    )}`
                  : ""}
              </span>
              <span className="text-gray-300" aria-hidden="true">
                <InlineSeparator markOnly />
              </span>
              <button
                type="button"
                className="rounded-sm font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                aria-expanded={isExpanded}
                aria-controls={listId}
                data-testid={`cloud-account-recommendation-toggle-${row.recommendationId}`}
                onClick={() => {
                  toggleRow(rowKey);
                }}
              >
                {translator.translateText(
                  isExpanded ? "Hide resources" : "Show resources",
                )}
              </button>
            </div>
          </div>
          {available.length > 0 ? (
            renderAddButton({
              targets: available,
              title: translator.translatePlural(
                {
                  one: "Add to {{count}} Resource",
                  other: "Add to {{count}} Resources",
                },
                available.length,
              ),
              ariaLabel: translator.translatePlural(
                {
                  one: "Add {{name}} to the {{count}} resource still without it",
                  other:
                    "Add {{name}} to the {{count}} resources still without it",
                },
                available.length,
                { name: getAlertTemplateName(translator, row) },
              ),
              dataTestId: `cloud-account-recommendation-add-${row.recommendationId}`,
              buttonStyle: ButtonStyleType.OUTLINE,
            })
          ) : (
            <div className="flex-none">
              <StatusBadge
                text={
                  row.counts.created === row.counts.total
                    ? "All set up"
                    : "Nothing to add"
                }
                type={
                  row.counts.created === row.counts.total
                    ? StatusBadgeType.Success
                    : StatusBadgeType.Neutral
                }
              />
            </div>
          )}
        </div>
        {isExpanded ? (
          <ul
            id={listId}
            className="mt-3 divide-y divide-gray-100 rounded-md border border-gray-200 bg-white"
          >
            {row.targets.map((target: CloudAccountRecommendationTarget) => {
              return renderTarget(row, target);
            })}
          </ul>
        ) : (
          <></>
        )}
      </li>
    );
  };

  type RenderGroupFunction = (
    group: CloudAccountRecommendationGroup,
  ) => ReactElement;

  const renderGroup: RenderGroupFunction = (
    group: CloudAccountRecommendationGroup,
  ): ReactElement => {
    // The whole type, whatever the filter shows: Add all adds every one.
    const whole: CloudAccountRecommendationGroup =
      groups.find((candidate: CloudAccountRecommendationGroup): boolean => {
        return candidate.key === group.key;
      }) || group;
    const available: Array<CloudAccountRecommendationTarget> =
      CloudAccountRecommendationPlan.getAvailableTargets(whole);
    /*
     * Add all only where it adds more than one row's Add: with a single
     * row still to set up, the row's own button is that one action.
     */
    const rowsToSetUp: number = whole.rows.filter(
      (row: CloudAccountRecommendationRow): boolean => {
        return row.counts.available > 0;
      },
    ).length;

    return (
      <section
        key={group.key}
        className="overflow-hidden rounded-lg border border-gray-200 bg-white"
        data-testid={`cloud-account-recommendation-group-${group.key}`}
      >
        <div
          className={`flex flex-col gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 ${WIDE_ROW} [@container(min-width:36rem)]:items-center`}
        >
          <div className="min-w-0">
            <h3 className="break-words text-sm font-semibold text-gray-900">
              <IsolatedText text={group.label} />
            </h3>
            {/*
             * The resources of the type it recommends monitors for: one
             * whose metrics have not arrived, or that no recommended
             * monitor is for, is named at the end instead - so this is
             * never the type's count in the account.
             */}
            <p className="mt-0.5 text-xs text-gray-500">
              {translator.translatePlural(
                {
                  one: "Recommended for {{count}} resource",
                  other: "Recommended for {{count}} resources",
                },
                whole.resources.length,
              )}
            </p>
          </div>
          {rowsToSetUp > 1 ? (
            renderAddButton({
              targets: available,
              title: translator.translatePlural(
                {
                  one: "Add {{count}} Monitor",
                  other: "Add All {{count}} Monitors",
                },
                available.length,
              ),
              ariaLabel: translator.translatePlural(
                {
                  one: "Add the {{count}} monitor still to set up on {{type}}",
                  other:
                    "Add the {{count}} monitors still to set up on {{type}}",
                },
                available.length,
                { type: group.label },
              ),
              dataTestId: `cloud-account-recommendation-add-all-${group.key}`,
              /*
               * Outlined, as each row's Add: sized to its words at every
               * width. A plain button fills a phone's width, and the one
               * wide Add among its rows' read as a different kind of thing.
               */
              buttonStyle: ButtonStyleType.OUTLINE,
            })
          ) : (
            <></>
          )}
        </div>
        <ul className="divide-y divide-gray-100">
          {group.rows.map((row: CloudAccountRecommendationRow) => {
            return renderRow(group, row);
          })}
        </ul>
      </section>
    );
  };

  type RenderNotListedFunction = () => ReactElement;

  /*
   * The account's resources this list leaves out, by why, each by name and
   * a click from its own Recommendations tab, which says the rest: at the
   * end, after what there is to do.
   */
  const renderNotListed: RenderNotListedFunction = (): ReactElement => {
    const reasons: Array<CloudAccountRecommendationGapReason> =
      NOT_LISTED_REASONS.filter(
        (reason: CloudAccountRecommendationGapReason): boolean => {
          return gaps.byReason[reason].length > 0;
        },
      );
    const isCut: boolean = resourceTotal > resources.length;

    if (reasons.length === 0 && !isCut) {
      return <></>;
    }

    return (
      <section
        className="rounded-lg border border-dashed border-gray-300 px-4 py-3"
        data-testid="cloud-account-recommendations-not-listed"
      >
        <h3 className="text-sm font-medium text-gray-900">
          {translator.translateText("Not in this list")}
        </h3>
        <ul className="mt-2 space-y-3">
          {reasons.map((reason: CloudAccountRecommendationGapReason) => {
            const listed: Array<CloudAccountRecommendationGap> =
              gaps.byReason[reason];
            const shown: Array<CloudAccountRecommendationGap> = listed.slice(
              0,
              NOT_LISTED_NAMES_SHOWN,
            );

            return (
              <li
                key={reason}
                data-testid={`cloud-account-recommendations-not-listed-${reason}`}
              >
                <p className="text-xs text-gray-600">
                  {translator.translateText(NOT_LISTED_REASON_TEXT[reason])}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {shown.map((gap: CloudAccountRecommendationGap) => {
                    return (
                      <UILink
                        key={gap.resource.resourceId}
                        to={getResourceRoute(
                          gap.resource.resourceId,
                          NOT_LISTED_RESOURCE_PAGES[reason],
                        )}
                        className="inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-200 hover:text-gray-900"
                      >
                        <bdi className="min-w-0 break-words font-medium">
                          {gap.resource.resourceName}
                        </bdi>
                        <span className="min-w-0 text-gray-500">
                          <IsolatedText text={gap.typeLabel} />
                        </span>
                      </UILink>
                    );
                  })}
                  {listed.length > shown.length ? (
                    <span className="px-1 py-0.5 text-xs text-gray-500">
                      {translator.translatePlural(
                        {
                          one: "and {{count}} more",
                          other: "and {{count}} more",
                        },
                        listed.length - shown.length,
                      )}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
              </li>
            );
          })}
          {isCut ? (
            <li className="text-xs text-gray-600">
              {translator.translateTemplate(
                "Only the first {{shown}} of the account's {{total}} resources are read here.",
                {
                  shown: translator.formatNumber(resources.length),
                  total: translator.formatNumber(resourceTotal),
                },
              )}
            </li>
          ) : (
            <></>
          )}
        </ul>
      </section>
    );
  };

  type GetEmptyStateFunction = () => ReactElement;

  const getEmptyState: GetEmptyStateFunction = (): ReactElement => {
    if (resources.length === 0) {
      return (
        <EmptyState
          id="cloud-account-recommendations-no-resources"
          icon={IconProp.Cloud}
          title="No resources in this account yet"
          description="Recommendations appear once a cloud connection lists the account's resources and reads their metrics."
          paddingClassName="py-12"
        />
      );
    }

    if (counts.total === 0) {
      return (
        <EmptyState
          id="cloud-account-recommendations-none"
          icon={IconProp.Sparkles}
          title="No recommendations for this account's resources yet"
          description="The list below says why for each resource. You can still create monitors by hand."
          paddingClassName="py-12"
        />
      );
    }

    if (
      counts.available === 0 &&
      filterState.status === RecommendationStatusFilter.Available &&
      !filterState.searchText &&
      filterState.severity === RecommendationSeverityFilter.All
    ) {
      return (
        <EmptyState
          id="cloud-account-recommendations-all-handled"
          icon={IconProp.CheckCircle}
          title="Nothing left to set up here"
          description={translator.translatePlural(
            {
              one: "The {{count}} recommended monitor for this account's resources has been created or dismissed. Use the tiles above to review it.",
              other:
                "All {{count}} recommended monitors for this account's resources have been created or dismissed. Use the tiles above to review them.",
            },
            counts.total,
          )}
          paddingClassName="py-12"
        />
      );
    }

    return (
      <EmptyState
        id="cloud-account-recommendations-no-match"
        icon={IconProp.Search}
        title="No recommendations match these filters"
        description="Try a different search term, or switch the severity and status filters back to show everything."
        paddingClassName="py-12"
      />
    );
  };

  const pendingRecommendations: Array<MonitorRecommendation> = (
    pendingCreate?.targets || []
  ).map((target: CloudAccountRecommendationTarget): MonitorRecommendation => {
    return target.recommendation;
  });

  const pendingResourceCount: number = new Set<string>(
    (pendingCreate?.targets || []).map(
      (target: CloudAccountRecommendationTarget): string => {
        return target.resource.resourceId;
      },
    ),
  ).size;

  return (
    <Fragment>
      {/*
       * Every recommended monitor is a non-Manual monitor, and this creates
       * them by the dozen - so a Free plan project sees the rate here too,
       * and acknowledges it in the panel before the run starts.
       */}
      <MonitorPayAsYouGoCard />
      <Card title="Recommended Monitors" description={cardDescription}>
        <div
          className="space-y-6 [container-type:inline-size]"
          data-testid="cloud-account-recommendations"
        >
          {actionError ? <ErrorMessage message={actionError} /> : <></>}

          {/*
           * A member whose role may not create monitors is told once, at
           * the top, rather than only on each Add's hover: a phone has none.
           */}
          {createLockReason && counts.available > 0 ? (
            <div
              className="flex items-start gap-2 text-sm text-gray-600"
              data-testid="cloud-account-recommendations-locked"
            >
              <Icon
                icon={IconProp.Lock}
                className="mt-0.5 h-4 w-4 flex-none text-gray-400"
              />
              <span>{createLockReason}</span>
            </div>
          ) : (
            <></>
          )}

          {counts.total > 0 ? (
            <RecommendationToolbar
              counts={counts}
              filterState={filterState}
              isDisabled={isRunning}
              onFilterStateChange={setFilterState}
            />
          ) : (
            <></>
          )}

          {visibleGroups.length === 0 ? (
            getEmptyState()
          ) : (
            <div className="space-y-4">
              {visibleGroups.map((group: CloudAccountRecommendationGroup) => {
                return renderGroup(group);
              })}
            </div>
          )}

          {renderNotListed()}
        </div>
      </Card>

      {pendingCreate && setup ? (
        <MonitorRecommendationCreateSideOver
          selectedRecommendations={pendingRecommendations}
          monitorNames={pendingCreate.targets.map(
            (target: CloudAccountRecommendationTarget): string => {
              return MonitorRecommendationUtil.getMonitorName({
                recommendation: target.recommendation,
                resourceDisplayName: target.resource.resourceName,
              });
            },
          )}
          resourceLabel="Cloud Resource"
          description={translator.translatePlural(
            {
              one: "These monitors will be created on {{count}} resource of this account. Everything below applies to all of them.",
              other:
                "These monitors will be created on {{count}} resources of this account. Everything below applies to all of them.",
            },
            pendingResourceCount,
          )}
          onCallPolicyDropdownOptions={setup.onCallPolicyDropdownOptions}
          labelDropdownOptions={setup.labelDropdownOptions}
          incidentSeverityOptions={setup.incidentSeverityOptions}
          alertSeverityOptions={setup.alertSeverityOptions}
          isCreating={isStarting}
          error={panelError || undefined}
          limitReached={limitReached || undefined}
          onClose={() => {
            if (!isStarting) {
              setPendingCreate(null);
            }
          }}
          onSubmit={(
            notificationSettings: MonitorRecommendationNotificationSettings,
            hasAcknowledgedBilling: boolean,
          ) => {
            createMonitors({
              targets: pendingCreate.targets,
              notificationSettings: notificationSettings,
              hasAcknowledgedBilling: hasAcknowledgedBilling,
            }).catch((err: Error) => {
              setIsStarting(false);
              setActionError(API.getFriendlyMessage(err));
            });
          }}
        />
      ) : (
        <></>
      )}

      {progress.dialog}
    </Fragment>
  );
};

export default CloudAccountMonitorRecommendations;
