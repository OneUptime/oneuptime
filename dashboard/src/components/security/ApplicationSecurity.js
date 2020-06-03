import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import SecurityInfo from './SecurityInfo';

const ApplicationSecurity = ({
    name,
    applicationSecurityId,
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
                    applicationSecurityId={applicationSecurityId}
                    type="application"
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
};

export default connect(null, null)(ApplicationSecurity);
