import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { reduxForm, Field, formValueSelector } from 'redux-form';
import {
    updateProfileSetting,
    userSettings,
    logFile,
    resetFile,
    sendVerificationSMS,
    verifySMSCode,
    sendEmailVerificationLink,
    setAlertPhoneNumber,
    setVerified,
    setInitPhoneVerificationNumber,
    setInitPhoneVerification,
    setProfilePic,
    setRemovedPic,
    setFileInputKey,
    setIsVerified,
    setInitialAlertPhoneNumber,
    setUserEmail,
    setResendTimer,
    setInitAlertEmail
} from '../../actions/profile';
import { RenderField } from '../basic/RenderField';
import { Validate, API_URL } from '../../config';
import { FormLoader, ListLoader } from '../basic/Loader';
import { UploadFile } from '../basic/UploadFile';
import TimezoneSelector from '../basic/TimezoneSelector';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import ReactPhoneInput from 'react-phone-input-2'
import 'react-phone-input-2/dist/style.css'
import { User } from '../../config';

const selector = formValueSelector('Profile');

//Client side validation
function validate(values) {

    const errors = {};

    if (values.email) {
        if (!Validate.email(values.email)) {
            errors.email = 'Email is not valid.'
        }

        if (!Validate.isValidBusinessEmail(values.email) && Validate.email(values.email)) {
            errors.email = 'Please enter a business email address.';
        }
    }

    if (values.name) {
        if (!Validate.text(values.name)) {
            errors.name = 'Name is not in valid format.'
        }
    }

    if (values.timezone) {
        if (!Validate.text(values.timezone)) {
            errors.name = 'Timezone is not in valid format.'
        }
    }

    if (values.companyPhoneNumber) {
        if (!Validate.text(values.companyPhoneNumber)) {
            errors.name = 'Phone Number is not in valid format.'
        }
    }

    return errors;
}

export class ProfileSetting extends Component {

    handleOnChange = (value) => {
        this.props.setAlertPhoneNumber(value);
    }

    tick = () => {
        if (this.props.resendTimer < 1) {
            this.props.setResendTimer(null);
        }
        else {
            this.props.setResendTimer(this.props.resendTimer - 1);
        }
    }

    startTimer = () => {
        clearInterval(this.timer)
        this.timer = setInterval(this.tick.bind(this), 1000);
    }

    handleVerifySMSCode = () => {
        const { projectId, verifySMSCode, otp, setVerified } = this.props;
        const { alertPhoneNumber } = this.props.profileSettingState;

        verifySMSCode(projectId, {
            to: alertPhoneNumber,
            code: otp
        }).then((result) => {
            if (result.data.valid && result.data.status === 'approved') {
                setVerified(true);
            }
        })

    }

    handleSendVerificationSMS = () => {
        const { projectId, sendVerificationSMS, setInitPhoneVerificationNumber, setInitPhoneVerification, setResendTimer } = this.props;
        const { alertPhoneNumber } = this.props.profileSettingState;
        const StartTimer = this.startTimer;
        clearInterval(this.timer);
        this.props.setResendTimer(null);
        sendVerificationSMS(projectId, {
            to: alertPhoneNumber
        })
            .then(() => {
                setResendTimer(300);
                setTimeout(StartTimer(), 1000);
            })
        setInitPhoneVerificationNumber(alertPhoneNumber);
        setInitPhoneVerification(true);
    }

    componentDidMount() {
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Profile settings page Loaded');
        }
        this.props.userSettings();
        const profilePic = this.props.profileSettings &&
            this.props.profileSettings.data &&
            this.props.profileSettings.data.profilePic &&
            this.props.profileSettings.data.profilePic !== '' ? this.props.profileSettings.data.profilePic : null;
        const { alertPhoneNumber, isVerified, email } = this.props.initialValues;

