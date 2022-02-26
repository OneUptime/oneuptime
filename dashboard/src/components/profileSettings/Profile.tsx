import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
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
    setInitAlertEmail,
    setTwoFactorAuth,
    updateTwoFactorAuthToken,
    updatePushNotification,
} from '../../actions/profile';
import { getProjects } from '../../actions/project';
import { RenderField } from '../basic/RenderField';
import { Validate, API_URL } from '../../config';
import { FormLoader, ListLoader } from '../basic/Loader';
import { UploadFile } from '../basic/UploadFile';
import TimezoneSelector from '../basic/TimezoneSelector';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import ReactPhoneInput from 'react-phone-input-2';
import 'react-phone-input-2/lib/style.css';
import { User } from '../../config';

import { openModal } from '../../actions/modal';
import DataPathHoC from '../DataPathHoC';
import TwoFactorAuthModal from '../modals/TwoFactorAuth';
import BackupCodesModal from '../modals/BackupCodes';
import {
    askUserPermission,
    getTheSubscription,
    getUserAgent,
} from '../../useNotification';

const selector = formValueSelector('Profile');

//Client side validation
function validate(values: $TSFixMe) {
    const errors = {};

    if (values.email) {
        if (!Validate.email(values.email)) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{}'.
            errors.email = 'Email is not valid.';
        }

        if (
            !Validate.isValidBusinessEmail(values.email) &&
            Validate.email(values.email)
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{}'.
            errors.email = 'Please enter a business email address.';
        }
    }

    if (values.name) {
        if (!Validate.text(values.name)) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
            errors.name = 'Name is not in valid format.';
        }
    }

    if (values.timezone) {
        if (!Validate.text(values.timezone)) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
            errors.name = 'Timezone is not in valid format.';
        }
    }

    if (values.companyPhoneNumber) {
        if (!Validate.text(values.companyPhoneNumber)) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
            errors.name = 'Phone Number is not in valid format.';
        }
    }

    return errors;
}

export class ProfileSetting extends Component {
    timer: $TSFixMe;
    constructor() {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1-2 arguments, but got 0.
        super();
        this.state = {
            checked: false,
            isBackendChecked: null,
        };
    }
    handleOnChange = (value: $TSFixMe) => {
        const internationalNumber = value.startsWith('+') ? value : '+' + value;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'setAlertPhoneNumber' does not exist on t... Remove this comment to see the full error message
        this.props.setAlertPhoneNumber(internationalNumber);
    };

    ref = React.createRef();

