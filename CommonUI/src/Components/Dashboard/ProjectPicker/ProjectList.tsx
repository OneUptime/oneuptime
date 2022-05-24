import React, { ReactElement } from 'react';
import ProjectItem from './ProjectItem';

const ProjectLists = (): ReactElement => {
    return (
        <div className="lists">
            <ProjectItem />
            <ProjectItem />
        </div>
    );
};

export default ProjectLists;
