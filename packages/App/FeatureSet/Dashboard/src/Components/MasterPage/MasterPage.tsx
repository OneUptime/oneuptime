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
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import ProjectUtil from "Common/UI/Utils/Project";

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
  /*
   * Called once the shell has sent the user to the project's SSO page for an
   * SSO error, so the owner of `error` can clear it. A handled error left in
   * place cannot fire the redirect again when the same failure recurs, since
   * setting the same string is not a state change.
   */
  onSsoErrorHandled?: (() => void) | undefined;
  // The header reports a project that requires SSO through this.
  onSsoAuthorizationRequired?: (() => void) | undefined;
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

  /*
   * An SSO error is a redirect to the project's SSO page, not a message. The
   * SSO route needs the project id; without one there is nowhere to send the
   * user, so the error is shown instead of being swallowed.
   */
  const shouldRedirectToSso: boolean =
    Boolean(props.error) &&
    SSOAuthorizationException.isException(props.error) &&
    Boolean(ProjectUtil.getCurrentProjectId());

  /*
   * In an effect, never during render: navigating while rendering updates the
   * router mid-render, react-router drops a navigate made before its first
   * commit, and every re-render would navigate to /sso again, including the
   * one after the user leaves it. Passive effects run after the whole tree's
   * layout effects, which is when App's navigate hook becomes usable, so this
   * works even when the error is present on the first render. Keyed on the
   * error (and on whether it can redirect yet), so re-renders never navigate
   * again.
   */
  useEffect(() => {
    if (!shouldRedirectToSso) {
      return;
    }

    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[PageMap.PROJECT_SSO] as Route),
    );
    props.onSsoErrorHandled?.();
  }, [props.error, shouldRedirectToSso]);

  const error: string = shouldRedirectToSso ? "" : props.error;

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
            onSsoAuthorizationRequired={props.onSsoAuthorizationRequired}
          />
        }
        navBar={
          <NavBar show={props.projects.length > 0 && !isOnHideNavbarPage} />
        }
        isLoading={props.isLoading}
        error={error}
        /*
         * min-h-screen, not h-screen: the top section sticks inside this box,
         * so a fixed 100vh height caps its containing block at one viewport and
         * the header scrolls away for good once the page is longer than that.
         * The min-height still keeps the footer pushed to the bottom on short
         * pages, because <main> grows.
         */
        className="flex flex-col min-h-screen"
      >
        {props.children}
      </MasterPage>
    </div>
  );
};

export default DashboardMasterPage;
