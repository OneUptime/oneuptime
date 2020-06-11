import React, { Component } from 'react';
import Dashboard from '../components/Dashboard';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import PropTypes from 'prop-types';
import APISettings from '../components/settings/APISettings';
import TutorialBox from '../components/tutorial/TutorialBox';

class FyipeApi extends Component {
    render() {
        const {
            location: { pathname },
        } = this.props;

        return (
            <Dashboard>
                <BreadCrumbItem
                    route={getParentRoute(pathname)}
                    name="Project Settings"
                />
                <BreadCrumbItem route={pathname} name="API" />
                <div className="db-BackboneViewContainer">
                    <div className="react-settings-view react-view">
                        <TutorialBox type="api" />
                        <APISettings />
                    </div>
                </div>
            </Dashboard>
        );
    }
}

FyipeApi.displayName = 'FyipeApi';

FyipeApi.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

export default FyipeApi;
