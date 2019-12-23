import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import Dashboard from '../components/Dashboard';

import { reduxForm, Field } from 'redux-form';
import { RenderField } from '../components/basic/RenderField';
import TimezoneSelector from '../components/basic/TimezoneSelector';
import ShouldRender from '../components/basic/ShouldRender';

import ReactPhoneInput from 'react-phone-input-2';
import 'react-phone-input-2/lib/style.css';

function TeamMemberProfile(props) {
    const profileSettings = { requesting: false };
    const profileSettingState = { alertPhoneNumber: '' };
    const fileData = '';
    const profilePic = null;

    let profileImage;

    if (profilePic || props.fileUrl) {
        profileImage = <img src={fileData} alt='' className='image-small-circle' style={{ marginTop: '10px' }} />
    }

    const handleOnChange = value => {
        return value;
    };

    return (
        <Dashboard>
            <div>
                <div>
                    <div className="db-BackboneViewContainer">
                        <div className="react-settings-view react-view">
                            <span data-reactroot="">
                                <div>
                                    <div>
                                        <div className="Box-root Margin-bottom--12">
                                            <div className='bs-ContentSection Card-root Card-shadow--medium'>
                                                <div className='Box-root'>
                                                    <div className='bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16'>
                                                        <div className='Box-root'>
                                                            <span className='Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap'>
                                                                <span>Team Member Profile</span>
                                                            </span>
                                                            <p>
                                                                <span>View your team member&apos;s email, profile picture and more.</span>
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <form>
                                                        <div className='bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2'>
                                                            <div>
                                                                <div className='bs-Fieldset-wrapper Box-root Margin-bottom--2'>
                                                                    <fieldset className='bs-Fieldset'>
                                                                        <div className='bs-Fieldset-rows'>
                                                                            <div className='bs-Fieldset-row'>
                                                                                <label className='bs-Fieldset-label'>Full Name</label>
                                                                                <div className='bs-Fieldset-fields'>
                                                                                    <Field
                                                                                        className='db-BusinessSettings-input TextInput bs-TextInput'
                                                                                        type='text'
                                                                                        name='name'
                                                                                        id='name'
                                                                                        placeholder='Full Name'
                                                                                        component={RenderField}
                                                                                        disabled={profileSettings && profileSettings.requesting}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                            <div className='bs-Fieldset-row'>
                                                                                <label className='bs-Fieldset-label'>Email</label>
                                                                                <div className='bs-Fieldset-fields'>
                                                                                    <Field
                                                                                        className='db-BusinessSettings-input TextInput bs-TextInput'
                                                                                        type='text'
                                                                                        name='email'
                                                                                        id='email'
                                                                                        placeholder='Email'
                                                                                        component={RenderField}
                                                                                        disabled={profileSettings && profileSettings.requesting}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                            <div className='bs-Fieldset-row'>
                                                                                <label className='bs-Fieldset-label'>Phone</label>
                                                                                <div className='bs-Fieldset-fields'>
                                                                                    <ReactPhoneInput
                                                                                        defaultCountry={'us'}
                                                                                        value={profileSettingState.alertPhoneNumber}
                                                                                        onChange={handleOnChange}
                                                                                        disabled={profileSettings && profileSettings.requesting}
                                                                                        inputStyle={{ width: 250, height: 28, fontSize: 14, color: '#525f7f', fontFamily: 'camphor' }}
                                                                                    />
                                                                                </div>
                                                                            </div>

                                                                            <div className='bs-Fieldset-row'>
                                                                                <label className='bs-Fieldset-label'>Profile Picture</label>
                                                                                <div className='bs-Fieldset-fields'>
                                                                                    <ShouldRender if={profilePic || props.fileUrl}>{profileImage}</ShouldRender>
                                                                                </div>
                                                                            </div>

                                                                            <div className='bs-Fieldset-row'>
                                                                                <label className='bs-Fieldset-label'>Timezone</label>
                                                                                <div className='bs-Fieldset-fields'>
                                                                                    <span className='SearchableSelect-container'>
                                                                                        <Field
                                                                                            component={TimezoneSelector}
                                                                                            name='timezone'
                                                                                            id='timezone'
                                                                                            placeholder='Select your timezone'
                                                                                            type='button'
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
                                                    </form>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </Dashboard>
    );
}

TeamMemberProfile.displayName = 'TeamMemberProfile';

let TeamMemberProfileForm = reduxForm({
    form: 'TeamMemberProfileForm',
    enableReinitialize: true
})(TeamMemberProfile);

TeamMemberProfile.propTypes = {
    fileUrl: PropTypes.string
};

export default connect()(TeamMemberProfileForm);