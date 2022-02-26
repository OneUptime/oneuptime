import React from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-reveal/Fade';
import ProfileSetting from '../components/profileSettings/Profile';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import BreadCrumbs from '../components/breadCrumb/BreadCrumbs';
// @ts-expect-error ts-migrate(2305) FIXME: Module '"prop-types"' has no exported member 'Prop... Remove this comment to see the full error message
import { PropTypes } from 'prop-types';

const Profile = (props: $TSFixMe) => {
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
