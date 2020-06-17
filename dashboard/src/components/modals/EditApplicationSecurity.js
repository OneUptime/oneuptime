import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { reduxForm, Field } from 'redux-form';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { ValidateField } from '../../config';
import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import { closeModal } from '../../actions/modal';
import { editApplicationSecurity } from '../../actions/security';

class EditApplicationSecurity extends Component {
    componentDidUpdate(prevProps) {
        const { propArr, isRequesting, closeModal, editError } = this.props;
        const { applicationSecurityId } = propArr[0];

        if (prevProps.isRequesting !== isRequesting) {
            if (!isRequesting && !editError) {
                closeModal({ id: applicationSecurityId });
            }
        }
    }

    handleKeyBoard = e => {
        const { closeModal, propArr } = this.props;
        const { applicationSecurityId } = propArr[0];

        switch (e.key) {
            case 'Escape':
                return closeModal({ id: applicationSecurityId });
            default:
                return false;
        }
    };

    submitForm = values => {
        const { editApplicationSecurity, propArr } = this.props;
        const { projectId, componentId, applicationSecurityId } = propArr[0];

        if (!values) return;

        editApplicationSecurity({
            projectId,
            componentId,
            applicationSecurityId,
            data: values,
        });
    };

    render() {
        const {
            isRequesting,
            closeModal,
            editError,
            handleSubmit,
            propArr,
            gitCredentials,
        } = this.props;
        const { applicationSecurityId } = propArr[0];

        return (
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
                        <div
                            className="bs-Modal bs-Modal--medium"
                            style={{ minWidth: 600 }}
                        >
                            <div className="bs-Modal-header">
                                <div className="bs-Modal-header-copy">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Edit Application Security</span>
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
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className="bs-Fieldset-row bs-u-justify--center">
                                                            <label className="bs-Fieldset-label">
                                                                Git Repository
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
                                                                color: 'red',
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
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey"
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
                                        </button>
                                        <button
                                            id="editApplicationBtn"
                                            className="bs-Button bs-Button bs-Button--blue"
                                            type="submit"
                                            disabled={isRequesting}
                                        >
                                            {!isRequesting && (
                                                <span>
                                                    Update Application Security
                                                </span>
                                            )}
                                            {isRequesting && <FormLoader />}
                                        </button>
                                    </div>
                                </div>
                            </form>
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
    editError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    propArr: PropTypes.array,
    closeModal: PropTypes.func,
    handleSubmit: PropTypes.func,
    editApplicationSecurity: PropTypes.func,
    gitCredentials: PropTypes.array,
};

const mapStateToProps = state => {
    return {
        isRequesting: state.security.editApplicationSecurity.requesting,
        editError: state.security.editApplicationSecurity.error,
        initialValues: {
            name: state.security.applicationSecurity.name,
            gitRepositoryUrl:
                state.security.applicationSecurity.gitRepositoryUrl,
            gitCredential: state.security.applicationSecurity.gitCredential._id,
        },
        gitCredentials: state.credential.gitCredentials,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ closeModal, editApplicationSecurity }, dispatch);

const EditApplicationSecurityForm = reduxForm({
    form: 'EditApplicationSecurityForm',
    enableReinitialize: true,
    destroyOnUnmount: true,
})(EditApplicationSecurity);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditApplicationSecurityForm);
