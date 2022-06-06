import React, { FunctionComponent, ReactElement } from 'react';
import ProjectItem from './ProjectItem';

const ProjectLists: FunctionComponent = (): ReactElement => {
    return (
        <div className="lists">
            <ProjectItem />
            <ProjectItem />
        </div>
    );
};

export default ProjectLists;