    tick = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resendTimer' does not exist on type 'Rea... Remove this comment to see the full error message
        if (this.props.resendTimer < 1) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setResendTimer' does not exist on type '... Remove this comment to see the full error message
            this.props.setResendTimer(null);
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setResendTimer' does not exist on type '... Remove this comment to see the full error message
            this.props.setResendTimer(this.props.resendTimer - 1);
        }
    };

    startTimer = () => {
        clearInterval(this.timer);
        this.timer = setInterval(this.tick.bind(this), 1000);
    };

    handleVerifySMSCode = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
        const { projectId, verifySMSCode, otp, setVerified } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettingState' does not exist on t... Remove this comment to see the full error message
        const { alertPhoneNumber } = this.props.profileSettingState;

        verifySMSCode(projectId, {
            to: alertPhoneNumber,
            code: otp,
        }).then((result: $TSFixMe) => {
            if (result.data.valid) {
                setVerified(true);
            }
        });
    };

    handleSendVerificationSMS = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'sendVerificationSMS' does not exist on t... Remove this comment to see the full error message
            sendVerificationSMS,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setInitPhoneVerificationNumber' does not... Remove this comment to see the full error message
            setInitPhoneVerificationNumber,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setInitPhoneVerification' does not exist... Remove this comment to see the full error message
            setInitPhoneVerification,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setResendTimer' does not exist on type '... Remove this comment to see the full error message
            setResendTimer,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettingState' does not exist on t... Remove this comment to see the full error message
        const { alertPhoneNumber } = this.props.profileSettingState;
        const StartTimer = this.startTimer;
        clearInterval(this.timer);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'setResendTimer' does not exist on type '... Remove this comment to see the full error message
        this.props.setResendTimer(null);
        sendVerificationSMS(projectId, {
            to: alertPhoneNumber,
        }).then(() => {
            setResendTimer(300);
            // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
            setTimeout(StartTimer(), 1000);
        });
        setInitPhoneVerificationNumber(alertPhoneNumber);
        setInitPhoneVerification(true);
    };

    async componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'userSettings' does not exist on type 'Re... Remove this comment to see the full error message
        await this.props.userSettings();
        const profilePic =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
            this.props.profileSettings &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
            this.props.profileSettings.data &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
            this.props.profileSettings.data.profilePic &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
            this.props.profileSettings.data.profilePic !== ''
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
                ? this.props.profileSettings.data.profilePic
                : null;
        const {
            alertPhoneNumber,
            isVerified,
            email,
            twoFactorAuthEnabled,
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
        } = this.props.initialValues;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'setAlertPhoneNumber' does not exist on t... Remove this comment to see the full error message
        this.props.setAlertPhoneNumber(alertPhoneNumber);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'setProfilePic' does not exist on type 'R... Remove this comment to see the full error message
        this.props.setProfilePic(profilePic);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'setIsVerified' does not exist on type 'R... Remove this comment to see the full error message
        this.props.setIsVerified(isVerified);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'setFileInputKey' does not exist on type ... Remove this comment to see the full error message
        this.props.setFileInputKey(new Date());
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'setInitialAlertPhoneNumber' does not exi... Remove this comment to see the full error message
        this.props.setInitialAlertPhoneNumber(alertPhoneNumber);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'setUserEmail' does not exist on type 'Re... Remove this comment to see the full error message
        this.props.setUserEmail(email);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'setTwoFactorAuth' does not exist on type... Remove this comment to see the full error message
        this.props.setTwoFactorAuth(twoFactorAuthEnabled);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getProjects' does not exist on type 'Rea... Remove this comment to see the full error message
        this.props.getProjects(null);
        this.checkPush();
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        const prevProfilePic =
            prevProps.profileSettings &&
            prevProps.profileSettings.data &&
            prevProps.profileSettings.data.profilePic
                ? prevProps.profileSettings.data.profilePic
                : null;
        const currentProfilePic =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
            this.props.profileSettings &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
            this.props.profileSettings.data &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
            this.props.profileSettings.data.profilePic
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
                ? this.props.profileSettings.data.profilePic
                : null;

        if (prevProfilePic !== currentProfilePic) {
            this.updateProfilePic(currentProfilePic);
        }
    }

    updateProfilePic(profilePic: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetFile' does not exist on type 'Reado... Remove this comment to see the full error message
        const { resetFile, setProfilePic } = this.props;

        setProfilePic(profilePic);
        resetFile();
    }

    changefile = (e: $TSFixMe) => {
        e.preventDefault();

        const reader = new FileReader();
        const file = e.target.files[0];

        reader.onloadend = () => {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'logFile' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.logFile(reader.result);
        };
        try {
            reader.readAsDataURL(file);
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setProfilePic' does not exist on type 'R... Remove this comment to see the full error message
            this.props.setProfilePic(file);
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setRemovedPic' does not exist on type 'R... Remove this comment to see the full error message
            this.props.setRemovedPic(false);
        } catch (error) {
            return;
        }
    };

    handleChange = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
            profileSettings: { data },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateTwoFactorAuthToken' does not exist... Remove this comment to see the full error message
            updateTwoFactorAuthToken,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
            openModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setTwoFactorAuth' does not exist on type... Remove this comment to see the full error message
            setTwoFactorAuth,
        } = this.props;
        if (data.twoFactorAuthEnabled) {
            updateTwoFactorAuthToken({
                twoFactorAuthEnabled: false,
                email: data.email,
            }).then(() => {
                setTwoFactorAuth(!data.twoFactorAuthEnabled);
            });
        } else {
            openModal({
                id: data.id,
                onClose: () => '',
                content: DataPathHoC(TwoFactorAuthModal, {}),
            });
        }
    };

    checkPush = async () => {
        const userAgent = await getUserAgent();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
        const identification = this.props.profileSettings.data.identification;
        if (identification && identification.length > 0) {
            const check = identification.find(
                (id: $TSFixMe) => String(id.userAgent) === String(userAgent)
            );
            if (check) {
                this.setState({ isBackendChecked: true });
            } else {
                this.setState({ isBackendChecked: false });
            }
        } else {
            this.setState({ isBackendChecked: false });
        }
    };

    handlePush = async (e: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isBackendChecked' does not exist on type... Remove this comment to see the full error message
        const { isBackendChecked } = this.state;
        this.setState({ isBackendChecked: !isBackendChecked });
        const checked = e.target.checked;
        const subscription = await getTheSubscription();
        if (!subscription) {
            this.setState({
                error: 'This works only on development build and production',
            });
            return;
        }
        if (checked) {
            askUserPermission();
        }
        this.setState({
            subscription,
            checked,
        });
    };

    submitPush = async () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'updatePushNotification' does not exist o... Remove this comment to see the full error message
        const { updatePushNotification } = this.props;
        const userAgent = await getUserAgent();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscription' does not exist on type 'Re... Remove this comment to see the full error message
        const { subscription, checked } = this.state;
        if (subscription) {
            updatePushNotification({ subscription, userAgent, checked });
        }
    };

    handleShowBackupCodes = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
            profileSettings: { data },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
            openModal,
        } = this.props;
        openModal({
            id: data.id,
            onClose: () => '',
            content: DataPathHoC(BackupCodesModal, {}),
        });
    };

    submitForm = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
        const initialAlertPhoneNumber = this.props.initialValues
            .alertPhoneNumber;
        const {
            alertPhoneNumber,
            verified,
            removedPic,
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettingState' does not exist on t... Remove this comment to see the full error message
        } = this.props.profileSettingState;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'sendVerificationSMSError' does not exist... Remove this comment to see the full error message
            sendVerificationSMSError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'verifySMSCodeError' does not exist on ty... Remove this comment to see the full error message
            verifySMSCodeError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setInitPhoneVerification' does not exist... Remove this comment to see the full error message
            setInitPhoneVerification,
        } = this.props;

        if (
            initialAlertPhoneNumber !== alertPhoneNumber &&
            !verified &&
            !sendVerificationSMSError &&
            !verifySMSCodeError
        ) {
            setInitPhoneVerification(true);
            this.handleSendVerificationSMS();
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateProfileSetting' does not exist on ... Remove this comment to see the full error message
        const { updateProfileSetting, resetFile } = this.props;

        values.removedPic = removedPic;
        updateProfileSetting(values).then(function() {
            resetFile();
        });

        User.setEmail(values.email);
        User.setName(values.name);
    };

    removeProfilePic = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetFile' does not exist on type 'Reado... Remove this comment to see the full error message
            resetFile,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setProfilePic' does not exist on type 'R... Remove this comment to see the full error message
            setProfilePic,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setRemovedPic' does not exist on type 'R... Remove this comment to see the full error message
            setRemovedPic,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setFileInputKey' does not exist on type ... Remove this comment to see the full error message
            setFileInputKey,
        } = this.props;
        setProfilePic(null);
        setRemovedPic(true);
        setFileInputKey(new Date());
        resetFile();
    };

    handleSendEmailVerification = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'emailValue' does not exist on type 'Read... Remove this comment to see the full error message
        const { emailValue, initialValues } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'sendEmailVerificationLink' does not exis... Remove this comment to see the full error message
        this.props.sendEmailVerificationLink({
            email: emailValue,
            userId: initialValues.id,
        });
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'setInitAlertEmail' does not exist on typ... Remove this comment to see the full error message
        this.props.setInitAlertEmail(emailValue);
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettingState' does not exist on t... Remove this comment to see the full error message
            profileSettingState,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'emailValue' does not exist on type 'Read... Remove this comment to see the full error message
            emailValue,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'twoFactorAuthSetting' does not exist on ... Remove this comment to see the full error message
            twoFactorAuthSetting,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resendTimer' does not exist on type 'Rea... Remove this comment to see the full error message
        let { resendTimer } = this.props;
        if (!Validate.number(resendTimer)) {
            resendTimer = parseInt(resendTimer, 10);
        }
        if (resendTimer < 1) {
            clearInterval(this.timer);
        }
        const {
            initPhoneVerification,
            verified,
            initialAlertPhoneNumber,
            initPhoneVerificationNumber,
            twoFactorAuthEnabled,
        } = profileSettingState;

        if (
            initPhoneVerification &&
            initPhoneVerificationNumber &&
            initPhoneVerificationNumber !== profileSettingState.alertPhoneNumber
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setInitPhoneVerification' does not exist... Remove this comment to see the full error message
            this.props.setInitPhoneVerification(false);
        } else if (
            !initPhoneVerification &&
            initPhoneVerificationNumber &&
            initPhoneVerificationNumber === profileSettingState.alertPhoneNumber
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setInitPhoneVerification' does not exist... Remove this comment to see the full error message
            this.props.setInitPhoneVerification(true);
        }

        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
            profileSettings,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'sendVerificationSMSRequesting' does not ... Remove this comment to see the full error message
            sendVerificationSMSRequesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'emailVerificationRequesting' does not ex... Remove this comment to see the full error message
            emailVerificationRequesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'verifySMSCodeRequesting' does not exist ... Remove this comment to see the full error message
            verifySMSCodeRequesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'sendVerificationSMSError' does not exist... Remove this comment to see the full error message
            sendVerificationSMSError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'verifySMSCodeError' does not exist on ty... Remove this comment to see the full error message
            verifySMSCodeError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'emailVerificationError' does not exist o... Remove this comment to see the full error message
            emailVerificationError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'emailVerificationSuccess' does not exist... Remove this comment to see the full error message
            emailVerificationSuccess,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
            initialValues,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'pushSettings' does not exist on type 'Re... Remove this comment to see the full error message
            pushSettings,
        } = this.props;

        let profilePic = profileSettingState.profilePic;
        let isVerified = profileSettingState.isVerified;

        if (initialValues) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
            isVerified = this.props.initialValues.isVerified;
        }

        profilePic = profilePic === 'null' ? null : profilePic;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fileUrl' does not exist on type 'Readonl... Remove this comment to see the full error message
        const fileData = this.props.fileUrl
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fileUrl' does not exist on type 'Readonl... Remove this comment to see the full error message
            ? this.props.fileUrl
            : profilePic
            ? `${API_URL}/file/${profilePic}`
            : 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
        let profileImage = <span />;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fileUrl' does not exist on type 'Readonl... Remove this comment to see the full error message
        if (profilePic || this.props.fileUrl) {
            profileImage = (
                <img
                    src={fileData}
                    alt=""
                    className="image-small-circle"
                    style={{ marginTop: '10px' }}
                />
            );
        }
        const verifiedEmail =
            isVerified &&
            emailValue === profileSettingState.userEmail &&
            profileSettings.data &&
            emailValue !== profileSettings.data.tempEmail;
        const verifiedPhone =
            (verified &&
                profileSettingState.alertPhoneNumber ===
                    profileSettingState.initPhoneVerificationNumber) ||
            (profileSettingState.alertPhoneNumber === initialAlertPhoneNumber &&
                profileSettings.data &&
                profileSettingState.alertPhoneNumber !==
                    profileSettings.data.tempAlertPhoneNumber);
        const showPhoneVerifyTools = !verifiedPhone;
        const showSendVerification =
            showPhoneVerifyTools && !initPhoneVerification;
        const showError =
            !verified &&
            (verifySMSCodeError || sendVerificationSMSError) &&
            profileSettingState.alertPhoneNumber ===
                profileSettingState.initPhoneVerificationNumber;

        return (
            <>
                <div
                    className="bs-ContentSection Card-root Card-shadow--medium"
                    style={{ boxShadow: '0 2px 15px rgb(84 96 103 / 25%)' }}
                >
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Profile Settings</span>
                                </span>
                                <p>
                                    <span>
                                        Change your email, password, profile
                                        picture and more.
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
                                                        Full Name
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                            type="text"
                                                            name="name"
                                                            id="name"
                                                            placeholder="Full Name"
                                                            component={
                                                                RenderField
                                                            }
                                                            disabled={
                                                                profileSettings &&
                                                                profileSettings.requesting
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">
                                                        Email
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            flex: 'unset',
                                                        }}
                                                    >
                                                        <Field
                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                            type="text"
                                                            name="email"
                                                            id="email"
                                                            placeholder="Email"
                                                            component={
                                                                RenderField
                                                            }
                                                            disabled={
                                                                profileSettings &&
                                                                profileSettings.requesting
                                                            }
                                                        />
                                                    </div>
                                                    <ShouldRender
                                                        if={emailValue}
                                                    >
                                                        <div
                                                            className="bs-Fieldset-fields"
                                                            style={{
                                                                marginTop: 5,
                                                            }}
                                                        >
                                                            {!verifiedEmail ? (
                                                                <div className="Badge Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                    <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--14 Text-fontWeight--bold Text-lineHeight--16 Text-wrap--noWrap">
                                                                        Not
                                                                        verified
                                                                    </span>
                                                                </div>
                                                            ) : (
                                                                <div className="Badge Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                    <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--14 Text-fontWeight--bold Text-lineHeight--16 Text-wrap--noWrap">
                                                                        Verified
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </ShouldRender>
                                                </div>
                                                <ShouldRender
                                                    if={!verifiedEmail}
                                                >
                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{
                                                            marginBottom: -5,
                                                            marginTop: -5,
                                                        }}
                                                    >
                                                        <label className="bs-Fieldset-label"></label>
                                                        <div className="bs-Fieldset-fields">
                                                            {profileSettingState.initAlertEmail ||
                                                            (profileSettings.data &&
                                                                profileSettings
                                                                    .data
                                                                    .tempEmail) ? (
                                                                <span
                                                                    style={{
                                                                        marginBottom:
                                                                            '10px',
                                                                        marginTop:
                                                                            '-5px',
                                                                    }}
                                                                >
                                                                    Your email
                                                                    <span
                                                                        style={{
                                                                            fontWeight:
                                                                                'bold',
                                                                        }}
                                                                    >
                                                                        {' '}
                                                                        {profileSettings.data &&
                                                                        profileSettings
                                                                            .data
                                                                            .email
                                                                            ? profileSettings
                                                                                  .data
                                                                                  .email
                                                                            : ''}{' '}
                                                                    </span>
                                                                    will be used
                                                                    for login
                                                                    unless
                                                                    <span
                                                                        style={{
                                                                            fontWeight:
                                                                                'bold',
                                                                        }}
                                                                    >
                                                                        {' '}
                                                                        {profileSettingState.initAlertEmail
                                                                            ? profileSettingState.initAlertEmail
                                                                            : profileSettings.data &&
                                                                              profileSettings
                                                                                  .data
                                                                                  .tempEmail
                                                                            ? profileSettings
                                                                                  .data
                                                                                  .tempEmail
                                                                            : ''}{' '}
                                                                    </span>{' '}
                                                                    is verified.{' '}
                                                                </span>
                                                            ) : (
                                                                ''
                                                            )}
                                                            <button
                                                                className="bs-Button"
                                                                disabled={
                                                                    profileSettings &&
                                                                    profileSettings.requesting
                                                                }
                                                                type="button"
                                                                onClick={
                                                                    this
                                                                        .handleSendEmailVerification
                                                                }
                                                            >
                                                                {!emailVerificationRequesting && (
                                                                    <span>
                                                                        Resend
                                                                        email
                                                                        verification.
                                                                    </span>
                                                                )}
                                                                {emailVerificationRequesting && (
                                                                    <div
                                                                        style={{
                                                                            marginTop: -20,
                                                                        }}
                                                                    >
                                                                        {' '}
                                                                        <ListLoader />{' '}
                                                                    </div>
                                                                )}
                                                            </button>
                                                            {emailVerificationError &&
                                                                emailValue ===
                                                                    profileSettingState.initAlertEmail && (
                                                                    <span>
                                                                        <br />
                                                                        {
                                                                            emailVerificationError
                                                                        }
                                                                    </span>
                                                                )}
                                                            {emailVerificationSuccess && (
                                                                <span>
                                                                    <br />
                                                                    Please check
                                                                    your email
                                                                    to verify
                                                                    your email
                                                                    address.
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">
                                                        Phone
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            flex: 'unset',
                                                        }}
                                                    >
                                                        <ReactPhoneInput
                                                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ defaultCountry: string; value: any; onChan... Remove this comment to see the full error message
                                                            defaultCountry="us"
                                                            value={
                                                                profileSettingState.alertPhoneNumber
                                                            }
                                                            onChange={
                                                                this
                                                                    .handleOnChange
                                                            }
                                                            disabled={
                                                                profileSettings &&
                                                                profileSettings.requesting
                                                            }
                                                        />
                                                    </div>
                                                    <ShouldRender
                                                        if={
                                                            profileSettingState.alertPhoneNumber
                                                        }
                                                    >
                                                        <div
                                                            className="bs-Fieldset-fields"
                                                            style={{
                                                                marginTop: 5,
                                                            }}
                                                        >
                                                            {!verifiedPhone ? (
                                                                <div className="Badge Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                    <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--14 Text-fontWeight--bold Text-lineHeight--16 Text-wrap--noWrap">
                                                                        Not
                                                                        verified
                                                                    </span>
                                                                </div>
                                                            ) : (
                                                                <div className="Badge Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                    <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--14 Text-fontWeight--bold Text-lineHeight--16 Text-wrap--noWrap">
                                                                        Verified
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </ShouldRender>
                                                </div>
                                                <ShouldRender
                                                    if={showPhoneVerifyTools}
                                                >
                                                    {profileSettings.data &&
                                                    profileSettings.data
                                                        .alertPhoneNumber &&
                                                    (profileSettingState.initPhoneVerificationNumber ||
                                                        (profileSettings.data &&
                                                            profileSettings.data
                                                                .tempAlertPhoneNumber)) ? (
                                                        <div
                                                            className="bs-Fieldset-row"
                                                            style={{
                                                                paddingBottom:
                                                                    '3px',
                                                                paddingTop:
                                                                    '0px',
                                                            }}
                                                        >
                                                            <label className="bs-Fieldset-label"></label>
                                                            <div className="bs-Fieldset-fields">
                                                                <span>
                                                                    Your number
                                                                    <span
                                                                        style={{
                                                                            fontWeight:
                                                                                'bold',
                                                                        }}
                                                                    >
                                                                        {' '}
                                                                        {profileSettings.data &&
                                                                        profileSettings
                                                                            .data
                                                                            .alertPhoneNumber
                                                                            ? profileSettings
                                                                                  .data
                                                                                  .alertPhoneNumber
                                                                            : ''}{' '}
                                                                    </span>
                                                                    will be used
                                                                    unless
                                                                    <span
                                                                        style={{
                                                                            fontWeight:
                                                                                'bold',
                                                                        }}
                                                                    >
                                                                        {' '}
                                                                        {profileSettingState.initPhoneVerificationNumber
                                                                            ? profileSettingState.initPhoneVerificationNumber
                                                                            : profileSettings.data &&
                                                                              profileSettings
                                                                                  .data
                                                                                  .tempAlertPhoneNumber
                                                                            ? profileSettings
                                                                                  .data
                                                                                  .tempAlertPhoneNumber
                                                                            : ''}{' '}
                                                                    </span>{' '}
                                                                    is verified.{' '}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        ''
                                                    )}
                                                    <ShouldRender
                                                        if={
                                                            showSendVerification ||
                                                            sendVerificationSMSRequesting
                                                        }
                                                    >
                                                        <div
                                                            className="bs-Fieldset-row"
                                                            style={{
                                                                marginBottom: -5,
                                                                marginTop: -5,
                                                            }}
                                                        >
                                                            <label className="bs-Fieldset-label"></label>
                                                            <div className="bs-Fieldset-fields">
                                                                <button
                                                                    id="sendVerificationSMS"
                                                                    className="bs-Button"
                                                                    disabled={
                                                                        profileSettings &&
                                                                        profileSettings.requesting
                                                                    }
                                                                    type="button"
                                                                    onClick={() =>
                                                                        this.handleSendVerificationSMS()
                                                                    }
                                                                >
                                                                    {!sendVerificationSMSRequesting && (
                                                                        <span>
                                                                            Send
                                                                            verification
                                                                            SMS.
                                                                        </span>
                                                                    )}
                                                                    {sendVerificationSMSRequesting && (
                                                                        <div
                                                                            style={{
                                                                                marginTop:
                                                                                    '-20px',
                                                                                padding:
                                                                                    '0px 52px',
                                                                            }}
                                                                        >
                                                                            {' '}
                                                                            <ListLoader />{' '}
                                                                        </div>
                                                                    )}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </ShouldRender>
                                                    <ShouldRender
                                                        if={
                                                            !showSendVerification &&
                                                            !sendVerificationSMSRequesting
                                                        }
                                                    >
                                                        {!verifySMSCodeError &&
                                                            !sendVerificationSMSError &&
                                                            !sendVerificationSMSRequesting && (
                                                                <div className="bs-Fieldset-row">
                                                                    <label
                                                                        className="bs-Fieldset-label"
                                                                        style={{
                                                                            flex:
                                                                                '30% 0 0',
                                                                        }}
                                                                    >
                                                                        <span></span>
                                                                    </label>
                                                                    <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                                        <div
                                                                            className="Box-root"
                                                                            style={{
                                                                                height:
                                                                                    '5px',
                                                                            }}
                                                                        ></div>
                                                                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                            <label className="Checkbox">
                                                                                <div
                                                                                    className="Box-root"
                                                                                    style={{
                                                                                        paddingLeft:
                                                                                            '5px',
                                                                                    }}
                                                                                >
                                                                                    <label>
                                                                                        We
                                                                                        have
                                                                                        sent
                                                                                        a
                                                                                        code
                                                                                        to{' '}
                                                                                        {
                                                                                            profileSettingState.initPhoneVerificationNumber
                                                                                        }{' '}
                                                                                        for
                                                                                        verification.
                                                                                    </label>
                                                                                </div>
                                                                            </label>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label">
                                                                Enter Code
                                                            </label>
                                                            <div
                                                                className="bs-Fieldset-fields"
                                                                style={{
                                                                    flex:
                                                                        '0 0 0',
                                                                }}
                                                            >
                                                                <Field
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    type="text"
                                                                    name="otp"
                                                                    id="otp"
                                                                    placeholder="123456"
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    disabled={
                                                                        verifySMSCodeRequesting
                                                                    }
                                                                    style={{
                                                                        width: 120,
                                                                        marginRight: 10,
                                                                    }}
                                                                />
                                                            </div>
                                                            <div>
                                                                <button
                                                                    id="verify"
                                                                    className="bs-Button"
                                                                    disabled={
                                                                        profileSettings &&
                                                                        profileSettings.requesting
                                                                    }
                                                                    type="button"
                                                                    onClick={() =>
                                                                        this.handleVerifySMSCode()
                                                                    }
                                                                >
                                                                    {!verifySMSCodeRequesting && (
                                                                        <span>
                                                                            Verify
                                                                        </span>
                                                                    )}
                                                                    {verifySMSCodeRequesting && (
                                                                        <div
                                                                            style={{
                                                                                marginTop: -20,
                                                                            }}
                                                                        >
                                                                            <ListLoader />
                                                                        </div>
                                                                    )}
                                                                </button>
                                                                <button
                                                                    className="bs-Button"
                                                                    disabled={
                                                                        (profileSettings &&
                                                                            profileSettings.requesting) ||
                                                                        resendTimer
                                                                    }
                                                                    type="button"
                                                                    onClick={() =>
                                                                        this.handleSendVerificationSMS()
                                                                    }
                                                                >
                                                                    {!sendVerificationSMSRequesting &&
                                                                        !resendTimer && (
                                                                            <span>
                                                                                Resend
                                                                            </span>
                                                                        )}
                                                                    {!sendVerificationSMSRequesting &&
                                                                    resendTimer &&
                                                                    resendTimer >
                                                                        0 ? (
                                                                        <span>
                                                                            Resend
                                                                            in{' '}
                                                                            {Math.floor(
                                                                                resendTimer /
                                                                                    60
                                                                            )}{' '}
                                                                            :{' '}
                                                                            {Math.floor(
                                                                                resendTimer %
                                                                                    60
                                                                            )}
                                                                        </span>
                                                                    ) : (
                                                                        ''
                                                                    )}
                                                                    {sendVerificationSMSRequesting && (
                                                                        <div
                                                                            style={{
                                                                                marginTop: -20,
                                                                            }}
                                                                        >
                                                                            <ListLoader />
                                                                        </div>
                                                                    )}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </ShouldRender>
                                                </ShouldRender>
                                                <ShouldRender if={showError}>
                                                    <div className="bs-Fieldset-row">
                                                        <label
                                                            className="bs-Fieldset-label"
                                                            style={{
                                                                flex: '30% 0 0',
                                                            }}
                                                        >
                                                            <span></span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    height:
                                                                        '5px',
                                                                }}
                                                            ></div>
                                                            <div
                                                                id="smsVerificationErrors"
                                                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart"
                                                            >
                                                                <label className="Checkbox">
                                                                    <div
                                                                        className="Box-root"
                                                                        style={{
                                                                            paddingLeft:
                                                                                '5px',
                                                                            color:
                                                                                'red',
                                                                        }}
                                                                    >
                                                                        <label>
                                                                            {
                                                                                verifySMSCodeError
                                                                            }
                                                                            {sendVerificationSMSError ===
                                                                            'Server Error.' ? (
                                                                                <span>
                                                                                    Please
                                                                                    provide
                                                                                    a
                                                                                    valid
                                                                                    phone
                                                                                    number.
                                                                                </span>
                                                                            ) : (
                                                                                <span>
                                                                                    {
                                                                                        sendVerificationSMSError
                                                                                    }
                                                                                </span>
                                                                            )}
                                                                        </label>
                                                                    </div>
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender if={verified}>
                                                    <div className="bs-Fieldset-row">
                                                        <label
                                                            className="bs-Fieldset-label"
                                                            style={{
                                                                flex: '30% 0 0',
                                                            }}
                                                        >
                                                            <span></span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    height:
                                                                        '5px',
                                                                }}
                                                            ></div>
                                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                <label className="Checkbox">
                                                                    <div
                                                                        id="successMessage"
                                                                        className="Box-root"
                                                                        style={{
                                                                            paddingLeft:
                                                                                '5px',
                                                                            color:
                                                                                'green',
                                                                        }}
                                                                    >
                                                                        <label>
                                                                            Verification
                                                                            successful,
                                                                            this
                                                                            number
                                                                            has
                                                                            been
                                                                            updated.
                                                                        </label>
                                                                    </div>
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </ShouldRender>

                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">
                                                        Profile Picture
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <div
                                                            className="Box-root Flex-flex Flex-alignItems--center"
                                                            style={{
                                                                flexWrap:
                                                                    'wrap',
                                                            }}
                                                        >
                                                            <div>
                                                                <label
                                                                    className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element[]; className: string; ty... Remove this comment to see the full error message
                                                                    type="button"
                                                                >
                                                                    <ShouldRender
                                                                        if={
                                                                            !profilePic
                                                                        }
                                                                    >
                                                                        <span className="bs-Button--icon bs-Button--new"></span>
                                                                        <span>
                                                                            Upload
                                                                            Profile
                                                                            Picture
                                                                        </span>
                                                                    </ShouldRender>
                                                                    <ShouldRender
                                                                        if={
                                                                            profilePic
                                                                        }
                                                                    >
                                                                        <span className="bs-Button--icon bs-Button--edit"></span>
                                                                        <span>
                                                                            Change
                                                                            Profile
                                                                            Picture
                                                                        </span>
                                                                    </ShouldRender>
                                                                    <div className="bs-FileUploadButton-inputWrap">
                                                                        <Field
                                                                            className="bs-FileUploadButton-input"
                                                                            component={
                                                                                UploadFile
                                                                            }
                                                                            name="profilePic"
                                                                            id="profilePic"
                                                                            accept="image/jpeg, image/jpg, image/png"
                                                                            onChange={
                                                                                this
                                                                                    .changefile
                                                                            }
                                                                            disabled={
                                                                                profileSettings &&
                                                                                profileSettings.requesting
                                                                            }
                                                                            fileInputKey={
                                                                                profileSettingState.fileInputKey
                                                                            }
                                                                        />
                                                                    </div>
                                                                </label>
                                                            </div>
                                                            <ShouldRender
                                                                if={profilePic}
                                                            >
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        padding:
                                                                            '0',
                                                                    }}
                                                                >
                                                                    <button
                                                                        className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                        type="button"
                                                                        onClick={
                                                                            this
                                                                                .removeProfilePic
                                                                        }
                                                                        disabled={
                                                                            profileSettings &&
                                                                            profileSettings.requesting
                                                                        }
                                                                        style={{
                                                                            margin:
                                                                                '10px 10px 0 0',
                                                                        }}
                                                                    >
                                                                        <span className="bs-Button--icon bs-Button--delete"></span>
                                                                        <span>
                                                                            Remove
                                                                            Profile
                                                                            Picture
                                                                        </span>
                                                                    </button>
                                                                </div>
                                                            </ShouldRender>
                                                        </div>
                                                        <ShouldRender
                                                            if={
                                                                profilePic ||
                                                                this.props
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'fileUrl' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                    .fileUrl
                                                            }
                                                        >
                                                            {profileImage}
                                                        </ShouldRender>
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">
                                                        Timezone
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <span className="SearchableSelect-container">
                                                            <Field
                                                                component={
                                                                    TimezoneSelector
                                                                }
                                                                name="timezone"
                                                                id="timezone"
                                                                placeholder="Select your timezone"
                                                                type="button"
                                                                style={{
                                                                    width:
                                                                        '323px',
                                                                }}
                                                                disabled={
                                                                    profileSettings &&
                                                                    profileSettings.requesting
                                                                }
                                                            />
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Two Factor Authentication{' '}
                                                    <br /> by Google
                                                    Authenticator
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <label
                                                        className="Toggler-wrap"
                                                        style={{
                                                            marginTop: '10px',
                                                        }}
                                                        id="twoFactorLabel"
                                                    >
                                                        <input
                                                            className="btn-toggler"
                                                            type="checkbox"
                                                            onChange={
                                                                this
                                                                    .handleChange
                                                            }
                                                            name="twoFactorAuthEnabled"
                                                            id="twoFactorAuthEnabled"
                                                            checked={
                                                                twoFactorAuthEnabled
                                                            }
                                                        />
                                                        <span className="TogglerBtn-slider round"></span>
                                                    </label>
                                                </div>
                                            </div>
                                            <ShouldRender
                                                if={twoFactorAuthEnabled}
                                            >
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{
                                                        marginBottom: -5,
                                                        marginTop: -5,
                                                    }}
                                                >
                                                    <label className="bs-Fieldset-label"></label>
                                                    <div className="bs-Fieldset-fields">
                                                        <button
                                                            className="bs-Button"
                                                            disabled={
                                                                profileSettings &&
                                                                profileSettings.requesting
                                                            }
                                                            type="button"
                                                            onClick={
                                                                this
                                                                    .handleShowBackupCodes
                                                            }
                                                        >
                                                            <span>
                                                                Show backup
                                                                codes
                                                            </span>
                                                        </button>
                                                    </div>
                                                </div>
                                            </ShouldRender>
                                        </fieldset>
                                    </div>
                                </div>
                            </div>

                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div className="bs-Tail-copy">
                                    <div
                                        className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                        style={{ marginTop: '10px' }}
                                    >
                                        <ShouldRender
                                            if={
                                                (profileSettings &&
                                                    profileSettings.error) ||
                                                (twoFactorAuthEnabled &&
                                                    twoFactorAuthSetting &&
                                                    twoFactorAuthSetting.error)
                                            }
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {profileSettings &&
                                                        profileSettings.error}
                                                </span>
                                                <span style={{ color: 'red' }}>
                                                    {twoFactorAuthEnabled &&
                                                        twoFactorAuthSetting &&
                                                        twoFactorAuthSetting.error}
                                                </span>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </div>
                                <div>
                                    <button
                                        className="bs-Button bs-Button--blue"
                                        disabled={
                                            profileSettings &&
                                            profileSettings.requesting
                                        }
                                        type="submit"
                                    >
                                        {!profileSettings.requesting && (
                                            <span>Save Profile</span>
                                        )}
                                        {profileSettings &&
                                            profileSettings.requesting && (
                                                <FormLoader />
                                            )}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
                <div
                    className="bs-ContentSection Card-root Card-shadow--medium Margin-vertical--12"
                    style={{ boxShadow: '0 2px 15px rgb(84 96 103 / 25%)' }}
                >
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Push Notification</span>
                                </span>
                                <p>
                                    <span>
                                        Allow push notification for this device.
                                    </span>
                                </p>
                            </div>
                        </div>
                        <form onSubmit={handleSubmit(this.submitPush)}>
                            <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="bs-Fieldset">
                                            <div className="bs-Fieldset-row">
                                                <label
                                                    className="bs-Fieldset-label"
                                                    style={{ marginTop: '7px' }}
                                                >
                                                    Enable Push Notifications
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <label
                                                        className="Toggler-wrap"
                                                        style={{
                                                            marginTop: '10px',
                                                        }}
                                                    >
                                                        <input
                                                            className="btn-toggler"
                                                            type="checkbox"
                                                            onChange={
                                                                this.handlePush
                                                            }
                                                            name="pushNotfication"
                                                            id="pushNotfication"
                                                            checked={
                                                                this.state
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'isBackendChecked' does not exist on type... Remove this comment to see the full error message
                                                                    .isBackendChecked
                                                            }
                                                        />
                                                        <span className="TogglerBtn-slider round"></span>
                                                    </label>
                                                    <ShouldRender
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'error' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                        if={this.state.error}
                                                    >
                                                        <div
                                                            style={{
                                                                marginTop:
                                                                    '10px',
                                                                display: 'flex',
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
                                                                        this
                                                                            .state
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'error' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                                            .error
                                                                    }
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </ShouldRender>
                                                </div>
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                            </div>

                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div className="bs-Tail-copy">
                                    <div
                                        className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                        style={{ marginTop: '10px' }}
                                    >
                                        <ShouldRender
                                            if={
                                                pushSettings &&
                                                pushSettings.pushNotification
                                                    .error
                                            }
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {pushSettings &&
                                                        pushSettings
                                                            .pushNotification
                                                            .error}
                                                </span>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </div>
                                <div>
                                    <button
                                        className="bs-Button bs-Button--blue"
                                        disabled={
                                            pushSettings &&
                                            pushSettings.pushNotification
                                                .requesting
                                        }
                                        type="submit"
                                    >
                                        {!pushSettings.pushNotification
                                            .requesting && <span>Save</span>}
                                        {pushSettings &&
                                            pushSettings.pushNotification
                                                .requesting && <FormLoader />}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ProfileSetting.displayName = 'ProfileSetting';

const ProfileSettingForm = reduxForm({
    form: 'Profile', // a unique identifier for this form,
    enableReinitialize: true,
    validate, // <--- validation function given to redux-for
})(ProfileSetting);

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            updateProfileSetting,
            logFile,
            resetFile,
            userSettings,
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
            setInitAlertEmail,
            setTwoFactorAuth,
            updateTwoFactorAuthToken,
            openModal,
            getProjects,
            updatePushNotification,
        },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe) {
    let resendTimer = state.profileSettings.resendTimer;
    if (!Validate.number(resendTimer)) {
        resendTimer = parseInt(resendTimer, 10);
    }
    const initValues = state.profileSettings.profileSetting
        ? Object.assign({}, state.profileSettings.profileSetting.data)
        : {};
    if (initValues && initValues.tempAlertPhoneNumber) {
        initValues.alertPhoneNumber = initValues.tempAlertPhoneNumber;
    }
    if (initValues && initValues.tempEmail) {
        initValues.email = initValues.tempEmail;
    }
    return {
        fileUrl: state.profileSettings.file,
        profileSettings: state.profileSettings.profileSetting,
        pushSettings: state.profileSettings,
        twoFactorAuthSetting: state.profileSettings.twoFactorAuthSetting,
        initialValues: initValues,
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        otp:
            state.form.Profile &&
            state.form.Profile.values &&
            state.form.Profile.values.otp,
        sendVerificationSMSError: state.profileSettings.smsVerification.error,
        sendVerificationSMSRequesting:
            state.profileSettings.smsVerification.requesting,
        verifySMSCodeError: state.profileSettings.smsVerificationResult.error,
        verifySMSCodeRequesting:
            state.profileSettings.smsVerificationResult.requesting,
        emailVerificationError:
            state.profileSettings.emailVerificationResult.error,
        emailVerificationRequesting:
            state.profileSettings.emailVerificationResult.requesting,
        emailVerificationSuccess:
            state.profileSettings.emailVerificationResult.success,
        profileSettingState: state.profileSettings.profileSettingState,
        resendTimer: resendTimer,
        emailValue: selector(state, 'email'),
    };
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ProfileSetting.propTypes = {
    alertPhoneNumber: PropTypes.string,
    emailValue: PropTypes.string,
    emailVerificationError: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    emailVerificationRequesting: PropTypes.bool,
    emailVerificationSuccess: PropTypes.bool,
    fileUrl: PropTypes.string,
    handleSubmit: PropTypes.func.isRequired,
    initAlertEmail: PropTypes.string,
    initPhoneVerification: PropTypes.bool,
    initPhoneVerificationNumber: PropTypes.string,
    initialAlertPhoneNumber: PropTypes.string,
    initialValues: PropTypes.object,
    isVerified: PropTypes.bool,
    logFile: PropTypes.func.isRequired,
    otp: PropTypes.string,
    profilePic: PropTypes.object,
    profileSettingState: PropTypes.object,
    profileSettings: PropTypes.object,
    projectId: PropTypes.oneOfType([PropTypes.string, PropTypes.bool]),
    removedPic: PropTypes.bool,
    resendTimer: PropTypes.oneOfType([
        PropTypes.number,
        PropTypes.oneOf([null, undefined]),
    ]),
    resetFile: PropTypes.func.isRequired,
    sendEmailVerificationLink: PropTypes.func.isRequired,
    sendVerificationSMS: PropTypes.func.isRequired,
    sendVerificationSMSError: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
        PropTypes.string,
    ]),
    sendVerificationSMSRequesting: PropTypes.bool,
    setAlertPhoneNumber: PropTypes.func.isRequired,
    setFileInputKey: PropTypes.func.isRequired,
    setInitAlertEmail: PropTypes.func,
    setInitPhoneVerification: PropTypes.func.isRequired,
    setInitPhoneVerificationNumber: PropTypes.func.isRequired,
    setInitialAlertPhoneNumber: PropTypes.func.isRequired,
    openModal: PropTypes.func.isRequired,
    setTwoFactorAuth: PropTypes.func.isRequired,
    updateTwoFactorAuthToken: PropTypes.func.isRequired,
    twoFactorAuthSetting: PropTypes.object,
    setIsVerified: PropTypes.func.isRequired,
    setProfilePic: PropTypes.func.isRequired,
    setRemovedPic: PropTypes.func.isRequired,
    setResendTimer: PropTypes.func.isRequired,
    setUserEmail: PropTypes.func.isRequired,
    setVerified: PropTypes.func.isRequired,
    updateProfileSetting: PropTypes.func.isRequired,
    updatePushNotification: PropTypes.func.isRequired,
    userEmail: PropTypes.string,
    userSettings: PropTypes.func.isRequired,
    verified: PropTypes.bool,
    verifySMSCode: PropTypes.func.isRequired,
    verifySMSCodeError: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    verifySMSCodeRequesting: PropTypes.bool,
    getProjects: PropTypes.func,
    pushSettings: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(ProfileSettingForm);
