import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { closeModal } from '../../actions/modal';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import {
    deleteIncidentNoteTemplate,
    deleteIncidentNoteTemplateFailure,
    fetchIncidentNoteTemplates,
} from '../../actions/incidentNoteTemplate';

class DeleteIncidentNoteTemplate extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteIncidentNoteTemplateFailure' does ... Remove this comment to see the full error message
        this.props.deleteIncidentNoteTemplateFailure(null);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal();
    };

    handleDelete = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'templateId' does not exist on type 'Read... Remove this comment to see the full error message
            templateId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteIncidentNoteTemplate' does not exi... Remove this comment to see the full error message
            deleteIncidentNoteTemplate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'skip' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            skip,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'limit' does not exist on type 'Readonly<... Remove this comment to see the full error message
            limit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchIncidentNoteTemplates' does not exi... Remove this comment to see the full error message
            fetchIncidentNoteTemplates,
        } = this.props;

        deleteIncidentNoteTemplate({ projectId, templateId }).then(() => {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deletingTemplate' does not exist on type... Remove this comment to see the full error message
            if (!this.props.deletingTemplate && !this.props.deleteError) {
                fetchIncidentNoteTemplates({ projectId, skip, limit });
                closeModal();
            }
        });
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deletingTemplate' does not exist on type... Remove this comment to see the full error message
        const { deletingTemplate, deleteError } = this.props;
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
DeleteIncidentNoteTemplate.displayName = 'DeleteIncidentNoteTemplate';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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

const mapStateToProps = (state: $TSFixMe) => {
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

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
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
