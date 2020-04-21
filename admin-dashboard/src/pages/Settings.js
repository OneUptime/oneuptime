import React from 'react';
import PropTypes from 'prop-types';

import Dashboard from '../components/Dashboard';
import SMTP from '../components/settings/smtp';
import Twilio from '../components/settings/twilio';
import Sso from '../components/settings/sso';

// eslint-disable-next-line react/display-name
const getChild = key => {
    switch (key) {
        case '/admin/settings/smtp':
            return <SMTP />; // eslint-disable-line react/jsx-pascal-case
        case '/admin/settings/twilio':
            return <Twilio />;
        case '/admin/settings/sso':
            return <Sso />;
        default:
            return null;
    }
};

const Component = ({ location: { pathname } }) => {
    return (
        <Dashboard>
            <div className="Box-root Margin-vertical--12">
                <div>
                    <div>
                        <div className="db-BackboneViewContainer">
                            <div className="react-settings-view react-view">
                                <span data-reactroot="">
                                    <div>
                                        <div>
                                            <div className="Box-root Margin-bottom--12">
                                                {getChild(pathname)}
                                            </div>
                                        </div>
                                    </div>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Dashboard>
    );
};

Component.displayName = 'SMTP';

Component.propTypes = {
    location: PropTypes.string.isRequired,
};

export default Component;
