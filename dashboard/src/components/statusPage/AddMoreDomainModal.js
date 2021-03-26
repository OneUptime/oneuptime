import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { reduxForm, Field, SubmissionError } from 'redux-form';
import ClickOutside from 'react-click-outside';
import { closeModal } from '../../actions/modal';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { RenderField } from '../basic/RenderField';
import { UploadFile } from '../basic/UploadFile';
import {
    uploadCertFile,
    uploadPrivateKey,
    removeCertFile,
    removePrivateKeyFile,
} from '../../actions/statusPage';
import { createDomain } from '../../actions/domain';
import { Validate, SHOULD_LOG_ANALYTICS } from '../../config';
import { logEvent } from '../../analytics';

// eslint-disable-next-line no-unused-vars
function validate(_values) {
    const error = undefined;
    return error;
}

class AddMoreDomainModal extends React.Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = values => {
        const {
            projectId,
            statusPageId,
            createDomain,
            certFile,
            privateKeyFile,
            closeModal,
        } = this.props;

        if (!values.domain || !values.domain.trim()) {
            throw new SubmissionError({
                domain: 'Domain is required',
            });
        }

        if (!Validate.isDomain(values.domain)) {
            throw new SubmissionError({
                domain: 'Domain is not valid.',
            });
        }

        const data = {
            projectId,
            statusPageId,
            domain: values.domain,
        };
        if (values.enableHttps) {
            data.cert = certFile.file;
            data.privateKey = privateKeyFile.file;
        }

