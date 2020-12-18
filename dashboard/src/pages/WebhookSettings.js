import React, { Component } from 'react';
import Dashboard from '../components/Dashboard';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import Fade from 'react-reveal/Fade';
import { bindActionCreators } from 'redux';
import { getSmsTemplates, getSmtpConfig } from '../actions/smsTemplates';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import AdvancedIncidentNotification from '../components/settings/AdvancedIncidentNotification';

class WebhookSettings extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > SETTINGS > WEBHOOKS');
        }
    }

    render() {
        const {
            location: { pathname },
            icon,
        } = this.props;

        return (
            <Dashboard ready={this.ready}>
                <Fade>
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
                    <AdvancedIncidentNotification type="webhook" />
                </Fade>
            </Dashboard>
        );
    }
}

WebhookSettings.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    icon: PropTypes.string,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ getSmsTemplates, getSmtpConfig }, dispatch);

const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
    };
};

WebhookSettings.displayName = 'WebhookSettings';

export default connect(mapStateToProps, mapDispatchToProps)(WebhookSettings);
