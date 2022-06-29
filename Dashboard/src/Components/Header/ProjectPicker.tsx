import React, { FunctionComponent, ReactElement } from 'react';
import ProjectPicker from 'CommonUI/src/Components/Header/ProjectPicker/ProjectPicker';
import ProjectPickerMenu from 'CommonUI/src/Components/Header/ProjectPicker/ProjectPickerMenu';
import ProjectPickerMenuItem from 'CommonUI/src/Components/Header/ProjectPicker/ProjectPickerMenuItem';
import Route from 'Common/Types/API/Route';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import CreateNewProjectButton from 'CommonUI/src/Components/Header/ProjectPicker/CreateNewProjectButton';

const DashboardProjectPicker: FunctionComponent = (): ReactElement => {
    return (
        <ProjectPicker title="Project One" icon={IconProp.Settings}>
            <ProjectPickerMenu>
                <ProjectPickerMenuItem
                    title="Project One"
                    route={new Route('/')}
                    icon={IconProp.Settings}
                />
                <ProjectPickerMenuItem
                    title="Project Two"
                    route={new Route('/')}
                    icon={IconProp.Settings}
                />
                <ProjectPickerMenuItem
                    title="Project Three"
                    route={new Route('/')}
                    icon={IconProp.Settings}
                />
                <CreateNewProjectButton
                    title="Create New Project"
                    route={new Route('/')}
                    icon={IconProp.Add}
                />
            </ProjectPickerMenu>
        </ProjectPicker>
    );
};

export default DashboardProjectPicker;
