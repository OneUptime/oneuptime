import React, { Component } from 'react';
import { connect } from 'react-redux';
import { PropTypes } from 'prop-types';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import ResourceCategories from '../components/settings/ResourceCategories';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';

class Resources extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'PAGE VIEW: DASHBOARD > PROJECT > SETTINGS > RESOURCE CATEGORY LIST'
            );
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
                    <BreadCrumbItem route={pathname} name="Resources" />
                    <div className="Margin-vertical--12">
                        <div>
                            <div
                                id="resourceCategories"
                                className="db-BackboneViewContainer"
                            >
                                <div className="react-settings-view react-view">
                                    <span>
                                        <div>
                                            <ResourceCategories />
                                        </div>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

Resources.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

Resources.displayName = 'Resources';

export default connect(null, null)(Resources);
