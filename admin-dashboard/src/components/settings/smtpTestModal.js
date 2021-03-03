import React from 'react';
import { connect } from 'react-redux';
import { reduxForm, Field } from 'redux-form';
import PropTypes from 'prop-types';
import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { Validate } from '../../config';
import { RenderField } from '../basic/RenderField';
import { FormLoader } from '../basic/Loader';

const SmtpTestModal = ({
    confirmThisDialog,
    closeThisDialog,
    testing,
    testError,
    smtp,
}) => {
    return (
        <div
            onKeyDown={e => e.key === 'Escape' && closeThisDialog()}
            className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center"
        >
            <div
                className="ModalLayer-contents"
                tabIndex={-1}
                style={{ marginTop: 40 }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal bs-Modal--medium">
                        <ClickOutside onClickOutside={closeThisDialog}>
                            <div className="bs-Modal-header">
                                <div className="bs-Modal-header-copy">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Test SMTP Settings</span>
                                    </span>
                                </div>
                                <div className="bs-Modal-header-copy Margin-top--8">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                        If your SMTP settings are correct, a
                                        test email will be sent to this email
                                        address.
                                    </span>
                                </div>
                            </div>
                            <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="bs-Fieldset">
                                            <div className="bs-Fieldset-rows">
                                                <div className="Margin-bottom--20 Margin-top--20">
                                                    <div>
                                                        <Field
                                                            className="db-BusinessSettings-input-wide TextInput bs-TextInput"
                                                            type="text"
                                                            name="test-email"
                                                            id="testEmail"
                                                            placeholder="Enter an email"
                                                            component={
                                                                RenderField
                                                            }
                                                            disabled={testing}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                        <fieldset
                                            style={{
                                                paddingBottom: 15,
                                                paddingTop: 0,
                                            }}
                                        >
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <div className="bs-Fieldset-fields">
                                                        <div className="bs-Fieldset-field">
                                                            <label
                                                                className="bs-Radio"
                                                                htmlFor="internalSmtpBtn"
                                                            >
                                                                <Field
                                                                    component="input"
                                                                    type="radio"
                                                                    name="smtpToUse"
                                                                    className="bs-Radio-source"
                                                                    id="internalSmtpBtn"
                                                                    value="internalSmtp"
                                                                    style={{
                                                                        width: 0,
                                                                        border:
                                                                            'none',
                                                                    }}
                                                                />
                                                                <span className="bs-Radio-button"></span>
                                                                <div
                                                                    className="Box-root"
                                                                    style={{
                                                                        paddingLeft:
                                                                            '5px',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Test
                                                                        with
                                                                        internal
                                                                        SMTP
                                                                        server
                                                                    </span>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                        <fieldset
                                            style={{
                                                paddingBottom: 15,
                                                paddingTop: 0,
                                            }}
                                        >
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <div className="bs-Fieldset-fields">
                                                        <div className="bs-Fieldset-field">
                                                            <label
                                                                className="bs-Radio"
                                                                htmlFor="customSmtpBtn"
                                                            >
                                                                <Field
                                                                    component="input"
                                                                    type="radio"
                                                                    name="smtpToUse"
                                                                    className="bs-Radio-source"
                                                                    id="customSmtpBtn"
                                                                    value="customSmtp"
                                                                    style={{
                                                                        width: 0,
                                                                        border:
                                                                            'none',
                                                                    }}
                                                                />
                                                                <span className="bs-Radio-button"></span>
                                                                <div
                                                                    className="Box-root"
                                                                    style={{
                                                                        paddingLeft:
                                                                            '5px',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Test
                                                                        with
                                                                        custom
                                                                        SMTP
                                                                        server
                                                                    </span>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                            </div>
                            <div
                                className="bs-Modal-footer"
                                style={{ wordBreak: 'break-word' }}
                            >
                                <div className="Flex-flex Flex-direction--row Flex-justifyContent--flexEnd Table-cell--width--maximized">
                                    <ShouldRender if={testError}>
                                        <div className="bs-Tail-copy">
                                            <div
                                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                style={{ marginTop: '10px' }}
                                            >
                                                <div className="Box-root Margin-right--8">
                                                    <div
                                                        className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"
                                                        style={{
                                                            marginTop: '2px',
                                                        }}
                                                    ></div>
                                                </div>
                                                <div className="Box-root Margin-right--8">
                                                    <span
                                                        style={{
                                                            color: 'red',
                                                        }}
                                                    >
                                                        {testError}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                    <button
                                        id="cancelSmtpTest"
                                        className={`bs-Button ${testing &&
                                            'bs-is-disabled'}`}
                                        type="button"
                                        onClick={closeThisDialog}
                                        disabled={testing}
                                        style={{ height: '33px' }}
                                    >
                                        <span>Cancel</span>
                                    </button>
                                    <button
                                        id="confirmSmtpTest"
                                        className={`bs-Button bs-Button--blue ${testing &&
                                            'bs-is-disabled'}`}
                                        onClick={() => {
                                            // prevent form submission if form field is empty or invalid
                                            if (!smtp.values) return;
                                            if (
                                                smtp.syncErrors &&
                                                smtp.syncErrors['test-email']
                                            )
                                                return;

                                            confirmThisDialog(smtp.values);
                                        }}
                                        disabled={testing}
                                        style={{ height: '33px' }}
                                    >
                                        {testing ? (
                                            <FormLoader />
                                        ) : (
                                            <span>Test</span>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </ClickOutside>
                    </div>
                </div>
            </div>
        </div>
    );
};

const mapStateToProps = state => ({
    testing: state.settings.testing,
    testError: state.settings.error,
    smtp: state.form['smtp-test-form'],
});

SmtpTestModal.displayName = 'Test Confirmation Modal';

SmtpTestModal.propTypes = {
    confirmThisDialog: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func,
    testing: PropTypes.bool,
    testError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    smtp: PropTypes.object,
};

// Client side validation
function validate(values) {
    const errors = {};

    if (!Validate.email(values['test-email'])) {
        errors['test-email'] = 'Email is not valid.';
    }
    return errors;
}

const ReduxFormComponent = reduxForm({
    form: 'smtp-test-form',
    enableReinitialize: true,
    destroyOnUnmount: false,
    validate,
})(SmtpTestModal);

export default connect(mapStateToProps)(ReduxFormComponent);
