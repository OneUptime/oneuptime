import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import { reduxForm, Field, reset } from 'redux-form';
import { ValidateField } from '../../config';
import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { addApplicationSecurity } from '../../actions/security';
import { getGitCredentials } from '../../actions/credential';

class ApplicationSecurityForm extends Component {
    componentDidMount() {
        const { projectId, getGitCredentials } = this.props;

        getGitCredentials({ projectId });
    }

    submitForm = (values, dispatch) => {
        const { projectId, componentId, addApplicationSecurity } = this.props;
        if (!values) return;

        addApplicationSecurity({ projectId, componentId, data: values });
        dispatch(reset('ApplicationSecurityForm'));
    };

    render() {
        const {
            isRequesting,
            addApplicationError,
            handleSubmit,
            requestingGitCredentials,
            gitCredentials,
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
                                                        />
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row bs-u-justify--center">
                                                    <label className="bs-Fieldset-label">
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
                                                <div className="bs-Fieldset-row bs-u-justify--center">
                                                    <label className="bs-Fieldset-label">
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
                                                                height: '28px',
                                                            }}
                                                            options={[
                                                                {
                                                                    value: '',
                                                                    label:
                                                                        'Select a Git Credential',
                                                                },
                                                                ...(gitCredentials &&
                                                                gitCredentials.length >
                                                                    0
                                                                    ? gitCredentials.map(
                                                                          gitCredential => ({
                                                                              value:
                                                                                  gitCredential._id,
                                                                              label:
                                                                                  gitCredential.gitUsername,
                                                                          })
                                                                      )
                                                                    : []),
                                                            ]}
                                                        />
                                                    </div>
                                                </div>
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
    addApplicationError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    handleSubmit: PropTypes.func, // provided by redux form
    getGitCredentials: PropTypes.func,
    gitCredentials: PropTypes.array,
    requestingGitCredentials: PropTypes.bool,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ addApplicationSecurity, getGitCredentials }, dispatch);

const mapStateToProps = state => {
    return {
        isRequesting: state.security.addApplication.requesting,
        addApplicationError: state.security.addApplication.error,
        gitCredentials: state.credential.gitCredentials,
        requestingGitCredentials: state.credential.getGitCredential.requesting,
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
