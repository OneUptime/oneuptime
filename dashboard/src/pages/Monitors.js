import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import { PropTypes } from 'prop-types';
import Zoom from 'react-reveal/Zoom';
import Dashboard from '../components/Dashboard';
import MonitorCategories from '../components/settings/MonitorCategories';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';

class Monitors extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'PAGE VIEW: DASHBOARD > PROJECT > SETTINGS > MONITOR CATEGORY LIST'
            );
        }
    }

    render() {
        const {
            location: { pathname },
        } = this.props;

        return (
            <Dashboard>
                <Zoom>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name="Project Settings"
                    />
                    <BreadCrumbItem route={pathname} name="Monitors" />
                    <div className="Margin-vertical--12">
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="react-settings-view react-view">
                                    <span>
                                        <div>
                                            <MonitorCategories />
                                        </div>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </Zoom>
            </Dashboard>
        );
    }
}

Monitors.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

Monitors.displayName = 'Monitors';

export default withRouter(connect(null, null)(Monitors));