        createDomain(data).then(() => {
            if (!this.props.addDomainError) {
                this.props.removeCertFile();
                this.props.removePrivateKeyFile();
                closeModal({
                    id: statusPageId,
                });

                if (SHOULD_LOG_ANALYTICS) {
                    logEvent(
                        'EVENT: DASHBOARD > PROJECT > STATUS PAGES > STATUS PAGE > DOMAIN CREATED'
                    );
                }
            }
        });
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                return document.getElementById('createCustomDomainBtn').click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        this.props.closeModal({
            id: this.props.statusPageId,
        });
    };

    changeCertFile = e => {
        e.preventDefault();
        const { projectId, uploadCertFile } = this.props;

        const reader = new FileReader();
        const file = e.target.files[0];

        reader.onloadend = () => {
            uploadCertFile(projectId, file);
        };
        try {
            reader.readAsDataURL(file);
        } catch (error) {
            return;
        }
    };

    changePrivateKey = e => {
        e.preventDefault();
        const { projectId, uploadPrivateKey } = this.props;

        const reader = new FileReader();
        const file = e.target.files[0];

        reader.onloadend = () => {
            uploadPrivateKey(projectId, file);
        };
        try {
            reader.readAsDataURL(file);
        } catch (error) {
            return;
        }
    };

    removeCertFile = () => {
        this.props.removeCertFile();
    };

    removePrivateKeyFile = () => {
        this.props.removePrivateKeyFile();
    };

    render() {
        const {
            requesting,
            addDomainError,
            closeModal,
            handleSubmit,
            statusPageId,
            certFile,
            privateKeyFile,
            formValues,
        } = this.props;

        return (
            <div
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal" style={{ width: 630 }}>
                        <ClickOutside onClickOutside={this.handleCloseModal}>
                            <div className="bs-Modal-header">
                                <div
                                    className="bs-Modal-header-copy"
                                    style={{
                                        marginBottom: '10px',
                                        marginTop: '10px',
                                    }}
                                >
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Add Custom Domain</span>
                                    </span>
                                    <br />
                                    <br />
                                    <span></span>
                                </div>
                            </div>
                            <form
                                id="addMoreDomainModal"
                                onSubmit={handleSubmit(this.submitForm)}
                            >
                                <div className="bs-Modal-content">
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="Margin-bottom--16">
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="customDomain"
                                                    >
                                                        <span>
                                                            Custom Domain
                                                        </span>
                                                    </label>
                                                    <div
                                                        style={{
                                                            width: '100%',
                                                        }}
                                                    >
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        >
                                                            <Field
                                                                component={
                                                                    RenderField
                                                                }
                                                                name="domain"
                                                                placeholder="status.example.com"
                                                                id="customDomain"
                                                                className="bs-TextInput"
                                                                style={{
                                                                    width:
                                                                        '100%',
                                                                    padding:
                                                                        '3px 5px',
                                                                }}
                                                                autoFocus={true}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                        <div
                                            className="bs-Fieldset-row"
                                            style={{ padding: '0px 20px' }}
                                        >
                                            <label className="bs-Fieldset-label">
                                                <span></span>
                                            </label>
                                            <div
                                                className="bs-Fieldset-fields bs-Fieldset-fields--wide"
                                                style={{ padding: 0 }}
                                            >
                                                <div
                                                    className="Box-root"
                                                    style={{
                                                        height: '5px',
                                                    }}
                                                ></div>
                                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                    <label className="Checkbox">
                                                        <Field
                                                            component="input"
                                                            type="checkbox"
                                                            name="enableHttps"
                                                            className="Checkbox-source"
                                                            id="enableHttps"
                                                        />
                                                        <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                            <div className="Checkbox-target Box-root">
                                                                <div className="Checkbox-color Box-root"></div>
                                                            </div>
                                                        </div>
                                                        <div
                                                            className="Box-root"
                                                            style={{
                                                                paddingLeft:
                                                                    '5px',
                                                            }}
                                                        >
                                                            <span>
                                                                Enable HTTPS
                                                            </span>
                                                            <label className="bs-Fieldset-explanation">
                                                                <span></span>
                                                            </label>
                                                        </div>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                        <ShouldRender
                                            if={
                                                formValues &&
                                                formValues.enableHttps
                                            }
                                        >
                                            <>
                                                <fieldset>
                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{ padding: 0 }}
                                                    >
                                                        <label
                                                            className="bs-Fieldset-label Text-align--left"
                                                            htmlFor="cert"
                                                        >
                                                            <span>
                                                                Certificate
                                                            </span>
                                                        </label>
                                                        <div
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        >
                                                            <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                                                                <div>
                                                                    <label
                                                                        className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                        type="button"
                                                                    >
                                                                        <ShouldRender
                                                                            if={
                                                                                !certFile.file
                                                                            }
                                                                        >
                                                                            <span className="bs-Button--icon bs-Button--new"></span>
                                                                            <span>
                                                                                Upload
                                                                                Certificate
                                                                                File
                                                                            </span>
                                                                        </ShouldRender>
                                                                        <ShouldRender
                                                                            if={
                                                                                certFile.file
                                                                            }
                                                                        >
                                                                            <span className="bs-Button--icon bs-Button--edit"></span>
                                                                            <span>
                                                                                Change
                                                                                Certificate
                                                                                File
                                                                            </span>
                                                                        </ShouldRender>
                                                                        <div className="bs-FileUploadButton-inputWrap">
                                                                            <Field
                                                                                className="bs-FileUploadButton-input"
                                                                                component={
                                                                                    UploadFile
                                                                                }
                                                                                name="certFile"
                                                                                id="certFile"
                                                                                onChange={
                                                                                    this
                                                                                        .changeCertFile
                                                                                }
                                                                                disabled={
                                                                                    certFile.requesting
                                                                                }
                                                                            />
                                                                        </div>
                                                                    </label>
                                                                </div>
                                                                <ShouldRender
                                                                    if={
                                                                        certFile.file
                                                                    }
                                                                >
                                                                    <div
                                                                        style={{
                                                                            padding:
                                                                                '0',
                                                                            display:
                                                                                'block',
                                                                        }}
                                                                    >
                                                                        <button
                                                                            className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                            type="button"
                                                                            onClick={
                                                                                this
                                                                                    .removeCertFile
                                                                            }
                                                                            disabled={
                                                                                certFile.requesting
                                                                            }
                                                                        >
                                                                            <span className="bs-Button--icon bs-Button--delete"></span>
                                                                            <span>
                                                                                Remove
                                                                                Certificate
                                                                                File
                                                                            </span>
                                                                        </button>
                                                                    </div>
                                                                </ShouldRender>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </fieldset>
                                                <fieldset>
                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{ padding: 0 }}
                                                    >
                                                        <label
                                                            className="bs-Fieldset-label Text-align--left"
                                                            htmlFor="cert"
                                                        >
                                                            <span>
                                                                Private Key
                                                            </span>
                                                        </label>
                                                        <div
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        >
                                                            <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                                                                <div>
                                                                    <label
                                                                        className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                        type="button"
                                                                    >
                                                                        <ShouldRender
                                                                            if={
                                                                                !privateKeyFile.file
                                                                            }
                                                                        >
                                                                            <span className="bs-Button--icon bs-Button--new"></span>
                                                                            <span>
                                                                                Upload
                                                                                Private
                                                                                Key
                                                                            </span>
                                                                        </ShouldRender>
                                                                        <ShouldRender
                                                                            if={
                                                                                privateKeyFile.file
                                                                            }
                                                                        >
                                                                            <span className="bs-Button--icon bs-Button--edit"></span>
                                                                            <span>
                                                                                Change
                                                                                Private
                                                                                Key
                                                                            </span>
                                                                        </ShouldRender>
                                                                        <div className="bs-FileUploadButton-inputWrap">
                                                                            <Field
                                                                                className="bs-FileUploadButton-input"
                                                                                component={
                                                                                    UploadFile
                                                                                }
                                                                                name="privateKeyFile"
                                                                                id="privateKeyFile"
                                                                                onChange={
                                                                                    this
                                                                                        .changePrivateKey
                                                                                }
                                                                                disabled={
                                                                                    privateKeyFile.requesting
                                                                                }
                                                                            />
                                                                        </div>
                                                                    </label>
                                                                </div>
                                                                <ShouldRender
                                                                    if={
                                                                        privateKeyFile.file
                                                                    }
                                                                >
                                                                    <div
                                                                        style={{
                                                                            padding:
                                                                                '0',
                                                                            display:
                                                                                'block',
                                                                        }}
                                                                    >
                                                                        <button
                                                                            className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                            type="button"
                                                                            onClick={
                                                                                this
                                                                                    .removePrivateKeyFile
                                                                            }
                                                                            disabled={
                                                                                privateKeyFile.requesting
                                                                            }
                                                                        >
                                                                            <span className="bs-Button--icon bs-Button--delete"></span>
                                                                            <span>
                                                                                Remove
                                                                                Private
                                                                                Key
                                                                            </span>
                                                                        </button>
                                                                    </div>
                                                                </ShouldRender>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </fieldset>
                                            </>
                                        </ShouldRender>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender if={addDomainError}>
                                            <div
                                                className="bs-Tail-copy"
                                                style={{ width: 200 }}
                                                id="addDomainError"
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
                                                            {addDomainError}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            type="button"
                                            onClick={() =>
                                                closeModal({
                                                    id: statusPageId,
                                                })
                                            }
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="createCustomDomainBtn"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={requesting}
                                            type="submit"
                                        >
                                            {!requesting && (
                                                <>
                                                    <span>Add Domain</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {requesting && <FormLoader />}
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </ClickOutside>
                    </div>
                </div>
            </div>
        );
    }
}