        this.props.setAlertPhoneNumber(alertPhoneNumber);
        this.props.setProfilePic(profilePic);
        this.props.setIsVerified(isVerified);
        this.props.setFileInputKey(new Date());
        this.props.setInitialAlertPhoneNumber(alertPhoneNumber);
        this.props.setUserEmail(email);
    }

    componentDidUpdate(prevProps) {
        const prevProfilePic = prevProps.profileSettings &&
            prevProps.profileSettings.data &&
            prevProps.profileSettings.data.profilePic ?
            prevProps.profileSettings.data.profilePic : null;
        const currentProfilePic = this.props.profileSettings &&
            this.props.profileSettings.data &&
            this.props.profileSettings.data.profilePic ?
            this.props.profileSettings.data.profilePic : null;

        if (prevProfilePic !== currentProfilePic) {
            this.updateProfilePic(currentProfilePic)
        }
    }

    updateProfilePic(profilePic) {
        const { resetFile, setProfilePic } = this.props;

        setProfilePic(profilePic);
        resetFile();
    }

    changefile = (e) => {
        e.preventDefault();

        let reader = new FileReader();
        let file = e.target.files[0];

        reader.onloadend = () => {
            this.props.logFile(reader.result);
        }
        try {
            reader.readAsDataURL(file)
            this.props.setProfilePic(file);
            this.props.setRemovedPic(false);
        } catch (error) {
            return
        }
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('New Profile Picture selected');
        }
    }


    submitForm = (values) => {
        const initialAlertPhoneNumber = this.props.initialValues.alertPhoneNumber;
        const { alertPhoneNumber, verified, removedPic } = this.props.profileSettingState;
        const { sendVerificationSMSError, verifySMSCodeError, setInitPhoneVerification } = this.props;

        if (initialAlertPhoneNumber !== alertPhoneNumber
            && !verified && !sendVerificationSMSError && !verifySMSCodeError) {
            setInitPhoneVerification(true);
            this.handleSendVerificationSMS();
        }
        const { updateProfileSetting, resetFile } = this.props;

        values.removedPic = removedPic;
        updateProfileSetting(values).then(function () {
            resetFile();
        });
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Update Profile', values);
        }
        User.setEmail(values.email);
    }

    removeProfilePic = () => {
        const { resetFile, setProfilePic, setRemovedPic, setFileInputKey } = this.props;
        setProfilePic(null);
        setRemovedPic(true);
        setFileInputKey(new Date());
        resetFile();
    }

    handleSendEmailVerification = () => {
        const { emailValue, initialValues } = this.props;
        this.props.sendEmailVerificationLink({ email: emailValue, userId: initialValues.id });
        this.props.setInitAlertEmail(emailValue);
    }

    render() {
        var { profileSettingState, resendTimer, emailValue } = this.props;
        if (isNaN(resendTimer)) {
            resendTimer = parseInt(resendTimer, 10);
        }
        if (resendTimer < 1) {
            clearInterval(this.timer);
        }
        const { initPhoneVerification, verified, initialAlertPhoneNumber, initPhoneVerificationNumber } = profileSettingState;

        if (initPhoneVerification && initPhoneVerificationNumber && initPhoneVerificationNumber !== profileSettingState.alertPhoneNumber) {
            this.props.setInitPhoneVerification(false);
        } else if (!initPhoneVerification && initPhoneVerificationNumber && initPhoneVerificationNumber === profileSettingState.alertPhoneNumber) {
            this.props.setInitPhoneVerification(true);
        }

        const { handleSubmit, profileSettings,
            sendVerificationSMSRequesting, emailVerificationRequesting,
            verifySMSCodeRequesting, sendVerificationSMSError,
            verifySMSCodeError, emailVerificationError, emailVerificationSuccess,
            initialValues } = this.props;

        var profilePic = profileSettingState.profilePic;
        var isVerified = profileSettingState.isVerified;
        var initialUserEmail;

        if (initialValues) {
            isVerified = this.props.initialValues.isVerified;
            initialUserEmail = this.props.initialValues.email;
        }

        profilePic = profilePic === 'null' ? null : profilePic;

        var fileData = this.props.fileUrl ? this.props.fileUrl : profilePic ? `${API_URL}/file/${profilePic}` : 'https://secure.gravatar.com/avatar/0c44b8877b1dccab3029ba37888a1686?s=60&amp;d=https%3A%2F%2Fb.stripecdn.com%2Fmanage%2Fassets%2F404';
        var profileImage = <span />;

        if (profilePic || this.props.fileUrl) {
            profileImage = <img src={fileData} alt="" className="image-small-circle" style={{ marginTop: '10px' }} />;
        }
        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Profile Settings</span>
                            </span>
                            <p><span>Change your email, password, profile picture and more.</span></p>
                        </div>
                    </div>
                    <form onSubmit={handleSubmit(this.submitForm)}>
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Full Name</label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        type="text"
                                                        name="name"
                                                        id="name"
                                                        placeholder="Full Name"
                                                        component={RenderField}
                                                        disabled={profileSettings && profileSettings.requesting}
                                                    />
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Email</label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        type="text"
                                                        name="email"
                                                        id="email"
                                                        placeholder="Email"
                                                        component={RenderField}
                                                        disabled={profileSettings && profileSettings.requesting}
                                                    />
                                                </div>
                                                <div className="bs-Fieldset-fields" style={{ marginLeft: -80, marginTop: 5 }}>
                                                    {
                                                        (emailValue !== profileSettingState.userEmail) || !isVerified ?
                                                            <div className="Badge Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--14 Text-fontWeight--bold Text-lineHeight--16 Text-wrap--noWrap">
                                                                    Not verified
                                                            </span>
                                                            </div>
                                                            : <div className="Badge Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--14 Text-fontWeight--bold Text-lineHeight--16 Text-wrap--noWrap">
                                                                    Verified
                                                                </span>
                                                            </div>
                                                    }
                                                </div>
                                            </div>
                                            <ShouldRender if={!profileSettings.requesting && ((emailValue !== profileSettingState.userEmail) || !isVerified)}>
                                                <div className="bs-Fieldset-row" style={{ marginBottom: -5, marginTop: -5 }}>
                                                    <label className="bs-Fieldset-label"></label>
                                                    <div className="bs-Fieldset-fields">
                                                        {((!emailVerificationError && !emailVerificationSuccess) || initialUserEmail !== emailValue) && <button
                                                            className="bs-Button"
                                                            disabled={profileSettings && profileSettings.requesting}
                                                            type="button"
                                                            onClick={this.handleSendEmailVerification}>
                                                            {!emailVerificationRequesting && <span>Resend email verification.</span>}
                                                            {emailVerificationRequesting && <div style={{ marginTop: -20 }}> <ListLoader /> </div>}
                                                        </button>}
                                                        {emailVerificationError && emailValue === profileSettingState.initAlertEmail && <span><br />{emailVerificationError}</span>}
                                                        {(emailVerificationSuccess && initialUserEmail !== profileSettingState.initAlertEmail) && <span><br />Please check your email to verify your email address</span>}
                                                    </div>
                                                </div>
                                            </ShouldRender>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Phone</label>
                                                <div className="bs-Fieldset-fields">
                                                    <ReactPhoneInput
                                                        defaultCountry={'us'}
                                                        value={profileSettingState.alertPhoneNumber}
                                                        onChange={this.handleOnChange}
                                                        disabled={profileSettings && profileSettings.requesting}
                                                        inputStyle={{ width: 250, height: 28, fontSize: 14, color: '#525f7f', fontFamily: 'camphor' }}
                                                    />
                                                </div>
                                                <div className="bs-Fieldset-fields" style={{ marginLeft: -80, marginTop: 5 }}>
                                                    {
                                                        profileSettingState.alertPhoneNumber !== initialAlertPhoneNumber && !verified ?
                                                            <div className="Badge Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--14 Text-fontWeight--bold Text-lineHeight--16 Text-wrap--noWrap">
                                                                    Not verified
                                                                </span>
                                                            </div>
                                                            : profileSettingState.alertPhoneNumber ?
                                                                <div className="Badge Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                    <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--14 Text-fontWeight--bold Text-lineHeight--16 Text-wrap--noWrap">
                                                                        Verified
                                                                </span>
                                                                </div> : ''
                                                    }
                                                </div>
                                            </div>
                                            <ShouldRender if={!profileSettings.requesting && (!sendVerificationSMSError || (sendVerificationSMSError && (!initPhoneVerification || (profileSettingState.alertPhoneNumber !== profileSettingState.initPhoneVerificationNumber))))}>
                                                <ShouldRender if={!verified && (profileSettingState.alertPhoneNumber !== initialAlertPhoneNumber) && !initPhoneVerification}>
                                                    <div className="bs-Fieldset-row" style={{ marginBottom: -5, marginTop: -5 }}>
                                                        <label className="bs-Fieldset-label"></label>
                                                        <div className="bs-Fieldset-fields">
                                                            <button
                                                                className="bs-Button"
                                                                disabled={profileSettings && profileSettings.requesting}
                                                                type="button"
                                                                onClick={() => this.handleSendVerificationSMS()}>
                                                                {!sendVerificationSMSRequesting && <span>Send verification SMS.</span>}
                                                                {sendVerificationSMSRequesting && <div style={{ marginTop: -20 }}> <ListLoader /> </div>}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender if={initPhoneVerification && !verified && profileSettingState.alertPhoneNumber !== initialAlertPhoneNumber}>
                                                    {(!verifySMSCodeError && !sendVerificationSMSError && !sendVerificationSMSRequesting) &&
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label" style={{ flex: '30% 0 0' }}><span></span></label>
                                                            <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                                <div className="Box-root" style={{ height: '5px' }}></div>
                                                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                    <label className="Checkbox">
                                                                        <div className="Box-root" style={{ 'paddingLeft': '5px' }}>
                                                                            <label>
                                                                                We have sent a code to {profileSettingState.initPhoneVerificationNumber} for verification.
                                                                            </label>
                                                                        </div>
                                                                    </label>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    }
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">Enter Code</label>
                                                        <div className="bs-Fieldset-fields" style={{ flex: '0 0 0' }}>
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                type="text"
                                                                name="otp"
                                                                id="otp"
                                                                placeholder="1234"
                                                                component={RenderField}
                                                                disabled={verifySMSCodeRequesting}
                                                                style={{ width: 120, marginRight: 10 }}
                                                            />
                                                        </div>
                                                        <div>
                                                            <button
                                                                className="bs-Button"
                                                                disabled={profileSettings && profileSettings.requesting}
                                                                type="button"
                                                                onClick={() => this.handleVerifySMSCode()}>
                                                                {!verifySMSCodeRequesting && <span>Verify</span>}
                                                                {verifySMSCodeRequesting && <div style={{ marginTop: -20 }}>
                                                                    <ListLoader />
                                                                </div>}
                                                            </button>
                                                            <button
                                                                className="bs-Button"
                                                                disabled={(profileSettings && profileSettings.requesting) || resendTimer}
                                                                type="button"
                                                                onClick={() => this.handleSendVerificationSMS()}>
                                                                {!sendVerificationSMSRequesting && !resendTimer && <span>Resend</span>}
                                                                {!sendVerificationSMSRequesting && resendTimer && resendTimer > 0 ? <span>Resend in {Math.floor(resendTimer / 60)} : {Math.floor(resendTimer % 60)}</span> : ''}
                                                                {sendVerificationSMSRequesting && <div style={{ marginTop: -20 }}>
                                                                    <ListLoader />
                                                                </div>}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                            </ShouldRender>
                                            <ShouldRender if={!verified && (verifySMSCodeError || sendVerificationSMSError)}>
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label" style={{ flex: '30% 0 0' }}><span></span></label>
                                                    <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                        <div className="Box-root" style={{ height: '5px' }}></div>
                                                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                            <label className="Checkbox">
                                                                <div className="Box-root" style={{ 'paddingLeft': '5px', color: 'red' }}>
                                                                    <label>
                                                                        {verifySMSCodeError}
                                                                        {sendVerificationSMSError === 'Server Error.' ?
                                                                            <span>Please provide a valid phone number</span> : <span>{sendVerificationSMSError}</span>
                                                                        }
                                                                    </label>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            </ShouldRender>
                                            <ShouldRender if={verified}>
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label" style={{ flex: '30% 0 0' }}><span></span></label>
                                                    <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                        <div className="Box-root" style={{ height: '5px' }}></div>
                                                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                            <label className="Checkbox">
                                                                <div className="Box-root" style={{ 'paddingLeft': '5px', color: 'green' }}>
                                                                    <label>
                                                                        Verification successful, this number has been updated.
                                                                        </label>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            </ShouldRender>

                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Profile Picture</label>
                                                <div className="bs-Fieldset-fields">
                                                    <div className="Box-root Flex-flex Flex-alignItems--center">
                                                        <div>
                                                            <label
                                                                className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                type="button"
                                                            >
                                                                <ShouldRender if={!profilePic}>
                                                                    <span className="bs-Button--icon bs-Button--new"></span>
                                                                    <span>
                                                                        Upload Profile Picture
                                                                    </span>
                                                                </ShouldRender>
                                                                <ShouldRender if={profilePic}>
                                                                    <span className="bs-Button--icon bs-Button--edit"></span>
                                                                    <span>
                                                                        Change Profile Picture
                                                                    </span>
                                                                </ShouldRender>
                                                                <div className="bs-FileUploadButton-inputWrap">
                                                                    <Field className="bs-FileUploadButton-input"
                                                                        component={UploadFile}
                                                                        name="profilePic"
                                                                        id="profilePic"
                                                                        accept="image/jpeg, image/jpg, image/png"
                                                                        onChange={this.changefile}
                                                                        disabled={profileSettings && profileSettings.requesting}
                                                                        fileInputKey={profileSettingState.fileInputKey}
                                                                    />
                                                                </div>
                                                            </label>

                                                        </div>
                                                        <ShouldRender if={profilePic}>
                                                            <div className="bs-Fieldset-fields">
                                                                <button
                                                                    className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                    type="button"
                                                                    onClick={this.removeProfilePic}
                                                                    disabled={profileSettings && profileSettings.requesting}
                                                                >
                                                                    <span className="bs-Button--icon bs-Button--delete"></span>
                                                                    <span>
                                                                        Remove Profile Picture
                                                                    </span>
                                                                </button>
                                                            </div>
                                                        </ShouldRender>
                                                    </div>
                                                    <ShouldRender if={profilePic || this.props.fileUrl}>
                                                        {profileImage}
                                                    </ShouldRender>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Timezone</label>
                                                <div className="bs-Fieldset-fields">
                                                    <span className="SearchableSelect-container">
                                                        <Field
                                                            component={TimezoneSelector}
                                                            name="timezone"
                                                            id="timezone"
                                                            placeholder="Select your timezone"
                                                            type="button"
                                                            style={{ width: '323px' }}
                                                            disabled={profileSettings && profileSettings.requesting}
                                                        />
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>

                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12"><span className="db-SettingsForm-footerMessage"></span>
                            <div className="bs-Tail-copy">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginTop: '10px' }}>
                                    <ShouldRender if={profileSettings && profileSettings.error}>

                                        <div className="Box-root Margin-right--8">
                                            <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
                                            </div>
                                        </div>
                                        <div className="Box-root">
                                            <span style={{ color: 'red' }}>{profileSettings && profileSettings.error}</span>
                                        </div>

                                    </ShouldRender>
                                </div>
                            </div>
                            <div>
                                <button
                                    className="bs-Button bs-Button--blue"
                                    disabled={profileSettings && profileSettings.requesting}
                                    type="submit">
                                    {!profileSettings.requesting && <span>Save Profile</span>}
                                    {profileSettings && profileSettings.requesting && <FormLoader />}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}

