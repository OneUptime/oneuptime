import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';

import { reduxForm, Field } from 'redux-form';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { closeModal } from 'common-ui/actions/modal';
import {
    createSubProject,
    renameSubProject,
    resetRenameSubProject,
    createNewSubProjectReset,
} from '../../actions/subProject';

interface SubProjectFormProps {
    closeModal?: Function;
    createNewSubProjectReset?: Function;
    createSubProject?: Function;
    currentProject?: object;
    editSubProject?: Function;
    handleSubmit?: Function;
    renameSubProject?: Function;
    resetRenameSubProject?: Function;
    subProject?: object;
    subProjectId?: string;
    subProjectModalId?: string;
    subProjectTitle?: string;
}

export class SubProjectForm extends React.Component<SubProjectFormProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {
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

            editSubProject,

            resetRenameSubProject,

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

                return document.getElementById('btnAddSubProjects').click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.subProjectModalId,
        });
    };

    override render() {
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

const mapDispatchToProps = (dispatch: Dispatch) => {
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
