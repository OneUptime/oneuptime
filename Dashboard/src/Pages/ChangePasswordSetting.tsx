import React from 'react';

import { PropTypes } from 'prop-types';

import { Fade } from 'react-awesome-reveal';
import ChangePassword from '../components/profileSettings/ChangePassword';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import BreadCrumbs from '../components/breadCrumb/BreadCrumbs';

interface ChangePasswordSettingProps {
    location?: {
        pathname?: string
    };
}

const ChangePasswordSetting: Function = (props: ChangePasswordSettingProps) => {
    const {
        location: { pathname },
    } = props;

    return (
        <Fade>
            <div className="Profile-Pages--view">
                <BreadCrumbs styles="breadCrumbContainer Card-shadow--medium db-mb" />
                <BreadCrumbItem route={pathname} name="Change Password" />
                <div>
                    <div className="db-BackboneViewContainer">
                        <div className="react-settings-view react-view">
                            <span data-reactroot="">
                                <div>
                                    <div>
                                        <div
                                            id="changePasswordSetting"
                                            className="Box-root Margin-bottom--12"
                                        >
                                            <ChangePassword />
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

ChangePasswordSetting.displayName = 'ChangePasswordSetting';

ChangePasswordSetting.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

export default ChangePasswordSetting;
