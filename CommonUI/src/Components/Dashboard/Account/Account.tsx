import React, { ReactElement, useState } from 'react';
import { faUser } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import OutsideClickHandler from 'react-outside-click-handler';

import './Account.scss';

const Account = (): ReactElement => {
    const [showProfile, setShowProfile] = useState(false);

    return (
        <OutsideClickHandler
            onOutsideClick={() => {
                if (showProfile) {
                    setShowProfile(false);
                }
            }}
        >
            <div className="account">
                <div
                    className="preview"
                    onClick={() => setShowProfile(!showProfile)}
                >
                    <FontAwesomeIcon icon={faUser} />
                </div>
                {showProfile && (
                    <div className="details">
                        <div className="user-details">
                            <h3>Caleb Okpara</h3>
                            <p>Administrator</p>
                            <hr />
                        </div>
                        <div className="user-actions">
                            <a href="#">Profile</a>
                            <a href="#">Sign out</a>
                        </div>
                    </div>
                )}
            </div>
        </OutsideClickHandler>
    );
};

export default Account;
