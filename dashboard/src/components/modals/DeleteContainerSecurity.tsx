import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { closeModal } from '../../actions/modal';
import { history } from '../../store';
import { deleteContainerSecurity } from '../../actions/security';

class DeleteContainerSecurity extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                return this.props.closeThisDialog();
            case 'Enter':
                return this.handleDelete();
            default:
                return false;
        }
    };

    handleDelete = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteContainerSecurity' does not exist ... Remove this comment to see the full error message
            deleteContainerSecurity,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteContainerError' does not exist on ... Remove this comment to see the full error message
            deleteContainerError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'modalId' does not exist on type 'Readonl... Remove this comment to see the full error message
            modalId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'propArr' does not exist on type 'Readonl... Remove this comment to see the full error message
            propArr,
        } = this.props;
        const {
            projectId,
            componentId,
            containerSecurityId,
            componentSlug,
        } = propArr[0];
        const data = { projectId, componentId, containerSecurityId };

        deleteContainerSecurity(data).then(() => {
            history.push(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                `/dashboard/project/${this.props.slug}/component/${componentSlug}/security/container`
            );

            if (!deleteContainerError) {
                return closeModal({ id: modalId });
            }
        });
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
            isRequesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
            closeThisDialog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteContainerError' does not exist on ... Remove this comment to see the full error message
            deleteContainerError,
        } = this.props;
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeThisDialog}>
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Confirm Deletion</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to delete this
                                        container security ?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div
                                        className="bs-Modal-footer-actions"
                                        style={{ width: 280 }}
                                    >
                                        <ShouldRender
                                            if={
                                                !isRequesting &&
                                                deleteContainerError
                                            }
                                        >
                                            <div
                                                id="deleteCardError"
                                                className="bs-Tail-copy"
                                            >
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
                                                    }}
                                                >
                                                    <div className="Box-root Margin-right--8">
                                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                    </div>
                                                    <div className="Box-root">
                                                        <span
                                                            style={{
                                                                color: 'red',
                                                            }}
                                                        >
                                                            {
                                                                deleteContainerError
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            onClick={closeThisDialog}
                                            id="cancelContainerSecurityModalBtn"
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="deleteContainerSecurityModalBtn"
                                            className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                            type="button"
                                            onClick={this.handleDelete}
                                            disabled={isRequesting}
                                            autoFocus={true}
                                        >
                                            {!isRequesting && (
                                                <>
                                                    <span>Delete</span>
                                                    <span className="delete-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {isRequesting && <FormLoader />}
                                        </button>
                                    </div>
                                </div>
                            </ClickOutside>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
DeleteContainerSecurity.displayName = 'Delete Container Security';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
DeleteContainerSecurity.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    isRequesting: PropTypes.bool,
    deleteContainerError: PropTypes.string,
    closeModal: PropTypes.func,
    deleteContainerSecurity: PropTypes.func,
    modalId: PropTypes.string,
    slug: PropTypes.string,
    propArr: PropTypes.array,
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        isRequesting: state.security.deleteContainer.requesting,
        deleteContainerError: state.security.deleteContainer.error,
        modalId: state.modal.modals[0].id,
        slug: state.project.currentProject && state.project.currentProject.slug,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ closeModal, deleteContainerSecurity }, dispatch);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(DeleteContainerSecurity);
