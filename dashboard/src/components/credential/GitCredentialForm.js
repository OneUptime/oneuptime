import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import { reduxForm, Field, reset } from 'redux-form';
import { ValidateField } from '../../config';
import { RenderField } from '../basic/RenderField';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { addGitCredential } from '../../actions/credential';

class GitCredentialForm extends Component {
    submitForm = (values, dispatch) => {
        const { projectId, addGitCredential } = this.props;
        if (!values) return;

        addGitCredential({ projectId, data: values });
        // clear the form
        dispatch(reset('GitCredentialForm'));
    };

    render() {
        const { isRequesting, addError, handleSubmit } = this.props;

        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        <span>Git Credential</span>
                                    </span>
                                </span>
                                <p>
                                    <span>Add your Git Credentials here</span>
                                </p>
                            </div>
                        </div>
                        <form
                            id="gitCredentialForm"
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
                                                        Git Username
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                            component={
                                                                RenderField
                                                            }
                                                            type="text"
                                                            name="gitUsername"
                                                            id="gitUsername"
                                                            placeholder="Git Username"
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
                                                        Git Password
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                            component={
                                                                RenderField
                                                            }
                                                            type="password"
                                                            name="gitPassword"
                                                            id="gitPassword"
                                                            placeholder="Git Password"
                                                            disabled={
                                                                isRequesting
                                                            }
                                                            validate={
                                                                ValidateField.required
                                                            }
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
                                            if={!isRequesting && addError}
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {addError}
                                                </span>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </div>
                                <div>
                                    <button
                                        id="addGitCredentialBtn"
                                        className="bs-Button bs-Button--blue"
                                        disabled={isRequesting}
                                        type="submit"
                                    >
                                        <ShouldRender if={!isRequesting}>
                                            <span>Add Git Credential</span>
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

GitCredentialForm.displayName = 'Git Credential Form';

GitCredentialForm.propTypes = {
    projectId: PropTypes.string,
    addGitCredential: PropTypes.func,
    isRequesting: PropTypes.bool,
    addError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    handleSubmit: PropTypes.func, // provided by redux form
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ addGitCredential }, dispatch);

const mapStateToProps = state => {
    return {
        isRequesting: state.credential.addGitCredential.requesting,
        addError: state.credential.addGitCredential.error,
    };
};

const NewGitCredentialForm = reduxForm({
    form: 'GitCredentialForm',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(GitCredentialForm);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(NewGitCredentialForm);
