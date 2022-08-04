import React, { FunctionComponent, ReactElement } from 'react';
import SearchBox from 'CommonUI/src/Components/Header/SearchBox';
import Notifications from './Notifications';
import Help from './Help';
import UserProfile from './UserProfile';
import ProjectPicker from './ProjectPicker';
// import ObjectID from 'Common/Types/ObjectID';

import Header from 'CommonUI/src/Components/Header/Header';
import Project from 'Model/Models/Project';

export interface ComponentProps {
    projects: Array<Project>;
    onProjectSelected: (project: Project) => void;
}

const DashboardHeader: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Header
            leftComponents={
                <>
                    <ProjectPicker
                        projects={props.projects}
                        onProjectSelected={props.onProjectSelected}
                    />
                    <SearchBox key={2} onChange={(_value: string) => {}} />
                </>
            }
            rightComponents={
                <>
                    <Notifications />
                    <Help />
                    <UserProfile />
                </>
            }
        />
    );
};

export default DashboardHeader;
