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
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ListResult from "Common/UI/Utils/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import FormType from "Common/UI/Components/Forms/Types/FormType";

import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Team from "Common/Models/DatabaseModels/Team";
import Label from "Common/Models/DatabaseModels/Label";

import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorRecommendationCatalog, {
  MonitorRecommendationResourceTypeDefinition,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil from "Common/Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationNotificationSettings,
  MonitorRecommendationResourceType,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

import MonitorRecommendationsList from "./MonitorRecommendationsList";
import MonitorRecommendationCreateSideOver from "./MonitorRecommendationCreateSideOver";
import MonitorRecommendationCreateUtil, {
  MonitorRecommendationCreatePlanItem,
} from "./MonitorRecommendationCreateUtil";
import ProjectUser from "../../Utils/ProjectUser";

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
  const [createError, setCreateError] = useState<string>("");

  const [projectDefaults, setProjectDefaults] =
    useState<ProjectDefaults | null>(null);
  const [coveredRecommendationIds, setCoveredRecommendationIds] = useState<
    Set<string>
  >(new Set<string>());
  const [selectedRecommendationIds, setSelectedRecommendationIds] = useState<
    Set<string>
  >(new Set<string>());

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
  const [incidentSeverityDropdownOptions, setIncidentSeverityDropdownOptions] =
    useState<Array<DropdownOption>>([]);
  const [alertSeverityDropdownOptions, setAlertSeverityDropdownOptions] =
    useState<Array<DropdownOption>>([]);

  const [showCreateSideOver, setShowCreateSideOver] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [createdCount, setCreatedCount] = useState<number>(0);

  const definition: MonitorRecommendationResourceTypeDefinition | undefined =
    MonitorRecommendationCatalog.getResourceTypeDefinition(props.resourceType);

  const recommendations: Array<MonitorRecommendation> =
    MonitorRecommendationCatalog.getRecommendations(props.resourceType);

  const categories: Array<string> = MonitorRecommendationCatalog.getCategories(
    props.resourceType,
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

      setIncidentSeverityDropdownOptions(
        incidentSeverityList.data.map((item: IncidentSeverity) => {
          return { value: item._id!, label: item.name! };
        }),
      );
      setAlertSeverityDropdownOptions(
        alertSeverityList.data.map((item: AlertSeverity) => {
          return { value: item._id!, label: item.name! };
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

      await loadCoverage(defaults);
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
     * Only monitors of this resource's own monitor type can possibly cover a
     * recommendation, so the query is narrowed server-side rather than
     * fetching every monitor in the project.
     */
    const monitorList: ListResult<Monitor> = await ModelAPI.getList({
      modelType: Monitor,
      query: { monitorType: definition.monitorType },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: { name: true, monitorSteps: true },
      sort: {},
    });

    setCoveredRecommendationIds(
      MonitorRecommendationUtil.getCoveredRecommendationIds({
        recommendations: recommendations,
        existingMonitorSteps:
          MonitorRecommendationCreateUtil.getExistingMonitorSteps(
            monitorList.data,
          ) as Array<MonitorStep>,
        args: buildArgs(defaults),
      }),
    );
  };

  useAsyncEffect(async () => {
    await load();
  }, [props.resourceType, props.resourceIdentifier]);

  type CreateFunction = (
    notificationSettings: MonitorRecommendationNotificationSettings,
  ) => Promise<void>;

  const createMonitors: CreateFunction = async (
    notificationSettings: MonitorRecommendationNotificationSettings,
  ): Promise<void> => {
    if (!projectDefaults) {
      return;
    }

    setIsCreating(true);
    setCreateError("");
    setCreatedCount(0);

    const plan: Array<MonitorRecommendationCreatePlanItem> =
      MonitorRecommendationCreateUtil.buildCreatePlan({
        recommendations: recommendations,
        selectedRecommendationIds:
          MonitorRecommendationCreateUtil.getCreatableSelection({
            selectedRecommendationIds: Array.from(selectedRecommendationIds),
            coveredRecommendationIds: coveredRecommendationIds,
          }),
        args: buildArgs(projectDefaults),
        resourceDisplayName: props.resourceDisplayName,
        defaultMonitorStatusId: projectDefaults.defaultMonitorStatusId,
        notificationSettings: notificationSettings,
      });

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
      setCreateError(
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

  const selectableCount: number = recommendations.filter(
    (recommendation: MonitorRecommendation) => {
      return !coveredRecommendationIds.has(recommendation.recommendationId);
    },
  ).length;

  const selectedRecommendations: Array<MonitorRecommendation> =
    recommendations.filter((recommendation: MonitorRecommendation) => {
      return (
        selectedRecommendationIds.has(recommendation.recommendationId) &&
        !coveredRecommendationIds.has(recommendation.recommendationId)
      );
    });

  return (
    <Fragment>
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
              setCreateError("");
              setShowCreateSideOver(true);
            },
          },
        ]}
      >
        <Fragment>
          {createError ? (
            <div className="mb-4">
              <ErrorMessage message={createError} />
            </div>
          ) : (
            <></>
          )}

          {selectableCount === 0 ? (
            <EmptyState
              id="monitor-recommendations-all-created"
              icon={IconProp.CheckCircle}
              title="Every recommended monitor already exists"
              description={`All ${recommendations.length} recommended monitors for this ${definition.resourceLabel.toLowerCase()} have been created. Nothing left to set up here.`}
            />
          ) : (
            <MonitorRecommendationsList
              recommendations={recommendations}
              categories={categories}
              coveredRecommendationIds={coveredRecommendationIds}
              selectedRecommendationIds={selectedRecommendationIds}
              onSelectionChange={setSelectedRecommendationIds}
              isDisabled={isCreating}
            />
          )}
        </Fragment>
      </Card>

      {selectableCount > 0 && selectedRecommendations.length > 0 ? (
        <div className="flex justify-end mb-5">
          <Button
            title={`Create ${selectedRecommendations.length} Selected ${
              selectedRecommendations.length === 1 ? "Monitor" : "Monitors"
            }`}
            icon={IconProp.Add}
            buttonStyle={ButtonStyleType.PRIMARY}
            onClick={() => {
              setCreateError("");
              setShowCreateSideOver(true);
            }}
          />
        </div>
      ) : (
        <></>
      )}

      {showCreateSideOver ? (
        <MonitorRecommendationCreateSideOver
          selectedRecommendations={selectedRecommendations}
          resourceLabel={definition.resourceLabel}
          onCallPolicyDropdownOptions={onCallPolicyDropdownOptions}
          teamDropdownOptions={teamDropdownOptions}
          userDropdownOptions={userDropdownOptions}
          labelDropdownOptions={labelDropdownOptions}
          incidentSeverityDropdownOptions={incidentSeverityDropdownOptions}
          alertSeverityDropdownOptions={alertSeverityDropdownOptions}
          isCreating={isCreating}
          error={
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
          ) => {
            createMonitors(notificationSettings).catch((err: Error) => {
              setCreateError(API.getFriendlyMessage(err));
              setIsCreating(false);
            });
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default MonitorRecommendations;
