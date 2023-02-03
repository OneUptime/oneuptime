import MasterPage from 'CommonUI/src/Components/MasterPage/MasterPage';
import Footer from '../Footer/Footer';
import Header from '../Header/Header';
import NavBar from '../NavBar/NavBar';
import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import type Project from 'Model/Models/Project';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
    isLoading: boolean;
    projects: Array<Project>;
    error: string;
    onProjectSelected: (project: Project) => void;
    showProjectModal: boolean;
    onProjectModalClose: () => void;
    selectedProject: Project | null;
}

const DashboardMasterPage: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
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
            navBar={<NavBar show={props.projects.length > 0} />}
            isLoading={props.isLoading}
            error={props.error}
        >
            {props.children}
        </MasterPage>
    );
};

export default DashboardMasterPage;
