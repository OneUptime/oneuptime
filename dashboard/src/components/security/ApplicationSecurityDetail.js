import React, { Component } from 'react';
import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { ListLoader } from '../basic/Loader';
import ApplicationSecurityView from './ApplicationSecurityView';
import { getApplicationSecurity } from '../../actions/security';
import ApplicationSecurityDeleteBox from './ApplicationSecurityDeleteBox';
import SecurityLog from './SecurityLog';

class ApplicationSecurityDetail extends Component {
    componentDidMount() {
        const {
            projectId,
            componentId,
            applicationSecurityId,
            getApplicationSecurity,
        } = this.props;

        // get a particular application security
        getApplicationSecurity({
            projectId,
            componentId,
            applicationSecurityId,
        });
    }

    render() {
        const {
            applicationSecurity,
            projectId,
            componentId,
            applicationSecurityId,
            isRequesting,
            getApplicationError,
        } = this.props;

        return (
            <div className="Box-root Margin-bottom--12">
                <ShouldRender if={isRequesting}>
                    <ListLoader />
                </ShouldRender>
                <ShouldRender if={applicationSecurity.name}>
                    <ApplicationSecurityView
                        name={applicationSecurity.name}
                        projectId={projectId}
                        componentId={componentId}
                        applicationSecurityId={applicationSecurityId}
                        isRequesting={isRequesting}
                    />
                </ShouldRender>
                <ShouldRender if={applicationSecurity.name}>
                    <SecurityLog type="Application" />
                </ShouldRender>
                <ShouldRender if={applicationSecurity.name}>
                    <ApplicationSecurityDeleteBox
                        projectId={projectId}
                        componentId={componentId}
                        applicationSecurityId={applicationSecurityId}
                    />
                </ShouldRender>
                <ShouldRender if={!isRequesting && getApplicationError}>
                    {getApplicationError}
                </ShouldRender>
            </div>
        );
    }
}

ApplicationSecurityDetail.displayName = 'Application Security Detail';

ApplicationSecurityDetail.propTypes = {
    getApplicationSecurity: PropTypes.func,
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    applicationSecurityId: PropTypes.string,
    applicationSecurity: PropTypes.object,
    isRequesting: PropTypes.bool,
    getApplicationError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ getApplicationSecurity }, dispatch);

const mapStateToProps = (state, ownProps) => {
    const {
        projectId,
        componentId,
        applicationSecurityId,
    } = ownProps.match.params;

    return {
        projectId,
        componentId,
        applicationSecurityId,
        applicationSecurity: state.security.applicationSecurity,
        isRequesting: state.security.getApplication.requesting,
        getApplicationError: state.security.getApplication.error,
    };
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(ApplicationSecurityDetail)
);
