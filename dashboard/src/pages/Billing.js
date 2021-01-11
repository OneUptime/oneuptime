import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import CustomerBalance from '../components/paymentCard/CustomerBalance';
import AlertCharges from '../components/alert/AlertCharges';
import ChangePlan from '../components/settings/ChangePlan';
import AlertAdvanceOption from '../components/settings/AlertAdvanceOption';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS, User } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { PropTypes } from 'prop-types';
import AlertDisabledWarning from '../components/settings/AlertDisabledWarning';
import ShouldRender from '../components/basic/ShouldRender';
import { getSmtpConfig } from '../actions/smsTemplates';
import { bindActionCreators } from 'redux';

class Billing extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > SETTINGS > BILLING');
        }
        this.props.getSmtpConfig(this.props.currentProjectId);
    }

    render() {
        const {
            location: { pathname },
            alertEnable,
            currentProject,
        } = this.props;

        return (
            <Dashboard>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name="Project Settings"
                    />
                    <BreadCrumbItem route={pathname} name="Billing" />
                    <div id="billingSetting" className="Margin-vertical--12">
                        <ShouldRender if={!alertEnable}>
                            <AlertDisabledWarning page="Billing" />
                        </ShouldRender>
                        <ShouldRender if={currentProject}>
                            <AlertAdvanceOption />
                        </ShouldRender>
                        <CustomerBalance />
                        <AlertCharges />
                        <ShouldRender if={currentProject}>
                            <ChangePlan />
                        </ShouldRender>
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

Billing.displayName = 'Billing';

const mapStateToProps = (state, props) => {
    // const { projectId } = props.match.params;

    const projectId = User.getCurrentProjectId()
        ? User.getCurrentProjectId()
        : null;
    return {
        currentProjectId: projectId,
        alertEnable:
            state.form.AlertAdvanceOption &&
            state.form.AlertAdvanceOption.values.alertEnable,
        currentProject: state.project.currentProject,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            getSmtpConfig,
        },
        dispatch
    );
};

Billing.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    alertEnable: PropTypes.bool,
    currentProject: PropTypes.object,
    currentProjectId: PropTypes.string.isRequired,
    getSmtpConfig: PropTypes.func.isRequired,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(Billing)
);
