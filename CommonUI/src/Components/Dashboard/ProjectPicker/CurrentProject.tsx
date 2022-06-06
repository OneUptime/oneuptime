import React, { ReactElement, useState } from 'react';
import ProjectList from './ProjectList';
import { faCaretDown } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import './Project.scss';

const CurrentProject = (): ReactElement => {
    const [showList, setShowList] = useState(false);

    return (
        <div className="projectPreview">
            <div
                className="preview"
                onClick={() => {
                    return setShowList(!showList);
                }}
            >
                <img src="img/placeholder.png" alt="Project Image" />
                <p>Flow</p>
                <FontAwesomeIcon icon={faCaretDown} />
            </div>
            {showList && <ProjectList />}
        </div>
    );
};

export default CurrentProject;
