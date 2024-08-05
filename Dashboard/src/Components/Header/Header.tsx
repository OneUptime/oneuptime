import EventName from "../../Utils/EventName";
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
import Button, { ButtonStyleType } from "CommonUI/src/Components/Button/Button";
import Header from "CommonUI/src/Components/Header/Header";
import HeaderAlert from "CommonUI/src/Components/HeaderAlert/HeaderAlert";
import HeaderModelAlert from "CommonUI/src/Components/HeaderAlert/HeaderModelAlert";
import { SizeProp } from "CommonUI/src/Components/Icon/Icon";
import { BILLING_ENABLED, getAllEnvVars } from "CommonUI/src/Config";
import GlobalEvents from "CommonUI/src/Utils/GlobalEvents";
import Navigation from "CommonUI/src/Utils/Navigation";
import User from "CommonUI/src/Utils/User";
import Incident from "Common/AppModels/Models/Incident";
import Project from "Common/AppModels/Models/Project";
import TeamMember from "Common/AppModels/Models/TeamMember";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

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
    useState<boolean>(true);

  const refreshIncidentCount: VoidFunction = () => {
    setActiveIncidentToggleRefresh(!activeIncidentToggleRefresh);
  };

  useEffect(() => {
    GlobalEvents.addEventListener(
      EventName.ACTIVE_INCIDENTS_COUNT_REFRESH,
      refreshIncidentCount,
    );

    return () => {
      // on unmount.
      GlobalEvents.removeEventListener(
        EventName.ACTIVE_INCIDENTS_COUNT_REFRESH,
        refreshIncidentCount,
      );
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
              <HeaderModelAlert<TeamMember>
                icon={IconProp.Folder}
                className="rounded-md m-3 bg-indigo-500 p-3  hover:bg-indigo-600 cursor-pointer ml-0"
                modelType={TeamMember}
                query={{
                  userId: User.getUserId(),
                  hasAcceptedInvitation: false,
                }}
                singularName="Project Invitation"
                pluralName="Project Invitations"
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
                className="rounded-md m-3 bg-red-500 p-3  hover:bg-red-600 cursor-pointer ml-0"
                query={{
                  currentIncidentState: {
                    order: 1,
                  },
                }}
                refreshToggle={activeIncidentToggleRefresh}
                singularName="New Incident"
                pluralName="New Incidents"
                requestOptions={{
                  isMultiTenantRequest: true,
                }}
                onClick={() => {
                  Navigation.navigate(RouteMap[PageMap.NEW_INCIDENTS]!);
                }}
              />

              {showTrialButton && (
                <HeaderAlert
                  icon={IconProp.Clock}
                  className="rounded-md m-3 bg-indigo-500 p-3  ml-0"
                  title={`Trial ends in ${OneUptimeDate.getNumberOfDaysBetweenDatesInclusive(
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
