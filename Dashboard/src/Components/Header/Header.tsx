import AlertStateUtil from "../../Utils/AlertState";
import IncidentStateUtil from "../../Utils/IncidentState";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
/*
 * import SearchBox from './SearchBox';
 * import Notifications from './Notifications';
 */
import Help from "./Help";
import Logo from "./Logo";
import ProjectPicker from "./ProjectPicker";
import Upgrade from "./Upgrade";
import UserProfile from "./UserProfile";
import Includes from "Common/Types/BaseDatabase/Includes";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Header from "Common/UI/Components/Header/Header";
import { HeaderAlertType } from "Common/UI/Components/HeaderAlert/HeaderAlert";
import {
  NotificationBell,
  NotificationItem,
} from "Common/UI/Components/HeaderAlert/NotificationBell";
import { APP_API_URL, BILLING_ENABLED, getAllEnvVars } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import User from "Common/UI/Utils/User";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Project from "Common/Models/DatabaseModels/Project";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
  useCallback,
} from "react";
import Realtime from "Common/UI/Utils/Realtime";
import ProjectUtil from "Common/UI/Utils/Project";
import ModelEventType from "Common/Types/Realtime/ModelEventType";
import Alert from "Common/Models/DatabaseModels/Alert";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyEscalationRuleTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import URL from "Common/Types/API/URL";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import CurrentOnCallPolicyModal from "../OnCallPolicy/CurrentOnCallPolicyModal";

export interface ComponentProps {
  projects: Array<Project>;
  onProjectSelected: (project: Project) => void;
  showProjectModal: boolean;
  onProjectModalClose: () => void;
  selectedProject: Project | null;
  paymentMethodsCount?: number | undefined;
}

