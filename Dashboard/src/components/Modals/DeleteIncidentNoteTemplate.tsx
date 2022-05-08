import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import { closeModal } from 'CommonUI/actions/Modal';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import {
    deleteIncidentNoteTemplate,
    deleteIncidentNoteTemplateFailure,
    fetchIncidentNoteTemplates,
} from '../../actions/incidentNoteTemplate';

interface DeleteIncidentNoteTemplateProps {
    projectId?: string;
    closeModal: Function;
    templateId?: string;
    deletingTemplate?: boolean;
    deleteError?: string;
    skip?: number;
    limit?: number;
    deleteIncidentNoteTemplate?: Function;
    deleteIncidentNoteTemplateFailure?: Function;
    fetchIncidentNoteTemplates?: Function;
}

class DeleteIncidentNoteTemplate extends Component<ComponentProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                return this.handleDelete();
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.deleteIncidentNoteTemplateFailure(null);

        this.props.closeModal();
    };

    handleDelete = () => {
        const {

            closeModal,

            projectId,

            templateId,

            deleteIncidentNoteTemplate,

            skip,

            limit,

            fetchIncidentNoteTemplates,
        } = this.props;

        deleteIncidentNoteTemplate({ projectId, templateId }).then(() => {

            if (!this.props.deletingTemplate && !this.props.deleteError) {
                fetchIncidentNoteTemplates({ projectId, skip, limit });
                closeModal();
            }
        });
    };

    override render() {

        const { deletingTemplate, deleteError }: $TSFixMe = this.props;
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside
                                onClickOutside={this.handleCloseModal}
                            >
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Confirm Deletion</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to remove this
                                        template ?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div
                                        className="bs-Modal-footer-actions"
                                        style={{ flex: 'unset' }}
                                    >
                                        <ShouldRender if={deleteError}>
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
                                                            {deleteError}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                    <button
                                        id="deleteCardCancel"
                                        className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                        type="button"
                                        onClick={this.handleCloseModal}
                                    >
                                        <span>Cancel</span>
                                        <span className="cancel-btn__keycode">
                                            Esc
                                        </span>
                                    </button>
                                    <button
                                        onClick={this.handleDelete}
                                        id="deleteCardButton"
                                        className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                        disabled={deletingTemplate}
                                        type="submit"
                                        autoFocus={true}
                                    >
                                        {!deletingTemplate && (
                                            <>
                                                <span>Remove</span>
                                                <span className="delete-btn__keycode">
                                                    <span className="keycode__icon keycode__icon--enter" />
                                                </span>
                                            </>
                                        )}
                                        {deletingTemplate && <FormLoader />}
                                    </button>
                                </div>
                            </ClickOutside>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}


DeleteIncidentNoteTemplate.displayName = 'DeleteIncidentNoteTemplate';


DeleteIncidentNoteTemplate.propTypes = {
    projectId: PropTypes.string,
    closeModal: PropTypes.func.isRequired,
    templateId: PropTypes.string,
    deletingTemplate: PropTypes.bool,
    deleteError: PropTypes.string,
    skip: PropTypes.number,
    limit: PropTypes.number,
    deleteIncidentNoteTemplate: PropTypes.func,
    deleteIncidentNoteTemplateFailure: PropTypes.func,
    fetchIncidentNoteTemplates: PropTypes.func,
};

const mapStateToProps: Function = (state: RootState) => {
    return {
        projectId: state.modal.modals[0].projectId,
        templateId: state.modal.modals[0].templateId,
        deletingTemplate:
            state.incidentNoteTemplate.deleteNoteTemplate.requesting,
        deleteError: state.incidentNoteTemplate.deleteNoteTemplate.error,
        skip: state.incidentNoteTemplate.noteTemplates.skip,
        limit: state.incidentNoteTemplate.noteTemplates.limit,
    };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    {
        closeModal,
        deleteIncidentNoteTemplate,
        deleteIncidentNoteTemplateFailure,
        fetchIncidentNoteTemplates,
    },
    dispatch
);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(DeleteIncidentNoteTemplate);
