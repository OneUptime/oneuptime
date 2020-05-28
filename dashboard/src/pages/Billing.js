import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import Dashboard from '../components/Dashboard';
import CustomerBalance from '../components/paymentCard/CustomerBalance';
import AlertCharges from '../components/alert/AlertCharges';
import RenderIfOwner from '../components/basic/RenderIfOwner';
import ChangePlan from '../components/settings/ChangePlan';
import AlertAdvanceOption from '../components/settings/AlertAdvanceOption';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { PropTypes } from 'prop-types';

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
        } = this.props;

        return (
            <Dashboard>
                <BreadCrumbItem
                    route={getParentRoute(pathname)}
                    name="Project Settings"
                />
                <BreadCrumbItem route={pathname} name="Billing" />
                <div className="Margin-vertical--12">
                    <CustomerBalance />
                    <AlertCharges />

                    <RenderIfOwner>
                        <ChangePlan />
                    </RenderIfOwner>

                    <RenderIfOwner>
                        <AlertAdvanceOption />
                    </RenderIfOwner>
                </div>
            </Dashboard>
        );
    }
}

Billing.displayName = 'Billing';

Billing.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

export default withRouter(connect(null, null)(Billing));
