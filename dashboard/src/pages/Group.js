import React, { Component } from 'react';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import GroupList from '../components/settings/GroupList';
import PropTypes from 'prop-types';
import { SHOULD_LOG_ANALYTICS } from '../config';
import { logEvent } from '../analytics';
import getParentRoute from '../utils/getParentRoute';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';

class Groups extends Component {
    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > SETTINGS');
        }
    }

    render() {
        const {
            location: { pathname },
        } = this.props;

        return (
            <Dashboard>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name="Project Settings"
                    />
                    <BreadCrumbItem route={pathname} name="Groups" />
                    <div className="Margin-vertical--12">
                        <div>
                            <div id="settingsPage">
                                <div className="db-BackboneViewContainer">
                                    <div className="react-settings-view react-view">
                                        <span>
                                            <div>
                                                <GroupList />
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
    }
}

Groups.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

Groups.displayName = 'Groups';

export default Groups;
