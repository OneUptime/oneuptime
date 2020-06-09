import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { openModal, closeModal } from '../../actions/modal';
import { history } from '../../store';
import { deleteContainerSecurity } from '../../actions/security';
import DeleteContainerSecurity from '../modals/DeleteContainerSecurity';

export class ContainerSecurityDeleteBox extends Component {
    handleDelete = data => {
        const thisObj = this;
        const {
            deleteContainerSecurity,
            deleteApplicationError,
            openModal,
        } = this.props;

        openModal({
            id: data.containerSecurityId,
            onConfirm: () => {
                return deleteContainerSecurity(data).then(() => {
                    if (deleteApplicationError) {
                        // prevent dismissal of modal if errored
                        return this.handleDelete(data);
                    }

                    if (window.location.href.indexOf('localhost') <= -1) {
                        thisObj.context.mixpanel.track('Container Security');
                    }

                    history.push(
                        `/dashboard/project/${data.projectId}/${data.componentId}/security/container`
                    );
                });
            },
            content: DeleteContainerSecurity,
            propArr: [],
        });
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({
                    id: this.props.containerSecurityId,
                });
            default:
                return false;
        }
    };

    render() {
        const {
            deleting,
            projectId,
            componentId,
            containerSecurityId,
        } = this.props;

        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="Box-root Margin-bottom--12"
            >
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Delete This Container Security</span>
                                </span>
                                <p>
                                    <span>
                                        Click the button to permanantly delete
                                        this container security.
                                    </span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button
                                        className="bs-Button bs-Button--red Box-background--red"
                                        disabled={deleting}
                                        onClick={() =>
                                            this.handleDelete({
                                                projectId,
                                                componentId,
                                                containerSecurityId,
                                            })
                                        }
                                    >
                                        <ShouldRender if={!deleting}>
                                            <span>Delete</span>
                                        </ShouldRender>
                                        <ShouldRender if={deleting}>
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

ContainerSecurityDeleteBox.displayName = 'ContainerSecurityDeleteBox';

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { openModal, closeModal, deleteContainerSecurity },
        dispatch
    );

const mapStateToProps = state => {
    return {
        deleting: state.security.deleteApplication.requesting,
        deleteApplicationError: state.security.deleteApplication.error,
    };
};

ContainerSecurityDeleteBox.propTypes = {
    componentId: PropTypes.string.isRequired,
    projectId: PropTypes.string.isRequired,
    containerSecurityId: PropTypes.string.isRequired,
    deleteContainerSecurity: PropTypes.func.isRequired,
    closeModal: PropTypes.func,
    openModal: PropTypes.func.isRequired,
    deleting: PropTypes.bool,
    deleteApplicationError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ContainerSecurityDeleteBox);
