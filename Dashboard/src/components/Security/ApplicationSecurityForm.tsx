import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import PropTypes from 'prop-types';

import { reduxForm, Field, reset } from 'redux-form';
import { ValidateField } from '../../config';
import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { addApplicationSecurity } from '../../actions/security';
import { getGitCredentials } from '../../actions/credential';
import { openModal } from 'CommonUI/actions/modal';
import GitCredentialModal from '../credential/GitCredentialModal';
import GitSshModal from '../credential/GitSshModal';

interface ApplicationSecurityFormProps {
    projectId?: string;
    componentId?: string;
    addApplicationSecurity?: Function;
    isRequesting?: boolean;
    addApplicationError?: string;
    handleSubmit?: Function;
    getGitCredentials?: Function // provided by redux form;
    gitCredentials?: unknown[];
    requestingGitCredentials?: boolean;
    openModal?: Function;
    resourceCategoryList?: unknown[];
    toggleForm?: Function;
    showCancelBtn?: boolean;
    formValues?: unknown;
}

class ApplicationSecurityForm extends Component<ComponentProps> {
    override componentDidMount() {

        const { projectId, getGitCredentials } = this.props;
        if (projectId) {
            getGitCredentials({ projectId });
        }
    }
    componentDidUpdate(prevProps: $TSFixMe) {

        if (prevProps.projectId !== this.props.projectId) {

            const { projectId, getGitCredentials } = this.props;
            if (projectId) {
                getGitCredentials({ projectId });
            }
        }
    }

    submitForm = (values: $TSFixMe, dispatch: Dispatch) => {

        const { projectId, componentId, addApplicationSecurity } = this.props;
        if (!values) return;

        addApplicationSecurity({ projectId, componentId, data: values });
        dispatch(reset('ApplicationSecurityForm'));
    };

    handleGitCredential = () => {

        const { openModal, projectId } = this.props;

        openModal({
            id: projectId,
            content: GitCredentialModal,
            propArr: [{ projectId }],
        });
    };
    handleGitSSH = () => {

        const { openModal, projectId } = this.props;
        openModal({
            id: projectId,
            content: GitSshModal,
            propArr: [{ projectId }],
        });
    };

