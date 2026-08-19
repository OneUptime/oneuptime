import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";
import Card from "Common/UI/Components/Card/Card";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
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
import ProjectUtil from "Common/UI/Utils/Project";
import { FormType } from "Common/UI/Components/Forms/ModelForm";

import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import Team from "Common/Models/DatabaseModels/Team";
import Label from "Common/Models/DatabaseModels/Label";

import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
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
import RecommendationFilterUtil from "./RecommendationFilterUtil";
import RecommendationDismissalUtil from "./RecommendationDismissalUtil";
import MonitorRecommendationCreateSideOver from "./MonitorRecommendationCreateSideOver";
import {
  MONITOR_CONSENT_ERROR,
  MonitorPayAsYouGoCard,
  isMonitorBatchConsentRequired,
} from "../Billing/PayAsYouGo";
import MonitorRecommendationCreateUtil, {
  MonitorRecommendationCreatePlanItem,
} from "./MonitorRecommendationCreateUtil";
import {
  RecommendationCategoryGroup,
  RecommendationCounts,
  RecommendationFilterState,
  RecommendationSeverityFilter,
  RecommendationStatusFilter,
  RecommendationViewModel,
} from "./RecommendationViewModel";
import ProjectUser from "../../Utils/ProjectUser";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";

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
}

interface ProjectDefaults {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
}

