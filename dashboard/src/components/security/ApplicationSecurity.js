import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import SecurityInfo from './SecurityInfo';

const ApplicationSecurity = ({
    name,
    applicationSecurityId,
    projectId,
    componentId,
    applicationSecurityLogs,
}) => {
    let securityLog = {};
    applicationSecurityLogs.length > 0 &&
        applicationSecurityLogs.map(applicationSecurityLog => {
            if (
                String(
                    applicationSecurityLog.securityId._id ||
                        applicationSecurityLog.securityId
                ) === String(applicationSecurityId)
            ) {
                securityLog = applicationSecurityLog;
            }
            return applicationSecurityLog;
        });

    return (
        <div className="Box-root Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <SecurityInfo
                    name={name}
                    projectId={projectId}
                    componentId={componentId}
                    applicationSecurityId={applicationSecurityId}
                    type="application"
                    applicationSecurityLog={securityLog}
                />
            </div>
        </div>
    );
};

ApplicationSecurity.displayName = 'Application Security';

ApplicationSecurity.propTypes = {
    name: PropTypes.string,
    applicationSecurityId: PropTypes.string,
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    applicationSecurityLogs: PropTypes.array,
};

const mapStateToProps = state => {
    return {
        applicationSecurityLogs: state.security.applicationSecurityLogs,
    };
};

export default connect(mapStateToProps)(ApplicationSecurity);
