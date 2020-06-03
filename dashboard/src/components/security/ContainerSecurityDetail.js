import React, { Component } from 'react';
import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { ListLoader } from '../basic/Loader';
import { getContainerSecurity } from '../../actions/security';
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
        } = this.props;

        // get a particular application security
        getContainerSecurity({
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
        } = this.props;

        return (
            <div className="Box-root Margin-bottom--12">
                <ShouldRender if={this.props.isRequesting}>
                    <ListLoader />
                </ShouldRender>
                <ShouldRender if={containerSecurity.name}>
                    <ContainerSecurityView
                        name={containerSecurity.name}
                        projectId={projectId}
                        componentId={componentId}
                        containerSecurityId={containerSecurityId}
                        isRequesting={isRequesting}
                    />
                </ShouldRender>
                <ShouldRender if={containerSecurity.name}>
                    <SecurityLog type="Container" />
                </ShouldRender>
                <ShouldRender if={containerSecurity.name}>
                    <ContainerSecurityDeleteBox
                        projectId={projectId}
                        componentId={componentId}
                        containerSecurityId={containerSecurityId}
                    />
                </ShouldRender>
                <ShouldRender if={!isRequesting && getContainerError}>
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
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ getContainerSecurity }, dispatch);

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
    };
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(ContainerSecurityDetail)
);
