/*eslint-disable*/
import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';

import { reduxForm, Field } from 'redux-form';

import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { history, RootState } from '../../store';
import { ValidateField } from '../../config';
import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import { closeModal } from 'Common-ui/actions/modal';
import { editApplicationSecurity } from '../../actions/security';

interface EditApplicationSecurityProps {
    isRequesting?: boolean;
    editError?: string;
    propArr?: unknown[];
    closeModal?: Function;
    handleSubmit?: Function;
    editApplicationSecurity?: Function;
    componentSlug?: string;
    projectSlug?: string;
    gitCredentials?: unknown[];
    resourceCategoryList?: unknown[];
    formValues?: unknown;
}

class EditApplicationSecurity extends Component<ComponentProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    componentDidUpdate(prevProps: $TSFixMe) {

        const { propArr, isRequesting, closeModal, editError } = this.props;
        const { applicationSecurityId } = propArr[0];

        if (prevProps.isRequesting !== isRequesting) {
            if (!isRequesting && !editError) {
                closeModal({ id: applicationSecurityId });
            }
        }
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':

                return document.getElementById('editApplicationBtn').click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        const { propArr } = this.props;
        const { applicationSecurityId } = propArr[0];

        this.props.closeModal({
            id: applicationSecurityId,
        });
    };

    submitForm = (values: $TSFixMe) => {

        const { editApplicationSecurity, propArr } = this.props;
        const { projectId, componentId, applicationSecurityId } = propArr[0];

        if (!values) return;

        editApplicationSecurity({
            projectId,
            componentId,
            applicationSecurityId,
            data: values,
        }).then((data: $TSFixMe) => {
            history.replace(

                `/dashboard/project/${this.props.projectSlug}/component/${this.props.componentSlug}/security/application/${data.data.slug}`
            );
        });
    };

    override render() {
        const {

            isRequesting,

            closeModal,

            editError,

            handleSubmit,

            propArr,

            gitCredentials,

            resourceCategoryList,

            formValues,
        } = this.props;
        const { applicationSecurityId } = propArr[0];
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div
                            className="bs-Modal bs-Modal--medium"
                            style={{ width: 600 }}
                        >
                            <ClickOutside
                                onClickOutside={this.handleCloseModal}
                            >
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>
                                                Edit Application Security
                                            </span>
                                        </span>
                                    </div>
                                </div>
                                <form
                                    id="editApplicationSecurityForm"
                                    onSubmit={handleSubmit(this.submitForm)}
                                >
                                    <div className="bs-Modal-content">
                                        <div
                                            className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-vertical--2"
                                            style={{ boxShadow: 'none' }}
                                        >
                                            <div>
                                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                                    <fieldset className="bs-Fieldset">
                                                        <div className="bs-Fieldset-rows">
                                                            <div className="bs-Fieldset-row bs-u-justify--center">
                                                                <label className="bs-Fieldset-label">
                                                                    Name
                                                                </label>
                                                                <div className="bs-Fieldset-fields">
                                                                    <Field
                                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                        component={
                                                                            RenderField
                                                                        }
                                                                        type="text"
                                                                        name="name"
                                                                        id="name"
                                                                        placeholder="Application name"
                                                                        disabled={
                                                                            isRequesting
                                                                        }
                                                                        validate={
                                                                            ValidateField.text
                                                                        }
                                                                        autoFocus={
                                                                            true
                                                                        }
                                                                    />
                                                                </div>
                                                            </div>
                                                            <ShouldRender
                                                                if={
                                                                    false &&
                                                                    resourceCategoryList &&
                                                                    resourceCategoryList.length >
                                                                    0
                                                                }
                                                            >
                                                                <div className="bs-Fieldset-row bs-u-justify--center">
                                                                    <label className="bs-Fieldset-label">
                                                                        Resource
                                                                        Category
                                                                    </label>
                                                                    <div className="bs-Fieldset-fields">
                                                                        <Field
                                                                            className="db-select-nw"
                                                                            component={
                                                                                RenderSelect
                                                                            }
                                                                            name="resourceCategory"
                                                                            id="resourceCategory"
                                                                            placeholder="Choose Category"
                                                                            disabled={
                                                                                isRequesting
                                                                            }
                                                                            options={[
                                                                                {
                                                                                    value:
                                                                                        '',
                                                                                    label:
                                                                                        'Select category',
                                                                                },
                                                                                ...(resourceCategoryList &&
                                                                                    resourceCategoryList.length >
                                                                                    0
                                                                                    ? resourceCategoryList.map(
                                                                                        (category: $TSFixMe) => ({
                                                                                            value:
                                                                                                category._id,

                                                                                            label:
                                                                                                category.name
                                                                                        })
                                                                                    )
                                                                                    : []),
                                                                            ]}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </ShouldRender>
                                                            <div className="bs-Fieldset-row bs-u-justify--center">
                                                                <label className="bs-Fieldset-label">
                                                                    Git
                                                                    Repository
                                                                    Url
                                                                </label>
                                                                <div className="bs-Fieldset-fields">
                                                                    <Field
                                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                        component={
                                                                            RenderField
                                                                        }
                                                                        type="text"
                                                                        name="gitRepositoryUrl"
                                                                        id="gitRepositoryUrl"
                                                                        placeholder="Git repository url"
                                                                        disabled={
                                                                            isRequesting
                                                                        }
                                                                        validate={
                                                                            ValidateField.required
                                                                        }
                                                                    />
                                                                </div>
                                                            </div>
                                                            <label
                                                                className="bs-Radio"
                                                                style={{
                                                                    marginLeft:
                                                                        '170px',
                                                                }}
                                                                htmlFor="useGitCredentials"
                                                            >
                                                                <Field
                                                                    component="input"
                                                                    type="radio"
                                                                    name="useGit"
                                                                    className="bs-Radio-source"
                                                                    id="useGitCredentials"
                                                                    value="useGitCredentials"
                                                                    style={{
                                                                        width: 0,
                                                                    }}
                                                                />
                                                                <span className="bs-Radio-button"></span>
                                                                <div
                                                                    className="Box-root"
                                                                    style={{
                                                                        paddingLeft:
                                                                            '10px',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Use Git
                                                                        Credentials
                                                                    </span>
                                                                </div>
                                                            </label>

                                                            <label
                                                                className="bs-Radio"
                                                                style={{
                                                                    marginLeft:
                                                                        '170px',
                                                                }}
                                                                htmlFor="useGitSsh"
                                                            >
                                                                <Field
                                                                    component="input"
                                                                    type="radio"
                                                                    name="useGit"
                                                                    className="bs-Radio-source"
                                                                    id="useGitSsh"
                                                                    value="useGitSsh"
                                                                    style={{
                                                                        width: 0,
                                                                    }}
                                                                />
                                                                <span className="bs-Radio-button"></span>
                                                                <div
                                                                    className="Box-root"
                                                                    style={{
                                                                        paddingLeft:
                                                                            '10px',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Use Git
                                                                        Ssh
                                                                    </span>
                                                                </div>
                                                            </label>

                                                            <div>
                                                                {formValues &&
                                                                    formValues
                                                                        .values
                                                                        ?.useGit ===
                                                                    'useGitCredentials' && (
                                                                        <div className="bs-Fieldset-row bs-u-justify--center">
                                                                            <label className="bs-Fieldset-label Fieldset-extra">
                                                                                Git
                                                                                Credential
                                                                            </label>
                                                                            <div className="bs-Fieldset-fields">
                                                                                <Field
                                                                                    className="db-select-nw"
                                                                                    component={
                                                                                        RenderSelect
                                                                                    }
                                                                                    name="gitCredential"
                                                                                    id="gitCredential"
                                                                                    placeholder="Select a Git Credential"
                                                                                    required="required"
                                                                                    style={{
                                                                                        height:
                                                                                            '28px',
                                                                                    }}
                                                                                    options={[
                                                                                        {
                                                                                            value:
                                                                                                '',
                                                                                            label:
                                                                                                'Select a Git Credential',
                                                                                        },
                                                                                        ...(gitCredentials &&
                                                                                            gitCredentials.length >
                                                                                            0
                                                                                            ? gitCredentials
                                                                                                .filter(
                                                                                                    (obj: $TSFixMe) => obj.gitUsername
                                                                                                )
                                                                                                .map(
                                                                                                    (gitCredential: $TSFixMe) => ({
                                                                                                        value:
                                                                                                            gitCredential._id,

                                                                                                        label:
                                                                                                            gitCredential.gitUsername
                                                                                                    })
                                                                                                )
                                                                                            : []),
                                                                                    ]}
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                {formValues &&
                                                                    formValues
                                                                        .values
                                                                        ?.useGit ===
                                                                    'useGitSsh' && (
                                                                        <div className="bs-Fieldset-row bs-u-justify--center">
                                                                            <label className="bs-Fieldset-label Fieldset-extra">
                                                                                Git
                                                                                Ssh
                                                                            </label>
                                                                            <div className="bs-Fieldset-fields">
                                                                                <Field
                                                                                    className="db-select-nw"
                                                                                    component={
                                                                                        RenderSelect
                                                                                    }
                                                                                    name="gitCredential"
                                                                                    id="gitSsh"
                                                                                    placeholder="Select a Git Ssh"
                                                                                    required="required"
                                                                                    style={{
                                                                                        height:
                                                                                            '28px',
                                                                                    }}
                                                                                    options={[
                                                                                        {
                                                                                            value:
                                                                                                '',
                                                                                            label:
                                                                                                'Select a Git Ssh',
                                                                                        },
                                                                                        ...(gitCredentials &&
                                                                                            gitCredentials.length >
                                                                                            0
                                                                                            ? gitCredentials
                                                                                                .filter(
                                                                                                    (obj: $TSFixMe) => obj.sshTitle
                                                                                                )
                                                                                                .map(
                                                                                                    (gitCredential: $TSFixMe) => ({
                                                                                                        value:
                                                                                                            gitCredential._id,

                                                                                                        label:
                                                                                                            gitCredential.sshTitle
                                                                                                    })
                                                                                                )
                                                                                            : []),
                                                                                    ]}
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                            </div>
                                                        </div>
                                                    </fieldset>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bs-Modal-footer">
                                        <div
                                            className="bs-Modal-footer-actions"
                                            style={{ width: 280 }}
                                        >
                                            <ShouldRender
                                                if={!isRequesting && editError}
                                            >
                                                <div
                                                    id="addCredentialError"
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
                                                                    color:
                                                                        'red',
                                                                }}
                                                            >
                                                                {editError}
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
                                                onClick={e => {
                                                    e.preventDefault();
                                                    closeModal({
                                                        id: applicationSecurityId,
                                                    });
                                                }}
                                                id="cancelEditApplicationBtn"
                                                disabled={isRequesting}
                                            >
                                                <span>Cancel</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </button>
                                            <button
                                                id="editApplicationBtn"
                                                className="bs-Button bs-Button bs-Button--blue btn__modal"
                                                type="submit"
                                                disabled={isRequesting}
                                            >
                                                {!isRequesting && (
                                                    <>
                                                        <span>
                                                            Update Application
                                                            Security
                                                        </span>
                                                        <span className="create-btn__keycode">
                                                            <span className="keycode__icon keycode__icon--enter" />
                                                        </span>
                                                    </>
                                                )}
                                                {isRequesting && <FormLoader />}
                                            </button>
                                        </div>
                                    </div>
                                </form>
                            </ClickOutside>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}


EditApplicationSecurity.displayName = 'EditApplicationSecurity';


EditApplicationSecurity.propTypes = {
    isRequesting: PropTypes.bool,
    editError: PropTypes.string,
    propArr: PropTypes.array,
    closeModal: PropTypes.func,
    handleSubmit: PropTypes.func,
    editApplicationSecurity: PropTypes.func,
    componentSlug: PropTypes.string,
    projectSlug: PropTypes.string,
    gitCredentials: PropTypes.array,
    resourceCategoryList: PropTypes.array,

    formValues: PropTypes.obj,
};

const mapStateToProps = (state: RootState) => {
    return {
        isRequesting: state.security.editApplicationSecurity.requesting,
        editError: state.security.editApplicationSecurity.error,
        projectSlug:
            state.project.currentProject && state.project.currentProject.slug,
        componentSlug:
            state.component.currentComponent.component &&
            state.component.currentComponent.component.slug,
        initialValues: {
            name: state.security.applicationSecurity.name,
            gitRepositoryUrl:
                state.security.applicationSecurity.gitRepositoryUrl,
            gitCredential: state.security.applicationSecurity.gitCredential._id,
            resourceCategory: state.security.applicationSecurity
                .resourceCategory
                ? state.security.applicationSecurity.resourceCategory._id
                : '',
            useGitCredentials: true,
            useGit: state.security.applicationSecurity.gitCredential && state.security.applicationSecurity.gitCredential.gitUsername ? 'useGitCredentials' : 'useGitSsh',
        },
        gitCredentials: state.credential.gitCredentials,
        resourceCategoryList:
            state.resourceCategories.resourceCategoryListForNewResource
                .resourceCategories,
        formValues: state.form.EditApplicationSecurityForm,
    };
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({ closeModal, editApplicationSecurity }, dispatch);

const EditApplicationSecurityForm = reduxForm({
    form: 'EditApplicationSecurityForm',
    enableReinitialize: true,
    destroyOnUnmount: true,
})(EditApplicationSecurity);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditApplicationSecurityForm);
