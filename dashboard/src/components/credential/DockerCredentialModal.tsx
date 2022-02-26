import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field } from 'redux-form';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { ValidateField } from '../../config';
import { RenderField } from '../basic/RenderField';
import { closeModal } from '../../actions/modal';
import {
    addDockerCredential,
    updateDockerCredential,
} from '../../actions/credential';

class DockerCredentialModal extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'propArr' does not exist on type 'Readonl... Remove this comment to see the full error message
            propArr,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
            isRequesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'addCredentialError' does not exist on ty... Remove this comment to see the full error message
            addCredentialError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updatingCredential' does not exist on ty... Remove this comment to see the full error message
            updatingCredential,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateCredentialError' does not exist on... Remove this comment to see the full error message
            updateCredentialError,
        } = this.props;
        const { projectId } = propArr[0];

        if (prevProps.isRequesting !== isRequesting) {
            if (!isRequesting && !addCredentialError) {
                closeModal({ id: projectId });
            }
        }

        if (prevProps.updatingCredential !== updatingCredential) {
            if (!updatingCredential && !updateCredentialError) {
                closeModal({ id: projectId });
            }
        }
    }

    handleKeyBoard = (e: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'propArr' does not exist on type 'Readonl... Remove this comment to see the full error message
        const { propArr } = this.props;
        const { credentialId } = propArr[0];

        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                return credentialId
                    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                    ? document
                          .getElementById('updateCredentialModalBtn')
                          .click()
                    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                    : document.getElementById('addCredentialModalBtn').click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        const { closeModal, propArr } = this.props;
        const { projectId } = propArr[0];
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal({
            id: closeModal({ id: projectId }),
        });
    };

    submitForm = (values: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'addDockerCredential' does not exist on t... Remove this comment to see the full error message
            addDockerCredential,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'propArr' does not exist on type 'Readonl... Remove this comment to see the full error message
            propArr,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateDockerCredential' does not exist o... Remove this comment to see the full error message
            updateDockerCredential,
        } = this.props;
        const { projectId, credentialId } = propArr[0];

        if (!values) return;

        credentialId
            ? updateDockerCredential({ projectId, credentialId, data: values })
            : addDockerCredential({ projectId, data: values });
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
            isRequesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'addCredentialError' does not exist on ty... Remove this comment to see the full error message
            addCredentialError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'propArr' does not exist on type 'Readonl... Remove this comment to see the full error message
            propArr,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateCredentialError' does not exist on... Remove this comment to see the full error message
            updateCredentialError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updatingCredential' does not exist on ty... Remove this comment to see the full error message
            updatingCredential,
        } = this.props;
        const { projectId, credentialId } = propArr[0];

        return (
            <div
                id="dockerCredentialModal"
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
                            <ClickOutside
                                onClickOutside={this.handleCloseModal}
                            >
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy bs-u-flex Flex-direction--column">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap Margin-bottom--4">
                                            {credentialId ? (
                                                <span>
                                                    Update Docker Credentials
                                                </span>
                                            ) : (
                                                <span>
                                                    Add Docker Credentials
                                                </span>
                                            )}
                                        </span>
                                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                            <span>
                                                Add a valid docker credential to
                                                this project
                                            </span>
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
                                                                    Docker
                                                                    Registry URL
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
                                                                        placeholder="https://registry.hub.docker.com"
                                                                        disabled={
                                                                            isRequesting
                                                                        }
                                                                        validate={
                                                                            ValidateField.url
                                                                        }
                                                                        autoFocus={
                                                                            true
                                                                        }
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div className="bs-Fieldset-row bs-u-justify--center">
                                                                <label className="bs-Fieldset-label">
                                                                    Docker
                                                                    Username
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
                                                                    Docker
                                                                    Password
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
                                                                            !credentialId &&
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
                                    {credentialId ? (
                                        <div className="bs-Modal-footer">
                                            <div
                                                className="bs-Modal-footer-actions"
                                                style={{ width: 280 }}
                                            >
                                                <ShouldRender
                                                    if={
                                                        !updatingCredential &&
                                                        updateCredentialError
                                                    }
                                                >
                                                    <div
                                                        id="updateCredentialError"
                                                        className="bs-Tail-copy"
                                                    >
                                                        <div
                                                            className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                            style={{
                                                                marginTop:
                                                                    '10px',
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
                                                                    {
                                                                        updateCredentialError
                                                                    }
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
                                                            id: projectId,
                                                        });
                                                    }}
                                                    id="cancelCredentialModalBtn"
                                                    disabled={
                                                        updatingCredential
                                                    }
                                                >
                                                    <span>Cancel</span>
                                                    <span className="cancel-btn__keycode">
                                                        Esc
                                                    </span>
                                                </button>
                                                <button
                                                    id="updateCredentialModalBtn"
                                                    className="bs-Button bs-Button bs-Button--blue btn__modal"
                                                    type="submit"
                                                    disabled={
                                                        updatingCredential
                                                    }
                                                >
                                                    {!updatingCredential && (
                                                        <>
                                                            <span>
                                                                Update Docker
                                                                Credential
                                                            </span>
                                                            <span className="create-btn__keycode">
                                                                <span className="keycode__icon keycode__icon--enter" />
                                                            </span>
                                                        </>
                                                    )}
                                                    {updatingCredential && (
                                                        <FormLoader />
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
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
                                                                marginTop:
                                                                    '10px',
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
                                                                    {
                                                                        addCredentialError
                                                                    }
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
                                                            id: projectId,
                                                        });
                                                    }}
                                                    id="cancelCredentialModalBtn"
                                                    disabled={isRequesting}
                                                >
                                                    <span>Cancel</span>
                                                    <span className="cancel-btn__keycode">
                                                        Esc
                                                    </span>
                                                </button>
                                                <button
                                                    id="addCredentialModalBtn"
                                                    className="bs-Button bs-Button bs-Button--blue btn__modal"
                                                    type="submit"
                                                    disabled={isRequesting}
                                                >
                                                    {!isRequesting && (
                                                        <>
                                                            <span>
                                                                Add Docker
                                                                Credential
                                                            </span>
                                                            <span className="create-btn__keycode">
                                                                <span className="keycode__icon keycode__icon--enter" />
                                                            </span>
                                                        </>
                                                    )}
                                                    {isRequesting && (
                                                        <FormLoader />
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </form>
                            </ClickOutside>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
DockerCredentialModal.displayName = 'DockerCredentialModal';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
DockerCredentialModal.propTypes = {
    isRequesting: PropTypes.bool,
    addCredentialError: PropTypes.string,
    propArr: PropTypes.array,
    projectId: PropTypes.string,
    addDockerCredential: PropTypes.func,
    closeModal: PropTypes.func,
    handleSubmit: PropTypes.func,
    updateDockerCredential: PropTypes.func,
    updateCredentialError: PropTypes.string,
    updatingCredential: PropTypes.bool,
};

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const { propArr } = ownProps;
    const { credentialId } = propArr[0];
    const dockerCredential = credentialId
        ? state.credential.dockerCredentials.filter(
              (dockerCredential: $TSFixMe) => String(dockerCredential._id) === String(credentialId)
          )[0]
        : {};
    return {
        isRequesting: state.credential.addCredential.requesting,
        addCredentialError: state.credential.addCredential.error,
        initialValues: {
            dockerRegistryUrl: dockerCredential.dockerRegistryUrl,
            dockerUsername: dockerCredential.dockerUsername,
        },
        updateCredentialError: state.credential.updateCredential.error,
        updatingCredential: state.credential.updateCredential.requesting,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    { closeModal, addDockerCredential, updateDockerCredential },
    dispatch
);

const DockerCredentialForm = reduxForm({
    form: 'DockerCredentialForm',
    enableReinitialize: true,
    destroyOnUnmount: true,
})(DockerCredentialModal);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(DockerCredentialForm);
