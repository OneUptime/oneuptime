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
import { SHOULD_LOG_ANALYTICS, User } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { PropTypes } from 'prop-types';
import AlertDisabledWarning from '../components/settings/AlertDisabledWarning';
import ShouldRender from '../components/basic/ShouldRender';
import NotAuthorised from '../components/project/NotAuthorised';

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

        const currentUser =
            currentProject &&
            currentProject.users.filter(
                user => String(user.userId) === String(User.getUserId())
            );

        const isOwnerOrAdmin =
            currentUser &&
            (currentUser[0].role === 'Owner' ||
            currentUser[0].role === 'Administrator'
                ? true
                : false);

        return (
            <Dashboard>
                <BreadCrumbItem
                    route={getParentRoute(pathname)}
                    name="Project Settings"
                />
                <BreadCrumbItem route={pathname} name="Billing" />
                <ShouldRender if={isOwnerOrAdmin}>
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
                </ShouldRender>
                <NotAuthorised />
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
