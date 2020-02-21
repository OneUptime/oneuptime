import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import Dashboard from '../components/Dashboard';
import Invoice from '../components/invoice/Invoice';
import PaymentCard from '../components/paymentCard/PaymentCard';
import { logEvent } from '../analytics';
import { IS_DEV } from '../config';

class ProfileBilling extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        if (!IS_DEV) {
            logEvent('Profile billing page Loaded');
        }
    }

    render() {
        return (
            <Dashboard>
                <div className="Margin-vertical--12">
                    <Invoice />
                    <PaymentCard />
                </div>
            </Dashboard>
        );
    }
}

ProfileBilling.displayName = 'ProfileBilling';

export default withRouter(connect(null, null)(ProfileBilling));
