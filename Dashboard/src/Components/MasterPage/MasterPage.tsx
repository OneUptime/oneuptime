import MasterPage from 'CommonUI/src/Components/MasterPage/MasterPage';
import Footer from '../Footer/Footer';
import Header from '../Header/Header';
import NavBar from '../NavBar/NavBar';
import React, { FunctionComponent, ReactElement } from 'react';
import Project from 'Model/Models/Project';
import Route from 'Common/Types/API/Route';
import Navigation from 'CommonUI/src/Utils/Navigation';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import SSOAuthorizationException from 'Common/Types/Exception/SsoAuthorizationException';
import TopAlert, {
    TopAlertType,
} from 'CommonUI/src/Components/TopAlert/TopAlert';
import Link from 'CommonUI/src/Components/Link/Link';
import { BILLING_ENABLED } from 'CommonUI/src/Config';
import { SubscriptionStatusUtil } from 'Common/Types/Billing/SubscriptionStatus';

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
    props: ComponentProps
): ReactElement => {
    let isOnHideNavbarPage: boolean = false;

    for (const route of props.hideNavBarOn) {
        if (Navigation.isOnThisPage(route)) {
            isOnHideNavbarPage = true;
        }
    }

    let error: string = '';

    if (props.error && SSOAuthorizationException.isException(props.error)) {
        Navigation.navigate(
            RouteUtil.populateRouteParams(
                RouteMap[PageMap.PROJECT_SSO] as Route
            )
        );
    } else {
        error = props.error;
    }

    let isSubscriptionInactive: boolean = false;

    if (props.selectedProject) {
        const isMeteredSubscriptionInactive: boolean =
            SubscriptionStatusUtil.isSubscriptionInactive(
                props.selectedProject?.paymentProviderMeteredSubscriptionStatus
            );
        const isProjectSubscriptionInactive: boolean =
            SubscriptionStatusUtil.isSubscriptionInactive(
                props.selectedProject?.paymentProviderSubscriptionStatus
            );

        isSubscriptionInactive =
            isMeteredSubscriptionInactive || isProjectSubscriptionInactive;
    }

    return (
        <div>
            {BILLING_ENABLED && isSubscriptionInactive && (
                <TopAlert
                    alertType={TopAlertType.DANGER}
                    title="Your project is not active because some invoices are unpaid."
                    description={
                        <Link
                            className="underline"
                            to={RouteUtil.populateRouteParams(
                                RouteMap[
                                    PageMap.SETTINGS_BILLING_INVOICES
                                ] as Route
                            )}
                        >
                            Click here to pay your unpaid invoices.
                        </Link>
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
                    <NavBar
                        show={props.projects.length > 0 && !isOnHideNavbarPage}
                    />
                }
                isLoading={props.isLoading}
                error={error}
                className="flex flex-col h-screen justify-between"
            >
                {props.children}
            </MasterPage>
        </div>
    );
};

export default DashboardMasterPage;
