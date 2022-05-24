import React, { ReactElement, useState } from 'react';
import ProjectLists from './ProjectLists';
import { faCaretDown } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import './Project.scss';

const ProjectView = (): ReactElement => {
    const [showProjects, setShowProjects] = useState(false);

    return (
        <div className="projectPreview">
            <div
                className="preview"
                onClick={() => setShowProjects(!showProjects)}
            >
                <img src="img/placeholder.png" alt="Project Image" />
                <p>Flow</p>
                <FontAwesomeIcon icon={faCaretDown} />
            </div>
            {showProjects && <ProjectLists />}
        </div>
    );
};

export default ProjectView;
