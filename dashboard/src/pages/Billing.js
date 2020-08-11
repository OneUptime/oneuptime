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
import { SHOULD_LOG_ANALYTICS } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { PropTypes } from 'prop-types';
import AlertDisabledWarning from '../components/settings/AlertDisabledWarning';
import ShouldRender from '../components/basic/ShouldRender';

class Billing extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > SETTINGS > BILLING');
        }
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

const mapStateToProps = state => {
    return {
        alertEnable:
            state.form.AlertAdvanceOption &&
            state.form.AlertAdvanceOption.values.alertEnable,
        currentProject: state.project.currentProject,
    };
};

Billing.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    alertEnable: PropTypes.bool,
    currentProject: PropTypes.object,
};

export default withRouter(connect(mapStateToProps, null)(Billing));
