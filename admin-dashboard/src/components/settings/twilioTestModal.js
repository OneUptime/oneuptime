import React from 'react';
import { connect } from 'react-redux';
import { reduxForm, Field } from 'redux-form';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { Validate } from '../../config';
import { RenderField } from '../basic/RenderField';

const TwilioTestModal = ({
    confirmThisDialog,
    closeThisDialog,
    testing,
    testError,
    twilio,
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
                        <div className="bs-Modal-header">
                            <div className="bs-Modal-header-copy">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Test Twilio Settings</span>
                                </span>
                            </div>
                            <div className="bs-Modal-header-copy Margin-top--8">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    If your Twilio settings are correct, a test
                                    sms will be sent to this phone number.
                                </span>
                            </div>
                        </div>
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            <div className="Margin-bottom--20 Margin-top--20">
                                                <div
                                                    className="bs-Fieldset-fields"
                                                    style={{
                                                        paddingTop: 3,
                                                    }}
                                                >
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        type="text"
                                                        name="test-number"
                                                        id="testNumber"
                                                        placeholder="Enter a phone number"
                                                        component={RenderField}
                                                        disabled={testing}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>
                        <div className="bs-Modal-footer">
                            <div className="Flex-flex Flex-direction--column Flex-justifyContent--center Table-cell--width--maximized">
                                <ShouldRender if={testError}>
                                    <div className="bs-Tail-copy">
                                        <div
                                            className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                            style={{ marginTop: '10px' }}
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div
                                                    className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"
                                                    style={{ marginTop: '2px' }}
                                                ></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {testError}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </ShouldRender>
                                <div className="Margin-top--8 bs-u-self--end">
                                    <button
                                        id="cancelSmtpTest"
                                        className={`bs-Button ${testing &&
                                            'bs-is-disabled'}`}
                                        type="button"
                                        onClick={closeThisDialog}
                                        disabled={testing}
                                    >
                                        <span>Cancel</span>
                                    </button>
                                    <button
                                        id="confirmSmtpTest"
                                        className={`bs-Button bs-Button--blue ${testing &&
                                            'bs-is-disabled'}`}
                                        onClick={() => {
                                            // prevent form submission if form field is empty or invalid
                                            if (!twilio.values) return;
                                            if (
                                                twilio.syncErrors &&
                                                twilio.syncErrors['test-number']
                                            )
                                                return;

                                            confirmThisDialog(twilio.values);
                                        }}
                                        disabled={testing}
                                    >
                                        <span>Test</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const mapStateToProps = state => ({
    testing: state.settings.testing,
    testError: state.settings.error,
    twilio: state.form['twilio-test-form'],
});

TwilioTestModal.displayName = 'Twilio Test Confirmation Modal';

TwilioTestModal.propTypes = {
    confirmThisDialog: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    testing: PropTypes.bool,
    testError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    twilio: PropTypes.object,
};

// Client side validation
function validate(values) {
    const errors = {};

    if (!Validate.text(values['test-number'])) {
        errors['test-number'] = 'Phone is not valid.';
    }
    return errors;
}

const ReduxFormComponent = reduxForm({
    form: 'twilio-test-form',
    enableReinitialize: true,
    destroyOnUnmount: false,
    validate,
})(TwilioTestModal);

export default connect(mapStateToProps)(ReduxFormComponent);
