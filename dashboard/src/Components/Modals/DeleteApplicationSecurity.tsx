import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { closeModal } from 'common-ui/actions/modal';
import { history, RootState } from '../../store';
import { deleteApplicationSecurity } from '../../actions/security';

interface DeleteApplicationSecurityProps {
    closeThisDialog: Function;
    isRequesting?: boolean;
    deleteApplicationError?: string;
    deleteApplicationSecurity?: Function;
    closeModal?: Function;
    modalId?: string;
    slug?: string;
    componentSlug?: string;
    propArr?: unknown[];
}

class DeleteApplicationSecurity extends Component<ComponentProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeThisDialog();
            case 'Enter':
                return this.handleDelete();
            default:
                return false;
        }
    };

    handleDelete = () => {
        const {

            deleteApplicationSecurity,

            deleteApplicationError,

            closeModal,

            modalId,

            propArr,
        } = this.props;
        const {
            projectId,
            componentId,
            applicationSecurityId,
            componentSlug,
        } = propArr[0];
        const data = { projectId, componentId, applicationSecurityId };

        deleteApplicationSecurity(data).then(() => {
            history.push(

                `/dashboard/project/${this.props.slug}/component/${componentSlug}/security/application`
            );

            if (!deleteApplicationError) {
                return closeModal({ id: modalId });
            }
        });
    };

    override render() {
        const {

            isRequesting,

            closeThisDialog,

            deleteApplicationError,
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
                                        application security ?
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
                                                deleteApplicationError
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
                                                                deleteApplicationError
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
                                            id="cancelApplicationSecurityModalBtn"
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="deleteApplicationSecurityModalBtn"
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


DeleteApplicationSecurity.displayName = 'Delete Application Security';


DeleteApplicationSecurity.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    isRequesting: PropTypes.bool,
    deleteApplicationError: PropTypes.string,
    deleteApplicationSecurity: PropTypes.func,
    closeModal: PropTypes.func,
    modalId: PropTypes.string,
    slug: PropTypes.string,
    componentSlug: PropTypes.string,
    propArr: PropTypes.array,
};

const mapStateToProps = (state: RootState) => {
    return {
        isRequesting: state.security.deleteApplication.requesting,
        deleteApplicationError: state.security.deleteApplication.error,
        modalId: state.modal.modals[0].id,
        slug: state.project.currentProject && state.project.currentProject.slug,
    };
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({ deleteApplicationSecurity, closeModal }, dispatch);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(DeleteApplicationSecurity);
