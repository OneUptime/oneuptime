import MasterPage from 'CommonUI/src/Components/MasterPage/MasterPage';
import Footer from '../Footer/Footer';
import Header from '../Header/Header';
import NavBar from '../NavBar/NavBar';
import React, { FunctionComponent, ReactElement } from 'react';
import Project from 'Model/Models/Project';
import Route from 'Common/Types/API/Route';
import Navigation from 'CommonUI/src/Utils/Navigation';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
    isLoading: boolean;
    projects: Array<Project>;
    error: string;
    onProjectSelected: (project: Project) => void;
    showProjectModal: boolean;
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
                />
            }
            navBar={
                <NavBar
                    show={props.projects.length > 0 && !isOnHideNavbarPage}
                />
            }
            isLoading={props.isLoading}
            error={props.error}
        >
            {props.children}
        </MasterPage>
    );
};

export default DashboardMasterPage;
