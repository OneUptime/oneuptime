import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field, reset } from 'redux-form';
import { ValidateField } from '../../config';
import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { addApplicationSecurity } from '../../actions/security';
import { getGitCredentials } from '../../actions/credential';
import { openModal } from '../../actions/modal';
import GitCredentialModal from '../credential/GitCredentialModal';
import GitSshModal from '../credential/GitSshModal';

class ApplicationSecurityForm extends Component {
    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
        const { projectId, getGitCredentials } = this.props;
        if (projectId) {
            getGitCredentials({ projectId });
        }
    }
    componentDidUpdate(prevProps: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
        if (prevProps.projectId !== this.props.projectId) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            const { projectId, getGitCredentials } = this.props;
            if (projectId) {
                getGitCredentials({ projectId });
            }
        }
    }

    submitForm = (values: $TSFixMe, dispatch: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
        const { projectId, componentId, addApplicationSecurity } = this.props;
        if (!values) return;

        addApplicationSecurity({ projectId, componentId, data: values });
        dispatch(reset('ApplicationSecurityForm'));
    };

    handleGitCredential = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        const { openModal, projectId } = this.props;

        openModal({
            id: projectId,
            content: GitCredentialModal,
            propArr: [{ projectId }],
        });
    };
    handleGitSSH = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        const { openModal, projectId } = this.props;
        openModal({
            id: projectId,
            content: GitSshModal,
            propArr: [{ projectId }],
        });
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
            isRequesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'addApplicationError' does not exist on t... Remove this comment to see the full error message
            addApplicationError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requestingGitCredentials' does not exist... Remove this comment to see the full error message
            requestingGitCredentials,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'gitCredentials' does not exist on type '... Remove this comment to see the full error message
            gitCredentials,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resourceCategoryList' does not exist on ... Remove this comment to see the full error message
            resourceCategoryList,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'formValues' does not exist on type 'Read... Remove this comment to see the full error message
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
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'showCancelBtn' does not exist on type 'R... Remove this comment to see the full error message
                                            this.props.showCancelBtn &&
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'toggleForm' does not exist on type 'Read... Remove this comment to see the full error message
                                            this.props.toggleForm
                                        }
                                    >
                                        <button
                                            className="bs-Button"
                                            disabled={
                                                isRequesting ||
                                                requestingGitCredentials
                                            }
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'toggleForm' does not exist on type 'Read... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ApplicationSecurityForm.displayName = 'Application Security Form';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'obj' does not exist on type 'typeof impo... Remove this comment to see the full error message
    formValues: PropTypes.obj,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    { addApplicationSecurity, getGitCredentials, openModal },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
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
