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
import { IS_DEV } from '../config';

class Billing extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        if (!IS_DEV) {
            logEvent('Billing page Loaded');
        }
    }

    render() {
        return (
            <Dashboard>
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

export default withRouter(connect(null, null)(Billing));
