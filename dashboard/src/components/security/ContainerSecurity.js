import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import SecurityInfo from './SecurityInfo';

const ContainerSecurity = ({
    name,
    containerSecurityId,
    projectId,
    componentId,
    containerSecurityLogs,
}) => {
    let securityLog = {};
    containerSecurityLogs.length > 0 &&
        containerSecurityLogs.map(containerSecurityLog => {
            if (
                String(
                    containerSecurityLog.securityId._id ||
                        containerSecurityLog.securityId
                ) === String(containerSecurityId)
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
                    type="container"
                    containerSecurityLog={securityLog}
                />
            </div>
        </div>
    );
};

ContainerSecurity.displayName = 'Container Security';

ContainerSecurity.propTypes = {
    name: PropTypes.string,
    containerSecurityId: PropTypes.string,
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    containerSecurityLogs: PropTypes.array,
};

const mapStateToProps = state => {
    return {
        containerSecurityLogs: state.security.containerSecurityLogs,
    };
};

export default connect(mapStateToProps)(ContainerSecurity);
