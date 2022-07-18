import MasterPage from 'CommonUI/src/Components/MasterPage/MasterPage';
import Footer from '../Footer/Footer';
import Header from '../Header/Header';
import NavBar from '../NavBar/NavBar';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import Project from 'Common/Models/Project';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
    isLoading: boolean;
    projects: Array<Project>;
    error: string;
    onProjectSelected: (project: Project) => void; 
}

const DashboardMasterPage: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const [selectedProject, setSelectedProject] = useState<Project | null>(
        null
    );

    const onProjectSelected = (project: Project) => {
        setSelectedProject(project);
    }

    return (
        <MasterPage
            footer={<Footer />}
            header={<Header projects={props.projects} onProjectSelected={onProjectSelected} />}
            navBar={<NavBar currentProject={selectedProject} />}
            isLoading={props.isLoading}
            error={props.error}
        >
            {props.children}
        </MasterPage>
    );
};

export default DashboardMasterPage;
