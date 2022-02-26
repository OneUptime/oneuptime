import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field } from 'redux-form';
import {
    updateChangePasswordSetting,
    updateChangePasswordSettingRequest,
    updateChangePasswordSettingSuccess,
    updateChangePasswordSettingError,
} from '../../actions/profile';
import { RenderField } from '../basic/RenderField';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { openModal } from '../../actions/modal';
import MessageBox from '../modals/MessageBox';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';

//Client side validation
function validate(values: $TSFixMe) {
    const errors = {};
    if (!Validate.text(values.currentPassword)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentPassword' does not exist on type ... Remove this comment to see the full error message
        errors.currentPassword = 'Current password is required.';
    }
    if (!Validate.text(values.newPassword)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'newPassword' does not exist on type '{}'... Remove this comment to see the full error message
        errors.newPassword = 'New Password is required.';
    }
    if (!Validate.text(values.confirmPassword)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'confirmPassword' does not exist on type ... Remove this comment to see the full error message
        errors.confirmPassword = 'Confirm password is required.';
    }
    return errors;
}

export class ChangePasswordSetting extends Component {
    state = {
        MessageBoxId: uuidv4(),
    };

    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
    }

    submitForm = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'reset' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const { reset, openModal } = this.props;
        const { MessageBoxId } = this.state;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateChangePasswordSetting' does not ex... Remove this comment to see the full error message
        this.props.updateChangePasswordSetting(values).then(
            function() {
                openModal({
                    id: MessageBoxId,
                    content: MessageBox,
                    title: 'Message',
                    message: 'You’ve changed the password successfully.',
                });
                reset();
            },
            function() {}
        );
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
        const { handleSubmit } = this.props;

        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Change Password</span>
                            </span>
                            <p>
                                <span>
                                    We recommend you use password manager to
                                    store your OneUptime Password.
                                </span>
                            </p>
                        </div>
                    </div>
                    <form onSubmit={handleSubmit(this.submitForm)}>
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Current Password
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        type="password"
                                                        name="currentPassword"
                                                        id="currentPassword"
                                                        placeholder="Current Password"
                                                        component={RenderField}
                                                        disabled={
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
                                                                .profileSettings &&
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
                                                                .profileSettings
                                                                .changePasswordSetting
                                                                .requesting
                                                        }
                                                    />
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    New Password
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        type="password"
                                                        name="newPassword"
                                                        id="newPassword"
                                                        placeholder="New Paassword"
                                                        component={RenderField}
                                                        disabled={
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
                                                                .profileSettings &&
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
                                                                .profileSettings
                                                                .changePasswordSetting
                                                                .requesting
                                                        }
                                                    />
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Confirm Password
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        type="password"
                                                        name="confirmPassword"
                                                        id="confirmPassword"
                                                        placeholder="Confirm Password"
                                                        component={RenderField}
                                                        disabled={
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
                                                                .profileSettings &&
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
                                                                .profileSettings
                                                                .changePasswordSetting
                                                                .requesting
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
                            <span className="db-SettingsForm-footerMessage"></span>
                            <div className="bs-Tail-copy">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                    <ShouldRender
                                        if={
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
                                            this.props.profileSettings &&
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
                                            this.props.profileSettings
                                                .changePasswordSetting.error
                                        }
                                    >
                                        <div className="Box-root Margin-right--8">
                                            <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                        </div>
                                        <div className="Box-root">
                                            <span
                                                style={{ color: 'red' }}
                                                id="errorMessage"
                                            >
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
                                                {this.props.profileSettings &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
                                                    this.props.profileSettings
                                                        .changePasswordSetting
                                                        .error}
                                            </span>
                                        </div>
                                    </ShouldRender>
                                </div>
                            </div>

                            <div>
                                <button
                                    className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                    disabled={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
                                        this.props.profileSettings &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
                                        this.props.profileSettings
                                            .changePasswordSetting.requesting
                                    }
                                    type="submit"
                                >
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
                                    {!this.props.profileSettings
                                        .changePasswordSetting.requesting && (
                                        <span>Change Password</span>
                                    )}
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
                                    {this.props.profileSettings &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
                                        this.props.profileSettings
                                            .changePasswordSetting
                                            .requesting && <FormLoader />}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ChangePasswordSetting.displayName = 'ChangePasswordSetting';

const ChangePasswordSettingForm = reduxForm({
    form: 'ChangePasswordSetting', // a unique identifier for this form
    validate, // <--- validation function given to redux-for
})(ChangePasswordSetting);

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            updateChangePasswordSetting,
            updateChangePasswordSettingRequest,
            updateChangePasswordSettingSuccess,
            updateChangePasswordSettingError,
            openModal,
        },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe) {
    return {
        profileSettings: state.profileSettings,
    };
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ChangePasswordSetting.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    reset: PropTypes.func.isRequired,
    updateChangePasswordSetting: PropTypes.func.isRequired,
    profileSettings: PropTypes.object,
    openModal: PropTypes.func.isRequired,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ChangePasswordSettingForm);
