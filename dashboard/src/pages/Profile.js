import React from 'react';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import ProfileSetting from '../components/profileSettings/Profile';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import BreadCrumbs from '../components/breadCrumb/BreadCrumbs';
import { PropTypes } from 'prop-types';

const Profile = props => {
    const {
        location: { pathname },
    } = props;

    return (
        <Dashboard>
            <Fade>
                <div className="db-World-contentPane Box-root Padding-bottom--48 Padding-top--78">
                    <BreadCrumbItem route={pathname} name="Profile Settings" />
                    <BreadCrumbs styles="breadCrumbContainer Card-shadow--medium db-mb" />
                    <div>
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="react-settings-view react-view">
                                    <span data-reactroot="">
                                        <div>
                                            <div>
                                                <div className="Margin-vertical--12">
                                                    <ProfileSetting />
                                                </div>
                                            </div>
                                        </div>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Fade>
        </Dashboard>
    );
};

Profile.displayName = 'Profile';

Profile.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

export default Profile;
