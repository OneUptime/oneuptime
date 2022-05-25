import React, { ReactElement, useState } from 'react';
import OutsideClickHandler from 'react-outside-click-handler';
import { faQuestionCircle } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import ResourceList from './ResourceList';

import './Help.scss';

const HelpButton = (): ReactElement => {
    const [showList, setShowList] = useState(false);

    return (
        <OutsideClickHandler
            onOutsideClick={() => {
                if (showList) {
                    setShowList(false);
                }
            }}
        >
            <div className="help-layout">
                <div className="button" onClick={() => setShowList(!showList)}>
                    <FontAwesomeIcon icon={faQuestionCircle} />
                    <span>Help</span>
                </div>
                {showList && <ResourceList />}
            </div>
        </OutsideClickHandler>
    );
};

export default HelpButton;
