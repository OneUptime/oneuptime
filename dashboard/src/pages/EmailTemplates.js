import React, { Component } from 'react';
import Dashboard from '../components/Dashboard';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import Fade from 'react-reveal/Fade';
import EmailTemplatesBox from '../components/emailTemplates/EmailTemplatesBox';
import EmailSmtpBox from '../components/emailTemplates/EmailSmtpBox';
import { getEmailTemplates, getSmtpConfig } from '../actions/emailTemplates';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import AdvancedIncidentNotification from '../components/settings/AdvancedIncidentNotification';

class EmailTemplates extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    ready = () => {
        this.props.getEmailTemplates(this.props.currentProject._id);
        this.props.getSmtpConfig(this.props.currentProject._id);
    };

    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'PAGE VIEW: DASHBOARD > PROJECT > SETTINGS > EMAIL TEMPLATE'
            );
        }
    }

    render() {
        const {
            location: { pathname },
        } = this.props;

        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name="Project Settings"
                    />
                    <BreadCrumbItem route={pathname} name="Email" />
                    <EmailTemplatesBox />
                    <EmailSmtpBox />
                    <AdvancedIncidentNotification type="email" />
                </Fade>
            </Dashboard>
        );
    }
}

EmailTemplates.propTypes = {
    getEmailTemplates: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    getSmtpConfig: PropTypes.func.isRequired,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ getEmailTemplates, getSmtpConfig }, dispatch);

const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
    };
};

EmailTemplates.displayName = 'EmailTemplates';

export default connect(mapStateToProps, mapDispatchToProps)(EmailTemplates);
