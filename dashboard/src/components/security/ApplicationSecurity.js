import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import SecurityInfo from './SecurityInfo';

const ApplicationSecurity = ({
    name,
    applicationSecurityId,
    applicationSecuritySlug,
    projectId,
    componentId,
    componentSlug,
    applicationSecurityLogs,
}) => {
    let securityLog = {};
    applicationSecurityLogs.length > 0 &&
        applicationSecurityLogs.map(applicationSecurityLog => {
            if (
                applicationSecurityLog.securityId.slug ===
                applicationSecuritySlug
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
                    applicationSecuritySlug={applicationSecuritySlug}
                    applicationSecurityId={applicationSecurityId}
                    type="application"
                    applicationSecurityLog={securityLog}
                    componentSlug={componentSlug}
                />
            </div>
        </div>
    );
};

ApplicationSecurity.displayName = 'Application Security';

ApplicationSecurity.propTypes = {
    name: PropTypes.string,
    applicationSecurityId: PropTypes.string,
    applicationSecuritySlug: PropTypes.string,
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    applicationSecurityLogs: PropTypes.array,
};

const mapStateToProps = state => {
    return {
        applicationSecurityLogs: state.security.applicationSecurityLogs,
    };
};

export default connect(mapStateToProps)(ApplicationSecurity);