ProfileSetting.displayName = 'ProfileSetting'

let ProfileSettingForm = reduxForm({
    form: 'Profile', // a unique identifier for this form,
    enableReinitialize: true,
    validate // <--- validation function given to redux-for
})(ProfileSetting);

const mapDispatchToProps = (dispatch) => {

    return bindActionCreators({
        updateProfileSetting,
        logFile, resetFile,
        userSettings, sendVerificationSMS,
        verifySMSCode, sendEmailVerificationLink,
        setAlertPhoneNumber,
        setVerified,
        setInitPhoneVerificationNumber,
        setInitPhoneVerification,
        setProfilePic,
        setRemovedPic,
        setFileInputKey,
        setIsVerified,
        setInitialAlertPhoneNumber,
        setUserEmail,
        setResendTimer,
        setInitAlertEmail
    }, dispatch)
}

function mapStateToProps(state) {
    var resendTimer = state.profileSettings.resendTimer;
    if (isNaN(resendTimer)) {
        resendTimer = parseInt(resendTimer, 10);
    }
    return {
        fileUrl: state.profileSettings.file,
        profileSettings: state.profileSettings.profileSetting,
        initialValues: state.profileSettings.profileSetting ? state.profileSettings.profileSetting.data : {},
        projectId: state.project.currentProject !== null && state.project.currentProject._id,
        otp: state.form.Profile && state.form.Profile.values && state.form.Profile.values.otp,
        sendVerificationSMSError: state.profileSettings.smsVerification.error,
        sendVerificationSMSRequesting: state.profileSettings.smsVerification.requesting,
        verifySMSCodeError: state.profileSettings.smsVerificationResult.error,
        verifySMSCodeRequesting: state.profileSettings.smsVerificationResult.requesting,
        emailVerificationError: state.profileSettings.emailVerificationResult.error,
        emailVerificationRequesting: state.profileSettings.emailVerificationResult.requesting,
        emailVerificationSuccess: state.profileSettings.emailVerificationResult.success,
        profileSettingState: state.profileSettings.profileSettingState,
        resendTimer: resendTimer,
        emailValue: selector(state, 'email')
    };
}