const MonitorRecommendations: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");

  const [projectDefaults, setProjectDefaults] =
    useState<ProjectDefaults | null>(null);

  const [coveredMonitorIds, setCoveredMonitorIds] = useState<
    Map<string, ObjectID>
  >(new Map<string, ObjectID>());
  const [dismissals, setDismissals] = useState<Array<RecommendationDismissal>>(
    [],
  );
  const [selectedRecommendationIds, setSelectedRecommendationIds] = useState<
    Set<string>
  >(new Set<string>());

  const [filterState, setFilterState] = useState<RecommendationFilterState>({
    searchText: "",
    /*
     * Opens on the not-yet-set-up subset. This page's job is "what still needs
     * doing here"; opening on All means a cluster with every monitor already
     * created renders eighteen greyed-out cards and the user has to work out
     * that there is nothing to do.
     */
    status: RecommendationStatusFilter.Available,
    severity: RecommendationSeverityFilter.All,
  });

  const [onCallPolicyDropdownOptions, setOnCallPolicyDropdownOptions] =
    useState<Array<DropdownOption>>([]);
  const [teamDropdownOptions, setTeamDropdownOptions] = useState<
    Array<DropdownOption>
  >([]);
  const [userDropdownOptions, setUserDropdownOptions] = useState<
    Array<DropdownOption>
  >([]);
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
  const [createdCount, setCreatedCount] = useState<number>(0);

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
   */
  const categories: Array<string> = MonitorRecommendationCatalog.getCategories(
    props.resourceType,
    props.resourceContext,
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
      const monitorStatusList: ListResult<MonitorStatus> =
        await ModelAPI.getList({
          modelType: MonitorStatus,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            name: true,
            isOperationalState: true,
            isOfflineState: true,
          },
          sort: {},
        });

      const onlineStatus: MonitorStatus | undefined =
        monitorStatusList.data.find((item: MonitorStatus) => {
          return item.isOperationalState;
        });
      const offlineStatus: MonitorStatus | undefined =
        monitorStatusList.data.find((item: MonitorStatus) => {
          return item.isOfflineState;
        });

      const incidentSeverityList: ListResult<IncidentSeverity> =
        await ModelAPI.getList({
          modelType: IncidentSeverity,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: { name: true, order: true },
          sort: { order: SortOrder.Ascending },
        });

      const alertSeverityList: ListResult<AlertSeverity> =
        await ModelAPI.getList({
          modelType: AlertSeverity,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: { name: true, order: true },
          sort: { order: SortOrder.Ascending },
        });

      /*
       * Every one of these is required to build a valid monitor step. A
       * project missing any of them cannot create monitors at all, so fail
       * with a specific message rather than letting a non-null assertion throw
       * an opaque one (which is what the monitor create form does today).
       */
      if (!onlineStatus?._id) {
        throw new Error(
          "This project has no operational monitor status. Add one under Project Settings > Monitor Status.",
        );
      }
      if (!offlineStatus?._id) {
        throw new Error(
          "This project has no offline monitor status. Add one under Project Settings > Monitor Status.",
        );
      }
      if (!incidentSeverityList.data[0]?._id) {
        throw new Error(
          "This project has no incident severity. Add one under Project Settings > Incident Severity.",
        );
      }
      if (!alertSeverityList.data[0]?._id) {
        throw new Error(
          "This project has no alert severity. Add one under Project Settings > Alert Severity.",
        );
      }

      const defaults: ProjectDefaults = {
        onlineMonitorStatusId: new ObjectID(onlineStatus._id),
        offlineMonitorStatusId: new ObjectID(offlineStatus._id),
        defaultMonitorStatusId: new ObjectID(onlineStatus._id),
        defaultIncidentSeverityId: new ObjectID(
          incidentSeverityList.data[0]._id,
        ),
        defaultAlertSeverityId: new ObjectID(alertSeverityList.data[0]._id),
      };

      setProjectDefaults(defaults);

      setIncidentSeverityOptions(
        incidentSeverityList.data.map((item: IncidentSeverity) => {
          return {
            id: new ObjectID(item._id!),
            name: item.name!,
            order: item.order,
          };
        }),
      );
      setAlertSeverityOptions(
        alertSeverityList.data.map((item: AlertSeverity) => {
          return {
            id: new ObjectID(item._id!),
            name: item.name!,
            order: item.order,
          };
        }),
      );

      const onCallPolicyList: ListResult<OnCallDutyPolicy> =
        await ModelAPI.getList({
          modelType: OnCallDutyPolicy,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: { name: true },
          sort: { name: SortOrder.Ascending },
        });

      setOnCallPolicyDropdownOptions(
        onCallPolicyList.data.map((item: OnCallDutyPolicy) => {
          return { value: item._id!, label: item.name! };
        }),
      );

      const teamList: ListResult<Team> = await ModelAPI.getList({
        modelType: Team,
        query: {},
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: { name: true },
        sort: { name: SortOrder.Ascending },
      });

      setTeamDropdownOptions(
        teamList.data.map((item: Team) => {
          return { value: item._id!, label: item.name! };
        }),
      );

      const labelList: ListResult<Label> = await ModelAPI.getList({
        modelType: Label,
        query: {},
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: { name: true },
        sort: { name: SortOrder.Ascending },
      });

      setLabelDropdownOptions(
        labelList.data.map((item: Label) => {
          return { value: item._id!, label: item.name! };
        }),
      );

      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      if (projectId) {
        setUserDropdownOptions(
          await ProjectUser.fetchProjectUsersAsDropdownOptions(projectId),
        );
      }

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
    setCreatedCount(0);

    const plan: Array<MonitorRecommendationCreatePlanItem> =
      MonitorRecommendationCreateUtil.buildCreatePlan({
        recommendations: recommendations,
        selectedRecommendationIds: creatableRecommendationIds,
        args: buildArgs(projectDefaults),
        resourceDisplayName: props.resourceDisplayName,
        defaultMonitorStatusId: projectDefaults.defaultMonitorStatusId,
        notificationSettings: notificationSettings,
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

    let created: number = 0;

    try {
      /*
       * Sequential on purpose. Monitor creation runs label rules, owner rules
       * and workspace notifications per monitor; firing 18 of those in
       * parallel is a burst the free-plan monitor-count check also has to
       * serialize against. A partial failure keeps whatever succeeded — the
       * page reloads coverage afterwards, so the user sees exactly what landed.
       */
      for (const item of plan) {
        await ModelAPI.createOrUpdate({
          model: item.monitor,
          modelType: Monitor,
          formType: FormType.Create,
          miscDataProps: item.miscDataProps,
        });

        created = created + 1;
        setCreatedCount(created);
      }

      setShowCreateSideOver(false);
      setSelectedRecommendationIds(new Set<string>());
    } catch (err) {
      setActionError(
        `${API.getFriendlyMessage(err)} (${created} of ${
          plan.length
        } monitors were created.)`,
      );
    }

    setIsCreating(false);

    try {
      await loadCoverage(projectDefaults);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
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
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }
  };

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!definition) {
    return (
      <ErrorMessage
        message={`No monitor recommendations are available for ${props.resourceType}.`}
      />
    );
  }

  if (!props.resourceIdentifier) {
    return (
      <EmptyState
        id="monitor-recommendations-no-identifier"
        icon={IconProp.Alert}
        title="No telemetry yet"
        description={`This ${definition.resourceLabel.toLowerCase()} has not reported an identifier yet, so monitors cannot be scoped to it. Once the agent sends its first data, recommendations will appear here.`}
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
      }),
      categories: categories,
    });

  const selectedRecommendations: Array<RecommendationViewModel> =
    RecommendationFilterUtil.getSelectableViewModels({
      viewModels: viewModels,
      selectedRecommendationIds: selectedRecommendationIds,
    });

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
      return (
        <EmptyState
          id="monitor-recommendations-none"
          icon={IconProp.Sparkles}
          title="No recommendations for this resource type yet"
          description="OneUptime does not ship a recommended monitor library for this resource type. You can still create monitors by hand."
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
          description={`All ${counts.total} recommended monitors for this ${definition.resourceLabel.toLowerCase()} have been created or dismissed. Use the tiles above to review them.`}
        />
      );
    }

    return (
      <EmptyState
        id="monitor-recommendations-no-match"
        icon={IconProp.Search}
        title="No recommendations match these filters"
        description="Try a different search term, or switch the severity and status filters back to show everything."
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
        description={`Monitors OneUptime recommends for this ${definition.resourceLabel.toLowerCase()}, based on the telemetry the agent already sends. Pick the ones you want, choose who gets paged, and create them in one step.`}
        buttons={[
          {
            title: `Create ${selectedRecommendations.length} Selected`,
            icon: IconProp.Add,
            buttonStyle: ButtonStyleType.PRIMARY,
            disabled: selectedRecommendations.length === 0,
            onClick: () => {
              setActionError("");
              setShowCreateSideOver(true);
            },
          },
        ]}
      >
        <div className="space-y-6">
          {actionError ? <ErrorMessage message={actionError} /> : <></>}

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

          <RecommendationToolbar
            counts={counts}
            filterState={filterState}
            isDisabled={isCreating}
            onFilterStateChange={setFilterState}
          />

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
       */}
      {selectedRecommendations.length > 0 ? (
        <div className="sticky bottom-4 z-10 mb-5 flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-lg">
          <span className="text-sm text-gray-600">
            {selectedRecommendations.length}{" "}
            {selectedRecommendations.length === 1 ? "monitor" : "monitors"}{" "}
            selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              title="Clear"
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={() => {
                setSelectedRecommendationIds(new Set<string>());
              }}
            />
            <Button
              title={`Create ${selectedRecommendations.length} Selected ${
                selectedRecommendations.length === 1 ? "Monitor" : "Monitors"
              }`}
              icon={IconProp.Add}
              buttonStyle={ButtonStyleType.PRIMARY}
              onClick={() => {
                setActionError("");
                setShowCreateSideOver(true);
              }}
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
          teamDropdownOptions={teamDropdownOptions}
          userDropdownOptions={userDropdownOptions}
          labelDropdownOptions={labelDropdownOptions}
          incidentSeverityOptions={incidentSeverityOptions}
          alertSeverityOptions={alertSeverityOptions}
          isCreating={isCreating}
          error={actionError || undefined}
          progressMessage={
            isCreating && createdCount > 0
              ? `Created ${createdCount} of ${selectedRecommendations.length}...`
              : undefined
          }
          onClose={() => {
            if (!isCreating) {
              setShowCreateSideOver(false);
            }
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
          title={`Dismiss "${dismissTarget.recommendation.name}"?`}
          description={
            <div className="space-y-3">
              <p className="text-sm text-gray-500">
                This hides the recommendation for everyone on the project. It
                does not delete anything, and you can restore it at any time
                from the Dismissed tile.
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
