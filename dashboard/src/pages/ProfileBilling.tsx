import React, { Component } from 'react';
import { connect } from 'react-redux';

import { Fade } from 'react-awesome-reveal';
import Invoice from '../components/invoice/Invoice';
import PaymentCard from '../components/paymentCard/PaymentCard';

import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';

import { PropTypes } from 'prop-types';
import BreadCrumbs from '../components/breadCrumb/BreadCrumbs';

interface ProfileBillingProps {
    location?: {
        pathname?: string
    };
}

class ProfileBilling extends Component<ProfileBillingProps> {
    constructor(props: $TSFixMe) {
        super(props);

        this.props = props;
    }

    override render() {
        const {

            location: { pathname },
        } = this.props;

        return (
            <Fade>
                <div className="Profile-Pages--view">
                    <BreadCrumbs styles="breadCrumbContainer Card-shadow--medium db-mb" />
                    <BreadCrumbItem route={pathname} name="Billing" />
                    <div id="profileBilling" className="Margin-vertical--12">
                        <Invoice />
                        <PaymentCard />
                    </div>
                </div>
            </Fade>
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
