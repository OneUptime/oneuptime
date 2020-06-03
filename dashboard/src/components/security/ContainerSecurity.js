import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import SecurityInfo from './SecurityInfo';

const ContainerSecurity = ({
    name,
    containerSecurityId,
    projectId,
    componentId,
}) => {
    return (
        <div className="Box-root Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <SecurityInfo
                    name={name}
                    projectId={projectId}
                    componentId={componentId}
                    containerSecurityId={containerSecurityId}
                    type="container"
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
};

export default connect(null, null)(ContainerSecurity);
