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
    applicationSecurityLogs
}: $TSFixMe) => {
    let securityLog = {};
    applicationSecurityLogs.length > 0 &&
        applicationSecurityLogs.map((applicationSecurityLog: $TSFixMe) => {
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
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ name: any; projectId: any; componentId: an... Remove this comment to see the full error message
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

const mapStateToProps = (state: $TSFixMe) => {
    return {
        applicationSecurityLogs: state.security.applicationSecurityLogs,
    };
};

export default connect(mapStateToProps)(ApplicationSecurity);
