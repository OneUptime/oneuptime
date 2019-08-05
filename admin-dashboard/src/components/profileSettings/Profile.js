import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { reduxForm, Field } from 'redux-form';
import { updateProfileSetting, userSettings, logFile, resetFile } from '../../actions/profile';
import { RenderField } from '../basic/RenderField';
import { Validate, API_URL } from '../../config';
import { FormLoader } from '../basic/Loader';
import { UploadFile } from '../basic/UploadFile';
import TimezoneSelector from '../basic/TimezoneSelector';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';

//Client side validation
function validate(values) {

    const errors = {};

    if (values.email) {
        if (!Validate.email(values.email)) {
            errors.email = 'Email is not valid.'
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

    componentDidMount() {
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Profile settings page Loaded');
        }
        this.props.userSettings();
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
        } catch (error) {
            return
        }
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('New Profile Picture selected');
        }
    }


    submitForm = (values) => {
        const { updateProfileSetting, resetFile } = this.props;

        updateProfileSetting(values).then(function () {
            resetFile();
        });
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Update Profile', values);
        }
    }

    render() {
        const { handleSubmit, profileSettings } = this.props;
        var fileData = this.props.fileUrl ? this.props.fileUrl : this.props.profileSettings && this.props.profileSettings.data && this.props.profileSettings.data.profilePic ? `${API_URL}/file/${this.props.profileSettings.data.profilePic}` : '';
        var profileImage = <span />;
        if ((this.props.profileSettings && this.props.profileSettings.data && this.props.profileSettings.data.profilePic) || this.props.fileUrl) {
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
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Phone</label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        type="text"
                                                        name="companyPhoneNumber"
                                                        id="companyPhoneNumber"
                                                        placeholder="Phone Number"
                                                        component={RenderField}
                                                        disabled={profileSettings && profileSettings.requesting}
                                                    />
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Profile Picture</label>
                                                <div className="bs-Fieldset-fields">
                                                    <div className="Box-root Flex-flex Flex-alignItems--center">
                                                        <div>
                                                            <label
                                                                className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                type="button"
                                                            >
                                                                <ShouldRender if={!(this.props.profileSettings && this.props.profileSettings.data && this.props.profileSettings.data.profilePic)}>
                                                                    <span className="bs-Button--icon bs-Button--new"></span>
                                                                    <span>
                                                                        Upload Profile Picture
                                                                    </span>
                                                                </ShouldRender>
                                                                <ShouldRender if={this.props.profileSettings && this.props.profileSettings.data && this.props.profileSettings.data.profilePic}>
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
                                                                    />
                                                                </div>
                                                            </label>

                                                        </div>
                                                    </div>
                                                    <ShouldRender if={(this.props.profileSettings && this.props.profileSettings.data && this.props.profileSettings.data.profilePic) || this.props.fileUrl}>
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
        userSettings
    }, dispatch)
}

function mapStateToProps(state) {
    return {
        fileUrl: state.profileSettings.file,
        profileSettings: state.profileSettings.profileSetting,
        initialValues: state.profileSettings.profileSetting ? state.profileSettings.profileSetting.data : {}
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
    ])

}

ProfileSetting.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(ProfileSettingForm);