const DashboardHeader: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [incidentsCount, setIncidentsCount] = useState<number>(0);
  const [alertsCount, setAlertsCount] = useState<number>(0);
  const [alertEpisodesCount, setAlertEpisodesCount] = useState<number>(0);
  const [incidentEpisodesCount, setIncidentEpisodesCount] = useState<number>(0);
  const [invitationsCount, setInvitationsCount] = useState<number>(0);

  const [showCurrentOnCallPolicyModal, setShowCurrentOnCallPolicyModal] =
    useState<boolean>(false);

  const fetchIncidentsCount: PromiseVoidFunction =
    useCallback(async (): Promise<void> => {
      try {
        const count: number = await ModelAPI.count<Incident>({
          modelType: Incident,
          query: {
            currentIncidentState: {
              order: 1,
            },
          },
          requestOptions: {
            isMultiTenantRequest: true,
          },
        });
        setIncidentsCount(count);
      } catch {
        setIncidentsCount(0);
      }
    }, []);

  const fetchAlertsCount: PromiseVoidFunction =
    useCallback(async (): Promise<void> => {
      try {
        const count: number = await ModelAPI.count<Alert>({
          modelType: Alert,
          query: {
            currentAlertState: {
              order: 1,
            },
          },
          requestOptions: {
            isMultiTenantRequest: true,
          },
        });
        setAlertsCount(count);
      } catch {
        setAlertsCount(0);
      }
    }, []);

  const fetchAlertEpisodesCount: PromiseVoidFunction =
    useCallback(async (): Promise<void> => {
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        if (!projectId) {
          setAlertEpisodesCount(0);
          return;
        }

        const unresolvedAlertStates: Array<AlertState> =
          await AlertStateUtil.getUnresolvedAlertStates(projectId);

        if (unresolvedAlertStates.length === 0) {
          setAlertEpisodesCount(0);
          return;
        }

        const count: number = await ModelAPI.count<AlertEpisode>({
          modelType: AlertEpisode,
          query: {
            currentAlertStateId: new Includes(
              unresolvedAlertStates.map((state: AlertState) => {
                return state.id!;
              }),
            ),
          },
          requestOptions: {
            isMultiTenantRequest: true,
          },
        });
        setAlertEpisodesCount(count);
      } catch {
        setAlertEpisodesCount(0);
      }
    }, []);

  const fetchIncidentEpisodesCount: PromiseVoidFunction =
    useCallback(async (): Promise<void> => {
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        if (!projectId) {
          setIncidentEpisodesCount(0);
          return;
        }

        const unresolvedIncidentStates: Array<IncidentState> =
          await IncidentStateUtil.getUnresolvedIncidentStates(projectId);

        if (unresolvedIncidentStates.length === 0) {
          setIncidentEpisodesCount(0);
          return;
        }

        const count: number = await ModelAPI.count<IncidentEpisode>({
          modelType: IncidentEpisode,
          query: {
            currentIncidentStateId: new Includes(
              unresolvedIncidentStates.map((state: IncidentState) => {
                return state.id!;
              }),
            ),
          },
          requestOptions: {
            isMultiTenantRequest: true,
          },
        });
        setIncidentEpisodesCount(count);
      } catch {
        setIncidentEpisodesCount(0);
      }
    }, []);

  const fetchInvitationsCount: PromiseVoidFunction =
    useCallback(async (): Promise<void> => {
      try {
        const count: number = await ModelAPI.count<TeamMember>({
          modelType: TeamMember,
          query: {
            userId: User.getUserId(),
            hasAcceptedInvitation: false,
          },
          requestOptions: {
            isMultiTenantRequest: true,
          },
        });
        setInvitationsCount(count);
      } catch {
        setInvitationsCount(0);
      }
    }, []);

  const refreshIncidentCount: VoidFunction = () => {
    fetchIncidentsCount().catch(() => {
      // ignore
    });
  };

  const refreshAlertCount: VoidFunction = () => {
    fetchAlertsCount().catch(() => {
      // ignore
    });
  };

  const refreshAlertEpisodeCount: VoidFunction = () => {
    fetchAlertEpisodesCount().catch(() => {
      // ignore
    });
  };

  const refreshIncidentEpisodeCount: VoidFunction = () => {
    fetchIncidentEpisodesCount().catch(() => {
      // ignore
    });
  };

  const realtimeIncidentCountRefresh: () => VoidFunction = (): VoidFunction => {
    const stopListeningOnCreate: VoidFunction =
      Realtime.listenToModelEvent<Incident>(
        {
          eventType: ModelEventType.Create,
          modelType: Incident,
          tenantId: ProjectUtil.getCurrentProjectId()!,
        },
        () => {
          refreshIncidentCount();
        },
      );

    const stopListeningOnUpdate: VoidFunction =
      Realtime.listenToModelEvent<Incident>(
        {
          eventType: ModelEventType.Update,
          modelType: Incident,
          tenantId: ProjectUtil.getCurrentProjectId()!,
        },
        () => {
          refreshIncidentCount();
        },
      );

    const stopListeningOnDelete: VoidFunction =
      Realtime.listenToModelEvent<Incident>(
        {
          eventType: ModelEventType.Delete,
          modelType: Incident,
          tenantId: ProjectUtil.getCurrentProjectId()!,
        },
        () => {
          refreshIncidentCount();
        },
      );

    const stopListening: VoidFunction = () => {
      // on unmount.
      stopListeningOnCreate();
      stopListeningOnUpdate();
      stopListeningOnDelete();
    };

    return stopListening;
  };

  const realtimeAlertCountRefresh: () => VoidFunction = (): VoidFunction => {
    const stopListeningOnCreate: VoidFunction =
      Realtime.listenToModelEvent<Alert>(
        {
          eventType: ModelEventType.Create,
          modelType: Alert,
          tenantId: ProjectUtil.getCurrentProjectId()!,
        },
        () => {
          refreshAlertCount();
        },
      );

    const stopListeningOnUpdate: VoidFunction =
      Realtime.listenToModelEvent<Alert>(
        {
          eventType: ModelEventType.Update,
          modelType: Alert,
          tenantId: ProjectUtil.getCurrentProjectId()!,
        },
        () => {
          refreshAlertCount();
        },
      );

    const stopListeningOnDelete: VoidFunction =
      Realtime.listenToModelEvent<Alert>(
        {
          eventType: ModelEventType.Delete,
          modelType: Alert,
          tenantId: ProjectUtil.getCurrentProjectId()!,
        },
        () => {
          refreshAlertCount();
        },
      );

    const stopListening: VoidFunction = () => {
      // on unmount.
      stopListeningOnCreate();
      stopListeningOnUpdate();
      stopListeningOnDelete();
    };

    return stopListening;
  };

  const realtimeAlertEpisodeCountRefresh: () => VoidFunction =
    (): VoidFunction => {
      const stopListeningOnCreate: VoidFunction =
        Realtime.listenToModelEvent<AlertEpisode>(
          {
            eventType: ModelEventType.Create,
            modelType: AlertEpisode,
            tenantId: ProjectUtil.getCurrentProjectId()!,
          },
          () => {
            refreshAlertEpisodeCount();
          },
        );

      const stopListeningOnUpdate: VoidFunction =
        Realtime.listenToModelEvent<AlertEpisode>(
          {
            eventType: ModelEventType.Update,
            modelType: AlertEpisode,
            tenantId: ProjectUtil.getCurrentProjectId()!,
          },
          () => {
            refreshAlertEpisodeCount();
          },
        );

      const stopListeningOnDelete: VoidFunction =
        Realtime.listenToModelEvent<AlertEpisode>(
          {
            eventType: ModelEventType.Delete,
            modelType: AlertEpisode,
            tenantId: ProjectUtil.getCurrentProjectId()!,
          },
          () => {
            refreshAlertEpisodeCount();
          },
        );

      const stopListening: VoidFunction = () => {
        // on unmount.
        stopListeningOnCreate();
        stopListeningOnUpdate();
        stopListeningOnDelete();
      };

      return stopListening;
    };

  const realtimeIncidentEpisodeCountRefresh: () => VoidFunction =
    (): VoidFunction => {
      const stopListeningOnCreate: VoidFunction =
        Realtime.listenToModelEvent<IncidentEpisode>(
          {
            eventType: ModelEventType.Create,
            modelType: IncidentEpisode,
            tenantId: ProjectUtil.getCurrentProjectId()!,
          },
          () => {
            refreshIncidentEpisodeCount();
          },
        );

      const stopListeningOnUpdate: VoidFunction =
        Realtime.listenToModelEvent<IncidentEpisode>(
          {
            eventType: ModelEventType.Update,
            modelType: IncidentEpisode,
            tenantId: ProjectUtil.getCurrentProjectId()!,
          },
          () => {
            refreshIncidentEpisodeCount();
          },
        );

      const stopListeningOnDelete: VoidFunction =
        Realtime.listenToModelEvent<IncidentEpisode>(
          {
            eventType: ModelEventType.Delete,
            modelType: IncidentEpisode,
            tenantId: ProjectUtil.getCurrentProjectId()!,
          },
          () => {
            refreshIncidentEpisodeCount();
          },
        );

      const stopListening: VoidFunction = () => {
        // on unmount.
        stopListeningOnCreate();
        stopListeningOnUpdate();
        stopListeningOnDelete();
      };

      return stopListening;
    };

  useEffect(() => {
    const realtimeIncidentStop: VoidFunction = realtimeIncidentCountRefresh();

    const realtimeAlertStop: VoidFunction = realtimeAlertCountRefresh();

    const realtimeAlertEpisodeStop: VoidFunction =
      realtimeAlertEpisodeCountRefresh();

    const realtimeIncidentEpisodeStop: VoidFunction =
      realtimeIncidentEpisodeCountRefresh();

    // Initial fetch of counts
    fetchIncidentsCount().catch(() => {
      // ignore
    });
    fetchAlertsCount().catch(() => {
      // ignore
    });
    fetchAlertEpisodesCount().catch(() => {
      // ignore
    });
    fetchIncidentEpisodesCount().catch(() => {
      // ignore
    });
    fetchInvitationsCount().catch(() => {
      // ignore
    });

    return () => {
      realtimeIncidentStop();
      realtimeAlertStop();
      realtimeAlertEpisodeStop();
      realtimeIncidentEpisodeStop();
    };
  }, [
    fetchIncidentsCount,
    fetchAlertsCount,
    fetchAlertEpisodesCount,
    fetchIncidentEpisodesCount,
    fetchInvitationsCount,
  ]);

  const [
    currentOnCallDutyEscalationPolicyUser,
    setCurrentOnCallDutyEscalationPolicyUser,
  ] = useState<Array<OnCallDutyPolicyEscalationRuleUser>>([]);
  const [
    currentOnCallDutyEscalationPolicyTeam,
    setCurrentOnCallDutyEscalationPolicyTeam,
  ] = useState<Array<OnCallDutyPolicyEscalationRuleTeam>>([]);

  const [
    currentOnCallDutyEscalationPolicySchedule,
    setCurrentOnCallDutyEscalationPolicySchedule,
  ] = useState<Array<OnCallDutyPolicyEscalationRuleSchedule>>([]);

  const [onCallDutyPolicyFetchError, setOnCallDutyPolicyFetchError] = useState<
    string | null
  >(null);

  const [currentOnCallPolicies, setCurrentOnCallPolicies] = useState<
    Array<OnCallDutyPolicy>
  >([]);

  const fetchCurrentOnCallDutyPolicies: PromiseVoidFunction =
    async (): Promise<void> => {
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

        if (projectId) {
          const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
            await API.get<JSONObject>({
              url: URL.fromString(APP_API_URL.toString()).addRoute(
                `/${
                  new OnCallDutyPolicy().crudApiPath
                }/current-on-duty-escalation-policies`,
              ),
              data: {},
              headers: ModelAPI.getCommonHeaders(),
            });

          if (response.isFailure()) {
            throw response;
          }

          const result: JSONObject = response.jsonData as JSONObject;

          const escalationRulesByUser: Array<OnCallDutyPolicyEscalationRuleUser> =
            DatabaseBaseModel.fromJSONArray(
              result["escalationRulesByUser"] as Array<JSONObject>,
              OnCallDutyPolicyEscalationRuleUser,
            ) as Array<OnCallDutyPolicyEscalationRuleUser>;

          const escalationRulesByTeam: Array<OnCallDutyPolicyEscalationRuleTeam> =
            DatabaseBaseModel.fromJSONArray(
              result["escalationRulesByTeam"] as Array<JSONObject>,
              OnCallDutyPolicyEscalationRuleTeam,
            ) as Array<OnCallDutyPolicyEscalationRuleTeam>;

          const escalationRulesBySchedule: Array<OnCallDutyPolicyEscalationRuleSchedule> =
            DatabaseBaseModel.fromJSONArray(
              result["escalationRulesBySchedule"] as Array<JSONObject>,
              OnCallDutyPolicyEscalationRuleSchedule,
            ) as Array<OnCallDutyPolicyEscalationRuleSchedule>;

          setCurrentOnCallDutyEscalationPolicyUser(escalationRulesByUser);
          setCurrentOnCallDutyEscalationPolicyTeam(escalationRulesByTeam);
          setCurrentOnCallDutyEscalationPolicySchedule(
            escalationRulesBySchedule,
          );

          // now get the current on call schedules fron escalationRulesBySchedule
          const currentOnCallPolicies: Array<OnCallDutyPolicy> = [];

          for (const escalationRule of escalationRulesBySchedule) {
            const onCallPolicy: OnCallDutyPolicy | undefined =
              escalationRule.onCallDutyPolicy;

            if (onCallPolicy) {
              // check if the onCallPolicy is already in the currentOnCallSchedules
              const onCallPolicyIndex: number = currentOnCallPolicies.findIndex(
                (schedule: OnCallDutyPolicy) => {
                  return (
                    schedule.id?.toString() === onCallPolicy.id?.toString()
                  );
                },
              );

              if (onCallPolicyIndex === -1) {
                currentOnCallPolicies.push(onCallPolicy);
              }
            }
          }

          // do the same for users and teams.
          for (const escalationRule of escalationRulesByUser) {
            const onCallPolicy: OnCallDutyPolicy | undefined =
              escalationRule.onCallDutyPolicy;
            if (onCallPolicy) {
              // check if the onCallPolicy is already in the currentOnCallSchedules
              const onCallPolicyIndex: number = currentOnCallPolicies.findIndex(
                (schedule: OnCallDutyPolicy) => {
                  return (
                    schedule.id?.toString() === onCallPolicy.id?.toString()
                  );
                },
              );
              if (onCallPolicyIndex === -1) {
                currentOnCallPolicies.push(onCallPolicy);
              }
            }
          }

          // do the same for teams.

          for (const escalationRule of escalationRulesByTeam) {
            const onCallPolicy: OnCallDutyPolicy | undefined =
              escalationRule.onCallDutyPolicy;
            if (onCallPolicy) {
              // check if the onCallPolicy is already in the currentOnCallSchedules
              const onCallPolicyIndex: number = currentOnCallPolicies.findIndex(
                (schedule: OnCallDutyPolicy) => {
                  return (
                    schedule.id?.toString() === onCallPolicy.id?.toString()
                  );
                },
              );
              if (onCallPolicyIndex === -1) {
                currentOnCallPolicies.push(onCallPolicy);
              }
            }
          }

          setCurrentOnCallPolicies(currentOnCallPolicies);
        }
      } catch {
        setOnCallDutyPolicyFetchError(
          "Something isnt right, we are unable to fetch on-call policies that you are on duty for. Reload the page to try again.",
        );
      }
    };

  useEffect(() => {
    fetchCurrentOnCallDutyPolicies().catch(() => {
      // ignore this.
    });
  }, [props.selectedProject]);

  const showAddCardButton: boolean = Boolean(
    BILLING_ENABLED &&
      props.selectedProject?.id &&
      props.selectedProject.paymentProviderPlanId &&
      !SubscriptionPlan.isFreePlan(
        props.selectedProject.paymentProviderPlanId,
        getAllEnvVars(),
      ) &&
      !SubscriptionPlan.isCustomPricingPlan(
        props.selectedProject.paymentProviderPlanId,
        getAllEnvVars(),
      ) &&
      props.paymentMethodsCount !== undefined &&
      props.paymentMethodsCount === 0 &&
      !props.selectedProject.resellerId,
  );

  const showTrialButton: boolean = Boolean(
    props.selectedProject?.trialEndsAt &&
      BILLING_ENABLED &&
      showAddCardButton &&
      OneUptimeDate.getNumberOfDaysBetweenDatesInclusive(
        OneUptimeDate.getCurrentDate(),
        props.selectedProject?.trialEndsAt,
      ) > 0 &&
      !props.selectedProject.resellerId,
  );

  const trialDaysRemaining: number = props.selectedProject?.trialEndsAt
    ? OneUptimeDate.getNumberOfDaysBetweenDatesInclusive(
        OneUptimeDate.getCurrentDate(),
        props.selectedProject.trialEndsAt,
      )
    : 0;

  const buildNotificationItems: () => Array<NotificationItem> =
    (): Array<NotificationItem> => {
      const items: Array<NotificationItem> = [];

      // Incidents - ERROR type
      items.push({
        id: "incidents",
        icon: IconProp.Alert,
        title: `${incidentsCount} Active ${incidentsCount === 1 ? "Incident" : "Incidents"}`,
        count: incidentsCount,
        alertType: HeaderAlertType.ERROR,
        tooltip: "View all active incidents",
      });

      // Alerts - ERROR type
      items.push({
        id: "alerts",
        icon: IconProp.ExclaimationCircle,
        title: `${alertsCount} Active ${alertsCount === 1 ? "Alert" : "Alerts"}`,
        count: alertsCount,
        alertType: HeaderAlertType.ERROR,
        tooltip: "View all active alerts",
      });

      // Alert Episodes - ERROR type
      items.push({
        id: "alertEpisodes",
        icon: IconProp.SquareStack3D,
        title: `${alertEpisodesCount} Active Alert ${alertEpisodesCount === 1 ? "Episode" : "Episodes"}`,
        count: alertEpisodesCount,
        alertType: HeaderAlertType.ERROR,
        tooltip: "View all active alert episodes",
      });

      // Incident Episodes - ERROR type
      items.push({
        id: "incidentEpisodes",
        icon: IconProp.SquareStack3D,
        title: `${incidentEpisodesCount} Active Incident ${incidentEpisodesCount === 1 ? "Episode" : "Episodes"}`,
        count: incidentEpisodesCount,
        alertType: HeaderAlertType.ERROR,
        tooltip: "View all active incident episodes",
      });

      // On-Call Policies - SUCCESS type
      if (props.selectedProject && currentOnCallPolicies.length > 0) {
        items.push({
          id: "oncall",
          icon: IconProp.Call,
          title: `On duty for ${currentOnCallPolicies.length} ${currentOnCallPolicies.length === 1 ? "policy" : "policies"}`,
          count: currentOnCallPolicies.length,
          alertType: HeaderAlertType.SUCCESS,
          tooltip: "On-call policies you are currently on duty for",
        });
      }

      // Invitations - INFO type
      items.push({
        id: "invitations",
        icon: IconProp.Folder,
        title: `${invitationsCount} Pending ${invitationsCount === 1 ? "Invitation" : "Invitations"}`,
        count: invitationsCount,
        alertType: HeaderAlertType.INFO,
        tooltip:
          "Looks like you have pending project invitations. Please click here to review and accept them.",
      });

      // Trial Days - INFO type (only if showTrialButton is true)
      if (showTrialButton && trialDaysRemaining > 0) {
        items.push({
          id: "trial",
          icon: IconProp.Clock,
          title: `Trial ends in ${trialDaysRemaining} ${trialDaysRemaining === 1 ? "day" : "days"}`,
          count: trialDaysRemaining,
          alertType: HeaderAlertType.INFO,
          tooltip:
            "Your trial ends soon. Add card details to continue using the service.",
        });
      }

      // Add Card Details - INFO type (only if showAddCardButton is true)
      if (showAddCardButton) {
        items.push({
          id: "addcard",
          icon: IconProp.Billing,
          title: "Add Card Details",
          count: 1,
          alertType: HeaderAlertType.INFO,
          tooltip:
            "Add your payment card details to continue using the service.",
        });
      }

      return items;
    };

  const handleNotificationItemClick: (item: NotificationItem) => void = (
    item: NotificationItem,
  ): void => {
    switch (item.id) {
      case "incidents":
        Navigation.navigate(
          RouteUtil.populateRouteParams(RouteMap[PageMap.ACTIVE_INCIDENTS]!),
        );
        break;
      case "alerts":
        Navigation.navigate(
          RouteUtil.populateRouteParams(RouteMap[PageMap.ACTIVE_ALERTS]!),
        );
        break;
      case "alertEpisodes":
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.ACTIVE_ALERT_EPISODES]!,
          ),
        );
        break;
      case "incidentEpisodes":
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.ACTIVE_INCIDENT_EPISODES]!,
          ),
        );
        break;
      case "invitations":
        Navigation.navigate(
          RouteUtil.populateRouteParams(RouteMap[PageMap.PROJECT_INVITATIONS]!),
        );
        break;
      case "trial":
        Navigation.navigate(
          RouteUtil.populateRouteParams(RouteMap[PageMap.SETTINGS_BILLING]!),
        );
        break;
      case "addcard":
        Navigation.navigate(
          RouteUtil.populateRouteParams(RouteMap[PageMap.SETTINGS_BILLING]!),
        );
        break;
      case "oncall":
        setShowCurrentOnCallPolicyModal(true);
        break;
    }
  };

  return (
    <>
      {onCallDutyPolicyFetchError ? (
        <ConfirmModal
          description={onCallDutyPolicyFetchError}
          title={`Error loading on-call policies`}
          onSubmit={() => {
            setOnCallDutyPolicyFetchError(null);
          }}
          submitButtonText={`Close`}
          submitButtonType={ButtonStyleType.NORMAL}
        />
      ) : (
        <></>
      )}
      <Header
        leftComponents={
          <>
            <Logo onClick={() => {}} />

            <ProjectPicker
              showProjectModal={props.showProjectModal}
              onProjectModalClose={props.onProjectModalClose}
              projects={props.projects}
              onProjectSelected={props.onProjectSelected}
              selectedProject={props.selectedProject}
            />
          </>
        }
        centerComponents={
          <>
            {/* <SearchBox
                            key={2}
                            selectedProject={props.selectedProject}
                            onChange={(_value: string) => { }}
                        />{' '} */}
          </>
        }
        rightComponents={
          <>
            <NotificationBell
              items={buildNotificationItems()}
              onItemClick={handleNotificationItemClick}
            />
            {BILLING_ENABLED &&
            props.selectedProject?.id &&
            props.selectedProject.paymentProviderPlanId &&
            SubscriptionPlan.isFreePlan(
              props.selectedProject.paymentProviderPlanId,
              getAllEnvVars(),
            ) ? (
              <Upgrade />
            ) : (
              <></>
            )}
            <Help />
            <UserProfile
              onClickUserProfile={() => {
                Navigation.navigate(RouteMap[PageMap.USER_PROFILE_OVERVIEW]!);
              }}
            />
          </>
        }
      />
      {showCurrentOnCallPolicyModal && (
        <CurrentOnCallPolicyModal
          showModal={showCurrentOnCallPolicyModal}
          onClose={() => {
            setShowCurrentOnCallPolicyModal(false);
          }}
          currentOnCallDutyEscalationPolicyUsers={
            currentOnCallDutyEscalationPolicyUser
          }
          currentOnCallDutyEscalationPolicyTeams={
            currentOnCallDutyEscalationPolicyTeam
          }
          currentOnCallDutyEscalationPolicySchedules={
            currentOnCallDutyEscalationPolicySchedule
          }
        />
      )}
    </>
  );
};

export default DashboardHeader;
