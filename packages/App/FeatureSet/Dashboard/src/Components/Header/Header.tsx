import {
  getLiveProjectIds,
  getLiveProjectsKey,
} from "../../Utils/LiveProjects";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
/*
 * import SearchBox from './SearchBox';
 * import Notifications from './Notifications';
 */
import AskAI from "./AskAI";
import Help from "./Help";
import Search from "./Search";
import Logo from "./Logo";
import ProjectPicker from "./ProjectPicker";
import Upgrade from "./Upgrade";
import UserProfile from "./UserProfile";
import { listenToHeaderCountChanges } from "./HeaderLiveCounts";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
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
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import Project from "Common/Models/DatabaseModels/Project";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { useTranslation } from "react-i18next";
import CoalescedRefresh from "Common/UI/Utils/CoalescedRefresh";
import ProjectUtil from "Common/UI/Utils/Project";
import Alert from "Common/Models/DatabaseModels/Alert";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyEscalationRuleTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import SSOAuthorizationException from "Common/Types/Exception/SsoAuthorizationException";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import URL from "Common/Types/API/URL";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallLookupFailedLine from "./OnCallLookupFailedLine";
import CurrentOnCallPolicyModal from "../OnCallPolicy/CurrentOnCallPolicyModal";
import useNotificationSetupNudge, {
  NotificationSetupNudgeState,
} from "./useNotificationSetupNudge";
import {
  NOTIFICATION_SETUP_NUDGE_COPY,
  NOTIFICATION_SETUP_NUDGE_ITEM_ID,
  getNotificationSetupPage,
  getNotificationSetupReasonText,
} from "./NotificationSetupNudge";
import { NotificationBellSection } from "Common/UI/Components/HeaderAlert/NotificationBell/NotificationItem";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  projects: Array<Project>;
  onProjectSelected: (project: Project) => void;
  showProjectModal: boolean;
  onProjectModalClose: () => void;
  selectedProject: Project | null;
  paymentMethodsCount?: number | undefined;
  /*
   * The header's on-call lookup is a plain API call, so it does not get
   * ModelAPI's redirect on an SSO error. It reports one here instead, which
   * lets the shell send the user to the project's SSO page whether or not
   * billing is enabled.
   */
  onSsoAuthorizationRequired?: (() => void) | undefined;
}

/*
 * How often, at most, a count in the header is read again while records of
 * its kind keep changing (CoalescedRefresh). The first change is counted at
 * once; a burst of them - a bulk action's - once more five seconds later.
 */
export const HEADER_COUNT_REFRESH_INTERVAL_IN_MS: number = 5000;

// One coalesced read per count the bell shows (CoalescedRefresh).
interface HeaderCountRefreshes {
  incidents: CoalescedRefresh;
  alerts: CoalescedRefresh;
  alertEpisodes: CoalescedRefresh;
  incidentEpisodes: CoalescedRefresh;
}

/*
 * The widths an entry of the header's right rail is drawn from (see the
 * rail below): from md (768px), where the phone's menu stops, for Search and
 * Help; from lg (1024px) for Upgrade and Ask AI.
 */
export const FROM_TABLET_WIDTH_CLASS_NAME: string =
  "max-md:hidden items-center md:flex";
export const FROM_LAPTOP_WIDTH_CLASS_NAME: string =
  "max-lg:hidden items-center lg:flex";

