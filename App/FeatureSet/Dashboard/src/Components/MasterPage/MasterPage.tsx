import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Footer from "../Footer/Footer";
import Header from "../Header/Header";
import NavBar from "../NavBar/NavBar";
import Route from "Common/Types/API/Route";
import SubscriptionStatus, {
  SubscriptionStatusUtil,
} from "Common/Types/Billing/SubscriptionStatus";
import SSOAuthorizationException from "Common/Types/Exception/SsoAuthorizationException";
import AppLink from "../AppLink/AppLink";
import MasterPage from "Common/UI/Components/MasterPage/MasterPage";
import TopAlert, { TopAlertType } from "Common/UI/Components/TopAlert/TopAlert";
import { BILLING_ENABLED } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import Project from "Common/Models/DatabaseModels/Project";
import React, { FunctionComponent, ReactElement } from "react";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  SurfaceStyle,
  SurfaceStyleProvider,
} from "Common/UI/Contexts/SurfaceStyleContext";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement>;
  isLoading: boolean;
  projects: Array<Project>;
  error: string;
  onProjectSelected: (project: Project) => void;
  showProjectModal: boolean;
  paymentMethodsCount?: number | undefined;
  onProjectModalClose: () => void;
  selectedProject: Project | null;
  hideNavBarOn: Array<Route>;
}

const DashboardMasterPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let isOnHideNavbarPage: boolean = false;

  for (const route of props.hideNavBarOn) {
    if (Navigation.isOnThisPage(route)) {
      isOnHideNavbarPage = true;
    }
  }

  let error: string = "";

  if (props.error && SSOAuthorizationException.isException(props.error)) {
    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[PageMap.PROJECT_SSO] as Route),
    );
  } else {
    error = props.error;
  }

  let isSubscriptionInactiveOrOverdue: boolean = false;
  let isSubscriptionOverdue: boolean = false;

  if (props.selectedProject) {
    isSubscriptionInactiveOrOverdue =
      ProjectUtil.setIsSubscriptionInactiveOrOverdue({
        paymentProviderMeteredSubscriptionStatus:
          props.selectedProject?.paymentProviderMeteredSubscriptionStatus ||
          SubscriptionStatus.Active,
        paymentProviderSubscriptionStatus:
          props.selectedProject?.paymentProviderSubscriptionStatus ||
          SubscriptionStatus.Active,
      });

    isSubscriptionOverdue =
      SubscriptionStatusUtil.isSubscriptionOverdue(
        props.selectedProject?.paymentProviderMeteredSubscriptionStatus ||
          SubscriptionStatus.Active,
      ) ||
      SubscriptionStatusUtil.isSubscriptionOverdue(
        props.selectedProject?.paymentProviderSubscriptionStatus ||
          SubscriptionStatus.Active,
      );
  }

  return (
    <SurfaceStyleProvider style={SurfaceStyle.Quiet}>
      <div>
        {BILLING_ENABLED && isSubscriptionInactiveOrOverdue && (
          <TopAlert
            alertType={TopAlertType.DANGER}
            title={
              isSubscriptionOverdue
                ? "Your project will become inactive soon because some of the invoices are unpaid"
                : "Your project is not active because some invoices are unpaid. If left unpaid, your project will be deleted."
            }
            description={
              <AppLink
                className="underline"
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SETTINGS_BILLING_INVOICES] as Route,
                )}
              >
                Click here to pay your unpaid invoices.
              </AppLink>
            }
          />
        )}

        <MasterPage
          footer={<Footer />}
          header={
            <Header
              projects={props.projects}
              onProjectSelected={props.onProjectSelected}
              showProjectModal={props.showProjectModal}
              onProjectModalClose={props.onProjectModalClose}
              selectedProject={props.selectedProject || null}
              paymentMethodsCount={props.paymentMethodsCount}
            />
          }
          navBar={
            <NavBar show={props.projects.length > 0 && !isOnHideNavbarPage} />
          }
          isLoading={props.isLoading}
          error={error}
          className="flex min-h-screen flex-col bg-slate-50/60 text-slate-900 antialiased"
          topSectionClassName="border-b border-slate-200/80 bg-white/90 text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur-xl [&>div>div>nav]:!mt-0 [&>div>div>nav]:!bg-transparent"
        >
          {props.children}
        </MasterPage>
      </div>
    </SurfaceStyleProvider>
  );
};

export default DashboardMasterPage;
