import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import Dashboard from '../components/Dashboard';
import CustomerBalance from '../components/paymentCard/CustomerBalance';
import Invoice from '../components/invoice/Invoice';
import PaymentCard from '../components/paymentCard/PaymentCard';
import AlertCharges from '../components/alert/AlertCharges';
import RenderIfOwner from '../components/basic/RenderIfOwner';
import ChangePlan from '../components/settings/ChangePlan';
import AlertAdvanceOption from '../components/settings/AlertAdvanceOption';
import PropTypes from 'prop-types';

class Billing extends Component {

  constructor(props) {
    super(props);
    this.props = props;
  }

  componentDidMount() {
    if (window.location.href.indexOf('localhost') <= -1) {
      this.context.mixpanel.track('Billing page Loaded');
    }
  }

  render() {
    return (
      <Dashboard>
        <div className="Margin-vertical--12">
          <CustomerBalance />
          <AlertCharges/>

          <RenderIfOwner>
            <ChangePlan />
          </RenderIfOwner>

          <RenderIfOwner>
            <AlertAdvanceOption />
          </RenderIfOwner>

          <Invoice />

          <PaymentCard />
        </div>
      </Dashboard>
    );
  }
}

Billing.contextTypes = {
  mixpanel: PropTypes.object.isRequired
};

Billing.displayName = 'Billing'

export default withRouter(connect(null, null)(Billing));
