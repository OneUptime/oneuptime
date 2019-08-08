import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { reduxForm, Field } from 'redux-form';
import { updateUserSetting, logFile, resetFile } from '../../actions/user';
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

export class UserSetting extends Component {

    constructor(props){
        super(props);
        this.props = props;
    }

    componentDidMount() {
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('User settings page Loaded');
        }
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
            this.context.mixpanel.track('New User Profile Picture selected');
        }
    }


    submitForm = (values) => {
        const { updateUserSetting, resetFile, userId } = this.props;
        values._id = userId;
        updateUserSetting(values).then(function () {
            resetFile();
        });
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Update User', values);
        }
    }

    render() {
        const { handleSubmit, userSettings } = this.props;
        var fileData = this.props.fileUrl ? this.props.fileUrl : this.props.userSettings && this.props.userSettings.data && this.props.userSettings.data.profilePic ? `${API_URL}/file/${this.props.userSettings.data.profilePic}` : '';
        var profileImage = <span />;
        if ((this.props.userSettings && this.props.userSettings.data && this.props.userSettings.data.profilePic) || this.props.fileUrl) {
            profileImage = <img src={fileData} alt="" className="image-small-circle" style={{ marginTop: '10px' }} />;
        }
        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>User Details</span>
                            </span>
                            <p><span>Update user email, password, profile picture and more.</span></p>
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
                                                        disabled={userSettings && userSettings.requesting}
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
                                                        disabled={userSettings && userSettings.requesting}
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
                                                        disabled={userSettings && userSettings.requesting}
                                                    />
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">User's Profile Picture</label>
                                                <div className="bs-Fieldset-fields">
                                                    <div className="Box-root Flex-flex Flex-alignItems--center">
                                                        <div>
                                                            <label
                                                                className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                type="button"
                                                            >
                                                                <ShouldRender if={!(this.props.userSettings && this.props.userSettings.data && this.props.userSettings.data.profilePic)}>
                                                                    <span className="bs-Button--icon bs-Button--new"></span>
                                                                    <span>
                                                                        Upload User's Profile Picture
                                                                    </span>
                                                                </ShouldRender>
                                                                <ShouldRender if={this.props.userSettings && this.props.userSettings.data && this.props.userSettings.data.profilePic}>
                                                                    <span className="bs-Button--icon bs-Button--edit"></span>
                                                                    <span>
                                                                        Change User's Profile Picture
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
                                                    <ShouldRender if={(this.props.userSettings && this.props.userSettings.data && this.props.userSettings.data.profilePic) || this.props.fileUrl}>
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
                                    <ShouldRender if={userSettings && userSettings.error}>

                                        <div className="Box-root Margin-right--8">
                                            <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
                                            </div>
                                        </div>
                                        <div className="Box-root">
                                            <span style={{ color: 'red' }}>{userSettings && userSettings.error}</span>
                                        </div>

                                    </ShouldRender>
                                </div>
                            </div>
                            <div>
                                <button
                                    className="bs-Button bs-Button--blue"
                                    disabled={userSettings && userSettings.requesting}
                                    type="submit">
                                    {!userSettings.requesting && <span>Save User Profile</span>}
                                    {userSettings && userSettings.requesting && <FormLoader />}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}

UserSetting.displayName = 'UserSetting'

let UserSettingForm = reduxForm({
    form: 'User', // a unique identifier for this form,
    enableReinitialize: true,
    validate // <--- validation function given to redux-for
})(UserSetting);

const mapDispatchToProps = (dispatch) => {

    return bindActionCreators({
        updateUserSetting,
        logFile, resetFile
    }, dispatch)
}

function mapStateToProps(state, props) {
    const userId = props.match ? props.match.params.userId : null;
    const initialValues = state.user.users.users.find(user => user._id === userId) || {}
    return {
        userId,
        fileUrl: state.user.userSetting.file,
        userSettings: state.user.userSetting,
        initialValues
    };
}

UserSetting.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    userSettings: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined])
    ]),
    updateUserSetting: PropTypes.func.isRequired,
    logFile: PropTypes.func.isRequired,
    resetFile: PropTypes.func.isRequired,
    fileUrl: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined])
    ])

}

UserSetting.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(UserSettingForm);