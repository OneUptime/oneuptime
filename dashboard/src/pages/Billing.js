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
import AlertDisabledWarning from '../components/settings/AlertDisabledWarning';
import ShouldRender from '../components/basic/ShouldRender';
import NotAuthorised from '../components/project/NotAuthorised';
import RenderIfOwnerOrAdmin from '../components/basic/RenderIfOwnerOrAdmin';
import RenderIfSubProjectMember from '../components/basic/RenderIfSubProjectMember';

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
        } = this.props;

        return (
            <Dashboard>
                <BreadCrumbItem
                    route={getParentRoute(pathname)}
                    name="Project Settings"
                />
                <BreadCrumbItem route={pathname} name="Billing" />
                <RenderIfOwnerOrAdmin>
                    <div className="Margin-vertical--12">
                        <ShouldRender if={!alertEnable}>
                            <AlertDisabledWarning page="Billing" />
                        </ShouldRender>
                        <RenderIfOwner>
                            <AlertAdvanceOption />
                        </RenderIfOwner>
                        <CustomerBalance />
                        <AlertCharges />

                        <RenderIfOwner>
                            <ChangePlan />
                        </RenderIfOwner>
                    </div>
                </RenderIfOwnerOrAdmin>
                <RenderIfSubProjectMember>
                    <NotAuthorised />
                </RenderIfSubProjectMember>
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
};

export default withRouter(connect(mapStateToProps, null)(Billing));
