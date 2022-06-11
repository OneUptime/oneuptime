import React, { ReactElement, useState, FunctionComponent } from 'react';
import ProjectList from './ProjectList';
import OutsideClickHandler from 'react-outside-click-handler';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import './Project.scss';

const CurrentProject: FunctionComponent = (): ReactElement => {
    const [showList, setShowList] = useState(false);

    return (
        <OutsideClickHandler
            onOutsideClick={() => {
                if (showList) {
                    setShowList(false);
                }
            }}
        >
            <div className="projectPreview">
                <div
                    className="preview"
                    onClick={() => {
                        return setShowList(!showList);
                    }}
                >
                    <img src="/img/placeholder.png" alt="Project Image" />
                    <p>Flow</p>
                    <FontAwesomeIcon icon={faChevronDown} />
                </div>
                {showList && <ProjectList />}
            </div>
        </OutsideClickHandler>
    );
};

export default CurrentProject;
