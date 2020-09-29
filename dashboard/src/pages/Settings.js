import React, { Component } from 'react';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import ProjectSettings from '../components/settings/ProjectSettings';
import SubProjects from '../components/settings/SubProjects';
import RenderIfMember from '../components/basic/RenderIfMember';
import ExitProject from '../components/settings/ExitProject';
import PropTypes from 'prop-types';
import { SHOULD_LOG_ANALYTICS } from '../config';
import { logEvent } from '../analytics';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';

class Settings extends Component {
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
                    <BreadCrumbItem route={pathname} name="Project Settings" />
                    <div className="Margin-vertical--12">
                        <div>
                            <div id="settingsPage">
                                <div className="db-BackboneViewContainer">
                                    <div className="react-settings-view react-view">
                                        <span>
                                            <div>
                                                <ProjectSettings />

                                                <SubProjects />

                                                <RenderIfMember>
                                                    <ExitProject />
                                                </RenderIfMember>
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

Settings.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

Settings.displayName = 'Settings';

export default Settings;
