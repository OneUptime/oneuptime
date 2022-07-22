import MasterPage from 'CommonUI/src/Components/MasterPage/MasterPage';
import Footer from '../Footer/Footer';
import Header from '../Header/Header';
import NavBar from '../NavBar/NavBar';
import React, { FunctionComponent, ReactElement } from 'react';
import Project from 'Common/Models/Project';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
    isLoading: boolean;
    projects: Array<Project>;
    error: string;
    onProjectSelected: (project: Project) => void;
    currentProject: Project | null;
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
                />
            }
            navBar={<NavBar currentProject={props.currentProject} />}
            isLoading={props.isLoading}
            error={props.error}
        >
            {props.children}
        </MasterPage>
    );
};

export default DashboardMasterPage;
