import React, { useEffect } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { API_URL } from '../config';
import Dashboard from '../components/Dashboard';
import { LargeSpinner as Loader } from '../components/basic/Loader';
import ShouldRender from '../components/basic/ShouldRender';
import { User } from '../config';

import { getTeamMember } from '../actions/team';

const noDataStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '150px'
};

function TeamMemberProfile({ requesting, error, teamMember, projectId, match, getTeamMember }) {
    if (!projectId) {
        projectId = User.getCurrentProjectId();
    }
    const memberId = match.params.memberId;

    useEffect(() => {
        getTeamMember(projectId, memberId);
    }, [projectId, memberId, getTeamMember]);

    const profilePic = teamMember && teamMember.profilePic ?
        teamMember.profilePic : null;
    const fileData = profilePic ? `${API_URL}/file/${profilePic}`
        : 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'
    let profileImage = <span />

    if (fileData) {
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
                                                            {!requesting && teamMember && !error ?
                                                                <div className='bs-Fieldset-wrapper Box-root Margin-bottom--2'>
                                                                    <fieldset className='bs-Fieldset'>
                                                                        <div className='bs-Fieldset-rows'>
                                                                            <ShouldRender if={teamMember.name}>
                                                                                <div className='bs-Fieldset-row'>
                                                                                    <label className='bs-Fieldset-label'>Full Name</label>
                                                                                    <div className='bs-Fieldset-fields'>
                                                                                        <span className="value" style={{ marginTop: '6px' }}>{teamMember.name}</span>
                                                                                    </div>
                                                                                </div>
                                                                            </ShouldRender>

                                                                            <ShouldRender if={teamMember.email && teamMember.email !== 'undefined'}>
                                                                                <div className='bs-Fieldset-row'>
                                                                                    <label className='bs-Fieldset-label'>Email</label>
                                                                                    <div className='bs-Fieldset-fields'>
                                                                                        <span className="value" style={{ marginTop: '6px' }}>{teamMember.email}</span>
                                                                                    </div>
                                                                                </div>
                                                                            </ShouldRender>

                                                                            <ShouldRender if={teamMember.companyPhoneNumber && teamMember.companyPhoneNumber !== 'undefined'}>
                                                                                <div className='bs-Fieldset-row'>
                                                                                    <label className='bs-Fieldset-label'>Phone</label>
                                                                                    <div className='bs-Fieldset-fields'>
                                                                                        <span className="value" style={{ marginTop: '6px' }}>{teamMember.companyPhoneNumber}</span>
                                                                                    </div>
                                                                                </div>
                                                                            </ShouldRender>

                                                                            <ShouldRender if={fileData}>
                                                                                <div className='bs-Fieldset-row'>
                                                                                    <label className='bs-Fieldset-label'>Profile Picture</label>
                                                                                    <div className='bs-Fieldset-fields'>
                                                                                        {profileImage}
                                                                                    </div>
                                                                                </div>
                                                                            </ShouldRender>

                                                                            <ShouldRender if={teamMember.timezone && teamMember.timezone !== 'undefined'}>
                                                                                <div className='bs-Fieldset-row'>
                                                                                    <label className='bs-Fieldset-label'>Timezone</label>
                                                                                    <div className='bs-Fieldset-fields'>
                                                                                        <span className="value" style={{ marginTop: '6px' }}>{teamMember.timezone}</span>
                                                                                    </div>
                                                                                </div>
                                                                            </ShouldRender>
                                                                        </div>
                                                                    </fieldset>
                                                                </div>
                                                                :
                                                                <div style={noDataStyle}>
                                                                    {requesting ? <Loader /> : <span style={{ color: 'red' }}>User details not found</span>}
                                                                </div>
                                                            }
                                                        </div>
                                                    </div>

                                                    <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                                        <span className="db-SettingsForm-footerMessage"></span>
                                                        <div>

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

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        { getTeamMember }
        , dispatch
    );
};

function mapStateToProps(state) {
    const projectId = state.project.currentProject ? state.project.currentProject._id : null;
    return {
        requesting: state.team.teamMember.requesting,
        error: state.team.teamMember.error,
        teamMember: state.team.teamMember.member,
        projectId: projectId,
    }
}

TeamMemberProfile.propTypes = {
    requesting: PropTypes.bool,
    error: PropTypes.bool,
    teamMember: PropTypes.oneOfType([PropTypes.object, PropTypes.string, PropTypes.oneOf([null])]),
    projectId: PropTypes.string,
    match: PropTypes.object,
    getTeamMember: PropTypes.func
};

export default connect(mapStateToProps, mapDispatchToProps)(TeamMemberProfile);