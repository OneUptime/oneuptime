import React, { Fragment } from 'react';
import PropTypes from 'prop-types';

import Smtp from '../components/settings/smtp';
import Twilio from '../components/settings/twilio';
import Sso from '../components/settings/sso';
import SsoDefaultRoles from '../components/settings/ssoDefaultRoles';
import AuditLog from '../components/settings/auditLog';
import EmailLog from '../components/settings/emailLog';
import CallLog from '../components/settings/callLog';
import SmsLog from '../components/settings/smsLog';


const getChild: Function = (key: $TSFixMe) => {
    switch (key) {
        case '/admin/settings/smtp':
            return <Smtp />;
        case '/admin/settings/twilio':
            return <Twilio />;
        case '/admin/settings/sso':
            return (
                <Fragment>
                    <Sso />
                    <SsoDefaultRoles />
                </Fragment>
            );
        case '/admin/settings/audit-logs':
            return <AuditLog />;
        case '/admin/settings/call-logs':
            return <CallLog />;
        case '/admin/settings/email-logs':
            return <EmailLog />;
        case '/admin/settings/sms-logs':
            return <SmsLog />;
        default:
            return null;
    }
};

const Component: Function = ({
    location: { pathname }
}: $TSFixMe) => {
    return (
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
    );
};

Component.displayName = 'SMTP';

Component.propTypes = {
    location: PropTypes.string.isRequired,
};

export default Component;
