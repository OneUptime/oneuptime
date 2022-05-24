import React, { ReactElement } from 'react';
import SingleProject from './Project';

const ProjectLists = (): ReactElement => {
    return (
        <div className="lists">
            <SingleProject name="Flow" isEditable={true} />
            <SingleProject name="Test" isEditable={false} />
        </div>
    );
};

export default ProjectLists;
