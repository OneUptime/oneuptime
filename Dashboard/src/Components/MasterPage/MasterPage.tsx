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


    let error: string = ''

    if(props.error && SSOAuthorizationException.isException(props.error)) {
        Navigation.navigate(RouteUtil.populateRouteParams(RouteMap[PageMap.PROJECT_SSO] as Route));
    }else{
        error = props.error;
    }

    return (
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
    );
};

export default DashboardMasterPage;
