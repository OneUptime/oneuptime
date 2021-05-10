import React, { Component } from 'react';
import { connect } from 'react-redux';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import Invoice from '../components/invoice/Invoice';
import PaymentCard from '../components/paymentCard/PaymentCard';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import { PropTypes } from 'prop-types';
import BreadCrumbs from '../components/breadCrumb/BreadCrumbs';

class ProfileBilling extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: DASHBOARD > PROFILE > BILLING');
        }
    }

    render() {
        const {
            location: { pathname },
        } = this.props;

        return (
            <Dashboard>
                <Fade>
                    <div className="Profile-Pages--view">
                        <BreadCrumbs styles="breadCrumbContainer Card-shadow--medium db-mb" />
                        <BreadCrumbItem route={pathname} name="Billing" />
                        <div
                            id="profileBilling"
                            className="Margin-vertical--12"
                        >
                            <Invoice />
                            <PaymentCard />
                        </div>
                    </div>
                </Fade>
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

export default connect(null, null)(ProfileBilling);
