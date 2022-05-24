import React, { ReactElement } from 'react';
import { faUser } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import './Account.scss';

const Account = (): ReactElement => {
    return (
        <div className="account">
            <div className="preview">
                <FontAwesomeIcon icon={faUser} />
            </div>
            <div className="details"></div>
        </div>
    );
};

export default Account;