AddMoreDomainModal.displayName = 'AddMoreDomainModal';

AddMoreDomainModal.propTypes = {
    closeModal: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    formValues: PropTypes.object,
    requesting: PropTypes.bool,
    statusPageId: PropTypes.string,
    projectId: PropTypes.string,
    addDomainError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    uploadCertFile: PropTypes.func,
    uploadPrivateKey: PropTypes.func,
    certFile: PropTypes.object,
    privateKeyFile: PropTypes.object,
    removeCertFile: PropTypes.func,
    removePrivateKeyFile: PropTypes.func,
    createDomain: PropTypes.func,
};

const AddMoreDomainForm = reduxForm({
    form: 'AddMoreDomainForm',
    enableReinitialize: false,
    destroyOnUnmount: true,
    validate,
})(AddMoreDomainModal);

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            closeModal,
            uploadCertFile,
            uploadPrivateKey,
            removeCertFile,
            removePrivateKeyFile,
            createDomain,
        },
        dispatch
    );

const mapStateToProps = state => {
    return {
        statusPageId: state.modal.modals[0].statusPageId,
        projectId: state.modal.modals[0].projectId,
        formValues:
            state.form.AddMoreDomainForm && state.form.AddMoreDomainForm.values,
        requesting: state.statusPage.addDomain.requesting,
        addDomainError: state.statusPage.addDomain.error,
        certFile: state.statusPage.certFile,
        privateKeyFile: state.statusPage.privateKeyFile,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(AddMoreDomainForm);