    override render() {
        const {

            isRequesting,

            addApplicationError,

            handleSubmit,

            requestingGitCredentials,

            gitCredentials,

            resourceCategoryList,

            formValues,
        } = this.props;
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        <span>Application Security</span>
                                    </span>
                                </span>
                                <p>
                                    <span>
                                        Check the security of your application
                                    </span>
                                </p>
                            </div>
                        </div>
                        <form
                            id="applicationSecurityForm"
                            onSubmit={handleSubmit(this.submitForm)}
                        >
                            <div
                                className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-vertical--2"
                                style={{ boxShadow: 'none' }}
                            >
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="bs-Fieldset">
                                            <div className="bs-Fieldset-rows">
                                                <div className="bs-Fieldset-row bs-u-justify--center">
                                                    <label className="bs-Fieldset-label Fieldset-extra">
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
                                                        <label className="bs-Fieldset-label Fieldset-extra">
                                                            Resource Category
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
                                                    <label className="bs-Fieldset-label Fieldset-extra">
                                                        Git Repository URL
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
                                                            placeholder="https://github.com/bitcoin/bitcoin"
                                                            disabled={
                                                                isRequesting
                                                            }
                                                            validate={
                                                                ValidateField.url
                                                            }
                                                        />
                                                    </div>
                                                </div>

                                                <label
                                                    className="bs-Radio"
                                                    style={{
                                                        marginLeft: '330px',
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
                                                            paddingLeft: '10px',
                                                        }}
                                                    >
                                                        <span>
                                                            Use Git Credentials
                                                        </span>
                                                    </div>
                                                </label>
                                                <div>
                                                    <label
                                                        className="bs-Radio"
                                                        style={{
                                                            marginLeft: '330px',
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
                                                                Use Git Ssh
                                                            </span>
                                                        </div>
                                                    </label>
                                                </div>
                                                {formValues &&
                                                    formValues.values
                                                        ?.useGit ===
                                                    'useGitCredentials' && (
                                                        <div className="bs-Fieldset-row bs-u-justify--center">
                                                            <label className="bs-Fieldset-label Fieldset-extra">
                                                                Git Credential
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-select-nw"
                                                                    component={
                                                                        RenderSelect
                                                                    }
                                                                    name="gitCredential"
                                                                    id="gitCredential"
                                                                    placeholder="Git Credential"
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
                                                                <p
                                                                    className="bs-Fieldset-explanation"
                                                                    style={{
                                                                        color:
                                                                            '#4c4c4c',
                                                                        textDecoration:
                                                                            'underline',
                                                                        cursor:
                                                                            'pointer',
                                                                    }}
                                                                >
                                                                    <span
                                                                        onClick={
                                                                            this
                                                                                .handleGitCredential
                                                                        }
                                                                        id="addCredentialBtn"
                                                                    >
                                                                        Add a
                                                                        git
                                                                        credential
                                                                    </span>
                                                                </p>
                                                            </div>
                                                        </div>
                                                    )}
                                                {formValues &&
                                                    formValues.values
                                                        ?.useGit ===
                                                    'useGitSsh' && (
                                                        <div className="bs-Fieldset-row bs-u-justify--center">
                                                            <label className="bs-Fieldset-label Fieldset-extra">
                                                                Git Ssh
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-select-nw"
                                                                    component={
                                                                        RenderSelect
                                                                    }
                                                                    name="gitCredential"
                                                                    id="gitSsh"
                                                                    placeholder="Git Ssh"
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
                                                                <p
                                                                    className="bs-Fieldset-explanation"
                                                                    style={{
                                                                        color:
                                                                            '#4c4c4c',
                                                                        textDecoration:
                                                                            'underline',
                                                                        cursor:
                                                                            'pointer',
                                                                    }}
                                                                >
                                                                    <span
                                                                        onClick={
                                                                            this
                                                                                .handleGitSSH
                                                                        }
                                                                        id="addSshBtn"
                                                                    >
                                                                        Add a
                                                                        git ssh
                                                                    </span>
                                                                </p>
                                                            </div>
                                                        </div>
                                                    )}
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                <div className="bs-Tail-copy">
                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                        <ShouldRender
                                            if={
                                                !isRequesting &&
                                                addApplicationError
                                            }
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {addApplicationError}
                                                </span>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </div>
                                <div>
                                    <ShouldRender
                                        if={

                                            this.props.showCancelBtn &&

                                            this.props.toggleForm
                                        }
                                    >
                                        <button
                                            className="bs-Button"
                                            disabled={
                                                isRequesting ||
                                                requestingGitCredentials
                                            }

                                            onClick={this.props.toggleForm}
                                            type="button"
                                        >
                                            <span>Cancel</span>
                                        </button>
                                    </ShouldRender>
                                    <button
                                        id="addApplicationBtn"
                                        className="bs-Button bs-Button--blue"
                                        disabled={
                                            isRequesting ||
                                            requestingGitCredentials
                                        }
                                        type="submit"
                                    >
                                        <ShouldRender if={!isRequesting}>
                                            <span>Add Application</span>
                                        </ShouldRender>

                                        <ShouldRender if={isRequesting}>
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        );
    }
}


ApplicationSecurityForm.displayName = 'Application Security Form';


ApplicationSecurityForm.propTypes = {
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    addApplicationSecurity: PropTypes.func,
    isRequesting: PropTypes.bool,
    addApplicationError: PropTypes.string,
    handleSubmit: PropTypes.func, // provided by redux form
    getGitCredentials: PropTypes.func,
    gitCredentials: PropTypes.array,
    requestingGitCredentials: PropTypes.bool,
    openModal: PropTypes.func,
    resourceCategoryList: PropTypes.array,
    toggleForm: PropTypes.func,
    showCancelBtn: PropTypes.bool,

    formValues: PropTypes.obj,
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    { addApplicationSecurity, getGitCredentials, openModal },
    dispatch
);

const mapStateToProps: Function = (state: RootState) => {
    return {
        isRequesting: state.security.addApplication.requesting,
        addApplicationError: state.security.addApplication.error,
        gitCredentials: state.credential.gitCredentials,
        requestingGitCredentials: state.credential.getCredential.requesting,
        resourceCategoryList:
            state.resourceCategories.resourceCategoryListForNewResource
                .resourceCategories,
        initialValues: {
            useGitCredentials: true,
            useGit: 'useGitCredentials',
        },
        formValues: state.form.ApplicationSecurityForm,
    };
};

const NewApplicationSecurityForm = reduxForm({
    form: 'ApplicationSecurityForm',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(ApplicationSecurityForm);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(NewApplicationSecurityForm);
