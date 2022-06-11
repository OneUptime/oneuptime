import React, { ReactElement, FunctionComponent } from 'react';
import ProjectList from './ProjectList';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import './Project.scss';
import useComponentVisible from 'CommonUI/src/Types/UseComponentVisible';

const CurrentProject: FunctionComponent = (): ReactElement => {
    const { ref, isComponentVisible, setIsComponentVisible } = useComponentVisible(false);

    return (

        <div className="projectPreview">
            <div
                ref={ref}
                className="preview"
                onClick={() => {
                    return setIsComponentVisible(!isComponentVisible);
                }}
            >
                <img src="/img/placeholder.png" alt="Project Image" />
                <p>Project</p>
                <FontAwesomeIcon icon={faChevronDown} />
            </div>
            {isComponentVisible && <ProjectList />}
        </div>

    );
};

export default CurrentProject;
