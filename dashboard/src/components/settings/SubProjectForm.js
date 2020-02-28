import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { reduxForm, Field } from 'redux-form';
import { bindActionCreators } from 'redux';
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
    submitForm = values => {
        const { subProjectName } = values;
        const {
            editSubProject,
            createSubProject,
            currentProject,
            closeModal,
            subProjectModalId,
            renameSubProject,
            subProjectId,
            resetRenameSubProject,
            createNewSubProjectReset,
        } = this.props;

        if (!editSubProject) {
            createSubProject(currentProject._id, subProjectName).then(data => {
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
            ).then(data => {
                if (!data.error) {
                    resetRenameSubProject();
                    return closeModal({
                        id: subProjectModalId,
                    });
                } else return null;
            });
        }
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({
                    id: this.props.subProjectModalId,
                });
            default:
                return false;
        }
    };

    render() {
        const {
            handleSubmit,
            subProject,
            editSubProject,
            subProjectTitle,
            closeModal,
            subProjectModalId,
            resetRenameSubProject,
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
                <div
                    onKeyDown={this.handleKeyBoard}
                    className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center"
                >
                    <div
                        className="ModalLayer-contents"
                        tabIndex={-1}
                        style={{ marginTop: 40 }}
                    >
                        <div className="bs-BIM">
                            <div className="bs-Modal bs-Modal--medium">
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
                                                    subProject.renameSubProject
                                                        .error
                                                }
                                            </p>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={
                                                !editSubProject &&
                                                subProject.newSubProject &&
                                                subProject.newSubProject.error
                                            }
                                        >
                                            <p
                                                className="bs-Modal-message"
                                                id="subProjectCreateErrorMessage"
                                            >
                                                {subProject.newSubProject.error}
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
                                    />
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className={`bs-Button bs-DeprecatedButton ${disabled &&
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
                                        </button>
                                        <button
                                            id="btnAddSubProjects"
                                            className={`bs-Button bs-DeprecatedButton bs-Button--blue ${disabled &&
                                                'bs-is-disabled'}`}
                                            type="save"
                                            disabled={disabled}
                                        >
                                            <ShouldRender if={disabled}>
                                                <FormLoader />
                                            </ShouldRender>
                                            <ShouldRender if={!disabled}>
                                                <span>Save</span>
                                            </ShouldRender>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        );
    }
}

SubProjectForm.displayName = 'SubProjectForm';

const CreateSubProjectForm = reduxForm({
    form: 'SubProjectModalForm',
    enableReinitialize: true,
})(SubProjectForm);

const mapStateToProps = (state, props) => {
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

const mapDispatchToProps = dispatch => {
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
