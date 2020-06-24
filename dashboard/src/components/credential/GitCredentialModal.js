import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { reduxForm, Field } from 'redux-form';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { ValidateField } from '../../config';
import { RenderField } from '../basic/RenderField';
import { closeModal } from '../../actions/modal';
import { addGitCredential } from '../../actions/credential';

class GitCredentialModal extends Component {
    componentDidUpdate(prevProps) {
        const {
            propArr,
            isRequesting,
            closeModal,
            addCredentialError,
        } = this.props;
        const { projectId } = propArr[0];

        if (prevProps.isRequesting !== isRequesting) {
            if (!isRequesting && !addCredentialError) {
                closeModal({ id: projectId });
            }
        }
    }

    handleKeyBoard = e => {
        const { closeModal, propArr } = this.props;
        const { projectId } = propArr[0];

        switch (e.key) {
            case 'Escape':
                return closeModal({ id: projectId });
            default:
                return false;
        }
    };

    submitForm = values => {
        const { addGitCredential, propArr } = this.props;
        const { projectId } = propArr[0];

        if (!values) return;

        addGitCredential({ projectId, data: values });
    };

    render() {
        const {
            isRequesting,
            closeModal,
            addCredentialError,
            handleSubmit,
            propArr,
        } = this.props;
        const { projectId } = propArr[0];

        return (
            <div
                id="gitCredentialModal"
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
                            style={{ width: 600 }}
                        >
                            <div className="bs-Modal-header">
                                <div className="bs-Modal-header-copy">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Add Git Credentials</span>
                                    </span>
                                </div>
                            </div>
                            <form
                                id="gitCredentialForm"
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
                                </div>
                                <div className="bs-Modal-footer">
                                    <div
                                        className="bs-Modal-footer-actions"
                                        style={{ width: 280 }}
                                    >
                                        <ShouldRender
                                            if={
                                                !isRequesting &&
                                                addCredentialError
                                            }
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
                                                            {addCredentialError}
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
                                                    id: projectId,
                                                });
                                            }}
                                            id="cancelCredentialModalBtn"
                                        >
                                            <span>Cancel</span>
                                        </button>
                                        <button
                                            id="addCredentialModalBtn"
                                            className="bs-Button bs-Button bs-Button--blue"
                                            type="submit"
                                            disabled={isRequesting}
                                        >
                                            {!isRequesting && (
                                                <span>Add Git Credential</span>
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

GitCredentialModal.displayName = 'GitCredentialModal';

GitCredentialModal.propTypes = {
    isRequesting: PropTypes.bool,
    addCredentialError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    propArr: PropTypes.array,
    projectId: PropTypes.string,
    addGitCredential: PropTypes.func,
    closeModal: PropTypes.func,
    handleSubmit: PropTypes.func,
};

const mapStateToProps = state => {
    return {
        isRequesting: state.credential.addCredential.requesting,
        addCredentialError: state.credential.addCredential.error,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ closeModal, addGitCredential }, dispatch);

const GitCredentialForm = reduxForm({
    form: 'GitCredentialForm',
    enableReinitialize: true,
    destroyOnUnmount: true,
})(GitCredentialModal);

export default connect(mapStateToProps, mapDispatchToProps)(GitCredentialForm);
