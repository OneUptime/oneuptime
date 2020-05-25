import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import Dashboard from '../components/Dashboard';
import Invoice from '../components/invoice/Invoice';
import PaymentCard from '../components/paymentCard/PaymentCard';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import { PropTypes } from 'prop-types';

class ProfileBilling extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('Profile billing page Loaded');
        }
    }

    render() {
        const {
            location: { pathname },
        } = this.props;

        return (
            <Dashboard>
                <BreadCrumbItem route={pathname} name="Billing" />
                <div className="Margin-vertical--12">
                    <Invoice />
                    <PaymentCard />
                </div>
            </Dashboard>
        );
    }
}

ProfileBilling.displayName = 'ProfileBilling';

ProfileBilling.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

export default withRouter(connect(null, null)(ProfileBilling));
