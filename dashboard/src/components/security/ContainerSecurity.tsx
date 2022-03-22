import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import SecurityInfo from './SecurityInfo';

const ContainerSecurity = ({
    name,
    containerSecurityId,
    containerSecuritySlug,
    projectId,
    componentId,
    componentSlug,
    containerSecurityLogs
}: $TSFixMe) => {
    let securityLog = {};
    containerSecurityLogs.length > 0 &&
        containerSecurityLogs.map((containerSecurityLog: $TSFixMe) => {
            if (
                containerSecurityLog.securityId.slug === containerSecuritySlug
            ) {
                securityLog = containerSecurityLog;
            }
            return containerSecurityLog;
        });

    return (
        <div className="Box-root Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <SecurityInfo
                    name={name}
                    projectId={projectId}

                    componentId={componentId}
                    containerSecurityId={containerSecurityId}
                    containerSecuritySlug={containerSecuritySlug}
                    type="container"
                    containerSecurityLog={securityLog}
                    componentSlug={componentSlug}
                />
            </div>
        </div>
    );
};

ContainerSecurity.displayName = 'Container Security';

ContainerSecurity.propTypes = {
    name: PropTypes.string,
    containerSecurityId: PropTypes.string,
    containerSecuritySlug: PropTypes.string,
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    containerSecurityLogs: PropTypes.array,
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        containerSecurityLogs: state.security.containerSecurityLogs,
    };
};

export default connect(mapStateToProps)(ContainerSecurity);
