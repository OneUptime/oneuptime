import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import Fade from 'react-reveal/Fade';
import { bindActionCreators } from 'redux';
import { getSmsTemplates, getSmtpConfig } from '../actions/smsTemplates';

import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import AdvancedIncidentNotification from '../components/settings/AdvancedIncidentNotification';

class WebhookSettings extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    render() {
        const {
            location: { pathname },
            icon,
            currentProject,
            switchToProjectViewerNav,
        } = this.props;
        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';

        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem
                    route={getParentRoute(pathname)}
                    name="Project Settings"
                    icon={icon}
                />
                <BreadCrumbItem
                    route={pathname}
                    name="Webhooks Settings"
                    icon={icon}
                />
                <div id="webhooksSettingsPage">
                    <AdvancedIncidentNotification type="webhook" />
                </div>
            </Fade>
        );
    }
}

WebhookSettings.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    icon: PropTypes.string,
    currentProject: PropTypes.object,
    switchToProjectViewerNav: PropTypes.bool,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ getSmsTemplates, getSmtpConfig }, dispatch);

const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

WebhookSettings.displayName = 'WebhookSettings';

export default connect(mapStateToProps, mapDispatchToProps)(WebhookSettings);
