import React, { ReactElement, FC } from 'react';
import Project from '../../../Types/Project';

const SingleProject: FC<Project> = ({ name, isEditable }): ReactElement => {
    return (
        <div>
            <div>
                <img src="img/placeholder.png" alt="Project Image" />
                <p>{name}</p>
            </div>
            {isEditable && <span>Edit</span>}
        </div>
    );
};

export default SingleProject;
