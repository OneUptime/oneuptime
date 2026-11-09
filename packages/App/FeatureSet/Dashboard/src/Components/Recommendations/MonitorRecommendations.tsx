import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";

import Monitor from "Common/Models/DatabaseModels/Monitor";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";

import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import RecommendationType from "Common/Types/Recommendation/RecommendationType";
import MonitorRecommendationCatalog, {
  MonitorRecommendationResourceTypeDefinition,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil from "Common/Types/Monitor/Recommendation/MonitorRecommendationUtil";
import { MonitorRecommendationSeverityOption } from "Common/Types/Monitor/Recommendation/MonitorRecommendationSeverityMapper";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationContext,
  MonitorRecommendationNotificationSettings,
  MonitorRecommendationResourceType,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

import RecommendationsList from "./RecommendationsList";
import RecommendationToolbar from "./RecommendationToolbar";
import RecommendationFilterUtil, {
  RECOMMENDATION_SELECTION_QUERY_PARAM,
} from "./RecommendationFilterUtil";
import RecommendationDismissalUtil from "./RecommendationDismissalUtil";
import {
  CREATE_MONITORS_LOCKED_SENTENCE,
  loadMonitorRecommendationProjectSetup,
  MonitorRecommendationProjectDefaults,
  MonitorRecommendationProjectSetup,
} from "./MonitorRecommendationProjectSetup";
import MonitorRecommendationCreateSideOver from "./MonitorRecommendationCreateSideOver";
import { notifyRecommendationsChanged } from "./RecommendationsChanged";
import MonitorRecommendationCreateProgressPanel from "./MonitorRecommendationCreateProgress";
import {
  MONITOR_CONSENT_ERROR,
  MonitorPayAsYouGoCard,
  isMonitorBatchConsentRequired,
} from "../Billing/PayAsYouGo";
import MonitorRecommendationCreateUtil, {
  MonitorRecommendationCreatePlanItem,
} from "./MonitorRecommendationCreateUtil";
import MonitorRecommendationCreateRunner, {
  MonitorRecommendationCreateOutcome,
  MonitorRecommendationCreateProgress,
} from "./MonitorRecommendationCreateRunner";
import {
  RecommendationCategoryGroup,
  RecommendationCounts,
  RecommendationFilterState,
  RecommendationSeverityFilter,
  RecommendationStatusFilter,
  RecommendationViewModel,
} from "./RecommendationViewModel";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  bringPageAnchorIntoView,
  givePageAnchorFocus,
} from "Common/UI/Utils/PageAnchor";
import {
  translatableTerm,
  TranslatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { ActiveMonitorLimitStatus } from "Common/Types/Monitor/ActiveMonitorLimit";
import { readActiveMonitorLimitIfReached } from "../Monitor/ActiveMonitorLimitNotice";
import { orderAlertTemplateCategories } from "../Form/Monitor/AlertTemplatePicker/AlertTemplateCategories";
import { getAlertTemplateName } from "../Form/Monitor/AlertTemplatePicker/AlertTemplateGroups";

export interface ComponentProps {
  resourceType: MonitorRecommendationResourceType;
  /*
   * The value the monitor's step is scoped to — a cluster identifier, host
   * identifier or fleet identifier depending on the resource type. Must be the
   * SAME value existing monitors were created with, or the already-created
   * diff finds nothing.
   */
  resourceIdentifier: string;
  // Used to name created monitors, e.g. "prod-cluster - Node Not Ready".
  resourceDisplayName: string;
  // The resource's own row id. Dismissals are scoped to it.
  resourceId: ObjectID;
  /*
   * What the caller knows about this specific resource that narrows the
   * catalog — today, a service's detected runtime. Optional because eight of
   * the ten resource types have nothing to narrow by, and omitting it yields
   * the subset that is true of every resource of the type.
   */
  resourceContext?: MonitorRecommendationContext | undefined;
  /*
   * One sentence saying what the context did to the list, shown above it.
   * Undefined for the resource types whose list is a constant — there is
   * nothing to explain there.
   */
  resourceContextNote?: string | undefined;
  /*
   * What the card says the recommendations are drawn from, when it is not
   * what an agent sends (RecommendationResourceDefinition
   * .getCardDescription): a cloud resource's come from what its cloud's
   * monitoring reports about it. Already in the reader's language.
   */
  cardDescription?: string | undefined;
  /*
   * What each created monitor is linked to beside its scope
   * (RecommendationResourceDefinition.linkCreatedMonitor): a cloud
   * resource's carry it in their Linked Resources.
   */
  linkCreatedMonitor?: ((monitor: Monitor) => void) | undefined;
}

type ProjectDefaults = MonitorRecommendationProjectDefaults;

/*
 * An empty list's padding inside the card, as a cloud account's
 * Recommendations has it: EmptyState's own 13rem is a whole page's, and
 * under a note or the tiles it pushed its words off a laptop's screen.
 */
export const EMPTY_LIST_PADDING_CLASS_NAME: string = "py-12";

const MonitorRecommendations: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");

  /*
   * The plan's limit on active monitors, when the project has no room for
   * any: the create panel says so above its form and starts nothing. Read
   * as the panel opens, and again when Create is pressed.
   */
  const [limitReached, setLimitReached] =
    useState<ActiveMonitorLimitStatus | null>(null);

  /*
   * Which read of the limit an answer belongs to: the newest wins, so a
   * slow read from when the panel opened never overwrites the one Create
   * made after it.
   */
  const limitReadSequence: React.MutableRefObject<number> = useRef<number>(0);

  /*
   * The limit, read now; null when the project has room, has no limit, or
   * it cannot be read. Never rejects. An answer a newer read has overtaken
   * is dropped.
   */
  type ReadLimitFunction = () => Promise<ActiveMonitorLimitStatus | null>;

  const readLimit: ReadLimitFunction =
    async (): Promise<ActiveMonitorLimitStatus | null> => {
      limitReadSequence.current += 1;
      const sequence: number = limitReadSequence.current;

      const status: ActiveMonitorLimitStatus | null =
        await readActiveMonitorLimitIfReached();

      if (sequence === limitReadSequence.current) {
        setLimitReached(status);
      }

      return status;
    };

  const [projectDefaults, setProjectDefaults] =
    useState<ProjectDefaults | null>(null);

  const [coveredMonitorIds, setCoveredMonitorIds] = useState<
    Map<string, ObjectID>
  >(new Map<string, ObjectID>());
  const [dismissals, setDismissals] = useState<Array<RecommendationDismissal>>(
    [],
  );
  /*
   * `?select=<id>,<id>` ticks those recommendations as the page opens, so a
   * link can hand over a batch that is one button away from created: an ESXi
   * host's "Turn on N alerts" opens its vCenter's list with the host alerts
   * not yet on ticked. Ids that are not on the list, or that are created or
   * dismissed by then, are never counted (getSelectableViewModels). The
   * first render only, like `?search=` and `?status=` below.
   */
  const [selectedRecommendationIds, setSelectedRecommendationIds] = useState<
    Set<string>
  >((): Set<string> => {
    return RecommendationFilterUtil.parseSelectionQuery(
      Navigation.getQueryStringByName(RECOMMENDATION_SELECTION_QUERY_PARAM),
    );
  });

  /*
   * `?search=` pre-fills the search box and `?status=` the status filter, so
   * another page can link straight to a slice of this one: the Replay Health
   * page's "Set up alerts" opens a RUM application's list on its storage
   * budget alerts (`?search=budget&status=All`). They seed the first render
   * only; from then on the filters are the user's.
   */
  const [filterState, setFilterState] = useState<RecommendationFilterState>(
    (): RecommendationFilterState => {
      const statusFromUrl: string | null =
        Navigation.getQueryStringByName("status");

      return {
        searchText: Navigation.getQueryStringByName("search") || "",
        /*
         * Opens on the not-yet-set-up subset unless the link says otherwise.
         * This page's job is "what still needs doing here"; opening on All
         * means a cluster with every monitor already created renders eighteen
         * greyed-out cards and the user has to work out that there is nothing
         * to do. A link to a handful of named alerts is the exception: opened
         * on Available after they were created, it would show an empty list.
         */
        status: Object.values(RecommendationStatusFilter).includes(
          statusFromUrl as RecommendationStatusFilter,
        )
          ? (statusFromUrl as RecommendationStatusFilter)
          : RecommendationStatusFilter.Available,
        severity: RecommendationSeverityFilter.All,
      };
    },
  );

  const [onCallPolicyDropdownOptions, setOnCallPolicyDropdownOptions] =
    useState<Array<DropdownOption>>([]);
  const [labelDropdownOptions, setLabelDropdownOptions] = useState<
    Array<DropdownOption>
  >([]);
  const [incidentSeverityOptions, setIncidentSeverityOptions] = useState<
    Array<MonitorRecommendationSeverityOption>
  >([]);
  const [alertSeverityOptions, setAlertSeverityOptions] = useState<
    Array<MonitorRecommendationSeverityOption>
  >([]);

  const [showCreateSideOver, setShowCreateSideOver] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [createProgress, setCreateProgress] =
    useState<MonitorRecommendationCreateProgress | null>(null);

  const [dismissTarget, setDismissTarget] =
    useState<RecommendationViewModel | null>(null);
  const [dismissalReason, setDismissalReason] = useState<string>("");
  const [isDismissing, setIsDismissing] = useState<boolean>(false);

  const definition: MonitorRecommendationResourceTypeDefinition | undefined =
    MonitorRecommendationCatalog.getResourceTypeDefinition(props.resourceType);

  const recommendations: Array<MonitorRecommendation> =
    MonitorRecommendationCatalog.getRecommendations(
      props.resourceType,
      props.resourceContext,
    );

  /*
   * Categories come from the same call so the section headings and the cards
   * under them describe the same set. Deriving them from the unfiltered
   * catalog instead would render an empty "JVM Runtime" heading on a Go
   * service — `groupByCategory` drops empty categories, so it would not
   * actually break, but the two would be answering different questions.
   * They come in the order Create Monitor's Quick Setup lists the same
   * templates under the same headings (orderAlertTemplateCategories).
   */
  const categories: Array<string> = orderAlertTemplateCategories(
    props.resourceType,
    MonitorRecommendationCatalog.getCategories(
      props.resourceType,
      props.resourceContext,
    ),
  );

  type BuildArgsFunction = (
    defaults: ProjectDefaults,
  ) => MonitorRecommendationArgs;

  const buildArgs: BuildArgsFunction = (
    defaults: ProjectDefaults,
  ): MonitorRecommendationArgs => {
    return {
      resourceIdentifier: props.resourceIdentifier,
      onlineMonitorStatusId: defaults.onlineMonitorStatusId,
      offlineMonitorStatusId: defaults.offlineMonitorStatusId,
      defaultIncidentSeverityId: defaults.defaultIncidentSeverityId,
      defaultAlertSeverityId: defaults.defaultAlertSeverityId,
      monitorName: props.resourceDisplayName,
    };
  };

  type LoadFunction = () => Promise<void>;

  const load: LoadFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      /*
       * The statuses and severities every recommended monitor is built
       * with, and what the create panel offers - read as a cloud account's
       * Recommendations reads them (MonitorRecommendationProjectSetup).
       */
      const setup: MonitorRecommendationProjectSetup =
        await loadMonitorRecommendationProjectSetup(translator);

      const defaults: ProjectDefaults = setup.defaults;

      setProjectDefaults(defaults);
      setIncidentSeverityOptions(setup.incidentSeverityOptions);
      setAlertSeverityOptions(setup.alertSeverityOptions);
      setOnCallPolicyDropdownOptions(setup.onCallPolicyDropdownOptions);
      setLabelDropdownOptions(setup.labelDropdownOptions);

      await Promise.all([loadCoverage(defaults), loadDismissals()]);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  type LoadCoverageFunction = (defaults: ProjectDefaults) => Promise<void>;

  const loadCoverage: LoadCoverageFunction = async (
    defaults: ProjectDefaults,
  ): Promise<void> => {
    if (!definition) {
      return;
    }

    /*
     * Only the monitor types used by this resource's catalog can cover a
     * recommendation. Most resources have one; RUM deliberately spans metric,
     * trace and exception monitors. Keep the queries narrow without assuming
     * a resource maps to exactly one evaluator.
     */
    const monitorLists: Array<ListResult<Monitor>> = await Promise.all(
      definition.monitorTypes.map(async (monitorType: MonitorType) => {
        return await ModelAPI.getList({
          modelType: Monitor,
          query: { monitorType: monitorType },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: { name: true, monitorSteps: true },
          sort: { name: SortOrder.Ascending },
        });
      }),
    );

    const monitors: Array<Monitor> = monitorLists.flatMap(
      (monitorList: ListResult<Monitor>) => {
        return monitorList.data;
      },
    );

    setCoveredMonitorIds(
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: recommendations,
        existingMonitors: monitors
          .filter((monitor: Monitor) => {
            return Boolean(monitor.id);
          })
          .map((monitor: Monitor) => {
            return {
              monitorId: monitor.id!,
              monitorSteps:
                MonitorRecommendationCreateUtil.getExistingMonitorSteps([
                  monitor,
                ]) as Array<MonitorStep>,
            };
          }),
        args: buildArgs(defaults),
      }),
    );
  };

  type LoadDismissalsFunction = () => Promise<void>;

  const loadDismissals: LoadDismissalsFunction = async (): Promise<void> => {
    setDismissals(
      await RecommendationDismissalUtil.getDismissals({
        resourceType: props.resourceType,
        resourceId: props.resourceId,
        recommendationType: RecommendationType.Monitor,
      }),
    );
  };

  useAsyncEffect(async () => {
    await load();
    /*
     * `resourceId` belongs here alongside the identifier because dismissals
     * are scoped by id, not by identifier — deliberately, so that renaming a
     * resource keeps its dismissals. Two resources of the same type reporting
     * the same identifier string (a cloned host, a restored cluster) would
     * otherwise show each other's dismissed cards.
     */
  }, [
    props.resourceType,
    props.resourceIdentifier,
    props.resourceId.toString(),
  ]);

  /*
   * Opens the create panel - from the card's header or the bar pinned under
   * the list - and reads the plan's limit on active monitors as it opens: a
   * project with no room is told so at once, above the form, before anyone
   * fills it in.
   */
  type OpenCreatePanelFunction = () => void;

  const openCreatePanel: OpenCreatePanelFunction = (): void => {
    setActionError("");
    setLimitReached(null);
    setShowCreateSideOver(true);

    // Never rejects: a limit it cannot read is no limit here.
    void readLimit();
  };

  /*
   * Takes the ids explicitly rather than reading the derived
   * `selectedRecommendations` below it. Both would work — the handler only
   * fires from a render that got past the early returns — but a create path
   * that silently depends on where in the function body a `const` happens to
   * sit is one refactor away from creating the wrong monitors.
   */
  type CreateFunction = (
    notificationSettings: MonitorRecommendationNotificationSettings,
    creatableRecommendationIds: Array<string>,
    hasAcknowledgedBilling: boolean,
  ) => Promise<void>;

  const createMonitors: CreateFunction = async (
    notificationSettings: MonitorRecommendationNotificationSettings,
    creatableRecommendationIds: Array<string>,
    hasAcknowledgedBilling: boolean,
  ): Promise<void> => {
    if (!projectDefaults) {
      return;
    }

    setIsCreating(true);
    setActionError("");
    setCreateProgress(null);

    const plan: Array<MonitorRecommendationCreatePlanItem> =
      MonitorRecommendationCreateUtil.buildCreatePlan({
        recommendations: recommendations,
        selectedRecommendationIds: creatableRecommendationIds,
        args: buildArgs(projectDefaults),
        resourceDisplayName: props.resourceDisplayName,
        defaultMonitorStatusId: projectDefaults.defaultMonitorStatusId,
        notificationSettings: notificationSettings,
        linkMonitor: props.linkCreatedMonitor,
      });

    /*
     * The side over already disables its submit until this is ticked. Repeated
     * here so the charge cannot be started by a caller that skips the side
     * over - this loop is the only place in the dashboard that creates
     * monitors without a ModelForm to validate first.
     */
    if (
      !hasAcknowledgedBilling &&
      isMonitorBatchConsentRequired(
        plan.map((item: MonitorRecommendationCreatePlanItem) => {
          return item.monitor.monitorType as MonitorType;
        }),
      )
    ) {
      setActionError(MONITOR_CONSENT_ERROR);
      setIsCreating(false);
      return;
    }

    /*
     * A project with no room under its plan's limit on active monitors can
     * create none of the recommended monitors: said once, with the limit's
     * notice in the panel, and the batch never starts - rather than every
     * row refused in the same words. With some room left the batch runs, and
     * the server refuses the creates past it one by one (ActiveMonitorLimit).
     */
    if (
      plan.some((item: MonitorRecommendationCreatePlanItem): boolean => {
        return MonitorTypeHelper.isBilledAsActiveMonitor(
          item.monitor.monitorType as MonitorType,
        );
      })
    ) {
      const limitStatus: ActiveMonitorLimitStatus | null = await readLimit();

      if (limitStatus) {
        setIsCreating(false);
        return;
      }
    }

    /*
     * Render the full list of pending rows before the first request goes out,
     * so pressing Create has an immediate visible effect. The previous text
     * banner only appeared once one monitor had already been created, which
     * put the longest silence of the whole operation at its very beginning.
     */
    setCreateProgress(
      MonitorRecommendationCreateRunner.getInitialProgress(plan),
    );

    /*
     * The loop itself lives in MonitorRecommendationCreateRunner: it is the
     * only part of this page a user watches happen, and a loop inside a .tsx
     * cannot be tested in a suite that has no renderer. The API call stays
     * here — the model type and the create form type are what the billing
     * sweep looks for, and they belong next to the consent check above.
     */
    const finalProgress: MonitorRecommendationCreateProgress =
      await MonitorRecommendationCreateRunner.run({
        plan: plan,
        onProgress: (progress: MonitorRecommendationCreateProgress) => {
          setCreateProgress(progress);
        },
        createMonitor: async (
          item: MonitorRecommendationCreatePlanItem,
        ): Promise<MonitorRecommendationCreateOutcome> => {
          try {
            await ModelAPI.createOrUpdate({
              model: item.monitor,
              modelType: Monitor,
              formType: FormType.Create,
              miscDataProps: item.miscDataProps,
            });

            return { isCreated: true };
          } catch (err) {
            return {
              isCreated: false,
              errorMessage: API.getFriendlyMessage(err),
            };
          }
        },
      });

    setIsCreating(false);

    /*
     * Only a clean run closes the panel. When something failed, the panel is
     * the only place the per-monitor reasons are written down — closing it
     * would replace them with a single error line and no way to see which of
     * eighteen monitors is missing.
     */
    if (finalProgress.failedCount === 0) {
      setShowCreateSideOver(false);
      setCreateProgress(null);
      setSelectedRecommendationIds(new Set<string>());
    } else {
      setActionError(
        MonitorRecommendationCreateRunner.getSummaryText(finalProgress),
      );

      /*
       * Drop the ones that landed from the selection. Leaving them selected
       * would offer to create them a second time, which silently produces
       * duplicate monitors.
       */
      setSelectedRecommendationIds(
        MonitorRecommendationCreateRunner.getUnsuccessfulRecommendationIds({
          progress: finalProgress,
          selectedRecommendationIds: selectedRecommendationIds,
        }),
      );
    }

    try {
      await loadCoverage(projectDefaults);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    // The side menu's badge counts what is left again.
    notifyRecommendationsChanged();
  };

  type DismissFunction = () => Promise<void>;

  const confirmDismiss: DismissFunction = async (): Promise<void> => {
    if (!dismissTarget) {
      return;
    }

    setIsDismissing(true);
    setActionError("");

    try {
      await RecommendationDismissalUtil.dismiss({
        recommendationId: dismissTarget.recommendation.recommendationId,
        recommendationType: dismissTarget.recommendation.recommendationType,
        resourceType: props.resourceType,
        resourceId: props.resourceId,
        dismissalReason: dismissalReason,
      });

      /*
       * A dismissed recommendation cannot also be pending creation. Leaving it
       * selected would keep it in the batch the Create button counts, and the
       * user would be told they are about to create a monitor for something
       * they just hid.
       */
      const selected: Set<string> = new Set<string>(selectedRecommendationIds);
      selected.delete(dismissTarget.recommendation.recommendationId);
      setSelectedRecommendationIds(selected);

      await loadDismissals();
      notifyRecommendationsChanged();
      setDismissTarget(null);
      setDismissalReason("");
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setIsDismissing(false);
  };

  type RestoreFunction = (viewModel: RecommendationViewModel) => Promise<void>;

  const restore: RestoreFunction = async (
    viewModel: RecommendationViewModel,
  ): Promise<void> => {
    if (!viewModel.dismissalId) {
      return;
    }

    setActionError("");

    try {
      await RecommendationDismissalUtil.restore(viewModel.dismissalId);
      await loadDismissals();
      notifyRecommendationsChanged();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }
  };

  /*
   * A link that ticks recommendations (`?select=`) lands on them. The page
   * opens at the scroll position the link was clicked from - an ESXi host's
   * "Turn on N alerts" sits far down the host's page - which showed the
   * datacenter cards with the ticked host alerts out of sight above. So once
   * the list is first drawn, the first ticked card is brought into view.
   * Nothing can be ticked by hand before the list is drawn, so what is
   * ticked then is what the link ticked (none without one).
   *
   * It is kept in view while the page settles (bringPageAnchorIntoView):
   * the list is drawn before it is laid out - the styles of the classes a
   * page draws for the first time (the grid's two columns, the cards'
   * padding) arrive a frame or more after it - and the cards above the
   * ticked one grow as they do. Scrolled to once, at the moment the list
   * was drawn, a card at the end of the list (a cluster's Warning Events,
   * under Events) ended half a window under the bottom edge.
   */
  const hasShownLinkedSelection: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  // What stops keeping the ticked card in view: the page going away.
  const stopShowingLinkedSelection: React.MutableRefObject<
    (() => void) | null
  > = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      stopShowingLinkedSelection.current?.();
      stopShowingLinkedSelection.current = null;
    };
  }, []);

  useEffect(() => {
    if (isLoading || hasShownLinkedSelection.current) {
      return;
    }

    hasShownLinkedSelection.current = true;

    const linked: Set<string> = selectedRecommendationIds;

    if (linked.size === 0) {
      return;
    }

    /*
     * The first card, in the page's order, of a ticked recommendation. Read
     * by comparing each card's own id - never a selector built from the
     * address, which a pasted link could fill with anything.
     */
    const prefix: string = "recommendation-card-";
    const firstCard: HTMLElement | undefined = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"]`),
    ).find((card: HTMLElement): boolean => {
      return linked.has(
        (card.getAttribute("data-testid") || "").slice(prefix.length),
      );
    });

    if (!firstCard) {
      return;
    }

    stopShowingLinkedSelection.current = bringPageAnchorIntoView(firstCard, {
      block: "center",
    });

    /*
     * And the keyboard's focus, when nothing holds it - the link that was
     * followed went away with its page - as a link to a place on a page
     * gives it: Tab goes on from the ticked card, to its own select button,
     * not from the top of the page, scrolled back to; and a screen reader
     * reads where the page went. The card takes it, not its select button,
     * so a Space pressed to scroll the page never unticks it. Being ticked
     * is its mark: it is not tinted as a landed setting is.
     */
    givePageAnchorFocus(firstCard);
  }, [isLoading]);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!definition) {
    return (
      <ErrorMessage
        message={translator.translateTemplate(
          "No monitor recommendations are available for {{resourceType}}.",
          { resourceType: props.resourceType },
        )}
      />
    );
  }

  // The resource's noun as it reads in the middle of a sentence.
  const resourceName: TranslatableTerm = translatableTerm(
    definition.resourceLabel,
    { inSentence: true },
  );

  if (!props.resourceIdentifier) {
    return (
      <EmptyState
        id="monitor-recommendations-no-identifier"
        icon={IconProp.Alert}
        title="No telemetry yet"
        description={translator.translateTemplate(
          "This {{resourceName}} has not sent data yet. Recommendations appear once its agent reports.",
          { resourceName: resourceName },
        )}
      />
    );
  }

  const viewModels: Array<RecommendationViewModel> =
    RecommendationFilterUtil.buildViewModels({
      recommendations: recommendations,
      coveredMonitorIds: coveredMonitorIds,
      dismissals: dismissals,
    });

  const counts: RecommendationCounts =
    RecommendationFilterUtil.getCounts(viewModels);

  const groups: Array<RecommendationCategoryGroup> =
    RecommendationFilterUtil.groupByCategory({
      viewModels: RecommendationFilterUtil.filter({
        viewModels: viewModels,
        filterState: filterState,
        translator: translator,
      }),
      categories: categories,
    });

  const selectedRecommendations: Array<RecommendationViewModel> =
    RecommendationFilterUtil.getSelectableViewModels({
      viewModels: viewModels,
      selectedRecommendationIds: selectedRecommendationIds,
    });

  const selectedCriticalCount: number = selectedRecommendations.filter(
    (viewModel: RecommendationViewModel) => {
      return viewModel.recommendation.severity === "Critical";
    },
  ).length;

  const selectedWarningCount: number =
    selectedRecommendations.length - selectedCriticalCount;

  /*
   * Whether the person may create monitors at all. A member whose role may
   * not still sees what is recommended and what is set up, and every Create
   * says why it is locked, as every Create of a monitor does
   * (PermissionGate); nothing is sent that the server would refuse. While
   * the permission snapshot is still loading there is nothing honest to
   * say, so the buttons stay as they are. Said of monitors, as the buttons
   * it locks make them, not "this Monitor".
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

  const createButton: CardButtonSchema = {
    /*
     * "Create 0 Selected" was the label the page wore most of the
     * time, since nothing is selected when it loads. A disabled
     * button counting to zero reads as broken rather than as waiting.
     */
    title:
      selectedRecommendations.length > 0
        ? translator.translateTemplate("Create {{count}} Selected", {
            count: translator.formatNumber(selectedRecommendations.length),
          })
        : "Create Monitors",
    icon: IconProp.Add,
    /*
     * Plain. Once anything is selected the bar pinned under the list
     * carries the same action as the page's one primary button, and
     * two filled "Create" buttons on one screen read as two different
     * things to do. With nothing selected the next step is to pick,
     * not to press.
     */
    buttonStyle: ButtonStyleType.NORMAL,
    disabled: selectedRecommendations.length === 0,
    tooltip:
      selectedRecommendations.length === 0
        ? "Pick at least one recommendation below first."
        : undefined,
    onClick: openCreatePanel,
  };

  /*
   * No Create at all while nothing is recommended: a button that can never
   * be pressed beside a list that says why it is empty is one more thing
   * to read.
   */
  const gatedCreateButton: CardButtonSchema | null =
    counts.total > 0
      ? PermissionGate.gateCardButton(
          createButton,
          new Monitor(),
          ModelAction.Create,
          { sentence: CREATE_MONITORS_LOCKED_SENTENCE },
        )
      : null;

  type GetMonitorRouteFunction = (monitorId: ObjectID) => Route;

  const getMonitorRoute: GetMonitorRouteFunction = (
    monitorId: ObjectID,
  ): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.MONITOR_VIEW] as Route,
      { modelId: monitorId },
    );
  };

  type GetEmptyStateFunction = () => ReactElement;

  const getEmptyState: GetEmptyStateFunction = (): ReactElement => {
    if (counts.total === 0) {
      /*
       * With a context note, the empty list is about THIS resource, not its
       * type — a database whose engine metrics have not arrived yet, or whose
       * engine has no library — and the note above already says why and what
       * would change it. "for this resource type" would contradict it.
       */
      if (props.resourceContextNote) {
        return (
          <EmptyState
            id="monitor-recommendations-none-for-resource"
            icon={IconProp.Sparkles}
            title={translator.translateTemplate(
              "No recommendations for this {{resourceName}} yet",
              { resourceName: resourceName },
            )}
            description="The note above explains why. You can still create monitors by hand."
            paddingClassName={EMPTY_LIST_PADDING_CLASS_NAME}
          />
        );
      }

      return (
        <EmptyState
          id="monitor-recommendations-none"
          icon={IconProp.Sparkles}
          title="No recommendations for this resource type yet"
          description="OneUptime does not ship a recommended monitor library for this resource type. You can still create monitors by hand."
          paddingClassName={EMPTY_LIST_PADDING_CLASS_NAME}
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
          id="monitor-recommendations-all-handled"
          icon={IconProp.CheckCircle}
          title="Nothing left to set up here"
          description={translator.translatePlural(
            {
              one: "The {{count}} recommended monitor for this {{resourceName}} has been created or dismissed. Use the tiles above to review it.",
              other:
                "All {{count}} recommended monitors for this {{resourceName}} have been created or dismissed. Use the tiles above to review them.",
            },
            counts.total,
            { resourceName: resourceName },
          )}
          paddingClassName={EMPTY_LIST_PADDING_CLASS_NAME}
        />
      );
    }

    return (
      <EmptyState
        id="monitor-recommendations-no-match"
        icon={IconProp.Search}
        title="No recommendations match these filters"
        description="Try a different search term, or switch the severity and status filters back to show everything."
        paddingClassName={EMPTY_LIST_PADDING_CLASS_NAME}
      />
    );
  };

  return (
    <Fragment>
      {/*
       * Recommendations only ever propose non-Manual monitors, and this is the
       * highest-volume way to create them - so a Free plan project sees the
       * rate here too, and acknowledges it in the side over before the batch
       * runs.
       */}
      <MonitorPayAsYouGoCard />
      <Card
        title="Recommended Monitors"
        description={
          props.cardDescription ||
          translator.translateTemplate(
            "Monitors OneUptime recommends for this {{resourceName}}, based on the telemetry the agent already sends. Pick the ones you want, choose who gets paged, and create them in one step.",
            { resourceName: resourceName },
          )
        }
        buttons={gatedCreateButton ? [gatedCreateButton] : []}
      >
        <div className="space-y-6">
          {actionError ? <ErrorMessage message={actionError} /> : <></>}

          {/*
           * The batch's progress, once the panel it started in has been
           * closed. Closing the drawer does not stop the run — the monitors
           * it has already created are real — so the report has to follow the
           * user rather than disappear with the drawer.
           */}
          {createProgress && !showCreateSideOver ? (
            <MonitorRecommendationCreateProgressPanel
              progress={createProgress}
            />
          ) : (
            <></>
          )}

          {/*
           * Rendered above the toolbar rather than folded into the card
           * description, because it is the answer to "why are there only
           * eight of these" and needs to be next to the count tiles that
           * prompt the question.
           */}
          {props.resourceContextNote ? (
            <div className="rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-600">
              {props.resourceContextNote}
            </div>
          ) : (
            <></>
          )}

          {/*
           * Tiles, search and filters only once there is something to count
           * and narrow: four zeros and a search box above "No
           * recommendations ... yet" said the same thing five more times.
           */}
          {counts.total > 0 ? (
            <RecommendationToolbar
              counts={counts}
              filterState={filterState}
              isDisabled={isCreating}
              onFilterStateChange={setFilterState}
            />
          ) : (
            <></>
          )}

          {groups.length === 0 ? (
            getEmptyState()
          ) : (
            <RecommendationsList
              groups={groups}
              selectedRecommendationIds={selectedRecommendationIds}
              onSelectionChange={setSelectedRecommendationIds}
              getMonitorRoute={getMonitorRoute}
              isDisabled={isCreating}
              onDismiss={(viewModel: RecommendationViewModel) => {
                setDismissalReason("");
                setDismissTarget(viewModel);
              }}
              onRestore={(viewModel: RecommendationViewModel) => {
                restore(viewModel).catch((err: Error) => {
                  setActionError(API.getFriendlyMessage(err));
                });
              }}
            />
          )}
        </div>
      </Card>

      {/*
       * A second Create button pinned under the list. The card header button
       * scrolls out of view on a cluster with eighteen recommendations across
       * five categories, and the moment a user has finished choosing is
       * exactly when they are at the bottom of the page.
       *
       * On a phone the count and Clear share the first line and Create
       * takes the whole second one: all on one line, the two full-width
       * buttons left the count a column one word wide - "monitors" ran
       * under Clear - and wrapped Create onto three lines.
       */}
      {selectedRecommendations.length > 0 ? (
        <div
          className="sticky bottom-4 z-10 mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-lg sm:flex-nowrap"
          data-testid="recommendations-selection-bar"
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-900">
              {translator.translatePlural(
                {
                  one: "{{count}} monitor selected",
                  other: "{{count}} monitors selected",
                },
                selectedRecommendations.length,
              )}
            </span>
            {/*
             * The severity split of what is about to be created. It is the
             * one thing about a batch worth checking before pressing a button
             * that pages people, and it was only visible inside the panel the
             * button opens.
             */}
            {selectedCriticalCount > 0 ? (
              <StatusBadge
                text={translator.translateTemplate("{{count}} Critical", {
                  count: translator.formatNumber(selectedCriticalCount),
                })}
                type={StatusBadgeType.Danger}
              />
            ) : (
              <></>
            )}
            {selectedWarningCount > 0 ? (
              <StatusBadge
                text={translator.translateTemplate("{{count}} Warning", {
                  count: translator.formatNumber(selectedWarningCount),
                })}
                type={StatusBadgeType.Warning}
              />
            ) : (
              <></>
            )}
          </div>
          <div className="flex flex-none items-center [&>button]:w-auto">
            <Button
              title="Clear"
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={() => {
                setSelectedRecommendationIds(new Set<string>());
              }}
            />
          </div>
          <div className="w-full sm:w-auto sm:flex-none">
            <Button
              title={translator.translatePlural(
                {
                  one: "Create {{count}} Selected Monitor",
                  other: "Create {{count}} Selected Monitors",
                },
                selectedRecommendations.length,
              )}
              icon={IconProp.Add}
              buttonStyle={ButtonStyleType.PRIMARY}
              disabled={Boolean(createLockReason)}
              tooltip={createLockReason}
              onClick={openCreatePanel}
            />
          </div>
        </div>
      ) : (
        <></>
      )}

      {showCreateSideOver ? (
        <MonitorRecommendationCreateSideOver
          selectedRecommendations={selectedRecommendations.map(
            (viewModel: RecommendationViewModel) => {
              return viewModel.recommendation;
            },
          )}
          resourceLabel={definition.resourceLabel}
          onCallPolicyDropdownOptions={onCallPolicyDropdownOptions}
          labelDropdownOptions={labelDropdownOptions}
          incidentSeverityOptions={incidentSeverityOptions}
          alertSeverityOptions={alertSeverityOptions}
          isCreating={isCreating}
          /*
           * Suppressed while there is a progress report, because after a
           * partial failure `actionError` IS the progress report's summary
           * line — showing both prints the same sentence twice, once as a
           * banner and once under the bar it belongs to. Errors raised before
           * the batch starts (the billing consent refusal) still surface here:
           * those return before any progress is seeded.
           */
          error={createProgress ? undefined : actionError || undefined}
          limitReached={limitReached || undefined}
          createProgress={createProgress || undefined}
          /*
           * Closes even mid-batch. The footer's Close is disabled while the
           * run is going, but SideOver's header × deliberately always calls
           * this — a panel must never trap the user — and the old guard made
           * that × a control that looked live and did nothing. The batch is
           * not abandonable anyway: it keeps running, and the progress panel
           * moves onto the page behind, so nothing is lost by leaving.
           */
          onClose={() => {
            setShowCreateSideOver(false);
          }}
          onSubmit={(
            notificationSettings: MonitorRecommendationNotificationSettings,
            hasAcknowledgedBilling: boolean,
          ) => {
            createMonitors(
              notificationSettings,
              selectedRecommendations.map(
                (viewModel: RecommendationViewModel) => {
                  return viewModel.recommendation.recommendationId;
                },
              ),
              hasAcknowledgedBilling,
            ).catch((err: Error) => {
              setActionError(API.getFriendlyMessage(err));
              setIsCreating(false);
            });
          }}
        />
      ) : (
        <></>
      )}

      {dismissTarget ? (
        <ConfirmModal
          title={translator.translateTemplate('Dismiss "{{name}}"?', {
            name: getAlertTemplateName(
              translator,
              dismissTarget.recommendation,
            ),
          })}
          description={
            <div className="space-y-3">
              <p className="text-sm text-gray-500">
                {translator.translateText(
                  "This hides the recommendation for everyone on the project. It does not delete anything, and you can restore it at any time from the Dismissed tile.",
                )}
              </p>
              <TextArea
                value={dismissalReason}
                placeholder="Why? (optional) e.g. we already alert on this from Prometheus"
                onChange={(value: string) => {
                  setDismissalReason(value);
                }}
              />
            </div>
          }
          submitButtonText="Dismiss"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isDismissing}
          onSubmit={() => {
            confirmDismiss().catch((err: Error) => {
              setActionError(API.getFriendlyMessage(err));
              setIsDismissing(false);
            });
          }}
          onClose={() => {
            if (!isDismissing) {
              setDismissTarget(null);
              setDismissalReason("");
            }
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default MonitorRecommendations;
