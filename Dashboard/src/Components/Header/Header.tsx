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
import Route from "Common/Types/API/Route";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Header from "Common/UI/Components/Header/Header";
import HeaderAlert, {
  HeaderAlertType,
} from "Common/UI/Components/HeaderAlert/HeaderAlert";
import HeaderModelAlert from "Common/UI/Components/HeaderAlert/HeaderModelAlert";
import HeaderAlertGroup from "Common/UI/Components/HeaderAlert/HeaderAlertGroup";
import Icon from "Common/UI/Components/Icon/Icon";
import { APP_API_URL, BILLING_ENABLED, getAllEnvVars } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import User from "Common/UI/Utils/User";
import Incident from "Common/Models/DatabaseModels/Incident";
import Project from "Common/Models/DatabaseModels/Project";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
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
  const [activeIncidentToggleRefresh, setActiveIncidentToggleRefresh] =
    useState<string>(OneUptimeDate.getCurrentDate().toString());

  const [activeAlertToggleRefresh, setActiveAlertToggleRefresh] =
    useState<string>(OneUptimeDate.getCurrentDate().toString());

  const refreshIncidentCount: VoidFunction = () => {
    setActiveIncidentToggleRefresh(OneUptimeDate.getCurrentDate().toString());
  };

  const refreshAlertCount: VoidFunction = () => {
    setActiveAlertToggleRefresh(OneUptimeDate.getCurrentDate().toString());
  };

  const [showCurrentOnCallPolicyModal, setShowCurrentOnCallPolicyModal] =
    useState<boolean>(false);

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

  useEffect(() => {
    const realtimeIncidentStop: VoidFunction = realtimeIncidentCountRefresh();

    const realtimeAlertStop: VoidFunction = realtimeAlertCountRefresh();

    return () => {
      realtimeIncidentStop();
      realtimeAlertStop();
    };
  }, []);

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

            <div className="flex">
              <HeaderAlertGroup>
                <HeaderModelAlert<TeamMember>
                  icon={IconProp.Folder}
                  modelType={TeamMember}
                  query={{
                    userId: User.getUserId(),
                    hasAcceptedInvitation: false,
                  }}
                  alertType={HeaderAlertType.INFO}
                  singularName="Invitation"
                  pluralName="Invitations"
                  tooltip="Looks like you have pending project invitations. Please click here to review and accept them."
                  requestOptions={{
                    isMultiTenantRequest: true,
                  }}
                  onClick={() => {
                    Navigation.navigate(
                      RouteUtil.populateRouteParams(
                        RouteMap[PageMap.PROJECT_INVITATIONS]!,
                      ),
                    );
                  }}
                />

                <HeaderModelAlert<Incident>
                  icon={IconProp.Alert}
                  modelType={Incident}
                  alertType={HeaderAlertType.ERROR}
                  query={{
                    currentIncidentState: {
                      order: 1,
                    },
                  }}
                  refreshToggle={activeIncidentToggleRefresh}
                  singularName="Incident"
                  pluralName="Incidents"
                  tooltip="View all active incidents"
                  requestOptions={{
                    isMultiTenantRequest: true,
                  }}
                  onClick={() => {
                    Navigation.navigate(
                      RouteUtil.populateRouteParams(
                        RouteMap[PageMap.NEW_INCIDENTS]!,
                      ),
                    );
                  }}
                />

                <HeaderModelAlert<Alert>
                  icon={IconProp.ExclaimationCircle}
                  modelType={Alert}
                  alertType={HeaderAlertType.ERROR}
                  query={{
                    currentAlertState: {
                      order: 1,
                    },
                  }}
                  refreshToggle={activeAlertToggleRefresh}
                  singularName="Alert"
                  pluralName="Alerts"
                  tooltip="View all active alerts"
                  requestOptions={{
                    isMultiTenantRequest: true,
                  }}
                  onClick={() => {
                    Navigation.navigate(
                      RouteUtil.populateRouteParams(
                        RouteMap[PageMap.NEW_ALERTS]!,
                      ),
                    );
                  }}
                />

                {showTrialButton && (
                  <HeaderAlert
                    icon={IconProp.Clock}
                    tooltip="Your trial ends soon"
                    alertType={HeaderAlertType.INFO}
                    onClick={() => {
                      Navigation.navigate(
                        RouteUtil.populateRouteParams(
                          RouteMap[PageMap.SETTINGS_BILLING]!,
                        ),
                      );
                    }}
                    title={`${OneUptimeDate.getNumberOfDaysBetweenDatesInclusive(
                      OneUptimeDate.getCurrentDate(),
                      props.selectedProject!.trialEndsAt!,
                    )}`}
                    suffix={`${
                      OneUptimeDate.getNumberOfDaysBetweenDatesInclusive(
                        OneUptimeDate.getCurrentDate(),
                        props.selectedProject!.trialEndsAt!,
                      ) > 1
                        ? "days"
                        : "day"
                    }`}
                  />
                )}

                {props.selectedProject && currentOnCallPolicies.length > 0 ? (
                  <HeaderAlert
                    icon={IconProp.Call}
                    tooltip="On-call policies you are currently on duty for"
                    alertType={HeaderAlertType.SUCCESS}
                    onClick={() => {
                      setShowCurrentOnCallPolicyModal(true);
                    }}
                    title={`${currentOnCallPolicies.length}`}
                    suffix={`${
                      currentOnCallPolicies.length > 1
                        ? "On-Call Policies"
                        : "On-Call Policy"
                    }`}
                  />
                ) : (
                  <></>
                )}
              </HeaderAlertGroup>
            </div>
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
            {/* <Notifications /> */}
            {showAddCardButton ? (
              <div
                onClick={() => {
                  Navigation.navigate(
                    RouteUtil.populateRouteParams(
                      RouteMap[PageMap.SETTINGS_BILLING] as Route,
                    ),
                  );
                }}
                className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg cursor-pointer transition-all duration-150 mr-1"
              >
                <Icon
                  icon={IconProp.Billing}
                  className="h-4 w-4 text-amber-600"
                />
                <span className="text-sm font-medium text-amber-700">
                  Add Card Details
                </span>
              </div>
            ) : (
              <></>
            )}
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
