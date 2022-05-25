import React, { ReactElement, useState } from 'react';
import OutsideClickHandler from 'react-outside-click-handler';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import './Create.scss';
import OptionList from './OptionList';

const CreateButton = (): ReactElement => {
    const [showList, setShowList] = useState(false);

    return (
        <OutsideClickHandler
            onOutsideClick={() => {
                if (showList) {
                    setShowList(false);
                }
            }}
        >
            <div className="create-layout">
                <div className="button" onClick={() => setShowList(!showList)}>
                    <span>Create</span>
                    <FontAwesomeIcon icon={faChevronDown} />
                </div>
                {showList && <OptionList />}
            </div>
        </OutsideClickHandler>
    );
};

export default CreateButton;
