import React, { FunctionComponent, ReactElement } from 'react';

const SingleProject: FunctionComponent = (): ReactElement => {
    return (
        <div>
            <div>
                <img src="img/placeholder.png" alt="Project Image" />
                <p>Project name</p>
            </div>
            <span>Edit</span>
        </div>
    );
};

export default SingleProject;
