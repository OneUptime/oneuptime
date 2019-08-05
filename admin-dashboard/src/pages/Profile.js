import React from 'react';
import Dashboard from '../components/Dashboard';
import ProfileSetting from '../components/profileSettings/Profile';
import ChangePasswordSetting from '../components/profileSettings/ChangePassword';

const Profile = () => (
        <Dashboard>
            <div className="db-World-contentPane Box-root Padding-bottom--48">

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

Profile.displayName = 'Profile'

export default Profile
