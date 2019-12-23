import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import Dashboard from '../components/Dashboard';
import ShouldRender from '../components/basic/ShouldRender';

function TeamMemberProfile(props) {
    const fileData = '';
    const profilePic = null;

    let profileImage;

    if (profilePic || props.fileUrl) {
        profileImage = <img src={fileData} alt='' className='image-small-circle' style={{ marginTop: '10px' }} />
    }

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

                                                    <div className='bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2'>
                                                        <div>
                                                            <div className='bs-Fieldset-wrapper Box-root Margin-bottom--2'>
                                                                <fieldset className='bs-Fieldset'>
                                                                    <div className='bs-Fieldset-rows'>
                                                                        <div className='bs-Fieldset-row'>
                                                                            <label className='bs-Fieldset-label'>Full Name</label>
                                                                            <div className='bs-Fieldset-fields'>

                                                                            </div>
                                                                        </div>
                                                                        <div className='bs-Fieldset-row'>
                                                                            <label className='bs-Fieldset-label'>Email</label>
                                                                            <div className='bs-Fieldset-fields'>

                                                                            </div>
                                                                        </div>
                                                                        <div className='bs-Fieldset-row'>
                                                                            <label className='bs-Fieldset-label'>Phone</label>
                                                                            <div className='bs-Fieldset-fields'>

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

                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </fieldset>
                                                            </div>
                                                        </div>
                                                    </div>
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

TeamMemberProfile.propTypes = {
    fileUrl: PropTypes.string
};

export default connect()(TeamMemberProfile);