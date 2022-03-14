import React, { Component } from 'react';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
import Invoice from '../components/invoice/Invoice';
import PaymentCard from '../components/paymentCard/PaymentCard';

import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
// @ts-expect-error ts-migrate(2305) FIXME: Module '"prop-types"' has no exported member 'Prop... Remove this comment to see the full error message
import { PropTypes } from 'prop-types';
import BreadCrumbs from '../components/breadCrumb/BreadCrumbs';

class ProfileBilling extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
    }

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ProfileBilling.displayName = 'ProfileBilling';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ProfileBilling.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

export default connect(null, null)(ProfileBilling);
