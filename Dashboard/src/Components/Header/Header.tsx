import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
// import SearchBox from './SearchBox';
// import Notifications from './Notifications';
import Help from "./Help";
import Logo from "./Logo";
import ProjectPicker from "./ProjectPicker";
import Upgrade from "./Upgrade";
import UserProfile from "./UserProfile";
import Route from "Common/Types/API/Route";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import OneUptimeDate from "Common/Types/Date";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Header from "Common/UI/Components/Header/Header";
import HeaderAlert, {
  HeaderAlertType,
} from "Common/UI/Components/HeaderAlert/HeaderAlert";
import HeaderModelAlert from "Common/UI/Components/HeaderAlert/HeaderModelAlert";
import HeaderAlertGroup from "Common/UI/Components/HeaderAlert/HeaderAlertGroup";
import { SizeProp } from "Common/UI/Components/Icon/Icon";
import { BILLING_ENABLED, getAllEnvVars } from "Common/UI/Config";
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
import DashboardNavigation from "../../Utils/Navigation";
import ModelEventType from "Common/Types/Realtime/ModelEventType";
import Alert from "Common/Models/DatabaseModels/Alert";

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

  const realtimeIncidentCountRefresh: () => VoidFunction = (): VoidFunction => {
    const stopListeningOnCreate: VoidFunction =
      Realtime.listenToModelEvent<Incident>(
        {
          eventType: ModelEventType.Create,
          modelType: Incident,
          tenantId: DashboardNavigation.getProjectId()!,
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
          tenantId: DashboardNavigation.getProjectId()!,
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
          tenantId: DashboardNavigation.getProjectId()!,
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
          tenantId: DashboardNavigation.getProjectId()!,
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
          tenantId: DashboardNavigation.getProjectId()!,
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
          tenantId: DashboardNavigation.getProjectId()!,
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
      <Header
        leftComponents={
          <>
            {props.projects.length === 0 && <Logo onClick={() => {}} />}

            <ProjectPicker
              showProjectModal={props.showProjectModal}
              onProjectModalClose={props.onProjectModalClose}
              projects={props.projects}
              onProjectSelected={props.onProjectSelected}
              selectedProject={props.selectedProject}
            />

            <div className="flex ml-3">
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
                    Navigation.navigate(RouteMap[PageMap.PROJECT_INVITATIONS]!);
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
                    Navigation.navigate(RouteMap[PageMap.NEW_INCIDENTS]!);
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
                  onClick={() => {
                    Navigation.navigate(RouteMap[PageMap.ALERTS]!);
                  }}
                />

                {showTrialButton && (
                  <HeaderAlert
                    icon={IconProp.Clock}
                    tooltip="Your trial ends soon"
                    alertType={HeaderAlertType.INFO}
                    onClick={() => {
                      Navigation.navigate(RouteMap[PageMap.SETTINGS_BILLING]!);
                    }}
                    title={`${OneUptimeDate.getNumberOfDaysBetweenDatesInclusive(
                      OneUptimeDate.getCurrentDate(),
                      props.selectedProject!.trialEndsAt!,
                    )} ${
                      OneUptimeDate.getNumberOfDaysBetweenDatesInclusive(
                        OneUptimeDate.getCurrentDate(),
                        props.selectedProject!.trialEndsAt!,
                      ) > 1
                        ? "days"
                        : "day"
                    }`}
                  />
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
              <Button
                title="Add Card Details"
                onClick={() => {
                  Navigation.navigate(
                    RouteUtil.populateRouteParams(
                      RouteMap[PageMap.SETTINGS_BILLING] as Route,
                    ),
                  );
                }}
                buttonStyle={ButtonStyleType.LINK}
                icon={IconProp.Billing}
                iconSize={SizeProp.Larger}
              ></Button>
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
    </>
  );
};

export default DashboardHeader;
