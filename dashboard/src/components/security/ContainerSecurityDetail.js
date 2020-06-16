import React, { Component } from 'react';
import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { ListLoader } from '../basic/Loader';
import {
    getContainerSecurity,
    getContainerSecurityLog,
} from '../../actions/security';
import ContainerSecurityView from './ContainerSecurityView';
import ContainerSecurityDeleteBox from './ContainerSecurityDeleteBox';
import SecurityLog from './SecurityLog';

class ContainerSecurityDetail extends Component {
    componentDidMount() {
        const {
            projectId,
            componentId,
            containerSecurityId,
            getContainerSecurity,
            getContainerSecurityLog,
        } = this.props;

        // get a particular container security
        getContainerSecurity({
            projectId,
            componentId,
            containerSecurityId,
        });

        // get a container security log
        getContainerSecurityLog({
            projectId,
            componentId,
            containerSecurityId,
        });
    }

    render() {
        const {
            containerSecurity,
            projectId,
            componentId,
            containerSecurityId,
            isRequesting,
            getContainerError,
            containerSecurityLog,
            gettingSecurityLog,
        } = this.props;

        return (
            <div className="Box-root Margin-bottom--12">
                <ShouldRender if={isRequesting && gettingSecurityLog}>
                    <ListLoader />
                </ShouldRender>
                <ShouldRender
                    if={containerSecurity.name && !gettingSecurityLog}
                >
                    <ContainerSecurityView
                        projectId={projectId}
                        componentId={componentId}
                        containerSecurityId={containerSecurityId}
                        isRequesting={isRequesting}
                        containerSecurity={containerSecurity}
                    />
                </ShouldRender>
                <ShouldRender
                    if={containerSecurity.name && !gettingSecurityLog}
                >
                    <SecurityLog
                        type="Container"
                        containerSecurityLog={containerSecurityLog}
                    />
                </ShouldRender>
                <ShouldRender
                    if={containerSecurity.name && !gettingSecurityLog}
                >
                    <ContainerSecurityDeleteBox
                        projectId={projectId}
                        componentId={componentId}
                        containerSecurityId={containerSecurityId}
                    />
                </ShouldRender>
                <ShouldRender
                    if={
                        !isRequesting &&
                        !gettingSecurityLog &&
                        getContainerError
                    }
                >
                    {getContainerError}
                </ShouldRender>
            </div>
        );
    }
}

ContainerSecurityDetail.displayName = 'Container Security Detail';

ContainerSecurityDetail.propTypes = {
    getContainerSecurity: PropTypes.func,
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    containerSecurityId: PropTypes.string,
    containerSecurity: PropTypes.object,
    isRequesting: PropTypes.bool,
    getContainerError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    getContainerSecurityLog: PropTypes.func,
    containerSecurityLog: PropTypes.object,
    gettingSecurityLog: PropTypes.bool,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { getContainerSecurity, getContainerSecurityLog },
        dispatch
    );

const mapStateToProps = (state, ownProps) => {
    const {
        projectId,
        componentId,
        containerSecurityId,
    } = ownProps.match.params;

    return {
        projectId,
        componentId,
        containerSecurityId,
        containerSecurity: state.security.containerSecurity,
        isRequesting: state.security.getContainer.requesting,
        getContainerError: state.security.getContainer.error,
        containerSecurityLog: state.security.containerSecurityLog,
        gettingSecurityLog: state.security.getContainerSecurityLog.requesting,
    };
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(ContainerSecurityDetail)
);
