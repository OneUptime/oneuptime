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
import { addDockerCredential } from '../../actions/credential';

class DockerCredentialModal extends Component {
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
        const { addDockerCredential, propArr } = this.props;
        const { projectId } = propArr[0];

        if (!values) return;

        addDockerCredential({ projectId, data: values });
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
                                        <span>Add Docker Credentials</span>
                                    </span>
                                </div>
                            </div>
                            <form
                                id="dockerCredentialForm"
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
                                                                Docker Registry
                                                                URL
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    type="text"
                                                                    name="dockerRegistryUrl"
                                                                    id="dockerRegistryUrl"
                                                                    placeholder="Docker Registry URL"
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
                                                                Docker Username
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    type="text"
                                                                    name="dockerUsername"
                                                                    id="dockerUsername"
                                                                    placeholder="Docker Username"
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
                                                                Docker Password
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    type="password"
                                                                    name="dockerPassword"
                                                                    id="dockerPassword"
                                                                    placeholder="Docker Password"
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
                                                <span>
                                                    Add Docker Credential
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

DockerCredentialModal.displayName = 'DockerCredentialModal';

DockerCredentialModal.propTypes = {
    isRequesting: PropTypes.bool,
    addCredentialError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    propArr: PropTypes.array,
    projectId: PropTypes.string,
    addDockerCredential: PropTypes.func,
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
    bindActionCreators({ closeModal, addDockerCredential }, dispatch);

const DockerCredentialForm = reduxForm({
    form: 'DockerCredentialForm',
    enableReinitialize: true,
    destroyOnUnmount: true,
})(DockerCredentialModal);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(DockerCredentialForm);
