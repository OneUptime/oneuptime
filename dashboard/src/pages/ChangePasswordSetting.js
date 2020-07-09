import React from 'react';
import { PropTypes } from 'prop-types';
import Dashboard from '../components/Dashboard';
import ChangePassword from '../components/profileSettings/ChangePassword';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';

const ChangePasswordSetting = props => {
    const {
        location: { pathname },
    } = props;

    return (
        <Dashboard>
            <BreadCrumbItem route={pathname} name="Profile Settings" />
            <div>
                <div>
                    <div className="db-BackboneViewContainer">
                        <div className="react-settings-view react-view">
                            <span data-reactroot="">
                                <div>
                                    <div>
                                        <div className="Box-root Margin-bottom--12">
                                            <ChangePassword />
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
};

ChangePasswordSetting.displayName = 'ChangePasswordSetting';

ChangePasswordSetting.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

export default ChangePasswordSetting;
