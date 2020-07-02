import React from 'react';
import Dashboard from '../components/Dashboard';
import ProfileSetting from '../components/profileSettings/Profile';
import ChangePasswordSetting from '../components/profileSettings/ChangePassword';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import BreadCrumbs from '../components/breadCrumb/BreadCrumbs';
import { PropTypes } from 'prop-types';
import DeleteAccountBox from '../components/profileSettings/DeleteAccountBox';

const Profile = props => {
    const {
        location: { pathname },
    } = props;

    return (
        <Dashboard>
            <div className="db-World-contentPane Box-root Padding-bottom--48">
                <BreadCrumbItem route={pathname} name="Profile Settings" />
                <BreadCrumbs styles="breadCrumbContainer Card-shadow--medium db-mb" />
                <div>
                    <div>
                        <div className="db-BackboneViewContainer">
                            <div className="react-settings-view react-view">
                                <span data-reactroot="">
                                    <div>
                                        <div>
                                            <div className="Box-root Margin-bottom--12">
                                                <ProfileSetting />
                                            </div>
                                            <div className="Box-root Margin-bottom--12">
                                                <ChangePasswordSetting />
                                            </div>
                                            <div className="Box-root Margin-bottom--12">
                                                <DeleteAccountBox />
                                            </div>
                                        </div>
                                    </div>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
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