const DashboardHeader: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
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
              /*
               * In the state new ones start in - not "the state numbered
               * 1": states are dragged into any order, and the first one
               * need not be where new ones start.
               */
              isCreatedState: true,
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
              /*
               * In the state new ones start in - not "the state numbered
               * 1": states are dragged into any order, and the first one
               * need not be where new ones start.
               */
              isCreatedState: true,
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

  /*
   * The episodes count what the page the bell opens lists - Active Alert
   * Episodes, Active Incident Episodes: episodes nobody has acknowledged yet
   * (in the state new ones start in), from every project the person belongs
   * to, as the incidents and alerts counts do. They used to count every
   * unresolved episode of the open project only, so the bell said "3 Active
   * Alert Episodes" and the page it opened listed one.
   */
  const fetchAlertEpisodesCount: PromiseVoidFunction =
    useCallback(async (): Promise<void> => {
      try {
        const count: number = await ModelAPI.count<AlertEpisode>({
          modelType: AlertEpisode,
          query: {
            currentAlertState: {
              isCreatedState: true,
            },
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
        const count: number = await ModelAPI.count<IncidentEpisode>({
          modelType: IncidentEpisode,
          query: {
            currentIncidentState: {
              isCreatedState: true,
            },
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

  /*
   * Each count is read again when a record of its kind changes, in any of
   * the projects it counts (HeaderLiveCounts) - at most once every
   * HEADER_COUNT_REFRESH_INTERVAL_IN_MS (CoalescedRefresh). A bulk action
   * that resolves thousands of alerts sends an event for every one, and each
   * used to read the count again while the action ran. One refresh per
   * count for the header's whole life, shared by every project's changes:
   * the projects heard can change, and a burst stays one read.
   */
  const countRefreshesRef: MutableRefObject<HeaderCountRefreshes | null> =
    useRef<HeaderCountRefreshes | null>(null);

  useEffect(() => {
    const refreshes: HeaderCountRefreshes = {
      incidents: new CoalescedRefresh({
        refresh: fetchIncidentsCount,
        minIntervalInMs: HEADER_COUNT_REFRESH_INTERVAL_IN_MS,
      }),
      alerts: new CoalescedRefresh({
        refresh: fetchAlertsCount,
        minIntervalInMs: HEADER_COUNT_REFRESH_INTERVAL_IN_MS,
      }),
      alertEpisodes: new CoalescedRefresh({
        refresh: fetchAlertEpisodesCount,
        minIntervalInMs: HEADER_COUNT_REFRESH_INTERVAL_IN_MS,
      }),
      incidentEpisodes: new CoalescedRefresh({
        refresh: fetchIncidentEpisodesCount,
        minIntervalInMs: HEADER_COUNT_REFRESH_INTERVAL_IN_MS,
      }),
    };

    countRefreshesRef.current = refreshes;

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
      countRefreshesRef.current = null;
      refreshes.incidents.stop();
      refreshes.alerts.stop();
      refreshes.alertEpisodes.stop();
      refreshes.incidentEpisodes.stop();
    };
  }, [
    fetchIncidentsCount,
    fetchAlertsCount,
    fetchAlertEpisodesCount,
    fetchIncidentEpisodesCount,
    fetchInvitationsCount,
  ]);

  /*
   * The projects whose changes the counts hear: every project the person
   * belongs to, the open one first (Utils/LiveProjects). Read on every
   * render, so the projects loading after the header - the first page of a
   * session - and the project opened without a reload are heard; the rooms
   * are joined again only when the projects themselves change.
   */
  const countProjectIds: Array<string> = getLiveProjectIds({
    projects: props.projects,
    currentProjectId: ProjectUtil.getCurrentProjectId(),
  });

  const countSubscriptionKey: string = getLiveProjectsKey(countProjectIds);

  useEffect(() => {
    if (countProjectIds.length === 0) {
      return undefined;
    }

    // The header's refreshes as they are when a change is heard.
    const stopListening: Array<() => void> = [
      listenToHeaderCountChanges({
        modelType: Incident,
        projectIds: countProjectIds,
        onChange: () => {
          countRefreshesRef.current?.incidents.request();
        },
      }),
      listenToHeaderCountChanges({
        modelType: Alert,
        projectIds: countProjectIds,
        onChange: () => {
          countRefreshesRef.current?.alerts.request();
        },
      }),
      listenToHeaderCountChanges({
        modelType: AlertEpisode,
        projectIds: countProjectIds,
        onChange: () => {
          countRefreshesRef.current?.alertEpisodes.request();
        },
      }),
      listenToHeaderCountChanges({
        modelType: IncidentEpisode,
        projectIds: countProjectIds,
        onChange: () => {
          countRefreshesRef.current?.incidentEpisodes.request();
        },
      }),
    ];

    return () => {
      for (const stop of stopListening) {
        stop();
      }
    };
  }, [countSubscriptionKey]);

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

  /*
   * Why the policies the person is on duty for could not be read
   * (API.getFriendlyMessage). Said quietly in the bell, with Try again: it
   * was a dialog over whatever page they were on, for a lookup they never
   * asked for (#9120).
   */
  const [onCallDutyPolicyFetchError, setOnCallDutyPolicyFetchError] = useState<
    string | null
  >(null);

  // Bumped by Try again: the lookup below runs again.
  const [onCallLookupCount, setOnCallLookupCount] = useState<number>(0);

  const [currentOnCallPolicies, setCurrentOnCallPolicies] = useState<
    Array<OnCallDutyPolicy>
  >([]);

  const currentProjectId: string | undefined =
    ProjectUtil.getCurrentProjectId()?.toString();

  const translator: Translator = useTranslator();

  /*
   * "Finish setting up your notifications" (#7040): asked while the person
   * is on an on-call policy in this project and OneUptime cannot fully
   * reach them, by the rule the setup reminder and Readiness use.
   */
  const notificationSetup: NotificationSetupNudgeState =
    useNotificationSetupNudge({
      userId: User.getUserId()?.toString() || null,
      projectId: currentProjectId || null,
    });

  useEffect(() => {
    let isCancelled: boolean = false;

    setCurrentOnCallPolicies([]);
    setCurrentOnCallDutyEscalationPolicyUser([]);
    setCurrentOnCallDutyEscalationPolicyTeam([]);
    setCurrentOnCallDutyEscalationPolicySchedule([]);
    setOnCallDutyPolicyFetchError(null);

    const fetchCurrentOnCallDutyPolicies: PromiseVoidFunction =
      async (): Promise<void> => {
        try {
          if (currentProjectId) {
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

            if (isCancelled) {
              return;
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
                const onCallPolicyIndex: number =
                  currentOnCallPolicies.findIndex(
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
                const onCallPolicyIndex: number =
                  currentOnCallPolicies.findIndex(
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
                const onCallPolicyIndex: number =
                  currentOnCallPolicies.findIndex(
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
        } catch (err) {
          if (isCancelled) {
            return;
          }

          if (
            err instanceof HTTPErrorResponse &&
            SSOAuthorizationException.isException(err.message)
          ) {
            // Not an on-call failure: the project needs an SSO sign-in.
            props.onSsoAuthorizationRequired?.();
            return;
          }

          setOnCallDutyPolicyFetchError(API.getFriendlyMessage(err));
        }
      };

    fetchCurrentOnCallDutyPolicies().catch(() => {
      // ignore this.
    });

    return () => {
      isCancelled = true;
    };
    // Cached and refreshed Project instances share one lookup for the same id.
  }, [currentProjectId, onCallLookupCount]);

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
      !props.selectedProject.resellerId &&
      // Billed by a cloud marketplace: there is no card to add.
      !props.selectedProject.billingMarketplace,
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
        title: t(
          incidentsCount === 1
            ? "header.incidentsActiveOne"
            : "header.incidentsActiveOther",
          { count: incidentsCount },
        ),
        count: incidentsCount,
        alertType: HeaderAlertType.ERROR,
        tooltip: t("header.incidentsTooltip"),
      });

      // Alerts - ERROR type
      items.push({
        id: "alerts",
        icon: IconProp.ExclaimationCircle,
        title: t(
          alertsCount === 1
            ? "header.alertsActiveOne"
            : "header.alertsActiveOther",
          { count: alertsCount },
        ),
        count: alertsCount,
        alertType: HeaderAlertType.ERROR,
        tooltip: t("header.alertsTooltip"),
      });

      // Alert Episodes - ERROR type
      items.push({
        id: "alertEpisodes",
        icon: IconProp.SquareStack3D,
        title: t(
          alertEpisodesCount === 1
            ? "header.alertEpisodesOne"
            : "header.alertEpisodesOther",
          { count: alertEpisodesCount },
        ),
        count: alertEpisodesCount,
        alertType: HeaderAlertType.ERROR,
        tooltip: t("header.alertEpisodesTooltip"),
      });

      // Incident Episodes - ERROR type
      items.push({
        id: "incidentEpisodes",
        icon: IconProp.SquareStack3D,
        title: t(
          incidentEpisodesCount === 1
            ? "header.incidentEpisodesOne"
            : "header.incidentEpisodesOther",
          { count: incidentEpisodesCount },
        ),
        count: incidentEpisodesCount,
        alertType: HeaderAlertType.ERROR,
        tooltip: t("header.incidentEpisodesTooltip"),
      });

      // On-Call Policies - SUCCESS type
      if (props.selectedProject && currentOnCallPolicies.length > 0) {
        items.push({
          id: "oncall",
          icon: IconProp.Call,
          title: t(
            currentOnCallPolicies.length === 1
              ? "header.onDutyOne"
              : "header.onDutyOther",
            { count: currentOnCallPolicies.length },
          ),
          count: currentOnCallPolicies.length,
          alertType: HeaderAlertType.SUCCESS,
          tooltip: t("header.onDutyTooltip"),
        });
      }

      /*
       * Under On-Call, beside the duty it is about: one click to the page
       * that fixes it, and Hide puts it away for a week. It goes by itself
       * once the person can be reached.
       */
      if (props.selectedProject && notificationSetup.reason) {
        items.push({
          id: NOTIFICATION_SETUP_NUDGE_ITEM_ID,
          icon: IconProp.BellAlert,
          title:
            translator.translateText(NOTIFICATION_SETUP_NUDGE_COPY.title) ||
            NOTIFICATION_SETUP_NUDGE_COPY.title,
          description: translator.translateText(
            getNotificationSetupReasonText(notificationSetup.reason),
          ),
          count: 1,
          alertType: HeaderAlertType.WARNING,
          section: NotificationBellSection.OnCall,
          dismissTitle: translator.translateText(
            NOTIFICATION_SETUP_NUDGE_COPY.hide,
          ),
          onDismiss: notificationSetup.hide,
        });
      }

      // Invitations - INFO type
      items.push({
        id: "invitations",
        icon: IconProp.Folder,
        title: t(
          invitationsCount === 1
            ? "header.invitationsPendingOne"
            : "header.invitationsPendingOther",
          { count: invitationsCount },
        ),
        count: invitationsCount,
        alertType: HeaderAlertType.INFO,
        tooltip: t("header.invitationsTooltip"),
      });

      // Trial Days - INFO type (only if showTrialButton is true)
      if (showTrialButton && trialDaysRemaining > 0) {
        items.push({
          id: "trial",
          icon: IconProp.Clock,
          title: t(
            trialDaysRemaining === 1
              ? "header.trialEndsOne"
              : "header.trialEndsOther",
            { count: trialDaysRemaining },
          ),
          count: trialDaysRemaining,
          alertType: HeaderAlertType.INFO,
          tooltip: t("header.trialTooltip"),
        });
      }

      // Add Card Details - INFO type (only if showAddCardButton is true)
      if (showAddCardButton) {
        items.push({
          id: "addcard",
          icon: IconProp.Billing,
          title: t("header.addCardDetails"),
          count: 1,
          alertType: HeaderAlertType.INFO,
          tooltip: t("header.addCardTooltip"),
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
        Navigation.navigate(
          RouteUtil.populateRouteParams(RouteMap[PageMap.MY_ON_CALL_POLICIES]!),
        );
        break;
      case NOTIFICATION_SETUP_NUDGE_ITEM_ID:
        if (notificationSetup.reason) {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[getNotificationSetupPage(notificationSetup.reason)]!,
            ),
          );
        }
        break;
    }
  };

  return (
    <>
      <Header
        leftComponents={
          <>
            <Logo />

            <ProjectPicker
              showProjectModal={props.showProjectModal}
              onProjectModalClose={props.onProjectModalClose}
              projects={props.projects}
              onProjectSelected={props.onProjectSelected}
              selectedProject={props.selectedProject}
            />
          </>
        }
        rightComponents={
          <>
            {/*
             * Each entry of the rail says from which width it is drawn, in
             * the order the desktop rail has always had: Upgrade, Search,
             * Ask AI, the bell, Help, the profile button.
             *
             * - Search and Help from md (768px). Below md the phone's menu
             *   carries them both (NavBar's mobileMenuTop and
             *   mobileMenuBottom, #6816), and that menu is drawn only below
             *   md, so from md the header has to (#7037): between 768 and
             *   1023px they were in neither, and Search, Help, How OneUptime
             *   works and the Glossary could not be reached at all on a
             *   tablet. Help is one square button, and Search fits beside
             *   it with the project's name still there, in German and
             *   Arabic too.
             * - Upgrade and Ask AI from lg (1024px). Ask AI's words alone
             *   are wider than a tablet's header has to spare in some
             *   languages (Arabic's are over 200px), and Search reaches it
             *   (its Ask AI action) on a phone and a tablet alike. Upgrade
             *   is a link to Billing, which Project Settings has too.
             *
             * `max-md:hidden` and `max-lg:hidden`, not `hidden`: a foreign
             * `.hidden` rule (browser extension, user stylesheet) would
             * otherwise take them off every screen, desktop included — see
             * Common's NavBar desktop view.
             */}
            {BILLING_ENABLED &&
            props.selectedProject?.id &&
            props.selectedProject.paymentProviderPlanId &&
            SubscriptionPlan.isFreePlan(
              props.selectedProject.paymentProviderPlanId,
              getAllEnvVars(),
            ) ? (
              <div className={FROM_LAPTOP_WIDTH_CLASS_NAME}>
                <Upgrade />
              </div>
            ) : (
              <></>
            )}
            <div className={FROM_TABLET_WIDTH_CLASS_NAME}>
              <Search />
            </div>
            <div className={FROM_LAPTOP_WIDTH_CLASS_NAME}>
              <AskAI />
            </div>
            {/*
             * The bell and the profile button stay at every width. They are the
             * two the header cannot do without: what is on fire right now, and
             * the menu that owns the profile, admin settings, the theme switch
             * and log out — none of which is reachable anywhere else on a phone.
             */}
            <NotificationBell
              items={buildNotificationItems()}
              onItemClick={handleNotificationItemClick}
              notice={
                onCallDutyPolicyFetchError ? (
                  <OnCallLookupFailedLine
                    error={onCallDutyPolicyFetchError}
                    onTryAgain={() => {
                      setOnCallLookupCount((count: number): number => {
                        return count + 1;
                      });
                    }}
                  />
                ) : undefined
              }
            />
            <div className={FROM_TABLET_WIDTH_CLASS_NAME}>
              <Help />
            </div>
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
