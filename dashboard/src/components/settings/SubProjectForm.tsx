import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field } from 'redux-form';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { closeModal } from '../../actions/modal';
import {
    createSubProject,
    renameSubProject,
    resetRenameSubProject,
    createNewSubProjectReset,
} from '../../actions/subProject';

export class SubProjectForm extends React.Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {
        const { subProjectName } = values;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editSubProject' does not exist on type '... Remove this comment to see the full error message
            editSubProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createSubProject' does not exist on type... Remove this comment to see the full error message
            createSubProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectModalId' does not exist on typ... Remove this comment to see the full error message
            subProjectModalId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'renameSubProject' does not exist on type... Remove this comment to see the full error message
            renameSubProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
            subProjectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetRenameSubProject' does not exist on... Remove this comment to see the full error message
            resetRenameSubProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createNewSubProjectReset' does not exist... Remove this comment to see the full error message
            createNewSubProjectReset,
        } = this.props;

        if (!editSubProject) {
            createSubProject(currentProject._id, subProjectName).then((data: $TSFixMe) => {
                if (!data.error) {
                    createNewSubProjectReset();
                    return closeModal({
                        id: subProjectModalId,
                    });
                } else return null;
            });
        } else if (subProjectName) {
            renameSubProject(
                currentProject._id,
                subProjectId,
                subProjectName
            ).then((data: $TSFixMe) => {
                if (!data.error) {
                    resetRenameSubProject();
                    return closeModal({
                        id: subProjectModalId,
                    });
                } else return null;
            });
        }
    };

    handleKeyBoard = (e: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editSubProject' does not exist on type '... Remove this comment to see the full error message
            editSubProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetRenameSubProject' does not exist on... Remove this comment to see the full error message
            resetRenameSubProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createNewSubProjectReset' does not exist... Remove this comment to see the full error message
            createNewSubProjectReset,
        } = this.props;
        switch (e.key) {
            case 'Escape':
                if (editSubProject) {
                    resetRenameSubProject();
                } else {
                    createNewSubProjectReset();
                }
                return this.handleCloseModal();
            case 'Enter':
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                return document.getElementById('btnAddSubProjects').click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectModalId' does not exist on typ... Remove this comment to see the full error message
            id: this.props.subProjectModalId,
        });
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProject' does not exist on type 'Read... Remove this comment to see the full error message
            subProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editSubProject' does not exist on type '... Remove this comment to see the full error message
            editSubProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectTitle' does not exist on type ... Remove this comment to see the full error message
            subProjectTitle,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectModalId' does not exist on typ... Remove this comment to see the full error message
            subProjectModalId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetRenameSubProject' does not exist on... Remove this comment to see the full error message
            resetRenameSubProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createNewSubProjectReset' does not exist... Remove this comment to see the full error message
            createNewSubProjectReset,
        } = this.props;
        const disabled =
            (!editSubProject && subProject.newSubProject.requesting) ||
            (editSubProject && subProject.renameSubProject.requesting);
        return (
            <form
                onSubmit={handleSubmit(this.submitForm.bind(this))}
                id="frmSubProjects"
            >
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
                                                <span>
                                                    {editSubProject
                                                        ? `Edit Sub Project ${subProjectTitle}`
                                                        : 'Add New Sub Project'}
                                                </span>
                                            </span>
                                        </div>
                                        <div className="bs-Modal-messages">
                                            <ShouldRender
                                                if={
                                                    editSubProject &&
                                                    subProject.renameSubProject &&
                                                    subProject.renameSubProject
                                                        .error
                                                }
                                            >
                                                <p
                                                    className="bs-Modal-message"
                                                    id="subProjectEditErrorMessage"
                                                >
                                                    {
                                                        subProject
                                                            .renameSubProject
                                                            .error
                                                    }
                                                </p>
                                            </ShouldRender>
                                            <ShouldRender
                                                if={
                                                    !editSubProject &&
                                                    subProject.newSubProject &&
                                                    subProject.newSubProject
                                                        .error
                                                }
                                            >
                                                <p
                                                    className="bs-Modal-message"
                                                    id="subProjectCreateErrorMessage"
                                                >
                                                    {
                                                        subProject.newSubProject
                                                            .error
                                                    }
                                                </p>
                                            </ShouldRender>
                                        </div>
                                    </div>
                                    <div className="bs-Modal-body">
                                        <Field
                                            component="input"
                                            name="subProjectName"
                                            placeholder="Sub Project Name"
                                            id="title"
                                            className="bs-TextInput"
                                            style={{
                                                width: '90%',
                                                margin: '10px 0 10px 5%',
                                            }}
                                            disabled={disabled}
                                            autoFocus={true}
                                        />
                                    </div>
                                    <div className="bs-Modal-footer">
                                        <div className="bs-Modal-footer-actions">
                                            <button
                                                className={`bs-Button bs-DeprecatedButton btn__modal ${disabled &&
                                                    'bs-is-disabled'}`}
                                                type="button"
                                                onClick={() => {
                                                    if (editSubProject) {
                                                        resetRenameSubProject();
                                                    } else {
                                                        createNewSubProjectReset();
                                                    }
                                                    return closeModal({
                                                        id: subProjectModalId,
                                                    });
                                                }}
                                                disabled={disabled}
                                            >
                                                <span>Cancel</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </button>
                                            <button
                                                id="btnAddSubProjects"
                                                className={`bs-Button bs-DeprecatedButton bs-Button--blue btn__modal ${disabled &&
                                                    'bs-is-disabled'}`}
                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '"save"' is not assignable to type '"reset" |... Remove this comment to see the full error message
                                                type="save"
                                                disabled={disabled}
                                            >
                                                <ShouldRender if={disabled}>
                                                    <FormLoader />
                                                </ShouldRender>
                                                <ShouldRender if={!disabled}>
                                                    <span>Save</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </ShouldRender>
                                            </button>
                                        </div>
                                    </div>
                                </ClickOutside>
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
SubProjectForm.displayName = 'SubProjectForm';

const CreateSubProjectForm = reduxForm({
    form: 'SubProjectModalForm',
    enableReinitialize: true,
})(SubProjectForm);

const mapStateToProps = (state: $TSFixMe, props: $TSFixMe) => {
    const initval = props.data.editSubProject
        ? { subProjectName: props.data.subProjectTitle }
        : {};
    return {
        initialValues: initval,
        currentProject: state.project.currentProject,
        subProject: state.subProject,
        subProjectModalId: props.data.subProjectModalId,
        editSubProject: props.data.editSubProject,
        subProjectId: props.data.subProjectId,
        subProjectTitle: props.data.subProjectTitle,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            closeModal,
            createSubProject,
            renameSubProject,
            resetRenameSubProject,
            createNewSubProjectReset,
        },
        dispatch
    );
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
SubProjectForm.propTypes = {
    closeModal: PropTypes.func,
    createNewSubProjectReset: PropTypes.func,
    createSubProject: PropTypes.func,
    currentProject: PropTypes.object,
    editSubProject: PropTypes.func,
    handleSubmit: PropTypes.func,
    renameSubProject: PropTypes.func,
    resetRenameSubProject: PropTypes.func,
    subProject: PropTypes.object,
    subProjectId: PropTypes.string,
    subProjectModalId: PropTypes.string,
    subProjectTitle: PropTypes.string,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(CreateSubProjectForm);
