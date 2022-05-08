import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';

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
import { openModal } from 'CommonUI/actions/Modal';
import MessageBox from '../Modals/MessageBox';

import { v4 as uuidv4 } from 'uuid';

//Client side validation
function validate(values: $TSFixMe) {
    const errors: $TSFixMe = {};
    if (!Validate.text(values.currentPassword)) {

        errors.currentPassword = 'Current password is required.';
    }
    if (!Validate.text(values.newPassword)) {

        errors.newPassword = 'New Password is required.';
    }
    if (!Validate.text(values.confirmPassword)) {

        errors.confirmPassword = 'Confirm password is required.';
    }
    return errors;
}

interface ChangePasswordSettingProps {
    handleSubmit: Function;
    reset: Function;
    updateChangePasswordSetting: Function;
    profileSettings?: object;
    openModal: Function;
}

export class ChangePasswordSetting extends Component<ChangePasswordSettingProps>{
    public static displayName = '';
    public static propTypes = {};
    state = {
        MessageBoxId: uuidv4(),
    };

    constructor(props: $TSFixMe) {
        super(props);
    }

    submitForm = (values: $TSFixMe) => {

        const { reset, openModal }: $TSFixMe = this.props;
        const { MessageBoxId }: $TSFixMe = this.state;


        this.props.updateChangePasswordSetting(values).then(
            function () {
                openModal({
                    id: MessageBoxId,
                    content: MessageBox,
                    title: 'Message',
                    message: 'You’ve changed the password successfully.',
                });
                reset();
            },
            function () { }
        );
    };

    override render() {

        const { handleSubmit }: $TSFixMe = this.props;

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

                                                                .profileSettings &&
                                                            this.props

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

                                                                .profileSettings &&
                                                            this.props

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

                                                                .profileSettings &&
                                                            this.props

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

                                            this.props.profileSettings &&

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

                                                {this.props.profileSettings &&

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

                                        this.props.profileSettings &&

                                        this.props.profileSettings
                                            .changePasswordSetting.requesting
                                    }
                                    type="submit"
                                >

                                    {!this.props.profileSettings
                                        .changePasswordSetting.requesting && (
                                            <span>Change Password</span>
                                        )}

                                    {this.props.profileSettings &&

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


ChangePasswordSetting.displayName = 'ChangePasswordSetting';

const ChangePasswordSettingForm: $TSFixMe = reduxForm({
    form: 'ChangePasswordSetting', // a unique identifier for this form
    validate, // <--- validation function given to redux-for
})(ChangePasswordSetting);

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
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

function mapStateToProps(state: RootState) {
    return {
        profileSettings: state.profileSettings,
    };
}


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
