import React from 'react';
import Fade from 'react-reveal/Fade';
import ProfileSetting from '../components/profileSettings/Profile';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import BreadCrumbs from '../components/breadCrumb/BreadCrumbs';
import { PropTypes } from 'prop-types';

const Profile = props => {
    const {
        location: { pathname },
    } = props;

    return (
        <Fade>
            <div className="Profile-Pages--view">
                <BreadCrumbs styles="breadCrumbContainer Card-shadow--medium db-mb" />
                <BreadCrumbItem route={pathname} name="Profile Settings" />
                <div>
                    <div
                        className="db-RadarRulesLists-page bs-ContentSection"
                        style={{ boxShadow: 'none' }}
                    >
                        <div className="react-settings-view react-view">
                            <span data-reactroot="">
                                <div>
                                    <div>
                                        <div
                                            id="profileSettingPage"
                                            className="Margin-vertical--12"
                                        >
                                            <ProfileSetting />
                                        </div>
                                    </div>
                                </div>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </Fade>
    );
};

Profile.displayName = 'Profile';

Profile.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

export default Profile;