ProfileSetting.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    profileSettings: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined])
    ]),
    updateProfileSetting: PropTypes.func.isRequired,
    userSettings: PropTypes.func.isRequired,
    logFile: PropTypes.func.isRequired,
    resetFile: PropTypes.func.isRequired,
    fileUrl: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined])
    ]),
    otp: PropTypes.string,
    sendVerificationSMSError: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
        PropTypes.string,
    ]),
    sendVerificationSMSRequesting: PropTypes.bool,
    emailVerificationRequesting: PropTypes.bool,
    verifySMSCodeError: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.string,
        PropTypes.oneOf([null, undefined])
    ]),
    emailVerificationError: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.string,
        PropTypes.oneOf([null, undefined])
    ]),
    verifySMSCodeRequesting: PropTypes.bool,
    initialValues: PropTypes.object,
    projectId: PropTypes.oneOfType([PropTypes.string, PropTypes.bool]),
    verifySMSCode: PropTypes.func.isRequired,
    sendEmailVerificationLink: PropTypes.func.isRequired,
    sendVerificationSMS: PropTypes.func.isRequired,
    profileSettingState: PropTypes.object,
    resendTimer: PropTypes.oneOfType([
        PropTypes.number,
        PropTypes.oneOf([null, undefined])
    ]),
    alertPhoneNumber: PropTypes.string,
    verified: PropTypes.bool,
    removedPic: PropTypes.bool,
    emailValue: PropTypes.string,
    setInitAlertEmail: PropTypes.string,
    initPhoneVerification: PropTypes.bool,
    initialAlertPhoneNumber: PropTypes.string,
    initPhoneVerificationNumber: PropTypes.string,
    profilePic: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined])
    ]),
    isVerified: PropTypes.bool,
    userEmail: PropTypes.string,
    emailVerificationSuccess: PropTypes.bool,
    initAlertEmail: PropTypes.string,
    setAlertPhoneNumber: PropTypes.func.isRequired,
    setResendTimer: PropTypes.func.isRequired,
    setVerified: PropTypes.func.isRequired,
    setInitPhoneVerificationNumber: PropTypes.func.isRequired,
    setInitPhoneVerification: PropTypes.func.isRequired,
    setProfilePic: PropTypes.func.isRequired,
    setIsVerified: PropTypes.func.isRequired,
    setFileInputKey: PropTypes.func.isRequired,
    setInitialAlertPhoneNumber: PropTypes.func.isRequired,
    setUserEmail: PropTypes.func.isRequired,
    setRemovedPic: PropTypes.func.isRequired
}

ProfileSetting.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(ProfileSettingForm);